"""Fixed IP certificate policy and atomic private certificate rotation."""
import datetime as dt
import hashlib
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess

IP='8.148.248.237'
ORIGIN='https://'+IP


def approved_origin(value):
    if value not in (ORIGIN,ORIGIN+'/'):
        raise ValueError('APPROVED_HTTPS_IP_REQUIRED')
    return ORIGIN


def validate_leaf(cert,*,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    names=cert.get('subjectAltName',())
    if ('IP Address',IP) not in names or any(value!=IP for kind,value in names if kind in ('IP Address','DNS')):
        raise ValueError('EXACT_IP_SAN_REQUIRED')
    issuer=' '.join(str(v) for group in cert.get('issuer',()) for _key,v in group)
    if "Let's Encrypt" not in issuer or 'staging' in issuer.lower() or 'pretend' in issuer.lower():
        raise ValueError('PRODUCTION_IP_CERTIFICATE_REQUIRED')
    try:
        start=ssl.cert_time_to_seconds(cert['notBefore']);end=ssl.cert_time_to_seconds(cert['notAfter'])
        remaining=end-now.timestamp()
        if start>now.timestamp()+300 or remaining<12*3600 or end<=start:
            raise ValueError()
    except (KeyError,TypeError,ValueError):
        raise ValueError('CERTIFICATE_VALIDITY_REQUIRED') from None
    return {'ip':IP,'remaining_hours':int(remaining//3600),'expires_at':dt.datetime.fromtimestamp(end,dt.timezone.utc).isoformat()}


def _directory(path):
    path=Path(path).absolute()
    if any(p.is_symlink() for p in (path,*path.parents)):
        raise ValueError('LINKED_TLS_DIRECTORY')
    st=path.stat()
    if not path.is_dir() or os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&0o077):
        raise ValueError('PRIVATE_TLS_DIRECTORY_REQUIRED')
    return path


def _certbot_directory(path):
    path=Path(path).absolute()
    if any(p.is_symlink() for p in (path,*path.parents)):raise ValueError('LINKED_CERTBOT_DIRECTORY')
    st=path.stat()
    if not path.is_dir() or os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&0o022):raise ValueError('OPERATOR_CERTBOT_DIRECTORY_REQUIRED')
    return path


def _private_file(path,*,private=True):
    path=Path(path).absolute();_certbot_directory(path.parent)
    st=path.lstat()
    if path.is_symlink() or not path.is_file() or st.st_nlink!=1 or st.st_size>64*1024 or os.name=='posix' and (st.st_uid!=os.geteuid() or st.st_mode&(0o077 if private else 0o022)):
        raise ValueError('PRIVATE_CERTIFICATE_FILE_REQUIRED')
    return path


def certbot_material(config):
    config=_directory(config);archive=config/'archive'/IP;_certbot_directory(archive)
    live=config/'live'/IP;_certbot_directory(live)
    result=[]
    for kind in ('fullchain','privkey'):
        path=live/(kind+'.pem')
        if not path.is_symlink():raise ValueError('CONTROLLED_CERTBOT_LINK_REQUIRED')
        target=path.resolve(strict=True)
        if target.parent!=archive or not re.fullmatch(kind+r'[1-9][0-9]*\.pem',target.name):raise ValueError('CERTBOT_LINK_OUTSIDE_PRIVATE_ARCHIVE')
        result.append(_private_file(target,private=kind=='privkey'))
    return tuple(result)


def verify_certificate_pair(fullchain,private_key,*,now=None):
    chain=_private_file(fullchain,private=False);key=_private_file(private_key)
    # Issuer text alone is not a trust proof. OpenSSL uses the host trust store
    # and validates the IP before Python checks SAN and short-lived expiry.
    def openssl(*args):
        return subprocess.run(['openssl',*map(str,args)],check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15).stdout
    try:
        openssl('verify','-CAfile','/etc/ssl/certs/ca-certificates.crt','-purpose','sslserver','-verify_ip',IP,'-untrusted',chain,chain)
        public_cert=openssl('x509','-in',chain,'-pubkey','-noout')
        public_key=openssl('pkey','-in',key,'-passin','pass:','-pubout')
        if not public_cert.strip() or public_cert.strip()!=public_key.strip():raise ValueError()
        cert=ssl._ssl._test_decode_cert(str(chain))
    except (OSError,subprocess.SubprocessError,ValueError,ssl.SSLError):
        raise ValueError('CERTIFICATE_CHAIN_OR_KEY_INVALID') from None
    return validate_leaf(cert,now=now)


ACME_LOCATION='location ^~ /.well-known/acme-challenge/ { root /usr/share/nginx/html; default_type text/plain; try_files $uri =404; }'


def add_legacy_acme_location(before):
    # Only the known static baseline is eligible; a reverse proxy may carry
    # live writes and must never be treated as the old static deployment.
    without_mime=before.replace('include /etc/nginx/mime.types;','')
    if len(before)>65536 or any(word in without_mime for word in ('proxy_pass','fastcgi_pass','uwsgi_pass','grpc_pass','include','ssl_certificate')):
        raise ValueError('UNKNOWN_LEGACY_STATIC_CONFIGURATION')
    if len(re.findall(r'\bserver\s*\{',before))!=1 or len(re.findall(r'\blisten\s+8080\s*;',before))!=1:
        raise ValueError('UNKNOWN_LEGACY_STATIC_CONFIGURATION')
    if re.findall(r'\broot\s+([^;]+);',before) not in (['/usr/share/nginx/html'],['/usr/share/nginx/html','/usr/share/nginx/html']):
        raise ValueError('UNKNOWN_LEGACY_STATIC_CONFIGURATION')
    if '/.well-known/' in before:
        if before.count(ACME_LOCATION)!=1:raise ValueError('UNKNOWN_ACME_CONFIGURATION')
        return before
    return re.sub(r'\bserver\s*\{',lambda m:m.group(0)+'\n  '+ACME_LOCATION+'\n',before,count=1)


def renewal_units(user):
    if not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}',user) or user=='root':raise ValueError('NON_ROOT_OPERATOR_REQUIRED')
    service='\n'.join(['[Unit]','Description=Renew verified Village IP TLS certificate','After=docker.service network-online.target','Wants=network-online.target',
        '[Service]','Type=oneshot','User='+user,'Group='+user,'UMask=0077','WorkingDirectory=/home/'+user+'/village-autonomous',
        'ExecStart=/usr/bin/python3 /home/'+user+'/village-autonomous/control/prepare-ip-tls.py --renew','TimeoutStartSec=600',''])
    timer='\n'.join(['[Unit]','Description=Check short-lived Village IP certificate every six hours','[Timer]','OnBootSec=10m','OnUnitActiveSec=6h',
        'RandomizedDelaySec=20m','Persistent=true','Unit=village-autonomous-tls.service','[Install]','WantedBy=timers.target',''])
    return service,timer


