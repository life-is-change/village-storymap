"""Fixed, bounded four-service topology. Source architecture is never activated."""
from pathlib import Path
import re
from autonomous_operator import PROJECT,DATABASE,PG,API,AUTH,WEB,ADMIN


def compose_document(state,meta,*,uid,gid,public=False):
    state=Path(state)
    if uid<=0 or gid<0 or type(public) is not bool or not state.is_absolute():raise ValueError('AUTONOMOUS_OPERATOR_PATH_REQUIRED')
    if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous' or not re.fullmatch(r'autonomous-[a-f0-9]{12}',meta.get('releaseId','')) or meta.get('instanceId')!='aliyun-village':
        raise ValueError('AUTONOMOUS_RELEASE_REQUIRED')
    if meta.get('image')!='village-autonomous:'+meta['releaseId'].removeprefix('autonomous-'):raise ValueError('AUTONOMOUS_IMAGE_IDENTITY_REQUIRED')
    for key in ('nginx_image_id','postgres_image_id','auth_image_id'):
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',meta.get(key,'')):raise ValueError('PINNED_AUTONOMOUS_RUNTIME_REQUIRED')
    def bind(source,target,ro=True):return {'type':'bind','source':str(source),'target':target,'read_only':ro,'bind':{'create_host_path':False}}
    common={'pull_policy':'never','read_only':True,'restart':'unless-stopped','security_opt':['no-new-privileges:true'],'cap_drop':['ALL'],
        'labels':{'village.autonomous.release':meta['releaseId']},'logging':{'driver':'local','options':{'max-size':'5m','max-file':'3'}}}
    limited={**common,'user':f'{uid}:{gid}','pids_limit':64,'tmpfs':['/tmp:size=16m,mode=1777']}
    db={**common,'image':meta['postgres_image_id'],'container_name':PG,'mem_limit':'768m','memswap_limit':'768m','cpus':1,'pids_limit':256,
        # The upstream initdb entrypoint switches to its own postgres UID and
        # needs only these initialization capabilities, never privileged mode.
        'cap_add':['CHOWN','DAC_OVERRIDE','FOWNER','SETGID','SETUID'],
        'shm_size':'128m','tmpfs':['/tmp:size=64m,mode=1777','/var/run/postgresql:size=16m,mode=3775'],
        'networks':{'dbnet':{'aliases':['postgres']}},
        'environment':{'PGDATA':'/var/lib/postgresql/data','POSTGRES_USER':ADMIN,'POSTGRES_DB':'restore_control',
            'POSTGRES_PASSWORD_FILE':'/run/secrets/bootstrap-password','POSTGRES_INITDB_ARGS':'--encoding=UTF8 --locale=C.UTF-8 --auth-host=scram-sha-256'},
        'command':['postgres','-D','/var/lib/postgresql/data','-c','listen_addresses=*','-c','shared_preload_libraries=pg_stat_statements',
            '-c','shared_buffers=128MB','-c','work_mem=4MB','-c','maintenance_work_mem=64MB','-c','max_connections=25',
            '-c','max_locks_per_transaction=256','-c','max_wal_size=256MB','-c','wal_level=logical','-c','max_parallel_workers_per_gather=0'],
        'volumes':[bind(state/'data','/var/lib/postgresql/data',False),bind(state/'empty-init','/docker-entrypoint-initdb.d'),
            bind(state/'secrets/bootstrap-password','/run/secrets/bootstrap-password')],
        'healthcheck':{'test':['CMD','pg_isready','-h','127.0.0.1','-U',ADMIN,'-d','restore_control'],'interval':'5s','timeout':'3s','retries':20,'start_period':'10s'}}
    api={**limited,'image':meta['image'],'container_name':API,'mem_limit':'256m','memswap_limit':'256m','cpus':0.75,
        'networks':{'dbnet':{'aliases':['api']},'egress':{}},'ports':['127.0.0.1:18087:8080'],
        'environment':{'NODE_ENV':'production','NODE_OPTIONS':'--max-old-space-size=160','PORT':'8080','PGHOST':'postgres','PGPORT':'5432',
            'PGDATABASE':DATABASE,'PGUSER':'village_unified_login','PGPASSWORD_FILE':'/run/secrets/api-password',
            'AUTH_MODE':'local','AUTH_PUBLIC_ORIGIN':'https://8.148.248.237','AUTH_INTERNAL_ORIGIN':'http://auth:9999',
            'UNIFIED_INSTANCE_ID':meta['instanceId'],'UNIFIED_FILES_ROOT':'/srv/ordinary','UNIFIED_SCENE_ROOT':'/srv/scene',
            'UNIFIED_LEGACY_ROOT':'/srv/legacy','UNIFIED_LEGACY_INDEX':'/run/storage/index.json',
            'UNIFIED_RELEASE_FILE':'/opt/village/business-api/release.json','BRIDGE_ENABLED':'false','FACADE_CLOUD_ENABLED':'false'},
        'volumes':[bind(state/'secrets/api-password','/run/secrets/api-password'),bind(state/'files','/srv/ordinary',False),
            bind(state/'scene-files','/srv/scene',False),bind(state/'storage/blobs','/srv/legacy'),bind(state/'storage-index.json','/run/storage/index.json')],
        'healthcheck':{'test':['CMD','node','-e',"fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],
            'interval':'5s','timeout':'3s','retries':20}}
    auth={**limited,'image':meta['auth_image_id'],'container_name':AUTH,'mem_limit':'128m','memswap_limit':'128m','cpus':0.5,
        'env_file':[str(state/'secrets/auth-runtime.env')],'networks':{'dbnet':{'aliases':['auth']}},
        'depends_on':{'postgres':{'condition':'service_healthy'}}}
    web={**limited,'image':meta['nginx_image_id'],'container_name':WEB,'mem_limit':'64m','memswap_limit':'64m','cpus':0.25,
        'entrypoint':['/usr/sbin/nginx'],'command':['-g','daemon off;'],'networks':{'dbnet':{}},
        'ports':['0.0.0.0:80:8080','0.0.0.0:443:8443'] if public else ['127.0.0.1:18086:8080','127.0.0.1:18443:8443'],
        'volumes':[bind(state/'releases'/meta['releaseId']/'web','/srv/village-web'),bind(state/'nginx.conf','/etc/nginx/nginx.conf'),
            bind(state/'tls','/run/tls'),bind(state/'acme','/srv/acme')],
        'depends_on':{'api':{'condition':'service_healthy'},'auth':{'condition':'service_started'}}}
    return {'name':PROJECT,'services':{'postgres':db,'api':api,'auth':auth,'web':web},
            'networks':{'dbnet':{'internal':True},'egress':{}}}
