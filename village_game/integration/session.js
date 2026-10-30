(function(root,factory){const c=typeof module==='object'&&module.exports,api=factory(c?require('./plan-adapter'):root.VillagePlanAdapter,c?require('../domain/simulation'):root.VillageSimulation,c?require('../views/observation'):root.VillageObservation);if(c)module.exports=api;if(root)root.VillagePlanSession=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Adapter,Simulation,Observation){
 'use strict';const clone=v=>JSON.parse(JSON.stringify(v));
 function summarize(result){return {arrivals:result.arrivals,averageWalkMinutes:result.averageWalkMinutes,resident:result.resident,visitor:result.visitor,failures:result.failures,housingShortage:result.housingShortage,satisfaction:result.satisfaction.average,encounters:result.encounters};}
 function create(options){
  const initial=options.readDocument(),scope=[initial.projectId,initial.villageId,initial.baselineRef.spaceId].join('|');
  let config=Adapter.reconcileConfig(initial.metadata?.simulation||Adapter.createConfig(initial,options.readContext()),Adapter.catalog(initial,options.readContext())),compiled=null,sim=null,snapshot=null,previous=null,disposed=false,playing=false,finishing=false,serial=0,runIdentity=null,phase='idle';
  function current(){if(disposed)throw Error('模拟已退出');const d=options.readDocument();if([d.projectId,d.villageId,d.baselineRef.spaceId].join('|')!==scope)throw Error('方案空间已切换，请重新打开模拟');return d;}
  function state(){return {config:clone(config),snapshot,playing,finishing,compiled,phase,done:!!snapshot?.done};}
  function emit(){options.onState?.(state());}
  function stop(){serial++;playing=false;finishing=false;sim=null;snapshot=null;previous=null;runIdentity=null;if(options.overlay?.clear)options.overlay.clear();else options.overlay?.clearActors?.();}
  function update(next){current();const valid=Adapter.validateConfig(next);if(!valid.ok)return valid;stop();config=clone(next);options.writeConfig(clone(config));emit();return {ok:true};}
  async function save(){current();const valid=Adapter.validateConfig(config);if(!valid.ok)return valid;options.writeConfig(clone(config));phase='saving';emit();let timer;
   try{const r=await Promise.race([Promise.resolve().then(()=>options.save()),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,code:'SAVE_TIMEOUT',errors:['保存等待超时，模拟尚未启动；草稿保留。请核对网络与方案版本后重试，勿重复点击。']}),options.saveTimeoutMs||25000);})]);current();return r;}
   finally{clearTimeout(timer);phase='idle';emit();}
  }
  function check(){compiled=Adapter.compile(current(),options.readContext(),config);return compiled;}
  async function start(){
   stop();const generation=serial;const valid=check();if(!valid.ok)return valid;
   const saved=await save();if(disposed||generation!==serial)return {ok:false,code:'CANCELLED'};if(!saved.ok)return {...saved,errors:saved.errors||['方案未保存成功，模拟尚未启动。请处理网络、服务器超时或版本冲突后重试（'+(saved.code||'SAVE_FAILED')+'）']};
   compiled=Adapter.compile(current(),options.readContext(),config);if(!compiled.ok)return compiled;
   const frozen=clone(compiled.payload),comparison={settings:clone(config.settings),villageId:frozen.source.villageId,baseline:current().baselineRef,area:config.area||null,rule:Adapter.RULE_VERSION};
   phase='preparing';emit();const [inputDigest,comparisonDigest]=await Promise.all([Adapter.digest(frozen),Adapter.digest(comparison)]);phase='idle';
   if(disposed||generation!==serial)return {ok:false,code:'CANCELLED'};
   runIdentity={inputDigest,comparisonDigest,source:clone(compiled.scene.source),revision:compiled.scene.revision,settings:clone(config.settings)};
   sim=Simulation.createSimulation(compiled.scene);snapshot=sim.snapshot();options.overlay?.setPlan?.(compiled);playing=true;emit();return {ok:true,warnings:compiled.warnings};
  }
  function tick(minutes){current();if(!playing||finishing||!sim)return;const before=snapshot;sim.step(minutes);snapshot=sim.snapshot();if(before.minute!==snapshot.minute||before.day!==snapshot.day)previous=before;if(snapshot.done)playing=false;}
  function paint(){if(snapshot)options.overlay?.render?.(Observation.layout(compiled.scene,Observation.interpolate(previous,snapshot,snapshot.progress)),compiled);}
  async function finish(){
   current();if(!sim)return {ok:false,errors:['请先保存并开始模拟']};if(finishing)return {ok:false,code:'BUSY'};
   const generation=serial;finishing=true;playing=false;emit();
   try{while(!snapshot.done){if(disposed||generation!==serial)return {ok:false,code:'CANCELLED'};sim.step(30);snapshot=sim.snapshot();paint();emit();await new Promise(resolve=>setTimeout(resolve,0));}
    current();const result=summarize(sim.result()),record={...runIdentity,completedAt:new Date().toISOString(),result};
    config.runs=[record,...config.runs.filter(r=>r.inputDigest!==record.inputDigest)].slice(0,5);options.writeConfig(clone(config));const saved=await save();if(disposed||generation!==serial)return {ok:false,code:'CANCELLED'};current();return {...saved,record};
   }finally{if(!disposed&&generation===serial){finishing=false;emit();}}
  }
  return {state,update,save,check,start,tick,paint,finish,pause(){playing=false;emit();},resume(){current();if(sim&&!snapshot.done&&!finishing)playing=true;emit();},dispose(){if(disposed)return;stop();disposed=true;options.overlay?.dispose?.();},compatible(a,b){return a?.comparisonDigest===b?.comparisonDigest&&typeof a?.comparisonDigest==='string';}};
 }
 return {create,summarize};
});
