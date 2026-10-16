#!/usr/bin/env python3
"""Hidden-input login probe for the loopback-only business API."""
import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

S=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('api_deployment',S/'deploy-business-api-validation.py')
deploy=importlib.util.module_from_spec(s);s.loader.exec_module(deploy)
ORIGIN='https://rzmbmwauomzwiyenafha.supabase.co'
class ProbeFailure(RuntimeError):
    """Only fixed stage/category names and an HTTP status may leave the probe."""
    def __init__(self,phase,category,http_status=None):
        if phase not in ('auth_login','api_me','api_courses','api_group_spaces','api_personal_spaces') or category not in ('http','network','tls','response'):
            raise ValueError('Invalid probe diagnostic.')
        if http_status is not None and (type(http_status) is not int or not 100<=http_status<=599):
            raise ValueError('Invalid HTTP status.')
        super().__init__('PROBE_FAILED phase='+phase+' category='+category+
                         (f' http_status={http_status}' if http_status is not None else ''))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Redirects are not accepted.')
def validate_api_url(value):
    u=urllib.parse.urlsplit(value)
    if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost','::1') or u.username or u.password or u.query or u.fragment or u.path not in ('','/') or u.port is None or not 1024<=u.port<=65535:
        raise ValueError('Use an explicit loopback HTTP API port, optionally forwarded over SSH.')
    return value.rstrip('/')
def perform_probe(api_url,student,password,opener=None):
    base=validate_api_url(api_url);student=student.strip().lower()
    if not re.fullmatch('[a-z0-9_-]{2,32}',student) or not password:raise ValueError('Invalid student ID or empty website password.')
    opener=opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
    def request(url,headers=None,data=None):
        r=urllib.request.Request(url,headers=headers or {},data=data)
        with opener.open(r,timeout=10) as response:
            raw=response.read(1024*1024+1)
            if len(raw)>1024*1024:raise ValueError('Response too large.')
            return json.loads(raw)
    started=time.monotonic();phase='auth_login'
    try:
        auth=request(ORIGIN+'/auth/v1/token?grant_type=password',{'apikey':deploy.read_public_key(),'Content-Type':'application/json'},json.dumps({'email':'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co','password':password}).encode())
        token=auth['access_token'];uid=auth['user']['id'];auth_ms=round((time.monotonic()-started)*1000)
        headers={'Authorization':'Bearer '+token};t=time.monotonic();phase='api_me'
        me=request(base+'/api/v1/me',headers)['data']
        if me['id']!=uid:raise ValueError('Identity mismatch.')
        counts={}
        for key,path in [('courses','/courses'),('group_spaces','/spaces?kind=group'),('personal_spaces','/spaces?kind=personal')]:
            phase='api_'+key
            rows=request(base+'/api/v1'+path,headers)['data']
            if not isinstance(rows,list):raise ValueError('Invalid API response.')
            counts[key]=len(rows)
        # Deliberately avoid returning identity, tokens, profile fields or password.
        return {'status':'authenticated_read_probe_passed','counts':counts,'auth_ms':auth_ms,'read_routes_ms':round((time.monotonic()-t)*1000)}
    except urllib.error.HTTPError as error:
        raise ProbeFailure(phase,'http',error.code) from None
    except (OSError,ValueError,KeyError,TypeError) as error:
        reason=error.reason if isinstance(error,urllib.error.URLError) else error
        category='tls' if isinstance(reason,ssl.SSLError) else 'network' if isinstance(error,OSError) else 'response'
        raise ProbeFailure(phase,category) from None
def acceptance_ready(verification,checkpoint,probe,*,attempt=None,runtime_fingerprint=None):
    attempt=attempt or {}
    if (verification.get('status')!='permissions_restart_verified' or probe.get('status')!='authenticated_read_probe_passed'
        or not checkpoint.get('source_archive_sha256') or not checkpoint.get('api_image_id')
        or any(verification.get(k)!=checkpoint[k] for k in ('source_archive_sha256','api_image_id'))
        or attempt.get('status')!='passed' or not attempt.get('attempt_id')
        or verification.get('attempt_id')!=attempt['attempt_id']
        or not runtime_fingerprint or verification.get('runtime_fingerprint')!=runtime_fingerprint
        or not isinstance(attempt.get('started_at'),(int,float))
        or not 0<=time.time()-attempt['started_at']<=3600):
        raise ValueError('Matching candidate permission/restart proof and login probe are both required.')
    return True

def acceptance_report(probe,verification):
    return {**probe,'probe_status':probe['status'],'status':'internal_validated_not_cut_over','verification_attempt_id':verification['attempt_id']}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--api-url',default='http://127.0.0.1:18080');a=p.parse_args();os.umask(0o077)
    try:
        validate_api_url(a.api_url)
        student=input('Website student ID (not database username): ')
        password=getpass.getpass('Website LOGIN password (hidden; not database password): ')
        probe=perform_probe(a.api_url,student,password);password=None
        print(json.dumps(probe))
        state=Path.home()/'village-api-validation'
        if sys.platform=='linux' and a.api_url=='http://127.0.0.1:18080':
            checkpoint=json.loads(deploy.private_file(state/'deployment-checkpoint.json').read_text())
            verification=json.loads(deploy.private_file(state/'candidate-verification.json').read_text())
            attempt=json.loads(deploy.private_file(state/'verification-attempt.json').read_text())
            backup=json.loads(deploy.private_file(state/'runtime-compose.json').read_text())['services']['db']['volumes'][-1]['source']
            fingerprint=deploy.runtime_fingerprint(deploy.rd.LocalDocker(state,target=deploy.TARGET),state,Path(backup))
            acceptance_ready(verification,checkpoint,probe,attempt=attempt,runtime_fingerprint=fingerprint)
            (state/'api-acceptance.json').write_text(json.dumps(acceptance_report(probe,verification),indent=2)+'\n')
            print('BUSINESS_API_INTERNAL_VALIDATED_NOT_CUT_OVER')
        else:print('LOGIN_READ_PROBE_PASSED - run server-side candidate acceptance before claiming complete validation.')
        return 0
    except ProbeFailure as error:
        print('STOP: '+str(error)+'. Do not paste credentials, tokens or private rows. No complete acceptance marker.',file=sys.stderr);return 1
    except (ValueError,RuntimeError,OSError,KeyError):
        print('STOP: probe or candidate proof failed; do not paste credentials, tokens or private rows. No complete acceptance marker.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
