#!/usr/bin/env python3
"""Hidden real-login C2a file/save/version/restart probe; all TEST data retained."""
import argparse
import base64
import copy
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import struct
import sys
import time
import urllib.request
import warnings
S=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,S/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
deploy=load('files_probe_deploy','deploy-scene-files-validation.py');base=load('files_probe_base','probe-scene-write.py')
base.API_CODES=base.API_CODES|frozenset(('INVALID_FILE','FILE_TYPE_UNSUPPORTED','FILE_TOO_LARGE','FILE_BUSY','FILE_UNAVAILABLE','UPLOAD_CONFLICT','UPLOAD_EXPIRED','QUOTA_EXCEEDED','FILE_SCOPE_MISMATCH'))
BASE='http://127.0.0.1:18083/api/v1/scene-files'
class ContextFailure(ValueError):
    def __init__(self,code):
        if code not in ('PROFILE_NOT_SYNCED','ADMIN_PROFILE_REQUIRED','CONTEXT_MEMBERSHIP_REQUIRED','NO_VALID_SCENE_CONTEXT','CONTEXT_FORMAT_INVALID'):raise ValueError('Invalid context code')
        self.code=code;super().__init__(code)
def check_context(value):
    if value.get('profile') is not True:raise ContextFailure('PROFILE_NOT_SYNCED')
    if not isinstance(value.get('membership'),dict) or not value['membership'].get('courseId') or not value['membership'].get('groupId'):raise ContextFailure('CONTEXT_MEMBERSHIP_REQUIRED')
    if not isinstance(value.get('context'),dict):raise ContextFailure('NO_VALID_SCENE_CONTEXT')
    return value
def failure_message(phase,error):
    if not re.fullmatch('[a-z_]{1,40}',phase):phase='unknown'
    detail='category='+error.code if isinstance(error,ContextFailure) else str(error) if isinstance(error,base.ResponseFailure) else 'category=check_failed'
    return 'SCENE_FILES_PROBE_FAILED phase='+phase+' '+detail
def synthetic_files():
    value={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],
      'buffers':[{'byteLength':36}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36}],'accessors':[{'bufferView':0,'componentType':5126,'type':'VEC3','count':3,'min':[-.5,0,0],'max':[.5,1,0]}]}
    raw=json.dumps(value,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);binary=struct.pack('<9f',-.5,0,0,.5,0,0,0,1,0)
    glb=struct.pack('<4sIIII',b'glTF',2,28+len(raw)+len(binary),len(raw),0x4e4f534a)+raw+struct.pack('<II',len(binary),0x004e4942)+binary
    return glb,base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=')
def read_context(docker,uid,course=None):
    if not re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',uid):raise ContextFailure('CONTEXT_FORMAT_INVALID')
    if course is not None and (not isinstance(course,str) or not 0<len(course)<=200):raise ContextFailure('CONTEXT_FORMAT_INVALID')
    literal='NULL::text' if course is None else "convert_from(decode('"+course.encode('utf8').hex()+"','hex'),'UTF8')"
    template=(S.parent/'sql/scene-files-probe-context.sql').read_text(encoding='utf-8')
    return json.loads(docker.sql(template.replace('__PROBE_USER_UUID__',uid).replace('__COURSE_FILTER__',literal),deploy.DATABASE))
def hidden_login(prompt):
    student=input(prompt)
    with warnings.catch_warnings():
        warnings.simplefilter('error',getpass.GetPassWarning);password=getpass.getpass('Website LOGIN password (hidden; NOT database password or Secret key): ')
    token,uid=base.login(student,password);password=None;return token,uid
def caller(token):
    def send(path,data=None,*,method='POST',binary=None,mime=None,expected=200,anonymous=False):
        headers={} if anonymous else {'Authorization':'Bearer '+token}
        body=None
        if data is not None:headers['Content-Type']='application/json';body=json.dumps(data).encode()
        if binary is not None:headers['Content-Type']=mime;body=binary
        v=base.json_response(base.opener(),urllib.request.Request(BASE+path,method=method,headers=headers,data=body),expected)
        return v['data'] if expected==200 else v
    return send
def download(token,file_id,raw,*,range_header=None):
    headers={'Authorization':'Bearer '+token}
    if range_header:headers['Range']=range_header
    try:
        with base.opener().open(urllib.request.Request(BASE+'/files/'+file_id,headers=headers),timeout=25) as response:
            if response.status!=(206 if range_header else 200):raise base.ResponseFailure('http',response.status)
            digest=hashlib.sha256();count=0
            while True:
                chunk=response.read(65536)
                if not chunk:break
                count+=len(chunk)
                if count>len(raw):raise base.ResponseFailure('invalid_response')
                digest.update(chunk)
            if count!=len(raw) or digest.hexdigest()!=hashlib.sha256(raw).hexdigest():raise base.ResponseFailure('check_failed')
    except base.ResponseFailure:raise
    except Exception:raise base.ResponseFailure('transport') from None
