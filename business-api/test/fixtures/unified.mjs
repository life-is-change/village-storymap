import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const USERS={student:'10000000-0000-4000-8000-000000000001',other:'20000000-0000-4000-8000-000000000002',teacher:'30000000-0000-4000-8000-000000000003',admin:'40000000-0000-4000-8000-000000000004'};
export const TEST_DB='village_unified_candidate';
export const TEST_PASSWORD='synthetic-only-unified-00000000000';
export function testIdentity(userId=USERS.student){return {userId,issuer:'https://rzmbmwauomzwiyenafha.supabase.co/auth/v1',expiry:Math.floor(Date.now()/1000)+60};}
export function disposableURL(){const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Explicit disposable PG URL required; do not substitute a business database');const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable loopback test cluster only');return url;}
export async function withUnifiedFixture(fn,{prepareAuth,authCleanup}={}){
 const url=disposableURL(),admin=new pg.Client({connectionString:url.href});await admin.connect();let setup,owned=false,roles=false;
 try{
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[TEST_DB])).rowCount,0,'Never overwrite an existing candidate');
  assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname IN ('authenticated','anon','village_unified_login')")).rowCount,0,'Dedicated cluster must not contain pre-existing test roles');
  await admin.query('CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN');roles=true;await admin.query('CREATE DATABASE '+TEST_DB);owned=true;
  const target=new URL(url);target.pathname='/'+TEST_DB;setup=new pg.Client({connectionString:target.href});await setup.connect();
  await setup.query('CREATE SCHEMA extensions;CREATE EXTENSION postgis WITH SCHEMA extensions;SET search_path=public,extensions');
  assert.match((await setup.query('SELECT extensions.postgis_lib_version() version')).rows[0].version,/^3\./,'Actual native PostGIS required');
  if(prepareAuth)await prepareAuth({setup,url,target});
  let identity=await readFile(new URL('./identity.sql',import.meta.url),'utf8');
  if(prepareAuth)identity=identity.replace('CREATE SCHEMA auth;','').replace('CREATE FUNCTION auth.uid()','CREATE OR REPLACE FUNCTION auth.uid()');
  await setup.query(identity);
  const simpleAuth=prepareAuth?'':'CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);INSERT INTO auth.users(id) SELECT id FROM profiles;';
  await setup.query(`${simpleAuth}
    ALTER TABLE profiles ADD CONSTRAINT profiles_identity_fk FOREIGN KEY(id) REFERENCES auth.users(id);
    CREATE TABLE villages(id uuid PRIMARY KEY,name text,boundary extensions.geometry,status text);
    CREATE TABLE teaching_projects(id uuid PRIMARY KEY,course_id text REFERENCES courses,name text,stage text,practice_village_id uuid REFERENCES villages);
    INSERT INTO villages VALUES('b0000000-0000-4000-8000-000000000001','Synthetic',extensions.ST_GeomFromText('POLYGON((113 23,113.001 23,113.001 23.001,113 23.001,113 23))',4326),'published');
    INSERT INTO teaching_projects VALUES('a0000000-0000-4000-8000-000000000001','course','Existing current project','design','b0000000-0000-4000-8000-000000000001');
    CREATE FUNCTION public.test_unsafe_unified() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$SELECT 1$$;
    GRANT EXECUTE ON FUNCTION public.test_unsafe_unified() TO PUBLIC,authenticated;`);
  const foundation=await readFile(new URL('../../../supabase_SQL/Multi-Village Dual-Track Foundation.sql',import.meta.url),'utf8');
  const index=foundation.match(/create unique index if not exists teaching_projects_one_current_idx[\s\S]*?;/i)?.[0];assert.ok(index);await setup.query(index);
  const config={host:url.hostname,port:Number(url.port)||5432,database:TEST_DB,user:'village_unified_login',password:TEST_PASSWORD};
  await fn({admin,setup,url,config,install:async()=>{await setup.query(await readFile(new URL('../../../linux/sql/unified/identity.sql',import.meta.url),'utf8'));await setup.query("ALTER ROLE village_unified_login PASSWORD '"+TEST_PASSWORD+"'");}});
 }finally{
  await setup?.end();if(owned)await admin.query('DROP DATABASE '+TEST_DB+' WITH (FORCE)');
  if(roles)await admin.query('DROP ROLE IF EXISTS village_unified_login;DROP ROLE authenticated;DROP ROLE anon');
  if(authCleanup)await authCleanup(admin);await admin.end();
 }
}
