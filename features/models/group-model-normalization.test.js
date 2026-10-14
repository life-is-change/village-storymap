const test = require('node:test');
const assert = require('node:assert/strict');
const { createGroupModelLibrary, uploadAndPlaceModel } = require('./group-model-library');
const normalization = require('./glb-normalization');

const scope = { kind: 'personal', ownerId: 'u', spaceId: 's' };
function modelBytes() {
  const positions = new Float32Array([-2,-3,-1, 2,7,1, 2,-3,-1]);
  return normalization.writeGlb({ asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [100,20,-50] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-2,-3,-1], max: [2,7,1] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], buffers: [{ byteLength: positions.byteLength }]
  }, positions);
}
function file(bytes, name = 'house.glb') { return new File([bytes], name, { type: 'model/gltf-binary' }); }
function fixture({ uploadFailure, registrationFailure = false, removalFailure = false, now = () => 0, fetcher } = {}) {
  const uploads = [], removals = [], registrations = [], signatures = [], files = new Map();
  const storage = {
    async upload(path, body, options) {
      assert.equal(options.upsert, false);
      if (uploadFailure?.(path)) return { error: { message: 'path already exists' } };
      uploads.push({ path, body }); files.set(path, body); return { error: null };
    },
    async remove(paths) {
      removals.push(paths);
      if (removalFailure) return { error: { message: 'storage cleanup failed' } };
      paths.forEach(path => files.delete(path)); return { error: null };
    },
    async createSignedUrl(path, expiresIn) {
      signatures.push({ path, expiresIn });
      return { data: { signedUrl: `https://storage.test/${path}?sign=${signatures.length}` }, error: null };
    }
  };
  const client = { storage: { from: () => storage }, async rpc(name, payload) {
    registrations.push({ name, payload });
    if (registrationFailure) return { error: { message: 'registration denied' } };
    return { data: { id: payload.p_asset_id, storage_path: payload.p_storage_path, name: payload.p_name }, error: null };
  } };
  return { library: createGroupModelLibrary({ client, now, fetcher }), uploads, removals, registrations, signatures, files };
}

test('real uploads preserve the exact original and save a normalized display GLB with durable metadata', async () => {
  const f = fixture(); const original = modelBytes();
  const asset = await f.library.uploadAsset({ file: file(original), scope, metersPerUnit: 0.01 });
  assert.equal(f.uploads.length, 3);
  assert.match(f.uploads[0].path, /\.original\.glb$/);
  assert.equal(f.uploads[1].path, asset.storage_path);
  assert.deepEqual(new Uint8Array(await f.uploads[0].body.arrayBuffer()), new Uint8Array(original));
  const normalizedBytes = await f.uploads[1].body.arrayBuffer();
  const inspection = normalization.inspectGlb(normalizedBytes);
  assert.equal(inspection.normalized, true);
  assert.equal(inspection.anchor, 'bottom-center');
  for (const [index, value] of [0.04, 0.1, 0.02].entries()) {
    assert.ok(Math.abs(inspection.bounds.size[index] - value) < 1e-10);
  }
  assert.equal(asset.normalization.normalized, true);
  assert.equal(asset.normalization.originalStoragePath, f.uploads[0].path);
  assert.equal(asset.normalization.triangleCount, 1);
  assert.deepEqual(asset.normalization.bounds.size, inspection.bounds.size);
  assert.equal(inspection.normalization.originalStoragePath, f.uploads[0].path);
  assert.equal(inspection.normalization.lowStoragePath, f.uploads[2].path);
  assert.match(f.uploads[2].path, /\.low\.glb$/);
  assert.equal(f.registrations[0].payload.p_file_size, normalizedBytes.byteLength);
  assert.deepEqual(Object.keys(f.registrations[0].payload).sort(), ['p_asset_id','p_name','p_storage_path','p_file_size',
    'p_scope_kind','p_group_id','p_course_id','p_space_id'].sort());
});

