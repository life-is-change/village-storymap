// Fresh synthetic browser only. All external traffic is blocked; never opens a user session.
import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {resolve,extname,sep} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),userId='10000000-0000-4000-8000-000000000001';
const profile={id:userId,student_id:'browser-test',display_name:'Browser TEST',role:'admin'};
let mode='source';const requests=[];
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local');if(url.pathname==='/deployment-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.VILLAGE_DEPLOYMENT='+JSON.stringify(mode==='source'?{mode:'source',stage:'live',instanceId:'supabase-rzmbmwauomzwiyenafha',apiBase:null,releaseId:'browser-test'}:{mode:'aliyun',stage:'candidate',instanceId:'aliyun-browser-test',apiBase:'/api/v1',releaseId:'browser-test'})+';');}
 if(url.pathname.startsWith('/api/v1/')){requests.push(url.pathname);res.setHeader('Content-Type','application/json');const value=url.pathname==='/api/v1/me'?profile:url.pathname==='/api/v1/bootstrap'?{profile,courses:[],projects:[],villages:[],groupSpaces:[],personalSpaces:[]}:[];return res.end(JSON.stringify({data:value}));}
 const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(resolve(root)+sep))throw Error();const bytes=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]??'application/octet-stream');res.end(bytes);
 }catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const sdk=`(()=>{const calls=window.__sourceCalls=[];const profile=${JSON.stringify(profile)},user={id:profile.id,user_metadata:{student_id:profile.student_id,display_name:profile.display_name}},session={user,access_token:'synthetic-browser-token'};
function query(table){let single=false;const q=new Proxy({}, {get(t,k){if(k==='then')return resolve=>resolve({data:single?profile:[],error:null});return (...args)=>{calls.push(['query',table,k]);if(k==='single'||k==='maybeSingle')single=true;return q;};}});return q;}
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},from:t=>query(t),rpc:async(name)=>{calls.push(['rpc',name]);return {data:name.includes('context')?null:[],error:null};},channel:()=>({on(){return this},subscribe(){return this},unsubscribe(){}}),removeChannel(){},storage:{from:()=>({})}})};})();`;
let browser;const reports=[];
try{
 browser=await chromium.launch({headless:true});
 for(mode of ['source','aliyun'])for(const pageName of ['index.html','admin.html']){
  const context=await browser.newContext();const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(origin+'/'))return route.continue();if(url.includes('@supabase/supabase-js'))return route.fulfill({status:200,contentType:'text/javascript',body:sdk});return route.abort();});
  await page.goto(origin+'/'+pageName,{waitUntil:'load'});try{await page.waitForFunction(()=>window.VillageBusinessServices&&window.VillageAuth?.getCurrentUser?.(),null,{timeout:15000});}catch(e){console.error(JSON.stringify({page:pageName,mode,errors,state:await page.evaluate(()=>({registry:!!window.VillageBusinessServices,auth:!!window.VillageAuth,user:!!window.VillageAuth?.getCurrentUser?.(),sdk:!!window.supabase}))}));throw e;}
  const before=requests.length;
  const value=await page.evaluate(async()=>{
   const services=window.VillageBusinessServices;const registry={mode:services.mode,user:window.VillageAuth.getCurrentUser().id};
   if(services.mode==='aliyun'){
    await services.identity.me();await services.catalog.execute('catalog.listCourses',{});await services.admin.execute('admin.listUsers',{});
    const client=window.CourseServiceModule.createCourseService({supabaseClient:services.businessClient,services});await client.listGroups();
    let refused=false;try{services.businessClient.from('profiles');}catch(e){refused=e.message==='SOURCE_BUSINESS_DISABLED';}if(!refused)throw Error('SOURCE_GUARD_MISSING');
   }else{await window.VillageSupabaseClient.from('profiles').select('*');}
   return {...registry,sourceCalls:window.__sourceCalls.length,localDomains:Boolean(services.catalog)};
  });
  assert.equal(value.mode,mode);assert.equal(value.user,userId);if(mode==='aliyun'){assert.equal(value.sourceCalls,0);assert.equal(value.localDomains,true);assert.ok(requests.length>before);}else{assert.ok(value.sourceCalls>0);assert.equal(value.localDomains,false);assert.equal(requests.length,before);}
  assert.deepEqual(errors,[],pageName+' '+mode+' page exceptions');reports.push({page:pageName,mode,sourceBusinessCalls:value.sourceCalls,localRequests:requests.length-before});await context.close();
 }
 console.log(JSON.stringify({status:'synthetic_browser_page_routing_passed',reports,real_auth:false,real_gpu_jobs:false}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
