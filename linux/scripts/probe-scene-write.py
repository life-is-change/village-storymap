#!/usr/bin/env python3
"""Hidden-login C1 write/version/restart probe. Creates retained TEST drafts only."""
import argparse
import copy
import getpass
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.request
import warnings

S=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('scene_probe_deploy',S/'deploy-scene-write-validation.py')
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
BASE='http://127.0.0.1:18082/api/v1/scene/'
ORIGIN='https://rzmbmwauomzwiyenafha.supabase.co'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Redirect refused')
class ContextFailure(ValueError):
    def __init__(self,code):
        if code not in ('ADMIN_PROFILE_REQUIRED','NO_VALID_SCENE_CONTEXT','CONTEXT_QUERY_FAILED','CONTEXT_FORMAT_INVALID'):raise ValueError('Invalid diagnostic')
        self.code=code;super().__init__(code)
API_CODES=frozenset(('INVALID_INPUT','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','METHOD_NOT_ALLOWED','REVISION_CONFLICT',
 'PROJECT_SUBMITTED','BASELINE_MISMATCH','FILES_NOT_READY','PAYLOAD_TOO_LARGE','UNSUPPORTED_MEDIA_TYPE','AUTH_UNAVAILABLE','DB_UNAVAILABLE','PROFILE_NOT_SYNCED'))
class ResponseFailure(ValueError):
    def __init__(self,category,http_status=None,api_code=None):
        if category not in ('http','transport','invalid_json','invalid_response','check_failed'):raise ValueError('Invalid diagnostic')
        self.category=category
        self.http_status=http_status if type(http_status) is int and 100<=http_status<=599 else None
        self.api_code=api_code if isinstance(api_code,str) and api_code in API_CODES else None
        super().__init__('category='+category+(' http_status='+str(self.http_status) if self.http_status else '')+(' api_code='+self.api_code if self.api_code else ''))
class ProbeFailure(ValueError):
    def __init__(self,phase,failure):
        allowed=('preflight','auth','context','acceptance','anonymous','create','load_created','save','stale_save','read_saved','create_version','list_versions','restore','branch','submit','read_before_restart','restart','read_after_restart','list_versions_after_restart','read_restored','read_branch')
        if phase not in allowed or not isinstance(failure,ResponseFailure):raise ValueError('Invalid diagnostic')
        super().__init__('SCENE_PROBE_FAILED phase='+phase+' '+str(failure))

def opener():return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())

def json_response(client,request,expected=200):
    try:response=client.open(request,timeout=25)
    except urllib.error.HTTPError as e:response=e
    except (OSError,http.client.HTTPException):raise ResponseFailure('transport') from None
    try:
        with response:
            status=response.status
            raw=response.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:raise ResponseFailure('invalid_response',status)
            try:value=json.loads(raw)
            except (ValueError,UnicodeError):
                raise ResponseFailure('http' if status!=expected else 'invalid_json',status) from None
            if status!=expected:
                code=value.get('error',{}).get('code') if isinstance(value,dict) and isinstance(value.get('error'),dict) else None
                raise ResponseFailure('http',status,code)
            return value
    except (OSError,http.client.HTTPException):raise ResponseFailure('transport') from None

def login(student,password):
    student=student.strip().lower()
    if not re.fullmatch('[a-z0-9_-]{2,32}',student) or not password:raise ValueError('Invalid credentials input')
    value=json_response(opener(),urllib.request.Request(ORIGIN+'/auth/v1/token?grant_type=password',method='POST',
      headers={'apikey':deploy.deploy.read_public_key(),'Content-Type':'application/json'},
      data=json.dumps({'email':'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co','password':password}).encode()))
    uid=value['user']['id']
    if not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',uid):raise ValueError('Invalid identity')
    return value['access_token'],uid

def api_caller(token):
    client=opener()
    def call(operation,data,expected=200,anonymous=False):
        if operation not in ('create','load','save','version','versions','restore','branch','submit'):raise ValueError('Unknown probe operation')
        headers={'Content-Type':'application/json'}
        if not anonymous:headers['Authorization']='Bearer '+token
        value=json_response(client,urllib.request.Request(BASE+operation,method='POST',headers=headers,data=json.dumps(data).encode()),expected)
        return value['data'] if expected==200 else value
    return call

