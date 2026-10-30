const A=require('../plan-adapter');
const polygon=(x,y,w=.00015,h=.00012)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
function fixture(){
 const document={projectId:'project-one',villageId:'village-one',revision:2,baselineRef:{spaceId:'group-one',revision:3},objects:[{id:'square',kind:'surface',category:'paving',geometry:polygon(113.0005,23.0001,.0003,.0003),properties:{displayName:'广场'}},{id:'bench',kind:'asset',category:'bench',geometry:{type:'Point',coordinates:[113.00055,23.0002]},properties:{displayName:'长椅'}}],metadata:{}};
 const context={villageId:'village-one',baselineFeatures:[{id:'house',layerKey:'building',geometry:polygon(113,23.0001),properties:{name:'现有建筑'}},{id:'road',layerKey:'road',geometry:{type:'LineString',coordinates:[[112.9999,23],[113.001,23]]},properties:{}}]};
 const cfg=A.createConfig(document,context);cfg.settings.population=3;cfg.settings.visitorsPerDay=6;cfg.entry=[112.9999,23];cfg.assignments=[A.assignment('baseline:house','home'),{...A.assignment('object:square','park'),components:['object:bench']}];
 return {document,context,cfg};
}
module.exports={fixture,polygon};
