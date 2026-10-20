// Disposable GitHub runner only. Never start a database on the developer host.
import test from 'node:test';import assert from 'node:assert/strict';
import pg from 'pg';import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
import {disposableURL,USERS,TEST_PASSWORD} from './fixtures/unified.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';
import {createIdentityGateway,createIdentityService} from '../unified/identity.mjs';
import {createRecoveryAuth,createRecoveryService} from '../auth/recovery.mjs';
const origin='https://8.148.248.237',internal='http://127.0.0.1:9999';
const authConfig={authMode:'local',authOrigin:origin,authInternalOrigin:'http://auth:9999'};
const password='synthetic-ci-password-0001',jwtSecret='synthetic-ci-only-local-auth-signing-secret-0000000000000000';
function docker(args){try{return execFileSync('docker',args,{encoding:'utf-8',stdio:['ignore','pipe','pipe'],timeout:120000});}catch(e){const detail=String(e.stderr??'').replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL]').slice(-600);throw Error('DISPOSABLE_AUTH_PROCESS_FAILED '+detail);}}
async function waitAuth(){for(let i=0;i<50;i++){try{if((await fetch(internal+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,400));}throw Error('DISPOSABLE_AUTH_HEALTH_TIMEOUT');}
async function request(path,body,access){const response=await fetch(internal+path,{method:'POST',headers:{'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{})},body:JSON.stringify(body)});assert.ok(response.ok,'AUTH_REQUEST_STATUS_'+response.status);return response.status===204?null:response.json();}

test('pinned GoTrue preserves imported password identity and local session, profile and signup boundaries',async()=>{
 assert.equal(process.env.VILLAGE_TEST_AUTH_RUNTIME,'1','Explicit disposable CI Auth runtime required');
 assert.equal(process.env.GITHUB_ACTIONS,'true','Native Auth runs only in the isolated CI runner');
 const base=disposableURL(),admin=new pg.Client({connectionString:base.href});await admin.connect();
 let setup,db,owned=false,roles=false,running=false;
 try{
  assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname='village_unified_candidate'")).rowCount,0);
  assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname IN ('postgres','authenticated','anon','village_unified_login','village_auth_runtime','village_auth_migrator')")).rowCount,0);
  // Upstream 20240612123726 grants Auth SELECT to the postgres role. Our
  // disposable cluster uses another bootstrap name; supply a NOLOGIN placeholder.
  await admin.query("CREATE ROLE postgres NOLOGIN NOSUPERUSER NOBYPASSRLS;CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE village_auth_migrator LOGIN PASSWORD 'synthetic-ci-migration-only' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;CREATE ROLE village_auth_runtime LOGIN PASSWORD 'synthetic-ci-runtime-only' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB CONNECTION LIMIT 2");roles=true;
  await admin.query('CREATE DATABASE village_unified_candidate');owned=true;
  const target=new URL(base);target.pathname='/village_unified_candidate';setup=new pg.Client({connectionString:target.href});await setup.connect();
  await setup.query('CREATE SCHEMA auth AUTHORIZATION village_auth_migrator;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;ALTER ROLE village_auth_migrator IN DATABASE village_unified_candidate SET search_path=auth;ALTER ROLE village_auth_runtime IN DATABASE village_unified_candidate SET search_path=auth');
  const manifest=JSON.parse(await readFile(new URL('../../linux/auth-runtime.json',import.meta.url),'utf-8'));
  assert.match(manifest.image,/^supabase\/gotrue@sha256:[a-f0-9]{64}$/);
  const env={GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:origin+'/auth/v1',GOTRUE_SITE_URL:origin,GOTRUE_URI_ALLOW_LIST:origin,GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_NAMESPACE:'auth',GOTRUE_DB_MAX_POOL_SIZE:'2',GOTRUE_DB_MAX_IDLE_POOL_SIZE:'1',GOTRUE_JWT_SECRET:jwtSecret,GOTRUE_JWT_ISSUER:origin+'/auth/v1',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_EXP:'900',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED:'false',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED:'true',LOG_LEVEL:'warn'};
  const flags=Object.entries(env).flatMap(([k,v])=>['--env',k+'='+v]);
  const databaseURL=role=>`postgresql://${role}:${role==='village_auth_migrator'?'synthetic-ci-migration-only':'synthetic-ci-runtime-only'}@127.0.0.1:${base.port}/village_unified_candidate`;
  docker(['run','--rm','--network','host',...flags,'--env','GOTRUE_DB_DATABASE_URL='+databaseURL('village_auth_migrator'),manifest.image,'auth','migrate']);
  assert.equal((await setup.query('SELECT max(version) AS version FROM auth.schema_migrations')).rows[0].version,manifest.maximum_migration);
  // Import preexisting user UUIDs/hashes directly; do not create them through signup.
  for(const [kind,id] of Object.entries(USERS)){
   const student=kind==='admin'?'332':kind;
   await setup.query(`INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change_token_current,reauthentication_token)
     VALUES('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf',10)),now(),'{"provider":"email","providers":["email"]}',$4::jsonb,now(),now(),'','','','','')`,[id,'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co',password,JSON.stringify({student_id:student,display_name:kind})]);
   await setup.query("INSERT INTO auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) VALUES(extensions.gen_random_uuid(),$1::uuid,$1::uuid::text,$2::jsonb,'email',now(),now())",[id,JSON.stringify({sub:id,email:'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co'})]);
  }
  const existingHash=(await setup.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[USERS.student])).rows[0].encrypted_password;
  const identityFixture=await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8');
  await setup.query(identityFixture.replace('CREATE SCHEMA auth;','').replace('CREATE FUNCTION auth.uid()','CREATE OR REPLACE FUNCTION auth.uid()'));
  for(const [kind,id] of Object.entries(USERS))await setup.query('UPDATE profiles SET student_id=$1 WHERE id=$2',[kind==='admin'?'332':kind,id]);
  await setup.query('ALTER TABLE profiles ADD CONSTRAINT profile_user_fk FOREIGN KEY(id) REFERENCES auth.users(id)');
  await setup.query(await readFile(new URL('../../linux/sql/unified/identity.sql',import.meta.url),'utf8'));
  await setup.query(await readFile(new URL('../../linux/sql/local-auth.sql',import.meta.url),'utf8'));
  await setup.query(await readFile(new URL('../../linux/sql/local-auth-recovery.sql',import.meta.url),'utf8'));
  await setup.query("ALTER ROLE village_unified_login PASSWORD '"+TEST_PASSWORD+"'");
  const start=()=>{docker(['run','--detach','--name','village-auth-ci','--network','host',...flags,'--env','GOTRUE_DB_DATABASE_URL='+databaseURL('village_auth_runtime'),manifest.image]);running=true;};
  start();await waitAuth();
  const proofFetch=(url,options)=>{assert.equal(url,'http://auth:9999/user','No original Supabase requests permitted');return fetch(internal+'/user',options);};
  db=createUnifiedDatabase({host:base.hostname,port:Number(base.port),database:'village_unified_candidate',user:'village_unified_login',password:TEST_PASSWORD},{authPolicy:authConfig});
  const gateway=createIdentityGateway({...authConfig,checkLocalSession:db.checkLocalSession,fetchImpl:proofFetch});
  const service=createIdentityService({database:db,authPolicy:authConfig,verifyIdentity:gateway.verifyIdentity,sourceProfileReader:gateway.sourceProfileReader});
  const login=()=>request('/token?grant_type=password',{email:'sid-student@rzmbmwauomzwiyenafha.supabase.co',password});
  const session=await login();assert.equal(session.user.id,USERS.student);
  const actor=await gateway.verifyIdentity('Bearer '+session.access_token);assert.equal((await service.me(actor)).id,USERS.student);
  assert.equal((await setup.query('SELECT encrypted_password FROM auth.users WHERE id=$1',[USERS.student])).rows[0].encrypted_password,existingHash);
  const signup=await request('/signup',{email:'sid-fresh@rzmbmwauomzwiyenafha.supabase.co',password,data:{student_id:'fresh',display_name:'Fresh',role:'admin'}});
  const fresh=await gateway.verifyIdentity('Bearer '+signup.access_token);
  const provisioned=await Promise.all(Array.from({length:4},()=>service.ensureProfile(fresh)));
  assert.ok(provisioned.every(p=>p.id===signup.user.id&&p.role==='student'));
  assert.equal((await setup.query('SELECT count(*) n FROM profiles WHERE id=$1',[fresh.userId])).rows[0].n,'1');
  await assert.rejects(db.withMaintenance(c=>c.query('SELECT api_private.ensure_profile($1,$2::jsonb)',[fresh.userId,'{}'])),{code:'FORBIDDEN'});
  await assert.rejects(service.ensureProfile({...fresh,userId:'60000000-0000-4000-8000-000000000006'}),{code:'UNAUTHORIZED'});
  const refresh=await request('/token?grant_type=refresh_token',{refresh_token:signup.refresh_token});
  assert.equal(refresh.user.id,fresh.userId);await gateway.verifyIdentity('Bearer '+refresh.access_token);
  await request('/logout?scope=global',{},refresh.access_token);
  await assert.rejects(gateway.verifyIdentity('Bearer '+refresh.access_token),{code:'UNAUTHORIZED'});
  docker(['restart','village-auth-ci']);await waitAuth();
  assert.equal((await login()).user.id,USERS.student);
  const localClaims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
  const foreignToken=[session.access_token.split('.')[0],Buffer.from(JSON.stringify({...localClaims,iss:'https://rzmbmwauomzwiyenafha.supabase.co/auth/v1'})).toString('base64url'),session.access_token.split('.')[2]].join('.');
  await assert.rejects(gateway.verifyIdentity('Bearer '+foreignToken),{code:'UNAUTHORIZED'});
  const runtime=new pg.Client({connectionString:databaseURL('village_auth_runtime')});await runtime.connect();
  try{await assert.rejects(runtime.query('CREATE TABLE auth.must_not_create(id int)'),e=>e.code==='42501');await assert.rejects(runtime.query('SELECT * FROM public.profiles'),e=>e.code==='42501');}finally{await runtime.end();}
  const recoveryFetch=async(url,options)=>{assert.ok(url.startsWith('http://auth:9999/'));const response=await fetch(internal+url.slice('http://auth:9999'.length),options);if(!response.ok)console.log(JSON.stringify({phase:'native_recovery_auth',route:url.includes('/admin/users/')?'admin-user':url.includes('/token?')?'token':'user-or-logout',status:response.status}));return response;};
  const recoveryAuth=createRecoveryAuth({jwtSecret,checkLocalSession:db.checkLocalSession,fetchImpl:recoveryFetch});
  const recovery=createRecoveryService({database:db,auth:recoveryAuth});
  const reset={adminStudentId:'332',adminPassword:password,targetStudentId:'fresh',newPassword:'synthetic-ci-changed-password-0002',requestId:'90000000-0000-4000-8000-000000000009'};
  await assert.rejects(recovery.reset({...reset,adminStudentId:'student'}),{code:'FORBIDDEN'});
  await assert.rejects(recovery.reset({...reset,targetStudentId:'332'}),{code:'FORBIDDEN'});
  const beforeReset=await request('/token?grant_type=password',{email:'sid-fresh@rzmbmwauomzwiyenafha.supabase.co',password});
  const lostAck=createRecoveryService({database:db,auth:{...recoveryAuth,async changePassword(...args){await recoveryAuth.changePassword(...args);throw Error('synthetic lost acknowledgement');}}});
  await assert.rejects(lostAck.reset(reset),{code:'RECOVERY_UNKNOWN'});
  assert.equal((await setup.query('SELECT state FROM api_private.auth_recovery_actions WHERE request_id=$1',[reset.requestId])).rows[0].state,'unknown');
  await assert.rejects(gateway.verifyIdentity('Bearer '+beforeReset.access_token),{code:'UNAUTHORIZED'});
  await assert.rejects(recovery.reset(reset),{code:'RECOVERY_UNKNOWN'});
  assert.equal((await recovery.reset({...reset,reconcile:true})).status,'local_password_reset_completed');
  assert.equal((await recovery.reset(reset)).status,'local_password_reset_completed','lost completion receipt replays');
  await assert.rejects(gateway.verifyIdentity('Bearer '+beforeReset.access_token),{code:'UNAUTHORIZED'});
  await assert.rejects(recoveryAuth.login('fresh',password),{code:'UNAUTHORIZED'});
  const recovered=await recoveryAuth.login('fresh',reset.newPassword);assert.equal(recovered.userId,fresh.userId);await recoveryAuth.release(recovered);
  assert.equal((await setup.query("SELECT count(*) n FROM api_private.auth_recovery_actions WHERE state='completed'")).rows[0].n,'1');
  const adminActor=await recoveryAuth.login('332',password);
  try{
   // Existing accepted records count against the fixed 3/hour limit.
   await setup.query("INSERT INTO api_private.auth_recovery_actions(actor_id,request_id,target_id,target_student_id,request_mac,state,created_at) SELECT $1,gen_random_uuid(),$2,'fresh',repeat('b',64),'completed',now()-interval '1 minute' FROM generate_series(1,2)",[USERS.admin,fresh.userId]);
   await assert.rejects(recovery.reset({...reset,requestId:'91000000-0000-4000-8000-000000000009'}),{code:'RATE_LIMITED'});
   await service.disableLocalProfile(adminActor,fresh.userId);
   await assert.rejects(recoveryAuth.login('fresh',reset.newPassword),{code:'UNAUTHORIZED'});
   assert.equal((await setup.query('SELECT count(*) n FROM auth.sessions WHERE user_id=$1',[fresh.userId])).rows[0].n,'0');
  }finally{await recoveryAuth.release(adminActor);}
 }finally{
  if(running)docker(['rm','--force','village-auth-ci']);await db?.close();await setup?.end();
  if(owned)await admin.query('DROP DATABASE village_unified_candidate WITH (FORCE)');
  if(roles)await admin.query('DROP ROLE IF EXISTS village_unified_login;DROP ROLE village_auth_runtime;DROP ROLE village_auth_migrator;DROP ROLE authenticated;DROP ROLE anon;DROP ROLE postgres');await admin.end();
 }
});
