const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let api; try { api = require('./deployment-mode.js'); } catch { api = {}; }
const origin = 'https://platform.example';
const config = {mode:'aliyun',stage:'candidate',instanceId:'aliyun-test',apiBase:'/api/v1',releaseId:'9575634'};
test('repository artifact remains source without deployment overrides', () => {
  assert.equal(typeof api.resolveDeployment, 'function');
  const context = {}; vm.runInNewContext(fs.readFileSync('deployment-config.js','utf8'), context);
  assert.equal(context.VILLAGE_DEPLOYMENT.mode, 'source');
  assert.equal(api.resolveDeployment(undefined, 'https://life-is-change.github.io').mode, 'source');
  assert.equal(api.resolveDeployment(context.VILLAGE_DEPLOYMENT, origin).mode, 'source');
});
test('deployment is immutable and ignores browser query or localStorage mode', () => {
  assert.equal(typeof api.resolveDeployment, 'function');
  const result = api.resolveDeployment(config, origin+'/?mode=source#source');
  assert.equal(result.mode,'aliyun'); assert.equal(result.apiBase,'/api/v1'); assert.equal(Object.isFrozen(result),true);
  assert.equal(api.resolveDeployment(undefined,origin+'/?mode=aliyun').mode,'source');
  assert.equal(config.mode,'aliyun');
});
test('public HTTP, cross origin endpoints, unknown deployment fields and invalid stages are refused', () => {
  assert.equal(typeof api.resolveDeployment,'function');
  for (const changed of [{mode:'unknown'},{stage:'production'},{apiBase:'https://evil.example/api/v1'},{apiBase:'//evil.example/api/v1'},{apiBase:'/api/v1?x=1'},{instanceId:'../source'},{secret:'bad'}]) {
    assert.throws(()=>api.resolveDeployment({...config,...changed},origin), /INVALID_DEPLOYMENT/);
  }
  assert.throws(()=>api.resolveDeployment(config,'http://8.148.248.237'),/HTTPS_REQUIRED/);
  for(const local of ['http://127.0.0.1:18085','http://localhost:18085','http://[::1]:18085'])assert.equal(api.resolveDeployment(config,local).mode,'aliyun');
  assert.throws(()=>api.resolveDeployment(config,'http://127.0.0.1.evil.example'),/HTTPS_REQUIRED/);
});
test('cache keys isolate instance, user, project and space without delimiter collisions', () => {
  assert.equal(typeof api.cacheKey,'function');
  const userId='10000000-0000-4000-8000-000000000001';
  const base={userId,teachingProjectId:'project',villageId:'village',spaceId:'space'};
  const source=api.resolveDeployment(undefined,origin), aliyun=api.resolveDeployment(config,origin);
  const values=[api.cacheKey(source,'draft',base), api.cacheKey(aliyun,'draft',base), api.cacheKey(aliyun,'draft',{...base,spaceId:'other'}),api.cacheKey(aliyun,'draft',{...base,userId:'20000000-0000-4000-8000-000000000002'})];
  assert.equal(new Set(values).size,4);
  assert.notEqual(api.cacheKey(aliyun,'draft',{...base,spaceId:'a:b',villageId:'c'}),api.cacheKey(aliyun,'draft',{...base,spaceId:'b',villageId:'c:a'}));
  assert.throws(()=>api.cacheKey(aliyun,'draft',{...base,userId:''}),/INVALID_CACHE_IDENTITY/);
});
