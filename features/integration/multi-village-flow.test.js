const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("../villages/village-model.js");
const resolver = require("../data/village-dataset-resolver.js");

test("正式村庄与米埗练习村庄共享同一教学项目但保持空间隔离", () => {
  const entries = model.buildProjectEntries({
    project: {
      id: "p1",
      practice_village_id: "mibu",
      formal_village_id: "formal-1",
      formal_project_open: true
    },
    villages: [
      { id: "mibu", name: "米埗村", is_practice: true, status: "published" },
      { id: "red", name: "红星村", is_practice: true, status: "published" },
      { id: "formal-1", name: "正式村", is_practice: false, status: "published" }
    ]
  });
  assert.deepEqual(entries.map((entry) => entry.villageId), ["formal-1", "mibu", "red"]);

  const spaces = [
    { id: "m-personal", teaching_project_id: "p1", village_id: "mibu", space_type: "practice_personal", owner_id: "u1" },
    { id: "m-shared", teaching_project_id: "p1", village_id: "mibu", space_type: "practice_shared" },
    { id: "f-personal", teaching_project_id: "p1", village_id: "formal-1", space_type: "formal_personal", owner_id: "u1" },
    { id: "f-shared", teaching_project_id: "p1", village_id: "formal-1", space_type: "formal_shared" },
    { id: "wrong-group", teaching_project_id: "p1", village_id: "mibu", space_type: "group_plan", group_id: "g1" }
  ];
  assert.deepEqual(model.filterSpacesForContext({
    spaces, context: { teaching_project_id: "p1", village_id: "mibu", village_role: "practice" },
    actor: { user_id: "u1", group_id: "g1", is_staff: false }
  }).map((space) => space.id), ["m-personal", "m-shared"]);
  assert.deepEqual(model.filterSpacesForContext({
    spaces, context: { teaching_project_id: "p1", village_id: "formal-1", village_role: "formal" },
    actor: { user_id: "u1", group_id: "g1", is_staff: false }
  }).map((space) => space.id), ["f-personal", "f-shared"]);
});

test("正式村庄V0资源只能通过签名路径进入地图", () => {
  const resources = resolver.resolveDatasetResources({
    village: {
      boundary: { type: "Polygon", coordinates: [[[110, 20], [111, 20], [111, 21], [110, 20]]] }
    },
    dataset: { layer_manifest: { layers: [{ type: "building", path: "formal/v0/buildings.geojson" }] } },
    signedUrls: { "formal/v0/buildings.geojson": "https://signed.test/formal-buildings" }
  });
  assert.equal(resources.layers.building, "https://signed.test/formal-buildings");
  assert.throws(() => resolver.resolveDatasetResources({
    village: { boundary: { type: "Polygon", coordinates: [[[110, 20], [111, 20], [111, 21], [110, 20]]] } },
    dataset: { layer_manifest: { layers: [{ type: "building", path: "formal/v0/buildings.geojson" }] } },
    signedUrls: {}
  }), /SIGNED_RESOURCE_REQUIRED/);
});