test('invalid GLB bytes and empty scenes fail before any cloud upload or registration', async () => {
  const f = fixture();
  await assert.rejects(f.library.uploadAsset({ file: file(new Uint8Array([1,2,3,4])), scope }), /GLB/);
  const empty = normalization.writeGlb({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], nodes: [] });
  await assert.rejects(f.library.uploadAsset({ file: file(empty), scope }), /bounds|边界/i);
  assert.equal(f.uploads.length, 0); assert.equal(f.registrations.length, 0);
});

test('optional low GLB preserves its CPU anchor and persists its path in the high GLB and binding', async () => {
  const f = fixture(); const normalized = normalization.normalizeGlb(modelBytes());
  const low = file(normalized.buffer, 'house-low.glb');
  const result = await uploadAndPlaceModel({ library: f.library, file: file(normalized.buffer), lowFile: low, scope,
    metersPerUnit: 1, spaceId: 's', objectCode: 'B1', transform: { scale: 1, expectedHeight: 7 } });
  assert.equal(f.uploads.length, 3);
  const lowUpload = f.uploads.find(upload => upload.path.endsWith('.low.glb'));
  assert.ok(lowUpload);
  assert.deepEqual(new Uint8Array(await lowUpload.body.arrayBuffer()), new Uint8Array(normalized.buffer));
  const metadata = normalization.readGlb(await f.files.get(result.asset.storage_path).arrayBuffer()).json.extras.villageModel;
  assert.equal(metadata.lowStoragePath, lowUpload.path);
  assert.equal(result.asset.normalization.lowStoragePath, lowUpload.path);
  const binding = f.registrations.find(call => call.name === 'place_group_model').payload.p_transform;
  assert.equal(binding.normalized, true); assert.equal(binding.snapToBase, true);
  assert.equal(binding.expectedLength, 4); assert.equal(binding.expectedWidth, 2);
  assert.equal(binding.expectedHeight, 7, 'explicit generated-model dimensions must take precedence');
  assert.equal(binding.lowStoragePath, lowUpload.path);
});

test('unanchored or differently anchored low GLBs are rejected before uploading either variant', async () => {
  const f = fixture(); const high = file(modelBytes());
  await assert.rejects(f.library.uploadAsset({ file: high, lowFile: file(modelBytes()), scope }), /轻量|normalized|anchor/i);
  const { json, binary } = normalization.readGlb(normalization.normalizeGlb(modelBytes()).buffer);
  json.extras.villageModel.originalCenter[0] += 1;
  await assert.rejects(f.library.uploadAsset({ file: high, lowFile: file(normalization.writeGlb(json, binary)), scope }), /轻量|anchor/i);
  assert.equal(f.uploads.length, 0);
});

test('registration failure removes all successfully uploaded siblings', async () => {
  const f = fixture({ registrationFailure: true });
  const low = normalization.normalizeGlb(modelBytes()).buffer;
  await assert.rejects(f.library.uploadAsset({ file: file(modelBytes()), lowFile: file(low), scope }), /registration denied/);
  assert.equal(f.uploads.length, 3);
  assert.deepEqual(f.removals, [f.uploads.map(upload => upload.path)]);
});

test('a colliding display path leaves that existing file untouched and only removes our original', async () => {
  const f = fixture({ uploadFailure: path => !path.endsWith('.original.glb') });
  await assert.rejects(f.library.uploadAsset({ file: file(modelBytes()), scope }), /already exists/);
  assert.equal(f.uploads.length, 1);
  assert.match(f.uploads[0].path, /\.original\.glb$/);
  assert.deepEqual(f.removals, [[f.uploads[0].path]]);
  assert.equal(f.registrations.length, 0);
});

test('failed first original upload never triggers destructive rollback of a preexisting path', async () => {
  const f = fixture({ uploadFailure: () => true });
  await assert.rejects(f.library.uploadAsset({ file: file(modelBytes()), scope }), /already exists/);
  assert.equal(f.uploads.length, 0); assert.equal(f.removals.length, 0);
});

test('deleting an unbound asset removes only its main file and deterministic original/low siblings', async () => {
  const f = fixture();
  await f.library.deleteAsset({ id: 'a', storage_path: 'users/u/a.glb', normalization: { lowStoragePath: 'users/v/other.glb' } });
  assert.deepEqual(f.removals, [['users/u/a.glb', 'users/u/a.original.glb', 'users/u/a.low.glb']]);
});