def _sync(path):
    if os.name=='nt':return
    fd=os.open(path,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def _write(path,value):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600),'wb') as stream:
        stream.write(value);stream.flush();os.fsync(stream.fileno())


def atomic_certificate(root,*,fullchain,private_key,reload):
    """Call only after chain, SAN, expiry and key-pair validation.

    Nginx mounts the whole TLS directory, so replacing current is visible inside
    the container. Never bind-mount a single replaceable certificate inode.
    """
    root=_directory(root);versions=root/'versions'
    if not versions.exists():versions.mkdir(mode=0o700)
    _directory(versions)
    current=root/'current';previous=None
    if current.is_symlink():
        previous=os.readlink(current);resolved=current.resolve(strict=True)
        if resolved.parent!=versions or not resolved.is_dir():raise ValueError('TLS_CURRENT_OUTSIDE_VERSIONS')
        _directory(resolved)
    elif current.exists():raise ValueError('TLS_CURRENT_MUST_BE_CONTROLLED_LINK')
    version=versions/secrets.token_hex(16);version.mkdir(mode=0o700)
    _write(version/'fullchain.pem',fullchain);_write(version/'privkey.pem',private_key);_sync(version)
    replacement=root/('.current-'+secrets.token_hex(8));replacement.symlink_to('versions/'+version.name,target_is_directory=True)
    os.replace(replacement,current);_sync(root)
    try:reload()
    except Exception:
        if previous is None:
            current.unlink();_sync(root)
        else:
            replacement.symlink_to(previous,target_is_directory=True);os.replace(replacement,current);_sync(root)
            try:reload()
            except Exception:raise RuntimeError('TLS_ROLLBACK_RELOAD_FAILED') from None
        raise RuntimeError('TLS_RELOAD_FAILED_PREVIOUS_CERTIFICATE_RETAINED') from None
    return {'certificate_sha256':hashlib.sha256(fullchain).hexdigest(),'version':version.name}


def certbot_command(image,state,webroot,*,uid,gid,mode):
    if not re.fullmatch(r'certbot/certbot@sha256:[a-f0-9]{64}',image or '') or uid<=0 or gid<0 or mode not in ('staging','issue','renew','renew-test','version'):
        raise ValueError('PINNED_CERTBOT_REQUIRED')
    state,webroot=Path(state),Path(webroot)
    if not state.is_absolute() or not webroot.is_absolute():raise ValueError('ABSOLUTE_TLS_PATH_REQUIRED')
    config=state/('certbot-staging' if mode=='staging' else 'certbot-production')
    args=['run','--rm','--pull=never','--name','village-autonomous-certbot','--user',f'{uid}:{gid}','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','128','--memory','256m','--memory-swap','256m','--tmpfs','/tmp:size=32m,mode=1777']
    for source,target in [(config/'config','/etc/letsencrypt'),(config/'work','/var/lib/letsencrypt'),(config/'logs','/var/log/letsencrypt'),(webroot,'/webroot')]:
        args+=['--mount',f'type=bind,source={source},target={target}']
    args+=[image]
    if mode=='version':return args+['--version']
    common=['--non-interactive','--cert-name',IP]
    if mode in ('renew','renew-test'):
        return args+['renew',*common,*(['--dry-run'] if mode=='renew-test' else [])]
    return args+['certonly',*common,'--agree-tos','--register-unsafely-without-email','--preferred-profile','shortlived','--webroot','--webroot-path','/webroot','--ip-address',IP,*(['--staging'] if mode=='staging' else [])]
