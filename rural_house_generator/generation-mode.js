(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BuildingGenerationMode=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function dimensions(purpose,source,edited){
  const value=purpose==='existing'?source:edited;
  if(!value||![value.length,value.depth].every(n=>Number.isFinite(n)&&n>0))throw Error('缺少原白模占地尺寸，请从地图建筑重新打开生成器。');
  return {length:value.length,depth:value.depth};
 }
 function fromRun(run){return {method:run.generation_method==='components'?'components':'texture',purpose:run.model_purpose==='design'?'design':'existing'};}
 function stages(method,purpose){return {cropRoof:method!=='components',preprocess:method!=='components'||purpose!=='design'};}
 function placement(center,footprintHeading,autoHeading){
  const heading=(((-footprintHeading-autoHeading)%360)+540)%360-180;
  return {heading,offsetX:center.x,offsetY:-center.z};
 }
 return {dimensions,fromRun,stages,placement};
});
