(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BuildingGenerationMode=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function dimensions(purpose,source,edited){
  const value=purpose==='existing'?source:edited;
  if(!value||![value.length,value.depth].every(n=>Number.isFinite(n)&&n>0))throw Error('缺少原白模占地尺寸，请从地图建筑重新打开生成器。');
  return {length:value.length,depth:value.depth};
 }
 function fromRun(run){return {method:run.generation_method==='components'?'components':'texture',purpose:run.model_purpose==='design'?'design':'existing'};}
 function stages(method,purpose){return {cropRoof:method!=='components',preprocess:method!=='components'||purpose!=='design'};}
 function footprintSupport(method,purpose,ratio){
  if(method!=='components'||purpose!=='existing')return {supported:true,message:''};
  if(!Number.isFinite(Number(ratio))||Number(ratio)<.98||Number(ratio)>1)return {supported:false,message:'当前白模占地存在不规则边界，现状构件建模暂不支持精确保留。请选择“原有照片贴图”还原现状，或切换“新建 / 改建农房”生成新方案。'};
  return {supported:true,message:''};
 }
 function stepLabels(method,purpose){
  if(method==='components'&&purpose==='design')return [{key:'upload',label:'1. 上传正立面'},{key:'crop',label:'2. 确认参数'},{key:'generate',label:'3. 识别与建模'}];
  return [{key:'upload',label:'1. 选择照片'},{key:'identify',label:'2. 识别与清理'},{key:'rectify',label:'3. 正立面校正'},
   {key:'crop',label:method==='components'?'4. 确认参数':'4. 确认屋顶线'},{key:'generate',label:'5. 生成建筑'}];
 }
 function previewKey(run){return run?.id?String(run.id)+':'+Number(run.rectification_attempt_count||0):'';}
 function previewReady(run,key,url){return Boolean(url&&previewKey(run)&&previewKey(run)===key);}
 function placement(center,footprintHeading,autoHeading){
  const heading=(((-footprintHeading-autoHeading)%360)+540)%360-180;
  return {heading,offsetX:center.x,offsetY:-center.z};
 }
 return {dimensions,fromRun,stages,placement,footprintSupport,stepLabels,previewKey,previewReady};
});
