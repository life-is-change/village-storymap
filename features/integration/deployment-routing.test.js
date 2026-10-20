const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createUnifiedApiClient}=require('../data/unified-api-client.js');
const config={mode:'aliyun',stage:'candidate',instanceId:'test-local',apiBase:'/api/v1',releaseId:'test'};
function auth(){let cb;return {auth:{getSession:async()=>({data:{session:{user:{id:'u1'},access_token:'secret'}}}),onAuthStateChange:f=>(cb=f,{data:{subscription:{unsubscribe(){}}}})},change:id=>cb('SIGNED_IN',{user:{id},access_token:'secret2'})};}
test('fixed ordinary routes stay same origin and never fall back on failure',async()=>{
 const calls=[],a=auth(),api=createUnifiedApiClient({deployment:config,origin:'https://local.example',authClient:a,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({error:{code:'DB_UNAVAILABLE'}},{status:503});}});
 await assert.rejects(api.execute('catalog.listCourses',{}),{code:'DB_UNAVAILABLE'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://local.example/api/v1/courses/list-courses');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
 await assert.rejects(api.execute('rpc.arbitrary',{}),{code:'UNKNOWN_OPERATION'});assert.equal(calls.length,1);api.dispose();
});
test('late responses cannot cross space or Auth user changes',async()=>{
 let context={spaceId:'a'},finish;const a=auth(),api=createUnifiedApiClient({deployment:config,origin:'https://local.example',authClient:a,contextProvider:()=>context,fetchImpl:()=>new Promise(r=>finish=r)});
 const pending=api.execute('catalog.listCourses',{});await new Promise(r=>setImmediate(r));context={spaceId:'b'};finish(Response.json({data:[]}));await assert.rejects(pending,{code:'CONTEXT_CHANGED'});
 const second=api.execute('catalog.listCourses',{});await new Promise(r=>setImmediate(r));a.change('u2');finish(Response.json({data:[]}));await assert.rejects(second,{code:'CONTEXT_CHANGED'});api.dispose();
});
test('frontend routes exactly match backend operation contracts',async()=>{
 const {OPERATIONS}=await import('../../business-api/unified/contracts.mjs');const {ROUTES}=require('../data/unified-operation-routes.js');
 assert.deepEqual(ROUTES,Object.fromEntries(Object.entries(OPERATIONS).map(([name,v])=>[name,{method:v.method,path:v.path}])));
});
test('admin page has its own local services and never uses source account deletion in Aliyun mode',()=>{
 const fs=require('node:fs'),source=fs.readFileSync('admin.js','utf8'),html=fs.readFileSync('admin.html','utf8');
 assert.match(html,/features\/data\/platform-services.js/);assert.match(source,/createPlatformServices/);assert.match(source,/services\.admin\.execute\('admin.disableUser'/);assert.match(source,/services\.admin\.execute\('admin.listPhotos'/);
});
test('local building rename uses fixed atomic operation with both feature leases',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('app.js','utf8'),start=source.indexOf('async function renameBuildingCodeInDb('),end=source.indexOf('\nasync function ',start+10),calls=[];
 const services={planning:{execute:async(a,p)=>{calls.push([a,p]);if(a==='planning.acquireLock')return {success:true,lockToken:p.objectCode+'-lease'};if(a==='planning.listFeatures')return [{object_code:'old',geometry_revision:2}];return {};}}};
 const rename=vm.runInNewContext(source.slice(start,end)+';renameBuildingCodeInDb',{window:{VillageBusinessServices:services},activeVillageContext:{teachingProjectId:'p',villageId:'v'},crypto:{randomUUID:()=> 'request'},supabaseClient:{from(){throw Error('SOURCE_QUERY');}}});
 await rename('s','old','new');const call=calls.find(c=>c[0]==='planning.renameBuilding');assert.equal(call[1].expectedRevision,2);assert.equal(call[1].lockToken,'old-lease');assert.equal(call[1].newLockToken,'new-lease');
});
