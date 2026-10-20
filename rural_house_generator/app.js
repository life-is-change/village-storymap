import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PhotoWorkflow = window.PhotoWorkflow;
const PhotoMaterialBridge = window.PhotoMaterialBridge;
const FacadeQueueClient = window.FacadeQueueClient;
const FacadeSourceMode = window.FacadeSourceMode;
const FacadeCloudClient = window.FacadeCloudClient;

const els = {
  sourceButtons: document.querySelectorAll('[data-facade-source]'),
  sourcePanels: document.querySelectorAll('[data-source-panel]'),
  cloudCapabilityLabel: document.getElementById('cloudCapabilityLabel'),
  cloudSourceMessage: document.getElementById('cloudSourceMessage'),
  photoUploadHint: document.getElementById('photoUploadHint'),
  photoSection: document.getElementById('photoSection'),
  existingPhotoMaterials: document.getElementById('existingPhotoMaterials'),
  existingPhotoMaterialState: document.getElementById('existingPhotoMaterialState'),
  existingPhotoMaterialList: document.getElementById('existingPhotoMaterialList'),
  photoInput: document.getElementById('photoInput'),
  photoPreview: document.getElementById('photoPreview'),
  photoPreviewEmpty: document.getElementById('photoPreviewEmpty'),
  roofCropShade: document.getElementById('roofCropShade'),
  roofCropHandle: document.getElementById('roofCropHandle'),
  roofTypeInput: document.getElementById('roofTypeInput'),
  roofMaterialInput: document.getElementById('roofMaterialInput'),
  roofPitchInput: document.getElementById('roofPitchInput'),
  roofAnalysisSummary: document.getElementById('roofAnalysisSummary'),
  roofAdvanced: document.getElementById('roofAdvanced'),
  photoServiceState: document.getElementById('photoServiceState'),
  photoServiceMessage: document.getElementById('photoServiceMessage'),
  recoverPhotoBtn: document.getElementById('recoverPhotoBtn'),
  photoGenerateBtn: document.getElementById('photoGenerateBtn'),
  photoSteps: document.getElementById('photoSteps'),
  photoFallbackActions: document.getElementById('photoFallbackActions'),
  useOriginalBtn: document.getElementById('useOriginalBtn'),
  retryPhotoBtn: document.getElementById('retryPhotoBtn'),
  correctionPrompt: document.getElementById('correctionPrompt'),
  copyPromptBtn: document.getElementById('copyPromptBtn'),
  configHint: document.getElementById('configHint'),
  lengthInput: document.getElementById('lengthInput'),
  widthInput: document.getElementById('widthInput'),
  photoHeightSummary: document.getElementById('photoHeightSummary'),
  generateBtn: document.getElementById('generateBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  sendBtn: document.getElementById('sendBtn'),
  statusText: document.getElementById('statusText'),
  progressFill: document.getElementById('progressFill'),
  downloadLink: document.getElementById('downloadLink'),
  viewer: document.getElementById('viewer'),
  activeLabel: document.getElementById('activeLabel')
};

const state = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  sun: null,
  previewLoop: null,
  qualityUnsubscribe: null,
  currentGroup: null,
  currentBlob: null,
  currentUrl: null,
  currentModelInfo: null,
  facadeSource: 'local_worker',
  photoFile: null,
  photoUrl: null,
  rectifiedUrl: null,
  photoJobId: '',
  photoImage: null,
  cropTop: 0.12,
  draggingCropTop: false,
  photoWorkflowState: 'idle',
  photoServiceStatus: 'checking',
  photoServiceTimer: null,
  photoServicePendingPhoto: false,
  photoRecoveryPromise: null,
  roofAnalysis: null,
  roofAnalysisStatus: 'idle',
  roofAnalysisRevision: 0,
  roofOverrides: {},
  roofAnalysisTimer: null,
  roofAnalysisAbortController: null,
  targetCode: '',
  targetSpace: 'current',
  targetName: '',
  targetDimensions: null,
  photoMaterials: [],
  photoMaterialsStatus: 'loading',
  selectedPhotoId: '',
  facadeContext: null,
  facadeQueue: null,
  currentFacadeRun: null,
  facadeUnsubscribe: null,
  facadePollTimer: null,
  facadePollDelay: 2000,
  facadeInitializationPromise: null,
  facadeInitializationKey: '',
  facadeInitializationClient: null,
  facadeSubmissionPromise: null,
  facadeRunRevision: 0,
  facadeResultPending: false,
  photoSelectionPending: false,
  cloudClient: null,
  cloudCapability: { available: false },
  cloudRunId: '',
  cloudPollTimer: null,
  pendingCloudResultUpload: false
};

init();

async function init() {
  if (!PhotoWorkflow) throw new Error('photo-workflow.js 加载失败');
  if (!PhotoMaterialBridge) throw new Error('photo-material-bridge.js 加载失败');
  if (!FacadeQueueClient) throw new Error('facade-queue-client.js 加载失败');
  if (!FacadeSourceMode) throw new Error('facade-source-mode.js 加载失败');
  if (!FacadeCloudClient) throw new Error('facade-cloud-client.js 加载失败');
  parseTargetParams();
  initThree();
  bindEvents();
  els.correctionPrompt.value = PhotoWorkflow.CORRECTION_PROMPT;
  setFacadeSource(FacadeSourceMode.sourceFromParams(new URLSearchParams(window.location.search)));
  els.lengthInput.value = formatInputDimension(state.targetDimensions?.length || 10);
  els.widthInput.value = formatInputDimension(state.targetDimensions?.depth || 7);
  requestExistingPhotoMaterials();
}

function parseTargetParams() {
  const params = new URLSearchParams(window.location.search);
  state.targetCode = String(params.get('targetCode') || '').trim();
  state.targetSpace = String(params.get('targetSpace') || 'current').trim() || 'current';
  state.targetName = String(params.get('targetName') || '').trim();
  state.targetDimensions = PhotoWorkflow.readTargetDimensions(params);
}

