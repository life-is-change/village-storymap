import datetime as dt
import importlib.util
from pathlib import Path
import pytest
from unittest.mock import patch
import subprocess

ROOT=Path(__file__).resolve().parents[2]


def module():
    path=ROOT/'linux/scripts/autonomous_tls.py'
    assert path.is_file(),'fixed-IP TLS helper is missing'
    spec=importlib.util.spec_from_file_location('autonomous_tls_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def leaf():
    now=dt.datetime(2026,10,21,tzinfo=dt.timezone.utc)
    return now,{'subjectAltName':(('IP Address','8.148.248.237'),),'issuer':((('organizationName',"Let's Encrypt"),),),
                'notBefore':(now-dt.timedelta(hours=1)).strftime('%b %d %H:%M:%S %Y GMT'),'notAfter':(now+dt.timedelta(days=6)).strftime('%b %d %H:%M:%S %Y GMT')}


def test_exact_ip_san_trust_boundary_and_minimum_validity():
    m=module();now,cert=leaf();assert m.validate_leaf(cert,now=now)['remaining_hours']==144
    for patch in [{'subjectAltName':(('DNS','8.148.248.237'),)},{'subjectAltName':(('IP Address','8.148.248.238'),)},
                  {'issuer':((('organizationName','(STAGING) Pretend CA'),),)},
                  {'notAfter':(now+dt.timedelta(hours=2)).strftime('%b %d %H:%M:%S %Y GMT')}]:
        with pytest.raises(ValueError):m.validate_leaf({**cert,**patch},now=now)
    for value in ['http://8.148.248.237','https://8.148.248.238','https://8.148.248.237/other','https://example.test']:
        with pytest.raises(ValueError):m.approved_origin(value)


def test_certificate_install_is_atomic_and_reload_failure_restores_previous_directory(tmp_path):
    m=module();root=tmp_path/'tls';root.mkdir(mode=0o700);version=root/'versions';version.mkdir(mode=0o700)
    old=version/'old';old.mkdir(mode=0o700)
    try:(root/'current').symlink_to('versions/old',target_is_directory=True)
    except OSError as error:
        if getattr(error,'winerror',None)==1314:pytest.skip('Windows lacks symlink privilege; POSIX rotation is required in Linux CI')
        raise
    calls=[]
    def reload():
        calls.append((root/'current').resolve().name)
        if len(calls)==1:raise RuntimeError('fixture reload failed')
    with pytest.raises(RuntimeError):m.atomic_certificate(root,fullchain=b'fixture cert',private_key=b'fixture private key',reload=reload)
    assert (root/'current').resolve()==old
    assert calls[-1]=='old'
    assert old.is_dir()


def test_webroot_certbot_has_no_standalone_stop_or_untrusted_production_install(tmp_path):
    m=module();image='certbot/certbot@sha256:'+'a'*64
    command=m.certbot_command(image,tmp_path/'state',tmp_path/'public',uid=1000,gid=1000,mode='staging')
    assert '--webroot' in command and '--ip-address' in command and '--staging' in command
    assert '--preferred-profile' in command and 'shortlived' in command
    assert '--standalone' not in command and '--nginx' not in command and 'stop' not in command
    assert '1000:1000' in command
    production=m.certbot_command(image,tmp_path/'state',tmp_path/'public',uid=1000,gid=1000,mode='issue')
    assert '--staging' not in production
    with pytest.raises(ValueError):m.certbot_command('untrusted/certbot:latest',tmp_path,tmp_path,uid=1000,gid=1000,mode='issue')


def test_proxy_keeps_auth_internal_secrets_and_private_files_off_the_public_routes():
    module();text=(ROOT/'linux/nginx.autonomous.conf').read_text('utf-8')
    assert 'location ^~ /.well-known/acme-challenge/' in text
    assert 'proxy_pass http://auth:9999/;' in text
    assert 'location ^~ /auth/v1/admin' in text
    assert 'location ^~ /api/worker/v1/' in text
    assert 'ssl_session_tickets off' in text
    assert 'proxy_request_buffering off' in text
    assert 'privkey.pem' in text and 'fullchain.pem' in text
    assert 'supabase.co' not in text and 'api_key' not in text.lower()


def test_certificate_chain_and_key_are_verified_before_rotation(tmp_path):
    m=module();now,cert=leaf();root=tmp_path/'private';root.mkdir(mode=0o700)
    chain=root/'fullchain.pem';key=root/'privkey.pem'
    for p in [chain,key]:p.write_bytes(b'fixture');p.chmod(0o600)
    calls=[]
    def run(command,**kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command,0,stdout=b'PUBLIC KEY\n')
    with patch.object(m.subprocess,'run',side_effect=run),patch.object(m.ssl._ssl,'_test_decode_cert',return_value=cert):
        assert m.verify_certificate_pair(chain,key,now=now)['ip']==m.IP
    assert any('verify' in c and '-verify_ip' in c and m.IP in c for c in calls)
    with patch.object(m.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['openssl'])):
        with pytest.raises(ValueError,match='CERTIFICATE_CHAIN_OR_KEY_INVALID'):m.verify_certificate_pair(chain,key,now=now)


def test_certbot_symlink_must_resolve_inside_the_matching_private_archive(tmp_path):
    m=module();root=tmp_path/'certbot-production'/'config';root.mkdir(parents=True,mode=0o700)
    live=root/'live'/m.IP;archive=root/'archive'/m.IP
    live.mkdir(parents=True,mode=0o700);archive.mkdir(parents=True,mode=0o700)
    for kind in ['fullchain','privkey']:
        p=archive/(kind+'1.pem');p.write_bytes(b'fixture');p.chmod(0o600)
        try:(live/(kind+'.pem')).symlink_to(p)
        except OSError as error:
            if getattr(error,'winerror',None)==1314:pytest.skip('POSIX Certbot paths checked in Linux CI')
            raise
    assert m.certbot_material(root)==(archive/'fullchain1.pem',archive/'privkey1.pem')
    (live/'privkey.pem').unlink();(live/'privkey.pem').symlink_to(archive/'fullchain1.pem')
    with pytest.raises(ValueError):m.certbot_material(root)


def test_acme_patch_is_idempotent_and_refuses_proxy_or_multiple_servers():
    m=module();before='events {}\nhttp { server { listen 8080; root /usr/share/nginx/html; location / { try_files $uri =404; } } }\n'
    after=m.add_legacy_acme_location(before)
    assert 'location ^~ /.well-known/acme-challenge/' in after
    assert m.add_legacy_acme_location(after)==after
    for bad in [before.replace('try_files $uri =404','proxy_pass http://other'),before.replace('server {','server {} server {'),before.replace('/usr/share/nginx/html','/private')]:
        with pytest.raises(ValueError):m.add_legacy_acme_location(bad)


def test_renewal_units_run_as_operator_and_do_not_embed_secrets_or_mutable_repository():
    m=module();service,timer=m.renewal_units('admin')
    assert 'User=admin' in service and '/home/admin/village-autonomous/control/prepare-ip-tls.py --renew' in service
    assert 'OnUnitActiveSec=6h' in timer and 'Persistent=true' in timer
    assert 'password' not in service.lower() and 'village-deploy' not in service
    with pytest.raises(ValueError):m.renewal_units('root')
