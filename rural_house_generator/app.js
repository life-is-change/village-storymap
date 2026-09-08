import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PhotoWorkflow = window.PhotoWorkflow;
const PhotoMaterialBridge = window.PhotoMaterialBridge;
const FacadeQueueClient = window.FacadeQueueClient;

const els = {
  presetList: document.getElementById('presetList'),
  presetCount: document.getElementById('presetCount'),
  searchInput: document.getElementById('searchInput'),
  presetModeBtn: document.getElementById('presetModeBtn'),
  photoModeBtn: document.getElementById('photoModeBtn'),
  presetSection: document.getElementById('presetSection'),
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
  floorsInput: document.getElementById('floorsInput'),
  floorHeightInput: document.getElementById('floorHeightInput'),
  photoHeightSummary: document.getElementById('photoHeightSummary'),
  presetOnlyFields: document.querySelectorAll('[data-preset-only]'),
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
  meta: null,
  presets: [],
  selected: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  currentGroup: null,
  currentBlob: null,
  currentUrl: null,
  currentModelInfo: null,
  mode: 'preset',
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
  facadePollDelay: 2000
};

init();

async function init() {
  if (!PhotoWorkflow) throw new Error('photo-workflow.js 加载失败');
  if (!PhotoMaterialBridge) throw new Error('photo-material-bridge.js 加载失败');
  if (!FacadeQueueClient) throw new Error('facade-queue-client.js 加载失败');
  parseTargetParams();
  initThree();
  bindEvents();
  els.correctionPrompt.value = PhotoWorkflow.CORRECTION_PROMPT;
  setMode(PhotoWorkflow.resolveInitialMode(new URLSearchParams(window.location.search)));
  requestExistingPhotoMaterials();
  await loadMeta();
}

function parseTargetParams() {
  const params = new URLSearchParams(window.location.search);
  state.targetCode = String(params.get('targetCode') || '').trim();
  state.targetSpace = String(params.get('targetSpace') || 'current').trim() || 'current';
  state.targetName = String(params.get('targetName') || '').trim();
  state.targetDimensions = PhotoWorkflow.readTargetDimensions(params);
}

function bindEvents() {
  els.searchInput.addEventListener('input', renderPresetList);
  els.presetModeBtn.addEventListener('click', () => setMode('preset'));
  els.photoModeBtn.addEventListener('click', () => setMode('photo'));
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
    if (document.hidden || state.mode !== 'photo') clearFacadePollTimer();
    else if (state.currentFacadeRun) scheduleFacadePoll(0);
  });
  els.generateBtn.addEventListener('click', () => {
    if (state.mode === 'photo') generatePhotoModel();
    else generateModel();
  });
  els.downloadBtn.addEventListener('click', downloadGlb);
  els.sendBtn.addEventListener('click', replaceOriginalBuilding);
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
    button.addEventListener('click', () => useExistingPhotoMaterial(photo, button));
    footer.append(meta, button);
    card.append(image, footer);
    els.existingPhotoMaterialList.append(card);
  });
  els.existingPhotoMaterialList.hidden = false;
}

async function useExistingPhotoMaterial(photo, button) {
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = '提交中…';
  setStatus('正在把已有建筑照片提交到 4090 队列…');
  try {
    if (!PhotoMaterialBridge.isQueueablePhoto(photo)) throw new Error('该历史照片缺少稳定的数据库 ID');
    state.selectedPhotoId = photo.id;
    renderExistingPhotoMaterials(`已选择照片 ${photo.id}`);
    await submitFacadePhoto(photo);
  } catch (error) {
    console.error('提交已有建筑照片失败：', error);
    setStatus(`已有照片提交失败：${error.message}`, true);
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = '使用这张';
  }
}

