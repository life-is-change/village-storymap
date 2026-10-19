(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('../../3D_scenes_edit/assets/scene-asset-library.js'):root.SceneAssetLibraryModule);if(common)module.exports=api;if(root)root.SceneServicesModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(assets){
 function createSceneServices({api,getAccessToken,contextProvider,instanceId,storage=globalThis.localStorage,createObjectURL=b=>URL.createObjectURL(b),revokeObjectURL=u=>URL.revokeObjectURL(u)}){
  if(!api?.dataClient||typeof contextProvider!=='function'||!instanceId||!storage)throw Error('SCENE_SERVICES_REQUIRED');
  const initial={...contextProvider()},owned=new Set();let disposed=false;
  const scopeFields=['userId','teachingProjectId','courseId','villageId','spaceId','groupId','scopeKind'];
  function context(){const c=contextProvider();if(disposed)throw Error('CLIENT_DISPOSED');if(!c||scopeFields.some(k=>c[k]!==initial[k]))throw Error('CONTEXT_CHANGED');return c;}
  const client=Object.fromEntries(Object.entries(api.dataClient).map(([name,fn])=>[name,async(...args)=>{try{context();const r=await fn.apply(api.dataClient,args);context();return r;}catch(e){return {ok:false,code:e.message==='CLIENT_DISPOSED'?'CLIENT_DISPOSED':e.message==='CONTEXT_CHANGED'?'CONTEXT_CHANGED':'NETWORK_ERROR'};}}]));
  client.createVersion=async()=>({ok:false,code:'ATOMIC_PREVIEW_REQUIRED'});
  const library=assets.createAssetLibrary({dataClient:client,uploadBundle:async input=>{context();const result=await api.uploadBundle(input);context();return result;}});
  function draftKey(identity){const c=context();if(identity.userId!==c.userId||identity.spaceId!==c.spaceId||typeof identity.projectId!=='string')throw Error('CONTEXT_CHANGED');return 'village-scene:'+JSON.stringify(['aliyun',instanceId,c.userId,c.teachingProjectId,c.villageId,c.spaceId,c.scopeKind||'group',c.groupId??c.userId,identity.projectId]);}
  return {
   client,
   localStore:{
    read(identity){const raw=storage.getItem(draftKey(identity));if(!raw)return null;try{return JSON.parse(raw);}catch{return null;}},
    write(identity,record){storage.setItem(draftKey(identity),JSON.stringify(record));return record;},
    remove(identity,revision){const key=draftKey(identity),raw=storage.getItem(key);if(raw&&revision!==undefined){try{if(JSON.parse(raw)?.revision!==revision)return false;}catch{}}storage.removeItem(key);return true;}
   },
   async uploadAsset({file,...input}){
    try{const c=context();if(!file)return {ok:false,code:'CANCELLED'};
     const result=await library.upload(file,{...input,kind:input.kind||'model',scope:c.scopeKind==='admin_sandbox'?'personal':'group',ownerId:c.scopeKind==='admin_sandbox'?c.userId:c.groupId,courseId:c.courseId,groupId:c.groupId??null,ownerUserId:c.userId});context();return result;
    }catch(e){return {ok:false,code:['CONTEXT_CHANGED','CLIENT_DISPOSED'].includes(e.message)?e.message:'UPLOAD_FAILED'};}
   },
   async createMilestone({document,label,description='',previewBlob}){
    try{context();if(!previewBlob||previewBlob.type!=='image/png'||!previewBlob.size)return {ok:false,code:'PREVIEW_CAPTURE_FAILED'};
     const result=await api.uploadPreview({purpose:'version-preview',context:{projectId:document.projectId,revision:document.revision},blob:previewBlob,record:{label,description}});context();return result;
    }catch(e){return {ok:false,code:['CONTEXT_CHANGED','CLIENT_DISPOSED'].includes(e.message)?e.message:'PREVIEW_UPLOAD_FAILED'};}
   },
   async resolveAssetUrl(asset,{variant='display'}={}){
    context();if(typeof asset?.id!=='string'||!asset.id)throw Error('ASSET_ID_REQUIRED');
    if(asset.id.startsWith('seed:')){if(!/^3D_scenes_edit\/assets\/models\/[a-zA-Z0-9_-]+\.glb(?:\?v=[a-zA-Z0-9_-]+)?$/.test(asset.url||''))throw Error('UNTRUSTED_ASSET_URL');return asset.url;}
    const result=await api.resolveAsset(asset.id,variant);context();if(!result.ok)throw Object.assign(Error(result.code),{code:result.code});return result.url;
   },
   createObjectURL(blob){context();const url=createObjectURL(blob);owned.add(url);return url;},
   dispose(){if(disposed)return;disposed=true;api.dispose();for(const url of owned)revokeObjectURL(url);owned.clear();}
  };
 }
 return {createSceneServices};
});
