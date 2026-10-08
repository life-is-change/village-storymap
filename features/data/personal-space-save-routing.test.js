const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const session = require('./feature-edit-session.js');

function loadSave(space, client = null) {
  const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const helperStart = app.indexOf('function isPersonalLayerVersionSpace(');
  const helper = helperStart < 0 ? '' : app.slice(helperStart, app.indexOf('\nfunction ', helperStart + 1));
  const start = app.indexOf('async function saveFeatureEditBatch(payload)');
  const depsStart = app.indexOf('function buildFeatureEditSessionDeps()');
  const depsSource = app.slice(depsStart, app.indexOf('\nfunction ', depsStart + 1));
  const calls = [];
  const supabaseClient = { rpc: async (name, args) => { calls.push({ name, args }); return { data: 'batch' }; } };
  const sandbox = {
    spaces: [space], coursePersonalSpace: null, personalSpaceClient: client,
    supabaseClient, currentSpaceId: space.id,
    activeVillageContext: { villageId: 'village', teachingProjectId: 'project' },
    getSpaceById: () => space, getCurrentSpace: () => space,
    isDualTrackPersonalSpace: () => true,
    getFeatureEditSessionModule: () => session,
  };
  const save = vm.runInNewContext(`${helper}\n${depsSource}\n${app.slice(start, app.indexOf('\nfunction summarizeFeatureChanges', start))}\nsaveFeatureEditBatch`, sandbox);
  return { save, calls };
}

for (const action of ['add', 'delete']) {
  test(`personal experience ${action} saves to planning features without a figure-ground client`, async () => {
    const { save, calls } = loadSave({ id: 'experience', actualSpaceId: 'experience', spaceType: 'practice_personal' });
    const result = await save({ spaceId: 'experience', changes: [{ action, layerKey: 'building', objectCode: 'B001' }] });
    assert.equal(result.success, true);
    assert.equal(calls[0].name, 'save_feature_edit_batch');
    assert.equal(calls[0].args.p_space_id, 'experience');
  });
}

test('produced personal layers use their versioned save interface', async () => {
  let savedSpace;
  const { save, calls } = loadSave({ id: 'figure', spaceType: 'practice_personal', personalLayerVersionSpace: true }, {
    saveEdits: async (id) => { savedSpace = id; }
  });
  assert.equal((await save({ spaceId: 'figure', changes: [] })).success, true);
  assert.equal(savedSpace, 'figure');
  assert.equal(calls.length, 0);
});
