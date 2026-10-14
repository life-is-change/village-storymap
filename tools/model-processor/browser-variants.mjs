import { WebIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import Normalizer from '../../features/models/glb-normalization.js';

const MAX_BYTES=50*1024*1024;
const asBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const triangles=p=>p.getMode()===4?Math.floor((p.getIndices()?.getCount()||p.getAttribute('POSITION')?.getCount()||0)/3):0;

/** Worker-safe image resampling. Keeps PNG alpha and JPEG encoding; no remote resources. */
export async function resizeBrowserImage(bytes,mimeType,maxSize){
 if(typeof createImageBitmap!=='function'||typeof OffscreenCanvas!=='function')throw new Error('浏览器缺少后台贴图处理能力，请使用最新版 Chrome 或 Edge。');
 const bitmap=await createImageBitmap(new Blob([bytes],{type:mimeType}));
 try{
  const width=bitmap.width,height=bitmap.height;
  if(!width||!height||width*height>64*1024*1024)throw new Error('贴图像素过大，请缩小后再上传。');
  const ratio=Math.min(1,maxSize/width,maxSize/height);
  if(ratio===1)return {bytes,mimeType,width,height};
  const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('无法创建后台贴图画布。');
  ctx.drawImage(bitmap,0,0,w,h);
  const blob=await canvas.convertToBlob({type:mimeType,quality:.8});
  return {bytes:new Uint8Array(await blob.arrayBuffer()),mimeType:blob.type||mimeType,width:w,height:h};
 }finally{bitmap.close();}
}

/** A single upload becomes two persistent variants; originals are owned by the upload caller. */
export async function createModelVariants(value,options={}){
 const started=performance.now(),bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 if(bytes.byteLength>MAX_BYTES)throw new Error('模型文件不能超过 50 MB。');
 const parsed=Normalizer.readGlb(bytes),used=parsed.json.extensionsUsed||[],supported=new Set(ALL_EXTENSIONS.map(E=>E.EXTENSION_NAME));
 for(const ext of used)if(!supported.has(ext))throw new Error(`暂不支持模型扩展 ${ext}，原文件未改动。`);
 if(used.includes('KHR_draco_mesh_compression'))throw new Error('请先将 Draco 模型导出为普通 GLB 后上传。');
 if((parsed.json.buffers||[]).some(b=>b.uri)||(parsed.json.images||[]).some(i=>i.uri&&!i.uri.startsWith('data:')))throw new Error('GLB 必须内嵌所有几何与贴图，不能依赖外部文件。');
 await Promise.all([MeshoptDecoder.ready,MeshoptSimplifier.ready]);
 const io=new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
 const decoded=await io.readBinary(bytes);decoded.setLogger(new Logger(Logger.Verbosity.ERROR));
 for(const ext of decoded.getRoot().listExtensionsUsed())if(['EXT_meshopt_compression','KHR_meshopt_compression'].includes(ext.extensionName))ext.dispose();
 const normalized=Normalizer.normalizeGlb(asBuffer(await io.writeBinary(decoded)),{metersPerUnit:options.metersPerUnit??1});
 const highBuffer=normalized.buffer,low=await io.readBinary(new Uint8Array(highBuffer));low.setLogger(new Logger(Logger.Verbosity.ERROR));
 await low.transform(dedup(),weld());
 for(const mesh of low.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
  if(triangles(primitive)<32)continue;
  simplifyPrimitive(primitive,{simplifier:MeshoptSimplifier,ratio:.35,error:.01,lockBorder:true});
 }
 const textureResults=[],warnings=[],resize=options.resizeImage||resizeBrowserImage;
 for(const texture of low.getRoot().listTextures()){
  const mime=texture.getMimeType();
  if(!['image/png','image/jpeg','image/webp'].includes(mime)){warnings.push(`贴图 ${mime} 保留原编码，未缩小。`);continue;}
  const result=await resize(texture.getImage(),mime,512);
  texture.setImage(result.bytes).setMimeType(result.mimeType);
  textureResults.push({width:result.width,height:result.height,mimeType:result.mimeType});
 }
 await low.transform(dedup());
 const lowBuffer=asBuffer(await io.writeBinary(low)),lowInspection=Normalizer.inspectGlb(lowBuffer),inspection=Normalizer.inspectGlb(highBuffer);
 if(highBuffer.byteLength>MAX_BYTES||lowBuffer.byteLength>MAX_BYTES)throw new Error('处理后的模型文件超过 50 MB，请精简源模型。');
 if(lowInspection.triangleCount>=inspection.triangleCount)warnings.push('原模型部件较小或拓扑约束较强，面数保持；低模仍使用缩小贴图。');
 return {buffer:highBuffer,inspection,lowBuffer,lowInspection,processing:{engine:'browser-cpu',schemaVersion:1,automatic:true,lowRatio:.35,lowTextureSize:512,highTriangles:inspection.triangleCount,lowTriangles:lowInspection.triangleCount,highBytes:highBuffer.byteLength,lowBytes:lowBuffer.byteLength,textures:textureResults,warnings,elapsedMs:Math.round(performance.now()-started)}};
}
