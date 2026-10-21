"""Inspect source archives offline; preserve the archive's own storage snapshot."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import business_storage_copy as storage

COPY=re.compile(r'^COPY storage\."?(buckets|objects)"? \(([^)]+)\) FROM stdin;$')


def load_script(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def decode_copy(value):
    if value==r'\N':return None
    out=[];pos=0;escapes={'b':'\b','f':'\f','n':'\n','r':'\r','t':'\t','v':'\v','\\':'\\'}
    while pos<len(value):
        char=value[pos];pos+=1
        if char!='\\':out.append(char);continue
        if pos>=len(value) or value[pos] not in escapes:raise ValueError('STORAGE_COPY_ESCAPE_UNSUPPORTED')
        out.append(escapes[value[pos]]);pos+=1
    return ''.join(out)


def storage_timestamp(value):
    if not isinstance(value,str):raise ValueError('STORAGE_TIMESTAMP_REQUIRED')
    try:
        parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        if parsed.tzinfo is None:raise ValueError()
        return parsed.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    except (ValueError,OverflowError):raise ValueError('STORAGE_TIMESTAMP_REQUIRED') from None


def inventory_from_copy(lines,*,archive_sha256,generated_at):
    seen=set();table=None;columns=[];buckets=[];objects=[]
    for raw in lines:
        if len(raw)>2*storage.CHUNK:raise ValueError('STORAGE_COPY_RECORD_TOO_LARGE')
        line=raw.rstrip('\r\n')
        if table is None:
            match=COPY.fullmatch(line)
            if match:
                table=match[1];columns=[s.strip().strip('"') for s in match[2].split(',')]
                if table in seen or len(columns)!=len(set(columns)):raise ValueError('STORAGE_COPY_FORMAT_UNSUPPORTED')
                seen.add(table)
            elif line.startswith('COPY '):raise ValueError('STORAGE_COPY_FORMAT_UNSUPPORTED')
            continue
        if line==r'\.':table=None;continue
        values=line.split('\t')
        if len(values)!=len(columns):raise ValueError('STORAGE_COPY_FORMAT_UNSUPPORTED')
        row=dict(zip(columns,map(decode_copy,values)))
        if table=='buckets':
            if row.get('public') not in ('t','f'):raise ValueError('STORAGE_BUCKET_FORMAT_UNSUPPORTED')
            buckets.append({'id':row.get('id'),'public':row['public']=='t'})
            if len(buckets)>1000:raise ValueError('STORAGE_BUCKET_LIMIT')
        else:
            try:metadata=json.loads(row.get('metadata') or '{}')
            except (ValueError,TypeError):raise ValueError('STORAGE_METADATA_FORMAT_UNSUPPORTED') from None
            if not isinstance(metadata,dict):raise ValueError('STORAGE_METADATA_FORMAT_UNSUPPORTED')
            size=metadata.get('size')
            if isinstance(size,str) and size.isdigit():size=int(size)
            objects.append({'id':row.get('id'),'bucket':row.get('bucket_id'),'name':row.get('name'),
                'declared_size':size,'snapshot_etag':metadata.get('eTag'),'snapshot_version':row.get('version'),
                'snapshot_updated_at':storage_timestamp(row.get('updated_at'))})
            if len(objects)>20000:raise ValueError('STORAGE_OBJECT_LIMIT')
    if table is not None or seen!={'buckets','objects'}:raise ValueError('STORAGE_COPY_INCOMPLETE')
    return storage.validate_inventory({'version':1,'project_ref':storage.PROJECT,'source_archive_sha256':archive_sha256,
        'generated_at':generated_at,'buckets':buckets,'objects':objects})


def validate_fresh_snapshot(manifest,*,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    if manifest.get('source')!={'host':'aws-1-ap-northeast-1.pooler.supabase.com','database':'postgres','user':'postgres.'+storage.PROJECT}:
        raise ValueError('FIXED_SOURCE_SNAPSHOT_REQUIRED')
    try:
        start=dt.datetime.fromisoformat(manifest['started_at_utc']);end=dt.datetime.fromisoformat(manifest['completed_at_utc'])
        if start.tzinfo is None or end.tzinfo is None or start>end or end>now+dt.timedelta(minutes=5):raise ValueError()
        age=(now-start).total_seconds()
        if not 0<=age<24*3600:raise ValueError()
    except (KeyError,TypeError,ValueError):raise ValueError('FRESH_SNAPSHOT_WITHIN_24H_REQUIRED') from None
    return {'snapshot_age_hours':round(age/3600,2),'archive_completed_at':end.isoformat()}


def offline_restore_command(backup,*,image_id,schema,tables,uid,gid):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',image_id or '') or schema not in ('storage','auth') or uid<=0 or gid<0:
        raise ValueError('PINNED_OFFLINE_DECODER_REQUIRED')
    if not tables or any(not re.fullmatch('[a-z_]+',t) for t in tables):raise ValueError('FIXED_ARCHIVE_TABLES_REQUIRED')
    return ['sudo','-n','docker','--context','default','run','--rm','--pull=never','--network','none','--read-only',
        '--user',f'{uid}:{gid}','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--memory-swap','256m','--pids-limit','32',
        '--mount',f'type=bind,source={Path(backup).absolute()},target=/restore,readonly',
        '--entrypoint','pg_restore',image_id,'--data-only','--no-owner','--no-privileges','--schema='+schema,
        *('--table='+t for t in tables),'--file=-','/restore/database.dump']


def decode_stream(command,consumer,*,env=None):
    # Only an offline pg_restore process is launched: no database server and no
    # network. No decoded password hashes or private storage paths are printed.
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',env=env)
    def lines():
        while True:
            line=process.stdout.readline(2*storage.CHUNK+1)
            if not line:break
            if len(line)>2*storage.CHUNK:raise ValueError('ARCHIVE_RECORD_LIMIT')
            yield line
    try:
        result=consumer(lines())
        if process.wait(timeout=30):raise ValueError('ARCHIVE_OFFLINE_DECODE_FAILED')
        return result
    finally:
        if process.poll() is None:process.kill()
        process.wait();process.stdout.close()