def admin_context(docker,uid):
    if not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',uid):raise ValueError('Invalid identity')
    # UUID is strictly validated, fixed SQL only; no private rows are printed.
    template=(S.parent/'sql/scene-write-probe-context.sql').read_text(encoding='utf-8')
    if template.count('__PROBE_USER_UUID__')!=1:raise ContextFailure('CONTEXT_FORMAT_INVALID')
    try:value=docker.sql(template.replace('__PROBE_USER_UUID__',uid),deploy.DATABASE).strip()
    except (RuntimeError,OSError):raise ContextFailure('CONTEXT_QUERY_FAILED') from None
    try:result=json.loads(value)
    except (ValueError,TypeError):raise ContextFailure('CONTEXT_FORMAT_INVALID') from None
    if not isinstance(result,dict):raise ContextFailure('CONTEXT_FORMAT_INVALID')
    if result.get('is_admin') is not True:raise ContextFailure('ADMIN_PROFILE_REQUIRED')
    context=result.get('context')
    if context is None:raise ContextFailure('NO_VALID_SCENE_CONTEXT')
    if not isinstance(context,dict) or context.get('scopeKind')!='admin_sandbox' or context.get('groupId') is not None:
        raise ContextFailure('CONTEXT_FORMAT_INVALID')
    return context

