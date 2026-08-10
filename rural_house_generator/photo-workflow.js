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

  const ROOF_MATERIALS = new Set(['gray_tile', 'asphalt_shingle', 'terracotta_tile']);
  const ROOF_PITCHES = new Set(['low', 'standard', 'high']);
  const ROOF_TYPES = new Set(['hip', 'gable', 'flat']);
  const ROOF_SOURCES = new Set(['automatic', 'fallback', 'manual']);
  const ROOF_LABELS = {
    type: { hip: '四坡屋顶', gable: '双坡屋顶', flat: '平屋顶' },
    material: {
      gray_tile: '岭南灰瓦',
      asphalt_shingle: '沥青瓦',
      terracotta_tile: '陶瓦'
    },
    pitch: { low: '低坡', standard: '标准坡', high: '高坡' }
  };

  function normalizeRoofAppearance(config) {
    return {
      roofMaterial: ROOF_MATERIALS.has(config?.roofMaterial)
        ? config.roofMaterial
        : 'gray_tile',
      roofPitch: ROOF_PITCHES.has(config?.roofPitch)
        ? config.roofPitch
        : 'standard'
    };
  }

  function buildPhotoUploadConfig(config) {
    const provisionalFloorHeight = 3;
    const appearance = normalizeRoofAppearance(config);
    return {
      length: Number(config?.length),
      width: Number(config?.width),
      floors: 1,
      floorHeight: provisionalFloorHeight,
      roofHeight: automaticRoofHeight(provisionalFloorHeight, config?.roofType),
      roofType: config?.roofType,
      ...appearance
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

  function buildRoofAnalysisPath(jobId) {
    return `/api/jobs/${encodeURIComponent(jobId)}/analyze-roof`;
  }

  function normalizeRoofDecision(raw, allowed, fallbackValue) {
    const value = allowed.has(raw?.value) ? raw.value : fallbackValue;
    const source = allowed.has(raw?.value) && ROOF_SOURCES.has(raw?.source)
      ? raw.source
      : 'fallback';
    return {
      value,
      confidence: clamp(raw?.confidence, 0, 1),
      source
    };
  }

  function normalizeRoofAnalysis(raw) {
    return {
      type: normalizeRoofDecision(raw?.type, ROOF_TYPES, 'hip'),
      material: normalizeRoofDecision(raw?.material, ROOF_MATERIALS, 'gray_tile'),
      pitch: normalizeRoofDecision(raw?.pitch, ROOF_PITCHES, 'standard'),
      cropTop: clampCropTop(raw?.crop_top),
      revision: Math.max(0, Math.floor(Number(raw?.revision) || 0)),
      warnings: Array.isArray(raw?.warnings) ? raw.warnings.map(String) : []
    };
  }

  function roofAnalysisChoices(analysis) {
    const normalized = normalizeRoofAnalysis(analysis);
    return {
      roofType: normalized.type.value,
      roofMaterial: normalized.material.value,
      roofPitch: normalized.pitch.value
    };
  }

  function roofAnalysisSummary(analysis) {
    const normalized = normalizeRoofAnalysis(analysis);
    const labels = [
      ROOF_LABELS.material[normalized.material.value],
      ROOF_LABELS.type[normalized.type.value],
      ROOF_LABELS.pitch[normalized.pitch.value]
    ].join(' · ');
    const usedFallback = [normalized.type, normalized.material, normalized.pitch]
      .some((item) => item.source === 'fallback');
    return usedFallback || normalized.warnings.length
      ? `屋顶信息不够清晰，已使用稳妥默认样式：${labels}`
      : `已自动匹配：${labels}`;
  }

  function buildRoofAnalysisForm({ cropTop, revision, overrides = {} }) {
    const form = new FormData();
    form.append('roof_top_norm', String(clampCropTop(cropTop)));
    form.append('revision', String(Math.max(0, Math.floor(Number(revision) || 0))));
    if (ROOF_TYPES.has(overrides.roofType)) {
      form.append('roof_type_override', overrides.roofType);
    }
    if (ROOF_MATERIALS.has(overrides.roofMaterial)) {
      form.append('roof_material_override', overrides.roofMaterial);
    }
    if (ROOF_PITCHES.has(overrides.roofPitch)) {
      form.append('roof_pitch_override', overrides.roofPitch);
    }
    return form;
  }

  function nextRoofAnalysisState(current, { cropTop }) {
    return {
      ...current,
      cropTop: clampCropTop(cropTop),
      revision: Math.max(0, Math.floor(Number(current?.revision) || 0)) + 1,
      status: 'pending',
      analysis: null,
      overrides: { ...(current?.overrides || {}) }
    };
  }

  function clearRoofOverrides() {
    return { analysis: null, overrides: {}, status: 'idle', revision: 0 };
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

  function isLocalServiceNetworkError(error) {
    return error?.code === 'LOCAL_SERVICE_UNREACHABLE';
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
    const appearance = normalizeRoofAppearance(config);
    return {
      building_width: String(length),
      building_depth: String(width),
      wall_height: String(floors * floorHeight),
      roof_height: String(roofHeight),
      roof_type: ['hip', 'gable', 'flat'].includes(config.roofType) ? config.roofType : 'hip',
      roof_material: appearance.roofMaterial,
      roof_pitch: appearance.roofPitch
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

  const serviceTransitions = {
    checking: { success: 'online', failure: 'offline' },
    online: { success: 'online', failure: 'offline' },
    offline: { success: 'online', failure: 'offline' },
    recovered: { success: 'recovered', failure: 'offline', retry: 'checking' }
  };

  function transitionServiceState(currentState, event, hasPendingPhoto = false) {
    const nextState = serviceTransitions[currentState]?.[event];
    if (!nextState) {
      throw new Error(`Invalid service state transition: ${currentState} -> ${event}`);
    }
    return currentState === 'offline' && event === 'success' && hasPendingPhoto
      ? 'recovered'
      : nextState;
  }

  function serviceStatusPresentation(state) {
    const presentations = {
      checking: {
        tone: 'checking',
        message: '正在检测本地生成服务…',
        canRecover: false
      },
      online: {
        tone: 'online',
        message: '本地生成服务可用。',
        canRecover: false
      },
      offline: {
        tone: 'offline',
        message: '本地服务未启动，请运行 start_facade_generator.bat。',
        canRecover: false
      },
      recovered: {
        tone: 'recovered',
        message: '服务已恢复，可以重新处理当前照片。',
        canRecover: true
      }
    };
    const presentation = presentations[state];
    if (!presentation) throw new Error(`Unknown service presentation state: ${state}`);
    return presentation;
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
    buildRoofAnalysisForm,
    buildRoofAnalysisPath,
    buildModelReadyMessage,
    clampCropTop,
    clampPoint,
    clearRoofOverrides,
    pixelsToNormalized,
    photoHeightSummary,
    photoModelMetrics,
    friendlyServiceError,
    isLocalServiceNetworkError,
    nextRoofAnalysisState,
    normalizeRoofAnalysis,
    resolveInitialMode,
    readTargetDimensions,
    shouldApplyPresetAfterLoad,
    serviceStatusPresentation,
    roofAnalysisChoices,
    roofAnalysisSummary,
    transitionJobState,
    transitionServiceState,
    validateStandardFacadeFiles
  };
});
