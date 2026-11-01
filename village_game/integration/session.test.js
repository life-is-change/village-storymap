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

function marketSession(options={}){const f=require('./tests/market-fixture').marketFixture();f.document.metadata.simulation=f.cfg;const s=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig:c=>f.document.metadata.simulation=c,save:async()=>({ok:true}),...options});return {f,s};}
test('saved market result retains bounded window, transaction counts and configuration on reopen',async()=>{const {f,s}=marketSession();assert.equal((await s.start()).ok,true);s.tick(45);s.pause();const count=s.state().snapshot.agents.length;s.tick(15);assert.equal(s.state().snapshot.agents.length,count);s.resume();const r=await s.finish();assert.equal(r.ok,true);assert.equal(r.record.result.runKind,'morning-market');assert.equal(r.record.result.window.endMinute,600);assert.equal(r.record.result.market.purchases,12);assert.equal(s.state().snapshot.minute,600);assert.equal(require('./plan-adapter').validateConfig(f.document.metadata.simulation).ok,true);
 const reopened=Session.create({readDocument:()=>f.document,readContext:()=>f.context,writeConfig(){},save:async()=>({ok:true})});assert.equal(reopened.state().config.runs[0].result.market.purchases,12);assert.equal(reopened.state().config.morningMarket.vendorCount,6);s.dispose();reopened.dispose();});
test('market settings enter comparison digest and save failure cannot start a market',async()=>{const {s}=marketSession();await s.start();const first=await s.finish();const c=s.state().config;c.morningMarket.customerCount=10;s.update(c);await s.start();const second=await s.finish();assert.notEqual(first.record.comparisonDigest,second.record.comparisonDigest);s.dispose();const rejected=marketSession({save:async()=>({ok:false,code:'REVISION_CONFLICT'})});assert.equal((await rejected.s.start()).ok,false);assert.equal(rejected.s.state().snapshot,null);rejected.s.dispose();});
test('late old market save cannot start or change the phase of a newer run',async()=>{let resolve;let calls=0;const {s}=marketSession({save:()=>++calls===1?new Promise(r=>resolve=r):Promise.resolve({ok:true})});const old=s.start();await Promise.resolve();const next=s.start();resolve({ok:true});assert.equal((await old).code,'CANCELLED');assert.equal((await next).ok,true);assert.equal(s.state().snapshot.runKind,'morning-market');s.dispose();});

test('market configuration and bounded summary satisfy the real scene-file save contract',async()=>{const {f,s}=marketSession();assert.equal((await s.start()).ok,true);const run=await s.finish();const {validateSceneDocument}=await import('../../business-api/scene-files/references.mjs');assert.doesNotThrow(()=>validateSceneDocument({schemaVersion:1,projectId:'10000000-0000-4000-8000-000000000001',villageId:'10000000-0000-4000-8000-000000000002',groupId:'g',baselineRef:{spaceId:'s',revision:1},revision:1,layers:[{id:'design'}],objects:f.document.objects,groups:[],assetRefs:['seed:stall:morning-vegetables','seed:stall:morning-fruit','seed:stall:morning-tofu'],metadata:{scopeKind:'group',simulation:f.document.metadata.simulation}}));s.dispose();});
test('market start times out without creating actors and ignores a late acknowledgement',async()=>{let finishSave;const {s}=marketSession({saveTimeoutMs:10,save:()=>new Promise(resolve=>finishSave=resolve)});const pending=s.start();const result=await pending;assert.equal(result.code,'SAVE_TIMEOUT');assert.equal(s.state().snapshot,null);finishSave({ok:true});await Promise.resolve();assert.equal(s.state().playing,false);s.dispose();});
