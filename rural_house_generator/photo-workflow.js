(function exposePhotoWorkflow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhotoWorkflow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPhotoWorkflow() {
  const CORRECTION_PROMPT = '把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影';

  function resolveInitialMode(params) {
    const requested = String(params?.get?.('mode') || '').trim().toLowerCase();
    if (requested === 'photo' || requested === 'preset') return requested;
    return String(params?.get?.('targetCode') || '').trim() ? 'photo' : 'preset';
  }

  function shouldApplyPresetAfterLoad(mode, hasPhoto) {
    return mode === 'preset' && !hasPhoto;
  }

  function readTargetDimensions(params) {
    const length = Number(params?.get?.('targetLength'));
    const depth = Number(params?.get?.('targetDepth'));
    if (![length, depth].every((value) => Number.isFinite(value) && value > 0)) return null;
    return { length, depth };
  }

  function clamp(value, minimum, maximum) {
    const numeric = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : minimum));
  }

  function clampPoint(point) {
    return {
      x: clamp(point?.x, 0, 1),
      y: clamp(point?.y, 0, 1)
    };
  }

  function clampCropTop(value) {
    const numeric = Number(value);
    return clamp(Number.isFinite(numeric) ? numeric : 0.12, 0, 0.65);
  }

  function automaticRoofHeight(wallHeight, roofType) {
    const height = Number(wallHeight);
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error('Wall height must be a positive number');
    }
    const derived = roofType === 'flat' ? Math.max(0.2, height * 0.04) : height * 0.18;
    return Math.round(derived * 1000) / 1000;
  }

  function buildPhotoUploadConfig(config) {
    const provisionalFloorHeight = 3;
    return {
      length: Number(config?.length),
      width: Number(config?.width),
      floors: 1,
      floorHeight: provisionalFloorHeight,
      roofHeight: automaticRoofHeight(provisionalFloorHeight, config?.roofType),
      roofType: config?.roofType
    };
  }

  function buildDirectPreparePath(jobId, cropTop) {
    return `/api/jobs/${encodeURIComponent(jobId)}/prepare-direct?crop_top=${clampCropTop(cropTop)}`;
  }

  function buildRectifyPath(jobId) {
    return `/api/jobs/${encodeURIComponent(jobId)}/rectify`;
  }

  function buildOriginalFallbackPath(jobId) {
    return `${buildRectifyPath(jobId)}?use_original=true`;
  }

  function friendlyServiceError(error) {
    const message = String(error?.message || error || '');
    if (error instanceof TypeError || /failed to fetch|networkerror|connection refused/i.test(message)) {
      return '本地处理服务未启动或不可访问。请运行 start_facade_generator.bat 后重试。';
    }
    if (/could not find both sides of the target facade/i.test(message)) {
      return '未能可靠识别建筑主体的左右边界。可以使用原图继续，或换一张建筑边界更完整的照片。';
    }
    if (/not enough architectural lines|lacks reliable horizontal or vertical axes/i.test(message)) {
      return '照片中的建筑轴线不足，自动正立面校正未完成。可以使用原图继续，或重新选择照片。';
    }
    return message || '本地处理服务请求失败';
  }

  function pixelsToNormalized(points, imageWidth, imageHeight) {
    if (imageWidth < 2 || imageHeight < 2) {
      throw new Error('Photo dimensions must be at least 2 by 2 pixels');
    }
    if (!Array.isArray(points) || points.length !== 4) {
      throw new Error('Exactly four facade corners are required');
    }
    return points.map((point) => clampPoint({
      x: Number(point.x) / (imageWidth - 1),
      y: Number(point.y) / (imageHeight - 1)
    }));
  }

  function buildBuildingFields(config) {
    const length = Number(config.length);
    const width = Number(config.width);
    const floors = Number(config.floors);
    const floorHeight = Number(config.floorHeight);
    const roofHeight = Number(config.roofHeight);
    const values = [length, width, floors, floorHeight, roofHeight];
    if (!values.every(Number.isFinite) || values.some((value) => value < 0)) {
      throw new Error('Building dimensions must be finite non-negative numbers');
    }
    return {
      building_width: String(length),
      building_depth: String(width),
      wall_height: String(floors * floorHeight),
      roof_height: String(roofHeight),
      roof_type: ['hip', 'gable', 'flat'].includes(config.roofType) ? config.roofType : 'hip'
    };
  }

  function validateStandardFacadeFiles(files) {
    const selected = Array.from(files || []);
    if (selected.length !== 1) {
      return {
        ok: false,
        message: selected.length ? '只能上传一张标准正立面图。' : '请选择一张标准正立面图。'
      };
    }
    const file = selected[0];
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      return { ok: false, message: '请选择 JPG 或 PNG 标准正立面图。' };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { ok: false, message: `${file.name} 超过 10 MB，请压缩后重试。` };
    }
    return { ok: true, file };
  }

  const transitions = {
    idle: { upload: 'uploading' },
    uploading: { uploaded: 'rectifying', failed: 'error' },
    rectifying: { rectified: 'rectified', failed: 'error' },
    rectified: { prepare: 'preparing', upload: 'uploading', failed: 'error' },
    preparing: { prepared: 'generating', failed: 'error' },
    generating: { generated: 'generated', failed: 'error' },
    generated: { upload: 'uploading' },
    error: { upload: 'uploading', use_original: 'rectified' }
  };

  function transitionJobState(currentState, event) {
    const nextState = transitions[currentState]?.[event];
    if (!nextState) {
      throw new Error(`Invalid photo workflow transition: ${currentState} -> ${event}`);
    }
    return nextState;
  }

  function buildModelReadyMessage(options) {
    return {
      type: 'village-house-generator:model-ready',
      payload: {
        sourceCode: options.targetCode,
        sourceName: options.targetName,
        spaceId: options.targetSpace,
        presetId: options.modelId,
        glbBuffer: options.glbBuffer,
        modelScale: 10,
        modelHeading: 0,
        modelHeightOffset: 0,
        modelMetrics: options.metrics
      }
    };
  }

  function photoModelMetrics(building) {
    const wallHeight = Number(building?.wall_height);
    const roofHeight = Number(building?.roof_height);
    const length = Number(building?.width);
    const width = Number(building?.depth);
    if (![wallHeight, roofHeight, length, width].every(Number.isFinite)) {
      throw new Error('Photo building dimensions are incomplete');
    }
    return {
      totalHeight: Math.round((wallHeight + roofHeight) * 1000) / 1000,
      length,
      width
    };
  }

  function photoHeightSummary(building) {
    const metrics = photoModelMetrics(building);
    return `墙体高度 ${Number(building.wall_height).toFixed(2)} m · 含屋顶总高 ${metrics.totalHeight.toFixed(2)} m`;
  }

  return {
    CORRECTION_PROMPT,
    automaticRoofHeight,
    buildBuildingFields,
    buildDirectPreparePath,
    buildRectifyPath,
    buildOriginalFallbackPath,
    buildPhotoUploadConfig,
    buildModelReadyMessage,
    clampCropTop,
    clampPoint,
    pixelsToNormalized,
    photoHeightSummary,
    photoModelMetrics,
    friendlyServiceError,
    resolveInitialMode,
    readTargetDimensions,
    shouldApplyPresetAfterLoad,
    transitionJobState,
    validateStandardFacadeFiles
  };
});
