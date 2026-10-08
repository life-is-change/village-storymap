const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectStoragePaths,
  createSignedUrlMap,
  normalizeFeatureCollection,
  resolveBasemapGeoref,
  resolveDatasetResources,
  requireWriteContext
} = require("./village-dataset-resolver.js");

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

test("旧米埗清单的复数图层名兼容为规范单数名且继续使用静态资源", () => {
  const resources = resolveDatasetResources({
    village: { boundary: polygon },
    dataset: {
      layer_manifest: { layers: [
        { type: "buildings", featureCount: 210 },
        { type: "roads" },
        { type: "water" },
        { type: "contours" }
      ] },
      imagery_config: { kind: "legacy_mibu_imagery" }
    },
    signedUrls: {}
  });
  assert.equal(resources.storageBacked, false);
  assert.deepEqual(resources.layers, {});
  assert.equal(resources.imagery, null);
  assert.deepEqual(resources.initialExtent, [110, 20, 112, 22]);
});

test("本地成果缺少对象编号时按文件顺序补充稳定编号", () => {
  const source = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { score: 0.9 }, geometry: polygon },
      { type: "Feature", properties: { id: "existing" }, geometry: polygon }
    ]
  };
  const normalized = normalizeFeatureCollection(source, "building");
  assert.equal(normalized.features[0].properties.id, "AUTO_BUILDING_000001");
  assert.equal(normalized.features[1].properties.id, "existing");
  assert.equal(source.features[0].properties.id, undefined);
});

test("OSM 对象编号会映射为平台统一编号", () => {
  const normalized = normalizeFeatureCollection({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { osm_id: 12345 }, geometry: polygon }]
  }, "road");
  assert.equal(normalized.features[0].properties.id, "12345");
});

test("动态村庄影像范围覆盖默认米埗范围，旧数据继续使用默认范围", () => {
  const fallback = { imageUrl: "mibu.webp", minX: 1, minY: 2, maxX: 3, maxY: 4 };
  assert.deepEqual(resolveBasemapGeoref({
    storageBacked: true,
    imagery: "signed-red.webp",
    initialExtent: [113.8, 22.7, 113.9, 22.8]
  }, fallback), {
    imageUrl: "signed-red.webp", minX: 113.8, minY: 22.7, maxX: 113.9, maxY: 22.8, crs: "EPSG:4326"
  });
  assert.deepEqual(resolveBasemapGeoref({ storageBacked: false }, fallback), fallback);
});
