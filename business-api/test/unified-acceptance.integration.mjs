import {spawnSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';import {createUnifiedServices} from '../unified/services.mjs';import {createUnifiedHandler,closeUnifiedServices} from '../unified/http.mjs';
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
test('concentrated native HTTP acceptance: role identity, actual four-connection pool, concurrency and restart',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await setup.query((await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]);await install();
  for(const name of ['catalog','survey','planning','files','events','scene'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  const root=await mkdtemp(join(tmpdir(),'unified-load-'));let services,server;const logs=[],results=[];
  async function start(){
   services=await createUnifiedServices({database:config,authOrigin:'https://rzmbmwauomzwiyenafha.supabase.co',publishableKey:'sb_publishable_synthetic',instanceId:'aliyun-load-ci',filesRoot:join(root,'files'),sceneRoot:join(root,'scene'),legacy:{root:join(root,'legacy'),indexPath:join(root,'index.json')},bridge:{enabled:false}});
   const verifyIdentity=async header=>{const id=header?.replace('Bearer ','');if(!Object.values(USERS).includes(id))throw Object.assign(Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});return testIdentity(id);};
   server=createServer(createUnifiedHandler({services,verifyIdentity,release:{releaseId:'native-ci',instanceId:'load-ci'},log:value=>logs.push(value)}));await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;
  }
  async function stop(){await new Promise(r=>server.close(r));await closeUnifiedServices(services)();services=null;server=null;}
  try{
   for(const path of ['files','scene','legacy'])await mkdir(join(root,path),{mode:0o700});await writeFile(join(root,'index.json'),JSON.stringify({version:1,source_archive_sha256:'a'.repeat(64),objects:[]}),{mode:0o600});
   let base=await start();assert.equal((await fetch(base+'/api/v1/me')).status,401);
   for(const role of ['student','teacher','admin']){const response=await fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer '+USERS[role]}});assert.equal(response.status,200);assert.equal((await response.json()).data.role,role);}
   for(const concurrency of [1,5,10,20]){
    const times=[],stages={auth:[],sql:[],file:[]};
    await Promise.all(Array.from({length:concurrency},async(_,worker)=>{for(let n=0;n<3;n++){
     const started=performance.now(),response=await fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer '+USERS.student}});assert.equal(response.status,200);assert.equal((await response.json()).data.id,USERS.student);times.push(performance.now()-started);
     const timing=response.headers.get('server-timing');for(const kind of Object.keys(stages)){const match=timing?.match(new RegExp(kind+';dur=([0-9.]+)'));assert.ok(match);stages[kind].push(Number(match[1]));}
    }}));
    const row={concurrency,samples:times.length,failures:0,p50_ms:percentile(times,.5),p95_ms:percentile(times,.95)};for(const kind of Object.keys(stages))row[kind+'_p95_ms']=percentile(stages[kind],.95);results.push(row);
    assert.ok(Number((await setup.query("SELECT count(*) n FROM pg_stat_activity WHERE usename='village_unified_login'")).rows[0].n)<=4);
   }
   const before=(await fetch(base+'/healthz').then(r=>r.json()));await stop();base=await start();assert.deepEqual(await fetch(base+'/healthz').then(r=>r.json()),before);assert.equal((await fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer '+USERS.student}})).status,200);
   assert.ok(logs.some(value=>value.sqlMs>0));assert.ok(logs.every(value=>!('token' in value)&&!('userId' in value)));assert.ok(process.memoryUsage().rss<256*1024**2);
   console.log('UNIFIED_NATIVE_LOAD '+JSON.stringify({results,process_rss_bytes:process.memoryUsage().rss,auth:'synthetic identity; no real gateway latency',restart:'HTTP service and shared pool, not a Docker restart',source_baseline:'pending real cloud comparison'}));
  }finally{if(server)await stop();await rm(root,{recursive:true,force:true});}
 });
});


test('actual deployment TEST context is reusable and supports the first real planning read and geometry save',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await setup.query('ALTER TABLE teaching_projects ADD created_by uuid');await install();for(const name of ['catalog','survey','planning','files'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  const generated=spawnSync('python3',['-c',"import importlib.util; s=importlib.util.spec_from_file_location('d','linux/scripts/deploy-unified-business.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.test_context_sql('"+USERS.admin+"','"+USERS.student+"'))"],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  for(let i=0;i<2;i++)await setup.query(generated.stdout);
  const db=(await import('../unified/database.mjs')).createUnifiedDatabase(config),planning=(await import('../unified/planning.mjs')).createPlanningService({database:db});
  const target={teachingProjectId:'c3a00000-0000-4000-8000-000000000002',villageId:'c3a00000-0000-4000-8000-000000000001',spaceId:'unified-test-space-20261020'};
  try{
   assert.deepEqual(await planning.execute(testIdentity(USERS.admin),'planning.listFeatures',{...target,layerKey:'building'}),[]);
   const lease=await planning.execute(testIdentity(USERS.admin),'planning.acquireLock',{...target,layerKey:'building',objectCode:'TEST-1'});assert.equal(lease.success,true);
   await planning.execute(testIdentity(USERS.admin),'planning.saveBatch',{...target,requestId:crypto.randomUUID(),summary:'Unified TEST',changes:[{action:'add',layerKey:'building',objectCode:'TEST-1',afterGeom:{type:'Polygon',coordinates:[[[113,23],[113.00001,23],[113.00001,23.00001],[113,23]]]},afterProps:{probeRunId:'native'},expectedGeometryRevision:0,lockToken:lease.lockToken}]});
   assert.equal((await planning.execute(testIdentity(USERS.student),'planning.listFeatures',{...target,layerKey:'building'})).length,1);
   assert.equal((await setup.query("SELECT count(*) FROM planning_spaces WHERE id=$1",[target.spaceId])).rows[0].count,'1');
  }finally{await db.close();}
 });
});
