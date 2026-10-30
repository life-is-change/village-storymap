(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./scene'):root.VillageScene,typeof module==='object'&&module.exports?require('./network'):root.VillageNetwork,typeof module==='object'&&module.exports?require('./schedule'):root.VillageSchedule,typeof module==='object'&&module.exports?require('./places'):root.VillagePlaces,typeof module==='object'&&module.exports?require('./growth'):root.VillageGrowth);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageDecision=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Network,Schedule,Places,Growth){
 'use strict';
 const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,n));
 function random(seed,day,key){let n=(seed^Math.imul(day,2654435761))>>>0;for(const c of String(key))n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
 function initialState(a){return {hunger:a.kind==='visitor'?25:15,fatigue:a.ageGroup==='senior'?20:8,social:a.social?40:25};}
 function update(s,activity,minutes){s.hunger=clamp(s.hunger+minutes*.065);s.fatigue=clamp(s.fatigue+minutes*(activity==='moving'?.45:activity==='work'?.10:.015));s.social=clamp(s.social+minutes*.025);if(['food','breakfast','lunch','dinner'].includes(activity))s.hunger=clamp(s.hunger-80);if(['rest','pause','sleep','home'].includes(activity))s.fatigue=clamp(s.fatigue-45);if(activity==='social')s.social=clamp(s.social-50);return s;}
 function quality(b){const gain=(b.level||1)-1,q={comfort:0,culture:0,family:0,service:0};if(Object.hasOwn(q,b.upgrade))q[b.upgrade]=gain;return q;}
 function score(a,b,need,minute,walk,load){const s=a.needsState||initialState(a),q=quality(b),attr=b.attraction??50;let value=(attr-50)*.10-walk*.18-load*2+q.service*.6+q.culture*(a.kind==='visitor'?.7:.3)+q.comfort*.4;
  if(need==='food')value+=s.hunger*.095-4+(minute>=690&&minute<840||minute>=1080&&minute<1230?2:-4);
  else if(need==='rest')value+=s.fatigue*.085-2+q.comfort*1.4;
  else if(need==='social')value+=s.social*.07-1+q.comfort*.8+q.culture*.8;
  else if(need==='play')value+=(a.profile==='family'||a.ageGroup==='child'?3:-2)+q.family*1.5;
  else if(need==='view'||need==='craft')value+=(a.kind==='visitor'?2:0)+q.culture*1.3;
  else if(need==='stay')value+=q.comfort*1.4;
  else value+=.5;
  if(a.profile==='family')value+=q.family*1.2;if(a.ageGroup==='senior')value+=q.comfort*.8-(b.type==='night'?5:0);
  const memory=a.memory?.[b.id];if(memory)value+=(memory.experience-50)*.025-Math.min(5,memory.visits)*1.4;
  if(a.lastActivity===need)value-=2.5;return value;
 }
 function probabilities(options){if(!options.length)return [];const max=Math.max(...options.map(o=>o.score)),weights=options.map(o=>Math.exp((o.score-max)/2.2)),total=weights.reduce((a,b)=>a+b,0);return options.map((o,i)=>({...o,probability:weights[i]/total}));}
 function choose(options,rng){const list=probabilities(options),draw=rng();let cumulative=0;for(const o of list){cumulative+=o.probability;if(draw<cumulative)return o;}return list.at(-1)||null;}
 const interests={day:{attraction:3,ancestral:2,culture:1,workshop:1.5,park:1,food:1,center:.5,shop:.3},family:{play:3,park:2,workshop:1.5,farm:1,food:1,attraction:1,center:.5},overnight:{inn:4,attraction:2,ancestral:1,park:1,food:1.5,night:1,culture:1}};
 function attractiveness(scene,network=Network.buildNetwork(scene),staff=Schedule.bind(scene,network).staff,day=1){const bindings=Schedule.bind(scene,network),plans=Schedule.residentDay(scene,bindings,day).plans,offset=(day-1)*1440;
  const readyStaff={};const operates=b=>{const open=Math.max(360,b.open*60),close=Math.min(1440,b.close*60);if(close<=open)return false;if(!Schedule.STAFFED.has(b.type))return true;readyStaff[b.id]=(staff[b.id]||[]).filter(id=>{const person=scene.people.find(p=>p.id===id),home=person&&bindings.homes[person.householdId];return home&&Network.route(network,network.access[home],network.access[b.id])&&plans[id]?.some(t=>{if(t.mode!=='work'||t.target!==b.id)return false;const at=scene.scenario.living?Places.shiftArrival(person,Network.route(network,network.access[home],network.access[b.id]),t,offset):t.start-offset;return at!==null&&Math.min(close,(t.until||t.deadline)-offset)>Math.max(open,at);});});return readyStaff[b.id].length>0;};
  const supplied=scene.buildings.filter(b=>network.connected[b.id]&&operates(b));const values={},combos=[];
  for(const b of supplied){if(!['ancestral','play','inn'].includes(b.type))continue;const partner=supplied.find(p=>p.id!==b.id&&({ancestral:['park','culture'],play:['park','food'],inn:['attraction','park','food']})[b.type].includes(p.type)&&Network.route(network,network.access[b.id],network.access[p.id])?.distance<=150);if(partner)combos.push({from:b.id,to:partner.id,label:b.type==='ancestral'?'文化参访与休憩':b.type==='play'?'亲子停留配套':'住宿与步行体验'});}
  if(scene.scenario.living){combos.splice(0,combos.length,...Places.analyze(scene,network,day).combinations);}
  for(const [profile,weights] of Object.entries(interests)){let sum=0,total=0;for(const [type,weight] of Object.entries(weights)){total+=weight;const supply=supplied.filter(b=>b.type===type).reduce((v,b)=>{const q=quality(b),appeal=clamp((b.attraction??50)+(scene.scenario.living?Growth.bonus(scene.growth,b.id):0))/50,fit=profile==='family'?q.family:profile==='day'?q.culture:q.comfort;const operated=Schedule.STAFFED.has(type)?Math.min(Scene.capacity(b),(readyStaff[b.id]?.length||0)*(Scene.TYPES[type].perStaff||({inn:10,food:8,workshop:6,shop:12,center:10,night:20})[type]||12)):Scene.capacity(b);return v+appeal*(1+.20*fit+.08*q.service)*Math.sqrt(operated/12);},0);sum+=weight*(1-Math.exp(-supply/1.5));}let value=total?sum/total*100:0;value+=scene.scenario.living?Math.min(3,combos.filter(c=>c.active&&c.profiles.includes(profile)).length):Math.min(5,combos.length);if(profile==='overnight'&&!supplied.some(b=>b.type==='inn'))value=0;values[profile]=Math.round(clamp(value)*10)/10;}
  return {...values,overall:Math.round((values.day+values.family+values.overnight)/3*10)/10,combos};
 }
 function market(scene,day,reputation,rng=random(scene.scenario.seed,day,'market')){const s=scene.scenario,network=Network.buildNetwork(scene),appeal=attractiveness(scene,network,Schedule.bind(scene,network).staff,day),potential=s.visitorsPerDay,fixed=s.visitorMode!=='attraction',profiles=['day','family','overnight'];let actual=0;const byProfile={};
  for(let i=0;i<potential;i++){const split=(i+.5)/Math.max(1,potential)*100,index=split<s.visitorMix[0]?0:split<s.visitorMix[0]+s.visitorMix[1]?1:2,profile=profiles[index],p=appeal[profile]===0?0:1/(1+Math.exp(-(appeal[profile]+(reputation-50)*.35-45)/14));if(fixed||rng()<p){actual++;byProfile[profile]=(byProfile[profile]||0)+1;}}
  const mix=actual?[Math.round((byProfile.day||0)/actual*100),Math.round((byProfile.family||0)/actual*100)]:[100,0];mix.push(100-mix[0]-mix[1]);return {day,mode:fixed?'fixed':'attraction',potential,actual,byProfile,mix,appeal,reputation:Math.round(reputation*10)/10};
 }
 function experience(b,wait,walk,failed){const q=quality(b);return clamp(failed?30:75+(q.comfort+q.culture+q.family+q.service)*4-Math.min(40,wait)-Math.min(20,walk));}
 return {initialState,update,quality,score,probabilities,choose,random,attractiveness,market,clamp,experience};
});
