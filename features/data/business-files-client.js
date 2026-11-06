(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BusinessFilesClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function createBusinessFilesClient({origin=globalThis.location?.origin,getAccessToken,getIdentityKey,fetchImpl=globalThis.fetch,storage=globalThis.localStorage,uuid=()=>globalThis.crypto.randomUUID(),createObjectURL=b=>URL.createObjectURL(b),revokeObjectURL=u=>URL.revokeObjectURL(u)}){
  const base=new URL('/api/v1',origin),urls=new Map();let currentKey=null,bytes=0;
  if(base.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('HTTPS_REQUIRED');
  const pending=new Map(),canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  const hash=async value=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
  function save(key,value){try{if(storage){if(value)storage.setItem(key,JSON.stringify(value));else storage.removeItem(key);}else if(typeof window!=='undefined')throw Error();if(value)pending.set(key,value);else pending.delete(key);}catch{throw Error('OPERATION_RECEIPT_UNAVAILABLE');}}
  function load(key){try{return storage?JSON.parse(storage.getItem(key)||'null'):pending.get(key);}catch{throw Error('OPERATION_RECEIPT_UNAVAILABLE');}}
  function clear(){for(const v of urls.values())revokeObjectURL(v.url);urls.clear();bytes=0;currentKey=null;}
  function identity(){const key=getIdentityKey();if(typeof key!=='string'||!key)throw Error('UNAUTHORIZED');if(key!==currentKey){clear();currentKey=key;}return key;}
  async function request(path,{body,method='GET',binary=false,responseFile=false}={}){
   const owner=identity(),token=await getAccessToken();if(!token||owner!==identity())throw Error('UNAUTHORIZED');
   const response=await fetchImpl(base.href+path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':binary?'application/octet-stream':'application/json'})},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(binary?180000:30000),...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
   if(owner!==identity())throw Error('UNAUTHORIZED');
   if(!response.ok){let code;try{code=(await response.json()).error?.code;}catch{}throw Object.assign(Error(code||'FILE_UNAVAILABLE'),{code:code||'FILE_UNAVAILABLE'});}
   const result=method==='HEAD'?response.headers?.get('etag'):responseFile?{blob:await response.blob(),etag:response.headers?.get('etag')}:(await response.json()).data;if(owner!==identity())throw Error('UNAUTHORIZED');return result;
  }
  async function resolveFileUrl(id){
   identity();if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))throw Error('INVALID_FILE_ID');
   // Authorization is rechecked even if this browser already holds a blob.
   const owner=currentKey,cached=urls.get(id);
   if(cached?.etag){try{const etag=await request('/files/'+id,{method:'HEAD'});if(owner!==identity())throw Error('UNAUTHORIZED');if(etag===cached.etag)return cached.url;}catch(e){if(urls.get(id)===cached){revokeObjectURL(cached.url);bytes-=cached.size;urls.delete(id);}throw e;}}
   const response=await request('/files/'+id,{responseFile:true}),blob=response.blob;if(owner!==identity())throw Error('UNAUTHORIZED');
   const old=urls.get(id);if(old){revokeObjectURL(old.url);bytes-=old.size;urls.delete(id);}const url=createObjectURL(blob);urls.set(id,{url,size:blob.size,etag:/^"[a-f0-9]{64}"$/.test(response.etag??'')?response.etag:null});bytes+=blob.size;
   while(urls.size>32||bytes>100*1024**2&&urls.size>1){const first=urls.keys().next().value,entry=urls.get(first);revokeObjectURL(entry.url);bytes-=entry.size;urls.delete(first);}return url;
  }
  async function upload(purpose,context,fileMap,record){
   const owner=identity();let photoExtension;
   if(purpose==='photo'){
    const header=new Uint8Array(await fileMap.photo.slice(0,12).arrayBuffer()),starts=signature=>signature.every((v,i)=>header[i]===v);
    if(starts([137,80,78,71,13,10,26,10]))photoExtension='png';
    else if(starts([255,216,255]))photoExtension=/\.jpeg$/i.test(fileMap.photo.name||'')?'jpeg':'jpg';
    else if(starts([82,73,70,70])&&[87,69,66,80].every((v,i)=>header[i+8]===v))photoExtension='webp';
   }
   const files=Object.entries(fileMap).map(([role,file])=>{const extension=purpose==='group-model'?'glb':purpose==='dataset'?role.split('.').at(-1):photoExtension||String(file.name||'').split('.').at(-1).toLowerCase();const mime={glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json',geojson:'application/geo+json'}[extension];if(!mime)throw Error('FILE_TYPE_UNSUPPORTED');return {role,size:file.size,mime,extension};});
   const hashes=await Promise.all(files.map(async f=>[f.role,await hash(await fileMap[f.role].arrayBuffer())]));
   if(owner!==identity())throw Error('UNAUTHORIZED');
   const receiptKey='village:pending-file:'+await hash(new TextEncoder().encode(canonical({owner,purpose,context,record,files,hashes})));
   if(owner!==identity())throw Error('UNAUTHORIZED');
   let receipt=load(receiptKey)||{requestId:uuid()};save(receiptKey,receipt);
   let session;
   if(receipt.sessionId){
    try{session=await request('/files/sessions/'+encodeURIComponent(receipt.sessionId));}catch(e){if(e.code!=='UPLOAD_EXPIRED')throw e;}
    if(!session||session.state!=='committed'&&(session.state==='aborted'||Date.parse(session.expires_at)<=Date.now()||session.files?.some(f=>f.state==='failed'))){receipt={requestId:uuid()};save(receiptKey,receipt);session=null;}
   }
   if(!session)session=await request('/files/sessions',{method:'POST',body:{purpose,context,requestId:receipt.requestId,files}});
   receipt.sessionId=session.id;save(receiptKey,receipt);
   if(session.state==='committed')return {result:session.result,finish:()=>save(receiptKey,null)};
   for(const f of files){if(owner!==identity())throw Error('UNAUTHORIZED');try{await request('/files/sessions/'+encodeURIComponent(session.id)+'/'+encodeURIComponent(f.role),{method:'PUT',body:fileMap[f.role],binary:true});}catch(e){if(['INVALID_FILE','FILE_TOO_LARGE','UPLOAD_EXPIRED'].includes(e.code))save(receiptKey,null);throw e;}}
   if(owner!==identity())throw Error('UNAUTHORIZED');return {result:await request('/files/sessions/'+encodeURIComponent(session.id)+'/commit',{method:'POST',body:record}),finish:()=>save(receiptKey,null)};
  }
  return {
   clear,resolveFileUrl,
   async resolvePathUrl(bucket,path){const r=await request('/files/resolve-path',{method:'POST',body:{bucket,path}});return resolveFileUrl(r.fileId);},
   async uploadPhoto(target,file){const {teachingProjectId,villageId,spaceId,objectCode,objectType,surveyLayerKey}=target;const receipt=await upload('photo',{teachingProjectId,villageId,spaceId},{photo:file},{objectCode,objectType,...(surveyLayerKey==null?{}:{surveyLayerKey})});const result=receipt.result,photoUrl=await resolveFileUrl(result.fileId);receipt.finish();return {...result,photoUrl,photoPath:result.photo_path};},
   async uploadModel({context,files,name,metadata}){const receipt=await upload('group-model',context,files,{name,metadata});receipt.finish();return receipt.result;},
   async uploadDataset({villageId,selection,versionLabel}){const receipt=await upload('dataset',{villageId},Object.fromEntries(selection.files),{versionLabel});receipt.finish();return receipt.result;}
  };
 }
 return {createBusinessFilesClient};
});
