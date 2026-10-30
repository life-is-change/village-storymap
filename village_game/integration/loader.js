(function(root){
 'use strict';let pending;
 const files=[['VillagePopulation','domain/population.js'],['VillageGrowth','domain/growth.js'],['VillageScene','domain/scene.js'],['VillageNetwork','domain/network.js'],['VillageSchedule','domain/schedule.js'],['VillagePlaces','domain/places.js'],['VillageDecision','domain/decision.js'],['VillageStories','domain/stories.js'],['VillageLife','domain/life.js'],['VillageSimulation','domain/simulation.js'],['VillageObservation','views/observation.js'],['VillageCharacters','views/characters.js'],['VillageCatalog','views/catalog.js'],['VillageExperimentArea','integration/experiment-area.js'],['VillagePlanAdapter','integration/plan-adapter.js'],['VillagePlanSession','integration/session.js'],['VillagePlanOverlay','integration/overlay.js'],['VillageSimulationWorkspace','integration/workspace.js']];
 root.loadVillageSimulation=()=>pending||(pending=(async()=>{
  if(!document.querySelector('link[data-village-simulation]')){const css=document.createElement('link');css.rel='stylesheet';css.href='village_game/integration/workspace.css?v=20261030-layout';css.dataset.villageSimulation='1';document.head.appendChild(css);}
  for(const [name,file] of files)if(!root[name])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='village_game/'+file+'?v=20261030-roads3';script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('模拟组件加载失败，请刷新重试'));};document.head.appendChild(script);});
  return root.VillageSimulationWorkspace;
 })().catch(e=>{pending=null;throw e;}));
})(globalThis);
