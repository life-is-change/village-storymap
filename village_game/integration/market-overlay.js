(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageMarketOverlay=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const STATES={home:'家中',arriving:'前往摊位',preparing:'准备营业',open:'营业中',entering:'进场',queueing:'前往队列',queued:'排队',approaching:'走到摊前',conversing:'交流中',leaving:'返家途中','waiting-opening':'等待开市',blocked:'道路不通',unfinished:'窗口结束'};
 const PHASES={preparing:'摊主进场 · 准备早市',open:'早市营业',closing:'陆续收摊',finished:'本次早市结束'};
 function bubbles(snapshot,limit=2){return new Set(snapshot.agents.filter(a=>a.marketState==='conversing'&&a.dialogue?.speakerId===a.id).sort((a,b)=>a.dialogue.transactionId.localeCompare(b.dialogue.transactionId)).slice(0,limit).map(a=>a.id));}
 function label(a,snapshot,speakers=bubbles(snapshot)){
  if(speakers.has(a.id)&&a.dialogue&&a.marketState==='conversing'&&a.dialogue.speakerId===a.id)return a.name+'：'+a.dialogue.text;
  return (a.marketRole==='vendor'?'摊主 · ':'买菜村民 · ')+(STATES[a.marketState]||a.marketState||'')+(a.purchaseStatus==='purchased'?' · ✓ 已购买':'');
 }
 function create({Cesium:C,viewer,entities}){
  let status=null,plan=null,disposed=false,followed=null,previousTracked;
  function cancelFollow(){if(followed&&viewer.trackedEntity===followed)viewer.trackedEntity=previousTracked;followed=null;previousTracked=undefined;}
  function clear(){cancelFollow();if(status)entities.remove(status);status=null;plan=null;}
  function setPlan(next){clear();if(disposed||!next.scene.morningMarket)return;plan=next;const gate=next.projection.toDegrees(next.scene.morningMarket.layout.gate);status=entities.add({position:C.Cartesian3.fromDegrees(...gate),label:{text:'村庄早市 · 准备进场',show:true,font:'bold 13px sans-serif',fillColor:C.Color.fromCssColorString('#314b42'),backgroundColor:C.Color.fromCssColorString('#fff8e5'),showBackground:true,pixelOffset:new C.Cartesian2(0,-65),heightReference:C.HeightReference.CLAMP_TO_GROUND,disableDepthTestDistance:Infinity}});status.simulationMarket=true;}
  return {setPlan,clear,cancelFollow,
   render(snapshot){if(status&&snapshot.market)status.label.text=(PHASES[snapshot.market.phase]||'村庄早市')+' · 已购 '+snapshot.market.purchases+' 人';},
   focus(){if(!plan)return false;const m=plan.scene.morningMarket,centers=m.layout.stalls?.map(s=>s.center)||[],center=centers.length?centers.reduce((p,q)=>p.map((v,i)=>v+q[i]/centers.length),[0,0]):m.layout.gate,gate=plan.projection.toDegrees(center);cancelFollow();
    if(C.BoundingSphere&&C.HeadingPitchRange&&viewer.camera.flyToBoundingSphere)viewer.camera.flyToBoundingSphere(new C.BoundingSphere(C.Cartesian3.fromDegrees(...gate,1.5),12),{offset:new C.HeadingPitchRange(0,-.25,24),duration:.8});
    else viewer.camera.flyTo({destination:C.Cartesian3.fromDegrees(...gate,45),duration:.8});return true;},
   follow(entity){if(!entity||disposed)return false;if(!followed)previousTracked=viewer.trackedEntity;followed=entity;viewer.trackedEntity=entity;return true;},
   dispose(){if(disposed)return;clear();disposed=true;}
  };
 }
 return {STATES,PHASES,bubbles,label,create};
});
