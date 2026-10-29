const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

test('homepage entry opens the prepared village without requiring a legacy group space', async () => {
  const body = app.slice(app.indexOf('function ensurePlatformEntryController()'), app.indexOf('\nfunction enterCoursePlatform', app.indexOf('function ensurePlatformEntryController()')));
  let options, opened;
  const root = { PlatformEntryControllerModule: { createPlatformEntryController: deps => { options = deps; return {}; } } };
  const sandbox = { window: root, platformEntryController: null, openCoursePlanningWorkspace: async (...args) => { opened = args; } };
  // Remaining dependencies are lazy callbacks, evaluated only during real entry.
  vm.runInNewContext(body + ';ensurePlatformEntryController()', sandbox);
  await options.openWorkspace('2d', { id: 'lab-332', spaceId: null });
  assert.equal(opened[0], '2d');
  assert.equal(opened[1], null);
});

test('building redraws reuse style objects and invalidate selection, geometry and review changes', () => {
  const root = { ContourUtilsModule: { resolveContourValue: () => null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'map-style.js'), 'utf8'), { window: root });
  let allocations = 0, active = false, figureGround = false, revision = 0;
  class Style { constructor(value) { allocations++; Object.assign(this, value); } }
  class Value { constructor(value) { Object.assign(this, value); } }
  const properties = { layerKey: 'building' };
  const feature = { get: key => properties[key], getRevision: () => revision, getGeometry: () => ({ getType: () => 'Polygon' }) };
  const OL = { Style, Fill: Value, Stroke: Value };
  const deps = { getOL: () => OL,
    isActiveFeature: () => active, isHoveredFeature: () => false,
    getSelectedLayersForCurrentSpace: () => figureGround ? ['figureGround'] : ['building'], getContourLabelsVisible: () => false };
  const style = () => root.MapStyleModule.getOlFeatureStyle(deps, feature, 0.00001);
  const first = style();
  for (let i=0; i<1000; i++) assert.equal(style(), first);
  assert.equal(allocations, 1);
  active = true; const selected = style(); assert.notEqual(selected, first);
  assert.equal(selected.stroke.color, '#1565c0');
  revision++; assert.notEqual(style(), selected);
  active = false; figureGround = true; assert.equal(style().fill.color, '#000000');
  properties.surveyReviewVisual = { opacity: 0.25 };
  assert.equal(style().fill.color, 'rgba(0,0,0,0.25)');
});
