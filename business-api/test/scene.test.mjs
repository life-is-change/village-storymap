import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
const mod=await import('../scene/http.mjs').catch(()=>({}));
const contracts=await import('../scene/contracts.mjs').catch(()=>({}));
const id='10000000-0000-4000-8000-000000000001';
const document={schemaVersion:1,projectId:id,villageId:id,groupId:'g',baselineRef:{spaceId:'s',revision:0},revision:0,
 layers:[{id:'design'}],objects:[],groups:[],assetRefs:[],metadata:{scopeKind:'group'}};

test('scene contracts reject incomplete baseline, identity drift and unready file references',()=>{
 assert.equal(typeof contracts.parseOperation,'function');
 assert.deepEqual(contracts.parseOperation('save',{document}).input,{document});
 for(const d of [{...document,baselineRef:{}},{...document,revision:null},{...document,projectId:'bad'},
  {...document,objects:[{id:'x'},{id:'x'}]},{...document,assetRefs:['private.glb']},
  {...document,objects:[{id:'x',kind:'asset',properties:{modelUrl:'https://other/private.glb'}}]}]){
  assert.throws(()=>contracts.parseOperation('save',{document:d}));
 }
 assert.throws(()=>contracts.parseOperation('version',{projectId:id,revision:0,label:'v',previewPath:'group/a.png'}),{code:'FILES_NOT_READY'});
 assert.throws(()=>contracts.parseOperation('load',{projectId:id,userId:id}));
 assert.throws(()=>contracts.parseOperation('rpc',{name:'delete_everything'}));
});

test('built-in seed references remain editable without opening private file paths',()=>{
 const d={...document,assetRefs:['seed:bench:wood'],objects:[{id:'bench',kind:'asset',category:'bench',layerId:'design',
  geometry:{type:'Point',coordinates:[113,23]},transform:{headingDeg:0,pitchDeg:0,rollDeg:0,heightOffsetM:0,scale:[1,1,1]},properties:{assetRef:'seed:bench:wood'}}]};
 assert.equal(contracts.parseOperation('save',{document:d}).input.document,d);
 assert.throws(()=>contracts.parseOperation('save',{document:{...d,assetRefs:['seed:../../private']}}));
});

test('scene HTTP authenticates, limits bodies, keeps revision conflicts and redacts SQL',async()=>{
 assert.equal(typeof mod.createSceneHandler,'function');let calls=0;
 const server=createServer(mod.createSceneHandler({verifyIdentity:async h=>{if(h!=='Bearer good')throw {code:'UNAUTHORIZED'};return {userId:id};},
  database:{run:async(_,op)=>{calls++;if(op==='save')throw {code:'REVISION_CONFLICT',remoteRevision:2};if(op==='load')throw Error('private SQL token');return {id};}}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const send=(op,data,headers={})=>fetch(base+'/api/v1/scene/'+op,{method:'POST',headers:{Authorization:'Bearer good','Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  assert.equal((await fetch(base+'/healthz')).status,200);
  assert.equal((await send('load',{projectId:id},{Authorization:''})).status,401);assert.equal(calls,0);
  assert.equal((await fetch(base+'/api/v1/scene/load')).status,405);
  assert.equal((await send('rpc',{name:'foo'})).status,404);
  assert.equal((await send('load',{projectId:id,role:'admin'})).status,400);
  assert.equal((await send('load',{projectId:id},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await send('load',{padding:'a'.repeat(2*1024*1024)})).status,413);
  const conflict=await send('save',{document});assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.remoteRevision,2);
  const failed=await send('load',{projectId:id});assert.equal(failed.status,503);assert.ok(!JSON.stringify(await failed.json()).includes('private'));
  assert.equal(calls,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
