const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const SceneDocument = require("../domain/scene-document");
const Commands = require("../domain/scene-commands");
const { toCesiumDescriptors } = require("../preview_3d/scene-to-cesium");
const { mapLimit } = require("../preview_3d/scene-preview-adapter");

function largeFixture() {
  const document = SceneDocument.create({ projectId: "p", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 1 });
  const assets = new Map();
  for (let index = 0; index < 50; index += 1) assets.set(`asset-${index}`, { id: `asset-${index}`, fileType: "glb", storagePath: `group/g/${index}.glb`, status: "published" });
  for (let index = 0; index < 300; index += 1) document.objects.push({
    id: `object-${index}`, kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114 + index * .000001, 30] },
    transform: { headingDeg: index % 360, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 },
    properties: { assetRef: `asset-${index % 50}`, footprintM: [1, 1] }, layerId: "design", groupId: null, zIndex: index
  });
  return { document, assets };
}

test("300-object domain and descriptor operations stay within their CPU budgets", () => {
  for (let run = 0; run < 3; run += 1) {
    const { document, assets } = largeFixture();
    let started = performance.now();
    assert.equal(SceneDocument.validate(document).ok, true);
    assert.ok(performance.now() - started < 100, "document validation exceeded 100 ms");
    started = performance.now();
    const next = Commands.execute(Commands.createHistory(document), { type: "updateObject", id: "object-150", patch: { transform: { headingDeg: 45 } } });
    assert.equal(next.present.objects[150].transform.headingDeg, 45);
    assert.ok(performance.now() - started < 100, "command execution exceeded 100 ms");
    started = performance.now();
    const descriptors = toCesiumDescriptors(document, assets);
    assert.equal(descriptors.models.length, 300);
    assert.equal(descriptors.instances.length, 50);
    assert.ok(performance.now() - started < 200, "Cesium descriptor conversion exceeded 200 ms");
  }
});

test("parallel model work never exceeds four active resolves", async () => {
  let active = 0;
  let maximum = 0;
  await mapLimit(Array.from({ length: 60 }, (_, index) => index), 4, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
  });
  assert.equal(maximum, 4);
});
