const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CORRECTION_PROMPT,
  automaticRoofHeight,
  buildBuildingFields,
  buildDirectPreparePath,
  buildRectifyPath,
  buildOriginalFallbackPath,
  buildPhotoUploadConfig,
  buildRoofAnalysisForm,
  buildRoofAnalysisPath,
  buildModelReadyMessage,
  clampPoint,
  clampCropTop,
  pixelsToNormalized,
  photoHeightSummary,
  photoModelMetrics,
  clearRoofOverrides,
  isLocalServiceNetworkError,
  nextRoofAnalysisState,
  normalizeRoofAnalysis,
  readTargetDimensions,
  resolveInitialMode,
  serviceStatusPresentation,
  roofAnalysisChoices,
  roofAnalysisSummary,
  shouldApplyPresetAfterLoad,
  transitionJobState,
  transitionServiceState,
  friendlyServiceError,
  validateStandardFacadeFiles,
  normalizeFacadeRun,
  transitionFacadeState,
  facadeStatusPresentation,
  chooseDefaultHistoricalPhoto,
  canConfirmCrop,
  shouldRestoreFacadeRun
} = require('../photo-workflow.js');

test('remote facade flow pauses at awaiting_crop', () => {
  assert.equal(transitionFacadeState('queued_rectification', 'claimed'), 'rectifying');
  assert.equal(transitionFacadeState('rectifying', 'rectified'), 'awaiting_crop');
  assert.equal(canConfirmCrop({ status: 'awaiting_crop' }), true);
});

test('completed run may regenerate without rectifying again', () => {
  assert.equal(transitionFacadeState('completed', 'confirm_crop'), 'queued_generation');
  assert.equal(canConfirmCrop({ status: 'completed' }), true);
});

test('historical photos default to newest but preserve manual selection', () => {
  const photos = [{ id: '9' }, { id: '7' }];
  assert.equal(chooseDefaultHistoricalPhoto(photos)?.id, '9');
  assert.equal(chooseDefaultHistoricalPhoto(photos, '7')?.id, '7');
  assert.equal(chooseDefaultHistoricalPhoto(photos, 'missing')?.id, '9');
});

test('reload restores the newest active or completed run for the building', () => {
  assert.equal(shouldRestoreFacadeRun({ status: 'rectifying' }), true);
  assert.equal(shouldRestoreFacadeRun({ status: 'completed' }), true);
  assert.equal(shouldRestoreFacadeRun({ status: 'failed' }), false);
  assert.deepEqual(normalizeFacadeRun({ id: 'r1', current_stage: 'mesh', progress: 72 }), {
    id: 'r1', status: '', stage: 'mesh', progress: 72, errorCode: '', errorMessage: ''
  });
  assert.match(facadeStatusPresentation({ status: 'awaiting_crop', progress: 50 }).message, /拖动屋顶线/);
});

