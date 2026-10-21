#!/usr/bin/env python3
"""One hidden-input local Auth and TEST-only business acceptance pass; no paid/GPU jobs."""
import argparse
import base64
import getpass
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import time
import warnings
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_operator import Docker,API,WEB,verified_runtime,operation_lock

old=load_script('probe-unified-business')
ORIGIN='https://8.148.248.237'


class AutonomousHttpApi(old.HttpApi):
    def __init__(self,*,port,request_impl=None,prepare_context=None,restart=None,persist=None,resources=None,task_proof=None):
        if port not in (18443,443):raise ValueError('FIXED_AUTONOMOUS_TLS_PORT_REQUIRED')
        self.base=ORIGIN;self.port=port;self.context=ssl.create_default_context();self.request_impl=request_impl or self._real_request
        self.prepare_context=prepare_context;self.restart=restart;self.persist=persist or (lambda value:None)
        self.resource_snapshot=resources or (lambda:{});self.synthetic_task_proof=task_proof or (lambda:{'verified':False})
        sibling=Path(__file__).with_name('unified-operation-routes.json')
        routes=sibling if sibling.is_file() else Path(__file__).resolve().parents[1]/'unified-operation-routes.json'
        self.routes=json.loads(routes.read_text(encoding='utf-8'))

    def _real_request(self,path,method,headers,data,binary):
        if path=='/healthz':
            connection=http.client.HTTPConnection('127.0.0.1',18087,timeout=30)
            try:
                connection.request(method,path,body=data,headers=headers);reply=connection.getresponse();raw=reply.read(32769)
                if len(raw)>32768:raise ValueError('HEALTH_RESPONSE_LIMIT')
                return reply.status,raw,{key.lower():value for key,value in reply.getheaders()}
            finally:connection.close()
        connection=socket.create_connection(('127.0.0.1',self.port),timeout=30)
        secure=self.context.wrap_socket(connection,server_hostname='8.148.248.237')
        try:
            wire=(method+' '+path+' HTTP/1.1\r\n'+''.join(key+': '+value+'\r\n' for key,value in headers.items())+'\r\n').encode()
            secure.sendall(wire)
            if data:secure.sendall(data)
            reply=http.client.HTTPResponse(secure);reply.begin();maximum=50*1024**2 if binary else 2*1024**2
            raw=reply.read(maximum+1)
            if len(raw)>maximum:raise ValueError('AUTONOMOUS_RESPONSE_LIMIT')
            return reply.status,raw,{key.lower():value for key,value in reply.getheaders()}
        finally:secure.close()

    def request(self,url,actor=None,*,method='GET',data=None,binary=False,mime=None,timings=None):
        if not isinstance(url,str) or not url.startswith(ORIGIN+'/') or len(url)>8192 or any(c in url for c in ('\r','\n')):
            raise old.TransportFailure('FORBIDDEN')
        path=url[len(ORIGIN):]
        if path!='/healthz' and not path.startswith(('/api/v1/','/auth/v1/')):raise old.TransportFailure('FORBIDDEN')
        headers={'Host':'8.148.248.237','Connection':'close','Cache-Control':'no-store'}
        if actor:headers['Authorization']='Bearer '+actor['token']
        if data is not None:
            data=data if isinstance(data,bytes) else json.dumps(data,separators=(',',':')).encode()
            headers['Content-Type']=mime or 'application/json';headers['Content-Length']=str(len(data))
        try:status,raw,response_headers=self.request_impl(path,method,headers,data,binary)
        except (OSError,ValueError,ssl.SSLError,http.client.HTTPException):raise old.TransportFailure('AUTH_UNAVAILABLE' if path.startswith('/auth/') else 'DB_UNAVAILABLE') from None
        if not 200<=status<300:
            code='AUTH_REJECTED' if path.startswith('/auth/') and status in (400,401,403) else 'AUTH_UNAVAILABLE' if path.startswith('/auth/') else 'CHECK_FAILED'
            if not path.startswith('/auth/'):
                try:code=json.loads(raw).get('error',{}).get('code',code)
                except (ValueError,TypeError,AttributeError):pass
            raise old.TransportFailure(code,status)
        if timings is not None:
            for kind in ('auth','sql','file'):
                match=re.search(r'(?:^|,\s*)'+kind+r';dur=([0-9]+(?:\.[0-9]+)?)',response_headers.get('server-timing',''))
                if not match:raise old.TransportFailure('CHECK_FAILED')
                timings[kind]=float(match[1])
        if binary:return raw
        if not raw:return None
        try:return json.loads(raw)
        except (ValueError,TypeError):raise old.TransportFailure('CHECK_FAILED') from None

    def login(self,credentials):
        student,password=credentials;student=student.strip().lower()
        if not re.fullmatch('[a-z0-9_-]{2,32}',student) or not password:raise old.TransportFailure('AUTH_REJECTED')
        value=self.request(self.base+'/auth/v1/token?grant_type=password',method='POST',data={'email':'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co','password':password})
        if not re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value.get('user',{}).get('id','')) or not isinstance(value.get('access_token'),str) or not isinstance(value.get('refresh_token'),str):raise old.TransportFailure('AUTH_REJECTED')
        return {'userId':value['user']['id'],'token':value['access_token'],'refreshToken':value['refresh_token']}


