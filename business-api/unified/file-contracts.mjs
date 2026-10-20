import {fields,uuid,text,plain,fault,MiB} from '../scene-files/contracts.mjs';
import {parseOperation} from './contracts.mjs';
export const DATASET_NAMES=['manifest.json','validation.json','boundary.geojson','imagery.webp','buildings.geojson','roads.geojson','waterways.geojson','water_areas.geojson','water.geojson','contours.geojson'];
export function businessFileLimit({role,mime,extension}){
 const pair={glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json',geojson:'application/geo+json'};
 if(pair[extension]!==mime)throw fault('FILE_TYPE_UNSUPPORTED');
 if(['task:buildings.geojson','task:roads.geojson','task:waterways.geojson','task:water_areas.geojson','task:contours.geojson'].includes(role)&&extension==='geojson')return 512*MiB;
 if(['original','display','low','low-original'].includes(role)&&extension==='glb')return 50*MiB;
 if(['photo','display','top','preview'].includes(role)&&['png','jpg','jpeg','webp'].includes(extension))return 10*MiB;
 if(DATASET_NAMES.includes(role)&&role.endsWith('.'+extension))return extension==='json'?2*MiB:50*MiB;
 throw fault('FILE_TYPE_UNSUPPORTED');
}
export function parseBusinessUpload(input){
 fields(input,['requestId','purpose','context','files']);if(!uuid(input.requestId)||!['photo','group-model','dataset'].includes(input.purpose)||!Array.isArray(input.files))throw fault('INVALID_INPUT');
 if(input.purpose==='dataset'){fields(input.context,['villageId']);if(!uuid(input.context.villageId))throw fault('INVALID_INPUT');}
 else parseOperation('catalog.getSpace',input.context);
 const roles=new Set();for(const f of input.files){fields(f,['role','size','mime','extension']);if(roles.has(f.role))throw fault('INVALID_INPUT');roles.add(f.role);const limit=businessFileLimit(f);if(!Number.isSafeInteger(f.size)||f.size<=0||f.size>limit)throw fault('FILE_TOO_LARGE');}
 if(input.purpose==='photo'&&(roles.size!==1||!roles.has('photo')))throw fault('INVALID_INPUT');
 if(input.purpose==='group-model'&&(!roles.has('display')||roles.size>3||[...roles].some(r=>!['display','original','low'].includes(r))||input.files.some(f=>f.extension!=='glb')))throw fault('INVALID_INPUT');
 if(input.purpose==='dataset'&&(roles.size!==DATASET_NAMES.length||DATASET_NAMES.some(r=>!roles.has(r))))throw fault('INVALID_INPUT');
 return structuredClone(input);
}
export function parseBusinessCommit(purpose,input){
 if(purpose==='photo'){fields(input,['objectCode','objectType','surveyLayerKey','note'],['objectCode','objectType']);if(!text(input.objectCode)||!text(input.objectType,100)||input.note!==undefined&&(typeof input.note!=='string'||input.note.length>1000)||input.surveyLayerKey!=null&&!['building','road','water'].includes(input.surveyLayerKey))throw fault('INVALID_INPUT');}
 else if(purpose==='group-model'){fields(input,['name','metadata'],['name']);if(!text(input.name,100)||input.metadata!==undefined&&!plain(input.metadata))throw fault('INVALID_INPUT');
  const walk=(v,d=0)=>{if(d>32)throw fault('INVALID_INPUT');if(Array.isArray(v))v.forEach(x=>walk(x,d+1));else if(plain(v))for(const[k,x]of Object.entries(v)){if(/url|uri|path|storage|owner|fileId|assetId|__proto__|prototype|constructor/i.test(k))throw fault('INVALID_INPUT');walk(x,d+1);}else if(v!==null&&(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)))throw fault('INVALID_INPUT');};walk(input.metadata??{});if(JSON.stringify(input).length>100000)throw fault('INVALID_INPUT');
 }else if(purpose==='dataset'){fields(input,['versionLabel']);if(!text(input.versionLabel,80))throw fault('INVALID_INPUT');}else throw fault('INVALID_INPUT');return structuredClone(input);
}
