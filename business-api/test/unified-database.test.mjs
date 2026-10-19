import test from 'node:test';
import assert from 'node:assert/strict';
let api;try{api=await import('../unified/database.mjs');}catch{api={};}
const identity=()=>({userId:'10000000-0000-4000-8000-000000000001',issuer:'https://rzmbmwauomzwiyenafha.supabase.co/auth/v1',expiry:Math.floor(Date.now()/1000)+60});
function fake({status='active',rollbackFails=false}={}){
 const calls=[];let ended=0;const c={async query(sql,args){calls.push([sql,args]);if(sql==='ROLLBACK'&&rollbackFails)throw Error('private password failure');return {rows:sql.includes('profile_status')?[{status}]:[]};},release(discard){calls.push(['release',discard]);}};
 return {calls,pool:{options:{max:4},on(){},connect:async()=>c,end:async()=>{ended++;}},ended:()=>ended};
}
test('unified pool has one fixed four-connection budget and ignores no extra connection overrides',()=>{
 assert.equal(typeof api.poolOptions,'function');
 const config={host:'db',port:5432,database:'village_unified_candidate',user:'village_unified_login',password:'synthetic-only-unified-00000000000'};
 const options=api.poolOptions(config);
 assert.equal(options.max,4);assert.equal(options.connectionTimeoutMillis,3000);
 for(const change of [{max:99},{database:'postgres'},{user:'postgres'},{connectionString:'postgres://evil/db'}])assert.throws(()=>api.poolOptions({...config,...change}),/INVALID_CONFIGURATION/);
 assert.throws(()=>api.createUnifiedDatabase({pool:{...fake().pool,options:{max:20}}}),/INVALID_CONFIGURATION/);
});
test('identity transaction commits and resets claimed identity using local transaction state',async()=>{
 assert.equal(typeof api.createUnifiedDatabase,'function');const h=fake(),db=api.createUnifiedDatabase({pool:h.pool});
 assert.equal(await db.withIdentity(identity(),async c=>{await c.query('SELECT synthetic');return 'ok';},{readOnly:true}),'ok');
 assert.equal(h.calls[0][0],'BEGIN READ ONLY');assert.ok(h.calls.some(([s])=>s==='SET LOCAL ROLE authenticated'));
 const claims=h.calls.find(([s])=>s.includes('request.jwt.claims'))[1];assert.equal(JSON.parse(claims[0]).sub,identity().userId);
 assert.deepEqual(h.calls.slice(-2).map(([s])=>s),['COMMIT','release']);
 await db.close();await db.close();assert.equal(h.ended(),1);
});
test('unknown and disabled profiles fail closed and rollback without private SQL details',async()=>{
 assert.equal(typeof api.createUnifiedDatabase,'function');
 for(const [status,code] of [['missing','PROFILE_NOT_SYNCED'],['disabled','PROFILE_DISABLED']]){
  const h=fake({status}),db=api.createUnifiedDatabase({pool:h.pool});let called=false;
  await assert.rejects(db.withIdentity(identity(),()=>{called=true;}),{code});assert.equal(called,false);assert.ok(h.calls.some(([s])=>s==='ROLLBACK'));await db.close();
 }
 const h=fake({rollbackFails:true}),db=api.createUnifiedDatabase({pool:h.pool});
 await assert.rejects(db.withIdentity(identity(),()=>{throw Error('private SQL and credentials');}),e=>e.code==='DB_UNAVAILABLE'&&!e.message.includes('private'));
 assert.ok(h.calls.at(-1)[1] instanceof Error);await db.close();
});
test('expired, malformed and foreign identities never borrow a database connection',async()=>{
 assert.equal(typeof api.createUnifiedDatabase,'function');const h=fake(),db=api.createUnifiedDatabase({pool:h.pool});
 for(const bad of [null,undefined,{...identity(),expiry:0},{...identity(),userId:'invalid'},{...identity(),issuer:'https://evil.example'}])await assert.rejects(db.withIdentity(bad,()=>{}),{code:'UNAUTHORIZED'});
 assert.equal(h.calls.length,0);await db.close();
});
test('expiration during a mutation rolls the transaction back rather than committing',async()=>{
 assert.equal(typeof api.createUnifiedDatabase,'function');let now=100000;const h=fake(),db=api.createUnifiedDatabase({pool:h.pool,now:()=>now});
 await assert.rejects(db.withIdentity({...identity(),expiry:101},async()=>{now=102000;}),{code:'UNAUTHORIZED'});
 assert.equal(h.calls.some(([s])=>s==='COMMIT'),false);assert.ok(h.calls.some(([s])=>s==='ROLLBACK'));await db.close();
});

test('known restored RPC and constraint failures are sanitized into business errors',async()=>{
 for(const [error,code] of [[{code:'P0001',message:'PERSONAL_LAYER_VERSION_STALE'},'REVISION_CONFLICT'],[{code:'P0001',message:'BASELINE_VERSION_CONFLICT'},'REVISION_CONFLICT'],[{code:'P0001',message:'FEATURE_REVISION_CONFLICT'},'REVISION_CONFLICT'],[{code:'P0001',message:'CURRENT_VERSION_DELETE_FORBIDDEN'},'FORBIDDEN'],[{code:'P0001',message:'FEATURE_LOCK_REQUIRED'},'FORBIDDEN'],[{code:'P0001',message:'GEOMETRY_REVISION_CONFLICT'},'REVISION_CONFLICT'],[{code:'P0001',message:'VILLAGE_IN_USE'},'FORBIDDEN'],[{code:'23505',message:'private index detail'},'REVISION_CONFLICT'],[{code:'23503',message:'private foreign key detail'},'INVALID_INPUT']]){
  const h=fake(),db=api.createUnifiedDatabase({pool:h.pool});await assert.rejects(db.withIdentity(identity(),()=>{throw error;}),e=>e.code===code&&!e.message.includes('private'));await db.close();
 }
});
