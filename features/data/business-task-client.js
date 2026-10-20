(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BusinessTaskClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
 const artifactTypes=new Set(['buildings','roads','waterways','water_areas','contours','rectified_preview','rectified_source','building_mask','building_glb','standard_facade']);
 function createBusinessTaskClient({api,contextProvider,storage=globalThis.localStorage,uuid=()=>crypto.randomUUID(),createObjectURL=b=>URL.createObjectURL(b),revokeObjectURL=u=>URL.revokeObjectURL(u),wait=ms=>new Promise(r=>setTimeout(r,ms))}){
  let disposed=false,total=0;const timers=new Set(),urls=new Map();
  const error=code=>Object.assign(Error(code),{code});
  const context=()=>{if(disposed)throw error('CONTEXT_CHANGED');const c=contextProvider();return {teachingProjectId:c.teachingProjectId,villageId:c.villageId,spaceId:c.spaceId,courseId:c.courseId};};
  const key=()=>JSON.stringify(contextProvider());
  async function run(name,input={}){if(disposed)throw error('CONTEXT_CHANGED');const before=key(),result=await api.execute('tasks.'+name,input);if(disposed||before!==key())throw error('CONTEXT_CHANGED');return result;}
  const task=(v)=>({...v,id:v.requestId,photo_id:v.photoId,object_code:v.objectCode,space_id:v.context?.spaceId,course_id:v.context?.courseId,created_at:v.createdAt,updated_at:v.updatedAt,error_code:v.errorCode,syncState:v.state,status:v.kind==='facade'&&v.status==='queued'?'queued_rectification':v.status});
  const getRun=async id=>task(await run('get',{requestId:id}));
  const pending=new Map(),canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  async function receiptOperation(name,input){
   const before=key(),scope=api.getIdentityKey?.()||before;
   const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical({scope,context:context(),name,input})));
   const receiptKey='village:pending-task:'+Array.from(new Uint8Array(raw),n=>n.toString(16).padStart(2,'0')).join('');
   if(before!==key()||scope!==(api.getIdentityKey?.()||key())||disposed)throw error('CONTEXT_CHANGED');
   let id;try{id=storage?.getItem(receiptKey)||pending.get(receiptKey)||uuid();if(storage)storage.setItem(receiptKey,id);else if(typeof window!=='undefined')throw Error();pending.set(receiptKey,id);}catch{throw error('OPERATION_RECEIPT_UNAVAILABLE');}
   const result=await run(name,{...input,requestId:id});
   try{storage?.removeItem(receiptKey);pending.delete(receiptKey);}catch{throw error('OPERATION_RECEIPT_UNAVAILABLE');}return result;
  }
  const submit=async(kind,p)=>{const c={...context(),...Object.fromEntries(['teachingProjectId','villageId','spaceId','courseId'].filter(k=>p[k]!=null).map(k=>[k,p[k]]))},input=kind==='geo'?{...c,requestedSteps:p.requestedSteps,aoi:p.aoi,parameters:{building_threshold:Number(p.parameters?.building_threshold??p.parameters?.building_score_threshold??0.35),contour_interval:Number(p.parameters?.contour_interval??p.parameters?.contour_interval_m??5),contour_smoothing:Number(p.parameters?.contour_smoothing??p.parameters?.smoothing_sigma??1)}}:{...c,kind,objectCode:p.objectCode,photoId:Number(p.photoId)};return (await receiptOperation(kind==='geo'?'submitGeo':'submitFacade',input)).requestId;};
  async function list(kind,villageId=context().villageId){const rows=await run('list',{villageId});return rows.filter(r=>r.kind===kind).map(task);}
  function subscribe(id,callback){const before=key();let active=true,busy=false;const stop=()=>{active=false;clearInterval(timer);timers.delete(stop);};const timer=setInterval(async()=>{if(!active||busy)return;if(disposed||before!==key()){stop();return;}busy=true;try{const value=await getRun(id);if(active)callback(value);}catch(e){if(e.code==='CONTEXT_CHANGED'||['FORBIDDEN','NOT_FOUND','PROFILE_DISABLED'].includes(e.code))stop();}finally{busy=false;}},5000);timer.unref?.();timers.add(stop);return stop;}
  async function listArtifacts(id){return (await run('artifacts',{requestId:id})).map(a=>({...a,storage_path:`task:${id}:${a.artifact_type}`}));}
  async function artifactUrl(reference){
   const m=/^task:([^:]+):([-a-z_]+)$/.exec(String(reference));if(!m||!uuidPattern.test(m[1])||!artifactTypes.has(m[2]))throw error('INVALID_INPUT');
   const before=key(),descriptors=await run('artifacts',{requestId:m[1]}),descriptor=descriptors.find(d=>d.artifact_type===m[2]);if(!descriptor)throw error('NOT_FOUND');
   const cached=urls.get(reference);if(cached?.sha256===descriptor.sha256)return cached.url;
   const blob=await api.readTaskArtifact(m[1],m[2],{sha256:descriptor.sha256});if(disposed||before!==key())throw error('CONTEXT_CHANGED');
   if(!(blob instanceof Blob)||blob.size>50*1024**2)throw error('INVALID_FILE');
   const old=urls.get(reference);if(old){revokeObjectURL(old.url);total-=old.size;urls.delete(reference);}
   while(urls.size>=16||total+blob.size>100*1024**2){const [k,v]=urls.entries().next().value;urls.delete(k);total-=v.size;revokeObjectURL(v.url);}
   const url=createObjectURL(blob);urls.set(reference,{url,size:blob.size,sha256:descriptor.sha256});total+=blob.size;return url;
  }
  const cancel=id=>receiptOperation('cancel',{taskId:id});
  const geoprocessing={deploymentMode:'aliyun',getRun,listMine:v=>list('geo',v),submit:p=>submit('geo',p),subscribe,cancel,listArtifacts,async getAvailability(){return run('availability',{kind:'geoprocessing'});},getSourceStatus:villageId=>run('sourceStatus',{villageId}),async getVillage(villageId){const s=await this.getSourceStatus(villageId);return {...s,village_id:villageId,active:s.state==='ready'};},async createArtifactUrl(path){return {signedUrl:await artifactUrl(path)};},async isRunImported(id){return Boolean((await getRun(id)).importedBundle);},async importRun(id){const target=contextProvider().personalSpaceId;if(!uuidPattern.test(target??''))throw error('PERSONAL_SPACE_NOT_READY');await receiptOperation('importResult',{taskId:id,spaceId:target});for(let i=0;i<120;i++){const t=await getRun(id);if(t.importedBundle)return t.importedBundle;if(['failed','revoked','canceled'].includes(t.state))throw error(t.errorCode??'IMPORT_FAILED');await wait(1000);}throw error('IMPORT_PENDING');}};
  const facade={deploymentMode:'aliyun',getRun,submit:p=>submit('facade',p),subscribe,cancel,listArtifacts,createArtifactUrl:artifactUrl,getWorkerAvailability:()=>run('availability',{kind:'facade'}),async findLatestRun(c){return (await list('facade')).find(r=>r.space_id===c.spaceId&&r.object_code===c.objectCode)??null;},async findActiveRun(c){return (await list('facade')).find(r=>r.space_id===c.spaceId&&r.object_code===c.objectCode&&!['completed','failed','canceled','revoked'].includes(r.state))??null;},confirmCrop:(taskId,p)=>receiptOperation('confirmCrop',{taskId,...p}),retryFailed:taskId=>receiptOperation('retry',{taskId})};
  const cloud={getCapability:()=>run('availability',{kind:'cloud-facade'}),async submit(p){return {runId:await submit('cloud-facade',p),status:'pending'};},async poll(id){const t=await getRun(id);if(t.state==='completed')return {...t,id,status:'succeeded',resultUrl:await artifactUrl(`task:${id}:standard_facade`)};return {...t,id,status:t.state==='failed'?'failed':t.status,errorMessage:t.errorCode??''};}};
  return {geoprocessing,facade,cloud,dispose(){disposed=true;for(const stop of [...timers])stop();for(const v of urls.values())revokeObjectURL(v.url);urls.clear();total=0;}};
 }
 return {createBusinessTaskClient};
});