def auth_probe(api,credentials):
    actor=api.login(credentials);profile=api.request(api.base+'/api/v1/me',actor)['data']
    if profile.get('id')!=actor['userId'] or profile.get('role')!='admin':raise old.TransportFailure('FORBIDDEN')
    api.request(api.base+api.routes['catalog.listCourses']['path'],actor)
    value=api.request(api.base+'/auth/v1/token?grant_type=refresh_token',method='POST',data={'refresh_token':actor['refreshToken']})
    if value.get('user',{}).get('id')!=actor['userId'] or not isinstance(value.get('access_token'),str):raise old.TransportFailure('AUTH_REJECTED')
    refreshed={'userId':actor['userId'],'token':value['access_token']}
    api.request(api.base+'/api/v1/me',refreshed)
    api.request(api.base+'/auth/v1/logout?scope=local',refreshed,method='POST')
    try:api.request(api.base+'/api/v1/me',actor)
    except old.TransportFailure as error:
        if error.code!='UNAUTHORIZED' or error.status!=401:raise
    else:raise old.TransportFailure('AUTH_REJECTED')
    encode=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    source=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'iss':old.ORIGIN+'/auth/v1','aud':'authenticated','sub':actor['userId'],'exp':int(time.time())+60})+'.'+'A'*43
    try:api.request(api.base+'/api/v1/me',{'token':source})
    except old.TransportFailure as error:
        if error.code!='UNAUTHORIZED' or error.status!=401:raise
    else:raise old.TransportFailure('AUTH_REJECTED')
    return dict.fromkeys(('login','refresh','business_read','logout_revocation','source_token_rejected'),True)


def context_callback(docker,state):
    def prepare(admin,member,previous):
        if not all(re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',v) for v in (admin,member)) or admin==member:raise old.TransportFailure('TEST_CONTEXT_REQUIRED')
        context={'teachingProjectId':'c4a00000-0000-4000-8000-000000000002','villageId':'c4a00000-0000-4000-8000-000000000001',
            'courseId':'autonomous-test-20261021','groupId':'autonomous-test-group-20261021','spaceId':'autonomous-test-space-20261021'}
        if previous is not None and previous!=context:raise old.TransportFailure('TEST_CONTEXT_REQUIRED')
        template=storage.private_path(state/'control/autonomous-test-context.sql').read_text()
        value=json.loads(docker.sql(template.replace('__ADMIN_ID__',admin).replace('__MEMBER_ID__',member)))
        if value.get('status')!='ready' or value.get('test_memberships')!=1:raise old.TransportFailure('TEST_CONTEXT_REQUIRED')
        return context
    return prepare


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.parse_args()
    phase='runtime'
    try:
        os.umask(0o077);state=Path.home()/'village-autonomous'
        with operation_lock(state):
            deploy=load_script('deploy-autonomous');docker=deploy.DeployDocker(state);meta,network=verified_runtime(docker,state);deploy.runtime_health(docker,state,meta)
            obj=docker.own_container(WEB,meta['releaseId']);port=int(obj['HostConfig']['PortBindings']['8443/tcp'][0]['HostPort'])
            def restart():
                before=docker.own_container(API,meta['releaseId'])
                deploy.verify(meta,state)
                after=docker.own_container(API,meta['releaseId'])
                return {'same_container':before['Id']==after['Id'],'started_at_changed':before['State']['StartedAt']!=after['State']['StartedAt']}
            def resources():
                raw=docker.run('stats','--no-stream','--format','{{json .}}',API,deploy.AUTH,deploy.PG,WEB)
                return {'containers':[{key:json.loads(row).get(key) for key in ('Name','MemUsage','CPUPerc')} for row in raw.splitlines() if row]}
            api=AutonomousHttpApi(port=port,prepare_context=context_callback(docker,state),restart=restart,
                persist=lambda value:storage.write_private_json(state/'business-probe-state.json',value),resources=resources,
                task_proof=lambda:{'verified':True,'releaseId':meta['releaseId'],'native_run_id':meta['validation']['native_run_id'],'real_jobs':False})
            with warnings.catch_warnings():
                warnings.simplefilter('error',getpass.GetPassWarning)
                admin=(input('Website ADMIN student ID (for example 332): ').strip(),getpass.getpass('ADMIN website LOGIN password (hidden): '))
                member=(input('Website existing STUDENT ID (for example 25213040): ').strip(),getpass.getpass('STUDENT website LOGIN password (hidden): '))
            phase='local_auth';core=auth_probe(api,admin)
            phase='business_flow';previous=storage.read_private_json(state/'business-probe-state.json') if (state/'business-probe-state.json').exists() else {}
            report=old.run_probe(api,admin,member,previous)
            admin=member=None
            if report.get('status')!='internal_validated_not_cut_over' or report.get('restart_persistence') is not True:raise old.TransportFailure('CHECK_FAILED')
            storage.write_private_json(state/'business-acceptance.json',report)
            storage.write_private_json(state/'acceptance.json',{'status':'local_auth_business_verified_not_cut_over','releaseId':meta['releaseId'],
                'accepted_at':time.time(),**core,'business_restart':True,'gpu_real_jobs':False,'paid_provider_called':False})
        print(json.dumps({'status':'local_auth_and_business_full_probe_passed','restart_persistence':True,'load':report['load'],'resources':report['resources']}))
        print('AUTONOMOUS_CORE_INTERNAL_VALIDATED_NOT_PUBLIC_OR_GPU_ACCEPTED');return 0
    except (OSError,ValueError,RuntimeError,EOFError,getpass.GetPassWarning) as error:
        safe=str(error) if isinstance(error,old.ProbeFailure) else 'phase='+phase+' category='+('http_'+str(error.status) if isinstance(error,old.TransportFailure) and error.status else 'check_failed')
        print('STOP: AUTONOMOUS_PROBE_FAILED '+safe+'. Keep private TEST state; do not paste credentials or business rows.');return 1


if __name__=='__main__':raise SystemExit(main())
