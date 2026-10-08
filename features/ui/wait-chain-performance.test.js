const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCourseWorkbench } = require('./course-workbench.js');
const app = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Cesium runtime, widgets and workers share pinned local base', () => {
  const body = app.slice(app.indexOf('async function ensureVillage3DLoaded()'), app.indexOf('\nfunction getSceneStudioActiveView()'));
  assert.match(body, /CESIUM_BASE_URL\s*=\s*["']assets\/vendor\/cesium-1\.118\.0\/["']/);
  assert.match(body, /assets\/vendor\/cesium-1\.118\.0\/Cesium\.js/);
  assert.doesNotMatch(body, /cesium\.com|cdn\.jsdelivr/);
  assert.ok(fs.existsSync(path.join(__dirname, '../../assets/vendor/cesium-1.118.0/Workers/createPolygonOutlineGeometry.js')));
});

test('parallel course refreshes share remote load and propagate failure; later refresh is fresh', async () => {
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const workbench = createCourseWorkbench({ service: { loadContext: async () => {
    calls++; await pending; return { progress: { completedTaskIds: [] } };
  } } });
  const first = workbench.refresh(), second = workbench.refresh();
  await tick(); assert.equal(calls, 1);
  release(); await Promise.all([first, second]);
  await workbench.refresh(); assert.equal(calls, 2);
});

test('course refresh failure is retryable and a different account never reuses pending context', async () => {
  let actor = { name: 'old' }, fail = true, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const workbench = createCourseWorkbench({ getUser: () => actor, service: { loadContext: async user => {
    if (fail) throw Error('offline');
    if (user.name === 'old') await blocked;
    return { user, progress: { completedTaskIds: [] } };
  } } });
  await assert.rejects(workbench.refresh(), /offline/);
  fail = false;
  const previous = workbench.refresh();
  actor = { name: 'new' }; await workbench.refresh();
  release(); await previous;
  assert.equal(workbench.getContext().user.name, 'new');
});

test('studio bridge carries prepared viewer only to this opening, not later scopes', async () => {
  const Bridge = require('../../3D_scenes_edit/integration/platform-bridge.js');
  const runtime = [], prepared3D = {};
  const state = { activeView: 'plan', user: { id: 'admin' }, role: 'admin', group: null,
    space: { id: 'shared' }, teachingProjectId: 'project', courseId: 'course', villageId: 'mibu' };
  const bridge = Bridge.createPlatformBridge({ mount: {}, readState: () => state,
    buildOptions: (context, options) => { runtime.push(options); return {}; },
    studioApi: { create: async () => ({ ok: true, dispose() {} }) }
  });
  assert.equal((await bridge.open(undefined, { prepared3D })).ok, true);
  assert.equal(runtime[0].prepared3D, prepared3D);
  bridge.close(); state.villageId = 'hongxing';
  assert.equal((await bridge.open()).ok, true);
  assert.equal(runtime[1].prepared3D, undefined);
});

test('village commit draws complete map while course refresh is pending, and waits for both', async () => {
  let release; const course = new Promise(resolve => { release = resolve; });
  const events = [];
  const sandbox = {
    activeVillageContext: {}, window: {}, spaces: [], currentSpaceId: '', lastPlanningSpaceId: '',
    localStorage: { setItem() {} }, getAccountStorageKey: x => x, broadcastHomepageContext() {},
    applyVillageDatasetToPlanMap: async () => {}, sync2DSpaceStateTo3D() {}, renderSpaceList() {},
    courseWorkbench: { refresh: async () => { events.push('course'); await course; } },
    initializeCoursePersonalSpace: async () => null,
    planMap: {}, plan2dView: { classList: { contains: () => true } }, platformEntryController: null,
    refresh2DOverlay: async () => { events.push('map'); },
    document: { getElementById: () => null }, console
  };
  const body = app.slice(app.indexOf('async function commitVillageContext('), app.indexOf('\nfunction startVillageProjectContextLoad('));
  const run = vm.runInNewContext(`${body}; commitVillageContext`, sandbox)({ spaceId: 'new', spaces: [] });
  let done = false; run.then(() => { done = true; });
  await tick(); assert.deepEqual(events, ['course', 'map']); assert.equal(done, false);
  release(); await run; assert.equal(done, true);
});

