import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../src/database.mjs').catch(()=>({}));
test('one checked-out connection scopes identity and rolls back failures',async()=>{
 assert.equal(typeof m.createDatabase,'function','transaction wrapper missing');
 const calls=[];let discarded;
 const client={query:async(sql,args)=>{calls.push([sql,args]);return {rows:[]};},release:error=>{discarded=error;calls.push(['release']);}};
 const db=m.createDatabase({pool:{connect:async()=>client,end:async()=>{}}});
 const identity={userId:'10000000-0000-4000-8000-000000000001',role:'authenticated'};
 assert.equal(await db.withIdentity(identity,async c=>{assert.equal(c,client);return 42;}),42);
 assert.equal(calls[0][0],'BEGIN READ ONLY');assert.equal(calls.at(-2)[0],'COMMIT');assert.equal(calls.at(-1)[0],'release');
 assert.ok(calls.some(([sql,args])=>sql.includes('set_config')&&JSON.parse(args[0]).sub===identity.userId));
 calls.length=0;
 await assert.rejects(()=>db.withIdentity(identity,async()=>{throw Error('secret private row');}),{code:'DB_UNAVAILABLE'});
 assert.equal(calls.at(-2)[0],'ROLLBACK');assert.equal(discarded,undefined);
});
test('failed rollback destroys a pooled connection instead of reusing its identity',async()=>{
 assert.equal(typeof m.createDatabase,'function','transaction wrapper missing');
 let released;
 const db=m.createDatabase({pool:{connect:async()=>({query:async q=>{if(q==='ROLLBACK')throw Error('broken');},release:e=>released=e}),end:async()=>{}}});
 await assert.rejects(()=>db.withIdentity({userId:'10000000-0000-4000-8000-000000000001'},async()=>{throw Error('query failed');}),{code:'DB_UNAVAILABLE'});
 assert.ok(released instanceof Error);
});
