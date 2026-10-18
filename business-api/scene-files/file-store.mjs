import {constants} from 'node:fs';import {open,lstat,mkdir,link,unlink} from 'node:fs/promises';import {resolve,dirname,join} from 'node:path';import {createHash} from 'node:crypto';
import {uuid,fault,fileLimit} from './contracts.mjs';import {validateFile} from './formats.mjs';
async function noLinks(path){for(let p=resolve(path);;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw fault('FILE_UNAVAILABLE');if(p===dirname(p))return;}}
function privateStat(st,dir=false){if(!(dir?st.isDirectory():st.isFile()&&st.nlink===1)||process.platform==='linux'&&((st.mode&0o077)||st.uid!==process.getuid()))throw fault('FILE_UNAVAILABLE');}
async function syncDir(path){if(process.platform!=='win32'){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}}
async function digest(h){const hash=createHash('sha256'),buf=Buffer.alloc(65536);let p=0;for(;;){const {bytesRead}=await h.read(buf,0,buf.length,p);if(!bytesRead)break;hash.update(buf.subarray(0,bytesRead));p+=bytesRead;}return {size:p,sha256:hash.digest('hex')};}
export async function createFileStore({root,maxUploads=2}){
 root=resolve(root);await noLinks(root);privateStat(await lstat(root),true);const temp=join(root,'pending'),blobs=join(root,'blobs');
 for(const p of [temp,blobs]){await mkdir(p,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});await noLinks(p);privateStat(await lstat(p),true);}
 let active=0;const key=id=>{if(!uuid(id))throw fault('INVALID_INPUT');return id;};
 async function checked(path,write=false){await noLinks(path);const h=await open(path,(write?constants.O_RDWR:constants.O_RDONLY)|(constants.O_NOFOLLOW??0));try{privateStat(await h.stat());return h;}catch(e){await h.close();throw e;}}
 return {
  root,
  async stage({fileId,role,size,mime,extension,stream}){
   key(fileId);const limit=fileLimit({role,mime,extension},extension==='glb'?'model':role==='display'?'texture':undefined);if(!Number.isSafeInteger(size)||size<=0||size>limit)throw fault('FILE_TOO_LARGE');if(active>=maxUploads)throw fault('FILE_BUSY');active++;
   let h,created=false;const p=join(temp,fileId);
   try{try{await lstat(join(blobs,fileId));throw fault('UPLOAD_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;}
    await noLinks(temp);h=await open(p,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);created=true;const hash=createHash('sha256');let count=0;
    for await(const chunk of stream){if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))throw fault('INVALID_FILE');count+=chunk.length;if(count>size)throw fault('FILE_TOO_LARGE');hash.update(chunk);let off=0;while(off<chunk.length){const r=await h.write(chunk,off,chunk.length-off);if(!r.bytesWritten)throw fault('FILE_UNAVAILABLE');off+=r.bytesWritten;}}
    if(count!==size)throw fault('INVALID_FILE');await validateFile({handle:h,size,mime,extension});await h.sync();return {fileId,size,sha256:hash.digest('hex'),mime,extension};
   }catch(e){if(h){await h.close();h=null;}if(created)await unlink(p).catch(()=>{});throw e?.status?e:fault(e?.code==='EEXIST'?'UPLOAD_CONFLICT':'FILE_UNAVAILABLE');}
   finally{if(h)await h.close();active--;}
  },
  async persist(fileId){key(fileId);await noLinks(blobs);privateStat(await lstat(blobs),true);const src=join(temp,fileId),dest=join(blobs,fileId);const h=await checked(src,true);try{await h.sync();await link(src,dest);await unlink(src);await syncDir(blobs);await syncDir(temp);}finally{await h.close();}},
  async open(fileId,expected){key(fileId);let h;try{h=await checked(join(blobs,fileId));const before=await h.stat(),d=await digest(h),after=await h.stat();if(!expected||d.size!==expected.size||d.sha256!==expected.sha256||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw fault('FILE_UNAVAILABLE');let closed=false;return {size:d.size,stream:({start=0,end=d.size-1}={})=>h.createReadStream({start,end,autoClose:false,highWaterMark:65536}),async close(){if(!closed){closed=true;await h.close();}}};}catch{if(h)await h.close();throw fault('FILE_UNAVAILABLE');}},
  async discard(fileId,{persisted=false}={}){key(fileId);const path=join(persisted?blobs:temp,fileId);try{const h=await checked(path);await h.close();await unlink(path);await syncDir(dirname(path));}catch(e){if(e.code!=='ENOENT')throw e;}}
 };
}
