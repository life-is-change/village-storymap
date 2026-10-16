import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import pg from 'pg';import {createDatabase} from '../src/database.mjs';
const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Disposable test cluster required');
const url=new URL(raw);if(url.hostname!=='127.0.0.1'||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable cluster only');
test('A four connections and B2 two connections coexist with separate constrained roles',async()=>{
 const admin=new pg.Client({connectionString:raw});await admin.connect();let a,b,setup;const name='village_pool_test_'+Date.now();
 try{
  await admin.query('CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN');await admin.query('CREATE DATABASE '+name);
  setup=new pg.Client({connectionString:raw.replace(/\/postgres$/,'/'+name)});await setup.connect();
  await setup.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
  await setup.query("CREATE ROLE village_api_login LOGIN NOINHERIT CONNECTION LIMIT 4 PASSWORD 'synthetic-a-only';GRANT authenticated TO village_api_login");
  const sql=await readFile(new URL('../../linux/sql/storage-read-role.sql',import.meta.url),'utf8');
  await setup.query(sql.replaceAll('village_copy',name));
  await setup.query("ALTER ROLE village_storage_read_login PASSWORD 'synthetic-b-only'");
  const common={host:url.hostname,port:Number(url.port),database:name};
  a=createDatabase({...common,user:'village_api_login',password:'synthetic-a-only'});b=createDatabase({...common,user:'village_storage_read_login',password:'synthetic-b-only',maxConnections:2});
  const pending=[];let release;const gate=new Promise(r=>release=r);let entered=0;let all;const ready=new Promise(r=>all=r);
  const hold=db=>db.withIdentity({userId:'10000000-0000-4000-8000-000000000001'},async c=>{
   await c.query('SELECT 1');entered++;if(entered===6)all();await gate;return true;
  });
  pending.push(...Array.from({length:4},()=>hold(a)),...Array.from({length:2},()=>hold(b)));
  let extra;
  try{
   await Promise.race([ready,Promise.all(pending)]);assert.equal(entered,6);
   extra=b.withIdentity({userId:'10000000-0000-4000-8000-000000000001'},async c=>{await c.query('SELECT 1');return 'completed';});
   assert.equal(await Promise.race([extra,new Promise(r=>setTimeout(()=>r('queued'),150))]),'queued');
  }finally{release();await Promise.allSettled(pending);if(extra)await extra.catch(()=>{});}
  assert.equal(await extra,'completed');
  assert.deepEqual((await setup.query("SELECT rolname,rolconnlimit FROM pg_roles WHERE rolname IN ('village_api_login','village_storage_read_login') ORDER BY rolname")).rows,[{rolname:'village_api_login',rolconnlimit:4},{rolname:'village_storage_read_login',rolconnlimit:2}]);
 }finally{
  await a?.close();await b?.close();await setup?.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS village_storage_read_login;DROP ROLE IF EXISTS village_api_login;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS anon');await admin.end();
 }
});
