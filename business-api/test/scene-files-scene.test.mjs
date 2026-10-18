import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const mod=await import('../scene-files/references.mjs').catch(()=>({}));
const base=()=>({schemaVersion:1,projectId:randomUUID(),villageId:randomUUID(),groupId:null,baselineRef:{spaceId:'A',revision:0},revision:0,layers:[{id:'design'}],objects:[],groups:[],assetRefs:[],metadata:{scopeKind:'admin_sandbox',ownerId:randomUUID()}});
test('UUID references preserve original document while paths and raw file IDs are not accepted as URLs',()=>{
 assert.equal(typeof mod.validateSceneDocument,'function');const d=base(),id=randomUUID();d.assetRefs=[id];assert.deepEqual(mod.validateSceneDocument(d),d);assert.equal(d.assetRefs[0],id);
 for(const ref of ['../../file.glb','https://evil.invalid/a','blob:untrusted'])assert.throws(()=>mod.validateSceneDocument({...d,assetRefs:[ref]}));
 assert.throws(()=>mod.validateSceneDocument({...d,metadata:{...d.metadata,lowStoragePath:'private/file'}}));
});
test('components validate local geometry and reject hidden path references',()=>{
 assert.equal(typeof mod.validateFragment,'function');const f={id:randomUUID(),name:'Bench',coordinateSpace:'local-m',objects:[],assetRefs:[]};assert.deepEqual(mod.validateFragment(f),f);
 assert.throws(()=>mod.validateFragment({...f,assetRefs:['https://evil.invalid/a']}));assert.throws(()=>mod.validateFragment({...f,coordinateSpace:'other'}));
});
