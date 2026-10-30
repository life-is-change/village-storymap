(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillagePopulation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const PROFILES={
  'adult-male':{label:'成年男性',color:'#287465'},'adult-female':{label:'成年女性',color:'#36977d'},
  'senior-male':{label:'老年男性',color:'#a67537'},'senior-female':{label:'老年女性',color:'#bd9248'},
  'child-male':{label:'男孩',color:'#536fa9'},'child-female':{label:'女孩',color:'#758bc3'},
  day:{label:'日间观光客',color:'#bf6c37'},family:{label:'亲子体验客',color:'#a26ca0'},overnight:{label:'过夜度假客',color:'#ad526f'}
 };
 const JOBS={farm:'农业劳动',service:'村内服务',external:'村外就业',flex:'弹性事务',retired:'自主养老',student:'学生'};
 const group=age=>age<18?'child':age>=60?'senior':'adult';
 function generate(buildings,count,options={}){
  if(options.preset==='lingnan')return generateLingnan(buildings,count);
  const homes=buildings.filter(b=>b.type==='home'),people=[],households=[];let adults=0;
  for(let h=0;people.length<count;h++){
   const id='family-'+(h+1),home=homes[h%Math.max(1,homes.length)],j=Math.floor(h/4),sex=j%2?'female':'male',other=sex==='male'?'female':'male';
   const templates=[[[34,'male'],[32,'female'],[j%2?14:9,sex]],[[j%2?75:67,sex],[38,other],[j%2?10:15,other]],[[42,'male'],[40,'female'],[h%3?72:83,sex]],[[69,'male'],[68,'female'],[29,other]]];
   const household={id,name:['林','陈','周','王','吴','李','刘','张'][h%8]+'家 · '+(h+1),homeId:home?.id||null,members:[],resources:h%3===0?'basic':h%3===1?'middle':'comfortable'};
   for(const [age,gender] of templates[h%4]){if(people.length>=count)break;const ageGroup=group(age),index=people.length,job=ageGroup==='child'?'student':ageGroup==='senior'?'retired':adults<12?'farm':adults<28?'service':adults<32?'external':'flex';if(ageGroup==='adult')adults++;
    const person={id:'resident-'+(index+1),name:household.name.split(' · ')[0]+['阿明','阿兰','小禾','阿平','阿秀','小溪'][index%6]+' '+(index+1),age,sex:gender,ageGroup,profile:ageGroup+'-'+gender,householdId:id,job,schoolStage:age<13?'primary':'secondary',mobility:age>=80?.55:age>=60?.8:age<13?.85:1,needsEscort:age<12,social:index%4!==0,lightWork:ageGroup==='senior'&&age<75&&index%5===0};
    people.push(person);household.members.push(person.id);
   }
   households.push(household);
  }
  return {people,households};
 }
 function generateLingnan(buildings,count){
  const homes=buildings.filter(b=>b.type==='home'),people=[],households=[];let adults=0;
  for(let h=0;people.length<count;h++){
   const cycle=Math.floor(h/6),maleChild=cycle%2===0,surname=h<18?'林':h<22?'陈':'吴',spouse=surname==='林'?'陈':'林';
   const child=(age,sex)=>[age,sex,sex==='male'?'儿子':'女儿',surname];
   const variants=[
    {kind:'nuclear',description:'年轻父母与一名学前儿童同住',members:[[34,'male','父亲',surname],[32,'female','母亲',spouse],child([4,5,3,4][cycle%4],maleChild?'male':'female')]},
    {kind:'siblings',description:'父母与两名不同学段的子女同住',members:[[41,'male','父亲',surname],[39,'female','母亲',spouse],child(9+cycle%2,maleChild?'male':'female'),child(14+cycle%2,maleChild?'female':'male')]},
    {kind:'three-generations',description:'祖父母、父母与一名子女三代同住',members:[[cycle===2?83:72,'male','祖父',surname],[cycle===2?78:69,'female','祖母','黄'],[42,'male','父亲',surname],[40,'female','母亲',spouse],child(cycle%2?9:6,maleChild?'female':'male')]},
    {kind:'senior-couple',description:'老年夫妇同住，成年子女未在本户居住',members:[[74,'male','丈夫',surname],[72,'female','妻子',spouse]]},
    {kind:'adult-couple',description:'成年夫妇同住，本户没有未成年子女',members:[[45,'male','丈夫',surname],[43,'female','妻子',spouse]]},
    {kind:'intergenerational',description:cycle%2?'母亲与成年儿子同住，其他家长未同住':'父亲与成年女儿同住，其他家长未同住',members:cycle%2?[[55,'female','母亲',surname],[27,'male','成年儿子',surname]]:[[55,'male','父亲',surname],[27,'female','成年女儿',surname]]}
   ],v=variants[h%6],id='family-'+(h+1),household={id,name:surname+'家 · '+(h+1),surname,kind:v.kind,description:v.description,homeId:homes[h]?.id||null,members:[],resources:['basic','middle','comfortable'][h%3]};
   for(const [age,sex,role,nameSurname] of v.members){if(people.length>=count)break;const index=people.length,ageGroup=group(age),job=ageGroup==='child'?'student':ageGroup==='senior'?'retired':adults<12?'farm':adults<28?'service':adults<32?'external':'flex';if(ageGroup==='adult')adults++;
    const given=ageGroup==='senior'?(sex==='male'?'德安':'玉英'):ageGroup==='child'?(sex==='male'?'小禾':'小穗'):(sex==='male'?'志明':'秀兰');
    const person={id:'resident-'+(index+1),name:nameSurname+given+' '+String(h+1).padStart(2,'0'),age,sex,role,ageGroup,profile:ageGroup+'-'+sex,householdId:id,job,schoolStage:age<6?'preschool':age<13?'primary':'secondary',mobility:age>=80?.55:age>=60?.8:age<6?.65:age<13?.85:1,needsEscort:age<12,social:index%4!==0,lightWork:ageGroup==='senior'&&age<75&&index%5===0};
    people.push(person);household.members.push(person.id);
   }households.push(household);
  }return {people,households};
 }
 function describeHousehold(h,people){return h.description||'旧版家庭：成员关系未记录，不能根据年龄和性别推断夫妻或亲子关系。';}
 function validate(scene){
  const errors=[],safe=s=>typeof s==='string'&&s.length>0&&s.length<=80&&!['entry','__proto__','prototype','constructor'].includes(s);
  if(!Array.isArray(scene.people)||scene.people.length>180||scene.people.length!==scene.scenario?.population)return ['常住人口与人物列表不一致'];
  if(!Array.isArray(scene.households)||scene.households.length>90)return ['家庭列表无效'];
  const ids=new Set(),families=new Map(),membership=new Map();
  for(const h of scene.households){if(h&&(['kind','description','surname'].some(k=>h[k]!==undefined&&(typeof h[k]!=='string'||h[k].length>120))))errors.push('家庭关系描述无效');if(!h||!safe(h.id)||families.has(h.id)||typeof h.name!=='string'||h.name.length>60||!['basic','middle','comfortable'].includes(h.resources)||!Array.isArray(h.members)||h.members.length<1||h.members.length>10||h.homeId!==null&&!safe(h.homeId)){errors.push('家庭信息无效');continue;}families.set(h.id,h);for(const id of h.members){if(!safe(id)||membership.has(id))errors.push('家庭成员重复或无效');membership.set(id,h.id);}}
  for(const p of scene.people){if(p?.role!==undefined&&(typeof p.role!=='string'||!p.role||p.role.length>30))errors.push('成员关系无效');if(!p||!safe(p.id)||ids.has(p.id)||typeof p.name!=='string'||p.name.length>60||!Number.isInteger(p.age)||p.age<3||p.age>95||!['male','female'].includes(p.sex)||p.ageGroup!==group(p.age)||p.profile!==group(p.age)+'-'+p.sex||!families.has(p.householdId)||membership.get(p.id)!==p.householdId||!Object.hasOwn(JOBS,p.job)||group(p.age)==='child'&&p.job!=='student'||group(p.age)==='senior'&&p.job!=='retired'||group(p.age)==='adult'&&!['farm','service','external','flex'].includes(p.job)||!['preschool','primary','secondary'].includes(p.schoolStage)||p.age<6&&(p.schoolStage!=='preschool'||!p.needsEscort)||!Number.isFinite(p.mobility)||p.mobility<.4||p.mobility>1.2||typeof p.needsEscort!=='boolean'||typeof p.social!=='boolean'||typeof p.lightWork!=='boolean')errors.push('人物画像、家庭引用或职业无效');if(p)ids.add(p.id);}
  if(membership.size!==scene.people.length||[...membership.keys()].some(id=>!ids.has(id)))errors.push('家庭成员与人物列表不一致');return errors;
 }
 return {PROFILES,JOBS,group,generate,describeHousehold,validate};
});
