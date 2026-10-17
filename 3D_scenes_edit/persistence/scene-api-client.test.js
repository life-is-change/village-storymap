const test=require('node:test');const assert=require('node:assert/strict');
let api;try{api=require('./scene-api-client.js');}catch{api={};}
test('opt-in scene client sends current token, preserves conflict and never retries source writes',async()=>{
 assert.equal(typeof api.createSceneApiClient,'function');let calls=[];
 const client=api.createSceneApiClient({baseUrl:'http://127.0.0.1:18082/api/v1/scene',getAccessToken:async()=> 'fresh',
 fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:false,status:409,json:async()=>({error:{code:'REVISION_CONFLICT',remoteRevision:7}})};}});
 const result=await client.saveDraft({revision:1});assert.equal(result.code,'REVISION_CONFLICT');assert.equal(result.remoteRevision,7);
 assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer fresh');assert.equal(calls[0].options.redirect,'error');
 assert.equal((await client.registerAsset({})).code,'FILES_NOT_READY');assert.equal(calls.length,1);
 assert.throws(()=>api.createSceneApiClient({baseUrl:'http://8.148.248.237/api/v1/scene'}),/INVALID_API_ORIGIN/);
 assert.throws(()=>api.createSceneApiClient({baseUrl:'https://other.example/api/v1/scene'}),/INVALID_API_ORIGIN/);
});
