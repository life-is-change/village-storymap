const test=require('node:test');const assert=require('node:assert/strict');
let m;try{m=require('./business-api-client.js');}catch{m={};}
test('explicit API adapter refreshes token each call and never falls back',async()=>{
 assert.equal(typeof m.createBusinessApiClient,'function','business adapter missing');let count=0;const calls=[];
 const api=m.createBusinessApiClient({baseUrl:'http://127.0.0.1:18080/api/v1',getAccessToken:async()=> 'token-'+(++count),fetchImpl:async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>({data:[]})};}});
 await api.getMe();await api.listSpaces({kind:'personal',limit:10});assert.equal(count,2);assert.equal(calls[1][1].headers.Authorization,'Bearer token-2');assert.equal(calls[0][1].redirect,'error');
 for(const baseUrl of ['https://evil.invalid/api/v1','http://user:password@127.0.0.1/api/v1','javascript:alert(1)'])assert.throws(()=>m.createBusinessApiClient({baseUrl,getAccessToken:()=>null}));
 const bad=m.createBusinessApiClient({baseUrl:'http://127.0.0.1:18080/api/v1',getAccessToken:()=> 'token',fetchImpl:async()=>({ok:false,status:503,json:async()=>({error:{code:'DB_UNAVAILABLE',detail:'private'}})})});
 await assert.rejects(()=>bad.getMe(),e=>e.code==='DB_UNAVAILABLE'&&!String(e).includes('private'));
});
