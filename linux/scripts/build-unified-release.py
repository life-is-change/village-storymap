"""Assemble one verified offline image; no engine execution or production activation."""
from pathlib import Path
import argparse,copy,gzip,hashlib,importlib.util,io,json,re,subprocess,tarfile,tempfile

ROOT=Path(__file__).resolve().parents[2]
def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
image_builder=load('build-business-api-image');web=load('stage-web')
sha=image_builder.sha
def scene_sql(root):
 original=(Path(root)/'linux/sql/scene-files-candidate.sql').read_text(encoding='utf-8')
 marker='CREATE SCHEMA scene_files;'
 if original.count(marker)!=1:raise ValueError('Audited C2a schema boundary changed.')
 body=original[original.index(marker):].replace('village_scene_files_login','village_unified_login')
 guard="DO $$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'UNIFIED_TARGET_DATABASE_REQUIRED';END IF;END$$;\n"
 grants='\n'.join(re.findall(r'^grant execute on function public\.[^;]+;', (Path(root)/'supabase_SQL/Scene Edit Studio.sql').read_text(encoding='utf-8'),re.MULTILINE))
 if not grants or 'to authenticated' not in grants:raise ValueError('Scene RPC grant list unavailable.')
 helper="""
CREATE FUNCTION api_private.scene_upload_context(p jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $$DECLARE x jsonb:=p->'context';BEGIN
 IF api_private.profile_status()<>'active' THEN RETURN false;END IF;
 IF p->>'purpose'='version-preview' THEN RETURN public.can_read_scene_edit_project((x->>'projectId')::uuid) AND EXISTS(SELECT 1 FROM public.scene_edit_projects WHERE id=(x->>'projectId')::uuid AND revision=(x->>'revision')::bigint);END IF;
 IF x->>'scopeKind'='group' THEN RETURN public.is_scene_edit_group_member(x->>'groupId',x->>'courseId');END IF;
 RETURN x->>'scopeKind'='personal' AND EXISTS(SELECT 1 FROM public.group_memberships WHERE course_id=x->>'courseId' AND student_key=api_private.student_key());
END$$;
REVOKE ALL ON FUNCTION api_private.scene_upload_context(jsonb) FROM PUBLIC,anon,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.scene_upload_context(jsonb) TO authenticated;
CREATE FUNCTION api_private.scene_legacy_file(fid uuid,p_path text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public,storage,api_private,auth,pg_temp AS $$DECLARE result jsonb;BEGIN
 IF api_private.profile_status()<>'active' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF (fid IS NULL)=(p_path IS NULL) OR length(p_path)>4096 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 SELECT jsonb_build_object('id',o.id,'bucket',o.bucket_id,'name',o.name,'snapshot_updated_at',to_char(o.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'declared_size',o.metadata->'size','snapshot_etag',o.metadata->>'eTag','snapshot_version',to_jsonb(o)->>'version') INTO result
 FROM storage.objects o WHERE ((fid IS NOT NULL AND o.id=fid) OR (fid IS NULL AND o.name=p_path)) AND (
 (o.bucket_id='scene-assets' AND EXISTS(SELECT 1 FROM public.scene_edit_assets a WHERE (a.storage_path=o.name OR a.metadata->>'originalStoragePath'=o.name OR a.metadata->>'lowStoragePath'=o.name OR a.metadata->>'topViewPath'=o.name OR a.metadata->>'lowOriginalStoragePath'=o.name) AND public.can_read_scene_edit_asset(a.scope_kind,a.course_id,a.group_id,a.owner_id)))
 OR (o.bucket_id='scene-version-previews' AND EXISTS(SELECT 1 FROM public.scene_edit_versions v WHERE v.preview_path=o.name AND public.can_read_scene_edit_project(v.project_id)))) ORDER BY o.id LIMIT 1;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION api_private.scene_legacy_file(uuid,text) FROM PUBLIC,anon,village_unified_login;
GRANT EXECUTE ON FUNCTION api_private.scene_legacy_file(uuid,text) TO authenticated;
"""
 return guard+body+'\n'+grants+'\n'+helper+"\nGRANT SELECT ON public.scene_edit_projects,public.scene_edit_versions,public.scene_edit_assets,public.scene_edit_components TO authenticated;\n"
def stage_release(root,target,*,instance_id,release_id):
 target=Path(target)
 if target.exists():raise ValueError('Static output exists; never overwrite a release.')
 if not re.fullmatch(r'aliyun-[a-zA-Z0-9_-]{1,92}',instance_id) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',release_id):raise ValueError('Invalid deployment identity.')
 web.stage(root,target)
 config={'mode':'aliyun','stage':'candidate','instanceId':instance_id,'apiBase':'/api/v1','releaseId':release_id}
 (target/'deployment-config.js').write_text('globalThis.VILLAGE_DEPLOYMENT=Object.freeze('+json.dumps(config,separators=(',',':'))+');\n',encoding='utf-8',newline='\n')
 return config
def digest_files(files):
 h=hashlib.sha256()
 for name,data in sorted(files):h.update(name.encode()+b'\0'+data+b'\0')
 return h.hexdigest()
