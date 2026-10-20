(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BusinessFilesClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function createBusinessFilesClient({origin=globalThis.location?.origin,getAccessToken,getIdentityKey,fetchImpl=globalThis.fetch,uuid=()=>globalThis.crypto.randomUUID(),createObjectURL=b=>URL.createObjectURL(b),revokeObjectURL=u=>URL.revokeObjectURL(u)}){
  const base=new URL('/api/v1',origin),urls=new Map();let currentKey=null,bytes=0;
  if(base.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('HTTPS_REQUIRED');
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
   const owner=identity(),files=Object.entries(fileMap).map(([role,file])=>{const extension=purpose==='group-model'?'glb':purpose==='dataset'?role.split('.').at(-1):String(file.name||'').split('.').at(-1).toLowerCase();const mime={glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json',geojson:'application/geo+json'}[extension];if(!mime)throw Error('FILE_TYPE_UNSUPPORTED');return {role,size:file.size,mime,extension};});
   const session=await request('/files/sessions',{method:'POST',body:{purpose,context,requestId:uuid(),files}});
   for(const f of files){if(owner!==identity())throw Error('UNAUTHORIZED');await request('/files/sessions/'+encodeURIComponent(session.id)+'/'+encodeURIComponent(f.role),{method:'PUT',body:fileMap[f.role],binary:true});}
   if(owner!==identity())throw Error('UNAUTHORIZED');return request('/files/sessions/'+encodeURIComponent(session.id)+'/commit',{method:'POST',body:record});
  }
  return {
   clear,resolveFileUrl,
   async resolvePathUrl(bucket,path){const r=await request('/files/resolve-path',{method:'POST',body:{bucket,path}});return resolveFileUrl(r.fileId);},
   async uploadPhoto(target,file){const {teachingProjectId,villageId,spaceId,objectCode,objectType,surveyLayerKey}=target;const result=await upload('photo',{teachingProjectId,villageId,spaceId},{photo:file},{objectCode,objectType,...(surveyLayerKey==null?{}:{surveyLayerKey})});return {...result,photoUrl:await resolveFileUrl(result.fileId),photoPath:result.photo_path};},
   uploadModel({context,files,name,metadata}){return upload('group-model',context,files,{name,metadata});},
   uploadDataset({villageId,selection,versionLabel}){return upload('dataset',{villageId},Object.fromEntries(selection.files),{versionLabel});}
  };
 }
 return {createBusinessFilesClient};
});
