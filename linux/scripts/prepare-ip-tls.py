#!/usr/bin/env python3
"""Prepare production IP TLS without stopping the old static website."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import urllib.request
import time
import subprocess
import autonomous_tls as tls
import business_storage_copy as storage
from autonomous_operator import Docker,WEB,resolve_image

LEGACY_IMAGES={'sha256:8d9379beb74336a1c62c8237ea56d4f2a573119b9ffd0997714331bb32aa0cca'}
OLD_WEB='village-web-web-1'


def legacy_static_paths(obj,base):
    base=storage.no_links(base)
    if obj.get('Name')!='/'+OLD_WEB or obj.get('Image') not in LEGACY_IMAGES or not obj.get('State',{}).get('Running'):
        raise ValueError('KNOWN_RUNNING_STATIC_WEB_REQUIRED')
    ports=obj.get('HostConfig',{}).get('PortBindings') or {}
    if set(ports)!={'8080/tcp'} or not ports['8080/tcp'] or any(p.get('HostPort')!='80' or p.get('HostIp') not in ('','0.0.0.0','::') for p in ports['8080/tcp']):
        raise ValueError('KNOWN_STATIC_PORT_REQUIRED')
    # Docker Compose's default publish address is stored as an empty HostIp;
    # inspect the running bindings rather than treating that as an explicit IP.
    if any(p.get('HostIp')=='' for p in ports['8080/tcp']):
        actual=obj.get('NetworkSettings',{}).get('Ports') or {}
        if set(actual)!={'8080/tcp'} or not actual['8080/tcp'] or any(p.get('HostPort')!='80' or p.get('HostIp') not in ('0.0.0.0','::') for p in actual['8080/tcp']):
            raise ValueError('KNOWN_STATIC_PORT_REQUIRED')
    mounts={m['Destination']:m for m in obj.get('Mounts',[])}
    for target,source in [('/usr/share/nginx/html',base/'public'),('/etc/nginx/nginx.conf',base/'nginx.conf')]:
        mount=mounts.get(target,{})
        if mount.get('Type')!='bind' or mount.get('RW') is not False or storage.no_links(mount.get('Source',''))!=source or not source.exists():
            raise ValueError('KNOWN_STATIC_BIND_PATHS_REQUIRED')
    return base/'nginx.conf',base/'public'


def install_legacy_acme(docker,state,config):
    config=storage.no_links(config);st=config.stat()
    if not config.is_file() or st.st_nlink!=1 or st.st_size>65536 or os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&0o022):
        raise ValueError('KNOWN_STATIC_CONFIG_REQUIRED')
    before=config.read_text(encoding='utf-8');after=tls.add_legacy_acme_location(before)
    if before==after:return
    tls._write(Path(state)/('legacy-nginx-'+secrets.token_hex(12)+'.conf'),before.encode())
    def write(value):
        # This is the existing single-file bind mount. Preserve its inode so
        # nginx sees the new bytes; certificate rotation uses a directory mount.
        fd=os.open(config,os.O_WRONLY|getattr(os,'O_NOFOLLOW',0))
        with os.fdopen(fd,'r+b') as stream:
            if os.fstat(stream.fileno()).st_ino!=st.st_ino:raise ValueError('STATIC_CONFIG_REPLACED')
            stream.seek(0);stream.write(value.encode());stream.truncate();stream.flush();os.fsync(stream.fileno())
    write(after)
    try:
        docker.run('exec',OLD_WEB,'/usr/sbin/nginx','-t')
        docker.run('exec',OLD_WEB,'/usr/sbin/nginx','-s','reload')
    except Exception:
        write(before)
        try:
            docker.run('exec',OLD_WEB,'/usr/sbin/nginx','-t')
            docker.run('exec',OLD_WEB,'/usr/sbin/nginx','-s','reload')
        except Exception:raise RuntimeError('ACME_CONFIG_ROLLBACK_RELOAD_FAILED') from None
        raise RuntimeError('ACME_CONFIG_RELOAD_FAILED_OLD_CONFIG_RESTORED') from None


def tls_loopback(port):
    context=ssl.create_default_context()
    with socket.create_connection(('127.0.0.1',port),timeout=10) as connection,context.wrap_socket(connection,server_hostname=tls.IP) as secure:
        proof=tls.validate_leaf(secure.getpeercert());proof['peer_sha256']=hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest()
        secure.sendall(('HEAD / HTTP/1.1\r\nHost: '+tls.IP+'\r\nConnection: close\r\n\r\n').encode())
        reply=secure.recv(4096)
        if not reply.startswith(b'HTTP/1.1 200 '):raise ValueError('TLS_WEB_HEALTH_FAILED')
        return proof


def reload_autonomous(docker,meta,*,expected_peer=None):
    if expected_peer is not None and not re.fullmatch('[a-f0-9]{64}',expected_peer):raise ValueError('EXPECTED_TLS_PEER_REQUIRED')
    obj=docker.own_container(WEB,meta['releaseId'])
    if obj.get('Image')!=meta.get('nginx_image_id') or not obj.get('State',{}).get('Running'):
        raise ValueError('VERIFIED_AUTONOMOUS_NGINX_REQUIRED')
    ports=obj.get('HostConfig',{}).get('PortBindings') or {};binds=ports.get('8443/tcp') or []
    if len(binds)!=1 or binds[0].get('HostPort') not in ('18443','443'):raise ValueError('FIXED_TLS_PORT_REQUIRED')
    if binds[0].get('HostPort')=='18443' and binds[0].get('HostIp')!='127.0.0.1':raise ValueError('PRIVATE_CANDIDATE_TLS_REQUIRED')
    docker.run('exec',WEB,'/usr/sbin/nginx','-t')
    docker.run('exec',WEB,'/usr/sbin/nginx','-s','reload')
    deadline=time.monotonic()+15
    for attempt in range(20):
        proof=tls_loopback(int(binds[0]['HostPort']))
        if expected_peer is None or proof['peer_sha256']==expected_peer:return proof
        if time.monotonic()>deadline:break
        time.sleep(.1)
    raise ValueError('NEW_CERTIFICATE_NOT_SERVED')


def should_install(mode):return mode in ('issue','renew')


def current_peer(root):
    root=tls._directory(root);link=root/'current'
    if not link.is_symlink():raise ValueError('CONTROLLED_CURRENT_TLS_REQUIRED')
    current=link.resolve(strict=True)
    if current.parent!=root/'versions':raise ValueError('CONTROLLED_CURRENT_TLS_REQUIRED')
    chain=tls._private_file(current/'fullchain.pem',private=False)
    first=re.search(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',chain.read_text(),re.S)
    if not first:raise ValueError('LEAF_CERTIFICATE_REQUIRED')
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(first.group(0))).hexdigest()


def reload_current(docker,meta,root):
    # Re-evaluate after an atomic rollback as well as the first rotation.
    # Capturing the new certificate's digest would reject a successful old-cert
    # rollback and incorrectly report the recovery itself as failed.
    return reload_autonomous(docker,meta,expected_peer=current_peer(root))


def verify_acme_webroot(root,*,port=80):
    root=storage.no_links(root);directory=root/'.well-known'/'acme-challenge'
    # These are public challenge paths, not private operator/key directories.
    # mkdir/open modes are otherwise reduced to700/600 by the operator umask.
    for folder in (root/'.well-known',directory):
        folder.mkdir(exist_ok=True,mode=0o755);storage.no_links(folder)
        if not folder.is_dir() or os.name=='posix' and folder.stat().st_uid!=os.geteuid():raise ValueError('ACME_DIRECTORY_OWNER_REQUIRED')
        folder.chmod(0o755)
    name='village-check-'+secrets.token_hex(20);path=directory/name;value=secrets.token_hex(32).encode()
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644),'wb') as stream:
        path.chmod(0o644);stream.write(value)
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),storage.NoRedirect())
        request=urllib.request.Request(f'http://127.0.0.1:{port}/.well-known/acme-challenge/'+name,headers={'Host':tls.IP})
        with opener.open(request,timeout=10) as response:
            if response.status!=200 or response.read(1024)!=value:raise ValueError('ACME_WEBROOT_NOT_SERVED')
    finally:path.unlink()


def certbot_metadata():
    sibling=Path(__file__).with_name('certbot-runtime.json')
    return json.loads((sibling if sibling.is_file() else Path(__file__).resolve().parents[1]/'certbot-runtime.json').read_text(encoding='utf-8'))


def install_timer(state,user,*,units=Path('/etc/systemd/system'),run=None):
    service,timer=tls.renewal_units(user)
    values={'village-autonomous-tls.service':service,'village-autonomous-tls.timer':timer}
    install_system_units(state,values,units=units,run=run)
    return {'installed':True,'interval_hours':6}


def install_system_units(state,values,*,units=Path('/etc/systemd/system'),run=None):
    state=storage.private_path(state,directory=True);units=storage.no_links(units)
    if not values or any(not re.fullmatch(r'village-autonomous-(tls|backup)\.(service|timer)',name) for name in values):raise ValueError('FIXED_SYSTEM_UNIT_REQUIRED')
    for name,value in values.items():
        path=units/name
        if path.is_symlink() or path.exists() and (not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>16384 or path.read_text()!=value):
            raise ValueError('EXISTING_TLS_SYSTEM_UNIT_DIFFERS')
    if run is None:
        def run(*args):
            log=state/('systemd-'+secrets.token_hex(10)+'.log')
            with os.fdopen(os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as errors:
                try:subprocess.run(['sudo','-n',*map(str,args)],check=True,stdout=subprocess.DEVNULL,stderr=errors,timeout=30)
                except subprocess.SubprocessError:raise RuntimeError('TLS_TIMER_INSTALL_FAILED') from None
    for name,value in values.items():
        source=state/('.'+name+'.install')
        if source.exists():
            if storage.private_path(source).read_text()!=value:raise ValueError('TLS_TIMER_INPUT_CHANGED')
        else:tls._write(source,value.encode())
        run('install','-o','root','-g','root','-m','0644','--',str(source),str(units/name))
    run('systemctl','daemon-reload')
    for name in values:
        if name.endswith('.timer'):run('systemctl','enable','--now',name)
    return {'installed':True}


@contextlib.contextmanager
def tls_lock(state):
    import fcntl
    path=Path(state)/'.tls-operation.lock'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        if os.fstat(fd).st_uid!=os.geteuid() or os.fstat(fd).st_nlink!=1 or os.fstat(fd).st_mode&0o077:raise ValueError('PRIVATE_TLS_LOCK_REQUIRED')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('TLS_OPERATION_ALREADY_RUNNING') from None
        yield
    finally:os.close(fd)


def perform(state,mode):
    state=storage.private_path(state,directory=True);docker=Docker(state);meta=certbot_metadata()
    meta['image_id']=resolve_image(docker,meta.get('accepted_image_ids',[meta['image_id']]))
    image=json.loads(docker.run('image','inspect',meta['image_id']))[0]
    if image.get('Id')!=meta['image_id'] or image.get('Os')!='linux' or image.get('Architecture')!='amd64':raise ValueError('CERTBOT_IMAGE_DIFFERS')
    live=(state/'release.json').exists()
    release=storage.read_private_json(state/'release.json') if live else None
    if live:
        obj=docker.own_container(WEB,release['releaseId'])
        if obj.get('Image')!=release.get('nginx_image_id'):raise ValueError('AUTONOMOUS_WEB_IMAGE_DIFFERS')
        webroot=state/'acme'
        webroot.mkdir(mode=0o700,exist_ok=True);storage.private_path(webroot,directory=True)
        ports=obj.get('HostConfig',{}).get('PortBindings') or {};http=ports.get('8080/tcp') or []
        if len(http)!=1 or http[0].get('HostPort') not in ('18086','80'):raise ValueError('FIXED_ACME_PORT_REQUIRED')
        port=int(http[0]['HostPort'])
    else:
        if mode in ('renew','renew-test'):raise ValueError('DEPLOYED_RENEWAL_TARGET_REQUIRED')
        config,webroot=legacy_static_paths(docker.inspect(OLD_WEB),Path.home()/'village-deploy');port=80
        if mode!='check':install_legacy_acme(docker,state,config)
    if mode!='check':verify_acme_webroot(webroot,port=port)
    for name in ('certbot-staging','certbot-production'):
        for item in ('config','work','logs'):
            p=state/name/item;p.mkdir(parents=True,mode=0o700,exist_ok=True);storage.private_path(p,directory=True)
    command=tls.certbot_command(meta['image'],state,webroot,uid=os.geteuid(),gid=os.getegid(),mode='version' if mode=='check' else mode)
    # Offline docker load may not retain registry RepoDigests. The exact config
    # image ID was validated above; never fall back to a floating tag or pull.
    command[command.index(meta['image'])]=meta['image_id']
    output=docker.run(*command,timeout=600)
    if mode=='check':
        if re.search(r'certbot\s+5\.4\.0\b',output) is None:raise ValueError('PINNED_CERTBOT_VERSION_REQUIRED')
        return {'status':'tls_prerequisites_checked_not_issued'}
    if not should_install(mode):
        if mode=='renew-test':reload_autonomous(docker,release)
        return {'status':'staging_or_renewal_dry_run_passed_not_installed'}
    chain,key=tls.certbot_material(state/'certbot-production'/'config');proof=tls.verify_certificate_pair(chain,key)
    root=state/'tls';root.mkdir(mode=0o700,exist_ok=True)
    result=tls.atomic_certificate(root,fullchain=chain.read_bytes(),private_key=key.read_bytes(),
            reload=(lambda:reload_current(docker,release,root)) if live else lambda:None)
    storage.write_private_json(state/'tls-proof.json',{**result,**proof,'installed_at':storage.now(),'runtime_reloaded':live})
    return {'status':'production_ip_tls_reloaded' if live else 'production_ip_tls_prepared_not_serving','remaining_hours':proof['remaining_hours']}



def error_diagnostic(error):
    # Never print exception text from HTTP, TLS, Docker or filesystem errors.
    if isinstance(error,urllib.error.HTTPError):return {'category':'HTTP_ERROR','http_status':error.code}
    codes={'KNOWN_RUNNING_STATIC_WEB_REQUIRED','KNOWN_STATIC_PORT_REQUIRED','KNOWN_STATIC_BIND_PATHS_REQUIRED',
        'KNOWN_STATIC_CONFIG_REQUIRED','UNKNOWN_LEGACY_STATIC_CONFIGURATION','UNKNOWN_ACME_CONFIGURATION',
        'ACME_DIRECTORY_OWNER_REQUIRED','ACME_WEBROOT_NOT_SERVED','ACME_CONFIG_RELOAD_FAILED_OLD_CONFIG_RESTORED',
        'ACME_CONFIG_ROLLBACK_RELOAD_FAILED','DOCKER_OPERATION_FAILED','CERTBOT_IMAGE_DIFFERS','PINNED_RUNTIME_IMAGE_NOT_LOADED',
        'PINNED_CERTBOT_VERSION_REQUIRED','LOCAL_DOCKER_REQUIRED','PRIVATE_TLS_LOCK_REQUIRED','TLS_OPERATION_ALREADY_RUNNING'}
    code=str(error)
    return {'category':code if isinstance(error,(ValueError,RuntimeError)) and code in codes else type(error).__name__}


def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True)
    for flag in ('check','staging','issue','renew','renew-test'):group.add_argument('--'+flag,action='store_const',const=flag,dest='mode')
    args=parser.parse_args()
    try:
        if os.name!='posix' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077);state=Path.home()/'village-autonomous';state.mkdir(mode=0o700,exist_ok=True);storage.private_path(state,directory=True)
        with tls_lock(state):result=perform(state,args.mode)
        print(json.dumps(result));return 0
    except (OSError,ValueError,RuntimeError,ssl.SSLError) as error:
        print('STOP: IP_TLS_OPERATION_FAILED '+json.dumps(error_diagnostic(error))+'. Keep private logs and previous certificates; no database changes were made.');return 1


if __name__=='__main__':raise SystemExit(main())
