import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/contracts.mjs').catch(() => ({}));
test('query bounds reject ambiguous and unsupported requests', () => {
  assert.equal(typeof api.parseSpaceQuery, 'function', 'query contract is missing');
  assert.deepEqual(api.parseSpaceQuery(new URLSearchParams()), {kind:'group',limit:50,offset:0});
  for (const limit of [1,100]) assert.equal(api.parseSpaceQuery(new URLSearchParams({limit})).limit,limit);
  for (const q of ['limit=0','limit=101','limit=NaN','limit=1&limit=2','kind=all','table=profiles','offset=-1','offset=10001','limit=1e1']) {
    assert.throws(() => api.parseSpaceQuery(new URLSearchParams(q)),{code:'INVALID_INPUT'});
  }
});
test('IDs preserve case while refusing unsafe paths and wrong personal IDs', () => {
  assert.equal(typeof api.parseSpaceId, 'function', 'ID contract is missing');
  assert.equal(api.parseSpaceId('group','Group-A'), 'Group-A');
  assert.equal(api.parseSpaceId('personal','AE000000-0000-4000-8000-000000000001'),'AE000000-0000-4000-8000-000000000001');
  for (const [k,id] of [['personal','not-uuid'],['group',''],['group','../etc'],['group','a'.repeat(201)],['other','id']]) assert.throws(()=>api.parseSpaceId(k,id));
});
test('public errors never include upstream details', () => {
  assert.equal(typeof api.publicError, 'function', 'public error contract is missing');
  assert.deepEqual(api.publicError('DB_UNAVAILABLE','request-1'),{error:{code:'DB_UNAVAILABLE',requestId:'request-1'}});
});
