const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MODEL_BYTES,
  resolveLibraryScope,
  validateGlbFile,
  buildStoragePath,
  createGroupModelLibrary,
  restoreBuildingModel,
  uploadAndPlaceModel,
  applyOptionalModelWithWhiteFallback
} = require('./group-model-library.js');

test('group spaces resolve to one shared group scope', () => {
  assert.deepEqual(
    resolveLibraryScope({
      space: { id: 'space-g1', courseId: 'course-a', courseGroupId: 'group-7', spaceType: 'course_group' },
      user: { authUserId: 'user-a' }
    }),
    { kind: 'group', groupId: 'group-7', ownerId: 'user-a', courseId: 'course-a', spaceId: 'space-g1' }
  );
});

test('spaces without a group resolve to the authenticated user private scope', () => {
  assert.deepEqual(
    resolveLibraryScope({
      space: { id: 'personal-a', courseId: 'course-a', spaceType: 'course_personal' },
      user: { authUserId: 'user-a' }
    }),
    { kind: 'personal', groupId: null, ownerId: 'user-a', courseId: 'course-a', spaceId: 'personal-a' }
  );
  assert.throws(() => resolveLibraryScope({ space: { id: 'personal-a' }, user: null }), /请先登录/);
});

test('GLB validation rejects wrong extensions and files over 50 MB', () => {
  assert.equal(validateGlbFile({ name: 'house.GLB', size: MAX_MODEL_BYTES }).valid, true);
  assert.deepEqual(validateGlbFile({ name: 'house.fbx', size: 20 }), {
    valid: false,
    message: '仅支持 GLB 模型文件。'
  });
  assert.deepEqual(validateGlbFile({ name: 'house.glb', size: MAX_MODEL_BYTES + 1 }), {
    valid: false,
    message: '模型文件不能超过 50 MB。'
  });
});

test('GLB upload preserves the generic binary MIME reported by browsers', async () => {
  let uploadOptions = null;
  const storage = {
    async upload(_path, _file, options) {
      uploadOptions = options;
      return { error: null };
    },
    async remove() { return { error: null }; }
  };
  const client = {
    storage: { from() { return storage; } },
    async rpc() {
      return {
        data: { id: 'asset-1', name: 'house', storage_path: 'users/u/asset.glb' },
        error: null
      };
    }
  };
  const library = createGroupModelLibrary({ client, bucket: 'group-models' });

  await library.uploadAsset({
    file: { name: 'house.glb', size: 100, type: 'application/octet-stream' },
    scope: { kind: 'personal', ownerId: 'u', groupId: null, courseId: '', spaceId: 's' }
  });

  assert.equal(uploadOptions.contentType, 'application/octet-stream');
});

test('storage paths are scoped and do not retain unsafe file-name characters', () => {
  assert.match(
    buildStoragePath(
      { kind: 'group', groupId: 'group 7', ownerId: 'user-a' },
      { name: '../My House (1).glb' },
      'asset-id'
    ),
    /^groups\/group-7\/asset-id-my-house-1\.glb$/
  );
  assert.equal(
    buildStoragePath(
      { kind: 'personal', groupId: null, ownerId: 'user/A' },
      { name: 'home.glb' },
      'asset-id'
    ),
    'users/user-a/asset-id-home.glb'
  );
});

test('library deletion refuses an asset that is still bound to a building', async () => {
  const calls = [];
  const library = createGroupModelLibrary({
    client: {
      rpc(name, payload) {
        calls.push({ name, payload });
        return Promise.resolve({ data: null, error: { message: 'MODEL_IN_USE:2' } });
      }
    },
    bucket: 'group-models'
  });

  await assert.rejects(
    () => library.deleteAsset({ id: 'asset-1', storage_path: 'groups/g/asset.glb' }),
    /该模型正被 2 栋建筑使用/
  );
  assert.deepEqual(calls, [{ name: 'delete_group_model', payload: { p_asset_id: 'asset-1' } }]);
});