test('signed URLs are cached by path within their TTL and refresh after expiry', async () => {
  let time = 0; const f = fixture({ now: () => time });
  assert.equal(typeof f.library.createSignedUrlForPath, 'function');
  const first = await f.library.createSignedUrlForPath('users/u/a.low.glb', 10);
  assert.equal(await f.library.createSignedUrl({ storage_path: 'users/u/a.low.glb' }, 10), first);
  await f.library.createSignedUrlForPath('users/u/a.original.glb', 10);
  assert.equal(f.signatures.length, 2);
  time = 10001;
  assert.notEqual(await f.library.createSignedUrlForPath('users/u/a.low.glb', 10), first);
  assert.equal(f.signatures.length, 3);
});

test('uploadAndPlace passes selected units and keeps explicit transform overrides on normalized assets', async () => {
  const calls = [];
  const asset = { id: 'a', normalization: { normalized: true, size: [4,10,2] } };
  const library = { uploadAsset: async input => { calls.push(input); return asset; },
    createSignedUrl: async () => 'signed', placeAsset: async input => calls.push(input) };
  await uploadAndPlaceModel({ library, file: {}, lowFile: {}, metersPerUnit: 0.001, scope, spaceId: 's', objectCode: 'B',
    transform: { expectedWidth: 20, snapToBase: false, normalized: false } });
  assert.equal(calls[0].metersPerUnit, 0.001); assert.ok(calls[0].lowFile);
  assert.deepEqual(calls[1].transform, { expectedLength: 4, expectedHeight: 10, expectedWidth: 20,
    snapToBase: false, normalized: false });
});

function metadataBytes({ large = false, cpuOnly = false, metadata = {} } = {}) {
  const { json, binary } = normalization.readGlb(normalization.normalizeGlb(modelBytes(), { metersPerUnit: 0.01 }).buffer);
  json.extras.villageModel = { ...json.extras.villageModel,
    ...(cpuOnly ? {} : { size: [0.04, 0.1, 0.02] }),
    lowStoragePath: 'users/u/a.low.glb', ...metadata };
  if (large) json.extras.unrelatedDescription = 'x'.repeat(70000);
  return normalization.writeGlb(json, binary);
}
function rangeFetcher(bytes, calls, ignoreRange = false) {
  return async (url, options) => {
    calls.push({ url, range: options.headers.Range });
    const input = new Uint8Array(bytes);
    const [, first, last] = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
    const start = Number(first), end = Math.min(Number(last), input.length - 1);
    return new Response(ignoreRange ? input : input.slice(start, end + 1), { status: ignoreRange ? 200 : 206,
      headers: ignoreRange ? {} : { 'Content-Range': `bytes ${start}-${end}/${input.length}` } });
  };
}
function getMetadata(library, asset) {
  assert.equal(typeof library.getAssetMetadata, 'function', 'saved assets need their own GLB metadata after reload');
  return library.getAssetMetadata(asset);
}

test('cold asset metadata reads one bounded GLB JSON range and coalesces repeated reads by storage path', async () => {
  const calls = []; const f = fixture({ fetcher: rangeFetcher(metadataBytes(), calls) });
  const asset = { storage_path: 'users/u/a.glb' };
  const [first, second] = await Promise.all([getMetadata(f.library, asset), getMetadata(f.library, { ...asset })]);
  assert.equal(first.normalized, true); assert.equal(first.anchor, 'bottom-center');
  assert.deepEqual(first.size, [0.04, 0.1, 0.02]);
  assert.equal(first.lowStoragePath, 'users/u/a.low.glb');
  assert.equal(second, first); assert.equal(await getMetadata(f.library, asset), first);
  assert.equal(calls.length, 1); assert.equal(calls[0].range, 'bytes=0-65535');
  assert.equal(f.signatures.length, 1);
});

