(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageGrowth=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)),skills=['culture','craft','community'],kinds=['chat','guide','craft'];
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x),count=x=>Number.isInteger(x)&&x>=0&&x<=1000000;
 const empty=()=>({version:1,people:{},facilities:{},community:{chat:0,guide:0,craft:0}});
 function validate(state,scene){
  const bad=()=>['生活成长数据无效，请使用有效的方案备份'];
  if(!object(state)||state.version!==1||Object.keys(state).some(k=>!['version','people','facilities','community'].includes(k))||!object(state.people)||!object(state.facilities)||!object(state.community))return bad();
  const people=new Set((scene.people||[]).map(p=>p.id)),buildings=new Map(scene.buildings.map(b=>[b.id,b]));
  if(Object.keys(state.people).length>people.size||Object.keys(state.facilities).length>buildings.size||Object.keys(state.community).length!==3||kinds.some(k=>!count(state.community[k])))return bad();
  for(const [id,p] of Object.entries(state.people))if(!people.has(id)||!object(p)||Object.keys(p).length!==3||skills.some(k=>!Number.isInteger(p[k])||p[k]<0||p[k]>100))return bad();
  for(const [id,f] of Object.entries(state.facilities)){
   if(!buildings.has(id)||!object(f)||Object.keys(f).length!==5||f.type!==buildings.get(id).type||!count(f.visits)||!count(f.count)||f.visits!==f.count||!Number.isFinite(f.total)||f.total<0||f.total>f.count*100||![0,1,2].includes(f.stage)||f.stage>=1&&(f.visits<12||f.total<720)||f.stage===2&&(f.visits<36||f.total<2340))return bad();
  }return [];
 }
 function bonus(state,id){return Math.min(6,(state?.facilities?.[id]?.stage||0)*3);}
 function create(scene){
  if(scene.growth&&validate(scene.growth,scene).length)throw new Error('生活成长数据无效');
  const state=scene.growth?clone(scene.growth):empty(),initial=clone(state),seen=new Set(),residents=new Set((scene.people||[]).map(p=>p.id));
  function record(a,b,task,experience,day){
   if(!b||['home','inn'].includes(b.type)||!['service','school','work'].includes(task.mode)||!Number.isFinite(experience))return null;
   const key=day+'|'+a.id+'|'+b.id;if(seen.has(key))return null;seen.add(key);
   const f=state.facilities[b.id]||(state.facilities[b.id]={type:b.type,visits:0,total:0,count:0,stage:0}),old=f.stage;
   if(f.visits>=1000000)return null;f.visits++;f.count++;f.total+=Math.max(0,Math.min(100,experience));
   const average=f.total/f.count;f.stage=Math.max(f.stage,f.visits>=36&&average>=65?2:f.visits>=12&&average>=60?1:0);
   return f.stage>old?{id:b.id,name:b.name,stage:f.stage}:null;
  }
  function completeEvent(participants,kind){
   if(!kinds.includes(kind))return;state.community[kind]=Math.min(1000000,state.community[kind]+1);
   const key=kind==='guide'?'culture':kind==='craft'?'craft':'community';
   for(const a of participants)if(a.kind==='resident'&&residents.has(a.id)){const p=state.people[a.id]||(state.people[a.id]={culture:0,craft:0,community:0});p[key]=Math.min(100,p[key]+1);}
  }
  function summary(){return {state:clone(state),initial:clone(initial),outcomes:Object.fromEntries(kinds.map(k=>[k,state.community[k]-initial.community[k]])),
   facilities:Object.entries(state.facilities).map(([id,f])=>({id,name:scene.buildings.find(b=>b.id===id)?.name||id,stage:f.stage,previousStage:initial.facilities[id]?.stage||0,visits:f.visits,newVisits:f.visits-(initial.facilities[id]?.visits||0),average:f.count?Math.round(f.total/f.count*10)/10:0})),
   people:Object.entries(state.people).map(([id,p])=>({id,name:scene.people.find(a=>a.id===id)?.name||id,...p}))};}
  return {record,completeEvent,bonus:id=>bonus(state,id),export:()=>clone(state),summary};
 }
 return {create,validate,bonus,empty};
});
