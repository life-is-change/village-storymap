import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';import {glb,assetInput} from './fixtures/scene-files.mjs';import {createUnifiedServices} from '../unified/services.mjs';import {createUnifiedHandler,closeUnifiedServices} from '../unified/http.mjs';import {createSceneFilesHandler} from '../scene-files/http.mjs';import {createServer} from 'node:http';
test('assembled HTTP and C2a share one native pool, preserve private uploads and deny revoked local profiles',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);
  await setup.query((await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]);
  await install();for(const name of ['catalog','survey','planning','files','events','scene'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  const root=await mkdtemp(join(tmpdir(),'village-unified-assembled-'));let services,server;
  try{
   const filesRoot=join(root,'files'),sceneRoot=join(root,'scene'),legacy=join(root,'legacy');for(const dir of [filesRoot,sceneRoot,legacy])await mkdir(dir,{mode:0o700});const indexPath=join(root,'index.json');await writeFile(indexPath,JSON.stringify({version:1,source_archive_sha256:'a'.repeat(64),objects:[]}),{mode:0o600});
   services=await createUnifiedServices({database:config,authOrigin:'https://rzmbmwauomzwiyenafha.supabase.co',publishableKey:'sb_publishable_synthetic',instanceId:'aliyun-assembled-test',filesRoot,sceneRoot,legacy:{root:legacy,indexPath},bridge:{enabled:false}});
   const identity=testIdentity(),spec=assetInput(),session=await services.sceneUploads.create(identity,spec);
   await services.sceneUploads.upload(identity,session.id,'display',Readable.from([glb()]));const asset=await services.sceneUploads.commit(identity,session.id,{displayName:'Native shared-pool model',license:'synthetic',metadata:{}});assert.ok(asset.id);
   await assert.rejects(services.sceneUploads.read(testIdentity(USERS.other),session.files[0].id),{code:'FORBIDDEN'});
   const verifyIdentity=async h=>{if(h!=='Bearer synthetic')throw Object.assign(Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});return testIdentity();};
   server=createServer(createUnifiedHandler({services,verifyIdentity,release:{releaseId:'synthetic'},sceneHandler:createSceneFilesHandler({verifyIdentity,database:services.scene,uploads:services.sceneUploads})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
   let response=await fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer synthetic'}});assert.equal(response.status,200);assert.equal((await response.json()).data.id,USERS.student);
   response=await fetch(base+'/api/v1/scene-files/files/'+session.files[0].id,{headers:{Authorization:'Bearer synthetic'}});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,glb().length);
   assert.ok(Number((await setup.query("SELECT count(*) n FROM pg_stat_activity WHERE usename='village_unified_login'")).rows[0].n)<=4);
   await setup.query('UPDATE profiles SET disabled_at=now() WHERE id=$1',[USERS.student]);response=await fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer synthetic'}});assert.equal(response.status,403);
   response=await fetch(base+'/api/v1/scene-files/files/'+session.files[0].id,{headers:{Authorization:'Bearer synthetic'}});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'PROFILE_DISABLED');
   await assert.rejects(services.sceneUploads.create(identity,{...spec,requestId:randomUUID()}),{code:'PROFILE_DISABLED'});
  }finally{if(server)await new Promise(r=>server.close(r));if(services)await closeUnifiedServices(services)();await rm(root,{recursive:true,force:true});}
 });
});
