import {UUID} from '../src/contracts.mjs';
import {error} from './errors.mjs';
const fail=()=>{throw error('INVALID_INPUT');};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
const revision=v=>Number.isSafeInteger(v)&&v>=0;
const uuid=v=>typeof v==='string'&&UUID.test(v);
const seed=v=>typeof v==='string'&&v.length<=150&&/^seed:[a-z0-9-]+(?::[a-z0-9-]+)*$/.test(v);
function keys(v,allowed,required=allowed){if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail();}
function jsonTree(v,depth=0){
 if(depth>32)fail();
 if(Array.isArray(v)){for(const item of v)jsonTree(item,depth+1);}
 else if(object(v)){for(const [k,item] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail();jsonTree(item,depth+1);}}
 else if(v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))fail();
}
function noFiles(v){
 if(Array.isArray(v))v.forEach(noFiles);
 else if(object(v))for(const [k,value] of Object.entries(v)){
  if(k==='assetRef'&&seed(value))continue;
  if(/(?:url|uri|path|assetId|assetRef|modelId|storage|preview)/i.test(k)&&value!==null&&value!==''&&!(Array.isArray(value)&&!value.length))throw error('FILES_NOT_READY');
  noFiles(value);
 }
}
function position(p){return Array.isArray(p)&&p.length>=2&&p.length<=3&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;}
export function validateDocument(d){
 keys(d,['schemaVersion','projectId','villageId','groupId','baselineRef','revision','updatedAt','selectionBoundary','layers','objects','groups','assetRefs','metadata'],
 ['schemaVersion','projectId','villageId','groupId','baselineRef','revision','layers','objects','groups','assetRefs','metadata']);
 if(d.schemaVersion!==1||!uuid(d.projectId)||!uuid(d.villageId)||!revision(d.revision))fail();
 keys(d.baselineRef,['spaceId','revision']);if(!text(d.baselineRef.spaceId)||!revision(d.baselineRef.revision))fail();
 if(!object(d.metadata)||!['group','admin_sandbox'].includes(d.metadata.scopeKind)||!(d.groupId===null||text(d.groupId)))fail();
 if((d.metadata.scopeKind==='group')!==(d.groupId!==null))fail();
 if(!Array.isArray(d.objects)||d.objects.length>5000||!Array.isArray(d.layers)||!d.layers.length||d.layers.length>100||!Array.isArray(d.groups)||d.groups.length>1000||!Array.isArray(d.assetRefs))fail();
 jsonTree(d);
 if(d.assetRefs.some(v=>!seed(v)))throw error('FILES_NOT_READY');
 noFiles(d.objects);noFiles(d.metadata);noFiles(d.groups);
 const layers=new Set(),ids=new Set(),groups=new Map();
 for(const l of d.layers){if(!object(l)||!text(l.id)||layers.has(l.id))fail();layers.add(l.id);}
 for(const g of d.groups){
  if(!object(g)||!text(g.id)||groups.has(g.id)||!Array.isArray(g.objectIds)||g.objectIds.length>5000||
   g.objectIds.some(id=>!text(id))||new Set(g.objectIds).size!==g.objectIds.length)fail();
  groups.set(g.id,g);
 }
 for(const o of d.objects){
  if(!object(o)||!text(o.id)||ids.has(o.id)||!layers.has(o.layerId)||!['surface','line','asset','structure'].includes(o.kind)||!text(o.category)||!object(o.properties??{})||!object(o.geometry))fail();ids.add(o.id);
  if(o.groupId!==undefined&&o.groupId!==null&&(!text(o.groupId)||!groups.has(o.groupId)))fail();
  if(o.zIndex!==undefined&&(!Number.isInteger(o.zIndex)||Math.abs(o.zIndex)>2147483647))fail();
  const g=o.geometry,c=g.coordinates;
  if(o.kind==='surface'){
   if(g.type!=='Polygon'||!Array.isArray(c)||!c.length||c.some(r=>!Array.isArray(r)||r.length<4||r.some(p=>!position(p))||JSON.stringify(r[0])!==JSON.stringify(r.at(-1))))fail();
  }else if(o.kind==='line'){if(g.type!=='LineString'||!Array.isArray(c)||c.length<2||c.some(p=>!position(p)))fail();}
  else{
   if(g.type!=='Point'||!position(c)||!object(o.transform))fail();
   for(const k of ['headingDeg','pitchDeg','rollDeg','heightOffsetM'])if(!Number.isFinite(o.transform[k]))fail();
   if(!Array.isArray(o.transform.scale)||o.transform.scale.length!==3||o.transform.scale.some(n=>!Number.isFinite(n)||n<=0))fail();
  }
 }
 for(const g of groups.values())if(g.objectIds.some(id=>!ids.has(id)))fail();
 return d;
}
const fields={find:['teachingProjectId','villageId','spaceId','groupId','scopeKind'],create:['teachingProjectId','villageId','spaceId','groupId','scopeKind','title','baselineRevision','selectionBoundary'],
 load:['projectId'],save:['document'],versions:['projectId'],branch:['projectId','baselineRevision','title'],version:['projectId','revision','label','description','previewPath'],restore:['versionId','title'],submit:['versionId']};
export function parseOperation(op,input){
 if(!Object.hasOwn(fields,op))throw error('NOT_FOUND');
 const required=fields[op].filter(k=>!['selectionBoundary','description','previewPath'].includes(k));keys(input,fields[op],required);jsonTree(input);
 for(const k of ['projectId','versionId','teachingProjectId','villageId'])if(k in input&&!uuid(input[k]))fail();
 for(const k of ['revision','baselineRevision'])if(k in input&&!revision(input[k]))fail();
 for(const [k,n] of [['title',100],['label',40],['spaceId',200]])if(k in input&&!text(input[k],n))fail();
 if('description' in input&&(typeof input.description!=='string'||input.description.length>500))fail();
 if(input.previewPath!==undefined&&input.previewPath!==null)throw error('FILES_NOT_READY');
 if('scopeKind' in input&&(!['group','admin_sandbox'].includes(input.scopeKind)||(input.scopeKind==='group'? !text(input.groupId):input.groupId!==null)))fail();
 if(op==='save')validateDocument(input.document);
 return {input,readOnly:['find','load','versions'].includes(op)};
}