def document_digest(document):return hashlib.sha256(json.dumps(document,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def revision_matches(value,expected):
    # RPC JSON returns a number; pg SELECT bigint rows return canonical text.
    # Preserve exact comparison without coercing booleans, floats or rounding.
    return type(expected) is int and expected>=0 and ((type(value) is int and value==expected) or (type(value) is str and value==str(expected)))

def perform_write_probe(call,context,restart,checkpoint):
    phase='anonymous'
    try:
        anonymous=call('load',{'projectId':'00000000-0000-0000-0000-000000000000'},expected=401,anonymous=True)
        if anonymous.get('error',{}).get('code')!='UNAUTHORIZED':raise ValueError('Anonymous access allowed')
        phase='create';created=call('create',{**context,'title':'C1 validation '+secrets.token_hex(5),'selectionBoundary':None})
        project=created['id'];checkpoint({'phase':'created','project_id':project})
        phase='load_created';doc=call('load',{'projectId':project})
        if doc['projectId']!=project or not revision_matches(doc['revision'],0):raise ValueError('Unexpected new draft')
        draft=copy.deepcopy(doc)
        draft['objects']=[{'id':'c1-probe-bench','kind':'asset','category':'bench','layerId':'design','groupId':None,'zIndex':0,
          'geometry':{'type':'Point','coordinates':[113,23]},
          'transform':{'headingDeg':0,'pitchDeg':0,'rollDeg':0,'heightOffsetM':0,'scale':[1,1,1]},
          'properties':{'assetRef':'seed:bench:wood','displayName':'C1 validation'}}]
        draft['assetRefs']=['seed:bench:wood']
        phase='save';saved=call('save',{'document':draft})
        if not revision_matches(saved['revision'],1):raise ValueError('Save not committed')
        checkpoint({'phase':'saved','project_id':project,'revision':1})
        phase='stale_save';conflict=call('save',{'document':draft},expected=409)
        if conflict.get('error',{}).get('code')!='REVISION_CONFLICT' or not revision_matches(conflict['error'].get('remoteRevision'),1):raise ValueError('Stale write accepted')
        phase='read_saved';current=call('load',{'projectId':project})
        if not revision_matches(current['revision'],1) or current['objects']!=draft['objects']:raise ValueError('Read-after-write differs')
        phase='create_version';milestone=call('version',{'projectId':project,'revision':1,'label':'C1-'+secrets.token_hex(4),'description':'Internal validation','previewPath':None})
        phase='list_versions';versions=call('versions',{'projectId':project})
        if not any(v['id']==milestone['id'] and revision_matches(v['revision'],1) for v in versions):raise ValueError('Milestone absent')
        phase='restore';restored=call('restore',{'versionId':milestone['id'],'title':'C1 restored validation'})
        if not revision_matches(restored['revision'],1):raise ValueError('Restore failed')
        phase='branch';branch=call('branch',{'projectId':project,'baselineRevision':doc['baselineRef']['revision']+1,'title':'C1 branch validation'})
        if not revision_matches(branch['revision'],0):raise ValueError('Branch failed')
        phase='submit'
        if call('submit',{'versionId':milestone['id']})['submissionStatus']!='submitted':raise ValueError('Submit failed')
        phase='read_before_restart';baseline=call('load',{'projectId':project})
        checkpoint({'phase':'before_restart','project_id':project,'restored_id':restored['id'],'branch_id':branch['id'],'version_id':milestone['id'],'document_sha256':document_digest(baseline)})
        phase='restart';restart()
        phase='read_after_restart'
        if document_digest(call('load',{'projectId':project}))!=document_digest(baseline):raise ValueError('Saved document lost after restart')
        phase='list_versions_after_restart';versions=call('versions',{'projectId':project})
        if not any(v['id']==milestone['id'] and revision_matches(v['revision'],1) and v.get('submission_status')=='submitted' for v in versions):raise ValueError('Version lost after restart')
        for target,expected_revision,phase in [(restored,1,'read_restored'),(branch,0,'read_branch')]:
            loaded=call('load',{'projectId':target['id']})
            if loaded['projectId']!=target['id'] or not revision_matches(loaded['revision'],expected_revision) or loaded['objects']!=draft['objects']:raise ValueError('Restored/branched document lost')
        return {'status':'authenticated_scene_write_probe_passed','created_drafts':3,'milestones':1,'revision':1,'restart_persistence':True}
    except ResponseFailure as e:raise ProbeFailure(phase,e) from None
    except (ValueError,RuntimeError,OSError,KeyError,TypeError):raise ProbeFailure(phase,ResponseFailure('check_failed')) from None

def acceptance_ready(proof,fingerprint,*,now=None):
    now=time.time() if now is None else now
    if (proof.get('status')!='restart_verified' or not proof.get('attempt_id') or proof.get('runtime_fingerprint')!=fingerprint
        or type(proof.get('verified_at')) not in (int,float) or not 0<=now-proof['verified_at']<=3600):raise ValueError('Need recent matching restart proof')

def main():
    argparse.ArgumentParser(description=__doc__).parse_args();os.umask(0o077);phase='preflight'
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Use normal admin Linux terminal')
        docker=deploy.deploy.rd.LocalDocker(deploy.STATE,target=deploy.deploy.TARGET)
        fingerprint=deploy.runtime_fingerprint(docker);proof=deploy.copy.read_private_json(deploy.STATE/'verification.json')
        acceptance_ready(proof,fingerprint)
        path=deploy.STATE/'acceptance.json'
        if path.exists():deploy.copy.private_path(path).rename(deploy.STATE/('acceptance.previous-'+secrets.token_hex(8)+'.json'))
        phase='auth'
        student=input('Website ADMIN student ID (for example 332): ')
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            password=getpass.getpass('Website LOGIN password (hidden; NOT database password or Secret key): ')
        token,uid=login(student,password);password=None
        phase='context';context=admin_context(docker,uid)
        call=api_caller(token);phase='write_version_restart'
        def restart():
            acceptance_ready(proof,deploy.runtime_fingerprint(docker))
            deploy.verify_candidate(docker,quiet=True)
        result=perform_write_probe(call,context,restart,lambda v:deploy.copy.write_private_json(deploy.STATE/'probe-state.json',v));token=None
        current=deploy.runtime_fingerprint(docker);fresh=deploy.copy.read_private_json(deploy.STATE/'verification.json');acceptance_ready(fresh,current)
        deploy.copy.write_private_json(path,{**result,'status':'internal_scene_writes_validated_not_cut_over','runtime_fingerprint':current,'verification_attempt_id':fresh['attempt_id'],'checked_at':time.time()})
        print(json.dumps(result));print('SCENE_WRITE_INTERNAL_VALIDATED_NOT_CUT_OVER');return 0
    except ProbeFailure as e:
        print('STOP: '+str(e)+'. Keep private state/logs; do not paste credentials or private rows.',file=sys.stderr);return 1
    except ResponseFailure as e:
        print('STOP: '+str(ProbeFailure(phase,e))+'. Do not paste credentials or private rows.',file=sys.stderr);return 1
    except ContextFailure as e:
        print('STOP: SCENE_PROBE_FAILED phase=context category='+e.code+'. Keep private logs; do not paste private rows.',file=sys.stderr);return 1
    except (ValueError,RuntimeError,OSError,KeyError,TypeError,getpass.GetPassWarning):
        print('STOP: SCENE_PROBE_FAILED phase='+phase+'. Keep private candidate data/logs. Do not paste credentials or private rows.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
