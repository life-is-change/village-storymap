#!/usr/bin/env python3
"""Build the complete local-Auth release from committed, matching-CI source."""
import argparse
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from autonomous_bundle import load_script
from autonomous_schema import schema_bundle

ROOT=Path(__file__).resolve().parents[2]
CONTROLS=('deploy-autonomous.py','autonomous_operator.py','autonomous_compose.py','autonomous_schema.py','autonomous_extract.py',
    'autonomous_bundle.py','business_storage_copy.py','restore-db-copy.py','prepare-local-auth.py','autonomous_tls.py','prepare-ip-tls.py',
    'backup-autonomous.py','autonomous_private_ops.py','reset-local-password.py','maintain-autonomous.py','provision-local-workers.py','probe-autonomous.py','probe-unified-business.py')


def test_context_template(root):
    sql=(Path(root)/'linux/sql/scene-files-test-context.sql').read_text(encoding='utf-8')
    replacements={'village_scene_files_validation':'village_unified_candidate','c2a-test-20261019':'autonomous-test-20261021',
        'c2a-test-group-20261019':'autonomous-test-group-20261021','c2a-test-space-20261019':'autonomous-test-space-20261021',
        'c2a00000':'c4a00000','C2a TEST':'Autonomous TEST',"student_id='332'":"id='__ADMIN_ID__'", 
        "student_id='25213040'":"id='__MEMBER_ID__'",'__BEGIN__':'BEGIN;',
        '__BOUNDARY_EWKT__':'SRID=4326;MULTIPOLYGON(((112.999 22.999,113.001 22.999,113.001 23.001,112.999 23.001,112.999 22.999)))',"'group_plan'":"'practice_shared'"}
    for before,after in replacements.items():sql=sql.replace(before,after)
    return sql


def stage_autonomous(root,target,*,release_id):
    if not re.fullmatch(r'autonomous-[a-f0-9]{12}',release_id):raise ValueError('AUTONOMOUS_RELEASE_ID_REQUIRED')
    load_script('stage-web').stage(root,target)
    # Windows autocrlf must not produce a different runtime than Linux CI.
    # Normalize only staged text assets; source files and binary models stay intact.
    text_suffixes={'.html','.js','.css','.json','.geojson','.svg','.csv','.gltf','.czml','.xml','.md'}
    for path in Path(target).rglob('*'):
        if path.is_file() and path.suffix.lower() in text_suffixes:
            raw=path.read_bytes()
            if b'\r\n' in raw:path.write_bytes(raw.replace(b'\r\n',b'\n'))
    config={'mode':'aliyun','stage':'candidate','instanceId':'aliyun-village','apiBase':'/api/v1','releaseId':release_id,
        'auth':{'version':1,'mode':'local','path':'/auth/v1','publicKey':'village-local-public-v1'}}
    (Path(target)/'deployment-config.js').write_text('globalThis.VILLAGE_DEPLOYMENT=Object.freeze('+json.dumps(config,separators=(',',':'))+');\n',encoding='utf-8',newline='\n')
    return config


def api_release(meta):
    if meta.get('schemaVersion')!=2 or meta.get('kind')!='autonomous':raise ValueError('AUTONOMOUS_RELEASE_REQUIRED')
    # The package format is v2. The already tested API installation contract is
    # v1; using the package's version here would prevent the service starting.
    return {key:meta[key] for key in ('releaseId','instanceId','code_sha256','schema_sha256')}|{'schemaVersion':1,'authMode':'local'}


def control_files(root):
    root=Path(root);result=[]
    for name in CONTROLS:
        path=root/'linux/scripts'/name
        if not path.is_file() or path.is_symlink():raise ValueError('COMPLETE_AUTONOMOUS_CONTROLS_REQUIRED')
        result.append((name,path.read_bytes().replace(b'\r\n',b'\n')))
    for name in ('auth-runtime.json','certbot-runtime.json','nginx-runtime.json','nginx.autonomous.conf'):
        path=root/'linux'/name
        if not path.is_file() or path.is_symlink():raise ValueError('COMPLETE_AUTONOMOUS_CONTROLS_REQUIRED')
        result.append((name,path.read_bytes().replace(b'\r\n',b'\n')))
    result.append(('autonomous-test-context.sql',test_context_template(root).replace('\r\n','\n').encode()))
    result.append(('unified-operation-routes.json',(root/'linux/unified-operation-routes.json').read_bytes().replace(b'\r\n',b'\n')))
    return result


def source_defaults(root):
    root=Path(root);paths=[root/'deployment-config.js',*sorted((root/'supabase/functions').rglob('*'))]
    result={}
    for path in paths:
        if path.is_symlink():raise ValueError('LINKED_SOURCE_DEFAULT')
        if path.is_file():result[path.relative_to(root).as_posix()]=hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    return result