def runtime_files(root):
 root=Path(root);api=root/'business-api';items=[]
 if not (api/'node_modules/pg/package.json').is_file():raise ValueError('Verified npm ci runtime dependencies required.')
 for name in ['package.json','package-lock.json']:
  p=api/name
  if p.is_symlink():raise ValueError('Linked runtime file.')
  items.append(('business-api/'+name,p.read_bytes().replace(b'\r\n',b'\n')))
 for directory in ['src','scene','scene-files','unified','node_modules']:
  for p in sorted((api/directory).rglob('*')):
   rel=p.relative_to(api)
   if any(x.startswith('.') or x in {'test','tests','__tests__'} for x in rel.parts):continue
   if p.is_symlink() or p.suffix.lower() in {'.node','.dll','.exe'}:raise ValueError('Native or linked runtime dependency requires a Linux build.')
   if '.test.' in p.name or '.spec.' in p.name:continue
   if directory=='node_modules' and p.suffix not in {'.js','.mjs','.cjs','.json','.md','.txt'} and p.name not in {'LICENSE','NOTICE'}:continue
   if p.is_file():items.append(('business-api/'+rel.as_posix(),p.read_bytes().replace(b'\r\n',b'\n') if p.suffix in {'.js','.mjs','.cjs','.json','.md','.txt'} else p.read_bytes()))
 for name in ['features/mc/mc-bridge.js','features/admin/village-package.js']:
  p=root/name
  if p.is_symlink():raise ValueError('Linked first-party module.')
  items.append((name,p.read_bytes().replace(b'\r\n',b'\n')))
 return items
def build_release(root,baseArchive,output,*,instance_id='aliyun-village',release_id=None):
 root=Path(root).resolve();output=Path(output)
 if output.exists():raise ValueError('Output already exists; choose a new archive name.')
 git=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
 if subprocess.check_output(['git','status','--porcelain','--untracked-files=normal'],cwd=root,text=True).strip():raise ValueError('Commit the reviewed source before building a release.')
 release_id=release_id or 'unified-'+git[:12]
 base,layers=image_builder.validate_base(baseArchive);base=copy.deepcopy(base)
 runtime=runtime_files(root);schemas=[(p.name,p.read_bytes().replace(b'\r\n',b'\n')) for p in sorted((root/'linux/sql/unified').glob('*.sql')) if p.name!='scene.sql']
 schemas.append(('scene.sql',scene_sql(root).encode()))
 with tempfile.TemporaryDirectory(prefix='village-unified-build-') as temp:
  staged=Path(temp)/'web';stage_release(root,staged,instance_id=instance_id,release_id=release_id)
  static=[(p.relative_to(staged).as_posix(),p.read_bytes()) for p in sorted(staged.rglob('*')) if p.is_file()]
  release={'releaseId':release_id,'git_sha':git,'schemaVersion':1,'code_sha256':digest_files(runtime),'schema_sha256':digest_files(schemas),'static_sha256':digest_files(static),'instanceId':instance_id,'os':'linux','architecture':'amd64'}
  stream=io.BytesIO()
  with tarfile.open(fileobj=stream,mode='w') as t:
   for name,data in runtime:image_builder.add(t,'opt/village/'+name,data)
   for name,data in static:image_builder.add(t,'opt/village-web/'+name,data)
   for name,data in schemas:image_builder.add(t,'opt/village-schema/'+name,data)
   image_builder.add(t,'opt/village/business-api/release.json',image_builder.encoded(release))
  raw=stream.getvalue();blob=gzip.compress(raw,mtime=0);layers.append((sha(blob)+'.tar.gz',blob,len(raw),sha(raw)))
 base['rootfs']['diff_ids'].append('sha256:'+sha(raw));image='village-unified:'+git[:12]
 base['config'].update({'WorkingDir':'/opt/village/business-api','User':'1000:1000','Entrypoint':None,'Cmd':['node','unified/main.mjs']})
 base['config'].setdefault('Labels',{}).update({'village.release':release_id,'village.api.code-sha256':release['code_sha256'],'org.opencontainers.image.source':'https://github.com/life-is-change/village-storymap'})
 base.setdefault('history',[]).append({'created':'2026-10-20T00:00:00Z','created_by':'verified Node22 base and committed unified source'})
 config=image_builder.encoded(base);config_sha=sha(config);manifest=[{'Config':config_sha+'.json','RepoTags':[image],'Layers':[x[0] for x in layers]}]
 output.parent.mkdir(parents=True,exist_ok=True)
 with output.open('xb') as target,gzip.GzipFile(fileobj=target,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|') as t:
  image_builder.add(t,config_sha+'.json',config);image_builder.add(t,'manifest.json',image_builder.encoded(manifest))
  for name,data,_,_ in layers:image_builder.add(t,name,data)
 with output.open('rb') as f:archive_hash=hashlib.file_digest(f,'sha256').hexdigest()
 return {**release,'image':image,'base_manifest':image_builder.BASE,'accepted_image_ids':image_builder.manifest_image_ids(config,layers),'archive_filename':output.name,'archive_bytes':output.stat().st_size,'archive_sha256':archive_hash,'runtime_execution':'pending_linux_container_smoke_test'}
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-archive',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--instance-id',default='aliyun-village');args=p.parse_args()
 meta=build_release(ROOT,args.base_archive,args.output,instance_id=args.instance_id)
 (ROOT/'linux/unified-release.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
 print('UNIFIED_ARCHIVE_ASSEMBLED_NOT_RUNTIME_VERIFIED');print('archive_sha256='+meta['archive_sha256'])
if __name__=='__main__':main()
