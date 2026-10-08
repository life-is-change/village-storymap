const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('group plan uses one resolved dataset in 2D and 3D', () => {
  const html = read('index.html');
  const app = read('app.js');
  const app3d = read('app-3d.js');
  assert.match(html, /features\/data\/group-plan-resolver\.js/);
  assert.match(app, /window\.__loadResolvedGroupPlan/);
  assert.match(app3d, /window\.__loadResolvedGroupPlan/);
  assert.match(app, /saveGroupPlanEditBatch/);
  assert.match(app, /spaceType\s*===\s*["']group_plan["'][\s\S]*?canEditGroupLayer\(layerKey\)/);
});

test('group plan realtime watches only the active space', () => {
  const app = read('app.js');
  const sql = read('supabase_SQL/Realtime Publication Setup.sql');
  assert.match(app, /filter:\s*`space_id=eq\.\$\{actualSpaceId\}`/);
  assert.match(app, /GROUP_PLAN_REALTIME_DELAY\s*=\s*(?:1\d\d|2[0-4]\d|250)/);
  assert.match(app, /group_baseline_updates/);
  assert.match(app, /group_baseline_conflicts/);
  assert.match(sql, /'group_baseline_updates'/);
  assert.match(sql, /'group_baseline_conflicts'/);
});

test('3D optional group GLB uses white-model fallback', () => {
  const app3d = read('app-3d.js');
  assert.match(app3d, /applyOptionalModelWithWhiteFallback/);
  assert.match(app3d, /primitive\.errorEvent\.addEventListener[\s\S]*?setEntityReplacementVisual\(entity, false, false\)/);
});
