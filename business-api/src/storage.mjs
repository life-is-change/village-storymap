import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {UUID} from './contracts.mjs';
import {failure} from './errors.mjs';

const buckets=new Set(['house-photos','group-models','scene-assets','scene-version-previews','village-datasets']);
const sha=/^[a-f0-9]{64}$/;
function version(o){
 let size=o.declared_size;
 if(typeof size==='string'&&/^\d+$/.test(size))size=Number(size);
 if((size!==null&&(!Number.isSafeInteger(size)||size<0))
  ||typeof o.snapshot_updated_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(o.snapshot_updated_at)
  ||[o.snapshot_etag,o.snapshot_version].some(v=>v!==null&&(typeof v!=='string'||!v.length||v.length>1024)))throw failure('FILE_UNAVAILABLE');
 return JSON.stringify([o.snapshot_updated_at,size,o.snapshot_etag,o.snapshot_version]);
}
async function noLinks(path){
 for(let p=resolve(path);;p=dirname(p)){
  if((await lstat(p)).isSymbolicLink())throw failure('FILE_UNAVAILABLE');
  if(p===dirname(p))break;
 }
}
function privateStat(st,directory=false){
 if(!(directory?st.isDirectory():st.isFile()&&st.nlink===1)||(process.platform==='linux'&&((st.mode&0o077)||st.uid!==process.getuid())))throw failure('FILE_UNAVAILABLE');
}
async function privateOpen(path){
 await noLinks(path);const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{privateStat(await fd.stat());return fd;}catch(e){await fd.close();throw e;}
}
export async function createStorageReader({root,indexPath}){
 try{
  root=resolve(root);await noLinks(root);privateStat(await lstat(root),true);
  const fd=await privateOpen(indexPath);let index;
  try{if((await fd.stat()).size>8*1024*1024)throw failure('FILE_UNAVAILABLE');index=JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}
  if(index.version!==1||!sha.test(index.source_archive_sha256)||!Array.isArray(index.objects)||index.objects.length>20000)throw failure('FILE_UNAVAILABLE');
  const objects=new Map();const paths=new Set();
  for(const o of index.objects){
   if(!UUID.test(o.id)||o.id!==o.id.toLowerCase()||!buckets.has(o.bucket)||!sha.test(o.sha256)||!Number.isSafeInteger(o.size)||o.size<0||o.size>52428800
    ||typeof o.name!=='string'||!o.name.length||o.name.length>4096||/[\x00-\x1f\x7f\\]/.test(o.name)||o.name.split('/').some(p=>['','.','..'].includes(p))
    ||objects.has(o.id)||paths.has(o.bucket+'\0'+o.name))throw failure('FILE_UNAVAILABLE');
   version(o);objects.set(o.id,Object.freeze({...o}));paths.add(o.bucket+'\0'+o.name);
  }
  let active=0;
  return {
   async open(object){
    if(active>=4)throw failure('FILE_BUSY');active++;let fd;
    try{
     const o=objects.get(object.id);
     if(!o||o.bucket!==object.bucket||o.name!==object.name||version(o)!==version(object))throw failure('FILE_UNAVAILABLE');
     fd=await privateOpen(join(root,o.sha256));const before=await fd.stat();
     if(before.size!==o.size)throw failure('FILE_UNAVAILABLE');
     const hash=createHash('sha256');const buffer=Buffer.alloc(1024*1024);let offset=0;
     while(offset<o.size){const {bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,o.size-offset),offset);if(!bytesRead)throw failure('FILE_UNAVAILABLE');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
     const after=await fd.stat();
     if(hash.digest('hex')!==o.sha256||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw failure('FILE_UNAVAILABLE');
     let closed=false;
     return {size:o.size,sha256:o.sha256,name:o.name,
      stream({start,end}){return o.size?fd.createReadStream({start,end,autoClose:false,highWaterMark:64*1024}):Readable.from([]);},
      async close(){if(!closed){closed=true;try{await fd.close();}finally{active--;}}}};
    }catch{if(fd)await fd.close();active--;throw failure('FILE_UNAVAILABLE');}
   }
  };
 }catch{throw failure('FILE_UNAVAILABLE');}
}

export function byteRange(value,size){
 if(value===undefined)return {start:0,end:size-1,status:200};
 const m=/^bytes=(\d*)-(\d*)$/.exec(value);
 if(!m||!size||(!m[1]&&!m[2]))return null;
 let start,end;
 if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return null;end=Math.min(size-1,end);}
 return {start,end,status:206};
}
export function fileType(name){
 const ext=name.split('.').at(-1).toLowerCase();
 return ({glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json',geojson:'application/geo+json'})[ext]??'application/octet-stream';
}
