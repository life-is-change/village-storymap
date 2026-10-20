import {validateDocument} from '../scene/contracts.mjs';import {fault,uuid,fields,plain,text} from './contracts.mjs';import {queryOne} from './database.mjs';import {getStorageObject} from '../src/repository.mjs';
const seed=v=>typeof v==='string'&&/^seed:[a-z0-9-]+(?::[a-z0-9-]+)*$/.test(v)&&v.length<=150;
export function referenceIds(d){const out=new Set();function add(v){if(!seed(v)&&!uuid(v))throw fault('INVALID_INPUT');if(uuid(v))out.add(v);}
 if(!Array.isArray(d.assetRefs))throw fault('INVALID_INPUT');for(const r of d.assetRefs)add(r);
 function walk(v,depth=0){if(depth>32)throw fault('INVALID_INPUT');if(Array.isArray(v))v.forEach(x=>walk(x,depth+1));else if(plain(v))for(const [k,x]of Object.entries(v)){if(['assetRef','materialRef'].includes(k)&&x!==null&&x!==''){add(x);continue;}if(/url|uri|path|assetId|modelId|storage|preview|__proto__|prototype|constructor/i.test(k)&&x!==null&&x!==''&&!(Array.isArray(x)&&!x.length))throw fault('INVALID_INPUT');walk(x,depth+1);}}
 walk(d.objects);walk(d.groups??[]);walk(d.metadata??{});return [...out].sort();
}
export function validateSceneDocument(d){const ids=referenceIds(d),copy=structuredClone(d);function convert(v){if(Array.isArray(v))v.forEach(convert);else if(plain(v))for(const [k,x]of Object.entries(v)){if(['assetRef','materialRef'].includes(k)&&uuid(x))v[k]='seed:private';else convert(x);}}convert(copy);copy.assetRefs=copy.assetRefs.map(r=>uuid(r)?'seed:private':r);validateDocument(copy);return d;}
export function validateFragment(f){fields(f,['id','name','coordinateSpace','objects','assetRefs']);if(!text(f.id)||!text(f.name,100)||f.coordinateSpace!=='local-m'||!Array.isArray(f.objects)||f.objects.length>5000)throw fault('INVALID_INPUT');referenceIds(f);
 const objects=structuredClone(f.objects),layers=new Set();function localCoords(v){if(!Array.isArray(v))throw fault('INVALID_INPUT');if(typeof v[0]==='number'){if(v.length<2||v.length>3||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6))throw fault('INVALID_INPUT');return v.map(n=>n/1e6);}return v.map(localCoords);}
 for(const o of objects){if(!o?.geometry)throw fault('INVALID_INPUT');o.geometry.coordinates=localCoords(o.geometry.coordinates);layers.add(o.layerId);if(o.groupId!==null&&o.groupId!==undefined)throw fault('INVALID_INPUT');}
 validateSceneDocument({schemaVersion:1,projectId:'10000000-0000-4000-8000-000000000001',villageId:'10000000-0000-4000-8000-000000000001',groupId:null,baselineRef:{spaceId:'fragment',revision:0},revision:0,layers:[...layers.size?layers:['design']].map(id=>({id})),objects,groups:[],assetRefs:f.assetRefs,metadata:{scopeKind:'admin_sandbox'}});return f;
}
export function createReferenceResolver({store,legacyReader,legacyObjectReader=getStorageObject,legacyPathReader}){
 function usages(d,id){const found=new Set();if(d.assetRefs?.includes(id))found.add('declared');for(const o of d.objects??[])if(referenceIds({assetRefs:[],objects:[o]}).includes(id))found.add('object:'+o.id);for(const g of d.groups??[])if(referenceIds({assetRefs:[],objects:[],groups:[g]}).includes(id))found.add('group:'+g.id);if(referenceIds({assetRefs:[],objects:[],metadata:d.metadata??{}}).includes(id))found.add('metadata');return found;}
 async function verifyPath(c,path){if(!text(path,4096))throw fault('FILE_UNAVAILABLE');let file=await queryOne(c,'SELECT scene_files.resolve_path($1) AS data',[path]);
  if(file){const h=await store.open(file.id,{size:Number(file.size),sha256:file.sha256});await h.close();return {fileId:file.id,mime:file.mime,size:Number(file.size)};}
  if(legacyReader){
   let obj;if(legacyPathReader)obj=await legacyPathReader(c,path);else{const row=(await c.query("SELECT id FROM storage.objects WHERE bucket_id IN ('scene-assets','scene-version-previews') AND name=$1",[path])).rows[0];if(row)obj=await legacyObjectReader(c,row.id);}
   if(obj&&['scene-assets','scene-version-previews'].includes(obj.bucket)){const h=await legacyReader.open(obj);await h.close();return {fileId:obj.id,size:h.size};}
  }
  throw fault('FILE_UNAVAILABLE');
 }
 async function validateReferences(c,{document,scope,previousDocument}){
  const ids=referenceIds(document),previous=new Set(previousDocument?referenceIds(previousDocument):[]),assets=await queryOne(c,'SELECT scene_files.lock_assets($1::uuid[]) AS data',[ids]);
  for(const a of assets){if(scope.scopeKind==='group'&&!(a.course_id===scope.courseId&&(a.scope_kind==='course'||a.scope_kind==='group'&&a.group_id===scope.groupId))||scope.scopeKind==='course'&&!(a.course_id===scope.courseId&&a.scope_kind==='course'))throw fault('FILE_SCOPE_MISMATCH');if(a.archived_at){const old=previousDocument?usages(previousDocument,a.id):new Set();if(!previous.has(a.id)||[...usages(document,a.id)].some(u=>!old.has(u)))throw fault('FILES_NOT_READY');}
   for(const path of [a.storage_path,...['originalStoragePath','lowStoragePath','lowOriginalStoragePath','topViewPath'].map(k=>a.metadata?.[k]).filter(Boolean)])await verifyPath(c,path);
  }return assets;
 }
 return {verifyPath,validateReferences};
}
