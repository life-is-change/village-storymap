const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function functions(first, next, name, sandbox) {
  sandbox.GenerationMode ||= require('./generation-mode.js');
  const guardStart = source.indexOf('function isCurrentFacadeRun(');
  if (guardStart >= 0) vm.runInNewContext(source.slice(guardStart, source.indexOf('async function applyFacadeRun(', guardStart)), sandbox);
  return vm.runInNewContext(source.slice(source.indexOf(first), source.indexOf(next, source.indexOf(first))) + ';' + name, sandbox);
}
function setupSubmit(overrides = {}) {
  const calls = { submitted: 0, attached: [], messages: [] };
  const queue = { findActiveRun: async () => null,
    submit: async () => { calls.submitted++; return 'new-run'; },
    getRun: async () => ({ id: 'new-run', status: 'queued_rectification' }), ...overrides };
  const sandbox = { state: { facadeQueue: queue, facadeContext: { courseId: 'C', spaceId: 'S' }, targetCode: 'H' },
    attachFacadeRun: async run => calls.attached.push(run),
    setStatus: message => calls.messages.push(message), console };
  return { sandbox, calls, submit: functions('async function submitFacadePhoto(', 'async function attachFacadeRun(', 'submitFacadePhoto', sandbox) };
}
test('rapid photo submissions share one request while the database reply is pending', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const { submit, calls } = setupSubmit({ submit: async () => { calls.submitted++; await gate; return 'new-run'; } });
  const first = submit({ id: 36 }), second = submit({ id: 37 });
  await tick(); release(); await Promise.all([first, second]);
  assert.equal(calls.submitted, 1);
  assert.equal(calls.attached.length, 1);
});
test('an unfinished task on this building is restored instead of submitting another photo', async () => {
  const old = { id: 'old-run', status: 'awaiting_crop', photo_id: 36 };
  const { submit, calls } = setupSubmit({ findActiveRun: async () => old });
  await submit({ id: 37 });
  assert.equal(calls.submitted, 0);
  assert.deepEqual(calls.attached, [old]);
  assert.match(calls.messages.join(' '), /已有.*任务|未结束/);
});
test('a successful submit is not reported as a failed submission when reading progress fails', async () => {
  const { submit, sandbox, calls } = setupSubmit({ getRun: async () => { throw new Error('network unavailable'); } });
  await assert.doesNotReject(submit({ id: 36 }));
  assert.equal(sandbox.state.photoJobId, 'new-run');
  assert.equal(calls.attached[0].id, 'new-run');
  assert.match(calls.messages.join(' '), /已.*队列/);
});
test('account task limit explains unfinished jobs and roof confirmation instead of a photo read error', async () => {
  const { submit } = setupSubmit({ submit: async () => { throw new Error('TOO_MANY_ACTIVE_FACADE_RUNS'); } });
  await assert.rejects(submit({ id: 36 }), /2.*未结束.*屋顶/);
});