async function initializeFacadeQueue(context) {
  if (String(context.sourceCode || '').trim() !== state.targetCode) return;
  if (!context.hasAuthenticatedSession) {
    setStatus('登录会话已失效，请重新登录平台后再打开生成器。', true);
    return;
  }
  const openerClient = window.opener?.VillageSupabaseClient;
  if (!openerClient) {
    state.photoServiceStatus = 'offline';
    renderPhotoServiceState();
    setStatus('未取得平台登录会话，请从已登录的平台重新打开生成器。', true);
    return;
  }
  state.facadeContext = {
    courseId: String(context.courseId || ''),
    spaceId: String(context.spaceId || state.targetSpace),
    sourceCode: state.targetCode
  };
  if (!state.facadeContext.courseId) {
    setStatus('当前课程上下文不完整，暂时不能提交生成任务。', true);
    return;
  }
  state.facadeQueue = FacadeQueueClient.createFacadeQueueClient(openerClient);
  state.photoServiceStatus = 'online';
  renderPhotoServiceState();
  try {
    const latest = await state.facadeQueue.findLatestRun({
      spaceId: state.facadeContext.spaceId,
      objectCode: state.targetCode
    });
    if (PhotoWorkflow.shouldRestoreFacadeRun(latest)) await attachFacadeRun(latest);
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
  renderExistingPhotoMaterials('新照片已保存，正在提交预处理');
  await submitFacadePhoto(photo);
}

async function submitFacadePhoto(photo) {
  if (!state.facadeQueue || !state.facadeContext) {
    throw new Error('平台登录上下文尚未就绪');
  }
  const runId = await state.facadeQueue.submit({
    courseId: state.facadeContext.courseId,
    spaceId: state.facadeContext.spaceId,
    objectCode: state.targetCode,
    photoId: Number(photo.id)
  });
  const run = await state.facadeQueue.getRun(runId);
  await attachFacadeRun(run);
}

async function attachFacadeRun(run) {
  state.currentFacadeRun = run;
  state.photoJobId = String(run?.id || '');
  state.photoWorkflowState = String(run?.status || 'idle');
  state.facadeUnsubscribe?.();
  state.facadeUnsubscribe = state.facadeQueue.subscribe(state.photoJobId, (event) => {
    if (event?.new) void applyFacadeRun(event.new);
  });
  await applyFacadeRun(run);
  scheduleFacadePoll();
}

async function applyFacadeRun(run) {
  state.currentFacadeRun = run;
  state.photoWorkflowState = String(run?.status || 'idle');
  const presentation = PhotoWorkflow.facadeStatusPresentation(run, state.photoServiceStatus);
  setProgress(presentation.progress, presentation.message);
  setStatus(presentation.message, run?.status === 'failed');
  renderFacadeStep(run?.status);
  if (PhotoWorkflow.canConfirmCrop(run)) {
    await loadRectifiedPreview(run);
  }
  if (run?.status === 'completed') {
    await loadCompletedFacadeModel(run);
  }
  if (presentation.terminal) clearFacadePollTimer();
}

function renderFacadeStep(status) {
  if (['queued_rectification', 'claimed_rectification'].includes(status)) setPhotoStep('identify');
  else if (status === 'rectifying') setPhotoStep('rectify');
  else if (status === 'awaiting_crop') setPhotoStep('crop');
  else if (['queued_generation', 'claimed_generation', 'generating', 'completed'].includes(status)) setPhotoStep('generate');
  else if (status === 'failed') setPhotoStep('rectify', true);
}

async function facadeArtifact(runId, artifactType) {
  const artifacts = await state.facadeQueue.listArtifacts(runId);
  return [...(artifacts || [])]
    .reverse()
    .find((item) => item.artifact_type === artifactType) || null;
}

async function loadRectifiedPreview(run) {
  const artifact = await facadeArtifact(run.id, 'rectified_preview');
  if (!artifact) throw new Error('正立面预处理未返回预览图');
  const url = await state.facadeQueue.createArtifactUrl(artifact.storage_path);
  state.rectifiedUrl = url;
  state.photoImage = await loadImage(url);
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

async function loadCompletedFacadeModel(run) {
  const artifact = await facadeArtifact(run.id, 'building_glb');
  if (!artifact) throw new Error('任务已完成，但未找到 GLB');
  const url = await state.facadeQueue.createArtifactUrl(artifact.storage_path);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GLB 下载失败（${response.status}）`);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const group = await parseGlb(arrayBuffer);
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

function setMode(mode) {
  state.mode = mode === 'photo' ? 'photo' : 'preset';
  const isPhoto = state.mode === 'photo';
  els.presetModeBtn.classList.toggle('active', !isPhoto);
  els.photoModeBtn.classList.toggle('active', isPhoto);
  els.presetSection.hidden = isPhoto;
  els.photoSection.hidden = !isPhoto;
  els.presetOnlyFields.forEach((field) => { field.hidden = isPhoto; });
  els.photoHeightSummary.hidden = !isPhoto;
  els.generateBtn.textContent = isPhoto ? '生成正立面贴图建筑' : '生成 3D 建筑';
  els.configHint.innerHTML = isPhoto
    ? '填写白模正面长度与进深；墙体高度将在裁掉屋顶后按正立面宽高比自动计算。'
    : '默认参数读取自 <code>normalization_meta.json</code>，点击样式后会自动同步，可手动微调后重新生成。';
  if (isPhoto) {
    renderPhotoServiceState();
    els.activeLabel.textContent = state.photoFile
      ? `建筑实拍图：${state.photoFile.name}`
      : '建筑实拍图：未选择';
    setProgress(0, '等待建筑实拍图');
    setStatus('上传实拍图后，系统会先自动处理成正立面；完成后再显示屋顶裁剪线。');
    if (!state.photoJobId) {
      els.photoHeightSummary.querySelector('strong').textContent = '裁剪屋顶后，将按正立面比例自动计算';
    }
  } else {
    clearFacadePollTimer();
    els.activeLabel.textContent = `当前：${state.selected?.id || '-'}`;
    setProgress(state.presets.length ? 20 : 0, state.presets.length ? '预设已就绪' : '等待加载预设');
    setStatus('预设模式保持原有四立面生成流程。');
  }
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
  if (!state.facadeQueue || !state.photoJobId || state.mode !== 'photo' || document.hidden) return;
  state.facadePollTimer = window.setTimeout(pollFacadeRun, delay);
}

function renderPhotoServiceState() {
  const online = state.photoServiceStatus === 'online';
  els.photoServiceState.dataset.tone = online ? 'online' : 'offline';
  els.photoServiceMessage.textContent = online
    ? '4090 远程生成队列已连接。'
    : '等待平台登录会话或 4090 队列连接。';
  els.recoverPhotoBtn.hidden = online;
}

async function pollFacadeRun() {
  clearFacadePollTimer();
  if (!state.facadeQueue || !state.photoJobId || document.hidden) return;
  try {
    const run = await state.facadeQueue.getRun(state.photoJobId);
    state.photoServiceStatus = 'online';
    state.facadePollDelay = 2000;
    await applyFacadeRun(run);
  } catch (error) {
    console.warn('轮询正立面任务失败：', error);
    state.photoServiceStatus = 'offline';
    state.facadePollDelay = Math.min(15000, Math.max(2000, state.facadePollDelay * 1.6));
    renderPhotoServiceState();
  }
  if (!['completed', 'failed', 'canceled'].includes(state.currentFacadeRun?.status)) {
    scheduleFacadePoll();
  }
}

async function recoverCurrentPhoto() {
  if (state.currentFacadeRun) {
    state.facadePollDelay = 2000;
    await pollFacadeRun();
  } else {
    requestExistingPhotoMaterials();
  }
}

async function useOriginalPhoto() {
  setStatus('远程流程会保留原照片，请重新选择照片后提交。', true);
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

async function loadMeta() {
  try {
    setProgress(8, '读取 normalization_meta.json ...');
    const res = await fetch('./normalization_meta.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`normalization_meta.json 读取失败：${res.status}`);

    state.meta = await res.json();
    state.presets = [...(state.meta.presets || [])].sort(sortPreset);
    if (!state.presets.length) throw new Error('normalization_meta.json 中没有 presets。');

    state.selected = state.presets[0];
    renderPresetList();
    if (PhotoWorkflow.shouldApplyPresetAfterLoad(state.mode, Boolean(state.photoFile))) {
      applyPresetToInputs(state.selected);
      setProgress(20, `已载入 ${state.presets.length} 个建筑预设`);
      setStatus('已载入预设。点击左侧样式后，基础参数会自动同步。');
    } else if (!state.photoFile) {
      if (state.targetDimensions) {
        els.lengthInput.value = formatInputDimension(state.targetDimensions.length);
        els.widthInput.value = formatInputDimension(state.targetDimensions.depth);
      } else {
        applyPresetDimensionsToInputs(state.selected);
      }
      setProgress(0, '等待建筑实拍图');
      setStatus('上传实拍图后，系统会先自动处理成正立面；完成后再显示屋顶裁剪线。');
    }
  } catch (err) {
    console.error(err);
    setProgress(0, '加载失败');
    setStatus(`加载失败：${err.message}\n请使用本地静态服务打开 index.html。`, true);
  }
}

function sortPreset(a, b) {
  const pa = String(a.id || '').split('-').map(Number);
  const pb = String(b.id || '').split('-').map(Number);
  return (pa[0] || 0) - (pb[0] || 0) || (pa[1] || 0) - (pb[1] || 0);
}

function renderPresetList() {
  const q = els.searchInput.value.trim().toLowerCase();
  const filtered = state.presets.filter((preset) => {
    const text = `${preset.id} ${preset.name || ''} ${preset.floors}层 ${preset.dimensions?.length} ${preset.dimensions?.width}`.toLowerCase();
    return !q || text.includes(q);
  });

  els.presetCount.textContent = `${filtered.length}/${state.presets.length}`;
  els.presetList.innerHTML = '';

  for (const preset of filtered) {
    const card = document.createElement('article');
    card.className = `preset-card ${state.selected?.id === preset.id ? 'active' : ''}`;
    card.innerHTML = `
      <img src="${preset.url}" alt="${preset.id}" loading="lazy" />
      <div class="preset-info">
        <div>
          <h3>${preset.id}</h3>
          <p>${preset.floors} 层建筑样式</p>
          <p>L=${formatNum(preset.dimensions?.length)}m, W=${formatNum(preset.dimensions?.width)}m</p>
        </div>
        <button class="choose" type="button">${state.selected?.id === preset.id ? '当前样式' : '选择此样式'}</button>
      </div>`;
    card.addEventListener('click', () => selectPreset(preset));
    els.presetList.appendChild(card);
  }
}

function selectPreset(preset) {
  state.selected = preset;
  applyPresetToInputs(preset);
  renderPresetList();
  setStatus(`已选择 ${preset.id}，基础参数已同步更新。可直接生成，也可继续微调。`);
}

function applyPresetToInputs(preset) {
  applyPresetDimensionsToInputs(preset);
  els.activeLabel.textContent = `当前：${preset.id}`;
}

function applyPresetDimensionsToInputs(preset) {
  els.lengthInput.value = formatInputDimension(preset.dimensions?.length ?? 10);
  els.widthInput.value = formatInputDimension(preset.dimensions?.width ?? 7);
  els.floorsInput.value = preset.floors ?? 2;
  els.floorHeightInput.value = formatInputDimension(preset.dimensions?.floorHeight ?? 3);
}

async function generateModel() {
  if (!state.selected) return;
  const preset = state.selected;

  try {
    els.generateBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.sendBtn.disabled = true;
    clearCurrentUrl();

    setProgress(28, '读取四立面图片...');
    setStatus(`正在处理 ${preset.id}：按 JSON 参数拆分 front/back/left/right。`);
    const image = await loadImage(preset.url);

    setProgress(45, '裁切立面贴图...');
    const extracted = extractFacadeTextures(image, preset);

    setProgress(62, '生成 3D 建筑...');
    const config = readConfig(preset);
    const group = createBuildingGroup(preset, config, extracted.textures);
    replaceModel(group);
    frameModel(group);

    setProgress(82, '导出 GLB ...');
    const { blob, url } = await exportGlb(group);
    state.currentBlob = blob;
    state.currentUrl = url;
    const roofHeight = Math.max(
      0.45,
      Number(preset?.roof?.height || 0) || config.bodyHeight * Number(preset?.roof?.heightRatioToBody || 0.24)
    );
    state.currentModelInfo = {
      id: preset.id,
      metrics: {
        totalHeight: config.bodyHeight + roofHeight,
        length: config.length,
        width: config.width
      }
    };
    els.downloadBtn.disabled = false;
    els.sendBtn.disabled = false;
    els.downloadLink.innerHTML = `<a href="${url}" download="${preset.id}.glb">下载 ${preset.id}.glb</a>`;
    setProgress(100, '生成完成');
    setStatus(buildGenerateCompleteMessage(preset.id));
  } catch (err) {
    console.error(err);
    setProgress(0, '生成失败');
    setStatus(`生成失败：${err.message}`, true);
  } finally {
    els.generateBtn.disabled = false;
  }
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

  try {
    setPhotoStep('generate');
    els.generateBtn.disabled = true;
    els.photoGenerateBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.sendBtn.disabled = true;
    clearCurrentUrl();

    await state.facadeQueue.confirmCrop(state.photoJobId, {
      cropTop: state.cropTop,
      roofType: els.roofTypeInput.value,
      buildingWidth: Number(els.lengthInput.value),
      buildingDepth: Number(els.widthInput.value)
    });
    state.photoWorkflowState = 'queued_generation';
    setProgress(55, '已确认屋顶线，等待 4090 生成模型…');
    const run = await state.facadeQueue.getRun(state.photoJobId);
    await applyFacadeRun(run);
    scheduleFacadePoll(0);
  } catch (error) {
    console.error(error);
    setProgress(0, '生成失败');
    setStatus(`提交生成失败：${String(error?.message || error)}`, true);
  } finally {
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

function buildGenerateCompleteMessage(presetId) {
  if (state.targetCode && window.opener) {
    return `生成完成：${presetId}\n可下载 GLB，也可点击“替换原建筑”同步到主平台。`;
  }
  return `生成完成：${presetId}\n可下载 GLB。`;
}

function readConfig(preset) {
  const floors = clamp(Number(els.floorsInput.value || preset.floors || 2), 1, 8);
  const floorHeight = clamp(Number(els.floorHeightInput.value || preset.dimensions?.floorHeight || 3), 2.4, 6);

  return {
    length: clamp(Number(els.lengthInput.value || preset.dimensions?.length || 10), 3, 100),
    width: clamp(Number(els.widthInput.value || preset.dimensions?.width || 7), 3, 100),
    floors,
    floorHeight,
    bodyHeight: floors * floorHeight
  };
}

function extractFacadeTextures(image, preset) {
  const textures = {};

  for (const side of ['front', 'back', 'left', 'right']) {
    const facade = preset.facades?.[side];
    if (!facade) throw new Error(`${preset.id} 缺少 ${side} 立面参数。`);

    const rect = getPixelCrop(image, facade);
    const canvas = cropToCanvas(image, rect, 1024);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, state.renderer.capabilities.getMaxAnisotropy?.() || 4);
    texture.needsUpdate = true;
    textures[side] = texture;
  }

  return { textures };
}

function getPixelCrop(image, facade) {
  if (facade.pixelCrop) {
    return {
      x: facade.pixelCrop.x,
      y: facade.pixelCrop.y,
      w: facade.pixelCrop.w,
      h: facade.pixelCrop.h
    };
  }

  if (facade.sourceCrop) {
    return {
      x: facade.sourceCrop.x * image.width,
      y: facade.sourceCrop.y * image.height,
      w: facade.sourceCrop.w * image.width,
      h: facade.sourceCrop.h * image.height
    };
  }

  const quadrant = state.meta.imageLayout?.quadrants?.[facade.quadrant || 'front'];
  if (!quadrant) throw new Error('找不到 crop 参数。');

  return {
    x: quadrant.x * image.width,
    y: quadrant.y * image.height,
    w: quadrant.w * image.width,
    h: quadrant.h * image.height
  };
}

function cropToCanvas(image, rect, longSide = 1024) {
  const aspect = rect.w / rect.h;
  let w;
  let h;

  if (aspect >= 1) {
    w = longSide;
    h = Math.max(64, Math.round(longSide / aspect));
  } else {
    h = longSide;
    w = Math.max(64, Math.round(longSide * aspect));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return canvas;
}

function createBuildingGroup(preset, config, textures) {
  const group = new THREE.Group();
  group.name = `rural_house_${preset.id}`;
  group.userData = {
    app: 'rural-house-front-end-generator',
    presetId: preset.id,
    floors: config.floors,
    dimensions: {
      length: config.length,
      width: config.width,
      height: config.bodyHeight
    }
  };

  const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  const core = new THREE.Mesh(new THREE.BoxGeometry(config.length, config.bodyHeight, config.width), coreMat);
  core.name = 'white_core_body';
  core.position.y = config.bodyHeight / 2;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  group.add(createFacadePlanes(config, textures));
  group.add(createRoof(preset.roof || {}, config));
  group.add(createBase(config));
  return group;
}

function createFacadePlanes(config, textures) {
  const group = new THREE.Group();
  group.name = 'facade_textures';
  const eps = 0.018;
  const createMat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.88, side: THREE.FrontSide });

  const front = new THREE.Mesh(new THREE.PlaneGeometry(config.length, config.bodyHeight), createMat(textures.front));
  front.name = 'facade_front';
  front.position.set(0, config.bodyHeight / 2, config.width / 2 + eps);
  group.add(front);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(config.length, config.bodyHeight), createMat(textures.back));
  back.name = 'facade_back';
  back.position.set(0, config.bodyHeight / 2, -config.width / 2 - eps);
  back.rotation.y = Math.PI;
  group.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(config.width, config.bodyHeight), createMat(textures.left));
  left.name = 'facade_left';
  left.position.set(-config.length / 2 - eps, config.bodyHeight / 2, 0);
  left.rotation.y = -Math.PI / 2;
  group.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(config.width, config.bodyHeight), createMat(textures.right));
  right.name = 'facade_right';
  right.position.set(config.length / 2 + eps, config.bodyHeight / 2, 0);
  right.rotation.y = Math.PI / 2;
  group.add(right);

  return group;
}

function createBase(config) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(config.length * 1.04, 0.16, config.width * 1.04), mat);
  mesh.name = 'base_plinth';
  mesh.position.y = 0.08;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoof(roofInfo, config) {
  const roofHeight = Math.max(0.45, Number(roofInfo.height || 0) || config.bodyHeight * Number(roofInfo.heightRatioToBody || 0.24));
  const overhang = Math.max(0.08, config.width * Number(roofInfo.overhangRatioToWidth || 0.05));
  const mat = createRoofMaterial(roofInfo.material || {});
  const type = String(roofInfo.type || '').toLowerCase();

  if (type.includes('hip')) return createHipRoof(config.length, config.width, config.bodyHeight, roofHeight, overhang, mat);
  return createGableRoof(config.length, config.width, config.bodyHeight, roofHeight, overhang, mat, type.includes('front'));
}

function createGableRoof(length, width, y0, h, over, mat, ridgeAlongZ = false) {
  const L = length / 2 + over;
  const W = width / 2 + over;
  const y1 = y0 + h;
  let positions;
  let uvs;
  let indices;

  if (!ridgeAlongZ) {
    positions = new Float32Array([
      -L, y0, W, L, y0, W, L, y1, 0, -L, y1, 0,
      -L, y1, 0, L, y1, 0, L, y0, -W, -L, y0, -W,
      L, y0, W, L, y0, -W, L, y1, 0,
      -L, y0, -W, -L, y0, W, -L, y1, 0
    ]);
    uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1]);
    indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  } else {
    positions = new Float32Array([
      -L, y0, -W, -L, y0, W, 0, y1, W, 0, y1, -W,
      0, y1, -W, 0, y1, W, L, y0, W, L, y0, -W,
      -L, y0, W, L, y0, W, 0, y1, W,
      L, y0, -W, -L, y0, -W, 0, y1, -W
    ]);
    uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1]);
    indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'roof_gable';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHipRoof(length, width, y0, h, over, mat) {
  const L = length / 2 + over;
  const W = width / 2 + over;
  const y1 = y0 + h;
  const ridge = Math.max(0.05, L * 0.42);
  const vertices = [
    [-L, y0, W], [L, y0, W], [L, y0, -W], [-L, y0, -W],
    [-ridge, y1, 0], [ridge, y1, 0]
  ];
  const faces = [
    [0, 1, 5, 4], [3, 4, 5, 2], [1, 2, 5], [3, 0, 4]
  ];

  const pos = [];
  const uv = [];
  const idx = [];

  for (const face of faces) {
    const start = pos.length / 3;
    for (const vertexIndex of face) pos.push(...vertices[vertexIndex]);

    if (face.length === 4) {
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    } else {
      uv.push(0, 0, 1, 0, 0.5, 1);
      idx.push(start, start + 1, start + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'roof_hip';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoofMaterial(info) {
  const tex = proceduralRoofTexture(info);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(info.baseColor || '#2d2d30'),
    map: tex,
    roughness: Number(info.roughness ?? 0.86),
    side: THREE.DoubleSide
  });
}

function proceduralRoofTexture(info) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = info.baseColor || '#303033';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = info.tileColor || '#1f1f22';
  ctx.lineWidth = 3;

  for (let y = 10; y < 128; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 18) {
      ctx.quadraticCurveTo(x + 9, y + 5, x + 18, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#fff';
  for (let x = 0; x < 256; x += 30) ctx.fillRect(x, 0, 2, 128);
  ctx.globalAlpha = 1;

  return new THREE.CanvasTexture(canvas);
}

function initThree() {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
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
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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

  resetIdleCamera();
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

function resetIdleCamera() {
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(0, 18, 24);
  state.camera.lookAt(0, 0, 0);
  state.controls.update();
}

function resizeRenderer() {
  const rect = els.viewer.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(360, rect.height);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height, false);
}

function replaceModel(group) {
  if (state.currentGroup) {
    state.scene.remove(state.currentGroup);
    state.currentGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose?.();
        });
      }
    });
  }

  state.currentGroup = group;
  state.scene.add(group);
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
}

function exportGlb(group) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (arrayBuffer) => {
        const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
        resolve({ blob, url: URL.createObjectURL(blob) });
      },
      reject,
      { binary: true, embedImages: true, onlyVisible: true }
    );
  });
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

  try {
    els.sendBtn.disabled = true;
    setStatus('正在把生成模型发送回主平台...');

    const glbBuffer = await state.currentBlob.arrayBuffer();

    const message = PhotoWorkflow.buildModelReadyMessage({
      targetCode: state.targetCode,
      targetName: state.targetName,
      targetSpace: state.targetSpace,
      modelId: state.currentModelInfo.id,
      glbBuffer,
      metrics: state.currentModelInfo.metrics
    });
    window.opener.postMessage(
      message,
      window.location.origin,
      [glbBuffer]
    );

    setStatus('模型已发送，正在返回 3D 模块...');
    try {
      window.opener.focus();
    } catch (_) {}
    window.close();
  } catch (err) {
    console.error(err);
    setStatus(`同步失败：${err.message}`, true);
  } finally {
    els.sendBtn.disabled = false;
  }
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

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function formatInputDimension(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0';
}

function formatNum(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '-';
}