test('photo mode uses the Supabase queue instead of direct localhost job APIs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /FacadeQueueClient\.createFacadeQueueClient/);
  assert.match(source, /findLatestRun/);
  assert.match(source, /confirmCrop/);
  assert.match(source, /createArtifactUrl/);
  assert.doesNotMatch(source, /apiRequest\(['"`]\/health/);
  assert.doesNotMatch(source, /apiRequest\(['"`]\/api\/jobs/);
  assert.doesNotMatch(source, /buildDirectPreparePath\(/);
  assert.doesNotMatch(source, /buildRectifyPath\(/);
});

test('automatic roof summary keeps the normal workflow to one compact line', () => {
  const analysis = {
    type: { value: 'hip', confidence: 0.88, source: 'automatic' },
    material: { value: 'gray_tile', confidence: 0.91, source: 'automatic' },
    pitch: { value: 'high', confidence: 0.76, source: 'automatic' },
    warnings: []
  };

  assert.equal(
    roofAnalysisSummary(analysis),
    '已自动匹配：岭南灰瓦 · 四坡屋顶 · 高坡'
  );
  assert.deepEqual(roofAnalysisChoices(analysis), {
    roofType: 'hip',
    roofMaterial: 'gray_tile',
    roofPitch: 'high'
  });
});

test('fallback roof summary explains that safe defaults were used', () => {
  assert.equal(
    roofAnalysisSummary({
      type: { value: 'hip', confidence: 0, source: 'fallback' },
      material: { value: 'gray_tile', confidence: 0, source: 'fallback' },
      pitch: { value: 'standard', confidence: 0, source: 'fallback' },
      warnings: ['roof_region_unclear']
    }),
    '屋顶信息不够清晰，已使用稳妥默认样式：岭南灰瓦 · 四坡屋顶 · 标准坡'
  );
});

test('roof analysis form serializes crop revision and only manual overrides', () => {
  const form = buildRoofAnalysisForm({
    cropTop: 0.27,
    revision: 8,
    overrides: { roofPitch: 'high', roofMaterial: 'terracotta_tile' }
  });

  assert.equal(buildRoofAnalysisPath('job 1'), '/api/jobs/job%201/analyze-roof');
  assert.deepEqual(Object.fromEntries(form.entries()), {
    roof_top_norm: '0.27',
    revision: '8',
    roof_material_override: 'terracotta_tile',
    roof_pitch_override: 'high'
  });
});

test('moving the crop line preserves manual fields but invalidates automatic analysis', () => {
  const next = nextRoofAnalysisState({
    cropTop: 0.19,
    revision: 2,
    status: 'ready',
    analysis: { type: { value: 'gable' } },
    overrides: { roofPitch: 'high' }
  }, { cropTop: 0.27 });

  assert.deepEqual(next.overrides, { roofPitch: 'high' });
  assert.equal(next.analysis, null);
  assert.equal(next.status, 'pending');
  assert.equal(next.cropTop, 0.27);
  assert.equal(next.revision, 3);
});

test('new upload clears all manual roof choices and normalizes API decisions', () => {
  assert.deepEqual(clearRoofOverrides(), {
    analysis: null,
    overrides: {},
    status: 'idle',
    revision: 0
  });
  assert.deepEqual(normalizeRoofAnalysis({
    type: { value: 'unknown', confidence: 5, source: 'automatic' },
    material: { value: 'terracotta_tile', confidence: 0.82, source: 'manual' },
    pitch: { value: 'low', confidence: -1, source: 'fallback' },
    crop_top: 0.25,
    revision: 4,
    warnings: []
  }), {
    type: { value: 'hip', confidence: 1, source: 'fallback' },
    material: { value: 'terracotta_tile', confidence: 0.82, source: 'manual' },
    pitch: { value: 'low', confidence: 0, source: 'fallback' },
    cropTop: 0.25,
    revision: 4,
    warnings: []
  });
});

test('service recovery state only offers retry after an offline photo failure', () => {
  assert.equal(transitionServiceState('checking', 'failure', false), 'offline');
  assert.equal(transitionServiceState('offline', 'success', false), 'online');
  assert.equal(transitionServiceState('offline', 'success', true), 'recovered');
  assert.equal(transitionServiceState('recovered', 'retry', true), 'checking');
  assert.equal(transitionServiceState('online', 'failure', true), 'offline');
  assert.throws(
    () => transitionServiceState('online', 'unknown', false),
    /Invalid service state transition/
  );
});

test('only tagged fetch failures are treated as local service outages', () => {
  const networkError = new Error('本地处理服务未启动或不可访问');
  networkError.code = 'LOCAL_SERVICE_UNREACHABLE';
  assert.equal(isLocalServiceNetworkError(networkError), true);
  assert.equal(
    isLocalServiceNetworkError(new Error('Could not find both sides of the target facade')),
    false
  );
});

test('service status presentation exposes recovery only after service returns', () => {
  assert.deepEqual(serviceStatusPresentation('checking'), {
    tone: 'checking',
    message: '正在检测本地生成服务…',
    canRecover: false
  });
  assert.deepEqual(serviceStatusPresentation('offline'), {
    tone: 'offline',
    message: '本地服务未启动，请运行 start_facade_generator.bat。',
    canRecover: false
  });
  assert.deepEqual(serviceStatusPresentation('recovered'), {
    tone: 'recovered',
    message: '服务已恢复，可以重新处理当前照片。',
    canRecover: true
  });
});

test('reads the selected white-model footprint from launch parameters', () => {
  assert.deepEqual(
    readTargetDimensions(new URLSearchParams('targetLength=12.4&targetDepth=7.1')),
    { length: 12.4, depth: 7.1 }
  );
  assert.equal(readTargetDimensions(new URLSearchParams('targetLength=bad&targetDepth=7.1')), null);
});

test('photo upload does not depend on hidden floor inputs before facade height is known', () => {
  assert.deepEqual(
    buildPhotoUploadConfig({ length: 16.7, width: 11, roofType: 'hip' }),
    {
      length: 16.7,
      width: 11,
      floors: 1,
      floorHeight: 3,
      roofHeight: 0.54,
      roofType: 'hip',
      roofMaterial: 'gray_tile',
      roofPitch: 'standard'
    }
  );
});

test('photo upload normalizes supported roof appearance choices', () => {
  const config = buildPhotoUploadConfig({
    length: 16.7,
    width: 11,
    roofType: 'hip',
    roofMaterial: 'asphalt_shingle',
    roofPitch: 'low'
  });
  assert.equal(config.roofMaterial, 'asphalt_shingle');
  assert.equal(config.roofPitch, 'low');

  const fallback = buildPhotoUploadConfig({ length: 10, width: 6, roofType: 'gable' });
  assert.equal(fallback.roofMaterial, 'gray_tile');
  assert.equal(fallback.roofPitch, 'standard');
});

test('platform-launched generator opens directly in photo mode', () => {
  assert.equal(resolveInitialMode(new URLSearchParams('mode=photo&targetCode=B-17')), 'photo');
  assert.equal(resolveInitialMode(new URLSearchParams('targetCode=B-17')), 'photo');
  assert.equal(resolveInitialMode(new URLSearchParams('mode=preset')), 'preset');
});

test('late preset metadata cannot overwrite an active photo upload', () => {
  assert.equal(shouldApplyPresetAfterLoad('photo', true), false);
  assert.equal(shouldApplyPresetAfterLoad('photo', false), false);
  assert.equal(shouldApplyPresetAfterLoad('preset', false), true);
});

test('clamps the student roof boundary to the safe crop range', () => {
  assert.equal(clampCropTop(-0.2), 0);
  assert.equal(clampCropTop(0.27), 0.27);
  assert.equal(clampCropTop(0.9), 0.65);
  assert.equal(clampCropTop('bad'), 0.12);
});

test('derives roof height without another student dimension field', () => {
  assert.equal(automaticRoofHeight(12, 'hip'), 2.16);
  assert.equal(automaticRoofHeight(10, 'gable'), 1.8);
  assert.equal(automaticRoofHeight(6, 'flat'), 0.24);
});

test('builds the direct preparation URL with a normalized top crop', () => {
  assert.equal(
    buildDirectPreparePath('job 1', 0.175),
    '/api/jobs/job%201/prepare-direct?crop_top=0.175'
  );
});

test('builds the rectification URL before roof cropping', () => {
  assert.equal(buildRectifyPath('job 1'), '/api/jobs/job%201/rectify');
  assert.equal(buildOriginalFallbackPath('job 1'), '/api/jobs/job%201/rectify?use_original=true');
});

test('turns a refused local backend connection into an actionable message', () => {
  assert.match(
    friendlyServiceError(new TypeError('Failed to fetch')),
    /start_facade_generator\.bat/
  );
  assert.doesNotMatch(
    friendlyServiceError(new TypeError('Failed to fetch')),
    /^Failed to fetch$/
  );
});

test('turns an automatic facade boundary failure into a Chinese recovery message', () => {
  assert.match(
    friendlyServiceError(new Error('Could not find both sides of the target facade')),
    /未能可靠识别建筑主体的左右边界/
  );
});

test('provides the approved prompt used by the external correction workflow', () => {
  assert.equal(
    CORRECTION_PROMPT,
    '把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影'
  );
});

test('accepts one JPEG or PNG no larger than ten megabytes', () => {
  const jpeg = { name: 'facade.jpg', type: 'image/jpeg', size: 1024 };
  assert.deepEqual(validateStandardFacadeFiles([jpeg]), { ok: true, file: jpeg });
});

test('rejects empty, multiple, unsupported, and oversized facade uploads', () => {
  const jpeg = { name: 'facade.jpg', type: 'image/jpeg', size: 1024 };
  assert.match(validateStandardFacadeFiles([]).message, /一张/);
  assert.match(validateStandardFacadeFiles([jpeg, jpeg]).message, /只能上传一张/);
  assert.match(
    validateStandardFacadeFiles([{ name: 'facade.webp', type: 'image/webp', size: 1024 }]).message,
    /JPG 或 PNG/
  );
  assert.match(
    validateStandardFacadeFiles([{
      name: 'large.png',
      type: 'image/png',
      size: 10 * 1024 * 1024 + 1
    }]).message,
    /10 MB/
  );
});

test('clampPoint keeps dragged handles inside the displayed photo', () => {
  assert.deepEqual(clampPoint({ x: -0.25, y: 1.4 }), { x: 0, y: 1 });
  assert.deepEqual(clampPoint({ x: 0.35, y: 0.7 }), { x: 0.35, y: 0.7 });
});

test('pixelsToNormalized uses the last pixel as coordinate one', () => {
  const normalized = pixelsToNormalized(
    [
      { x: 0, y: 0 },
      { x: 399, y: 0 },
      { x: 399, y: 299 },
      { x: 0, y: 299 }
    ],
    400,
    300
  );

  assert.deepEqual(normalized, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ]);
});

test('buildBuildingFields maps front width, depth and total wall height', () => {
  assert.deepEqual(
    buildBuildingFields({
      length: 9.5,
      width: 6.2,
      floors: 2,
      floorHeight: 3.1,
      roofHeight: 1.6,
      roofType: 'gable'
    }),
    {
      building_width: '9.5',
      building_depth: '6.2',
      wall_height: '6.2',
      roof_height: '1.6',
      roof_type: 'gable',
      roof_material: 'gray_tile',
      roof_pitch: 'standard'
    }
  );
});

test('buildBuildingFields preserves the selected hipped roof', () => {
  assert.equal(
    buildBuildingFields({
      length: 9.4,
      width: 7.6,
      floors: 4,
      floorHeight: 3,
      roofHeight: 2.16,
      roofType: 'hip'
    }).roof_type,
    'hip'
  );
});

test('buildBuildingFields includes the normalized roof appearance contract', () => {
  assert.deepEqual(
    buildBuildingFields({
      length: 16.7,
      width: 11,
      floors: 1,
      floorHeight: 3,
      roofHeight: 0.54,
      roofType: 'hip',
      roofMaterial: 'asphalt_shingle',
      roofPitch: 'low'
    }),
    {
      building_width: '16.7',
      building_depth: '11',
      wall_height: '3',
      roof_height: '0.54',
      roof_type: 'hip',
      roof_material: 'asphalt_shingle',
      roof_pitch: 'low'
    }
  );
});

test('transitionJobState rejects skipped workflow stages', () => {
  assert.equal(transitionJobState('idle', 'upload'), 'uploading');
  assert.equal(transitionJobState('uploading', 'uploaded'), 'rectifying');
  assert.equal(transitionJobState('rectifying', 'rectified'), 'rectified');
  assert.equal(transitionJobState('rectified', 'prepare'), 'preparing');
  assert.equal(transitionJobState('preparing', 'prepared'), 'generating');
  assert.equal(transitionJobState('generating', 'generated'), 'generated');
  assert.equal(transitionJobState('rectifying', 'failed'), 'error');
  assert.equal(transitionJobState('error', 'use_original'), 'rectified');
  assert.throws(
    () => transitionJobState('uploading', 'prepare'),
    /Invalid photo workflow transition/
  );
});

test('buildModelReadyMessage preserves the platform handoff contract', () => {
  const buffer = new ArrayBuffer(8);
  const message = buildModelReadyMessage({
    targetCode: 'B-17',
    targetName: '17号建筑',
    targetSpace: 'current',
    modelId: 'photo-job-1',
    glbBuffer: buffer,
    metrics: { totalHeight: 7.8, length: 9.5, width: 6.2 }
  });

  assert.equal(message.type, 'village-house-generator:model-ready');
  assert.equal(message.payload.sourceCode, 'B-17');
  assert.equal(message.payload.presetId, 'photo-job-1');
  assert.equal(message.payload.glbBuffer, buffer);
  assert.deepEqual(message.payload.modelMetrics, {
    totalHeight: 7.8,
    length: 9.5,
    width: 6.2
  });
  assert.equal(message.payload.modelScale, 10);
});

test('photo mode reports and hands off backend-derived dimensions', () => {
  const building = {
    width: 10,
    depth: 7.2,
    wall_height: 5,
    roof_height: 0.9,
    roof_type: 'hip'
  };

  assert.equal(photoHeightSummary(building), '墙体高度 5.00 m · 含屋顶总高 5.90 m');
  assert.deepEqual(photoModelMetrics(building), {
    totalHeight: 5.9,
    length: 10,
    width: 7.2
  });
});