test('placing and restoring models use atomic RPC operations with building identity', async () => {
  const calls = [];
  const client = {
    rpc(name, payload) {
      calls.push({ name, payload });
      return Promise.resolve({ data: { ok: true }, error: null });
    }
  };
  const library = createGroupModelLibrary({ client, bucket: 'group-models' });

  await library.placeAsset({
    assetId: 'asset-1',
    spaceId: 'space-1',
    objectCode: 'building-v4-5',
    transform: { scale: 1.25 }
  });
  await library.restoreWhiteModel({ spaceId: 'space-1', objectCode: 'building-v4-5' });

  assert.deepEqual(calls, [
    {
      name: 'place_group_model',
      payload: {
        p_asset_id: 'asset-1',
        p_space_id: 'space-1',
        p_object_code: 'building-v4-5',
        p_transform: { scale: 1.25 }
      }
    },
    {
      name: 'restore_building_white_model',
      payload: { p_space_id: 'space-1', p_object_code: 'building-v4-5' }
    }
  ]);
});

test('restoring a white model clears legacy model state before removing the shared binding', async () => {
  const events = [];
  const library = {
    async restoreWhiteModel() {
      events.push('binding');
    }
  };

  await restoreBuildingModel({
    library,
    spaceId: 'space-1',
    objectCode: 'building-v4-5',
    async clearLegacy() {
      events.push('legacy');
    }
  });

  assert.deepEqual(events, ['legacy', 'binding']);
});

test('uploading a model registers it once and immediately applies it to the selected building', async () => {
  const events = [];
  const asset = { id: 'asset-1', name: '民居模型', storage_path: 'users/u/asset.glb' };
  const library = {
    async uploadAsset() {
      events.push('upload');
      return asset;
    },
    async createSignedUrl(receivedAsset) {
      assert.equal(receivedAsset, asset);
      events.push('url');
      return 'https://example.test/model.glb';
    },
    async placeAsset({ assetId, spaceId, objectCode, transform }) {
      events.push('place');
      assert.deepEqual({ assetId, spaceId, objectCode, transform }, {
        assetId: 'asset-1',
        spaceId: 'space-1',
        objectCode: 'B-1',
        transform: { scale: 1.2 }
      });
    }
  };

  const result = await uploadAndPlaceModel({
    library,
    file: { name: 'house.glb', size: 100 },
    scope: { kind: 'personal', ownerId: 'u', spaceId: 'space-1' },
    spaceId: 'space-1',
    objectCode: 'B-1',
    transform: { scale: 1.2 }
  });

  assert.deepEqual(events, ['upload', 'url', 'place']);
  assert.deepEqual(result, { asset, signedUrl: 'https://example.test/model.glb' });
});

test('listing bindings returns the asset metadata needed to recreate signed model URLs after reload', async () => {
  const terminal = Promise.resolve({
    data: [{
      space_id: 'space-1',
      object_code: 'B-1',
      transform: { scale: 2 },
      group_model_assets: { id: 'asset-1', name: '住宅', storage_path: 'groups/g/asset.glb' }
    }],
    error: null
  });
  const query = {
    select() { return this; },
    eq() { return terminal; }
  };
  const library = createGroupModelLibrary({
    client: { from() { return query; } },
    bucket: 'group-models'
  });

  assert.deepEqual(await library.listBindings('space-1'), [{
    space_id: 'space-1',
    object_code: 'B-1',
    transform: { scale: 2 },
    group_model_assets: { id: 'asset-1', name: '住宅', storage_path: 'groups/g/asset.glb' }
  }]);
});

test('failed optional GLB load keeps the building white model visible', async () => {
  const states = [];
  const result = await applyOptionalModelWithWhiteFallback({
    async loadModel() { throw new Error('signed URL expired'); },
    setWhiteModelVisible(visible) { states.push(visible); }
  });
  assert.equal(result.applied, false);
  assert.match(result.error.message, /expired/);
  assert.deepEqual(states, [true]);
});

test('white model is hidden only after an optional GLB loads', async () => {
  const states = [];
  assert.deepEqual(await applyOptionalModelWithWhiteFallback({
    async loadModel() { return true; },
    setWhiteModelVisible(visible) { states.push(visible); }
  }), { applied: true });
  assert.deepEqual(states, [false]);
});
