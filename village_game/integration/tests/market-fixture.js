const {fixture,polygon}=require('./fixtures'),P=require('../../../3D_scenes_edit/domain/market-preset'),G=require('../../../3D_scenes_edit/domain/geometry-rules'),A=require('../plan-adapter');
function marketFixture(){const f=fixture();const center=[113.00065,23.00025],field={id:'square',kind:'surface',category:'activity-field',geometry:{type:'Polygon',coordinates:[[[-10,-8],[10,-8],[10,8],[-10,8],[-10,-8]].map(p=>G.fromLocalMeters(p,center))]},properties:{displayName:'教学早市'},layerId:'design',groupId:null,zIndex:0};
 const preset=P.createMarketPreset({field,idPrefix:'test-market'});if(!preset.ok)throw Error(preset.errors.join());f.document.objects=preset.command.objects;
 f.context.baselineFeatures.push({id:'house2',layerKey:'building',geometry:polygon(113.0002,23.0001),properties:{name:'第二住宅'}});
 f.cfg.assignments=[{...A.assignment('baseline:house','home'),capacity:9},{...A.assignment('baseline:house2','home'),capacity:9},{...A.assignment('object:square','market'),staff:0,capacity:18,open:6,close:10}];
 f.cfg.settings.population=18;f.cfg.settings.visitorsPerDay=0;f.cfg.morningMarket={marketKey:'object:square',vendorCount:6,customerCount:12,startMinute:360,openMinute:390,lastEntryMinute:570,endMinute:600};return f;}
module.exports={marketFixture};
