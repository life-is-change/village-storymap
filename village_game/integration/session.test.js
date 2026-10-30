const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./tests/fixtures'),Session=require('./session');

test('a stalled save reports timeout, leaves no running snapshot and ignores its late completion',async()=>{
 const f=fixture();f.document.metadata.simulation=f.cfg;let resolveSave;
 const session=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig(){},saveTimeoutMs:15,save:()=>new Promise(resolve=>{resolveSave=resolve;})});
 const pending=session.start();assert.equal(session.state().phase,'saving');const r=await pending;
 assert.equal(r.ok,false);assert.match(r.errors.join(' '),/超时/);assert.equal(session.state().playing,false);
 resolveSave({ok:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(session.state().snapshot,null);session.dispose();
});
test('result saving uses the same bounded save and releases finishing on a stalled request',async()=>{
 const f=fixture();f.cfg.settings.days=1;f.document.metadata.simulation=f.cfg;let saves=0;
 const session=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig(){},saveTimeoutMs:10,save:()=>++saves===1?Promise.resolve({ok:true}):new Promise(()=>{})});
 assert.equal((await session.start()).ok,true);session.tick(1080);const r=await session.finish();assert.equal(r.ok,false);assert.equal(session.state().finishing,false);assert.equal(session.state().phase,'idle');session.dispose();
});
test('opening a pre-namespace saved plan restores references in memory without writing until the user saves',()=>{
 const f=fixture();f.document.metadata.simulation=f.cfg;let writes=0;
 f.context.baselineFeatures.forEach(x=>{x.legacyId=x.id;x.id=x.layerKey+':'+x.id;});
 const session=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig:()=>writes++,save:async()=>({ok:true})});
 const c=session.state().config;
 assert.equal(c.assignments[0].key,'baseline:building:house');assert.deepEqual(c.roads,['baseline:road:road']);
 assert.equal(writes,0);assert.equal(f.document.metadata.simulation.assignments[0].key,'baseline:house');
 assert.equal(session.check().ok,true);session.dispose();
});
test('config and completed summaries travel through the scene save interface and retain frozen provenance',async()=>{
 const f=fixture();f.cfg.settings.days=1;f.document.metadata.simulation=f.cfg;let saves=0;
 const session=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig:c=>f.document.metadata.simulation=c,save:async()=>{saves++;f.document.revision++;return {ok:true};}});
 assert.equal((await session.start()).ok,true);session.tick(15);const r=await session.finish();assert.equal(r.ok,true);assert.equal(saves,2);assert.equal(r.record.inputDigest.length,64);assert.equal(f.document.metadata.simulation.runs.length,1);assert.ok(r.record.result.arrivals>=0);assert.equal(r.record.source.projectId,f.document.projectId);
 const {validateSceneDocument}=await import('../../business-api/scene-files/references.mjs');
 const stored={schemaVersion:1,projectId:'10000000-0000-4000-8000-000000000001',villageId:'10000000-0000-4000-8000-000000000002',groupId:'g',baselineRef:{spaceId:'s',revision:1},revision:1,layers:[{id:'design'}],objects:[],groups:[],assetRefs:[],metadata:{scopeKind:'group',simulation:f.document.metadata.simulation}};
 assert.doesNotThrow(()=>validateSceneDocument(stored),'actual Aliyun document/file contract accepts the complete config and summary');session.dispose();
});
test('a save conflict blocks run and a scope change prevents writing a result to another plan',async()=>{
 const f=fixture();f.document.metadata.simulation=f.cfg;let writes=0;
 const session=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig:()=>writes++,save:async()=>({ok:false,code:'REVISION_CONFLICT'})});
 assert.equal((await session.start()).code,'REVISION_CONFLICT');assert.equal(session.state().snapshot,null);f.document.projectId='other';assert.throws(()=>session.update(f.cfg),/空间已切换/);assert.equal(writes,1);session.dispose();
});
