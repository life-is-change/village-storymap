const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/facade-cloud/index.ts'), 'utf8');
const client = fs.readFileSync(path.join(root, 'rural_house_generator/facade-cloud-client.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'rural_house_generator/index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase_SQL/Cloud Facade Provider Runs.sql'), 'utf8');

test('cloud facade credentials stay inside the server function', () => {
  assert.match(edge, /Deno\.env\.get\("DASHSCOPE_API_KEY"\)/);
  assert.doesNotMatch(client, /DASHSCOPE_API_KEY|Bearer\s+sk-/i);
  assert.doesNotMatch(html, /api.?key|sk-[a-z0-9]/i);
});

test('cloud run table is owner-readable but browser writes are revoked', () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /revoke insert, update, delete[^;]+from authenticated/i);
});

test('browser cloud client can only invoke capability, submit and poll actions', () => {
  assert.match(client, /getCapability/);
  assert.match(client, /submit/);
  assert.match(client, /poll/);
  assert.doesNotMatch(client, /maas\.aliyuncs\.com/);
});

test('Qwen Image 3.0 uses the documented submission and polling endpoints', () => {
  assert.match(edge, /services\/aigc\/multimodal-generation\/generation/);
  assert.match(edge, /\/tasks\/\$\{encodeURIComponent\(run\.provider_job_id\)\}/);
  assert.doesNotMatch(edge, /services\/aigc\/image-generation\/generation/);
});

test('cloud cost reporting is configured server-side instead of hard-coded in the browser', () => {
  assert.match(edge, /FACADE_CLOUD_ESTIMATED_COST_CNY/);
  assert.doesNotMatch(client, /estimatedCostCny\s*[:=]\s*0\.3/);
});
