(function (root, factory) {
  const normalizer = typeof module !== 'undefined' && module.exports
    ? require('./glb-normalization.js') : root?.GlbNormalizationModule;
  const api = factory(normalizer);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GroupModelLibraryModule = api;
})(typeof window !== 'undefined' ? window : globalThis, function (normalizer) {
  const MAX_MODEL_BYTES = 50 * 1024 * 1024;
  const DEFAULT_BUCKET = 'group-models';
  const ASSET_TABLE = 'group_model_assets';
  const BINDING_TABLE = 'building_model_bindings';

  function cleanSegment(value, fallback) {
    const cleaned = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return cleaned || fallback;
  }

  function resolveLibraryScope({ space, user } = {}) {
    const ownerId = String(user?.authUserId || user?.id || '').trim();
    if (!ownerId) throw new Error('请先登录后使用模型库。');

    const groupId = String(space?.courseGroupId || space?.groupId || '').trim();
    const spaceType = String(space?.spaceType || space?.space_type || '').trim();
    const shared = ['practice_shared', 'formal_shared'].includes(spaceType);
    return {
      kind: shared ? 'shared' : (groupId ? 'group' : 'personal'),
      groupId: groupId || null,
      ownerId,
      courseId: String(space?.courseId || '').trim(),
      spaceId: String(space?.id || '').trim()
    };
  }

  function validateGlbFile(file) {
    if (!file || !String(file.name || '').toLowerCase().endsWith('.glb')) {
      return { valid: false, message: '仅支持 GLB 模型文件。' };
    }
    if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0) {
      return { valid: false, message: '模型文件为空或无法读取。' };
    }
    if (Number(file.size) > MAX_MODEL_BYTES) {
      return { valid: false, message: '模型文件不能超过 50 MB。' };
    }
    return { valid: true, message: '' };
  }

  function buildStoragePath(scope, file, assetId) {
    const prefix = scope?.kind === 'shared'
      ? `shared/${cleanSegment(scope?.spaceId, 'unknown-space')}`
      : (scope?.kind === 'group'
        ? `groups/${cleanSegment(scope.groupId, 'unknown-group')}`
        : `users/${cleanSegment(scope?.ownerId, 'unknown-user')}`);
    const originalBase = String(file?.name || 'model.glb').replace(/\.glb$/i, '');
    const safeName = cleanSegment(originalBase, 'model');
    return `${prefix}/${cleanSegment(assetId, 'model')}-${safeName}.glb`;
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      const nibble = character === 'x' ? value : ((value & 0x3) | 0x8);
      return nibble.toString(16);
    });
  }

  function throwIfError(error, fallback) {
    if (!error) return;
    const message = String(error.message || error.details || fallback || '模型库操作失败。');
    const match = message.match(/MODEL_IN_USE(?::|\s)(\d+)/i);
    if (match) throw new Error(`该模型正被 ${match[1]} 栋建筑使用，请先替换或恢复这些建筑的白模。`);
    throw new Error(message || fallback);
  }

  function siblingPath(storagePath, variant) {
    return storagePath.replace(/\.glb$/i, '') + `.${variant}.glb`;
  }

  function sameCoordinates(first, second) {
    return Array.isArray(first) && Array.isArray(second) && first.length === 3 && second.length === 3 &&
      first.every((value, index) => typeof value === 'number' && Number.isFinite(value) &&
        typeof second[index] === 'number' && Number.isFinite(second[index]) &&
        Math.abs(value - second[index]) <= 1e-6 * Math.max(1, Math.abs(value), Math.abs(second[index])));
  }

  function validateLowAnchor(high, low) {
    const source = high.normalization;
    const candidate = low.normalization;
    if (!low.normalized || high.anchor !== 'bottom-center' || low.anchor !== 'bottom-center' ||
        source?.metersPerUnit !== candidate?.metersPerUnit ||
        !sameCoordinates(source?.originalCenter, candidate?.originalCenter) ||
        !sameCoordinates(source?.originalBounds?.min, candidate?.originalBounds?.min) ||
        !sameCoordinates(source?.originalBounds?.max, candidate?.originalBounds?.max)) {
      throw new Error('轻量 GLB 必须由同一原模型处理并保留相同的标准化底部中心 anchor。请同时选择 CPU 工具输出的 high.glb 和 low.glb。');
    }
  }

  function readModelMetadata(source, storagePath) {
    if (!source || source.normalized !== true || source.anchor !== 'bottom-center') return null;
    const finiteVector = value => Array.isArray(value) && value.length === 3 &&
      value.every(number => typeof number === 'number' && Number.isFinite(number));
    const invalid = () => { throw new Error('模型元数据尺寸无效。'); };
    function boundsSize(bounds) {
      if (!bounds) return undefined;
      if (bounds.min !== undefined || bounds.max !== undefined) {
        if (!finiteVector(bounds.min) || !finiteVector(bounds.max) ||
            bounds.max.some((value, index) => value < bounds.min[index])) invalid();
      }
      const size = bounds.size ?? (bounds.min && bounds.max ? bounds.max.map((value, index) => value - bounds.min[index]) : undefined);
      if (size !== undefined && (!finiteVector(size) || size.some(value => value < 0))) invalid();
      return size;
    }
    const currentSize = boundsSize(source.bounds);
    const originalSize = boundsSize(source.originalBounds);
    const unit = source.metersPerUnit ?? 1;
    if (typeof unit !== 'number' || !Number.isFinite(unit) || unit <= 0) invalid();
    const size = source.size ?? currentSize ?? (originalSize ? originalSize.map(value => value * unit) : undefined);
    if (!finiteVector(size) || size.some(value => value < 0)) invalid();
    const metadata = { ...source, normalized: true, anchor: 'bottom-center', size: [...size] };
    if (metadata.lowStoragePath !== siblingPath(storagePath, 'low')) delete metadata.lowStoragePath;
    if (metadata.originalStoragePath !== siblingPath(storagePath, 'original')) delete metadata.originalStoragePath;
    return metadata;
  }

  function createGroupModelLibrary({ client, bucket = DEFAULT_BUCKET, now = () => Date.now(),
    fetcher = (...args) => globalThis.fetch(...args) } = {}) {
    if (!client) throw new Error('Supabase 客户端未初始化。');
    const signedUrlCache = new Map();
    const pendingSignedUrls = new Map();
    const assetMetadataCache = new Map();
    const pendingAssetMetadata = new Map();
    let metadataEpoch = 0;

    async function listAssets(scope) {
      let query = client
        .from(ASSET_TABLE)
        .select('*')
        .eq('scope_kind', scope.kind);
      query = scope.kind === 'shared'
        ? query.eq('source_space_id', scope.spaceId)
        : query.eq(scope.kind === 'group' ? 'group_id' : 'owner_id', scope.kind === 'group' ? scope.groupId : scope.ownerId);
      query = query.order('created_at', { ascending: false });
      const { data, error } = await query;
      throwIfError(error, '读取模型库失败。');
      return Array.isArray(data) ? data : [];
    }

    async function createSignedUrl(asset, expiresIn = 3600) {
      if (!asset?.storage_path) throw new Error('模型文件路径缺失。');
      return createSignedUrlForPath(asset.storage_path, expiresIn);
    }

    async function createSignedUrlForPath(path, expiresIn = 3600) {
      const storagePath = String(path || '').trim();
      if (!storagePath) throw new Error('模型文件路径缺失。');
      const lifetime = Number(expiresIn);
      if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error('模型链接有效期无效。');
      const key = `${lifetime}:${storagePath}`;
      const cached = signedUrlCache.get(key);
      if (cached && cached.expiresAt > now()) return cached.url;
      if (pendingSignedUrls.has(key)) return pendingSignedUrls.get(key);
      const pending = (async () => {
        const createdAt = now();
        const { data, error } = await client.storage.from(bucket).createSignedUrl(storagePath, lifetime);
        throwIfError(error, '读取模型文件失败。');
        const url = data?.signedUrl || data?.signedURL || '';
        if (url) signedUrlCache.set(key, { url, expiresAt: createdAt + lifetime * 1000 });
        return url;
      })();
      pendingSignedUrls.set(key, pending);
      try { return await pending; } finally { pendingSignedUrls.delete(key); }
    }

    async function getAssetMetadata(asset) {
      const storagePath = String(asset?.storage_path || '').trim();
      if (!storagePath) throw new Error('模型文件路径缺失。');
      if (assetMetadataCache.has(storagePath)) return assetMetadataCache.get(storagePath);
      if (pendingAssetMetadata.has(storagePath)) return pendingAssetMetadata.get(storagePath);
      const epoch = metadataEpoch;
      const pending = (async () => {
        const url = await createSignedUrlForPath(storagePath);
        async function fetchRange(first, last) {
          const response = await fetcher(url, { headers: { Range: `bytes=${first}-${last}` } });
          if (!response?.ok) throw new Error(`读取模型元数据失败（${response?.status || '网络错误'}）。`);
          return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
        }
        const first = await fetchRange(0, 65535);
        if (first.bytes.byteLength < 20) throw new Error('INVALID_GLB_HEADER');
        const header = new DataView(first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength);
        const totalLength = header.getUint32(8, true);
        const jsonLength = header.getUint32(12, true);
        if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
            header.getUint32(16, true) !== 0x4e4f534a || !jsonLength || jsonLength % 4 ||
            jsonLength > MAX_MODEL_BYTES || totalLength < 20 + jsonLength) throw new Error('INVALID_GLB_HEADER');
        let jsonBytes;
        if (first.bytes.byteLength >= 20 + jsonLength) {
          jsonBytes = first.bytes.subarray(20, 20 + jsonLength);
        } else {
          if (first.status !== 206) throw new Error('INVALID_GLB_JSON_RANGE');
          const rest = await fetchRange(20, 19 + jsonLength);
          const offset = rest.status === 206 ? 0 : 20;
          if (rest.bytes.byteLength < offset + jsonLength) throw new Error('INVALID_GLB_JSON_RANGE');
          jsonBytes = rest.bytes.subarray(offset, offset + jsonLength);
        }
        const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes).replace(/[\s\0]+$/g, ''));
        if (json.asset?.version !== '2.0') throw new Error('INVALID_GLB_JSON');
        const metadata = readModelMetadata(json.extras?.villageModel, storagePath);
        if (metadataEpoch === epoch) assetMetadataCache.set(storagePath, metadata);
        return metadata;
      })();
      pendingAssetMetadata.set(storagePath, pending);
      try { return await pending; } finally {
        if (pendingAssetMetadata.get(storagePath) === pending) pendingAssetMetadata.delete(storagePath);
      }
    }

    async function uploadAsset({ file, lowFile, name, scope, metersPerUnit = 1 }) {
      const validation = validateGlbFile(file);
      if (!validation.valid) throw new Error(validation.message);
      const assetId = randomId();
      const storagePath = buildStoragePath(scope, file, assetId);
      const originalStoragePath = siblingPath(storagePath, 'original');
      const lowStoragePath = lowFile || typeof file.arrayBuffer === 'function' ? siblingPath(storagePath, 'low') : null;
      const storage = client.storage.from(bucket);
      const contentType = String(file.type || '').toLowerCase() === 'application/octet-stream'
        ? 'application/octet-stream'
        : 'model/gltf-binary';
      let displayFile = file;
      let normalizedLowFile = null;
      let metadata = null;
      // Browser Files expose arrayBuffer. Lightweight legacy callers without
      // binary data retain the original upload contract.
      if (typeof file.arrayBuffer === 'function') {
        if (!normalizer) throw new Error('GLB 标准化模块尚未加载。');
        const originalBuffer = await file.arrayBuffer();
        if (!lowFile && typeof normalizer.createModelVariantsAsync !== 'function') {
          throw new Error('GLB 自动轻量化模块尚未加载。');
        }
        const result = lowFile
          ? await normalizer.normalizeGlbAsync(originalBuffer, { metersPerUnit })
          : await normalizer.createModelVariantsAsync(originalBuffer, { metersPerUnit });
        if (lowFile) {
          const lowValidation = validateGlbFile(lowFile);
          if (!lowValidation.valid) throw new Error(lowValidation.message);
          if (typeof lowFile.arrayBuffer !== 'function') throw new Error('无法读取轻量 GLB。');
          const lowBuffer = await lowFile.arrayBuffer();
          const lowInspection = await normalizer.inspectGlbAsync(lowBuffer);
          validateLowAnchor(result.inspection, lowInspection);
          normalizedLowFile = new Blob([lowBuffer], { type: contentType });
        } else {
          if (!result.lowBuffer) throw new Error('GLB 自动生成轻量版失败，请重试。');
          const lowInspection = result.lowInspection || await normalizer.inspectGlbAsync(result.lowBuffer);
          validateLowAnchor(result.inspection, lowInspection);
          normalizedLowFile = new Blob([result.lowBuffer], { type: contentType });
        }
        const { json, binary } = normalizer.readGlb(result.buffer);
        const { lowStoragePath: previousLowPath, originalStoragePath: previousOriginalPath, ...sourceMetadata } =
          result.inspection.normalization || {};
        metadata = {
          ...sourceMetadata, bounds: result.inspection.bounds, size: result.inspection.bounds.size,
          triangleCount: result.inspection.triangleCount, primitiveCount: result.inspection.primitiveCount,
          textureCount: result.inspection.textureCount, originalStoragePath,
          ...(result.processing ? { processing: result.processing } : {}),
          ...(lowStoragePath ? { lowStoragePath } : {})
        };
        json.extras = { ...(json.extras || {}), villageModel: metadata };
        displayFile = new Blob([normalizer.writeGlb(json, binary)], { type: contentType });
        if (originalBuffer.byteLength > MAX_MODEL_BYTES || displayFile.size > MAX_MODEL_BYTES ||
            normalizedLowFile?.size > MAX_MODEL_BYTES) throw new Error('模型文件不能超过 50 MB。');
      } else if (lowFile) {
        throw new Error('选择轻量版时必须提供可读取的 GLB 模型文件。');
      }

      const uploadedPaths = [];
      async function upload(path, body) {
        const { error } = await storage.upload(path, body, { contentType, upsert: false });
        throwIfError(error, '上传模型文件失败。');
        uploadedPaths.push(path);
      }
      try {
        if (metadata) await upload(originalStoragePath, file);
        await upload(storagePath, displayFile);
        if (normalizedLowFile) await upload(lowStoragePath, normalizedLowFile);
        const payload = {
          p_asset_id: assetId,
          p_name: String(name || file.name.replace(/\.glb$/i, '')).trim().slice(0, 100),
          p_storage_path: storagePath,
          p_file_size: Number(displayFile.size),
          p_scope_kind: scope.kind,
          p_group_id: scope.groupId,
          p_course_id: scope.courseId || null,
          p_space_id: scope.spaceId || null
        };
        const { data, error } = await client.rpc('register_group_model', payload);
        throwIfError(error, '登记模型失败。');
        const asset = Array.isArray(data) ? data[0] : data;
        if (metadata && asset) assetMetadataCache.set(storagePath, metadata);
        return metadata && asset ? { ...asset, normalization: metadata } : asset;
      } catch (error) {
        if (uploadedPaths.length) {
          try { await storage.remove(uploadedPaths); } catch (_) {}
        }
        throw error;
      }
    }

    async function placeAsset({ assetId, spaceId, objectCode, transform = {} }) {
      const { data, error } = await client.rpc('place_group_model', {
        p_asset_id: assetId,
        p_space_id: spaceId,
        p_object_code: objectCode,
        p_transform: transform
      });
      throwIfError(error, '替换建筑模型失败。');
      return data;
    }

    async function restoreWhiteModel({ spaceId, objectCode }) {
      const { data, error } = await client.rpc('restore_building_white_model', {
        p_space_id: spaceId,
        p_object_code: objectCode
      });
      throwIfError(error, '恢复白模失败。');
      return data;
    }

    async function deleteAsset(asset) {
      const { data, error } = await client.rpc('delete_group_model', { p_asset_id: asset?.id });
      throwIfError(error, '删除模型失败。');
      const storagePath = data?.storage_path || asset?.storage_path;
      if (storagePath) {
        const paths = [storagePath, siblingPath(storagePath, 'original'), siblingPath(storagePath, 'low')];
        signedUrlCache.clear();
        metadataEpoch += 1;
        assetMetadataCache.clear();
        pendingAssetMetadata.clear();
        const { error: storageError } = await client.storage.from(bucket).remove(paths);
        throwIfError(storageError, '模型记录已删除，但存储文件清理失败。');
      }
      return data;
    }

    async function getBinding(spaceId, objectCode) {
      const { data, error } = await client
        .from(BINDING_TABLE)
        .select('*, group_model_assets(*)')
        .eq('space_id', spaceId)
        .eq('object_code', objectCode)
        .maybeSingle();
      throwIfError(error, '读取建筑模型绑定失败。');
      return data || null;
    }

    async function listBindings(spaceId) {
      const { data, error } = await client
        .from(BINDING_TABLE)
        .select('*, group_model_assets(*)')
        .eq('space_id', spaceId);
      throwIfError(error, '读取空间模型绑定失败。');
      return Array.isArray(data) ? data : [];
    }

    return {
      listAssets,
      createSignedUrl,
      createSignedUrlForPath,
      getAssetMetadata,
      uploadAsset,
      placeAsset,
      restoreWhiteModel,
      deleteAsset,
      getBinding,
      listBindings
    };
  }

  async function restoreBuildingModel({ library, spaceId, objectCode, clearLegacy }) {
    if (!library?.restoreWhiteModel) throw new Error('模型库未初始化。');
    if (typeof clearLegacy !== 'function') throw new Error('缺少白模状态恢复方法。');
    await clearLegacy();
    return library.restoreWhiteModel({ spaceId, objectCode });
  }

  async function uploadAndPlaceModel({ library, file, lowFile, name, scope, spaceId, objectCode, transform = {}, metersPerUnit = 1 }) {
    if (!library?.uploadAsset || !library?.createSignedUrl || !library?.placeAsset) {
      throw new Error('模型库未初始化。');
    }
    const asset = await library.uploadAsset({ file, lowFile, name, scope, metersPerUnit });
    const signedUrl = await library.createSignedUrl(asset);
    const metadata = asset.normalization;
    const size = metadata?.size || metadata?.bounds?.size;
    const normalizedTransform = metadata?.normalized === true && Array.isArray(size) ? {
      normalized: true, expectedLength: size[0], expectedHeight: size[1], expectedWidth: size[2], snapToBase: true,
      ...(metadata.lowStoragePath ? { lowStoragePath: metadata.lowStoragePath } : {}), ...transform
    } : transform;
    await library.placeAsset({ assetId: asset.id, spaceId, objectCode, transform: normalizedTransform });
    return { asset, signedUrl };
  }

  async function applyOptionalModelWithWhiteFallback({ loadModel, setWhiteModelVisible } = {}) {
    if (typeof loadModel !== 'function' || typeof setWhiteModelVisible !== 'function') {
      throw new Error('MODEL_FALLBACK_HANDLER_REQUIRED');
    }
    try {
      const loaded = await loadModel();
      if (!loaded) throw new Error('MODEL_LOAD_FAILED');
      setWhiteModelVisible(false);
      return { applied: true };
    } catch (error) {
      setWhiteModelVisible(true);
      return { applied: false, error };
    }
  }

  return {
    MAX_MODEL_BYTES,
    DEFAULT_BUCKET,
    resolveLibraryScope,
    validateGlbFile,
    buildStoragePath,
    createGroupModelLibrary,
    restoreBuildingModel,
    uploadAndPlaceModel,
    applyOptionalModelWithWhiteFallback
  };
});
