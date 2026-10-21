"""Private operator primitives for the fixed autonomous deployment.

No source mutations, public database ports, remote Docker contexts, secret
stdout, destructive reset or automatic replay of uncertain operations.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import contextlib
import business_storage_copy as storage

PROJECT='village-autonomous'
DATABASE='village_unified_candidate'
PG='village-autonomous-postgres'
API='village-autonomous-api'
AUTH='village-autonomous-auth'
WEB='village-autonomous-web'
ADMIN='village_restore_admin'
OLD_CANDIDATES={
    'village-api-validation-api':('village-api-validation','api'),
    'village-storage-validation-api':('village-storage-validation','api'),
    'village-scene-validation-api':('village-scene-validation','api'),
    'village-scene-files-validation-api':('village-scene-files-validation','api'),
    'village-api-validation-postgres':('village-api-validation','db'),
}


def clean_environment():
    return {k:v for k,v in os.environ.items() if not k.startswith(('DOCKER_','COMPOSE_','PG'))}


class Docker:
    def __init__(self,state):
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        self.state=storage.private_path(state,directory=True)
        self.env=clean_environment();self.prefix=['sudo','-n','docker','--context','default']
        try:
            endpoint=subprocess.run([*self.prefix,'context','inspect','default','--format','{{.Endpoints.docker.Host}}'],
                env=self.env,check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10).stdout.decode().strip()
        except (OSError,subprocess.SubprocessError):raise ValueError('LOCAL_DOCKER_REQUIRED') from None
        if endpoint!='unix:///var/run/docker.sock':raise ValueError('LOCAL_DOCKER_REQUIRED')

    def run(self,*args,input=None,timeout=300):
        error=self.state/('operator-'+secrets.token_hex(12)+'.log')
        # No exception includes command/stdin/engine output. The operator keeps
        # a private error file instead of pasting credentials from Docker logs.
        try:
            with os.fdopen(os.open(error,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as log:
                result=subprocess.run([*self.prefix,*map(str,args)],env=self.env,
                    input=input.encode() if isinstance(input,str) else input,stdout=subprocess.PIPE,stderr=log,timeout=timeout)
            if result.returncode:raise RuntimeError('DOCKER_OPERATION_FAILED')
            return result.stdout.decode('utf-8')
        except (OSError,subprocess.SubprocessError):raise RuntimeError('DOCKER_OPERATION_FAILED') from None

    def inspect(self,name):
        if not re.fullmatch(r'[a-z][a-z0-9_.-]{0,100}',name):raise ValueError('INVALID_CONTAINER_NAME')
        rows=json.loads(self.run('container','inspect',name))
        if len(rows)!=1 or rows[0].get('Name')!='/'+name:raise ValueError('CONTAINER_IDENTITY_CHANGED')
        return rows[0]

    def sql(self,query,*,database=DATABASE):
        if database not in (DATABASE,'restore_control'):raise ValueError('FIXED_DATABASE_REQUIRED')
        return self.run('exec','-i',PG,'psql','-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1',
                        '-h','/var/run/postgresql','-U',ADMIN,'-d',database,input=query)

    def own_container(self,name,release):
        if name not in (PG,API,AUTH,WEB):raise ValueError('UNKNOWN_AUTONOMOUS_CONTAINER')
        obj=self.inspect(name);labels=obj.get('Config',{}).get('Labels') or {}
        if labels.get('com.docker.compose.project')!=PROJECT or labels.get('village.autonomous.release')!=release:
            raise ValueError('AUTONOMOUS_RELEASE_IDENTITY_CHANGED')
        return obj


def stop_receipt(obj):
    name=obj.get('Name','').removeprefix('/')
    if name not in OLD_CANDIDATES:raise ValueError('NOT_AN_OBSOLETE_CANDIDATE')
    project,service=OLD_CANDIDATES[name];labels=obj.get('Config',{}).get('Labels') or {}
    if labels.get('com.docker.compose.project')!=project or labels.get('com.docker.compose.service')!=service:
        raise ValueError('OLD_CANDIDATE_LABELS_CHANGED')
    if not re.fullmatch(r'[0-9a-f]{64}',obj.get('Id','')) or not re.fullmatch(r'sha256:[0-9a-f]{64}',obj.get('Image','')):
        raise ValueError('OLD_CANDIDATE_IDENTITY_REQUIRED')
    for entries in (obj.get('HostConfig',{}).get('PortBindings') or {}).values():
        for bind in entries or []:
            if bind.get('HostIp')!='127.0.0.1' or bind.get('HostPort') not in ('18080','18081','18082','18083'):
                raise ValueError('OLD_CANDIDATE_PUBLIC_OR_UNKNOWN_PORT')
    mounts=[{'source':v['Source'],'target':v['Destination'],'rw':v['RW']} for v in obj.get('Mounts',[])]
    return {'id':obj['Id'],'image':obj['Image'],'name':name,'project':project,'service':service,
            'mounts_sha256':hashlib.sha256(json.dumps(mounts,sort_keys=True).encode()).hexdigest(),
            'was_running':bool(obj.get('State',{}).get('Running'))}


class Checkpoints:
    def __init__(self,state,identity):
        self.state=storage.private_path(state,directory=True);self.path=self.state/'autonomous-checkpoints.json'
        if not isinstance(identity,dict) or not identity:raise ValueError('CHECKPOINT_IDENTITY_REQUIRED')
        if self.path.exists():
            self.doc=storage.read_private_json(self.path)
            if self.doc.get('version')!=1 or self.doc.get('identity')!=identity:raise ValueError('CHECKPOINT_IDENTITY_CHANGED')
        else:self.doc={'version':1,'identity':identity,'steps':{}};self.save()

    def save(self):storage.write_private_json(self.path,self.doc)

    def step(self,name,apply,check,*,recover=None):
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,80}',name):raise ValueError('INVALID_CHECKPOINT_STEP')
        old=self.doc['steps'].get(name)
        if old:
            if old.get('status')=='done':
                if not check(old.get('receipt')):raise ValueError('COMPLETED_STEP_CHANGED')
                return old['receipt']
            if old.get('status')!='pending' or recover is None:raise ValueError('PARTIAL_STEP_REQUIRES_INSPECTION')
            receipt=recover()
        else:
            self.doc['steps'][name]={'status':'pending'};self.save();receipt=apply()
        if not check(receipt):raise ValueError('STEP_CHECK_FAILED')
        self.doc['steps'][name]={'status':'done','receipt':receipt};self.save();return receipt


AUTH_TRIGGER_SQL="""BEGIN READ ONLY;
SELECT coalesce(json_agg(json_build_object('name',t.tgname,'table',c.relname,
 'function_schema',pn.nspname,'function_name',p.proname)),'[]'::json)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