function bindEvents() {
  els.sourceButtons.forEach((button) => button.addEventListener('click', () => {
    setFacadeSource(button.dataset.facadeSource);
  }));
  els.photoInput.addEventListener('change', handlePhotoFiles);
  window.addEventListener('message', handleFacadeBridgeMessage);
  els.copyPromptBtn.addEventListener('click', copyCorrectionPrompt);
  els.roofCropHandle.addEventListener('pointerdown', startRoofCropDrag);
  els.roofCropHandle.addEventListener('pointermove', moveRoofCropDrag);
  els.roofCropHandle.addEventListener('pointerup', stopRoofCropDrag);
  els.roofCropHandle.addEventListener('pointercancel', stopRoofCropDrag);
  els.roofCropHandle.addEventListener('keydown', adjustRoofCropWithKeyboard);
  els.roofTypeInput.addEventListener('change', () => setRoofOverride('roofType', els.roofTypeInput.value));
  els.roofMaterialInput.addEventListener('change', () => setRoofOverride('roofMaterial', els.roofMaterialInput.value));
  els.roofPitchInput.addEventListener('change', () => setRoofOverride('roofPitch', els.roofPitchInput.value));
  els.photoGenerateBtn.addEventListener('click', generatePhotoModel);
  els.useOriginalBtn.addEventListener('click', useOriginalPhoto);
  els.retryPhotoBtn.addEventListener('click', () => {
    els.photoInput.value = '';
    els.photoInput.click();
  });
  els.recoverPhotoBtn.addEventListener('click', recoverCurrentPhoto);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearFacadePollTimer();
    else if (state.currentFacadeRun) scheduleFacadePoll(0);
  });
  els.generateBtn.addEventListener('click', generatePhotoModel);
  els.downloadBtn.addEventListener('click', downloadGlb);
  els.sendBtn.addEventListener('click', replaceOriginalBuilding);
  window.addEventListener('pagehide', () => {
    clearFacadePollTimer();
    state.facadeRunRevision += 1;
    state.facadeUnsubscribe?.();
    state.facadeUnsubscribe = null;
  });
}

function requestExistingPhotoMaterials() {
  if (!state.targetCode) {
    state.photoMaterialsStatus = 'empty';
    renderExistingPhotoMaterials('未关联具体建筑，可上传新照片');
    return;
  }
  if (!window.opener || window.opener.closed) {
    state.photoMaterialsStatus = 'unavailable';
    renderExistingPhotoMaterials('请从平台中的建筑打开生成器');
    return;
  }
  state.photoMaterialsStatus = 'loading';
  renderExistingPhotoMaterials('正在读取当前建筑的照片…');
  window.opener.postMessage({
    type: PhotoMaterialBridge.REQUEST_TYPE,
    payload: { sourceCode: state.targetCode, spaceId: state.targetSpace }
  }, window.location.origin);
  window.opener.postMessage({
    type: PhotoMaterialBridge.CONTEXT_TYPE,
    payload: { sourceCode: state.targetCode, spaceId: state.targetSpace }
  }, window.location.origin);
}

function handleFacadeBridgeMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.opener) return;
  const message = event.data;
  if (!message) return;
  if (message.type === PhotoMaterialBridge.CONTEXT_TYPE) {
    void initializeFacadeQueue(message.payload || {});
    return;
  }
  if (message.type === PhotoMaterialBridge.UPLOAD_RESPONSE_TYPE) {
    void handleUploadedPhotoRecord(message.payload || {});
    return;
  }
  if (message.type !== PhotoMaterialBridge.RESPONSE_TYPE) return;
  const payload = message.payload || {};
  if (String(payload.sourceCode || '').trim() !== state.targetCode) return;
  if (payload.error) {
    state.photoMaterialsStatus = 'error';
    renderExistingPhotoMaterials(`读取失败，可继续上传新照片：${payload.error}`, true);
    return;
  }
  state.photoMaterials = PhotoMaterialBridge.normalizePhotoMaterials(payload.photos);
  const selected = PhotoWorkflow.chooseDefaultHistoricalPhoto(
    state.photoMaterials,
    state.selectedPhotoId
  );
  state.selectedPhotoId = selected?.id || '';
  state.photoMaterialsStatus = state.photoMaterials.length ? 'ready' : 'empty';
  renderExistingPhotoMaterials(state.photoMaterials.length
    ? `找到 ${state.photoMaterials.length} 张，可直接选用`
    : '当前建筑还没有照片，可上传新照片');
}

function renderExistingPhotoMaterials(message, isError = false) {
  els.existingPhotoMaterialState.textContent = message;
  els.existingPhotoMaterialState.dataset.tone = isError ? 'error' : '';
  els.existingPhotoMaterialList.replaceChildren();
  if (!state.photoMaterials.length || state.photoMaterialsStatus !== 'ready') {
    els.existingPhotoMaterialList.hidden = true;
    return;
  }

  state.photoMaterials.forEach((photo) => {
    const card = document.createElement('article');
    card.className = `existing-photo-card ${photo.id === state.selectedPhotoId ? 'is-selected' : ''}`;
    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = '已有建筑照片';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    const footer = document.createElement('footer');
    const meta = document.createElement('small');
    meta.textContent = photo.uploadedBy ? `上传者：${photo.uploadedBy}` : '已上传素材';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '使用这张';
    button.disabled = Boolean(state.photoSelectionPending);
    button.addEventListener('click', () => useExistingPhotoMaterial(photo, button));
    image.addEventListener('error', () => {
      card.classList.add('is-missing');
      image.hidden = true;
      button.disabled = true;
      button.textContent = '原图已丢失';
      meta.textContent = '原图文件已丢失，请返回平台重新上传或删除该记录';
    }, { once: true });
    footer.append(meta, button);
    card.append(image, footer);
    els.existingPhotoMaterialList.append(card);
  });
  els.existingPhotoMaterialList.hidden = false;
}

async function useExistingPhotoMaterial(photo, button) {
  if (state.photoSelectionPending) return;
  state.photoSelectionPending = true;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = '提交中…';
  setStatus('正在把已有建筑照片提交到 4090 队列…');
  try {
    if (!PhotoMaterialBridge.isQueueablePhoto(photo)) throw new Error('该历史照片缺少稳定的数据库 ID');
    state.selectedPhotoId = photo.id;
    renderExistingPhotoMaterials(`已选择照片 ${photo.id}`);
    await processPhotoRecord(photo);
  } catch (error) {
    console.error('提交已有建筑照片失败：', error);
    setStatus(`已有照片提交失败：${error.message}`, true);
  } finally {
    state.photoSelectionPending = false;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = '使用这张';
    renderExistingPhotoMaterials(`已选择照片 ${state.selectedPhotoId}`);
  }
}

