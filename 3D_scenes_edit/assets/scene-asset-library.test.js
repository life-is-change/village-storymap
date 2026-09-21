const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Assets = require("./scene-asset-library");

test("maps stored uploads into placeable catalog assets", () => {
  assert.deepEqual(Assets.toCatalogAsset({ id: "a1", kind: "model", storage_path: "group/g/a.glb", display_name: "自制座椅", metadata: { category: "bench", placementKind: "asset", realSizeM: [2, .8, 1], topViewPath: "group/g/a.top.png" } }), {
    id: "a1", kind: "asset", category: "bench", label: "自制座椅", footprintM: [2, .8], defaultHeightM: 1,
    renderer: "glb", fileType: "glb", storagePath: "group/g/a.glb", scope: undefined,
    topViewPath: "group/g/a.top.png",
    metadata: { category: "bench", placementKind: "asset", realSizeM: [2, .8, 1], topViewPath: "group/g/a.top.png" }
  });
});

function makeFile(name, type, bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes || "x");
  return {
    name,
    type,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); }
  };
}

function glb(json = {}) {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x67, 0x6c, 0x54, 0x46], 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(encoded, 20);
  bytes.fill(0x20, 20 + encoded.length);
  return bytes;
}

test("validates supported model, texture and symbol files", async () => {
  assert.equal((await Assets.validateAssetFile(makeFile("bench.glb", "model/gltf-binary", glb()), "model")).ok, true);
  assert.equal((await Assets.validateAssetFile(makeFile("stone.webp", "image/webp", "image"), "texture")).ok, true);
  assert.equal((await Assets.validateAssetFile(makeFile("tree.png", "image/png", "image"), "symbol")).ok, true);
  assert.equal((await Assets.validateAssetFile(makeFile("tree.svg", "image/svg+xml", "<svg viewBox='0 0 10 10'></svg>"), "symbol")).ok, true);
});

test("rejects mismatches, oversized files, unsafe SVG and invalid GLB", async () => {
  const mismatch = await Assets.validateAssetFile(makeFile("bench.glb", "image/png", glb()), "model");
  assert.equal(mismatch.code, "MIME_MISMATCH");
  const invalidGlb = await Assets.validateAssetFile(makeFile("bench.glb", "model/gltf-binary", "not-glb"), "model");
  assert.equal(invalidGlb.code, "INVALID_GLB");
  const unsafe = await Assets.validateAssetFile(makeFile("tree.svg", "image/svg+xml", "<svg onload='alert(1)'><script/></svg>"), "symbol");
  assert.equal(unsafe.code, "UNSAFE_SVG");
  const huge = makeFile("stone.png", "image/png", "x");
  huge.size = 10 * 1024 * 1024 + 1;
  assert.equal((await Assets.validateAssetFile(huge, "texture")).code, "FILE_TOO_LARGE");
});

test("inspects GLB metadata and accessor bounds", () => {
  const info = Assets.inspectGlbHeader(glb({
    accessors: [{ min: [-1, -2, 0], max: [3, 4, 5] }],
    meshes: [{ primitives: [{}, {}] }],
    images: [{ uri: "a.png" }]
  }));
  assert.equal(info.version, 2);
  assert.equal(info.primitiveCount, 2);
  assert.equal(info.textureCount, 1);
  assert.deepEqual(info.bounds, { min: [-1, -2, 0], max: [3, 4, 5], size: [4, 6, 5] });
});

test("sanitizes names and builds owner-scoped unpredictable paths", () => {
  assert.equal(Assets.sanitizeDisplayName("  <公园/座椅>  "), "公园座椅");
  assert.equal(Assets.buildStoragePath({ scope: "group", ownerId: "g1", fileName: "座椅.GLB", uuid: "abc", date: "2026-09-14" }), "group/g1/2026-09/abc.glb");
  assert.throws(() => Assets.buildStoragePath({ scope: "world", ownerId: "g1", fileName: "x.glb" }), /scope/);
});

test("calibrates real dimensions, heading and ground offset", () => {
  const calibrated = Assets.calibrateAsset({ metadata: { measuredSizeM: [2, 1, 1] } }, {
    widthM: 4, depthM: 3, heightM: 2, headingCorrectionDeg: 90, groundOffsetM: -0.2
  });
  assert.deepEqual(calibrated.metadata.realSizeM, [4, 3, 2]);
  assert.deepEqual(calibrated.metadata.calibrationScale, [2, 3, 2]);
  assert.equal(calibrated.metadata.headingCorrectionDeg, 90);
});