test('large JSON metadata fetches only the remaining JSON segment after the initial partial range', async () => {
  const bytes = metadataBytes({ large: true }), calls = [];
  const f = fixture({ fetcher: rangeFetcher(bytes, calls) });
  const result = await getMetadata(f.library, { storage_path: 'users/u/a.glb' });
  assert.deepEqual(result.size, [0.04, 0.1, 0.02]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].range, `bytes=20-${19 + new DataView(bytes).getUint32(12, true)}`);
});

test('range-ignoring servers still yield JSON metadata and CPU-only dimensions derive from original units', async () => {
  const calls = []; const f = fixture({ fetcher: rangeFetcher(metadataBytes({ cpuOnly: true }), calls, true) });
  const result = await getMetadata(f.library, { storage_path: 'users/u/a.glb' });
  assert.deepEqual(result.size, [0.04, 0.1, 0.02]);
  assert.equal(calls.length, 1);
});

test('legacy GLBs without model metadata return cached null instead of another chosen model dimensions', async () => {
  const calls = [], modern = metadataBytes(), legacy = modelBytes();
  const f = fixture({ fetcher: async (url, options) => rangeFetcher(url.includes('/legacy.glb') ? legacy : modern, calls)(url, options) });
  assert.ok(await getMetadata(f.library, { storage_path: 'users/u/a.glb' }));
  assert.equal(await getMetadata(f.library, { storage_path: 'users/u/legacy.glb' }), null);
  assert.equal(await getMetadata(f.library, { storage_path: 'users/u/legacy.glb' }), null);
  assert.equal(calls.length, 2);
});

test('uploaded asset metadata is immediately reusable from a fresh database row without fetching bytes', async () => {
  const f = fixture({ fetcher: async () => { throw new Error('metadata should already be cached'); } });
  const asset = await f.library.uploadAsset({ file: file(modelBytes()), scope });
  const metadata = await getMetadata(f.library, { id: asset.id, storage_path: asset.storage_path });
  assert.deepEqual(metadata.size, [4,10,2]);
  assert.equal(metadata.originalStoragePath, asset.normalization.originalStoragePath);
});

test('asset deletion clears the metadata cache along with its signed URL cache', async () => {
  const calls = []; const f = fixture({ fetcher: rangeFetcher(metadataBytes(), calls) });
  const asset = { id: 'a', storage_path: 'users/u/a.glb' };
  await getMetadata(f.library, asset); await f.library.deleteAsset(asset);
  await getMetadata(f.library, asset);
  assert.equal(calls.length, 2); assert.equal(f.signatures.length, 2);
});

test('invalid GLB headers and invalid normalized dimensions cannot become placement metadata', async () => {
  const badHeader = fixture({ fetcher: rangeFetcher(new Uint8Array(24).buffer, []) });
  await assert.rejects(getMetadata(badHeader.library, { storage_path: 'users/u/a.glb' }), /GLB/);
  const badSize = fixture({ fetcher: rangeFetcher(metadataBytes({ metadata: { size: [4, null, -2] } }), []) });
  await assert.rejects(getMetadata(badSize.library, { storage_path: 'users/u/a.glb' }), /元数据|metadata|尺寸/i);
});

test('a model may advertise only its own low sibling path', async () => {
  const f = fixture({ fetcher: rangeFetcher(metadataBytes({ metadata: { lowStoragePath: 'users/v/other.low.glb' } }), []) });
  const result = await getMetadata(f.library, { storage_path: 'users/u/a.glb' });
  assert.deepEqual(result.size, [0.04, 0.1, 0.02]);
  assert.equal(result.lowStoragePath, undefined);
});

test('nested malformed bounds are rejected even when another direct size is valid', async () => {
  const bytes = metadataBytes({ metadata: { originalBounds: {
    min: [98,17,-51], max: [102,27,-49], size: ['invalid',10,2]
  } } });
  const f = fixture({ fetcher: rangeFetcher(bytes, []) });
  await assert.rejects(getMetadata(f.library, { storage_path: 'users/u/a.glb' }), /元数据|metadata|尺寸/i);
});

