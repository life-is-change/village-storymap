const {test}=require('node:test');const assert=require('node:assert/strict');
const {createPlatformServices,guardBusinessClient}=require('../data/platform-services.js');
test('source preserves original adapters; local business client exposes only shared Auth',()=>{
 const authClient={auth:{},from(){return 'source';}};
 const source=createPlatformServices({deployment:undefined,authClient,origin:'https://pages.example'});assert.equal(source.mode,'source');assert.equal(source.sourceClient,authClient);assert.equal(source.community,undefined);
 const guarded=guardBusinessClient(authClient);assert.equal(guarded.auth,authClient.auth);for(const method of ['from','rpc','channel'])assert.throws(()=>guarded[method]('x'),/SOURCE_BUSINESS_DISABLED/);assert.throws(()=>guarded.storage,/SOURCE_BUSINESS_DISABLED/);
});
test('local community dispatch uses fixed API and lifecycle rejects use after disposal',async()=>{
 const urls=[],authClient={auth:{getSession:async()=>({data:{session:{user:{id:'u1'},access_token:'s'}}})}};
 const services=createPlatformServices({deployment:{mode:'aliyun',stage:'candidate',instanceId:'test-local',apiBase:'/api/v1',releaseId:'test'},origin:'https://local.example',authClient,contextProvider:()=>({userId:'u1'}),fetchImpl:async url=>{urls.push(url);return Response.json({data:[]});}});
 assert.deepEqual(await services.community.execute('community.listTasks',{}),[]);assert.match(urls[0],/^https:\/\/local.example\/api\/v1\/community\//);services.dispose();await assert.rejects(services.community.execute('community.listTasks',{}));
});
test('real sync scheduler discards a callback from the previous local user',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let user='a',callback,called=0;
 const window={VillageBusinessServices:{mode:'aliyun',deployment:{instanceId:'test'}},VillageAuth:{getCurrentUser:()=>({id:user})}};
 vm.runInNewContext(fs.readFileSync('features/sync/supabase-sync-manager.js','utf8'),{window,Date,console,setTimeout:fn=>(callback=fn,1),clearTimeout(){}});
 window.SupabaseSyncManager.schedule('refresh',()=>called++);user='b';await callback();assert.equal(called,0);
});
