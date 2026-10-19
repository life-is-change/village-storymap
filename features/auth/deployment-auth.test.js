const test=require('node:test'),assert=require('node:assert/strict');
let moduleAPI;try{moduleAPI=require('./deployment-profile.js');}catch{moduleAPI={};}
const config={mode:'aliyun',stage:'candidate',instanceId:'aliyun-test',apiBase:'/api/v1',releaseId:'test'};
test('source profile adapter leaves all requests with the original auth implementation',()=>{
 assert.equal(typeof moduleAPI.createDeploymentProfileClient,'function');
 assert.equal(moduleAPI.createDeploymentProfileClient({config:undefined,origin:'https://life-is-change.github.io'}),null);
});
test('Aliyun missing profile is provisioned locally and update never touches Supabase tables',async()=>{
 assert.equal(typeof moduleAPI.createDeploymentProfileClient,'function');const calls=[];
 const client=moduleAPI.createDeploymentProfileClient({config,origin:'https://platform.example',getAccessToken:async()=>'synthetic',fetchImpl:async(url,options)=>{calls.push([url,options]);return new Response(JSON.stringify(calls.length===1?{error:{code:'PROFILE_NOT_SYNCED'}}:{data:{id:'test-id',role:'student'}}),{status:calls.length===1?403:200});}});
 assert.equal((await client.load({id:'test-id'})).id,'test-id');await client.update({display_name:'Updated',class_name:''});
 assert.equal(calls.length,3);assert.ok(calls.every(([url,o])=>url.startsWith('https://platform.example/api/v1/')&&o.credentials==='omit'&&o.redirect==='error'&&o.headers.Authorization==='Bearer synthetic'));
 assert.deepEqual(JSON.parse(calls[2][1].body),{displayName:'Updated',className:''});
});
test('disabled profile or API failure cannot provision another profile or fall back to source',async()=>{
 assert.equal(typeof moduleAPI.createDeploymentProfileClient,'function');let count=0;
 const client=moduleAPI.createDeploymentProfileClient({config,origin:'https://platform.example',getAccessToken:async()=>'synthetic',fetchImpl:async()=>{count++;return new Response(JSON.stringify({error:{code:'PROFILE_DISABLED',detail:'private'}}),{status:403});}});
 await assert.rejects(client.load({id:'test-id'}),e=>e.code==='PROFILE_DISABLED'&&!e.message.includes('private'));assert.equal(count,1);
 assert.throws(()=>moduleAPI.createDeploymentProfileClient({config,origin:'http://8.148.248.237'}),/HTTPS_REQUIRED/);
});
