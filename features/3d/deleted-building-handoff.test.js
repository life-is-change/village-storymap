const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolveEffectiveBuildingFeatureCollection}=require('../data/effective-building-features.js');
test('3D requests deletion tombstones so a deleted baseline building and its model are not resurrected',async()=>{
 const source=fs.readFileSync('app-3d.js','utf8');const start=source.indexOf('  async function list3DBuildingsFromDb('),end=source.indexOf('  async function list3DPersonalBuildings(',start);
 const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
 const rows=[{object_code:'52',is_deleted:true,geom:geometry},{object_code:'B-N-new',is_deleted:false,geom:geometry}];
 const ctx={window:{VillageBusinessServices:{planning:{async execute(action,input){assert.equal(action,'planning.listFeatures');return input.includeDeleted?rows:rows.filter(row=>!row.is_deleted);}}}},getActiveVillage3DContext:()=>({teachingProjectId:'project',villageId:'village'}),getActualLinkedSpaceIdFor3D:()=> 'space'};
 vm.runInNewContext(source.slice(start,end)+';this.read=list3DBuildingsFromDb;',ctx);
 const dbRows=await ctx.read();
 const effective=resolveEffectiveBuildingFeatureCollection({baseFeatures:[{type:'Feature',properties:{code:'52'},geometry}],dbRows});
 assert.deepEqual(effective.features.map(row=>row.properties.code),['B-N-new']);
});
