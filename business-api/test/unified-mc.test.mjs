import test from 'node:test';import assert from 'node:assert/strict';
let module;try{module=await import('../unified/mc.mjs');}catch{module={};}
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'s',requestId:'c0000000-0000-4000-8000-000000000001'};
test('MC export reads current local geometry in same identity transaction and persists fixed format',async()=>{
 const queries=[],config={min_lon:0,max_lon:1,min_lat:0,max_lat:1,mc_origin_x:0,mc_origin_y:64,mc_origin_z:0,mc_width:10,mc_depth:10};
 const database={withIdentity:async(_i,fn)=>fn({query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes('mc_context'))return {rows:[{data:{config,features:[{object_code:'B',geom:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},props:{}}]}}]};return {rows:[{data:{count:1}}]};}})};
 assert.equal(typeof module.createMcService,'function');const service=module.createMcService({database});assert.deepEqual(await service.exportBuildings({id:'u'},context),{count:1});
 const payload=JSON.parse(queries[1][1][1]);assert.equal(payload[0].source,'web');assert.equal(payload[0].block_type,'minecraft:white_concrete');assert.equal(payload[0].footprint_blocks.length>0,true);
 await assert.rejects(service.exportBuildings({}, {...context,destination:'http://evil'}),{code:'INVALID_INPUT'});
});
test('MC rasterization refuses unbounded geometry before iterating cells',()=>{
 assert.equal(typeof module.buildMcPayload,'function');assert.throws(()=>module.buildMcPayload(context,{min_lon:0,max_lon:1,min_lat:0,max_lat:1,mc_origin_x:0,mc_origin_y:64,mc_origin_z:0,mc_width:100000,mc_depth:100000},[{object_code:'B',geom:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},props:{}}]),{code:'PAYLOAD_TOO_LARGE'});
});