async function initializeFacadeQueue(context) {
  if (String(context.sourceCode || '').trim() !== state.targetCode) return;
  if (!context.hasAuthenticatedSession) {
    state.photoServiceStatus = 'unauthenticated';
    renderPhotoServiceState();
    setStatus('登录会话已失效，请重新登录平台后再打开生成器。', true);
    return;
  }
  let openerClient, openerServices;
  try {
    if (window.opener?.location.origin !== window.location.origin) throw Error('FOREIGN_OPENER');
    openerClient = window.opener?.VillageSupabaseClient;
    openerServices = window.opener?.VillageBusinessServices;
    if (window.opener?.VILLAGE_DEPLOYMENT?.mode === 'aliyun' && !openerServices?.tasks) throw Error('LOCAL_TASK_SERVICE_REQUIRED');
  } catch {
    setStatus('无法使用其他站点的登录会话，请从同一平台重新打开生成器。', true);
    return;
  }
  if (!openerClient) {
    state.photoServiceStatus = 'offline';
    renderPhotoServiceState();
    setStatus('未取得平台登录会话，请从已登录的平台重新打开生成器。', true);
    return;
  }
  const key = JSON.stringify([context.courseId, context.spaceId || state.targetSpace, state.targetCode]);
  if (state.facadeInitializationPromise && state.facadeInitializationKey === key
      && state.facadeInitializationClient === openerClient) return state.facadeInitializationPromise;
  if (state.facadeQueue && state.photoJobId && state.facadeInitializationKey === key
      && state.facadeInitializationClient === openerClient) return pollFacadeRun();
  state.facadeInitializationKey = key;
  state.facadeInitializationClient = openerClient;
  const pending = initializeFacadeQueueConnection(context, openerClient, openerServices);
  state.facadeInitializationPromise = pending;
  try { await pending; }
  finally {
    if (state.facadeInitializationPromise === pending) state.facadeInitializationPromise = null;
  }
}

async function initializeFacadeQueueConnection(context, openerClient, services) {
  state.facadeContext = {
    courseId: String(context.courseId || ''),
    spaceId: String(context.spaceId || state.targetSpace),
    sourceCode: state.targetCode
  };
  if (!state.facadeContext.courseId) {
    setStatus('当前课程上下文不完整，暂时不能提交生成任务。', true);
    return;
  }
  state.facadeQueue = FacadeQueueClient.createFacadeQueueClient(openerClient, {services});
  const queue = state.facadeQueue;
  const facadeContext = state.facadeContext;
  state.cloudClient = FacadeCloudClient.createFacadeCloudClient(openerClient, {services});
  state.photoServiceStatus = 'checking';
  renderPhotoServiceState();
  void refreshCloudCapability();
  try {
    const availability = await queue.getWorkerAvailability();
    if (state.facadeQueue !== queue) return;
    state.photoServiceStatus = availability?.available ? 'online' : 'offline';
  } catch (error) {
    if (state.facadeQueue !== queue) return;
    console.warn('读取 4090 立面服务状态失败：', error);
    state.photoServiceStatus = 'error';
  }
  renderPhotoServiceState();
  try {
    const query = {
      spaceId: facadeContext.spaceId,
      objectCode: state.targetCode
    };
    const latest = await queue.findActiveRun(query) || await queue.findLatestRun(query);
    if (state.facadeQueue === queue && !state.photoJobId && PhotoWorkflow.shouldRestoreFacadeRun(latest)) {
      await attachFacadeRun(latest);
    }
  } catch (error) {
    console.warn('恢复正立面任务失败：', error);
  }
}

async function handleUploadedPhotoRecord(payload) {
  if (String(payload.sourceCode || '').trim() !== state.targetCode) return;
  if (payload.error) {
    setStatus(`照片上传失败：${payload.error}`, true);
    return;
  }
  const [photo] = PhotoMaterialBridge.normalizePhotoMaterials([payload.photo]);
  if (!PhotoMaterialBridge.isQueueablePhoto(photo)) {
    setStatus('照片已上传，但未返回可排队的数据库 ID。', true);
    return;
  }
  state.photoMaterials = PhotoMaterialBridge.normalizePhotoMaterials([photo, ...state.photoMaterials]);
  state.selectedPhotoId = photo.id;
  state.photoFile = null;
  renderExistingPhotoMaterials('新照片已保存，正在提交处理');
  try {
    if (state.pendingCloudResultUpload) {
      state.pendingCloudResultUpload = false;
      await submitFacadePhoto(photo);
    } else {
      await processPhotoRecord(photo);
    }
  } catch (error) {
    console.error('提交新建筑照片失败：', error);
    setStatus(`照片已保存，但未提交处理：${error.message}`, true);
  }
}

async function processPhotoRecord(photo) {
  if (state.facadeSource === 'cloud_api') return submitCloudFacade(photo);
  return submitFacadePhoto(photo);
}

async function submitFacadePhoto(photo) {
  if (state.facadeSubmissionPromise) return state.facadeSubmissionPromise;
  const pending = performFacadePhotoSubmission(photo);
  state.facadeSubmissionPromise = pending;
  try { return await pending; }
  finally {
    if (state.facadeSubmissionPromise === pending) state.facadeSubmissionPromise = null;
  }
}

async function performFacadePhotoSubmission(photo) {
  if (state.facadeInitializationPromise) await state.facadeInitializationPromise;
  if (!state.facadeQueue || !state.facadeContext) {
    throw new Error('平台登录上下文尚未就绪');
  }
  const queue = state.facadeQueue;
  const query = { spaceId: state.facadeContext.spaceId, objectCode: state.targetCode };
  async function restoreActiveRun() {
    const existing = await queue.findActiveRun(query);
    if (!existing) return false;
    await attachFacadeRun(existing);
    setStatus(existing.status === 'awaiting_crop'
      ? '当前建筑已有未结束任务，已恢复原照片。请确认屋顶线后点击生成；本次未重复提交新照片。'
      : '当前建筑已有未结束任务，已恢复原任务进度；本次未重复提交新照片。');
    return true;
  }
  if (await restoreActiveRun()) return;
  let runId;
  try {
    runId = await queue.submit({
    courseId: state.facadeContext.courseId,
    spaceId: state.facadeContext.spaceId,
    objectCode: state.targetCode,
    photoId: Number(photo.id)
    });
  } catch (error) {
    if (!String(error?.message || '').includes('TOO_MANY_ACTIVE_FACADE_RUNS')) throw error;
    // Another window may have submitted while this window was querying.
    if (await restoreActiveRun()) return;
    throw new Error('当前账号已有 2 个未结束的立面任务。请回到对应建筑，确认屋顶线并完成生成，或等待正在处理的任务结束后再提交。');
  }
  // The RPC succeeded: retain the id even if the subsequent read is interrupted.
  state.photoJobId = String(runId);
  let run;
  try { run = await queue.getRun(runId); }
  catch (error) {
    console.warn('任务已提交，读取初始进度失败：', error);
    await attachFacadeRun(state.facadeQueue.deploymentMode === 'aliyun' ? await state.facadeQueue.getRun(runId) : { id: runId, photo_id: Number(photo.id), status: 'queued_rectification' });
    setStatus('任务已进入 4090 队列，暂时无法读取进度，正在自动重试；请勿重复提交。');
    return;
  }
  await attachFacadeRun(run);
}

