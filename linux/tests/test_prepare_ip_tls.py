import importlib.util
from pathlib import Path
import sys
import pytest
from unittest.mock import patch
import json
import hashlib

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


def test_reload_waits_for_new_peer_fingerprint_not_just_old_valid_certificate():
    m=module();calls=[];expected=hashlib.sha256(b'new fixture').hexdigest()
    class Docker:
        def own_container(self,*args):return {'Image':'sha256:'+'a'*64,'State':{'Running':True},'HostConfig':{'PortBindings':{'8443/tcp':[{'HostIp':'127.0.0.1','HostPort':'18443'}]}}}
        def run(self,*args):calls.append(args)
    with patch.object(m,'tls_loopback',side_effect=[{'peer_sha256':'old'},{'peer_sha256':expected}]) as probe,patch.object(m.time,'sleep'):
        m.reload_autonomous(Docker(),{'releaseId':'fixture','nginx_image_id':'sha256:'+'a'*64},expected_peer=expected)
    assert probe.call_count==2 and len(calls)==2


def test_rollback_reload_derives_fingerprint_again_from_restored_current_link(tmp_path):
    m=module();new='a'*64;old='b'*64
    with patch.object(m,'current_peer',side_effect=[new,old]),patch.object(m,'reload_autonomous') as reload:
        m.reload_current(object(),{'releaseId':'fixture'},tmp_path)
        m.reload_current(object(),{'releaseId':'fixture'},tmp_path)
    assert [call.kwargs['expected_peer'] for call in reload.call_args_list]==[new,old]


def test_timer_install_refuses_existing_different_or_linked_system_units(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700);units=tmp_path/'units';units.mkdir()
    (units/'village-autonomous-tls.service').write_text('unexpected old service')
    calls=[]
    with pytest.raises(ValueError,match='EXISTING_TLS_SYSTEM_UNIT_DIFFERS'):
        m.install_timer(state,'admin',units=units,run=lambda *args:calls.append(args))
    assert calls==[]


def test_default_docker_host_binding_requires_confirmed_public_port80_runtime(tmp_path):
    m=module();base=tmp_path/'village-deploy';base.mkdir();(base/'public').mkdir();(base/'nginx.conf').write_text('fixture')
    obj={'Name':'/village-web-web-1','Image':next(iter(m.LEGACY_IMAGES)),'State':{'Running':True},
         'HostConfig':{'PortBindings':{'8080/tcp':[{'HostIp':'','HostPort':'80'}]}},
         'NetworkSettings':{'Ports':{'8080/tcp':[{'HostIp':'0.0.0.0','HostPort':'80'},{'HostIp':'::','HostPort':'80'}]}},
         'Mounts':[{'Type':'bind','Source':str(base/'public'),'Destination':'/usr/share/nginx/html','RW':False},
                   {'Type':'bind','Source':str(base/'nginx.conf'),'Destination':'/etc/nginx/nginx.conf','RW':False}]}
    assert m.legacy_static_paths(obj,base)==(base/'nginx.conf',base/'public')
    for ports in ({}, {'8080/tcp':[]}, {'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'80'}]},
                  {'8080/tcp':[{'HostIp':'0.0.0.0','HostPort':'8080'}]},
                  {'8080/tcp':[{'HostIp':'0.0.0.0','HostPort':'80'}],'443/tcp':[]}):
        obj['NetworkSettings']['Ports']=ports
        with pytest.raises(ValueError,match='KNOWN_STATIC_PORT_REQUIRED'):m.legacy_static_paths(obj,base)


def test_public_acme_probe_repairs_only_challenge_permissions_under_private_umask(tmp_path):
    import os,stat,contextlib
    from unittest.mock import patch
    m=module();root=tmp_path/'public';root.mkdir(mode=0o775)
    parent=root/'.well-known';parent.mkdir(mode=0o700);directory=parent/'acme-challenge';directory.mkdir(mode=0o700)
    untouched=root/'private-test';untouched.write_text('unrelated');untouched.chmod(0o600)
    modes=[];original_chmod=Path.chmod
    def chmod(path,mode,*args,**kwargs):
        modes.append((path,mode));return original_chmod(path,mode,*args,**kwargs)
    class Opener:
        def open(self,request,timeout):
            name=request.full_url.rsplit('/',1)[1];p=directory/name
            assert (parent,0o755) in modes and (directory,0o755) in modes and (p,0o644) in modes
            if os.name=='posix':
                assert stat.S_IMODE(parent.stat().st_mode)==0o755
                assert stat.S_IMODE(directory.stat().st_mode)==0o755
                assert stat.S_IMODE(p.stat().st_mode)==0o644
            response=type('Reply',(),{'status':200,'read':lambda self,n:p.read_bytes()})()
            return contextlib.nullcontext(response)
    old=os.umask(0o077)
    try:
        with patch.object(m.urllib.request,'build_opener',return_value=Opener()),patch.object(Path,'chmod',chmod):m.verify_acme_webroot(root)
    finally:os.umask(old)
    assert not list(directory.iterdir())
    assert untouched not in [p for p,mode in modes]
    if os.name=='posix':assert stat.S_IMODE(untouched.stat().st_mode)==0o600


def test_tls_failure_diagnostic_reports_http_status_without_private_url_or_body():
    from urllib.error import HTTPError
    m=module();error=HTTPError('https://private.invalid/secret',404,'private body',{},None)
    assert m.error_diagnostic(error)=={'category':'HTTP_ERROR','http_status':404}
    assert m.error_diagnostic(ValueError('KNOWN_STATIC_CONFIG_REQUIRED'))=={'category':'KNOWN_STATIC_CONFIG_REQUIRED'}
    assert m.error_diagnostic(ValueError('private secret text'))=={'category':'ValueError'}
