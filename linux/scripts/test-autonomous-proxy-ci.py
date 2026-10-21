#!/usr/bin/env python3
"""Disposable CI only: actual pinned nginx/Certbot, fixture certificates/upstreams.

This never requests a CA certificate, starts PostgreSQL or runs ML/provider jobs.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import time
import autonomous_tls as tls

ROOT=Path(__file__).resolve().parents[2]
NETWORK='village-autonomous-proxy-ci'
WEB='village-autonomous-proxy-ci'
UPSTREAM='village-autonomous-upstreams-ci'


def run(*args):
    try:return subprocess.run(list(args),check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120).stdout
    except subprocess.SubprocessError:raise RuntimeError('DISPOSABLE_PROXY_PROCESS_FAILED') from None


def docker(*args):return run('docker','--context','default',*args)


def fixture_certificate(root,name):
    cert=root/(name+'.pem');key=root/(name+'.key')
    run('openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','1','-subj','/CN=disposable-ci-only',
        '-addext','subjectAltName=IP:'+tls.IP,'-keyout',str(key),'-out',str(cert))
    for path in (cert,key):path.chmod(0o600)
    return cert,key


def request(path,*,certificate=None):
    port=18443 if certificate else 18086
    connection=socket.create_connection(('127.0.0.1',port),timeout=5)
    secure=ssl.create_default_context(cafile=str(certificate)).wrap_socket(connection,server_hostname=tls.IP) if certificate else connection
    try:
        secure.sendall(('GET '+path+' HTTP/1.1\r\nHost: '+tls.IP+'\r\nConnection: close\r\n\r\n').encode())
        reply=http.client.HTTPResponse(secure);reply.begin();body=reply.read(32769)
        if len(body)>32768:raise ValueError('DISPOSABLE_RESPONSE_TOO_LARGE')
        fingerprint=hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest() if certificate else None
        return reply.status,body,fingerprint
    finally:secure.close()


def main():
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('VILLAGE_TEST_PROXY_RUNTIME')!='1':
        raise SystemExit('DISPOSABLE_GITHUB_PROXY_RUNTIME_REQUIRED')
    if run('docker','--context','default','context','inspect','default','--format','{{.Endpoints.docker.Host}}').strip()!=b'unix:///var/run/docker.sock':
        raise SystemExit('DISPOSABLE_LOCAL_ENGINE_REQUIRED')
    nginx=json.loads((ROOT/'linux/nginx-runtime.json').read_text())
    certbot=json.loads((ROOT/'linux/certbot-runtime.json').read_text())
    for meta in (nginx,certbot):
        docker('pull',meta['image'])
        obj=json.loads(docker('image','inspect',meta['image']))[0]
        if (obj['Id'],obj['Os'],obj['Architecture'])!=(meta['image_id'],'linux','amd64'):raise ValueError('PINNED_CI_IMAGE_DIFFERS')
    if b'certbot 5.4.0' not in docker('run','--rm','--network','none',certbot['image'],'--version'):raise ValueError('CERTBOT_VERSION_DIFFERS')
    help_text=docker('run','--rm','--network','none',certbot['image'],'--help','all')
    if not all(flag in help_text for flag in (b'--ip-address',b'--preferred-profile',b'--webroot-path')):raise ValueError('IP_CERTBOT_FLAGS_UNSUPPORTED')
    with tempfile.TemporaryDirectory(prefix='village-proxy-ci-') as directory:
        root=Path(directory);root.chmod(0o700)
        for name in ('tls','web','acme'):(root/name).mkdir(mode=0o700)
        challenge=root/'acme/.well-known/acme-challenge';challenge.mkdir(parents=True);(challenge/'fixture').write_text('fixture-acme')
        (root/'web/index.html').write_text('autonomous fixture')
        (root/'web/deployment-config.js').write_text('fixture deployment')
        (root/'nginx.conf').write_text((ROOT/'linux/nginx.autonomous.conf').read_text())
        (root/'upstreams.conf').write_text('pid /tmp/nginx.pid; error_log /dev/stderr warn; events {} http { access_log off; server { listen 8080; location / { default_type application/json; return 401 \'{"fixture":"api"}\'; } } server { listen 9999; location = /health { return 200 "fixture-auth"; } location / { return 401; } } }')
        first,first_key=fixture_certificate(root,'first');second,second_key=fixture_certificate(root,'second')
        tls.atomic_certificate(root/'tls',fullchain=first.read_bytes(),private_key=first_key.read_bytes(),reload=lambda:None)
        docker('network','create','--internal',NETWORK)
        try:
            common=['--detach','--pull=never','--network',NETWORK,'--user',f'{os.geteuid()}:{os.getegid()}',
                '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--tmpfs','/tmp:size=16m,mode=1777','--entrypoint','/usr/sbin/nginx']
            docker('run',*common,'--name',UPSTREAM,'--network-alias','api','--network-alias','auth',
                '--mount',f'type=bind,source={root}/upstreams.conf,target=/etc/nginx/nginx.conf,readonly',nginx['image_id'],'-g','daemon off;')
            mounts=[]
            for source,target in [('web','/srv/village-web'),('tls','/run/tls'),('acme','/srv/acme'),('nginx.conf','/etc/nginx/nginx.conf')]:
                mounts+=['--mount',f'type=bind,source={root/source},target={target},readonly']
            docker('run',*common,'--name',WEB,'-p','127.0.0.1:18086:8080','-p','127.0.0.1:18443:8443',*mounts,nginx['image_id'],'-g','daemon off;')
            for attempt in range(50):
                try:
                    if request('/',certificate=first)[:2]==(200,b'autonomous fixture'):break
                except (OSError,ssl.SSLError):pass
                time.sleep(.1)
            else:
                # These containers contain synthetic upstreams/certificates
                # only. Capture startup diagnostics before the exact-name CI
                # cleanup; production operator code never prints logs.
                for name in (WEB,UPSTREAM):
                    result=subprocess.run(['docker','--context','default','logs','--tail','15',name],capture_output=True,text=True,timeout=10)
                    print('FIXTURE_CONTAINER_STARTUP '+name+' '+(result.stdout+result.stderr)[-3000:])
                raise ValueError('DISPOSABLE_PROXY_NOT_READY')
            assert request('/.well-known/acme-challenge/fixture')[:2]==(200,b'fixture-acme')
            assert request('/')[0]==308
            for path,status in [('/auth/v1/health',200),('/auth/v1/admin/users',404),('/api/v1/me',401),('/.git/config',403),('/business-api/package.json',404)]:
                assert request(path,certificate=first)[0]==status,path
            def reload():
                docker('exec',WEB,'/usr/sbin/nginx','-t');docker('exec',WEB,'/usr/sbin/nginx','-s','reload')
            tls.atomic_certificate(root/'tls',fullchain=second.read_bytes(),private_key=second_key.read_bytes(),reload=reload)
            for attempt in range(50):
                try:
                    if request('/',certificate=second)[0]==200:break
                except ssl.SSLError:pass
                time.sleep(.1)
            else:raise ValueError('DISPOSABLE_TLS_ROTATION_NOT_VISIBLE')
            print('AUTONOMOUS_PROXY_CERTBOT_FIXTURE_VERIFIED_NOT_PUBLIC_CA_OR_DEPLOYMENT')
        finally:
            # Exact CI-only names on a disposable runner; no production paths.
            for name in (WEB,UPSTREAM):subprocess.run(['docker','--context','default','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            subprocess.run(['docker','--context','default','network','rm',NETWORK],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


if __name__=='__main__':main()
