"""Private, read-only Supabase object transfer helpers. Never print secrets or paths."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import base64
import shutil
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import http.client

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

def all_inventory_buckets(doc):
    return frozenset(b['id'] for b in validate_inventory(doc)['buckets'])

def selection(doc,selected_buckets=None):
    if selected_buckets is None:return frozenset(SELECTED_BUCKETS)
    selected=frozenset(selected_buckets)
    if not selected.issubset(all_inventory_buckets(doc)):raise ValueError('UNKNOWN_STORAGE_SCOPE')
    return selected

def inventory_summary(doc,*,selected_buckets=None):
    scope=selection(doc,selected_buckets)
    selected=[o for o in doc['objects'] if o['bucket'] in scope]
    return {'selected_objects':len(selected),'excluded_objects':len(doc['objects'])-len(selected),
            'known_bytes':sum(o['declared_size'] or 0 for o in selected),'unknown_sizes':sum(o['declared_size'] is None for o in selected),
            'buckets':[{'bucket':b['id'],'selected':b['id'] in scope,
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

def credential_headers(key):
    if not isinstance(key,str) or len(key)>8192:raise ValueError('A server API key is required.')
    headers={'apikey':key,'User-Agent':'village-storage-transfer/1','Accept-Encoding':'identity'}
    if re.fullmatch(r'sb_secret_[A-Za-z0-9_-]{16,256}',key):return headers
    try:
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',key):raise ValueError()
        payload=key.split('.')[1];claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        if not isinstance(claims,dict) or claims.get('role')!='service_role' or claims.get('ref',PROJECT)!=PROJECT:raise ValueError()
    except (ValueError,TypeError,KeyError):raise ValueError('Use a Secret key or legacy service_role key, not a database password or publishable key.') from None
    headers['Authorization']='Bearer '+key
    return headers

class SourceFailure(RuntimeError):
    def __init__(self,status):
        self.status=status if type(status) is int and 0<=status<=599 else 0
        super().__init__('STORAGE_SOURCE_HTTP_'+str(self.status) if self.status else 'STORAGE_SOURCE_CONNECTION_FAILED')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError('Source redirects are not accepted.')

class SourceTransport:
    def __init__(self,key,opener=None,*,selected_buckets=None):
        self.headers=credential_headers(key)
        self.selected_buckets=frozenset(SELECTED_BUCKETS if selected_buckets is None else selected_buckets)
        if any(not re.fullmatch('[A-Za-z0-9_-]+',b) for b in self.selected_buckets):raise ValueError('INVALID_STORAGE_SCOPE')
        self.opener=opener or urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ssl.create_default_context()),NoRedirect())

    def _json(self,path,body=None):
        data=None if body is None else json.dumps(body).encode()
        request=urllib.request.Request(ORIGIN+'/storage/v1/'+path,data=data,
                headers={**self.headers,'Content-Type':'application/json'},method='GET' if body is None else 'POST')
        try:
            with self.opener.open(request,timeout=30) as response:
                if getattr(response,'status',200)!=200:raise SourceFailure(0)
                raw=response.read(8*CHUNK+1)
                if len(raw)>8*CHUNK:raise ValueError('SOURCE_LIST_RESPONSE_TOO_LARGE')
                value=json.loads(raw)
                if not isinstance(value,list):raise ValueError('SOURCE_LIST_INVALID')
                return value
        except urllib.error.HTTPError as e:
            status=e.code;e.close();raise SourceFailure(status) from None
        except (OSError,http.client.HTTPException):raise SourceFailure(0) from None

    def verify_inventory(self,doc):
        doc=validate_inventory(doc)
        # Check every bucket, including empty buckets, rather than silently
        # projecting a changed source onto the old snapshot's five-bucket scope.
        rows=self._json('bucket');actual=[text(row.get('id'),100) for row in rows]
        if len(actual)!=len(set(actual)) or set(actual)!=all_inventory_buckets(doc):raise ValueError('SOURCE_INVENTORY_CHANGED')
        expected={(o['bucket'],o['name'],o['id']) for o in doc['objects']};found=set();calls=0
        for bucket in sorted(actual):
            pending=[''];folders=set();names=set()
            while pending:
                prefix=pending.pop()
                if prefix in folders:raise ValueError('SOURCE_LIST_DUPLICATE_FOLDER')
                folders.add(prefix);offset=0
                while True:
                    calls+=1
                    if calls>20000 or len(folders)>20000:raise ValueError('SOURCE_LIST_LIMIT')
                    page=self._json('object/list/'+bucket,{'prefix':prefix,'limit':1000,'offset':offset,'sortBy':{'column':'name','order':'asc'}})
                    if len(page)>1000:raise ValueError('SOURCE_LIST_LIMIT')
                    for row in page:
                        segment=text(row.get('name'))
                        if '/' in segment:raise ValueError('SOURCE_LIST_AMBIGUOUS_NAME')
                        name=object_name(prefix+segment)
                        if name in names:raise ValueError('SOURCE_LIST_DUPLICATE_NAME')
                        names.add(name)
                        if len(names)>40000 or len(found)>20000 or len(name.split('/'))>64:raise ValueError('SOURCE_LIST_LIMIT')
                        if row.get('id') is None:pending.append(name+'/')
                        else:found.add((bucket,name,text(row['id'],200)))
                    if len(page)<1000:break
                    offset+=1000
        if found!=expected:raise ValueError('SOURCE_INVENTORY_CHANGED')
        return {'buckets':len(actual),'objects':len(found)}

    def _open(self,obj,method,etag=None):
        if obj['bucket'] not in self.selected_buckets:raise ValueError('Excluded bucket cannot be downloaded.')
        name=object_name(obj['name'])
        url=ORIGIN+'/storage/v1/object/authenticated/'+obj['bucket']+'/'+urllib.parse.quote(name,safe='/')
        headers={**self.headers,**({'If-Match':etag} if etag is not None else {})}
        for attempt in range(3):
            try:
                response=self.opener.open(urllib.request.Request(url,headers=headers,method=method),timeout=30)
                if getattr(response,'status',200)!=200:response.close();raise ValueError('Unexpected source response.')
                return response
            except urllib.error.HTTPError as e:
                status=e.code;e.close()
                if status not in (429,500,502,503,504) or attempt==2:raise SourceFailure(status) from None
            except (OSError,http.client.HTTPException) as e:
                reason=e.reason if isinstance(e,urllib.error.URLError) else e
                if isinstance(reason,ssl.SSLError) or attempt==2:raise SourceFailure(0) from None
            time.sleep(attempt+1)
        raise SourceFailure(0)
    def head(self,obj):
        with self._open(obj,'HEAD') as response:
            length=response.headers.get('Content-Length','');etag=response.headers.get('ETag')
            if not re.fullmatch(r'\d+',length) or not etag or etag.startswith('W/'):
                raise ValueError('Source must provide a length and stable ETag.')
            return {'size':int(length),'etag':text(etag,1024),'last_modified':response.headers.get('Last-Modified')}
    def get(self,obj,etag):return self._open(obj,'GET',etag)

def digest_file(path):
    h=hashlib.sha256();size=0
    with private_path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(CHUNK),b''):h.update(chunk);size+=len(chunk)
    return h.hexdigest(),size

def inventory_digest(doc):return hashlib.sha256(json.dumps(doc,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def load_transfer(root,*,selected_buckets=None):
    root=private_path(root,directory=True);private_path(root/'blobs',directory=True)
    for protected in (Path(__file__).resolve().parents[2],Path.home()/'village-deploy',Path.home()/'village-db-backups',Path.home()/'village-api-validation'):
        p=no_links(protected)
        if root==p or root in p.parents or p in root.parents:raise ValueError('Transfer directory overlaps protected data.')
    doc=validate_inventory(read_private_json(root/'inventory.json'))
    scope=selection(doc,selected_buckets)
    objects=[o for o in doc['objects'] if o['bucket'] in scope]
    path=root/'copy-manifest.json'
    if path.exists():
        manifest=read_private_json(path)
        if manifest.get('version')!=1 or manifest.get('inventory_sha256')!=inventory_digest(doc) or set(manifest.get('records',{}))!={o['id'] for o in objects}:
            raise ValueError('Copy manifest differs from inventory.')
        if frozenset(manifest.get('selected_buckets',SELECTED_BUCKETS))!=scope:raise ValueError('Copy manifest differs from selected scope.')
    else:manifest={'version':1,'inventory_sha256':inventory_digest(doc),'selected_buckets':sorted(scope),'records':{o['id']:{'status':'pending','needs_final_refresh':True} for o in objects}}
    for row in manifest['records'].values():
        if row.get('status') not in ('pending','copied','source_changed','missing','failed'):raise ValueError('Invalid transfer state.')
        if row['status']=='copied':
            digest=row.get('sha256','');size=row.get('received_bytes')
            if not re.fullmatch('[0-9a-f]{64}',digest) or type(size) is not int or size<0:raise ValueError('Invalid completed object record.')
            if digest_file(root/'blobs'/digest)!=(digest,size):raise ValueError('Completed object failed local checksum verification.')
    return doc,objects,manifest

def transfer_summary(doc,manifest,*,selected_buckets=None):
    result={status:sum(r['status']==status for r in manifest['records'].values()) for status in ('pending','copied','source_changed','missing','failed')}
    return {**inventory_summary(doc,selected_buckets=selected_buckets),**result,'verified_bytes':sum(r['received_bytes'] for r in manifest['records'].values() if r['status']=='copied')}

def acquire_transfer_lock(root):
    lock=private_path(root,directory=True)/'.transfer.lock'
    try:fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError:raise RuntimeError('STORAGE_TRANSFER_LOCKED') from None
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump({'pid':os.getpid(),'started_at':now()},stream)
    return lock

def verify_copy(run_directory,*,selected_buckets=None):
    root=private_path(run_directory,directory=True)
    lock=acquire_transfer_lock(root)
    try:
        doc,objects,manifest=load_transfer(root,selected_buckets=selected_buckets)
        result=transfer_summary(doc,manifest,selected_buckets=selected_buckets)
        done=(root/'copy-manifest.json').is_file() and all(r['status']=='copied' for r in manifest['records'].values())
        return {**result,'status':'private_copy_verified_not_cut_over' if done else 'private_copy_incomplete'}
    finally:lock.unlink()

def check_disk(root,needed):
    if shutil.disk_usage(root).free<RESERVE+needed+CHUNK:raise RuntimeError('STORAGE_DISK_RESERVE_REQUIRED')

def copy_inventory(inventory_path,output_root,credential,transport=None,*,selected_buckets=None,check_source_inventory=False):
    root=private_path(output_root,directory=True)
    if no_links(inventory_path)!=root/'inventory.json':raise ValueError('Use the inventory in the selected private run directory.')
    credential_headers(credential)
    transport=transport or SourceTransport(credential,selected_buckets=selected_buckets)
    lock=acquire_transfer_lock(root)
    try:
        doc,objects,manifest=load_transfer(root,selected_buckets=selected_buckets)
        if check_source_inventory:transport.verify_inventory(doc)
        write_private_json(root/'copy-manifest.json',manifest)
        heads={}
        # Resolve all lengths before allocating files, including unknown snapshot sizes.
        for obj in objects:
            row=manifest['records'][obj['id']]
            # Once change is observed, only a later explicit refresh/new run may
            # replace its identity. Resume must retain the original SHA/ETag.
            if row['status']=='source_changed':continue
            try:head=transport.head(obj)
            except SourceFailure as e:
                row.update(status='missing' if e.status==404 else 'failed',error_code='http_'+str(e.status),checked_at=now())
                write_private_json(root/'copy-manifest.json',manifest)
                if e.status!=404:raise
                continue
            if type(head.get('size')) is not int or head['size']<0 or not head.get('etag'):raise ValueError('Invalid source metadata.')
            snapshot_etag=obj['snapshot_etag']
            changed=(obj['declared_size'] is not None and obj['declared_size']!=head['size']) or (snapshot_etag is not None and snapshot_etag.strip('"')!=head['etag'].strip('"'))
            if row.get('sha256') and row.get('source_etag')!=head['etag']:changed=True
            if changed:
                row.update(status='source_changed',checked_at=now());write_private_json(root/'copy-manifest.json',manifest);continue
            if row['status']!='copied':heads[obj['id']]=head
        check_disk(root,sum(h['size'] for h in heads.values()))
        for obj in objects:
            if obj['id'] not in heads:continue
            before=heads[obj['id']];row=manifest['records'][obj['id']]
            temp=root/('.download-'+secrets.token_hex(12)+'.partial')
            try:
                count=0;hasher=hashlib.sha256()
                with transport.get(obj,before['etag']) as response,os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as out:
                    if response.headers.get('ETag')!=before['etag']:raise ValueError('Object changed before transfer.')
                    for block in iter(lambda:response.read(CHUNK),b''):
                        count+=len(block)
                        if count>before['size']:raise ValueError('Object exceeded expected length.')
                        check_disk(root,len(block));out.write(block);hasher.update(block)
                    out.flush();os.fsync(out.fileno())
                if count!=before['size']:raise ValueError('Incomplete object transfer.')
                after=transport.head(obj)
                if (after['etag'],after['size'])!=(before['etag'],before['size']):
                    row.update(status='source_changed',checked_at=now());continue
                digest=hasher.hexdigest()
                if digest_file(temp)!=(digest,count):raise ValueError('Downloaded bytes failed disk checksum.')
                target=root/'blobs'/digest
                if target.exists():
                    if digest_file(target)!=(digest,count):raise ValueError('Content-addressed object is corrupt.')
                    # Keep the duplicate partial as private evidence; never overwrite an object.
                else:temp.rename(target)
                row.update(status='copied',received_bytes=count,sha256=digest,source_etag=before['etag'],source_last_modified=before.get('last_modified'),checked_at=now(),needs_final_refresh=True)
                row.pop('error_code',None)
            except SourceFailure as e:
                row.update(status='source_changed' if e.status==412 else 'missing' if e.status==404 else 'failed',error_code='http_'+str(e.status),checked_at=now())
                if e.status not in (404,412):raise
            except (OSError,ValueError,http.client.HTTPException):row.update(status='failed',error_code='transfer_or_integrity',checked_at=now())
            finally:write_private_json(root/'copy-manifest.json',manifest)
        if check_source_inventory:
            transport.verify_inventory(doc)
            # A later object changing while an earlier one downloads also fails
            # the final gate. Previously copied receipts retain their digest.
            for obj in objects:
                row=manifest['records'][obj['id']]
                if row['status']!='copied':continue
                head=transport.head(obj)
                if (head['etag'],head['size'])!=(row['source_etag'],row['received_bytes']):
                    row.update(status='source_changed',checked_at=now())
            write_private_json(root/'copy-manifest.json',manifest)
        return transfer_summary(doc,manifest,selected_buckets=selected_buckets)
    finally:lock.unlink()