async function attachFacadeRun(run) {
  clearFacadePollTimer();
  state.facadeRunRevision = (state.facadeRunRevision || 0) + 1;
  const revision = state.facadeRunRevision;
  state.currentFacadeRun = run;
  state.photoJobId = String(run?.id || '');
  state.photoWorkflowState = String(run?.status || 'idle');
  renderPhotoServiceState();
  const runId = state.photoJobId;
  const queue = state.facadeQueue;
  state.facadeUnsubscribe?.();
  state.facadeUnsubscribe = null;
  try {
    state.facadeUnsubscribe = queue.subscribe(runId, (event) => {
      if (!isCurrentFacadeRun(runId, queue, revision) || event?.new?.id !== runId) return;
      void applyFacadeRun(event.new).catch(error => console.warn('更新立面任务预览失败：', error));
    });
  } catch (error) {
    console.warn('实时任务订阅失败，将使用轮询恢复进度：', error);
  }
  if (run.photo_id != null) {
    state.selectedPhotoId = String(run.photo_id);
    if (state.photoMaterials?.length) renderExistingPhotoMaterials(`当前任务使用照片 ${state.selectedPhotoId}`);
  }
  try { await applyFacadeRun(run); }
  catch (error) {
    console.warn('任务已恢复，读取预览失败：', error);
    setStatus('任务已恢复，预览暂时读取失败，正在重试；请勿重复提交。', true);
  } finally {
    if (isCurrentFacadeRun(runId, queue, revision)) scheduleFacadePoll();
  }
}

function isCurrentFacadeRun(runId, queue, revision) {
  return state.facadeQueue === queue && state.photoJobId === String(runId)
    && state.facadeRunRevision === revision;
}

function isCurrentFacadeResult(run, queue, revision) {
  const current = state.currentFacadeRun;
  return isCurrentFacadeRun(run?.id, queue, revision)
    && Number(current?.generation_revision || 0) === Number(run?.generation_revision || 0)
    && (run?.status !== 'completed' || current?.status === 'completed');
}

async function applyFacadeRun(run) {
  const queue = state.facadeQueue, revision = state.facadeRunRevision;
  if (!isCurrentFacadeRun(run?.id, queue, revision)) return;
  if (Number(run?.generation_revision || 0) < Number(state.currentFacadeRun?.generation_revision || 0)) return;
  if (state.currentFacadeRun?.status === 'completed' && run.status !== 'completed'
      && Number(run.generation_revision || 0) === Number(state.currentFacadeRun.generation_revision || 0)) return;
  state.currentFacadeRun = run;
  state.facadeResultPending = PhotoWorkflow.canConfirmCrop(run);
  state.photoWorkflowState = String(run?.status || 'idle');
  const presentation = PhotoWorkflow.facadeStatusPresentation(run, state.photoServiceStatus);
  setProgress(presentation.progress, presentation.message);
  setStatus(presentation.message, run?.status === 'failed');
  renderFacadeStep(run?.status);
  if (PhotoWorkflow.canConfirmCrop(run)) {
    await loadRectifiedPreview(run, queue, revision);
    if (!isCurrentFacadeResult(run, queue, revision)) return;
  }
  if (run?.status === 'completed') {
    await loadCompletedFacadeModel(run, queue, revision);
    if (!isCurrentFacadeResult(run, queue, revision)) return;
  }
  state.facadeResultPending = false;
  els.photoFallbackActions.hidden = run?.status !== 'failed';
  if (presentation.terminal) clearFacadePollTimer();
}

function renderFacadeStep(status) {
  if (['pending', 'queued_rectification', 'claimed_rectification'].includes(status)) setPhotoStep('identify');
  else if (status === 'rectifying') setPhotoStep('rectify');
  else if (status === 'awaiting_crop') setPhotoStep('crop');
  else if (['queued_generation', 'claimed_generation', 'generating', 'completed'].includes(status)) setPhotoStep('generate');
  else if (status === 'failed') setPhotoStep('rectify', true);
}

async function facadeArtifact(runId, artifactType, queue = state.facadeQueue) {
  const artifacts = await queue.listArtifacts(runId);
  return [...(artifacts || [])]
    .reverse()
    .find((item) => item.artifact_type === artifactType) || null;
}

async function loadRectifiedPreview(run, queue = state.facadeQueue, revision = state.facadeRunRevision) {
  const artifact = await facadeArtifact(run.id, 'rectified_preview', queue);
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  if (!artifact) throw new Error('正立面预处理未返回预览图');
  const url = await queue.createArtifactUrl(artifact.storage_path);
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  const image = await loadImage(url);
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  state.rectifiedUrl = url;
  state.photoImage = image;
  els.photoPreview.src = url;
  els.photoPreview.hidden = false;
  els.photoPreviewEmpty.hidden = true;
  els.roofCropShade.hidden = false;
  els.roofCropHandle.hidden = false;
  els.photoFallbackActions.hidden = true;
  updateCropOverlay();
  state.roofAnalysisStatus = 'fallback';
  state.roofAnalysis = PhotoWorkflow.normalizeRoofAnalysis({
    type: { value: els.roofTypeInput.value, confidence: 0, source: 'manual' },
    material: { value: els.roofMaterialInput.value, confidence: 0, source: 'manual' },
    pitch: { value: els.roofPitchInput.value, confidence: 0, source: 'manual' },
    crop_top: state.cropTop,
    revision: Number(run.generation_revision || 0),
    warnings: ['请确认屋顶线']
  });
  renderRoofAnalysis();
  els.activeLabel.textContent = '规范正立面：等待确认屋顶线';
}

