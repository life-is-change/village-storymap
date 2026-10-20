const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
let api;try{api=require('./deployment-auth-client.js');}catch{api={};}
const config={mode:'aliyun',stage:'candidate',instanceId:'aliyun-local-test',apiBase:'/api/v1',releaseId:'autonomous-test',auth:{version:1,mode:'local',path:'/auth/v1',publicKey:'village-local-public-v1'}};
const origin='https://8.148.248.237';
test('source SDK construction preserves the managed endpoint and original auth storage',()=>{
 assert.equal(typeof api.resolveAuthClientOptions,'function');
 const result=api.resolveAuthClientOptions(undefined,'https://life-is-change.github.io');
 assert.equal(result.url,'https://rzmbmwauomzwiyenafha.supabase.co');assert.equal(result.options.auth.storageKey,'village-storymap-supabase-auth-v1');assert.ok(result.key.startsWith('sb_publishable_'));
});
test('local SDK construction shares only same-instance sessions and ignores URL mode overrides',()=>{
 assert.equal(typeof api.createDeploymentAuthClient,'function');const calls=[];
 const client=api.createDeploymentAuthClient({sdk:{createClient(...args){calls.push(args);return {synthetic:true};}},config,origin});
 assert.equal(client.synthetic,true);assert.equal(calls[0][0],origin);assert.equal(calls[0][1],'village-local-public-v1');
 assert.equal(calls[0][2].auth.storageKey,'village-aliyun-local-test-auth-v1');
 assert.equal(calls[0][2].auth.detectSessionInUrl,false);
 assert.notEqual(api.resolveAuthClientOptions(config,origin).options.auth.storageKey,api.resolveAuthClientOptions({...config,instanceId:'aliyun-other'},origin).options.auth.storageKey);
 assert.equal(api.resolveAuthClientOptions(config,origin+'/?mode=source').url,origin);
});
test('malformed local deployment cannot redirect credentials or silently use source Auth',()=>{
 assert.equal(typeof api.resolveAuthClientOptions,'function');
 for(const auth of [null,{...config.auth,path:'https://evil.test/auth/v1'},{...config.auth,mode:'source'},{...config.auth,publicKey:'sb_secret_private'},{...config.auth,version:2},{...config.auth,privateKey:'hidden'}])assert.throws(()=>api.resolveAuthClientOptions({...config,auth},origin),/INVALID_DEPLOYMENT/);
 for(const site of ['https://evil.test','http://8.148.248.237'])assert.throws(()=>api.resolveAuthClientOptions(config,site),/HTTPS_REQUIRED|INVALID_DEPLOYMENT/);
});
test('actual auth facade creates its local SDK before loading profiles without any source client',async()=>{
 assert.equal(typeof api.createDeploymentAuthClient,'function');let created;
 const client={auth:{onAuthStateChange(){},async getSession(){return {data:{session:null}};}}};
 const window={VILLAGE_DEPLOYMENT:config,location:{origin},DeploymentAuthClientModule:api,SupabaseAuthModel:{},DeploymentProfileModule:{createDeploymentProfileClient(){return {instanceId:config.instanceId};}},addEventListener(){},dispatchEvent(){}};
 vm.runInNewContext(fs.readFileSync('auth-system.js','utf8'),{window,supabase:{createClient(url,key,options){created={url,key,options};return client;}},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},document:{getElementById(){return null;}},console:{warn(){},error(){}},setTimeout,clearTimeout,CustomEvent:class{}});
 await window.VillageAuth.ready;assert.equal(created.url,origin);assert.equal(created.options.auth.storageKey,'village-aliyun-local-test-auth-v1');assert.equal(window.VillageSupabaseClient,client);
});