test('unsupported existing footprint is rejected before worker lookup or photo processing',async()=>{
 const {submit,sandbox,calls}=setupSubmit();
 Object.assign(sandbox.state,{generationMethod:'components',modelPurpose:'existing',footprintRectangularity:.70});
 await assert.rejects(submit({id:47}),/占地|矩形/);assert.equal(calls.submitted,0);
});
function setupAttach(queue) {
  const applied = [], calls = { polls: 0 };
  const sandbox = { state: { facadeQueue: queue, photoJobId: '' }, renderPhotoServiceState() {},
    applyFacadeRun: async run => applied.push(run.id), scheduleFacadePoll: () => calls.polls++,
    clearFacadePollTimer() {}, setStatus() {}, console };
  return { sandbox, applied, calls, attach: functions('async function attachFacadeRun(', 'async function applyFacadeRun(', 'attachFacadeRun', sandbox) };
}
test('failed realtime subscription still displays the run and starts polling', async () => {
  const { attach, applied, calls } = setupAttach({ subscribe() { throw new Error('realtime unavailable'); } });
  await assert.doesNotReject(attach({ id: 'old-run', status: 'rectifying' }));
  assert.deepEqual(applied, ['old-run']);
  assert.equal(calls.polls, 1);
});
test('an event from a removed old run cannot replace the current run', async () => {
  const callbacks = [];
  const { attach, applied } = setupAttach({ subscribe(id, callback) { callbacks.push(callback); return () => {}; } });
  await attach({ id: 'old', status: 'rectifying' });
  await attach({ id: 'new', status: 'rectifying' });
  callbacks[0]({ new: { id: 'old', status: 'completed' } });
  await tick();
  assert.deepEqual(applied, ['old', 'new']);
});
test('duplicate context replies share initialization and late restoration cannot overwrite a new run', async () => {
  let release, lookups = 0, subscriptions = 0;
  const gate = new Promise(resolve => release = resolve);
  const sandbox = { state: { targetCode: 'H', targetSpace: 'S' },
    window: { location: {origin:'https://platform.test'}, opener: { location:{origin:'https://platform.test'}, VillageSupabaseClient: {} } },
    FacadeQueueClient: { createFacadeQueueClient: () => ({ getWorkerAvailability: async () => ({ available: true }),
      findActiveRun: async () => null, findLatestRun: async () => { lookups++; await gate; return { id: 'old', status: 'completed' }; } }) },
    FacadeCloudClient: { createFacadeCloudClient: () => ({}) },
    PhotoWorkflow: { shouldRestoreFacadeRun: () => true },
    refreshCloudCapability() {}, renderPhotoServiceState() {}, setStatus() {},
    attachFacadeRun: async () => subscriptions++, console };
  const init = functions('async function initializeFacadeQueue(', 'async function handleUploadedPhotoRecord(', 'initializeFacadeQueue', sandbox);
  const context = { sourceCode: 'H', courseId: 'C', spaceId: 'S', hasAuthenticatedSession: true };
  const first = init(context), second = init(context);
  await tick(); sandbox.state.photoJobId = 'new'; release(); await Promise.all([first, second]);
  assert.equal(lookups, 1);
  assert.equal(subscriptions, 0);
});

test('an already pending old poll cannot replace a newly attached task', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve), applied = [];
  const queue = { getRun: async () => { await gate; return { id: 'old', status: 'completed' }; },
    getWorkerAvailability: async () => ({ available: true }) };
  const sandbox = { state: { facadeQueue: queue, photoJobId: 'old', facadeRunRevision: 1, facadePollDelay: 2000 },
    document: {}, clearFacadePollTimer() {}, applyFacadeRun: async run => applied.push(run.id),
    scheduleFacadePoll() {}, renderPhotoServiceState() {}, console };
  const poll = functions('async function pollFacadeRun(', 'async function recoverCurrentPhoto(', 'pollFacadeRun', sandbox);
  const pending = poll();
  sandbox.state.photoJobId = 'new'; sandbox.state.facadeRunRevision++;
  release(); await pending;
  assert.deepEqual(applied, []);
});

test('completed task continues backing off until its downloadable model has loaded', async () => {
  let retries = 0;
  const sandbox = { state: { facadeQueue: { getRun: async () => ({ id: 'done', status: 'completed' }),
      getWorkerAvailability: async () => ({ available: true }) }, photoJobId: 'done', facadePollDelay: 2000,
      currentFacadeRun: { id: 'done', status: 'completed' }, facadeResultPending: true },
    document: {}, clearFacadePollTimer() {}, applyFacadeRun: async () => { throw new Error('GLB download temporarily unavailable'); },
    scheduleFacadePoll: () => retries++, renderPhotoServiceState() {}, console };
  const poll = functions('async function pollFacadeRun(', 'async function recoverCurrentPhoto(', 'pollFacadeRun', sandbox);
  await poll();
  assert.equal(retries, 1);
  sandbox.applyFacadeRun = async () => { sandbox.state.facadeResultPending = false; };
  await poll(); assert.equal(retries, 1);
});

test('an old preview completing after a task switch cannot change the current photo', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const queue = { createArtifactUrl: async () => 'old-preview' };
  const sandbox = { state: { facadeQueue: queue, photoJobId: 'old', facadeRunRevision: 1,
      currentFacadeRun: { id: 'old', status: 'awaiting_crop' } },
    facadeArtifact: async () => ({ storage_path: 'old-preview' }), loadImage: async () => { await gate; return {}; },
    els: { photoPreview: {}, photoPreviewEmpty: {}, roofCropShade: {}, roofCropHandle: {}, photoFallbackActions: {},
      roofTypeInput: {}, roofMaterialInput: {}, roofPitchInput: {}, activeLabel: {} },
    updateCropOverlay() {}, PhotoWorkflow: { normalizeRoofAnalysis: value => value }, renderRoofAnalysis() {} };
  const load = functions('async function loadRectifiedPreview(', 'async function loadCompletedFacadeModel(', 'loadRectifiedPreview', sandbox);
  const pending = load({ id: 'old', status: 'awaiting_crop' });
  await tick(); sandbox.state.photoJobId = 'new'; sandbox.state.facadeRunRevision++;
  release(); await pending;
  assert.equal(sandbox.els.photoPreview.src, undefined);
  assert.equal(sandbox.state.rectifiedUrl, undefined);
});

