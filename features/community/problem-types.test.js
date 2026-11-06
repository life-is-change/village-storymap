const test=require('node:test'),assert=require('node:assert/strict');
const Types=require('./problem-types');
test('problem choices are exactly the requested five labels plus other',()=>{
 assert.deepEqual(Object.values(Types.types).map(x=>x.label),['垃圾堆积','道路破损','房屋破败','路面积水','安全隐患','其他']);
});
test('other requires a trimmed type independent of the description and survives stored-category roundtrip',()=>{
 assert.throws(()=>Types.categoryFor('other','   '),/PROBLEM_TYPE_REQUIRED/);
 assert.throws(()=>Types.categoryFor('other','字'.repeat(41)),/PROBLEM_TYPE_TOO_LONG/);
 const stored=Types.categoryFor('other','  噪声扰民  ');
 assert.equal(stored,'other:噪声扰民');assert.equal(Types.meta(stored).label,'噪声扰民');
 assert.equal(Types.filterKey(stored),'other');assert.equal(Types.categoryFor('road_damage','噪声扰民'),'road_damage');
});
test('historic public-space records keep their meaning and fall under other rather than housing damage',()=>{
 assert.equal(Types.meta('public_space_need').label,'公共空间需求');
 assert.equal(Types.filterKey('public_space_need'),'other');assert.equal(Types.filterKey('unknown-old-type'),'other');
 assert.equal(Types.meta('garbage').label,'垃圾堆积');assert.equal(Types.meta('drainage_issue').label,'路面积水');
});
test('legacy filters acquire new categories while new saved filters retain deliberate exclusions',()=>{
 assert.deepEqual(Types.restoreFilters(['garbage','public_space_need'],1),['garbage','other','housing_disrepair']);
 assert.deepEqual(Types.restoreFilters(['road_damage'],2),['road_damage']);
});
test('custom category travels through the community client and the deployed API contract unchanged',async()=>{
 const client=require('../../community-tasks'),{parseOperation}=await import('../../business-api/unified/contracts.mjs');let saved;
 const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'personal-space'};
 const category=Types.categoryFor('other','噪声扰民');
 const deps={getContext:()=>context,uuid:()=>context.teachingProjectId,services:{community:{execute:async(action,input)=>{saved=parseOperation(action,input).input;return {id:1,category:saved.category,description:saved.body};}}}};
 const row=await client.createCommunityTask(deps,{category,description:'夜间施工噪声',lng:113,lat:23});
 assert.equal(saved.category,category);assert.equal(row.description,'夜间施工噪声');assert.equal(Types.meta(row.category).label,'噪声扰民');
});