test('successful database deletion invalidates metadata even when storage cleanup reports failure', async () => {
  const calls = [];
  const f = fixture({ removalFailure: true, fetcher: rangeFetcher(metadataBytes(), calls) });
  const asset = { id: 'a', storage_path: 'users/u/a.glb' };
  await getMetadata(f.library, asset);
  await assert.rejects(f.library.deleteAsset(asset), /storage cleanup failed/);
  await getMetadata(f.library, asset);
  assert.equal(calls.length, 2);
});

test('a single uploaded GLB automatically saves an anchored low variant and a durable low binding path', async () => {
  const f = fixture();
  const result = await uploadAndPlaceModel({ library: f.library, file: file(modelBytes()), scope,
    spaceId: 's', objectCode: 'B', metersPerUnit: 0.01, transform: { scale: 1 } });
  const low = f.uploads.find(upload => upload.path.endsWith('.low.glb'));
  assert.ok(low, 'ordinary upload must generate the low model without another file selection');
  const highInspection = normalization.inspectGlb(await f.files.get(result.asset.storage_path).arrayBuffer());
  const lowInspection = normalization.inspectGlb(await low.body.arrayBuffer());
  assert.equal(lowInspection.normalized, true);
  assert.equal(lowInspection.anchor, 'bottom-center');
  assert.deepEqual(lowInspection.normalization.originalCenter, highInspection.normalization.originalCenter);
  assert.deepEqual(lowInspection.normalization.originalBounds, highInspection.normalization.originalBounds);
  assert.equal(lowInspection.normalization.metersPerUnit, 0.01);
  assert.ok(lowInspection.triangleCount <= highInspection.triangleCount);
  const transform = f.registrations.find(call => call.name === 'place_group_model').payload.p_transform;
  assert.equal(transform.lowStoragePath, low.path);
  assert.equal(result.asset.normalization.lowStoragePath, low.path);
});

test('automatic low upload failure rolls back original and high files without registering a partial asset', async () => {
  const f = fixture({ uploadFailure: path => path.endsWith('.low.glb') });
  await assert.rejects(f.library.uploadAsset({ file: file(modelBytes()), scope }), /already exists/);
  assert.equal(f.uploads.length, 2);
  assert.match(f.uploads[0].path, /\.original\.glb$/);
  assert.ok(!f.uploads[1].path.endsWith('.low.glb'));
  assert.deepEqual(f.removals, [f.uploads.map(upload => upload.path)]);
  assert.equal(f.registrations.length, 0);
});

test('ordinary upload stores the reduced low mesh rather than storing the high buffer twice', async () => {
  const positions = [], indices = [], side = 8;
  for (let z = 0; z <= side; z++) for (let x = 0; x <= side; x++) {
    positions.push(x, Math.min(x, z, side - x, side - z) / 4, z);
  }
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const a = z * (side + 1) + x, b = a + 1, c = a + side + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const vertices = new Float32Array(positions), triangles = new Uint16Array(indices);
  const binary = new Uint8Array(vertices.byteLength + triangles.byteLength);
  binary.set(new Uint8Array(vertices.buffer)); binary.set(new Uint8Array(triangles.buffer), vertices.byteLength);
  const input = normalization.writeGlb({ asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [100,20,-50] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertices.length / 3, type: 'VEC3', min: [0,0,0], max: [8,1,8] },
      { bufferView: 1, componentType: 5123, count: triangles.length, type: 'SCALAR' }
    ], bufferViews: [{ buffer: 0, byteLength: vertices.byteLength },
      { buffer: 0, byteOffset: vertices.byteLength, byteLength: triangles.byteLength }],
    buffers: [{ byteLength: binary.byteLength }]
  }, binary);
  const f = fixture(); const asset = await f.library.uploadAsset({ file: file(input), scope });
  const high = normalization.inspectGlb(await f.files.get(asset.storage_path).arrayBuffer());
  const low = normalization.inspectGlb(await f.files.get(asset.normalization.lowStoragePath).arrayBuffer());
  assert.equal(high.triangleCount, 128);
  assert.ok(low.triangleCount < 128, `low file still contains ${low.triangleCount} triangles`);
});
