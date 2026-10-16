#!/usr/bin/env python3
"""Hidden website login and actual private-file verification against loopback B2."""
import argparse
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import warnings

S=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('storage_probe_deploy',S/'deploy-storage-read-validation.py')
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
BASE='http://127.0.0.1:18081'
ORIGIN='https://rzmbmwauomzwiyenafha.supabase.co'
class ProbeFailure(RuntimeError):
    def __init__(self,phase):
        if phase not in ('auth','identity','unauthenticated','download','head','range','coverage','acceptance'):raise ValueError('Invalid diagnostic')
        super().__init__('STORAGE_READ_PROBE_FAILED phase='+phase)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):raise ValueError('Redirect refused')

def perform_probe(index,student,password,opener=None):
    opener=opener or urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())
    student=student.strip().lower();phase='auth'
    def response(path,headers=None,method='GET',expected=200,data=None):
        r=opener.open(urllib.request.Request(path,headers=headers or {},method=method,data=data),timeout=30)
        if r.status!=expected:r.close();raise ValueError('Status differs')
        return r
    def body_json(r):
        with r:
            b=r.read(1024*1024+1)
            if len(b)>1024*1024:raise ValueError('Large JSON response')
            return json.loads(b)
    try:
        if not re.fullmatch('[a-z0-9_-]{2,32}',student) or not password:raise ValueError('Invalid input')
        auth=body_json(response(ORIGIN+'/auth/v1/token?grant_type=password',{'apikey':deploy.deploy.read_public_key(),'Content-Type':'application/json'},method='POST',data=json.dumps({'email':'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co','password':password}).encode()))
        token=auth['access_token'];headers={'Authorization':'Bearer '+token}
        phase='identity';me=body_json(response(BASE+'/api/v1/me',headers))['data']
        if me['id']!=auth['user']['id']:raise ValueError('Identity mismatch')
        objects=index['objects']
        if not objects:raise ValueError('No selected objects')
        phase='unauthenticated'
        for h in ({},{'Authorization':'Bearer invalid'}):
            try:
                r=response(BASE+'/api/v1/files/'+objects[0]['id'],h);r.close();raise ValueError('Unauthenticated read accepted')
            except urllib.error.HTTPError as e:
                if e.code!=401:e.close();raise ValueError('Unexpected auth status') from None
                e.close()
        readable=denied=verified_bytes=0;buckets={}
        for o in objects:
            phase='download';url=BASE+'/api/v1/files/'+o['id']
            try:r=response(url,headers)
            except urllib.error.HTTPError as e:
                if e.code!=404:e.close();raise
                if e.headers.get('ETag') is not None:e.close();raise ValueError('Hidden object metadata leaked')
                e.close();denied+=1;continue
            count=0;h=hashlib.sha256();prefix=b''
            with r:
                if r.headers.get('Cache-Control')!='no-store' or r.headers.get('ETag')!='"sha256-'+o['sha256']+'"':raise ValueError('File identity/cache differs')
                for block in iter(lambda:r.read(65536),b''):
                    count+=len(block)
                    if count>o['size']:raise ValueError('Oversized download')
                    if len(prefix)<32:prefix=(prefix+block)[:32]
                    h.update(block)
            if count!=o['size'] or h.hexdigest()!=o['sha256']:raise ValueError('Byte integrity differs')
            phase='head'
            with response(url,headers,method='HEAD') as r:
                if r.headers.get('Content-Length')!=str(count) or r.headers.get('ETag')!='"sha256-'+o['sha256']+'"' or r.read(1):raise ValueError('HEAD differs')
            phase='range'
            if count:
                end=min(31,count-1)
                with response(url,{**headers,'Range':f'bytes=0-{end}'},expected=206) as r:
                    if r.headers.get('Content-Range')!=f'bytes 0-{end}/{count}' or r.read(33)!=prefix:raise ValueError('Range differs')
            else:
                try:r=response(url,{**headers,'Range':'bytes=0-0'});r.close();raise ValueError('Empty range accepted')
                except urllib.error.HTTPError as e:
                    if e.code!=416:e.close();raise ValueError('Empty range differs') from None
                    e.close()
            readable+=1;verified_bytes+=count;buckets[o['bucket']]=buckets.get(o['bucket'],0)+1
        phase='coverage'
        if not readable or (me.get('role')=='admin' and denied):raise ValueError('Insufficient readable coverage')
        return {'status':'authenticated_files_probe_passed','selected':len(objects),'readable':readable,'denied':denied,'verified_bytes':verified_bytes,'readable_by_bucket':buckets}
    except (ValueError,OSError,KeyError,TypeError):raise ProbeFailure(phase) from None

def acceptance_ready(proof,fingerprint,*,now=None):
    now=time.time() if now is None else now
    if (proof.get('status')!='restart_verified' or not proof.get('attempt_id') or proof.get('runtime_fingerprint')!=fingerprint
        or type(proof.get('verified_at')) not in (int,float) or not 0<=now-proof['verified_at']<=3600):
        raise ValueError('Require a matching recent restart proof')
    return True

def main():
    argparse.ArgumentParser(description=__doc__).parse_args();os.umask(0o077)
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Use normal admin Linux terminal')
        docker=deploy.deploy.rd.LocalDocker(deploy.STATE,target=deploy.deploy.TARGET)
        fingerprint=deploy.runtime_fingerprint(docker)
        proof=deploy.copy.read_private_json(deploy.STATE/'verification.json');acceptance_ready(proof,fingerprint)
        index=deploy.copy.read_private_json(deploy.STATE/'storage-index.json')
        # An unsuccessful retry must not leave an earlier success as current.
        path=deploy.STATE/'acceptance.json'
        if path.exists():deploy.copy.private_path(path).rename(deploy.STATE/('acceptance.previous-'+str(time.time_ns())+'.json'))
        student=input('Website student ID (not database username): ')
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            password=getpass.getpass('Website LOGIN password (hidden; NOT database password or Secret key): ')
        result=perform_probe(index,student,password);password=None
        current=deploy.runtime_fingerprint(docker);acceptance_ready(proof,current)
        report={**result,'status':'internal_files_validated_not_cut_over','verification_attempt_id':proof['attempt_id'],'runtime_fingerprint':current,'checked_at':time.time()}
        deploy.copy.write_private_json(path,report)
        print(json.dumps(result));print('STORAGE_READ_INTERNAL_VALIDATED_NOT_CUT_OVER');return 0
    except ProbeFailure as e:
        print('STOP: '+str(e)+'. Do not send credentials, tokens, file names or private data.',file=sys.stderr);return 1
    except (ValueError,RuntimeError,OSError,KeyError,TypeError,getpass.GetPassWarning):
        print('STOP: storage file probe not accepted; retain private state. Never paste credentials or private reports.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