def upload(send,purpose,context,raw,role,record,checkpoint):
    mime='model/gltf-binary' if role=='display' else 'image/png';ext='glb' if role=='display' else 'png'
    session=send('/sessions',{'requestId':secrets_uuid(),'purpose':purpose,'context':context,'files':[{'role':role,'size':len(raw),'mime':mime,'extension':ext}]})
    checkpoint({'phase':'upload','session_id':session['id']});result=send('/sessions/'+session['id']+'/files/'+role,method='PUT',binary=raw,mime=mime)
    if result['sha256']!=hashlib.sha256(raw).hexdigest():raise base.ResponseFailure('check_failed')
    registered=send('/sessions/'+session['id']+'/commit',record)
    replay=send('/sessions/'+session['id']+'/commit',record)
    if replay['id']!=registered['id']:raise base.ResponseFailure('check_failed')
    return registered,session['files'][0]['id']
def secrets_uuid():
    import uuid
    return str(uuid.uuid4())
def perform_probe(admin_send,upload_send,context,read_file,restart,checkpoint):
    phase='anonymous'
    try:
        anonymous=admin_send('/scene/load',{'projectId':'00000000-0000-0000-0000-000000000000'},expected=401,anonymous=True)
        if anonymous.get('error',{}).get('code')!='UNAUTHORIZED':raise base.ResponseFailure('check_failed')
        glb,png=synthetic_files();member=context['membership'];scene={k:v for k,v in context['context'].items() if k!='courseId'}
        phase='upload';asset,file_id=upload(upload_send,'asset',{'courseId':member['courseId'],'groupId':None,'scopeKind':'personal','kind':'model'},glb,'display',{'displayName':'C2a TEST model','license':'student-provided','metadata':{'category':'bench'}},checkpoint)
        phase='read_file';read_file(file_id,glb)
        shared=upload_send('/scene/publishAsset',{'assetId':asset['id']});group=upload_send('/scene/copyAsset',{'assetId':shared['id'],'groupId':member['groupId']})
        if group['storage_path']!=asset['storage_path']:raise base.ResponseFailure('check_failed')
        phase='create';project=admin_send('/scene/create',{**scene,'title':'C2a TEST '+secrets.token_hex(5)});doc=admin_send('/scene/load',{'projectId':project['id']})
        draft=copy.deepcopy(doc);draft['assetRefs']=[shared['id']];draft['objects']=[{'id':'c2a-model','kind':'asset','category':'bench','layerId':'design','groupId':None,'zIndex':0,'geometry':{'type':'Point','coordinates':[113,23]},'transform':{'headingDeg':0,'pitchDeg':0,'rollDeg':0,'heightOffsetM':0,'scale':[1,1,1]},'properties':{'assetRef':shared['id']}}]
        phase='save';saved=admin_send('/scene/save',{'document':draft})
        if not base.revision_matches(saved['revision'],1):raise base.ResponseFailure('check_failed')
        conflict=admin_send('/scene/save',{'document':draft},expected=409)
        if conflict.get('error',{}).get('code')!='REVISION_CONFLICT':raise base.ResponseFailure('check_failed')
        phase='preview';version,preview_id=upload(admin_send,'version-preview',{'projectId':project['id'],'revision':1},png,'preview',{'label':'C2a-'+secrets.token_hex(4),'description':'TEST preview'},checkpoint)
        read_file(preview_id,png)
        phase='component';fragment={'id':secrets_uuid(),'name':'C2a TEST component','coordinateSpace':'local-m','objects':[{**copy.deepcopy(draft['objects'][0]),'geometry':{'type':'Point','coordinates':[0,0,0]}}],'assetRefs':[shared['id']]}
        component,component_file=upload(upload_send,'component-preview',{'courseId':member['courseId'],'groupId':None,'scopeKind':'personal'},png,'preview',{'displayName':'C2a TEST component','fragment':fragment},checkpoint)
        published=upload_send('/scene/publishComponent',{'componentId':component['id']});upload_send('/scene/copyComponent',{'componentId':published['id'],'groupId':member['groupId']});read_file(component_file,png)
        phase='restore';restored=admin_send('/scene/restore',{'versionId':version['id'],'title':'C2a TEST restored'});branch=admin_send('/scene/branch',{'projectId':project['id'],'baselineRevision':scene['baselineRevision'],'title':'C2a TEST branch'})
        phase='archive';upload_send('/scene/archiveAsset',{'assetId':shared['id']});fresh=admin_send('/scene/create',{**scene,'title':'C2a TEST archive guard'});fresh_doc=admin_send('/scene/load',{'projectId':fresh['id']});fresh_doc['assetRefs']=[shared['id']]
        refused=admin_send('/scene/save',{'document':fresh_doc},expected=409)
        if refused.get('error',{}).get('code')!='FILES_NOT_READY':raise base.ResponseFailure('check_failed')
        phase='submit';admin_send('/scene/submit',{'versionId':version['id']});before=admin_send('/scene/load',{'projectId':project['id']});checkpoint({'phase':'before_restart','project_id':project['id'],'version_id':version['id'],'file_ids':[file_id,preview_id,component_file]})
        phase='restart';restart()
        phase='read_after_restart'
        if base.document_digest(admin_send('/scene/load',{'projectId':project['id']}))!=base.document_digest(before):raise base.ResponseFailure('check_failed')
        for item in [restored,branch]:
            if admin_send('/scene/load',{'projectId':item['id']})['objects']!=draft['objects']:raise base.ResponseFailure('check_failed')
        versions=admin_send('/scene/versions',{'projectId':project['id']})
        if not any(v['id']==version['id'] and v['submission_status']=='submitted' for v in versions):raise base.ResponseFailure('check_failed')
        for fid,raw in [(file_id,glb),(preview_id,png),(component_file,png)]:read_file(fid,raw)
        return {'status':'authenticated_scene_files_probe_passed','created_drafts':4,'milestones':1,'file_objects':3,'verified_bytes':len(glb)+2*len(png),'restart_persistence':True}
    except Exception as e:raise ValueError(failure_message(phase,e)) from None
