const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const {
  normalizePackageFiles,
  validatePackageSelection,
  uploadVillagePackage
} = require("./village-package.js");

function fakeFile(name, content, root = "demo-v0", type) {
  const bytes = Buffer.from(content);
  return {
    name,
    webkitRelativePath: `${root}/${name}`,
    type: type ?? (name.endsWith(".geojson") ? "application/geo+json" : "application/octet-stream"),
    size: bytes.length,
    text: async () => bytes.toString("utf8"),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

async function validSelection() {
  const contents = {
    "boundary.geojson": '{"type":"FeatureCollection","features":[{}]}',
    "imagery.webp": "preview",
    "buildings.geojson": '{"type":"FeatureCollection","features":[{},{}]}',
    "roads.geojson": '{"type":"FeatureCollection","features":[]}',
    "waterways.geojson": '{"type":"FeatureCollection","features":[]}',
    "water_areas.geojson": '{"type":"FeatureCollection","features":[]}',
    "water.geojson": '{"type":"FeatureCollection","features":[]}',
    "contours.geojson": '{"type":"FeatureCollection","features":[{}]}'
  };
  const files = Object.entries(contents).map(([name, content]) => fakeFile(name, content));
  const manifest = {
    schema_version: "village-v0-package/1",
    village: { name: "测试村", slug: "demo", bounds: [113, 23, 114, 24] },
    files: Object.entries(contents).map(([path, content]) => ({
      path,
      sha256: createHash("sha256").update(content).digest("hex")
    })),
    imagery: { path: "imagery.webp", bounds: [113, 23, 114, 24] },
    layers: [
      { type: "building", path: "buildings.geojson", featureCount: 2 },
      { type: "road", path: "roads.geojson", featureCount: 0 },
      { type: "water", path: "water.geojson", featureCount: 0 },
      { type: "contours", path: "contours.geojson", featureCount: 1 }
    ]
  };
  files.push(fakeFile("manifest.json", JSON.stringify(manifest)));
  files.push(fakeFile("validation.json", JSON.stringify({ valid: true })));
  return files;
}

test("文件夹选择会去掉共同根目录并拒绝嵌套逃逸", () => {
  const files = normalizePackageFiles([
    fakeFile("manifest.json", "{}"),
    fakeFile("buildings.geojson", "{}")
  ]);
  assert.deepEqual([...files.keys()], ["manifest.json", "buildings.geojson"]);
  assert.throws(() => normalizePackageFiles([{ ...fakeFile("x", ""), webkitRelativePath: "a/../x" }]), /PACKAGE_PATH_INVALID/);
});

test("完整数据包通过结构和SHA-256校验", async () => {
  const result = await validatePackageSelection(await validSelection());
  assert.equal(result.manifest.village.name, "测试村");
  assert.equal(result.summary.valid, true);
  assert.equal(result.summary.fileCount, 10);
});

test("任何成果被修改后都不能上传", async () => {
  const files = await validSelection();
  const index = files.findIndex((file) => file.name === "buildings.geojson");
  files[index] = fakeFile("buildings.geojson", "changed");
  await assert.rejects(() => validatePackageSelection(files), /PACKAGE_HASH_MISMATCH: buildings.geojson/);
});

test("上传后返回只含私有存储路径的RPC输入", async () => {
  const uploads = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, "village-datasets");
      return { upload: async (path) => (uploads.push(path), { data: { path }, error: null }) };
    }
  };
  const result = await uploadVillagePackage({
    supabaseClient: { storage },
    villageId: "village-1",
    selection: await validatePackageSelection(await validSelection()),
    packageId: "demo-v0"
  });
  assert.equal(uploads.length, 10);
  assert.equal(result.imageryConfig.path, "village-1/demo-v0/imagery.webp");
  assert.deepEqual(result.layerManifest.layers.map((item) => item.path), [
    "village-1/demo-v0/buildings.geojson",
    "village-1/demo-v0/roads.geojson",
    "village-1/demo-v0/water.geojson",
    "village-1/demo-v0/contours.geojson"
  ]);
  assert.equal(JSON.stringify(result).includes("http"), false);
});

test("上传使用文件扩展名的规范 MIME 而不信任浏览器的通用类型", async () => {
  const uploads = [];
  const storage = {
    from() {
      return {
        upload: async (path, body, options) => {
          uploads.push({ path, body, contentType: options.contentType });
          return { data: { path }, error: null };
        }
      };
    }
  };
  const files = await validSelection();
  for (const file of files) file.type = "application/octet-stream";
  await uploadVillagePackage({
    supabaseClient: { storage },
    villageId: "village-1",
    selection: await validatePackageSelection(files),
    packageId: "mime-v0"
  });
  assert.equal(uploads.every((item) => item.body instanceof ArrayBuffer), true);
  assert.deepEqual(Object.fromEntries(uploads.map((item) => [item.path.split("/").at(-1), item.contentType])), {
    "boundary.geojson": "application/geo+json",
    "imagery.webp": "image/webp",
    "buildings.geojson": "application/geo+json",
    "roads.geojson": "application/geo+json",
    "waterways.geojson": "application/geo+json",
    "water_areas.geojson": "application/geo+json",
    "water.geojson": "application/geo+json",
    "contours.geojson": "application/geo+json",
    "manifest.json": "application/json",
    "validation.json": "application/json"
  });
});

test("中途上传失败会清理已经写入的残片", async () => {
  const removed = [];
  let calls = 0;
  const storage = {
    from() {
      return {
        upload: async (path) => (++calls === 3 ? { error: new Error("network") } : { data: { path }, error: null }),
        remove: async (paths) => (removed.push(...paths), { error: null })
      };
    }
  };
  const selection = await validatePackageSelection(await validSelection());
  await assert.rejects(() => uploadVillagePackage({
    supabaseClient: { storage },
    villageId: "village-1",
    selection,
    packageId: "failed-v0"
  }), /network/);
  assert.deepEqual(removed, [
    "village-1/failed-v0/boundary.geojson",
    "village-1/failed-v0/imagery.webp"
  ]);
});
