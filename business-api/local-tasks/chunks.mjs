import {constants} from 'node:fs';
import {open,lstat,mkdir,link,unlink,readdir,rmdir,statfs} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {uuid,fault} from '../scene-files/contracts.mjs';

const CHUNK_LIMIT=8*1024**2;
function privateStat(st,dir=false){if(!(dir?st.isDirectory():st.isFile()&&st.nlink===1)||process.platform==='linux'&&((st.mode&0o077)||st.uid!==process.getuid()))throw fault('FILE_UNAVAILABLE');}
async function noLinks(path){for(let p=resolve(path);;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw fault('FILE_UNAVAILABLE');if(p===dirname(p))return;}}
async function syncDir(path){if(process.platform==='win32')return;const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
function descriptor(id,index,size,sha256){if(!uuid(id)||!Number.isInteger(index)||index<0||index>=64||!Number.isSafeInteger(size)||size<1||size>CHUNK_LIMIT||typeof sha256!=='string'||! /^[a-f0-9]{64}$/.test(sha256))throw fault('INVALID_INPUT');}
async function checked(path){await noLinks(path);const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{privateStat(await h.stat());return h;}catch(e){await h.close();throw e;}}
async function digest(h){const hash=createHash('sha256'),buf=Buffer.alloc(65536);let size=0;for(;;){const {bytesRead}=await h.read(buf,0,buf.length,size);if(!bytesRead)break;size+=bytesRead;hash.update(buf.subarray(0,bytesRead));}return {size,sha256:hash.digest('hex')};}

// Only immutable, fsynced chunks are acknowledged. A crashed request's unique
// temporary file cannot block a retry or overwrite previously accepted bytes.
export async function createTaskChunkStore({root,instanceId,spaceAvailable=async path=>{const s=await statfs(path);return s.bavail*s.bsize;}}){
 if(typeof instanceId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(instanceId))throw fault('INVALID_INPUT');
 root=resolve(root);await noLinks(root);privateStat(await lstat(root),true);
 const marker=join(root,'instance');let mh;
 try{mh=await open(marker,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);await mh.writeFile(instanceId);await mh.sync();await syncDir(root);}catch(e){if(e.code!=='EEXIST')throw e;mh=await checked(marker);if(await mh.readFile('utf8')!==instanceId)throw fault('FILE_UNAVAILABLE');}finally{await mh?.close();}
 async function directory(id,create=false){if(!uuid(id))throw fault('INVALID_INPUT');const dir=join(root,id);if(create)await mkdir(dir,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await noLinks(dir);privateStat(await lstat(dir),true);return dir;}
 async function match(path,size,sha256){const h=await checked(path);try{const d=await digest(h);if(d.size!==size||d.sha256!==sha256)throw fault('UPLOAD_CONFLICT');}finally{await h.close();}}
 return {
  async put(id,index,size,sha256,stream){
   descriptor(id,index,size,sha256);const dir=await directory(id,true),dest=join(dir,`${index}.chunk`),temp=join(dir,`${index}.${randomUUID()}.pending`);
   try{await match(dest,size,sha256);return {replayed:true};}catch(e){if(e.code!=='ENOENT')throw e;}
   const available=await spaceAvailable(root);if(!Number.isFinite(available)||available<size+2*1024**3)throw fault('QUOTA_EXCEEDED');
   let h,created=false;
   try{
    h=await open(temp,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);created=true;const hash=createHash('sha256');let count=0;
    for await(const bytes of stream){if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))throw fault('INVALID_FILE');count+=bytes.length;if(count>size)throw fault('INVALID_FILE');hash.update(bytes);let offset=0;while(offset<bytes.length){const {bytesWritten}=await h.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw fault('FILE_UNAVAILABLE');offset+=bytesWritten;}}
    if(count!==size||hash.digest('hex')!==sha256)throw fault('INVALID_FILE');await h.sync();await h.close();h=null;
    let replayed=false;try{await link(temp,dest);}catch(e){if(e.code!=='EEXIST')throw e;await match(dest,size,sha256);replayed=true;}
    await unlink(temp);created=false;await syncDir(dir);return {replayed};
   }finally{await h?.close();if(created)await unlink(temp).catch(()=>{});}
  },
  async *stream(id,parts){
   if(!Array.isArray(parts)||parts.length<1||parts.length>64)throw fault('INVALID_INPUT');
   for(let i=0;i<parts.length;i++){const p=parts[i];descriptor(id,p.index,p.size,p.sha256);if(p.index!==i)throw fault('INVALID_INPUT');}
   const dir=await directory(id);
   for(const p of parts){const h=await checked(join(dir,`${p.index}.chunk`));try{const hash=createHash('sha256'),buf=Buffer.alloc(65536);let size=0;for(;;){const {bytesRead}=await h.read(buf,0,buf.length,size);if(!bytesRead)break;size+=bytesRead;if(size>p.size)throw fault('INVALID_FILE');const bytes=Buffer.from(buf.subarray(0,bytesRead));hash.update(bytes);yield bytes;}if(size!==p.size||hash.digest('hex')!==p.sha256)throw fault('INVALID_FILE');}finally{await h.close();}}
  },
  async remove(id){
   let dir;try{dir=await directory(id);}catch(e){if(e.code==='ENOENT')return;throw e;}
   const names=await readdir(dir);for(const name of names){if(!/^(?:[0-9]|[1-5][0-9]|6[0-3])(?:\.chunk|\.[a-f0-9-]{36}\.pending)$/.test(name))throw fault('FILE_UNAVAILABLE');const h=await checked(join(dir,name));await h.close();}
   for(const name of names)await unlink(join(dir,name));await rmdir(dir);await syncDir(root);
  }
 };
}