async function loadCompletedFacadeModel(run, queue = state.facadeQueue, revision = state.facadeRunRevision) {
  const artifact = await facadeArtifact(run.id, 'building_glb', queue);
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  if (!artifact) throw new Error('任务已完成，但未找到 GLB');
  const url = await queue.createArtifactUrl(artifact.storage_path);
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GLB 下载失败（${response.status}）`);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  if (!isCurrentFacadeResult(run, queue, revision)) return;
  const group = await parseGlb(arrayBuffer);
  if (!isCurrentFacadeResult(run, queue, revision)) {
    group.traverse(obj => {
      obj.geometry?.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) { material?.map?.dispose(); material?.dispose?.(); }
    });
    return;
  }
  clearCurrentUrl();
  replaceModel(group);
  frameModel(group);
  state.currentBlob = blob;
  state.currentUrl = URL.createObjectURL(blob);
  const building = artifact.source?.building || {
    wall_height: Number(els.lengthInput.value),
    roof_height: 0,
    width: Number(els.lengthInput.value),
    depth: Number(els.widthInput.value)
  };
  state.currentModelInfo = {
    id: `photo-${run.id}`,
    metrics: PhotoWorkflow.photoModelMetrics(building)
  };
  els.downloadBtn.disabled = false;
  els.sendBtn.disabled = false;
  const link = document.createElement('a');
  link.href = state.currentUrl;
  link.download = `${state.currentModelInfo.id}.glb`;
  link.textContent = '下载标准正立面贴图建筑 GLB';
  els.downloadLink.replaceChildren(link);
  setProgress(100, '标准正立面贴图建筑生成完成');
  setStatus(buildGenerateCompleteMessage('标准正立面贴图模型'));
}

function setFacadeSource(source, { preserveStatus = false } = {}) {
  state.facadeSource = FacadeSourceMode.normalizeSource(source);
  els.sourceButtons.forEach((button) => {
    const active = button.dataset.facadeSource === state.facadeSource;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  els.sourcePanels.forEach((panel) => {
    panel.hidden = panel.dataset.sourcePanel !== state.facadeSource;
  });
  const messages = {
    local_worker: '上传原始实拍图后，4090 工作站会自动生成标准正立面。',
    external_prompt: '先把原图交给豆包处理，再在下方上传返回的标准正立面。',
    cloud_api: FacadeSourceMode.cloudUnavailableMessage(state.cloudCapability)
      || '上传原始实拍图后，平台会通过服务端千问接口生成标准正立面。'
  };
  els.photoUploadHint.textContent = state.facadeSource === 'external_prompt'
    ? '请上传豆包返回的标准正立面 JPG / PNG，不超过 10 MB'
    : '请上传原始建筑实拍图 JPG / PNG，不超过 10 MB；照片会保存到当前建筑素材库';
  els.photoInput.disabled = !FacadeSourceMode.canSubmit(state.facadeSource, state.cloudCapability);
  els.generateBtn.textContent = '生成正立面贴图建筑';
  els.configHint.textContent = '填写白模正面长度与进深；墙体高度将在裁掉屋顶后按正立面比例自动计算。';
  els.activeLabel.textContent = FacadeSourceMode.SOURCES[state.facadeSource].label;
  if (!preserveStatus) setStatus(messages[state.facadeSource]);
  renderPhotoServiceState();
}

async function refreshCloudCapability() {
  try {
    state.cloudCapability = await state.cloudClient.getCapability();
  } catch (error) {
    state.cloudCapability = { available: false, reason: 'unreachable' };
    console.warn('读取云端立面能力失败：', error);
  }
  const message = FacadeSourceMode.cloudUnavailableMessage(state.cloudCapability);
  els.cloudCapabilityLabel.textContent = state.cloudCapability.available ? '千问已配置' : '管理员尚未启用';
  els.cloudSourceMessage.textContent = message || '千问已由管理员配置。每次重新生成都会产生一次新的图像调用费用。';
  setFacadeSource(state.facadeSource, { preserveStatus: Boolean(state.photoJobId || state.cloudRunId) });
}

async function submitCloudFacade(photo) {
  if (!state.cloudClient || !state.cloudCapability.available) {
    throw new Error(FacadeSourceMode.cloudUnavailableMessage(state.cloudCapability));
  }
  setProgress(12, '正在提交千问云端处理…');
  const run = await state.cloudClient.submit({
    photoId: Number(photo.id),
    courseId: state.facadeContext?.courseId,
    spaceId: state.facadeContext?.spaceId,
    objectCode: state.targetCode
  });
  state.cloudRunId = String(run.runId || run.id || '');
  if (!state.cloudRunId) throw new Error('云端任务未返回编号');
  await pollCloudFacade();
}

async function pollCloudFacade() {
  window.clearTimeout(state.cloudPollTimer);
  const run = await state.cloudClient.poll(state.cloudRunId);
  if (run.status === 'succeeded' && run.resultUrl) {
    const response = await fetch(run.resultUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`云端结果下载失败（${response.status}）`);
    const blob = await response.blob();
    const file = new File([blob], `qwen-facade-${state.targetCode || Date.now()}.png`, { type: blob.type || 'image/png' });
    state.pendingCloudResultUpload = true;
    setProgress(38, '云端正立面已完成，正在保存到建筑素材库…');
    await setPhotoFile(file);
    return;
  }
  if (run.status === 'failed') throw new Error(run.errorMessage || '云端图像处理失败');
  setProgress(Number(run.progress || 24), '千问正在生成标准正立面…');
  state.cloudPollTimer = window.setTimeout(() => void pollCloudFacade().catch((error) => {
    setStatus(error.message, true);
  }), 5000);
}

async function copyCorrectionPrompt() {
  try {
    await navigator.clipboard.writeText(PhotoWorkflow.CORRECTION_PROMPT);
    setStatus('提示词已复制。打开豆包并与实拍图一起发送即可。');
  } catch (error) {
    console.error(error);
    els.correctionPrompt.focus();
    els.correctionPrompt.select();
    setStatus('浏览器未允许自动复制，提示词已选中，请按 Ctrl+C 手动复制。', true);
  }
}

function handlePhotoFiles(event) {
  const result = PhotoWorkflow.validateStandardFacadeFiles(event.target.files);
  if (!result.ok) {
    setStatus(result.message, true);
    event.target.value = '';
    return;
  }
  setPhotoFile(result.file);
}

async function setPhotoFile(file) {
  if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
  if (state.rectifiedUrl) URL.revokeObjectURL(state.rectifiedUrl);
  state.photoFile = file;
  state.photoUrl = URL.createObjectURL(file);
  state.rectifiedUrl = null;
  state.cropTop = 0.12;
  state.photoWorkflowState = 'idle';
  resetRoofAnalysis();
  els.photoFallbackActions.hidden = true;
  els.photoHeightSummary.querySelector('strong').textContent = '裁剪屋顶后，将按正立面比例自动计算';
  setPhotoStep('upload');
  try {
    state.photoImage = await loadImage(state.photoUrl);
    els.photoPreview.src = state.photoUrl;
    els.photoPreview.hidden = false;
    els.photoPreviewEmpty.hidden = true;
    els.roofCropShade.hidden = true;
    els.roofCropHandle.hidden = true;
    els.photoGenerateBtn.disabled = true;
    updateCropOverlay();
    els.activeLabel.textContent = `待保存实拍图：${file.name}`;
    setStatus('正在把照片保存到当前建筑的素材库…');
    if (!window.opener || window.opener.closed) {
      throw new Error('请从平台建筑详情打开生成器后再上传');
    }
    window.opener.postMessage({
      type: PhotoMaterialBridge.UPLOAD_REQUEST_TYPE,
      payload: {
        sourceCode: state.targetCode,
        spaceId: state.targetSpace,
        file
      }
    }, window.location.origin);
  } catch (error) {
    console.error(error);
    state.photoFile = null;
    state.photoImage = null;
    els.photoPreview.hidden = true;
    els.photoPreviewEmpty.hidden = false;
    els.roofCropShade.hidden = true;
    els.roofCropHandle.hidden = true;
    els.photoGenerateBtn.disabled = true;
    setStatus(`标准正立面图读取失败：${error.message}`, true);
  }
}

function readPhotoBuildingConfig() {
  const resolved = state.roofAnalysis
    ? PhotoWorkflow.roofAnalysisChoices(state.roofAnalysis)
    : {
        roofType: els.roofTypeInput.value,
        roofMaterial: els.roofMaterialInput.value,
        roofPitch: els.roofPitchInput.value
      };
  return PhotoWorkflow.buildPhotoUploadConfig({
    length: Number(els.lengthInput.value),
    width: Number(els.widthInput.value),
    ...resolved
  });
}

function clearRoofAnalysisTimer() {
  if (state.roofAnalysisTimer !== null) {
    window.clearTimeout(state.roofAnalysisTimer);
    state.roofAnalysisTimer = null;
  }
}

function resetRoofAnalysis() {
  clearRoofAnalysisTimer();
  state.roofAnalysisAbortController?.abort();
  state.roofAnalysisAbortController = null;
  const cleared = PhotoWorkflow.clearRoofOverrides();
  state.roofAnalysis = cleared.analysis;
  state.roofOverrides = cleared.overrides;
  state.roofAnalysisStatus = cleared.status;
  state.roofAnalysisRevision = cleared.revision;
  els.roofAdvanced.open = false;
  els.roofTypeInput.value = 'hip';
  els.roofMaterialInput.value = 'gray_tile';
  els.roofPitchInput.value = 'standard';
  renderRoofAnalysis();
}

function renderRoofAnalysis() {
  const presentations = {
    idle: ['idle', '拖动屋顶线后自动匹配屋顶'],
    pending: ['pending', '正在匹配屋顶…'],
    error: ['error', '屋顶匹配暂时不可用，请检查本地服务。']
  };
  if (state.roofAnalysis) {
    const fallback = ['type', 'material', 'pitch']
      .some((key) => state.roofAnalysis[key]?.source === 'fallback');
    els.roofAnalysisSummary.dataset.tone = fallback ? 'fallback' : 'ready';
    els.roofAnalysisSummary.textContent = PhotoWorkflow.roofAnalysisSummary(state.roofAnalysis);
  } else {
    const [tone, message] = presentations[state.roofAnalysisStatus] || presentations.idle;
    els.roofAnalysisSummary.dataset.tone = tone;
    els.roofAnalysisSummary.textContent = message;
  }
  const analysisReady = ['ready', 'fallback'].includes(state.roofAnalysisStatus);
  els.photoGenerateBtn.disabled = !PhotoWorkflow.canConfirmCrop(state.currentFacadeRun) || !analysisReady;
}

function syncRoofInputs() {
  if (!state.roofAnalysis) return;
  const choices = PhotoWorkflow.roofAnalysisChoices(state.roofAnalysis);
  els.roofTypeInput.value = choices.roofType;
  els.roofMaterialInput.value = choices.roofMaterial;
  els.roofPitchInput.value = choices.roofPitch;
}

function setRoofOverride(field, value) {
  state.roofOverrides = { ...state.roofOverrides, [field]: value };
  scheduleRoofAnalysis(0);
}

function scheduleRoofAnalysis(delay = 350) {
  if (!state.photoJobId || !PhotoWorkflow.canConfirmCrop(state.currentFacadeRun)) return;
  clearRoofAnalysisTimer();
  state.roofAnalysisStatus = 'pending';
  renderRoofAnalysis();
  state.roofAnalysisTimer = window.setTimeout(() => {
    state.roofAnalysisTimer = null;
    state.roofAnalysisRevision += 1;
    state.roofAnalysis = PhotoWorkflow.normalizeRoofAnalysis({
      type: { value: els.roofTypeInput.value, confidence: 1, source: 'manual' },
      material: { value: els.roofMaterialInput.value, confidence: 1, source: 'manual' },
      pitch: { value: els.roofPitchInput.value, confidence: 1, source: 'manual' },
      crop_top: state.cropTop,
      revision: state.roofAnalysisRevision,
      warnings: []
    });
    state.roofAnalysisStatus = 'ready';
    renderRoofAnalysis();
  }, delay);
}

function clearFacadePollTimer() {
  if (state.facadePollTimer !== null) {
    window.clearTimeout(state.facadePollTimer);
    state.facadePollTimer = null;
  }
}

function scheduleFacadePoll(delay = state.facadePollDelay) {
  clearFacadePollTimer();
  if (!state.facadeQueue || !state.photoJobId || document.hidden) return;
  state.facadePollTimer = window.setTimeout(pollFacadeRun, delay);
}

function renderPhotoServiceState() {
  const online = state.photoServiceStatus === 'online';
  const failed = state.currentFacadeRun?.status === 'failed';
  els.photoServiceState.dataset.tone = online ? 'online' : 'offline';
  els.photoServiceMessage.textContent = online
    ? '4090 远程生成队列已连接。'
    : !state.facadeQueue || state.photoServiceStatus === 'unauthenticated'
      ? '未连接平台登录会话，请从已登录的平台重新打开生成器。'
      : state.photoServiceStatus === 'checking'
        ? '正在检查 4090 立面队列连接…'
        : state.photoServiceStatus === 'error'
          ? '立面服务状态查询失败，请检查网络连接后重试。'
          : '4090 立面处理服务未报告在线，请联系管理员检查立面 Worker。';
  els.recoverPhotoBtn.hidden = online && !failed;
}

async function pollFacadeRun() {
  clearFacadePollTimer();
  if (!state.facadeQueue || !state.photoJobId || document.hidden) return;
  const queue = state.facadeQueue, runId = state.photoJobId, revision = state.facadeRunRevision;
  try {
    const [run, availability] = await Promise.all([
      queue.getRun(runId),
      queue.getWorkerAvailability()
    ]);
    if (!isCurrentFacadeRun(runId, queue, revision)) return;
    state.photoServiceStatus = availability?.available ? 'online' : 'offline';
    await applyFacadeRun(run);
    if (!isCurrentFacadeRun(runId, queue, revision)) return;
    state.facadePollDelay = 2000;
  } catch (error) {
    if (!isCurrentFacadeRun(runId, queue, revision)) return;
    console.warn('轮询正立面任务失败：', error);
    state.photoServiceStatus = 'error';
    state.facadePollDelay = Math.min(15000, Math.max(2000, state.facadePollDelay * 1.6));
    renderPhotoServiceState();
  }
  if (isCurrentFacadeRun(runId, queue, revision) && (state.facadeResultPending
      || !['completed', 'failed', 'canceled'].includes(state.currentFacadeRun?.status))) {
    scheduleFacadePoll();
  }
}

async function recoverCurrentPhoto() {
  if (state.currentFacadeRun) {
    if (state.currentFacadeRun.status === 'failed') {
      await state.facadeQueue.retryFailed(state.currentFacadeRun.id);
    }
    state.facadePollDelay = 2000;
    await pollFacadeRun();
  } else {
    requestExistingPhotoMaterials();
  }
}

async function useOriginalPhoto() {
  setStatus('原照片仍保留。请从上方历史照片中选择另一张，或重新上传后提交。', true);
  els.photoInput.value = '';
  els.photoInput.click();
}

function setPhotoStep(activeStep, isError = false) {
  const order = ['upload', 'identify', 'rectify', 'crop', 'generate'];
  const activeIndex = order.indexOf(activeStep);
  els.photoSteps?.querySelectorAll('[data-step]').forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle('is-done', activeIndex >= 0 && index < activeIndex);
    item.classList.toggle('is-active', !isError && index === activeIndex);
    item.classList.toggle('is-error', isError && index === activeIndex);
  });
}

function updateCropOverlay() {
  els.photoPreview.parentElement.style.setProperty('--crop-top', `${state.cropTop * 100}%`);
}

function startRoofCropDrag(event) {
  if (!state.photoImage) return;
  state.draggingCropTop = true;
  els.photoGenerateBtn.disabled = true;
  els.roofCropHandle.setPointerCapture(event.pointerId);
  moveRoofCropDrag(event);
}

function moveRoofCropDrag(event) {
  if (!state.draggingCropTop) return;
  const bounds = els.photoPreview.getBoundingClientRect();
  state.cropTop = PhotoWorkflow.clampCropTop((event.clientY - bounds.top) / bounds.height);
  updateCropOverlay();
}

function stopRoofCropDrag(event) {
  if (!state.draggingCropTop) return;
  state.draggingCropTop = false;
  if (els.roofCropHandle.hasPointerCapture(event.pointerId)) {
    els.roofCropHandle.releasePointerCapture(event.pointerId);
  }
  setStatus(`屋顶分界线已设置在图片高度的 ${Math.round(state.cropTop * 100)}%，线以上不会进入墙身贴图。`);
  scheduleRoofAnalysis();
}

function adjustRoofCropWithKeyboard(event) {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  state.cropTop = PhotoWorkflow.clampCropTop(
    state.cropTop + (event.key === 'ArrowDown' ? 0.01 : -0.01)
  );
  updateCropOverlay();
  setStatus(`屋顶分界线位于图片高度的 ${Math.round(state.cropTop * 100)}%，线以上不会进入墙身贴图。`);
  scheduleRoofAnalysis();
}

async function generatePhotoModel() {
  if (!state.facadeQueue || !state.photoJobId || !PhotoWorkflow.canConfirmCrop(state.currentFacadeRun)) {
    setStatus('请先等待原始照片完成正立面预处理。', true);
    return;
  }
  if (!['ready', 'fallback'].includes(state.roofAnalysisStatus)) {
    setStatus('请等待系统完成屋顶自动匹配。', true);
    return;
  }

  const queue = state.facadeQueue, runId = state.photoJobId;
  state.facadeRunRevision += 1;
  clearFacadePollTimer();
  try {
    setPhotoStep('generate');
    els.generateBtn.disabled = true;
    els.photoGenerateBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.sendBtn.disabled = true;
    clearCurrentUrl();

    await queue.confirmCrop(runId, {
      cropTop: state.cropTop,
      roofType: els.roofTypeInput.value,
      buildingWidth: Number(els.lengthInput.value),
      buildingDepth: Number(els.widthInput.value)
    });
    if (state.facadeQueue !== queue || state.photoJobId !== runId) return;
    state.photoWorkflowState = 'queued_generation';
    setProgress(55, '已确认屋顶线，等待 4090 生成模型…');
    const run = await queue.getRun(runId);
    if (state.facadeQueue !== queue || state.photoJobId !== runId) return;
    await attachFacadeRun(run);
    scheduleFacadePoll(0);
  } catch (error) {
    if (state.facadeQueue !== queue || state.photoJobId !== runId) return;
    console.error(error);
    setProgress(0, '生成失败');
    setStatus(`提交生成失败：${String(error?.message || error)}`, true);
  } finally {
    if (state.facadeQueue === queue && state.photoJobId === runId) scheduleFacadePoll(0);
    els.generateBtn.disabled = false;
    renderRoofAnalysis();
  }
}

function parseGlb(arrayBuffer) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf.scene), reject);
  });
}

function buildGenerateCompleteMessage(modelLabel) {
  if (state.targetCode && window.opener) {
    return `生成完成：${modelLabel}\n可下载 GLB，也可点击“替换原建筑”同步到主平台。`;
  }
  return `生成完成：${modelLabel}\n可下载 GLB。`;
}

function createPreviewRenderLoop({ controls, render, requestFrame, cancelFrame, visible = true }) {
  let frame = null;
  let active = visible;
  let updating = false;
  let invalidated = false;
  let disposed = false;

  function invalidate() {
    if (disposed) return;
    invalidated = true;
    if (active && !updating && frame === null) frame = requestFrame(draw);
  }
  function draw() {
    frame = null;
    if (!active || disposed) return;
    invalidated = false;
    updating = true;
    // OrbitControls emits change synchronously from update(). Queue another
    // frame only while its damping still changes the camera, then become idle.
    const changed = controls.update();
    render();
    updating = false;
    if (changed || invalidated) invalidate();
  }
  function setVisible(next) {
    active = !!next;
    if (!active && frame !== null) { cancelFrame(frame); frame = null; }
    if (active) invalidate();
  }
  function dispose() {
    disposed = true;
    if (frame !== null) { cancelFrame(frame); frame = null; }
    ['change', 'start', 'end'].forEach(event => controls.removeEventListener(event, invalidate));
  }
  ['change', 'start', 'end'].forEach(event => controls.addEventListener(event, invalidate));
  return { invalidate, setVisible, dispose };
}

function applyPreviewQuality(profile = window.RenderQualityModule?.getProfile()) {
  if (!state.renderer || !state.sun) return;
  const quality = profile?.thumbnail || { pixelRatio: 1, shadows: false, shadowMapSize: 1024 };
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  state.renderer.shadowMap.enabled = quality.shadows;
  state.sun.castShadow = quality.shadows;
  if (state.sun.shadow.mapSize.x !== quality.shadowMapSize) {
    state.sun.shadow.map?.dispose();
    state.sun.shadow.map = null;
    state.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  }
  state.renderer.shadowMap.needsUpdate = true;
  state.previewLoop?.invalidate();
}

function disposeModelResources(group, preservedGroup) {
  function collect(candidate) {
    const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
    const addTexture = value => {
      if (value?.isTexture) resources.textures.add(value);
      else if (Array.isArray(value)) value.forEach(addTexture);
    };
    candidate?.traverse(object => {
      if (object.geometry) resources.geometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => {
        resources.materials.add(material);
        Object.values(material).forEach(addTexture);
        Object.values(material.uniforms || {}).forEach(uniform => addTexture(uniform?.value));
      });
    });
    return resources;
  }
  const released = collect(group);
  const preserved = collect(preservedGroup);
  Object.keys(released).forEach(kind => released[kind].forEach(resource => {
    if (!preserved[kind].has(resource)) resource.dispose?.();
  }));
}

function initThree() {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({
    antialias: window.RenderQualityModule?.getMode() !== 'low', alpha: true
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  els.viewer.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 8;
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0xffffff, 1.35));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(14, 18, 12);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-10, 8, -10);
  scene.add(fill);

  const grid = new THREE.GridHelper(60, 60, 0x9eb1c3, 0xd6e1eb);
  grid.name = 'grid';
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;
  state.sun = sun;
  state.previewLoop = createPreviewRenderLoop({
    controls, render: () => renderer.render(scene, camera),
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: id => window.cancelAnimationFrame(id), visible: !document.hidden
  });
  applyPreviewQuality();
  state.qualityUnsubscribe = window.RenderQualityModule?.subscribe((mode, profile) => applyPreviewQuality(profile));
  document.addEventListener('visibilitychange', () => state.previewLoop?.setVisible(!document.hidden));
  window.addEventListener('pagehide', event => {
    state.previewLoop?.setVisible(false);
    if (!event.persisted) {
      state.previewLoop?.dispose();
      state.qualityUnsubscribe?.();
    }
  });
  window.addEventListener('pageshow', () => state.previewLoop?.setVisible(!document.hidden));

  resetIdleCamera();
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

}

function resetIdleCamera() {
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(0, 18, 24);
  state.camera.lookAt(0, 0, 0);
  state.controls.update();
  state.previewLoop?.invalidate();
}

function resizeRenderer() {
  const rect = els.viewer.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(360, rect.height);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height, false);
  state.previewLoop?.invalidate();
}

function replaceModel(group) {
  if (state.currentGroup) {
    state.scene.remove(state.currentGroup);
    disposeModelResources(state.currentGroup, group);
  }

  state.currentGroup = group;
  state.scene.add(group);
  state.previewLoop?.invalidate();
}

function frameModel(group) {
  const box = new THREE.Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 6);
  const aspect = Math.max(state.camera.aspect || 1, 1);
  const vFov = THREE.MathUtils.degToRad(state.camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fitHeightDistance = radius / Math.tan(vFov / 2);
  const fitWidthDistance = radius / Math.tan(hFov / 2);
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.55;
  const target = new THREE.Vector3(center.x, center.y * 0.45, center.z);
  const viewDirection = new THREE.Vector3(0.72, 0.48, 1).normalize();

  state.controls.target.copy(target);
  state.camera.position.copy(target).addScaledVector(viewDirection, distance);
  state.camera.near = Math.max(0.1, distance / 100);
  state.camera.far = Math.max(1000, distance * 10);
  state.camera.updateProjectionMatrix();
  state.camera.lookAt(state.controls.target);
  state.controls.update();
  state.previewLoop?.invalidate();
}

function downloadGlb() {
  if (!state.currentUrl || !state.currentModelInfo) return;
  const link = document.createElement('a');
  link.href = state.currentUrl;
  link.download = `${state.currentModelInfo.id}.glb`;
  link.click();
}

async function replaceOriginalBuilding() {
  if (!state.currentBlob || !state.currentModelInfo) {
    setStatus('请先生成 GLB 模型，再替换原建筑。', true);
    return;
  }

  if (!window.opener || window.opener.closed) {
    setStatus('未找到主平台窗口，请从 3D 模块点击“生成模型”打开本页。', true);
    return;
  }

  if (!state.targetCode) {
    setStatus('缺少目标建筑编码，无法替换原建筑。', true);
    return;
  }

  if (state.modelSavePending) return;
  state.modelSavePending = true;
  try {
    els.sendBtn.disabled = true;
    setStatus('正在自动准备轻量版本并保存到主平台，请稍候…');

    const glbBuffer = await state.currentBlob.arrayBuffer();

    const message = PhotoWorkflow.buildModelReadyMessage({
      targetCode: state.targetCode,
      targetName: state.targetName,
      targetSpace: state.targetSpace,
      modelId: state.currentModelInfo.id,
      glbBuffer,
      metrics: state.currentModelInfo.metrics
    });
    message.payload.requestId = crypto.randomUUID();
    await sendModelAndWaitForSave(message, glbBuffer);

    setStatus('模型已保存，正在返回 3D 模块...');
    try {
      window.opener.focus();
    } catch (_) {}
    window.close();
  } catch (err) {
    if (err?.code === 'MODEL_SAVE_CONFIRMATION_TIMEOUT') {
      console.warn(err);
      setStatus(err.message, true);
    } else {
      console.error(err);
      setStatus(`同步失败：${err.message}`, true);
    }
  } finally {
    state.modelSavePending = false;
    els.sendBtn.disabled = false;
  }
}

function sendModelAndWaitForSave(message, glbBuffer) {
  return new Promise((resolve, reject) => {
    const opener = window.opener;
    let timer;
    const cleanup = () => {
      window.removeEventListener('message', onReply);
      window.clearTimeout(timer);
    };
    const onReply = event => {
      if (event.origin !== window.location.origin || event.source !== opener
          || event.data?.type !== 'village-house-generator:model-saved'
          || event.data?.payload?.requestId !== message.payload.requestId) return;
      cleanup();
      if (event.data.payload.saved) resolve();
      else reject(new Error(event.data.payload.error || '主平台未完成模型保存，请重试。'));
    };
    window.addEventListener('message', onReply);
    // Allow 180s CPU preparation, three storage uploads, and a final confirmation margin.
    timer = window.setTimeout(() => {
      cleanup();
      const error = new Error('保存确认等待时间较长，主平台后台可能仍在处理或保存。请先核对模型库，避免重复提交；当前 GLB 仍可下载。');
      error.code = 'MODEL_SAVE_CONFIRMATION_TIMEOUT';
      reject(error);
    }, 420000);
    try { opener.postMessage(message, window.location.origin, [glbBuffer]); }
    catch (error) { cleanup(); reject(error); }
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${src}`));
    img.src = src;
  });
}

function clearCurrentUrl() {
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentUrl = null;
  state.currentBlob = null;
  state.currentModelInfo = null;
  els.downloadLink.innerHTML = '';
}

function setProgress(v, msg) {
  els.progressFill.style.width = `${Math.max(0, Math.min(100, v))}%`;
  if (msg) els.statusText.textContent = msg;
}

function setStatus(msg, isError = false) {
  els.statusText.textContent = msg;
  els.statusText.style.color = isError ? '#b42318' : '#50657f';
}

function formatInputDimension(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0';
}