test('a preview not yet synchronized is pending instead of a processing failure',async()=>{
 const queue={},run={id:'waiting',status:'awaiting_crop'};
 const sandbox={state:{facadeQueue:queue,photoJobId:'waiting',facadeRunRevision:1,currentFacadeRun:run},facadeArtifact:async()=>null};
 const load=functions('async function loadRectifiedPreview(', 'async function loadCompletedFacadeModel(', 'loadRectifiedPreview',sandbox);
 assert.equal(await load(run),false);
});

test('result download failure cannot turn a responding Worker into a network outage',async()=>{
 const queue={getRun:async()=>({id:'r',status:'awaiting_crop'}),getWorkerAvailability:async()=>({available:true})};
 const sandbox={state:{facadeQueue:queue,photoJobId:'r',facadeRunRevision:1,facadePollDelay:2000,currentFacadeRun:{status:'awaiting_crop'}},
  document:{},clearFacadePollTimer(){},applyFacadeRun:async()=>{throw Error('preview download failed');},
  scheduleFacadePoll(){},renderPhotoServiceState(){},setStatus(){},console};
 const poll=functions('async function pollFacadeRun(', 'async function recoverCurrentPhoto(', 'pollFacadeRun',sandbox);
 await poll();assert.equal(sandbox.state.photoServiceStatus,'online');assert.equal(sandbox.state.facadeResultPending,true);
});

test('a completed model is displayed even when its optional photo preview is unavailable',async()=>{
 const run={id:'complete',status:'completed'},queue={};let models=0;
 const sandbox={state:{facadeQueue:queue,photoJobId:run.id,facadeRunRevision:1},
  PhotoWorkflow:{canConfirmCrop:()=>true,facadeStatusPresentation:()=>({terminal:true})},
  restoreGenerationMode(){},renderGenerationMode(){},setProgress(){},setStatus(){},renderFacadeStep(){},
  loadCompletedFacadeModel:async()=>{models++;},loadRectifiedPreview:async()=>{throw Error('preview unavailable');},
  els:{photoFallbackActions:{}},clearFacadePollTimer(){},console};
 const apply=functions('async function applyFacadeRun(', 'function renderFacadeStep(', 'applyFacadeRun',sandbox);
 await apply(run);assert.equal(models,1);assert.equal(sandbox.state.facadeResultPending,false);
});

test('an old completed GLB cannot apply after a new generation of the same run starts', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve), changes = [];
  const queue = { createArtifactUrl: async () => 'old-model' };
  const run = { id: 'same', status: 'completed', generation_revision: 1 };
  const sandbox = { state: { facadeQueue: queue, photoJobId: 'same', facadeRunRevision: 1, currentFacadeRun: run },
    facadeArtifact: async () => ({ storage_path: 'old-model' }),
    fetch: async () => ({ ok: true, blob: async () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) }),
    parseGlb: async () => { await gate; return { traverse() {} }; },
    clearCurrentUrl() {}, replaceModel: () => changes.push('old-model'), frameModel() {},
    URL: { createObjectURL: () => 'blob:old' }, PhotoWorkflow: { photoModelMetrics: () => ({}) },
    els: { lengthInput: { value: 10 }, widthInput: { value: 7 }, downloadBtn: { disabled: true },
      sendBtn: { disabled: true }, downloadLink: { replaceChildren() {} } },
    document: { createElement: () => ({}) }, setProgress() {}, setStatus: () => changes.push('completed-message'),
    buildGenerateCompleteMessage: () => 'completed' };
  const load = functions('async function loadCompletedFacadeModel(', 'function setFacadeSource(', 'loadCompletedFacadeModel', sandbox);
  const pending = load(run); await tick();
  sandbox.state.currentFacadeRun = { id: 'same', status: 'queued_generation', generation_revision: 2 };
  release(); await pending;
  assert.deepEqual(changes, []);
  assert.equal(sandbox.els.sendBtn.disabled, true);
});
