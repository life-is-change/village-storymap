const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('late completed-task restoration cannot undo an explicit generation-mode choice',async()=>{
 let restored=0;
 const queue={getWorkerAvailability:async()=>({available:true}),findActiveRun:async()=>null,
  findLatestRun:async()=>({id:'old',status:'completed'})};
 const s={state:{targetCode:'H1',targetSpace:'S1',generationModeEdited:true},
  window:{location:{origin:'https://platform.test'},opener:{location:{origin:'https://platform.test'},VillageSupabaseClient:{}}},
  FacadeQueueClient:{createFacadeQueueClient:()=>queue},FacadeCloudClient:{createFacadeCloudClient:()=>({})},
  PhotoWorkflow:{shouldRestoreFacadeRun:()=>true},refreshCloudCapability:async()=>{},renderPhotoServiceState(){},setStatus(){},
  attachFacadeRun:async()=>{restored++;},console};
 const start=source.indexOf('async function initializeFacadeQueue('),end=source.indexOf('async function handleUploadedPhotoRecord(',start);
 await vm.runInNewContext(source.slice(start,end)+';initializeFacadeQueue',s)({sourceCode:'H1',courseId:'C1',hasAuthenticatedSession:true});
 assert.equal(restored,0);
});

test('optional cloud capability cannot block the local 4090 availability check', async () => {
  let release, checked = 0;
  const cloud = new Promise(resolve => release = resolve);
  const s = {
    state: { targetCode: 'H1', targetSpace: 'S1' },
    window: { location: {origin:'https://platform.test'}, opener: { location:{origin:'https://platform.test'}, VillageSupabaseClient: {} } },
    FacadeQueueClient: { createFacadeQueueClient: () => ({
      getWorkerAvailability: async () => { checked++; return { available: true }; },
      findActiveRun: async () => null,
      findLatestRun: async () => null
    }) },
    FacadeCloudClient: { createFacadeCloudClient: () => ({}) },
    PhotoWorkflow: { shouldRestoreFacadeRun: () => false },
    refreshCloudCapability: async () => { await cloud; },
    renderPhotoServiceState() {}, setStatus() {}, console
  };
  const start = source.indexOf('async function initializeFacadeQueue(');
  const end = source.indexOf('async function handleUploadedPhotoRecord(', start);
  const init = vm.runInNewContext(source.slice(start, end) + ';initializeFacadeQueue', s);
  const pending = init({ sourceCode: 'H1', courseId: 'C1', hasAuthenticatedSession: true });
  await tick(); const checksBeforeCloud = checked;
  release(); await pending;
  assert.equal(checksBeforeCloud, 1);
  assert.equal(s.state.photoServiceStatus, 'online');
});

test('connection message distinguishes missing platform session from offline worker and query failure', () => {
  const start = source.indexOf('function renderPhotoServiceState('), end = source.indexOf('async function pollFacadeRun(', start);
  const s = { state: { photoServiceStatus: 'offline', facadeQueue: {} },
    els: { photoServiceState: { dataset: {} }, photoServiceMessage: {}, recoverPhotoBtn: {} } };
  const render = vm.runInNewContext(source.slice(start, end) + ';renderPhotoServiceState', s);
  render(); assert.match(s.els.photoServiceMessage.textContent, /立面.*离线|立面.*未报告在线/);
  s.state.facadeQueue = null; render(); assert.match(s.els.photoServiceMessage.textContent, /登录会话/);
  s.state.facadeQueue = {}; s.state.photoServiceStatus = 'error'; render();
  assert.match(s.els.photoServiceMessage.textContent, /查询.*失败|状态.*失败/);
});

test('late cloud capability updates upload controls without resetting the active job message', async () => {
  let changed = 0;
  const s = { state: { photoJobId: 'job', facadeSource: 'cloud_api', cloudCapability: { available: false },
      cloudClient: { getCapability: async () => ({ available: true }) } },
    FacadeSourceMode: require('./facade-source-mode'),
    els: { cloudCapabilityLabel: {}, cloudSourceMessage: {}, sourceButtons: [], sourcePanels: [],
      photoUploadHint: {}, photoInput: { disabled: true }, generateBtn: {}, configHint: {}, activeLabel: {} },
    setStatus: () => changed++, renderPhotoServiceState() {}, renderGenerationMode() {}, console };
  const start = source.indexOf('function setFacadeSource('), end = source.indexOf('async function submitCloudFacade(', start);
  await vm.runInNewContext(source.slice(start, end) + ';refreshCloudCapability', s)();
  assert.equal(changed, 0);
  assert.equal(s.els.photoInput.disabled, false);
});
