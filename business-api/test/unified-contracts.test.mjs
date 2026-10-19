import test from 'node:test';
import assert from 'node:assert/strict';
let api;try{api=await import('../unified/contracts.mjs');}catch{api={};}
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'group-space'};
test('all fixed action contracts have valid examples and reject unknown fields',()=>{
 assert.equal(typeof api.parseOperation,'function');assert.ok(Object.keys(api.OPERATIONS).length>=60);
 for(const [name,def] of Object.entries(api.OPERATIONS)){
  assert.ok(def.source && def.proof && typeof def.readOnly==='boolean',name);
  const input=api.exampleInput(name),parsed=api.parseOperation(name,input);assert.equal(parsed.action,name);assert.notEqual(parsed.input,input);
  assert.throws(()=>api.parseOperation(name,{...input,sql:'SELECT secret'}),{code:'INVALID_INPUT'},name);
 }
});
test('unknown actions, pollution keys, spoofed actor and invalid scoped IDs are rejected',()=>{
 assert.equal(typeof api.parseOperation,'function');
 assert.throws(()=>api.parseOperation('rpc',{name:'delete_everything'}),{code:'NOT_FOUND'});
 for(const payload of [{...context,userId:'10000000-0000-4000-8000-000000000001'}, {...context,teachingProjectId:'not-a-uuid'},{...context,spaceId:'../bad'}])assert.throws(()=>api.parseOperation('survey.listReviews',payload),{code:'INVALID_INPUT'});
 assert.throws(()=>api.parseOperation('survey.saveAttributes',{...context,objectCode:'B1',objectType:'building',data:JSON.parse('{"__proto__":{"admin":true}}')}),{code:'INVALID_INPUT'});
 assert.throws(()=>api.parseOperation('survey.saveAttributes',{...context,objectCode:'B1',objectType:'building',data:{value:NaN}}),{code:'INVALID_INPUT'});
});
test('bulk edits are limited to 500 and ordinary JSON payloads to 2 MiB',()=>{
 assert.equal(typeof api.parseOperation,'function');
 const edit={action:'update',layerKey:'building',objectCode:'B1',geom:{type:'Point',coordinates:[113,23]},props:{}};
 assert.equal(api.parseOperation('planning.saveBatch',{...context,requestId:'c0000000-0000-4000-8000-000000000001',changes:Array.from({length:500},()=>edit)}).input.changes.length,500);
 assert.throws(()=>api.parseOperation('planning.saveBatch',{...context,requestId:'c0000000-0000-4000-8000-000000000001',changes:Array.from({length:501},()=>edit)}),{code:'INVALID_INPUT'});
 assert.throws(()=>api.parseOperation('survey.saveAttributes',{...context,objectCode:'B1',objectType:'building',data:{value:'x'.repeat(2*1024*1024)}}),{code:'PAYLOAD_TOO_LARGE'});
});
test('operations expose only fixed HTTP routes and protect mutation replay keys',()=>{
 assert.equal(typeof api.parseOperation,'function');const seen=new Set();
 for(const [name,def] of Object.entries(api.OPERATIONS)){
  assert.match(def.path,/^\/api\/v1\/[a-zA-Z0-9/-]+$/);assert.ok(!seen.has(def.method+' '+def.path));seen.add(def.method+' '+def.path);
  if(def.replaySafe){const example=api.exampleInput(name);assert.ok(example.requestId,name);const {requestId,...rest}=example;assert.throws(()=>api.parseOperation(name,rest),{code:'INVALID_INPUT'});}
 }
});
test('village draft contracts preserve source options and use the real publish-model identifier',()=>{
 const requestId='c0000000-0000-4000-8000-000000000001';
 assert.doesNotThrow(()=>api.parseOperation('admin.createVillage',{name:'TEST',isPractice:true,boundary:null,defaultCrs:'EPSG:4326',requestId}));
 assert.doesNotThrow(()=>api.parseOperation('admin.saveDataset',{villageId:context.villageId,sourceKind:'uploaded_bundle',layerManifest:{},imageryConfig:null,validationSummary:{},status:'draft',datasetId:null,versionLabel:null,requestId}));
 assert.doesNotThrow(()=>api.parseOperation('admin.saveRealityModel',{villageId:context.villageId,ionAssetId:1,title:'TEST',heightOffset:0,terrainEnabled:true,status:'draft',modelId:null,requestId}));
 assert.doesNotThrow(()=>api.parseOperation('admin.publishRealityModel',{modelId:context.villageId,requestId}));
 assert.throws(()=>api.parseOperation('admin.publishRealityModel',{villageId:context.villageId,requestId}),{code:'INVALID_INPUT'});
});
test('profile can clear optional display fields without accepting a role or changing student identity',()=>{
 assert.doesNotThrow(()=>api.parseOperation('identity.updateProfile',{gender:'',className:'',grade:''}));
 assert.throws(()=>api.parseOperation('identity.updateProfile',{studentId:'other'}),{code:'INVALID_INPUT'});
});
test('identity mutation routes have one unambiguous path separator',()=>{
 assert.equal(api.OPERATIONS['identity.ensureProfile'].path,'/api/v1/identity/ensure-profile');
 assert.equal(api.OPERATIONS['identity.updateProfile'].path,'/api/v1/identity/update-profile');
});
