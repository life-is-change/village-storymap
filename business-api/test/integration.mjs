import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createDatabase} from '../src/database.mjs';
import * as repository from '../src/repository.mjs';
const raw=process.env.VILLAGE_TEST_PG_URL;
if(!raw)throw Error('Set VILLAGE_TEST_PG_URL for an explicitly disposable loopback PostgreSQL test cluster');
const url=new URL(raw);
if(!['127.0.0.1','localhost'].includes(url.hostname)||decodeURIComponent(url.username)!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Refusing non-disposable test cluster');
test('real PG RLS isolation, role reset, read-only enforcement and source group policy',async()=>{
 const admin=new pg.Client({connectionString:raw});await admin.connect();
 const name='village_api_test_'+Date.now();let db;
 try{
  await admin.query("CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN");
  await admin.query('CREATE DATABASE '+name);
  const setup=new pg.Client({connectionString:raw.replace(/\/postgres$/, '/'+name)});await setup.connect();
  try{
   await setup.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
   await setup.query(await readFile(new URL('../../supabase_SQL/Secure Planning Space Visibility.sql',import.meta.url),'utf8'));
   // Use the exact deployment role SQL; this named disposable test DB is the only guard override.
   const sql=(await readFile(new URL('../../linux/sql/business-api-validation.sql',import.meta.url),'utf8')).replaceAll('village_copy',name);
   await setup.query(sql);
   await setup.query("ALTER ROLE village_api_login PASSWORD 'synthetic-only-test-password-0123456789'");
  }finally{await setup.end();}
  db=createDatabase({host:url.hostname,port:Number(url.port),database:name,user:'village_api_login',password:'synthetic-only-test-password-0123456789'});
  const ids=['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004'];
  for(const [i,userId] of ids.entries())await db.withIdentity({userId},async c=>{
   assert.equal((await repository.getMe(c,userId)).id,userId);
   const groups=await repository.listSpaces(c,{kind:'group',limit:100,offset:0},userId);
   assert.deepEqual(groups.map(x=>x.id),i===0?['A']:i===1?[]:['A','B']);
   const own=await repository.listSpaces(c,{kind:'personal',limit:100,offset:0},userId);
   assert.deepEqual(own.map(x=>x.title),i===0?['A']:i===1?['B']:[]);
   if(i===0)assert.equal(await repository.getSpace(c,'personal','b0000000-0000-4000-8000-000000000002',userId),null);
  });
  await assert.rejects(()=>db.withIdentity({userId:ids[0]},c=>c.query("UPDATE profiles SET role='admin'")),{code:'DB_UNAVAILABLE'});
  await assert.rejects(()=>db.withIdentity({userId:'50000000-0000-4000-8000-000000000005'},c=>repository.getMe(c,'50000000-0000-4000-8000-000000000005')),{code:'PROFILE_NOT_SYNCED'});
  await db.withIdentity({userId:ids[1]},async c=>assert.equal((await c.query('SELECT auth.uid() id')).rows[0].id,ids[1]));
 }finally{
  await db?.close();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS village_api_login');await admin.query('DROP ROLE IF EXISTS authenticated');await admin.query('DROP ROLE IF EXISTS anon');await admin.end();
 }
});
