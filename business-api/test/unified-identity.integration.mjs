import test from 'node:test';import assert from 'node:assert/strict';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';
let serviceAPI,dbAPI;try{serviceAPI=await import('../unified/identity.mjs');dbAPI=await import('../unified/database.mjs');}catch{serviceAPI={};}
test('new profiles respect native auth trigger, stable membership identity, role and irreversible local tombstones',async()=>{
 assert.equal(typeof serviceAPI.createIdentityService,'function');
 await withUnifiedFixture(async({setup,install,config})=>{
  // Reproduce the actual source trigger; local identity anchors cannot fire it.
  await setup.query("ALTER TABLE auth.users ADD raw_user_meta_data jsonb;CREATE FUNCTION public.synthetic_auth_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF new.raw_user_meta_data IS NULL THEN RAISE EXCEPTION 'valid student_id is required';END IF;RETURN new;END$$;CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.synthetic_auth_trigger()");
  await install();const db=dbAPI.createUnifiedDatabase(config),fresh='50000000-0000-4000-8000-000000000005';let sourceReads=0;
  const service=serviceAPI.createIdentityService({database:db,sourceProfileReader:async i=>{sourceReads++;return {id:i.userId,student_id:'fresh',display_name:'Fresh',role:'admin',gender:'',class_name:'',grade:''};}});
  try{
   const rows=await Promise.all(Array.from({length:4},()=>service.ensureProfile(testIdentity(fresh))));
   assert.ok(rows.every(r=>r.id===fresh&&r.role==='student'));assert.equal((await setup.query('SELECT count(*) n FROM profiles WHERE id=$1',[fresh])).rows[0].n,'1');
   assert.equal((await setup.query('SELECT count(*) n FROM auth.users WHERE id=$1',[fresh])).rows[0].n,'1');
   const updated=await service.updateProfile(testIdentity(),{displayName:'Renamed',className:''});assert.equal(updated.display_name,'Renamed');
   assert.equal((await setup.query("SELECT student_key FROM group_memberships WHERE group_id='group-a'")).rows[0].student_key,'a::Renamed');
   const before=(await setup.query('SELECT * FROM profiles WHERE id=$1',[USERS.teacher])).rows;
   await service.ensureProfile(testIdentity(USERS.teacher));assert.deepEqual((await setup.query('SELECT * FROM profiles WHERE id=$1',[USERS.teacher])).rows,before);
   await assert.rejects(service.disableLocalProfile(testIdentity(),USERS.other),{code:'FORBIDDEN'});
   await service.disableLocalProfile(testIdentity(USERS.admin),fresh);
   await assert.rejects(service.me(testIdentity(fresh)),{code:'PROFILE_DISABLED'});
   await assert.rejects(service.ensureProfile(testIdentity(fresh)),{code:'PROFILE_DISABLED'});
   assert.equal((await setup.query('SELECT count(*) n FROM auth.users')).rows[0].n,'5','local disable must not delete Auth');
   await assert.rejects(service.updateProfile(testIdentity(),{role:'admin'}),{code:'INVALID_INPUT'});
   assert.ok(sourceReads>=4);
  }finally{await db.close();}
 });
});
