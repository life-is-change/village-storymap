(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./scene'):root.VillageScene,typeof module==='object'&&module.exports?require('./network'):root.VillageNetwork,typeof module==='object'&&module.exports?require('./life'):root.VillageLife);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageSimulation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Scene,Network,Life){
  'use strict';
  const REASONS={missing:'没有匹配设施',unreachable:'道路或入口不连通',closed:'设施未开放',capacity:'接待容量不足',time:'活动日结束前未完成'};
  const STATES={planned:'尚未出发',moving:'步行途中',serving:'正在活动',waiting:'等候服务',idle:'等待下一项活动',staying:'过夜休息',home:'已回家',departed:'已离村',blocked:'返程道路不通'};
  function createSimulation(input){if(input?.schemaVersion===2)return Life.createSimulation(input);
    const valid=Scene.validate(input);if(!valid.ok)throw new Error(valid.errors[0]);
    const scene=Scene.clone(input),network=Network.buildNetwork(scene),facilities={};
    for(const b of scene.buildings)facilities[b.id]={id:b.id,name:b.name,type:b.type,capacity:Scene.capacity(b),occupancy:0,peak:0,served:0,failed:0,queued:0};
    const metrics={resident:{total:0,completed:0},visitor:{total:0,completed:0},failures:{missing:0,unreachable:0,closed:0,capacity:0,time:0},walkMinutes:0,walkTrips:0,housingShortage:0};
    const events=[],cache=new Map();let seed=scene.scenario.seed>>>0,day=1,minute=scene.scenario.startMinute,done=false,carry=0,agents=[];
    function random(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
    function log(text,kind='info'){events.unshift({day,minute,text,kind});if(events.length>35)events.length=35;}
    function path(a,b){const key=a+'|'+b;if(!cache.has(key))cache.set(key,Network.route(network,network.access[a],network.access[b]));return cache.get(key);}
    function createAgent(kind,home,index,start,needs){const position=home?Scene.entrance(home):scene.scenario.entry;return {id:kind+'-'+day+'-'+index,name:kind==='resident'?'村民 '+(index+1):'游客 '+(index+1),kind,home:home?.id||'entry',node:home?.id||'entry',x:position[0],y:position[1],state:'planned',start,needs,needIndex:0,need:needs[0],target:null,route:null,pathIndex:1,remaining:0,waitSince:0,retryAt:0,returning:false,completed:0,failed:0};}
    function startDay(){agents=[];const homes=scene.buildings.filter(b=>b.type==='home'),slots=[];for(const b of homes)for(let i=0;i<Math.min(b.residents,Scene.capacity(b));i++)slots.push(b);for(const b of homes)for(let i=Math.min(b.residents,Scene.capacity(b));i<Scene.capacity(b);i++)slots.push(b);
      let index=0;for(;index<scene.scenario.population;index++){const home=slots[index]||null;agents.push(createAgent('resident',home,index,420+index*2,['work','shop','rest','food']));metrics.resident.total++;if(home)metrics.resident.completed++;else{metrics.failures.missing++;metrics.housingShortage++;}}
      for(let i=0;i<scene.scenario.visitorsPerDay;i++){const needs=['info','view'];if(i%3===0)needs.push('craft');needs.push('food','rest');if(i%4===0)needs.push('stay');agents.push(createAgent('visitor',null,i,480+i*14+Math.floor(random()*9),needs));}
      for(const a of agents)metrics[a.kind].total+=a.needs.length;
      log('第 '+day+' 天开始：'+index+' 位居民，'+scene.scenario.visitorsPerDay+' 位游客陆续到访。');
    }
    function release(a){if(a.target&&facilities[a.target]&&['serving','staying'].includes(a.state))facilities[a.target].occupancy=Math.max(0,facilities[a.target].occupancy-1);}
    function fail(a,reason){metrics.failures[reason]++;a.failed++;if(a.target&&facilities[a.target])facilities[a.target].failed++;a.needIndex++;a.target=null;a.route=null;a.need=a.needs[a.needIndex]||null;a.state='idle';a.retryAt=minute+5;}
    function succeed(a){metrics[a.kind].completed++;a.completed++;const f=facilities[a.target];f.served++;a.needIndex++;a.need=a.needs[a.needIndex]||null;if(a.state==='staying')return;release(a);a.state='idle';a.target=null;a.route=null;a.retryAt=minute+10;}
    const matches=(b,need)=>Scene.TYPES[b.type].need===need||(need==='work'&&b.type==='workshop');
    function choose(a){
      if(a.needIndex>=a.needs.length){const destination=a.kind==='resident'?a.home:'entry';const p=path(a.node,destination);if(!p){a.state='blocked';return;}a.returning=true;a.target=destination;a.route=p.points;a.pathIndex=1;a.state='moving';return;}
      a.need=a.needs[a.needIndex];if(a.need==='stay'&&minute<1020){a.state='idle';a.retryAt=1020;return;}
      const candidates=scene.buildings.filter(b=>matches(b,a.need));if(!candidates.length){fail(a,'missing');return;}
      const reachable=candidates.map(b=>({b,p:path(a.node,b.id)})).filter(c=>c.p);if(!reachable.length){fail(a,'unreachable');return;}
      const open=reachable.filter(({b})=>minute>=b.open*60&&minute<b.close*60);if(!open.length){fail(a,'closed');return;}
      open.sort((a,b)=>a.p.distance+facilities[a.b.id].occupancy*25-(b.p.distance+facilities[b.b.id].occupancy*25));
      const selected=open[0];a.target=selected.b.id;a.route=selected.p.points;a.pathIndex=1;a.state='moving';a.waitSince=0;
    }
    function arrive(a){a.node=a.target;if(a.returning){a.state=a.kind==='resident'?'home':'departed';a.target=null;a.route=null;return;}
      const b=scene.buildings.find(b=>b.id===a.target),f=facilities[a.target];
      if(minute<b.open*60||minute>=b.close*60){fail(a,'closed');return;}
      if(f.occupancy>=f.capacity){a.state='waiting';a.waitSince=minute;f.queued++;return;}
      f.occupancy++;f.peak=Math.max(f.peak,f.occupancy);a.state=a.need==='stay'?'staying':'serving';a.remaining=Scene.TYPES[b.type].minutes;
      if(a.need==='work')a.remaining=100;
      if(a.state==='staying')succeed(a);
    }
    function walk(a){let budget=55;metrics.walkMinutes++;while(a.pathIndex<a.route.length){const next=a.route[a.pathIndex],d=Math.hypot(next[0]-a.x,next[1]-a.y);if(d>budget){a.x+=(next[0]-a.x)*budget/d;a.y+=(next[1]-a.y)*budget/d;return;}a.x=next[0];a.y=next[1];budget-=d;a.pathIndex++;}
      metrics.walkTrips++;arrive(a);
    }
    function tick(){
      for(const a of agents){
        if(a.state==='planned'){if(minute>=a.start){a.state='idle';choose(a);}continue;}
        if(a.state==='idle'){if(minute>=a.retryAt)choose(a);continue;}
        if(a.state==='moving'){walk(a);continue;}
        if(a.state==='serving'){a.remaining--;if(a.remaining<=0)succeed(a);continue;}
        if(a.state==='waiting'){
          const b=scene.buildings.find(b=>b.id===a.target),f=facilities[a.target];
          if(minute>=b.close*60){fail(a,'closed');continue;}
          if(f.occupancy<f.capacity){arrive(a);continue;}
          if(minute-a.waitSince>=25){
            const alternatives=scene.buildings.filter(b=>b.id!==a.target&&matches(b,a.need)&&minute>=b.open*60&&minute<b.close*60&&facilities[b.id].occupancy<facilities[b.id].capacity).map(b=>({b,p:path(a.node,b.id)})).filter(c=>c.p).sort((x,y)=>x.p.distance-y.p.distance);
            if(alternatives.length){const next=alternatives[0];a.target=next.b.id;a.route=next.p.points;a.pathIndex=1;a.state='moving';log(a.name+'改去'+next.b.name+'，避开满员设施。');}
            else fail(a,'capacity');continue;
          }
        }
      }
      minute++;
      if(minute>=scene.scenario.endMinute){
        for(const a of agents){if(a.state==='serving')release(a);while(a.needIndex<a.needs.length)fail(a,'time');if(!['staying','home','departed'].includes(a.state))a.state='idle';}
        log('第 '+day+' 天结束，已完成 '+(metrics.resident.completed+metrics.visitor.completed)+' 项服务。','day');
        if(day>=scene.scenario.days){done=true;log('运营周期完成，查看服务、步行与容量结果。','success');}
        else {day++;minute=scene.scenario.startMinute;for(const f of Object.values(facilities))f.occupancy=0;startDay();}
      }
    }
    startDay();
    function step(minutes=1){if(!Number.isFinite(minutes)||minutes<0)throw new Error('推进时间无效');carry+=Math.min(minutes,scene.scenario.days*840);while(carry>=1&&!done){tick();carry-=1;}return done;}
    function runToEnd(){while(!done)tick();return result();}
    function result(){return {ruleVersion:1,revision:scene.revision,seed:scene.scenario.seed,days:scene.scenario.days,done,resident:{...metrics.resident},visitor:{...metrics.visitor},failures:{...metrics.failures},housingShortage:metrics.housingShortage,walkMinutes:metrics.walkMinutes,walkTrips:metrics.walkTrips,averageWalkMinutes:metrics.walkTrips?Math.round(metrics.walkMinutes/metrics.walkTrips*10)/10:0,facilities:Scene.clone(facilities)};}
    function snapshot(){return {day,minute,progress:carry,done,agents:agents.map(a=>({...a,route:a.route?.map(p=>[...p]),needs:undefined})),facilities:Scene.clone(facilities),metrics:result(),events:[...events]};}
    return {step,runToEnd,snapshot,result,network};
  }
  return {createSimulation,BEHAVIOR_VERSION:Life.BEHAVIOR_VERSION,REASONS:{...REASONS,...Life.REASONS},STATES:{...STATES,...Life.STATES}};
});
