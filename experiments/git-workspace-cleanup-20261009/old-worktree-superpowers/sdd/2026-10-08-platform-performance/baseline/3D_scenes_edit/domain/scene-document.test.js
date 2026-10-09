const test = require("node:test");
const assert = require("node:assert/strict");

const SceneDocument = require("./scene-document");

test("creates an empty overlay linked to an immutable baseline", () => {
  const doc = SceneDocument.create({
    projectId: "p1",
    villageId: "v1",
    groupId: "g1",
    spaceId: "s1",
    baselineRevision: 7,
    now: "2026-09-14T02:00:00.000Z"
  });

  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(doc.baselineRef, { spaceId: "s1", revision: 7 });
  assert.deepEqual(doc.objects, []);
  assert.deepEqual(doc.groups, []);
  assert.deepEqual(doc.layers, [
    { id: "design", name: "方案要素", visible: true, locked: false, order: 0 }
  ]);
  assert.equal(doc.updatedAt, "2026-09-14T02:00:00.000Z");
});

test("accepts public-space point, line, surface and structure records", () => {
  const fixtures = [
    {
      id: "o1",
      kind: "asset",
      category: "bench",
      geometry: { type: "Point", coordinates: [114.1, 30.2] },
      transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 },
      properties: {},
      layerId: "design"
    },
    {
      id: "o2",
      kind: "line",
      category: "path",
      geometry: { type: "LineString", coordinates: [[114.1, 30.2], [114.1001, 30.2001]] },
      properties: { widthM: 1.5, heightM: 0 },
      layerId: "design"
    },
    {
      id: "o3",
      kind: "surface",
      category: "paving",
      geometry: { type: "Polygon", coordinates: [[[114.1, 30.2], [114.1001, 30.2], [114.1001, 30.2001], [114.1, 30.2]]] },
      properties: { elevationM: 0, extrusionHeightM: 0.1 },
      layerId: "design"
    },
    {
      id: "o4",
      kind: "structure",
      category: "pavilion",
      geometry: { type: "Point", coordinates: [114.1, 30.2] },
      transform: { headingDeg: 15, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 },
      properties: {},
      layerId: "design"
    }
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(SceneDocument.validateObject(fixture), { ok: true, errors: [] });
  }
});

test("rejects unsupported kinds, malformed geometry and out-of-range coordinates", () => {
  const result = SceneDocument.validateObject({
    id: "bad",
    kind: "house",
    category: "bench",
    geometry: { type: "Point", coordinates: [999, 30] },
    layerId: "design"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /kind/);
  assert.match(result.errors.join(" "), /longitude/);
});

test("validates document identity, unique ids and group references", () => {
  const doc = SceneDocument.create({
    projectId: "p1",
    villageId: "v1",
    groupId: "g1",
    spaceId: "s1",
    baselineRevision: 7
  });
  const object = {
    id: "same",
    kind: "asset",
    category: "tree",
    geometry: { type: "Point", coordinates: [114.1, 30.2] },
    transform: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 },
    properties: {},
    layerId: "design",
    groupId: "missing"
  };
  doc.objects = [object, SceneDocument.clone(object)];

  const result = SceneDocument.validate(doc);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /duplicate object id/);
  assert.match(result.errors.join(" "), /unknown group/);
});

test("clone produces a deep copy", () => {
  const value = { objects: [{ properties: { materialRef: "seed:paving:stone" } }] };
  const cloned = SceneDocument.clone(value);
  cloned.objects[0].properties.materialRef = "changed";
  assert.equal(value.objects[0].properties.materialRef, "seed:paving:stone");
});

test("administrator sandbox document is valid without a group", () => {
  const doc = SceneDocument.create({
    projectId: "p-admin", villageId: "v1", groupId: null, spaceId: "shared",
    baselineRevision: 2, scopeKind: "admin_sandbox", ownerId: "admin-1"
  });
  assert.equal(doc.groupId, null);
  assert.deepEqual(doc.metadata, { scopeKind: "admin_sandbox", ownerId: "admin-1" });
  assert.deepEqual(SceneDocument.validate(doc), { ok: true, errors: [] });
});
