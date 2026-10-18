import {executeOperation} from '../scene/database.mjs';import {parseOperation} from '../scene/contracts.mjs';
import {fault,fields,uuid,text} from './contracts.mjs';import {queryOne} from './database.mjs';import {parseCommitInput} from './uploads.mjs';import {validateSceneDocument,validateFragment,createReferenceResolver,referenceIds} from './references.mjs';
const simple=new Set(['find','create','load','versions','branch','version','restore','submit','save']);
export function createSceneFilesService({database,store,legacyReader}){
 const resolver=createReferenceResolver({store,legacyReader}),one=queryOne;
 async function scope(c,id){const s=await one(c,'SELECT scene_files.project_scope($1) AS data',[id]);if(!s)throw fault('FORBIDDEN');return s;}
 async function lock(c,id){await c.query('SELECT scene_files.lock_project($1)',[id]);return one(c,'SELECT public.scene_edit_load_project($1) AS data',[id]);}
 async function doc(c,d,prev=d){validateSceneDocument(d);await resolver.validateReferences(c,{document:d,previousDocument:prev,scope:await scope(c,d.projectId)});return d;}
 const asScope=r=>({scopeKind:r.scope_kind,courseId:r.course_id,groupId:r.group_id,ownerId:r.owner_id});
 async function fragment(c,r,desired=asScope(r),previous=r.document_fragment){validateFragment(r.document_fragment);await resolver.validateReferences(c,{document:r.document_fragment,previousDocument:previous,scope:desired});if(r.preview_path)await resolver.verifyPath(c,r.preview_path);}
 async function perform(c,op,i,identity){
  if(simple.has(op)){
   if(op==='save'){fields(i,['document']);validateSceneDocument(i.document);}
   else parseOperation(op,i);
   if(['find','create'].includes(op))return executeOperation(c,op,i,identity);
   if(op==='load'){return doc(c,await one(c,'SELECT public.scene_edit_load_project($1) AS data',[i.projectId]));}
   if(op==='versions'){const rows=await executeOperation(c,op,i,identity);for(const v of rows){await doc(c,v.document);if(v.preview_path)await resolver.verifyPath(c,v.preview_path);}return rows;}
   let v,current;
   if(['restore','submit'].includes(op)){v=(await c.query('SELECT * FROM public.scene_edit_versions WHERE id=$1',[i.versionId])).rows[0];if(!v)throw fault('FORBIDDEN');current=await lock(c,v.project_id);}
   else current=await lock(c,op==='save'?i.document.projectId:i.projectId);
   const all=[...new Set([...referenceIds(current),...(v?referenceIds(v.document):[]),...(op==='save'?referenceIds(i.document):[])])].sort();await one(c,'SELECT scene_files.lock_assets($1::uuid[]) AS data',[all]);
   if(v){await doc(c,v.document);if(v.preview_path)await resolver.verifyPath(c,v.preview_path);}await doc(c,current);
   if(op==='save'){const d=i.document;for(const k of ['villageId','groupId'])if(d[k]!==current[k])throw fault('BASELINE_MISMATCH');if(d.baselineRef.spaceId!==current.baselineRef.spaceId||d.baselineRef.revision!==current.baselineRef.revision||d.metadata.scopeKind!==current.metadata.scopeKind||d.metadata.ownerId!==current.metadata.ownerId)throw fault('BASELINE_MISMATCH');await doc(c,d,current);return one(c,'SELECT public.scene_edit_save_draft($1,$2,$3) AS data',[d.projectId,d.revision,JSON.stringify(d)]);}
   if(op==='branch')return one(c,'SELECT public.scene_edit_branch_project($1,$2,$3) AS data',[i.projectId,i.baselineRevision,i.title]);
   if(op==='version')return one(c,'SELECT public.scene_edit_create_version($1,$2,$3,$4,NULL::text) AS data',[i.projectId,i.revision,i.label,i.description??'']);
   if(op==='restore')return one(c,'SELECT public.scene_edit_restore_version($1,$2) AS data',[i.versionId,i.title]);
   return one(c,'SELECT public.scene_edit_submit_version($1) AS data',[i.versionId]);
  }
  if(op==='assets'||op==='components'){fields(i,['courseId']);if(!text(i.courseId))throw fault('INVALID_INPUT');const rows=(await c.query(op==='assets'?'SELECT * FROM public.scene_edit_assets WHERE course_id=$1 AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 100':'SELECT * FROM public.scene_edit_components WHERE course_id=$1 AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 100',[i.courseId])).rows;
   if(op==='assets'){for(const a of rows)for(const p of [a.storage_path,...['originalStoragePath','lowStoragePath','lowOriginalStoragePath','topViewPath'].map(k=>a.metadata?.[k]).filter(Boolean)])await resolver.verifyPath(c,p);}else for(const r of rows)await fragment(c,r);return rows;
  }
  if(['resolveAsset','publishAsset','copyAsset','archiveAsset','updateAssetMetadata'].includes(op)){
   fields(i,['assetId',...(op==='resolveAsset'?['variant']:op==='copyAsset'?['groupId']:op==='updateAssetMetadata'?['metadata']:[])]);if(!uuid(i.assetId)||op==='copyAsset'&&!text(i.groupId))throw fault('INVALID_INPUT');const a=(await one(c,'SELECT scene_files.lock_assets($1::uuid[]) AS data',[[i.assetId]]))[0];
   if(op==='resolveAsset'){const key={display:null,original:'originalStoragePath',low:'lowStoragePath','low-original':'lowOriginalStoragePath',top:'topViewPath'};if(!Object.hasOwn(key,i.variant))throw fault('INVALID_INPUT');const path=key[i.variant]?a.metadata?.[key[i.variant]]:a.storage_path;if(!path)throw fault('NOT_FOUND');return resolver.verifyPath(c,path);}
   if(op==='archiveAsset')return one(c,'SELECT public.scene_edit_archive_asset($1) AS data',[a.id]);
   if(op==='publishAsset'||op==='copyAsset'){for(const p of [a.storage_path,...['originalStoragePath','lowStoragePath','lowOriginalStoragePath','topViewPath'].map(k=>a.metadata?.[k]).filter(Boolean)])await resolver.verifyPath(c,p);return op==='publishAsset'?one(c,'SELECT public.scene_edit_publish_asset($1) AS data',[a.id]):one(c,'SELECT public.scene_edit_copy_asset($1,$2) AS data',[a.id,i.groupId]);}
   const metadata=parseCommitInput({displayName:'metadata',license:'student-provided',metadata:i.metadata}).metadata;for(const k of ['originalStoragePath','originalBytes','lowStoragePath','lowOriginalStoragePath','topViewPath','topViewStatus'])if(Object.hasOwn(a.metadata,k))metadata[k]=a.metadata[k];return one(c,'SELECT public.scene_edit_update_asset_metadata($1,$2) AS data',[a.id,JSON.stringify(metadata)]);
  }
  if(op==='saveComponent'){fields(i,['courseId','groupId','scopeKind','displayName','fragment']);if(!text(i.courseId)||!text(i.displayName,100)||!['personal','group'].includes(i.scopeKind)||(i.scopeKind==='group'?!text(i.groupId):i.groupId!==null))throw fault('INVALID_INPUT');await fragment(c,{document_fragment:i.fragment,preview_path:null},{scopeKind:i.scopeKind,courseId:i.courseId,groupId:i.groupId},null);return one(c,'SELECT public.scene_edit_save_component($1,$2,$3,$4,$5,NULL::text) AS data',[i.courseId,i.groupId,i.scopeKind,i.displayName,JSON.stringify(i.fragment)]);}
  if(['publishComponent','copyComponent','archiveComponent'].includes(op)){fields(i,['componentId',...(op==='copyComponent'?['groupId']:[])]);if(!uuid(i.componentId)||op==='copyComponent'&&!text(i.groupId))throw fault('INVALID_INPUT');const r=await one(c,'SELECT scene_files.lock_component($1) AS data',[i.componentId]);if(op==='archiveComponent')return one(c,'SELECT public.scene_edit_archive_component($1) AS data',[r.id]);await fragment(c,r,{...asScope(r),scopeKind:op==='publishComponent'?'course':'group',groupId:i.groupId??null});return op==='publishComponent'?one(c,'SELECT public.scene_edit_publish_component($1) AS data',[r.id]):one(c,'SELECT public.scene_edit_copy_component($1,$2) AS data',[r.id,i.groupId]);}
  throw fault('NOT_FOUND');
 }
 return {
  run:(identity,op,i)=>database.withIdentity(identity,c=>perform(c,op,i,identity)),
  async commitPreview(c,s,i){const file=s.files[0],x=s.spec.context;if(s.spec.purpose==='version-preview'){
    fields(i,['label','description']);if(!text(i.label,40)||typeof i.description!=='string'||i.description.length>500)throw fault('INVALID_INPUT');const current=await lock(c,x.projectId);await doc(c,current);return one(c,'SELECT public.scene_edit_create_version($1,$2,$3,$4,$5) AS data',[x.projectId,x.revision,i.label,i.description,file.logical_path]);
   }
   fields(i,['displayName','fragment']);if(!text(i.displayName,100))throw fault('INVALID_INPUT');await fragment(c,{document_fragment:i.fragment,preview_path:null},{scopeKind:x.scopeKind,courseId:x.courseId,groupId:x.groupId},null);return one(c,'SELECT public.scene_edit_save_component($1,$2,$3,$4,$5,$6) AS data',[x.courseId,x.groupId,x.scopeKind,i.displayName,JSON.stringify(i.fragment),file.logical_path]);
  }
 };
}
