(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CommunityProblemTypes=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const entry=(label,color)=>Object.freeze({label,color,promptTitle:label,hintText:`点击地图标记${label}位置。`});
 const types=Object.freeze({
  garbage:entry('垃圾堆积','#c64040'),
  road_damage:entry('道路破损','#ef6c00'),
  housing_disrepair:entry('房屋破败','#8d6e63'),
  drainage_issue:entry('路面积水','#2196f3'),
  safety_hazard:entry('安全隐患','#7b1fa2'),
  other:entry('其他','#607d8b')
 });
 function filterKey(category){return Object.hasOwn(types,category)?category:'other';}
 function meta(category){
  if(Object.hasOwn(types,category))return types[category];
  if(category==='public_space_need')return entry('公共空间需求','#2e7d32');
  return entry(String(category||'其他').replace(/^other:/,''),types.other.color);
 }
 function categoryFor(key,custom=''){
  if(!key)return null;
  if(!Object.hasOwn(types,key))throw Error('UNKNOWN_PROBLEM_TYPE');
  if(key!=='other')return key;
  const type=String(custom).trim().replace(/\s+/g,' ');
  if(!type)throw Error('PROBLEM_TYPE_REQUIRED');
  if(type.length>40)throw Error('PROBLEM_TYPE_TOO_LONG');
  return 'other:'+type;
 }
 function restoreFilters(saved,version){
  const keys=new Set(saved.map(filterKey));
  if(version!==2){keys.add('housing_disrepair');keys.add('other');}
  return [...keys];
 }
 return Object.freeze({types,meta,filterKey,categoryFor,restoreFilters});
});