test("serializes composite components in local meters and instantiates fresh ids", () => {
  const origin = [114.3, 30.5];
  const component = Assets.createComponent([
    { id: "tree-1", kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114.3, 30.5] }, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: { assetRef: "seed:tree:deciduous" }, layerId: "design" },
    { id: "bench-1", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.30001, 30.5] }, transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: { assetRef: "seed:bench:wood" }, layerId: "design" }
  ], origin, { id: "component-1", name: "树池座椅" });
  assert.equal(component.coordinateSpace, "local-m");
  assert.ok(component.objects[1].geometry.coordinates[0] > 0.9);

  const placed = Assets.instantiateComponent(component, [114.31, 30.51], {
    idFactory: (sourceId) => `new-${sourceId}`,
    groupId: "new-group"
  });
  assert.deepEqual(placed.objects.map((item) => item.id), ["new-tree-1", "new-bench-1"]);
  assert.equal(placed.objects[0].groupId, "new-group");
  assert.deepEqual(component.objects.map((item) => item.id), ["tree-1", "bench-1"]);
});

test("asset library uploads, publishes, copies, signs and archives through injected boundaries", async () => {
  const calls = [];
  const library = Assets.createAssetLibrary({
    storage: {
      async upload(path, file, options) { calls.push(["upload", path, file.name, options.contentType]); return { data: { path }, error: null }; },
      async createSignedUrl(path, seconds) { calls.push(["sign", path, seconds]); return { data: { signedUrl: `signed:${path}` }, error: null }; }
    },
    dataClient: {
      async registerAsset(record) { calls.push(["register", record]); return { ok: true, data: { id: "asset-1", ...record } }; },
      async publishAsset(id) { calls.push(["publish", id]); return { ok: true, data: { id: "shared-1" } }; },
      async copySharedAsset(id, groupId) { calls.push(["copy", id, groupId]); return { ok: true, data: { id: "copy-1" } }; },
      async archiveAsset(id) { calls.push(["archive", id]); return { ok: true, data: { id, archived: true, referenced_by_version: true } }; },
      async saveComponent(component) { calls.push(["save-component", component]); return { ok: true, data: { id: "component-1" } }; },
      async publishComponent(id) { calls.push(["publish-component", id]); return { ok: true, data: { id: "shared-component" } }; },
      async copySharedComponent(id, groupId) { calls.push(["copy-component", id, groupId]); return { ok: true, data: { id: "component-copy" } }; },
      async archiveComponent(id) { calls.push(["archive-component", id]); return { ok: true, data: { id, archived: true } }; }
    },
    uuid: () => "uuid-1",
    now: () => new Date("2026-09-14T00:00:00Z")
  });
  const uploaded = await library.upload(makeFile("bench.glb", "model/gltf-binary", glb()), {
    kind: "model", scope: "group", ownerId: "g1", courseId: "c1", groupId: "g1", displayName: "木座椅"
  });
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.data.storage_path, "group/g1/2026-09/uuid-1.glb");
  assert.equal(await library.resolveUrl(uploaded.data).then((result) => result.url), "signed:group/g1/2026-09/uuid-1.glb");
  assert.equal((await library.publishToCourse("asset-1")).data.id, "shared-1");
  assert.equal((await library.copySharedAsset("shared-1", "g1")).data.id, "copy-1");
  assert.equal((await library.removeAsset("asset-1")).data.referenced_by_version, true);
  assert.equal((await library.saveComponent({ id: "local" })).data.id, "component-1");
  assert.equal((await library.publishComponent("component-1")).data.id, "shared-component");
  assert.equal((await library.copySharedComponent("shared-component", "g1")).data.id, "component-copy");
  assert.equal((await library.removeComponent("component-1")).data.archived, true);
  assert.deepEqual(calls.map((call) => call[0]), ["upload", "register", "sign", "publish", "copy", "archive", "save-component", "publish-component", "copy-component", "archive-component"]);
});

test("administrator sandbox model uploads remain personal and have no group id", async () => {
  let registered = null;
  const library = Assets.createAssetLibrary({
    storage: { async upload() { return { data: {}, error: null }; }, async remove() {} },
    dataClient: { async registerAsset(record) { registered = record; return { ok: true, data: record }; } },
    uuid: () => "admin-model",
    now: () => new Date("2026-09-14T00:00:00Z")
  });
  await library.upload(makeFile("座椅.glb", "model/gltf-binary", glb()), {
    kind: "model", scope: "personal", ownerId: "admin-1", ownerUserId: "admin-1",
    courseId: "course-1", groupId: null, displayName: "管理员座椅"
  });
  assert.equal(registered.scope_kind, "personal");
  assert.equal(registered.group_id, null);
  assert.equal(registered.owner_id, "admin-1");
  assert.equal(registered.storage_path, "personal/admin-1/2026-09/admin-model.glb");
});

