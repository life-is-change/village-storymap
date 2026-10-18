import {fault,MiB} from './contracts.mjs';
async function read(h,n,p){const b=Buffer.alloc(n);let off=0;while(off<n){const r=await h.read(b,off,n-off,p+off);if(!r.bytesRead)throw fault('INVALID_FILE');off+=r.bytesRead;}return b;}
function valid(v){if(!v)throw fault('INVALID_FILE');}
function uris(value,depth=0){valid(depth<=64);if(Array.isArray(value))value.forEach(v=>uris(v,depth+1));else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){if(k==='uri')valid(typeof v==='string'&&/^data:[a-z0-9.+/-]+;base64,[a-z0-9+/]*={0,2}$/i.test(v));uris(v,depth+1);}}
async function glb(h,size){
 valid(size>=20&&size%4===0);const head=await read(h,20,0);valid(head.toString('ascii',0,4)==='glTF'&&head.readUInt32LE(4)===2&&head.readUInt32LE(8)===size&&head.readUInt32LE(16)===0x4e4f534a);
 const len=head.readUInt32LE(12);valid(len>0&&len<=2*MiB&&len%4===0&&20+len<=size);let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(h,len,20)));}catch{throw fault('INVALID_FILE');}
 valid(json?.asset?.version==='2.0');uris(json);let bin=0;
 if(20+len<size){valid(28+len<=size);const b=await read(h,8,20+len);bin=b.readUInt32LE(0);valid(b.readUInt32LE(4)===0x004e4942&&bin%4===0&&28+len+bin===size);}
 if(json.buffers!==undefined){valid(Array.isArray(json.buffers));const raw=json.buffers.filter(b=>b.uri===undefined);valid(raw.length<=1);for(const b of json.buffers)valid(Number.isSafeInteger(b.byteLength)&&b.byteLength>=0);if(raw.length)valid(raw[0].byteLength<=bin&&raw[0].byteLength>bin-4);}
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crcStep(crc,b){for(const v of b)crc=crcTable[(crc^v)&255]^(crc>>>8);return crc>>>0;}
async function png(h,size){
 valid(size>=45&&(await read(h,8,0)).equals(Buffer.from([137,80,78,71,13,10,26,10])));let pos=8,first=true,data=false,ended=false;
 while(pos<size){valid(pos+12<=size&&!ended);const head=await read(h,8,pos),len=head.readUInt32BE(),type=head.toString('ascii',4);valid(/^[a-zA-Z]{4}$/.test(type)&&len<=size-pos-12);if(first){valid(type==='IHDR'&&len===13);const d=await read(h,13,pos+8);valid(d.readUInt32BE()>0&&d.readUInt32BE(4)>0&&d[10]===0&&d[11]===0&&d[12]<=1);first=false;}else valid(type!=='IHDR');
  let crc=crcStep(0xffffffff,head.subarray(4));for(let n=0;n<len;n+=65536)crc=crcStep(crc,await read(h,Math.min(65536,len-n),pos+8+n));valid(((crc^0xffffffff)>>>0)===(await read(h,4,pos+8+len)).readUInt32BE());if(type==='IDAT')data=true;if(type==='IEND'){valid(len===0&&data);ended=true;}pos+=12+len;
 }valid(ended);
}
async function jpeg(h,size){
 valid(size>=12&&(await read(h,2,0)).equals(Buffer.from([255,216])));let p=2,frame=false,scan=false,end=false;
 let cache=Buffer.alloc(0),cacheAt=-1;const byte=async pos=>{if(pos<cacheAt||pos>=cacheAt+cache.length){cacheAt=pos;cache=await read(h,Math.min(65536,size-pos),pos);}return cache[pos-cacheAt];};
 // Walk bounded blocks including entropy-coded bytes; no full image decode.
 while(p<size){const b=await byte(p++);if(b!==255){valid(scan);continue;}let marker;do{valid(p<size);marker=await byte(p++);}while(marker===255);
  if(scan&&(marker===0||marker>=0xd0&&marker<=0xd7))continue;if(marker===0xd9){valid(frame&&scan&&p===size);end=true;break;}
  valid(marker!==0&&marker!==0xd8&&p+2<=size);const len=(await read(h,2,p)).readUInt16BE();valid(len>=2&&p+len<=size);
  if([0xc0,0xc1,0xc2].includes(marker)){valid(len>=8);const f=await read(h,6,p+2);valid(f[0]===8&&f.readUInt16BE(1)>0&&f.readUInt16BE(3)>0);frame=true;}
  if(marker===0xda){valid(frame&&len>=6);scan=true;}p+=len;
 }valid(end);
}
async function webp(h,size){
 valid(size>=20);const head=await read(h,12,0);valid(head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8)==='WEBP'&&head.readUInt32LE(4)+8===size);let p=12,image=false;
 while(p<size){valid(p+8<=size);const c=await read(h,8,p),type=c.toString('ascii',0,4),len=c.readUInt32LE(4);valid(len>0&&p+8+len+(len%2)<=size);if(type==='VP8 '){valid(len>=10);const d=await read(h,10,p+8);valid((d[0]&1)===0&&d.subarray(3,6).equals(Buffer.from([157,1,42]))&&(d.readUInt16LE(6)&0x3fff)>0&&(d.readUInt16LE(8)&0x3fff)>0);image=true;}else if(type==='VP8L'){valid(len>=5&&(await read(h,1,p+8))[0]===0x2f);image=true;}else if(type==='VP8X'){valid(len===10);valid(!((await read(h,1,p+8))[0]&2));}else valid(!['ANIM','ANMF'].includes(type));p+=8+len+(len%2);
 }valid(image&&p===size);
}
export async function validateFile({handle,size,mime,extension}){
 try{if(extension==='glb'&&mime==='model/gltf-binary')await glb(handle,size);else if(extension==='png'&&mime==='image/png')await png(handle,size);else if(['jpg','jpeg'].includes(extension)&&mime==='image/jpeg')await jpeg(handle,size);else if(extension==='webp'&&mime==='image/webp')await webp(handle,size);else throw fault('INVALID_FILE');}catch{throw fault('INVALID_FILE');}
}
