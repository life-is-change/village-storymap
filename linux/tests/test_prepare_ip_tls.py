import importlib.util
from pathlib import Path
import sys
import pytest
from unittest.mock import patch
import json

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'prepare-ip-tls.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('prepare_ip_tls_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_acme_route_edit_preserves_bind_mounted_inode_and_restores_after_reload_failure(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    config=tmp_path/'nginx.conf';before='events {}\nhttp { server { listen 8080; root /usr/share/nginx/html; location / { try_files $uri =404; } } }\n'
    config.write_text(before);inode=config.stat().st_ino;calls=[]
    class Docker:
        def run(self,*args,**kwargs):
            calls.append(args)
            if len(calls)==2:raise RuntimeError('fixture first reload failed')
    with pytest.raises(RuntimeError):m.install_legacy_acme(Docker(),state,config)
    assert config.read_text()==before and config.stat().st_ino==inode
    assert len(calls)>=3
    assert list(state.glob('legacy-nginx-*.conf'))


def test_legacy_route_requires_known_image_and_exact_bind_paths(tmp_path):
    m=module();base=tmp_path/'village-deploy';base.mkdir();(base/'public').mkdir();(base/'nginx.conf').write_text('fixture')
    image=next(iter(m.LEGACY_IMAGES))
    obj={'Name':'/village-web-web-1','Image':image,'Id':'a'*64,'State':{'Running':True},
         'HostConfig':{'PortBindings':{'8080/tcp':[{'HostIp':'0.0.0.0','HostPort':'80'},{'HostIp':'::','HostPort':'80'}]}},
         'Mounts':[{'Type':'bind','Source':str(base/'public'),'Destination':'/usr/share/nginx/html','RW':False},
                   {'Type':'bind','Source':str(base/'nginx.conf'),'Destination':'/etc/nginx/nginx.conf','RW':False}]}
    assert m.legacy_static_paths(obj,base)==(base/'nginx.conf',base/'public')
    with pytest.raises(ValueError):m.legacy_static_paths({**obj,'Image':'sha256:'+'f'*64},base)
    obj['Mounts'][0]['RW']=True
    with pytest.raises(ValueError):m.legacy_static_paths(obj,base)


def test_renewal_refuses_wrong_release_before_reload_and_dry_run_does_not_install(tmp_path):
    m=module()
    class Docker:
        def own_container(self,*args):raise ValueError('AUTONOMOUS_RELEASE_IDENTITY_CHANGED')
        def run(self,*args):pytest.fail('unknown runtime must not reload')
    with pytest.raises(ValueError):m.reload_autonomous(Docker(),{'releaseId':'autonomous-'+'a'*12})
    # Dry-run certificates must never be copied to the live TLS tree.
    assert m.should_install('renew-test') is False
    assert m.should_install('staging') is False
    assert m.should_install('issue') is True
