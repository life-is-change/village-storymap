"""Private, read-only Supabase object transfer helpers. Never print secrets or paths."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys

PROJECT='rzmbmwauomzwiyenafha'
ORIGIN='https://'+PROJECT+'.supabase.co'
SELECTED_BUCKETS={'house-photos','scene-assets','scene-version-previews','group-models','village-datasets'}
CHUNK=1024*1024
RESERVE=4*1024**3

def now():return dt.datetime.now(dt.timezone.utc).isoformat()

def no_links(path):
    path=Path(path).absolute()
    if any(p.is_symlink() for p in (path,*path.parents)):raise ValueError('Linked paths are not accepted.')
    return path.resolve()

def private_path(path,*,directory=False):
    path=no_links(path);st=path.stat()
    if (not path.is_dir() if directory else not path.is_file() or st.st_nlink!=1):raise ValueError('Invalid private path.')
    if sys.platform=='linux' and (st.st_uid!=os.geteuid() or st.st_mode&0o077):raise ValueError('Private operator-owned paths are required.')
    return path

def new_run_directory(path,forbidden):
    path=no_links(path)
    for item in forbidden:
        other=no_links(item)
        if path==other or path in other.parents or other in path.parents:raise ValueError('Transfer paths overlap protected data.')
    if path.exists():raise ValueError('Transfer directory exists; retain it and use the explicit resume command.')
    path.mkdir(parents=True,mode=0o700)
    (path/'blobs').mkdir(mode=0o700)
    return path

def write_private_json(path,value):
    path=no_links(path);private_path(path.parent,directory=True)
    if path.exists():private_path(path)
    temp=path.parent/('.json-'+secrets.token_hex(12)+'.partial')
    with os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    temp.replace(path)

def read_private_json(path):
    path=private_path(path)
    if path.stat().st_size>32*CHUNK:raise ValueError('Private JSON exceeds size limit.')
    return json.loads(path.read_text(encoding='utf-8'))

def text(value,limit=4096):
    if not isinstance(value,str) or not 1<=len(value)<=limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid inventory text.')
    return value

def object_name(value):
    value=text(value)
    if '\\' in value or any(p in ('','.','..') for p in value.split('/')):raise ValueError('Ambiguous source object path.')
    return value

def validate_inventory(doc):
    if doc.get('version')!=1 or doc.get('project_ref')!=PROJECT or not re.fullmatch('[0-9a-f]{64}',doc.get('source_archive_sha256','')):
        raise ValueError('Inventory project/version/archive identity differs.')
    buckets=[];seen=set()
    for b in doc['buckets']:
        name=text(b['id'],100)
        if not re.fullmatch('[A-Za-z0-9_-]+',name) or name in seen or type(b['public']) is not bool:raise ValueError('Invalid bucket inventory.')
        seen.add(name);buckets.append({'id':name,'public':b['public']})
    objects=[];identities=set();ids=set()
    if len(doc['objects'])>20000:raise ValueError('Inventory object limit exceeded.')
    for o in doc['objects']:
        oid=text(o['id'],200);bucket=text(o['bucket'],100);name=object_name(o['name']);size=o['declared_size']
        if bucket not in seen or oid in ids or (bucket,name) in identities or (size is not None and (type(size) is not int or not 0<=size<=2**53)):
            raise ValueError('Invalid or duplicate object inventory.')
        ids.add(oid);identities.add((bucket,name))
        row={'id':oid,'bucket':bucket,'name':name,'snapshot_updated_at':text(o['snapshot_updated_at'],100),'declared_size':size}
        for key in ('snapshot_etag','snapshot_version'):
            row[key]=None if o.get(key) is None else text(o[key],1024)
        objects.append(row)
    return {'version':1,'project_ref':PROJECT,'source_archive_sha256':doc['source_archive_sha256'],
            'generated_at':text(doc['generated_at'],100),'buckets':buckets,'objects':objects}

def inventory_summary(doc):
    selected=[o for o in doc['objects'] if o['bucket'] in SELECTED_BUCKETS]
    return {'selected_objects':len(selected),'excluded_objects':len(doc['objects'])-len(selected),
            'known_bytes':sum(o['declared_size'] or 0 for o in selected),'unknown_sizes':sum(o['declared_size'] is None for o in selected),
            'buckets':[{'bucket':b['id'],'selected':b['id'] in SELECTED_BUCKETS,
                        'objects':sum(o['bucket']==b['id'] for o in doc['objects'])} for b in doc['buckets']]}

def export_inventory(docker,state,output,deploy):
    state=no_links(state)
    checkpoint=deploy.private_file(state/'deployment-checkpoint.json')
    checkpoint=json.loads(checkpoint.read_text())
    compose=json.loads(deploy.private_file(state/'runtime-compose.json').read_text())
    backup=Path(compose['services']['db']['volumes'][-1]['source'])
    fingerprint=deploy.runtime_fingerprint(docker,state,backup)
    proof=read_private_json(state/'candidate-verification.json');acceptance=read_private_json(state/'api-acceptance.json')
    if (acceptance.get('status')!='internal_validated_not_cut_over' or proof.get('status')!='permissions_restart_verified'
        or proof.get('runtime_fingerprint')!=fingerprint or proof.get('source_archive_sha256')!=checkpoint['source_archive_sha256']
        or acceptance.get('verification_attempt_id')!=proof.get('attempt_id')):
        raise ValueError('A matching accepted candidate is required for inventory export.')
    sql="""BEGIN READ ONLY;
SELECT json_build_object(
 'buckets',(SELECT coalesce(json_agg(json_build_object('id',id,'public',public) ORDER BY id),'[]'::json) FROM storage.buckets),
 'objects',(SELECT coalesce(json_agg(json_build_object('id',id,'bucket',bucket_id,'name',name,
   'snapshot_updated_at',updated_at,'declared_size',metadata->'size',
   'snapshot_etag',metadata->>'eTag','snapshot_version',to_jsonb(o)->>'version') ORDER BY bucket_id,name),'[]'::json)
   FROM (SELECT * FROM storage.objects ORDER BY bucket_id,name LIMIT 20001) o));
COMMIT;"""
    docker.phase='storage-inventory'
    # psql quiet mode avoids BEGIN/COMMIT tags in the JSON response.
    raw=docker.exec('psql','-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-U',deploy.rd.ADMIN,'-d',deploy.rd.DATABASE,input=sql)
    if len(raw)>32*CHUNK:raise ValueError('Inventory response exceeds size limit.')
    doc=json.loads(raw)
    for obj in doc['objects']:
        if isinstance(obj['declared_size'],str) and obj['declared_size'].isdigit():obj['declared_size']=int(obj['declared_size'])
    doc=validate_inventory({**doc,'version':1,'project_ref':PROJECT,'source_archive_sha256':checkpoint['source_archive_sha256'],'generated_at':now()})
    root=new_run_directory(output,[state,backup,deploy.ROOT,Path.home()/'village-deploy',Path.home()/'village-db-backups'])
    write_private_json(root/'inventory.json',doc)
    return inventory_summary(doc)
