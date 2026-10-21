import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createHash,randomUUID} from 'node:crypto';
import {png} from './fixtures/scene-files.mjs';
let api,providerAPI;try{api=await import('../local-tasks/cloud.mjs');providerAPI=await import('../local-tasks/cloud-provider.mjs');}catch{api={};providerAPI={};}
const request={ownerId:randomUUID(),requestId:randomUUID()},job={operation:'submit',runId:randomUUID(),lease:randomUUID()},sha256=createHash('sha256').update(png).digest('hex');
const photo=()=>({size:png.length,sha256,mime:'image/png',stream:()=>Readable.from([png]),close:async()=>{}});
test('a lost paid submission or accepted-ID receipt never triggers a second automatic submission',async()=>{
 assert.equal(typeof api.createLocalCloudFacade,'function');let state='submit',submits=0,intent=false;
 const repository={async claim(){return {...job,operation:state};},async intent(){intent=true;state='unknown';},async record(_input,value){if(value.status==='accepted')throw Error('lost database response');}};
 const provider={available:true,async submit(){assert.equal(intent,true);submits++;return {jobId:'fixture-provider-id'};}};
 const service=api.createLocalCloudFacade({repository,provider,files:{openPhoto:photo}});
 await service.drive(request);await service.drive(request);assert.equal(submits,1);assert.equal(state,'unknown');
});
test('local cloud state persists only verified output and does not import a canceled result',async()=>{
 assert.equal(typeof api.createLocalCloudFacade,'function');let persisted=0,recorded;
 const repository={claim:async()=>({...job,operation:'poll',jobId:'fixture-provider-id'}),record:async(_input,value)=>{recorded=value;}};
 const provider={available:true,poll:async()=>({status:'succeeded',output:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png'}),openOutput:async()=>({stream:Readable.from([png]),size:png.length,mime:'image/png'})};
 const service=api.createLocalCloudFacade({repository,provider,files:{persistOutput:async()=>{persisted++;return {fileId:randomUUID(),sha256,size:png.length,mime:'image/png',extension:'png'};}}});
 await service.drive(request);assert.equal(persisted,1);assert.equal(recorded.status,'completed');assert.equal(recorded.artifact.sha256,sha256);
 repository.claim=async()=>({...job,operation:'canceled'});await service.drive(request);assert.equal(persisted,1);
});
test('provider accepts only bounded private image bytes, fixed endpoint and allowlisted result URLs',async()=>{
 assert.equal(typeof providerAPI.createDashScopeProvider,'function');const seen=[];
 const provider=providerAPI.createDashScopeProvider({enabled:true,key:'synthetic-provider-key-000000000000',workspace:'fixture-workspace',fetchImpl:async(url,options)=>{seen.push({url,options});return Response.json({output:{task_id:'fixture-provider-id'}});}});
 await provider.submit({image:photo()});assert.equal(seen.length,1);assert.equal(seen[0].url,'https://fixture-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation');const body=JSON.parse(seen[0].options.body);assert.match(body.input.messages[0].content[0].image,/^data:image\/png;base64,/);assert.equal(seen[0].options.redirect,'error');
 for(const output of ['http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a','https://127.0.0.1/a','https://evil.test/a','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/a'])await assert.rejects(provider.openOutput(output),{code:'PROVIDER_OUTPUT_INVALID'});
 assert.equal(seen.length,1);
});
test('oversized provider output is canceled without staging any private file',async()=>{
 assert.equal(typeof providerAPI.createDashScopeProvider,'function');let canceled=0;
 const provider=providerAPI.createDashScopeProvider({enabled:true,key:'synthetic-provider-key-000000000000',workspace:'fixture-workspace',fetchImpl:async()=>new Response(new ReadableStream({cancel(){canceled++;}}),{headers:{'Content-Length':String(10*1024**2+1),'Content-Type':'image/png'}})});
 await assert.rejects(provider.openOutput('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a'),{code:'PROVIDER_OUTPUT_INVALID'});assert.equal(canceled,1);
});
test('a failed input-reader close cannot permanently stall the provider loop',async()=>{
 let claims=0;const repository={claim:async()=>{claims++;return {...job};},intent:async()=>{},record:async()=>{}},provider={available:true,submit:async()=>({jobId:'fixture'})};
 const service=api.createLocalCloudFacade({repository,provider,files:{openPhoto:async()=>({...photo(),close:async()=>{throw Error('disk close');}})}});
 await service.drive(request).catch(()=>{});await service.drive(request).catch(()=>{});assert.equal(claims,2);
});
