import importlib.util
from pathlib import Path
import shutil
import sys
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))

def module():
    spec=importlib.util.spec_from_file_location('account_entry_repair',S/'repair-autonomous-account-entry.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def previous(m,tmp_path):
    data=m.browser.inputs(S.parents[1]);meta={'releaseId':'fixture'}
    hashes={m.browser.PATCH:'a'*64,m.locks.geo.PATCH:'b'*64,m.locks.PATCH:'c'*64}
    v3=tmp_path/'files'/m.browser.PATCH;v3.mkdir(parents=True,mode=0o700);web=v3/'web';web.mkdir(mode=0o700)
    for name,value in data.items():
        p=web/name;p.parent.mkdir(parents=True,mode=0o700,exist_ok=True);p.write_bytes(value);p.chmod(0o600)
    m.storage.write_private_json(v3/'receipt.json',{'releaseId':'fixture','files':{k:m.digest(v) for k,v in data.items()},'sql_sha256':hashes[m.browser.PATCH],'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(v3/'overlay-proof.json',{'tree_sha256':m.tree_digest(web)})
    geo=tmp_path/'files'/m.locks.geo.PATCH;geo.mkdir(mode=0o700);shutil.copytree(web,geo/'web')
    m.storage.write_private_json(geo/'receipt.json',{'releaseId':'fixture','files':{'app.js':m.digest(data['app.js'])},'source_web':str(web),'sql_sha256':hashes[m.locks.geo.PATCH],'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(geo/'overlay-proof.json',{'tree_sha256':m.tree_digest(geo/'web')})
    root=tmp_path/'files'/m.locks.PATCH;root.mkdir(mode=0o700);shutil.copytree(geo/'web',root/'web')
    service=(S.parents[1]/'features/data/data-service.js').read_bytes().replace(b'\r\n',b'\n');p=root/'web/features/data/data-service.js';p.parent.mkdir(parents=True,mode=0o700,exist_ok=True);p.write_bytes(service);p.chmod(0o600)
    data['features/data/data-service.js']=service
    m.storage.write_private_json(root/'receipt.json',{'releaseId':'fixture','files':{k:m.digest(data[k]) for k in ['app.js','features/data/data-service.js']},'source_web':str(geo/'web'),'sql_sha256':hashes[m.locks.PATCH],'phase':'served_verified_browser_login_pending'})
    m.storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':m.tree_digest(root/'web')})
    return meta,data,hashes,root/'web'

def test_account_web_update_accepts_only_the_complete_verified_task_lock_overlay(tmp_path):
    m=module();meta,data,hashes,path=previous(m,tmp_path)
    assert m.verify_previous(tmp_path,meta,data,hashes,path)==path
    (path/'features/data/data-service.js').write_text('tampered')
    with pytest.raises(ValueError,match='PREVIOUS_TASK_LOCK_PATCH_CHANGED'):
        m.verify_previous(tmp_path,meta,data,hashes,path)

def test_account_update_contains_only_two_browser_files_and_keeps_access_checks():
    m=module();data=m.inputs(S.parents[1])
    assert set(data)=={'app-3d.js','features/data/unified-api-client.js'}
    assert b'personalLayerVersionSpace === true' in data['app-3d.js']
    assert b'personal.listSelections' in data['app-3d.js']
    assert b"fault('CONTEXT_CHANGED')" in data['features/data/unified-api-client.js']


def test_account_update_accepts_the_exact_deployed_legacy_3d_file_but_not_unknown_versions(tmp_path):
    m=module();meta,data,hashes,path=previous(m,tmp_path)
    legacy=data['app-3d.js'].replace(m.NEW_3D_ROUTE,m.OLD_3D_ROUTE)
    assert m.digest(legacy)==m.LEGACY_3D
    for patch in (m.browser.PATCH,m.locks.geo.PATCH,m.locks.PATCH):
        root=tmp_path/'files'/patch;(root/'web/app-3d.js').write_bytes(legacy)
        m.storage.write_private_json(root/'overlay-proof.json',{'tree_sha256':m.tree_digest(root/'web')})
        if patch==m.browser.PATCH:
            receipt=m.storage.read_private_json(root/'receipt.json');receipt['files']['app-3d.js']=m.LEGACY_3D;m.storage.write_private_json(root/'receipt.json',receipt)
    assert m.verify_previous(tmp_path,meta,data,hashes,path)==path
    root=tmp_path/'files'/m.browser.PATCH;receipt=m.storage.read_private_json(root/'receipt.json');receipt['files']['app-3d.js']='d'*64;m.storage.write_private_json(root/'receipt.json',receipt)
    with pytest.raises(ValueError,match='PREVIOUS_3D_VERSION_CHANGED'):
        m.verify_previous(tmp_path,meta,data,hashes,path)


@pytest.mark.parametrize('exists',[True,False])
def test_prepared_account_web_switch_can_resume_after_container_stopped_or_removed(exists):
    m=module()
    class Docker:
        def run(self,*args):return m.WEB+'\n' if exists else ''
        def own_container(self,name,release):
            assert name==m.WEB and release=='release'
            return {'Image':'pinned','State':{'Running':False},'HostConfig':{'PortBindings':{'8443/tcp':[{'HostPort':'443'}]}},'Mounts':[{'Destination':'/srv/village-web','RW':False,'Source':'/verified/web'}]}
    result=m.inspect_web(Docker(),{'releaseId':'release','nginx_image_id':'pinned'},{'/verified/web'},resume=True)
    assert (result is not None)==exists
    with pytest.raises(ValueError,match='WEB_IDENTITY_REQUIRED'):
        m.inspect_web(Docker(),{'releaseId':'release','nginx_image_id':'pinned'},{'/verified/web'},resume=False)


def test_prepared_resume_never_accepts_a_different_image_or_unknown_web_mount():
    m=module()
    row={'Image':'wrong','State':{'Running':False},'HostConfig':{'PortBindings':{'8443/tcp':[{'HostPort':'443'}]}},'Mounts':[{'Destination':'/srv/village-web','RW':False,'Source':'/unknown/web'}]}
    class Docker:
        def run(self,*args):return m.WEB+'\n'
        def own_container(self,*args):return row
    with pytest.raises(ValueError,match='WEB_IDENTITY_REQUIRED'):m.inspect_web(Docker(),{'releaseId':'release','nginx_image_id':'pinned'},{'/verified/web'},resume=True)
    row['Image']='pinned'
    with pytest.raises(ValueError,match='RUNNING_WEB_MOUNT_CHANGED'):m.inspect_web(Docker(),{'releaseId':'release','nginx_image_id':'pinned'},{'/verified/web'},resume=True)