def build(root,base_archive,output,*,native_run,platform_run):
    root=Path(root).resolve();output=Path(output)
    if output.exists():raise ValueError('RELEASE_ARCHIVE_EXISTS')
    if subprocess.check_output(['git','status','--porcelain','--untracked-files=normal'],cwd=root,text=True).strip():raise ValueError('COMMITTED_AUTONOMOUS_SOURCE_REQUIRED')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    old=load_script('build-unified-release');builder=load_script('build-business-api-image')
    validation=old.verified_ci(commit,native_run,platform_run)
    runtime=old.runtime_files(root);schemas=[(name,sql.replace('\r\n','\n').encode()) for name,sql in schema_bundle(root).items()];controls=control_files(root)
    base,layers=builder.validate_base(base_archive);base=copy.deepcopy(base)
    auth=json.loads((root/'linux/auth-runtime.json').read_text());nginx=json.loads((root/'linux/nginx-runtime.json').read_text())
    certbot=json.loads((root/'linux/certbot-runtime.json').read_text())
    for meta in (auth,nginx,certbot):
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',meta.get('image_id','')) or (meta.get('os'),meta.get('architecture'))!=('linux','amd64'):raise ValueError('PINNED_PLATFORM_RUNTIMES_REQUIRED')
    release_id='autonomous-'+commit[:12]
    with tempfile.TemporaryDirectory(prefix='village-autonomous-build-') as directory:
        staged=Path(directory)/'web';stage_autonomous(root,staged,release_id=release_id)
        static=[(path.relative_to(staged).as_posix(),path.read_bytes()) for path in sorted(staged.rglob('*')) if path.is_file()]
        meta={'schemaVersion':2,'kind':'autonomous','releaseId':release_id,'instanceId':'aliyun-village','git_sha':commit,
            'os':'linux','architecture':'amd64','code_sha256':old.digest_files(runtime),'schema_sha256':old.digest_files(schemas),
            'static_sha256':old.digest_files(static),'control_sha256':old.digest_files(controls),'schema_steps':[name for name,_ in schemas],
            'auth_image_id':auth['image_id'],'nginx_image_id':nginx['image_id'],
            'postgres_image_id':'sha256:291367a26b42e028341d7f19b91dffa818c10e9ada6fa9022796a87b57028631',
            'auth_accepted_image_ids':auth.get('accepted_image_ids',[auth['image_id']]),'nginx_accepted_image_ids':nginx.get('accepted_image_ids',[nginx['image_id']]),
            'postgres_accepted_image_ids':sorted(load_script('restore-db-copy').IMAGE_IDS),
            'source_defaults':source_defaults(root),'validation':validation}
        meta['validation'].update({key:meta[key] for key in ('code_sha256','schema_sha256','static_sha256','control_sha256')})
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w') as tar:
            for prefix,items in [('opt/village/',runtime),('opt/village-web/',static),('opt/village-schema/',schemas),('opt/village-control/',controls)]:
                for name,data in items:builder.add(tar,prefix+name,data)
            builder.add(tar,'opt/village/business-api/release.json',builder.encoded(api_release(meta)))
        raw=stream.getvalue();blob=gzip.compress(raw,mtime=0);layers.append((builder.sha(blob)+'.tar.gz',blob,len(raw),builder.sha(raw)))
    base['rootfs']['diff_ids'].append('sha256:'+builder.sha(raw));image='village-autonomous:'+commit[:12]
    base['config'].update(WorkingDir='/opt/village/business-api',User='1000:1000',Entrypoint=None,Cmd=['node','unified/main.mjs'])
    base['config'].setdefault('Labels',{}).update({'village.release':release_id,'village.api.code-sha256':meta['code_sha256'],
        'village.autonomous.runtime':'local-v1','org.opencontainers.image.source':'https://github.com/life-is-change/village-storymap'})
    base.setdefault('history',[]).append({'created_by':'committed autonomous source and verified Node22 base','created':'2026-10-21T00:00:00Z'})
    config=builder.encoded(base);digest=builder.sha(config)
    manifest=[{'Config':digest+'.json','RepoTags':[image],'Layers':[item[0] for item in layers]}]
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('xb') as target,gzip.GzipFile(fileobj=target,mode='wb',mtime=0) as compressed,tarfile.open(fileobj=compressed,mode='w|') as tar:
        builder.add(tar,digest+'.json',config);builder.add(tar,'manifest.json',builder.encoded(manifest))
        for name,data,_,_ in layers:builder.add(tar,name,data)
    with output.open('rb') as source:archive_hash=hashlib.file_digest(source,'sha256').hexdigest()
    return meta|{'image':image,'accepted_image_ids':builder.manifest_image_ids(config,layers),'base_manifest':builder.BASE,
        'archive_filename':output.name,'archive_bytes':output.stat().st_size,'archive_sha256':archive_hash,
        'runtime_execution':'pending_disposable_complete_release_test'}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base-archive',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--native-run',type=int,required=True);parser.add_argument('--platform-run',type=int,required=True);args=parser.parse_args()
    meta=build(ROOT,args.base_archive,args.output,native_run=args.native_run,platform_run=args.platform_run)
    (ROOT/'linux/autonomous-release.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    print('AUTONOMOUS_ARCHIVE_BUILT_NOT_DEPLOYED');print('archive_sha256='+meta['archive_sha256'])


if __name__=='__main__':main()
