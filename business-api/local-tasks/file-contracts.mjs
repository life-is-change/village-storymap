import {fields,fault,MiB,uuid} from '../scene-files/contracts.mjs';
const geo=new Set(['buildings','roads','waterways','water_areas','contours']);
const rect=new Set(['rectified_preview','rectified_source','building_mask']);
export function taskFileSpec(kind,phase,input){
 fields(input,['artifactType','size','sha256','mime','extension']);
 if(!Number.isSafeInteger(input.size)||input.size<=0||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))throw fault('INVALID_INPUT');
 let role,limit;
 if(kind==='geo'&&phase==='geo'&&geo.has(input.artifactType)&&input.mime==='application/geo+json'&&input.extension==='geojson'){role=`task:${input.artifactType}.geojson`;limit=512*MiB;}
 else if(kind==='facade'&&phase==='rectification'&&rect.has(input.artifactType)&&['png','jpg','jpeg'].includes(input.extension)&&input.mime===(input.extension==='png'?'image/png':'image/jpeg')){role='photo';limit=10*MiB;}
 else if(kind==='facade'&&phase==='generation'&&input.artifactType==='building_glb'&&input.extension==='glb'&&input.mime==='model/gltf-binary'){role='display';limit=50*MiB;}
 else throw fault('FILE_TYPE_UNSUPPORTED');
 if(input.size>limit)throw fault('FILE_TOO_LARGE');return {...input,role};
}
export function chunkDescriptor(input){fields(input,['index','size','sha256']);if(!Number.isInteger(input.index)||input.index<0||input.index>=64||!Number.isSafeInteger(input.size)||input.size<1||input.size>8*MiB||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))throw fault('INVALID_INPUT');return {...input};}
export function fileCommand(action,runId,leaseToken,input){
 if(!uuid(runId)||!uuid(leaseToken))throw fault('INVALID_INPUT');
 if(action==='begin'){fields(input,['requestId','artifactType','size','sha256','mime','extension']);if(!uuid(input.requestId))throw fault('INVALID_INPUT');return structuredClone(input);}
 if(['status','commit','abort'].includes(action)){fields(input,['uploadId']);if(!uuid(input.uploadId))throw fault('INVALID_INPUT');return {...input};}
 if(action==='chunk'){fields(input,['uploadId','index','size','sha256']);if(!uuid(input.uploadId))throw fault('INVALID_INPUT');const {uploadId,...part}=input;return {uploadId,...chunkDescriptor(part)};}
 if(action==='input'){fields(input,[]);return {};}
 if(action==='artifact'){fields(input,['artifactType']);if(!rect.has(input.artifactType))throw fault('INVALID_INPUT');return {...input};}
 throw fault('INVALID_INPUT');
}