def main():
    argparse.ArgumentParser(description=__doc__).parse_args();os.umask(0o077);phase='preflight'
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Use normal admin Linux terminal')
        docker=deploy.deploy.rd.LocalDocker(deploy.STATE,target=deploy.deploy.TARGET);fingerprint=deploy.runtime_fingerprint(docker);proof=deploy.copy.read_private_json(deploy.STATE/'verification.json');base.acceptance_ready(proof,fingerprint)
        phase='auth';admin_token,admin_uid=hidden_login('Website ADMIN student ID (for example 332): ')
        phase='context';admin_context=read_context(docker,admin_uid)
        if not admin_context.get('is_admin'):raise ContextFailure('ADMIN_PROFILE_REQUIRED')
        uploader_token=admin_token;uploader_uid=admin_uid;member=admin_context.get('membership')
        if not member:
            print('Admin has no course membership for source asset registration. Enter an EXISTING course member account for uploads; no permissions will be changed.')
            uploader_token,uploader_uid=hidden_login('Existing course member website student ID: ');report=read_context(docker,uploader_uid);member=report.get('membership')
            if not member:raise ContextFailure('CONTEXT_MEMBERSHIP_REQUIRED')
        report=read_context(docker,admin_uid,member['courseId']);context=check_context({**report,'membership':member})
        path=deploy.STATE/'acceptance.json'
        if path.exists():deploy.copy.private_path(path).rename(deploy.STATE/('acceptance.previous-'+secrets.token_hex(8)+'.json'))
        def restart():base.acceptance_ready(proof,deploy.runtime_fingerprint(docker));deploy.verify_candidate(docker,quiet=True)
        phase='file_workflow';result=perform_probe(caller(admin_token),caller(uploader_token),context,lambda fid,raw:download(admin_token,fid,raw),restart,lambda v:deploy.copy.write_private_json(deploy.STATE/'probe-state.json',v));admin_token=uploader_token=None
        current=deploy.runtime_fingerprint(docker);fresh=deploy.copy.read_private_json(deploy.STATE/'verification.json');base.acceptance_ready(fresh,current)
        deploy.copy.write_private_json(path,{**result,'status':'internal_scene_files_validated_not_cut_over','runtime_fingerprint':current,'verification_attempt_id':fresh['attempt_id'],'checked_at':time.time()})
        print(json.dumps(result));print('SCENE_FILES_INTERNAL_VALIDATED_NOT_CUT_OVER');return 0
    except Exception as e:
        message=str(e) if isinstance(e,ValueError) and str(e).startswith('SCENE_FILES_PROBE_FAILED phase=') else failure_message(phase,e)
        print('STOP: '+message+'. Keep private data/logs; do not paste passwords, tokens or business rows.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
