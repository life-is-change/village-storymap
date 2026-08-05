const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CORRECTION_PROMPT,
  automaticRoofHeight,
  buildBuildingFields,
  buildDirectPreparePath,
  buildRectifyPath,
  buildOriginalFallbackPath,
  buildPhotoUploadConfig,
  buildModelReadyMessage,
  clampPoint,
  clampCropTop,
  pixelsToNormalized,
  photoHeightSummary,
  photoModelMetrics,
  readTargetDimensions,
  resolveInitialMode,
  shouldApplyPresetAfterLoad,
  transitionJobState,
  friendlyServiceError,
  validateStandardFacadeFiles
} = require('../photo-workflow.js');

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
      roofType: 'hip'
    }
  );
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
      roof_type: 'gable'
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
