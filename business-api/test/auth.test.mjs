import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../src/auth.mjs').catch(()=>({}));
const origin='https://rzmbmwauomzwiyenafha.supabase.co';
const uid='10000000-0000-4000-8000-000000000001';
const claims={sub:uid,iss:origin+'/auth/v1',aud:'authenticated',role:'authenticated',exp:2000};
const token=(changes={},header={alg:'HS256'})=>[header,{...claims,...changes},'signature'].map(x=>typeof x==='object'?Buffer.from(JSON.stringify(x)).toString('base64url'):x).join('.');
const good=async()=>Response.json({id:uid,user_metadata:{role:'admin'}});
function verifier(fetchImpl=good){assert.equal(typeof m.createIdentityVerifier,'function','identity verification missing');return m.createIdentityVerifier({authOrigin:origin,publishableKey:'public',fetchImpl,now:()=>1000000});}
test('online proof establishes user identity and ignores metadata role',async()=>{
  const identity=await verifier()('Bearer '+token());
  assert.equal(identity.userId,uid);assert.equal(identity.role,'authenticated');assert.equal(identity.expiry,2000);
  assert.equal(identity.appRole,undefined);assert.equal(identity.user_metadata,undefined);
});
test('bad headers and invalid token claims fail before remote verification',async()=>{
  for(const value of ['', 'Basic x','Bearer a,b','Bearer '+ 'a'.repeat(17000),'Bearer '+token({exp:999}),'Bearer '+token({exp:undefined}),'Bearer '+token({sub:'admin'}),'Bearer '+token({aud:'other'}),'Bearer '+token({role:'service_role'}),'Bearer '+token({iss:'https://other/auth/v1'}),'Bearer '+token({nbf:2000}),'Bearer '+token({}, {alg:'none'})]){
    await assert.rejects(()=>verifier(async()=>{throw Error('should not call upstream');})(value),{code:'UNAUTHORIZED',status:401});
  }
});
test('forgery upstream rejection mismatch and disabled identities are rejected',async()=>{
  for(const response of [()=>new Response('secret-token',{status:401}),()=>new Response('secret-token',{status:403}),()=>Response.json({id:'20000000-0000-4000-8000-000000000001'}),()=>Response.json({id:uid,banned_until:'2099-01-01T00:00:00Z'}),()=>Response.json({id:uid,deleted_at:'2020-01-01'})])
    await assert.rejects(()=>verifier(response)('Bearer '+token()),{code:'UNAUTHORIZED'});
});
test('auth outage and malformed upstream reply fail closed without leaking details',async()=>{
  for(const remote of [async()=>{throw Error('PASSWORD token=private');},async()=>new Response('private',{status:503}),async()=>new Response('private',{status:200})]){
    await assert.rejects(()=>verifier(remote)('Bearer '+token()),e=>e.code==='AUTH_UNAVAILABLE'&&!String(e).includes('private')&&!String(e).includes('PASSWORD'));
  }
});
