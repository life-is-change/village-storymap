(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GroupModelLibraryModule = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
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

  function createGroupModelLibrary({ client, bucket = DEFAULT_BUCKET } = {}) {
    if (!client) throw new Error('Supabase 客户端未初始化。');

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
      const { data, error } = await client.storage.from(bucket).createSignedUrl(asset.storage_path, expiresIn);
      throwIfError(error, '读取模型文件失败。');
      return data?.signedUrl || data?.signedURL || '';
    }

    async function uploadAsset({ file, name, scope }) {
      const validation = validateGlbFile(file);
      if (!validation.valid) throw new Error(validation.message);
      const assetId = randomId();
      const storagePath = buildStoragePath(scope, file, assetId);
      const storage = client.storage.from(bucket);
      const contentType = String(file.type || '').toLowerCase() === 'application/octet-stream'
        ? 'application/octet-stream'
        : 'model/gltf-binary';
      const { error: uploadError } = await storage.upload(storagePath, file, {
        contentType,
        upsert: false
      });
      throwIfError(uploadError, '上传模型文件失败。');

      const payload = {
        p_asset_id: assetId,
        p_name: String(name || file.name.replace(/\.glb$/i, '')).trim().slice(0, 100),
        p_storage_path: storagePath,
        p_file_size: Number(file.size),
        p_scope_kind: scope.kind,
        p_group_id: scope.groupId,
        p_course_id: scope.courseId || null,
        p_space_id: scope.spaceId || null
      };
      const { data, error } = await client.rpc('register_group_model', payload);
      if (error) {
        await storage.remove([storagePath]).catch(() => {});
        throwIfError(error, '登记模型失败。');
      }
      return Array.isArray(data) ? data[0] : data;
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
        const { error: storageError } = await client.storage.from(bucket).remove([storagePath]);
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

  async function uploadAndPlaceModel({ library, file, name, scope, spaceId, objectCode, transform = {} }) {
    if (!library?.uploadAsset || !library?.createSignedUrl || !library?.placeAsset) {
      throw new Error('模型库未初始化。');
    }
    const asset = await library.uploadAsset({ file, name, scope });
    const signedUrl = await library.createSignedUrl(asset);
    await library.placeAsset({ assetId: asset.id, spaceId, objectCode, transform });
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
