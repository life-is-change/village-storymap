(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.SceneApiClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const codes=new Set(['INVALID_INPUT','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','REVISION_CONFLICT','PROJECT_SUBMITTED','BASELINE_MISMATCH','FILES_NOT_READY','PAYLOAD_TOO_LARGE','AUTH_UNAVAILABLE','DB_UNAVAILABLE','PROFILE_NOT_SYNCED']);
 function createSceneApiClient({baseUrl='/api/v1/scene',getAccessToken,fetchImpl=globalThis.fetch}){
  const current=globalThis.location?.origin,base=new URL(baseUrl,current||'http://invalid.local');
  const local=['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&['http:','https:'].includes(base.protocol);
  if(base.username||base.password||base.search||base.hash||!(local||(current&&base.origin===current&&base.protocol==='https:'))||base.pathname.replace(/\/$/,'')!=='/api/v1/scene')throw Error('INVALID_API_ORIGIN');
  async function request(op,input){
   try{
    const token=await getAccessToken();if(!token)return {ok:false,code:'UNAUTHORIZED'};
    const response=await fetchImpl(base.href.replace(/\/$/,'')+'/'+op,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
    const value=await response.json();
    if(response.ok&&Object.hasOwn(value,'data'))return {ok:true,data:value.data};
    const code=codes.has(value?.error?.code)?value.error.code:'API_UNAVAILABLE';
    return {ok:false,code,message:code,...(code==='REVISION_CONFLICT'&&Number.isSafeInteger(value.error.remoteRevision)?{remoteRevision:value.error.remoteRevision}:{})};
   }catch{return {ok:false,code:'NETWORK_ERROR',message:'NETWORK_ERROR'};}
  }
  const notReady=async()=>({ok:false,code:'FILES_NOT_READY',message:'FILES_NOT_READY'});
  return {findActiveProject:s=>request('find',{teachingProjectId:s.teachingProjectId,villageId:s.villageId,spaceId:s.spaceId,groupId:s.groupId??null,scopeKind:s.scopeKind||'group'}),
   createProject:i=>request('create',{teachingProjectId:i.teachingProjectId,villageId:i.villageId,spaceId:i.spaceId,groupId:i.groupId??null,scopeKind:i.scopeKind||'group',title:i.title,baselineRevision:i.baselineRevision,selectionBoundary:i.selectionBoundary??null}),
   loadProject:projectId=>request('load',{projectId}),saveDraft:document=>request('save',{document}),
   branchFromBaseline:i=>request('branch',{projectId:i.projectId,baselineRevision:i.baselineRevision,title:i.title}),
   createVersion:i=>request('version',{projectId:i.document.projectId,revision:i.document.revision,label:i.label,description:i.description||'',previewPath:i.previewPath??null}),
   restoreVersionAsDraft:i=>request('restore',i),submitVersion:versionId=>request('submit',{versionId}),listVersions:projectId=>request('versions',{projectId}),
   listAssets:notReady,registerAsset:notReady,updateAssetMetadata:notReady,publishAsset:notReady,copySharedAsset:notReady,archiveAsset:notReady,
   saveComponent:notReady,listComponents:notReady,publishComponent:notReady,copySharedComponent:notReady,archiveComponent:notReady};
 }
 return {createSceneApiClient};
});
