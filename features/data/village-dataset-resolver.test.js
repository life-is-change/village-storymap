const test = require("node:test");
const assert = require("node:assert/strict");

const { collectStoragePaths, createSignedUrlMap, resolveDatasetResources, requireWriteContext } = require("./village-dataset-resolver.js");

const polygon = { type: "Polygon", coordinates: [[[110, 20], [112, 20], [112, 22], [110, 20]]] };

test("资源解析器拒绝未知图层和任意外域URL", () => {
  assert.throws(() => resolveDatasetResources({
    village: { boundary: polygon },
    dataset: { layerManifest: [{ type: "script", url: "https://evil.example/a.js" }] },
    signedUrls: {}
  }), /UNSUPPORTED_LAYER_TYPE/);
});

test("资源URL只能来自服务端签名结果", () => {
  assert.throws(() => resolveDatasetResources({
    village: { boundary: polygon },
    dataset: { layerManifest: [{ type: "building", path: "v1/buildings.geojson", url: "https://evil.example/a" }] },
    signedUrls: {}
  }), /UNTRUSTED_RESOURCE_URL/);
  const resources = resolveDatasetResources({
    village: { boundary: polygon },
    dataset: { layerManifest: [{ type: "building", path: "v1/buildings.geojson" }] },
    signedUrls: { "v1/buildings.geojson": "https://signed.test/buildings" }
  });
  assert.equal(resources.layers.building, "https://signed.test/buildings");
  assert.deepEqual(resources.initialExtent, [110, 20, 112, 22]);
});

test("写入上下文缺失村庄时失败", () => {
  assert.throws(() => requireWriteContext({ teachingProjectId: "p1", spaceId: "s1" }), /VILLAGE_CONTEXT_REQUIRED/);
  assert.deepEqual(requireWriteContext({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" }), {
    teachingProjectId: "p1", villageId: "v1", spaceId: "s1"
  });
});

test("数据清单中的图层和影像路径统一生成短时签名地址", async () => {
  const dataset = {
    layer_manifest: { layers: [
      { type: "building", path: "v1/buildings.geojson" },
      { type: "road", storage_path: "v1/roads.geojson" }
    ] },
    imagery_config: { storagePath: "v1/preview.webp" }
  };
  assert.deepEqual(collectStoragePaths(dataset), [
    "v1/buildings.geojson", "v1/roads.geojson", "v1/preview.webp"
  ]);
  const calls = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, "village-datasets");
      return {
        async createSignedUrl(path, expiresIn) {
          calls.push([path, expiresIn]);
          return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
        }
      };
    }
  };
  const signed = await createSignedUrlMap({ storage }, dataset, { expiresIn: 120 });
  assert.equal(signed["v1/preview.webp"], "https://signed.test/v1/preview.webp");
  assert.deepEqual(calls, [
    ["v1/buildings.geojson", 120], ["v1/roads.geojson", 120], ["v1/preview.webp", 120]
  ]);
});