WHERE n.nspname='auth' AND NOT t.tgisinternal;
COMMIT;"""


def audit_auth_triggers(rows):
    allowed={'name':'on_auth_user_created','table':'users','function_schema':'public','function_name':'handle_new_auth_user'}
    if not isinstance(rows,list) or len(rows)>1 or any(row!=allowed for row in rows):raise ValueError('UNKNOWN_AUTH_TRIGGER')


def verified_runtime(docker,state):
    meta=storage.read_private_json(Path(state)/'release.json')
    if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous':raise ValueError('LOCAL_RUNTIME_REQUIRED')
    network=PROJECT+'_dbnet';network_id=None
    for name in (API,AUTH,PG):
        obj=docker.own_container(name,meta['releaseId'])
        allowed=meta['accepted_image_ids'] if name==API else [meta['auth_image_id'] if name==AUTH else meta['postgres_image_id']]
        if obj.get('Image') not in allowed or not obj.get('State',{}).get('Running'):raise ValueError('LOCAL_RUNTIME_REQUIRED')
        if name in (AUTH,PG) and any(values for values in (obj.get('HostConfig',{}).get('PortBindings') or {}).values()):raise ValueError('PRIVATE_AUTH_DATABASE_REQUIRED')
        if name==API:
            env={row.split('=',1)[0]:row.split('=',1)[1] for row in obj.get('Config',{}).get('Env',[]) if '=' in row}
            for key,value in {'AUTH_MODE':'local','AUTH_INTERNAL_ORIGIN':'http://auth:9999','AUTH_PUBLIC_ORIGIN':'https://8.148.248.237','PGHOST':'postgres'}.items():
                if env.get(key)!=value:raise ValueError('LOCAL_RUNTIME_REQUIRED')
            if env.get('BRIDGE_ENABLED')=='true' or env.get('SUPABASE_AUTH_ORIGIN') or env.get('SUPABASE_SECRET_KEY'):raise ValueError('LOCAL_RUNTIME_REQUIRED')
        current=obj.get('NetworkSettings',{}).get('Networks',{}).get(network,{}).get('NetworkID')
        if not current or network_id is not None and current!=network_id:raise ValueError('SHARED_INTERNAL_NETWORK_REQUIRED')
        network_id=current
    obj=json.loads(docker.run('network','inspect',network))[0]
    if obj.get('Name')!=network or obj.get('Id')!=network_id or obj.get('Internal') is not True:raise ValueError('SHARED_INTERNAL_NETWORK_REQUIRED')
    return meta,network


@contextlib.contextmanager
def operation_lock(state):
    import fcntl
    state=storage.private_path(state,directory=True);path=state/'.operator-operation.lock'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        st=os.fstat(fd)
        if st.st_uid!=os.geteuid() or st.st_nlink!=1 or st.st_mode&0o077:raise ValueError('PRIVATE_OPERATION_LOCK_REQUIRED')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('ANOTHER_OPERATOR_OPERATION_RUNNING') from None
        yield
    finally:os.close(fd)