test("seed catalog covers every first-release public-space category", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "seed/catalog.json"), "utf8"));
  const categories = new Set(catalog.assets.map((asset) => asset.category));
  for (const category of ["paving", "grass", "water", "planter", "planting", "activity-field", "path", "curb", "low-wall", "fence", "hedge", "drainage", "tree", "shrub", "bench", "table", "light", "bin", "sign", "sculpture", "fitness", "pavilion", "pergola", "bus-stop", "stall", "stage", "play-equipment"]) {
    assert.equal(categories.has(category), true, category);
  }
  assert.equal(catalog.assets.every((asset) => asset.id.startsWith(`seed:${asset.category}:`) && asset.renderer), true);
});

test("uploads a generated top view beside a GLB and records it in asset metadata", async () => {
  const calls = [];
  const topViewBlob = { type: "image/png", size: 321 };
  const library = Assets.createAssetLibrary({
    storage: {
      async upload(path, data, options) { calls.push(["upload", path, data, options]); return { data: { path }, error: null }; },
      async remove(paths) { calls.push(["remove", paths]); return { error: null }; }
    },
    dataClient: {
      async registerAsset(record) { calls.push(["register", record]); return { ok: true, data: { id: "asset-top", ...record } }; }
    },
    uuid: () => "with-top",
    now: () => new Date("2026-09-21T00:00:00Z")
  });

  const result = await library.upload(makeFile("custom.glb", "model/gltf-binary", glb()), {
    kind: "model", scope: "group", ownerId: "g1", courseId: "c1", groupId: "g1",
    displayName: "学生模型", topViewBlob, metadata: { category: "sculpture", placementKind: "asset" }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter(([kind]) => kind === "upload").map(([, path]) => path), [
    "group/g1/2026-09/with-top.glb",
    "group/g1/2026-09/with-top.top.png"
  ]);
  const record = calls.find(([kind]) => kind === "register")[1];
  assert.equal(record.metadata.topViewPath, "group/g1/2026-09/with-top.top.png");
  assert.equal(record.metadata.topViewStatus, "ready");
});

test("removes both GLB and generated top view when asset registration fails", async () => {
  let removed = null;
  const library = Assets.createAssetLibrary({
    storage: {
      async upload(path) { return { data: { path }, error: null }; },
      async remove(paths) { removed = paths; return { error: null }; }
    },
    dataClient: { async registerAsset() { return { ok: false, code: "REGISTER_FAILED" }; } },
    uuid: () => "rollback-top",
    now: () => new Date("2026-09-21T00:00:00Z")
  });
  await library.upload(makeFile("custom.glb", "model/gltf-binary", glb()), {
    kind: "model", scope: "group", ownerId: "g1", courseId: "c1", groupId: "g1",
    topViewBlob: { type: "image/png", size: 10 }, metadata: {}
  });
  assert.deepEqual(removed, ["group/g1/2026-09/rollback-top.glb", "group/g1/2026-09/rollback-top.top.png"]);
});

test("the bundled component catalog provides a broad set of valid local GLB models", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "seed/catalog.json"), "utf8"));
  const modeled = catalog.assets.filter((asset) => asset.fileType === "glb");
  assert.ok(modeled.length >= 20, `expected at least 20 bundled models, got ${modeled.length}`);
  for (const label of ["石质座椅", "圆桌凳", "木花箱", "自行车架", "隔离桩", "村务宣传栏", "草坪灯", "饮水台", "遮阳棚", "景观小桥"]) {
    assert.equal(modeled.some((asset) => asset.label === label), true, label);
  }
  for (const asset of modeled) {
    assert.equal(asset.fileType, "glb", asset.category);
    assert.match(asset.url, /^3D_scenes_edit\/assets\/models\/.+\.glb(?:\?v=[\w-]+)?$/);
    const file = path.join(__dirname, "../..", asset.url.split("?")[0]);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF", asset.category);
    assert.ok(Assets.inspectGlbHeader(bytes).primitiveCount >= 2, asset.category);
  }
});

test("bundled table uses glTF Y-up coordinates and includes seats with full supports", () => {
  const bytes = fs.readFileSync(path.join(__dirname, "models/table.glb"));
  const inspection = Assets.inspectGlbHeader(bytes);
  assert.ok(Math.abs(inspection.bounds.min[1]) < 0.001, "the table must stand on Y=0 in glTF space");
  assert.ok(inspection.bounds.size[1] > 0.8 && inspection.bounds.size[1] < 1, "Y must be the table height");
  assert.ok(inspection.bounds.size[2] >= 1.8, "Z must include the two-sided seating depth");
  assert.ok(inspection.primitiveCount >= 11, "table set must include top, seats and complete supports");
});
