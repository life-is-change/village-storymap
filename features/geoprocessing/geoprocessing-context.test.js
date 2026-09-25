const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveGeoprocessingContext, enterPersonalGeoprocessingSpace } = require("./geoprocessing-context.js");
const { findVillagePreview } = require("./village-preview.js");
const { createGeoprocessingClient } = require("./geoprocessing-client.js");
const catalog = require("../../assets/villages/catalog.json");

const MIBU_ID = "00000000-0000-4000-8000-000000000001";

test("legacy Mibu dataset uses the existing preview, worker, and personal result space", () => {
  const context = resolveGeoprocessingContext({
    teachingProjectId: "project-1", villageId: MIBU_ID,
    village: { publishedDataset: { imagery_config: { kind: "legacy_mibu_imagery" } } },
    datasetId: "dataset-1", datasetResources: { imagery: null, initialExtent: [1, 2, 3, 4] }
  });
  assert.equal(context.villageId, MIBU_ID);
  assert.equal(context.personalVillageId, MIBU_ID);
  assert.equal(context.previewVillageId, "mibu");
  assert.equal(context.previewResources, null);
  assert.equal(context.teachingProjectId, "project-1");
  assert.equal(context.datasetId, null);
  assert.equal(context.maxAreaSqKm, 2);
  assert.ok(findVillagePreview(catalog, context.previewVillageId));
});

test("legacy Mibu submission selects the existing local-worker RPC signature", async () => {
  const calls = [];
  const context = resolveGeoprocessingContext({
    teachingProjectId: "project-1", villageId: MIBU_ID, datasetId: "dataset-1",
    village: { publishedDataset: { imagery_config: { kind: "legacy_mibu_imagery" } } }
  });
  const client = createGeoprocessingClient({ supabaseClient: {
    rpc: async (name, args) => { calls.push([name, args]); return { data: "run-1", error: null }; }
  } });
  await client.submit({
    courseId: "mibu-village-planning", ...context,
    requestedSteps: ["buildings"], aoi: { type: "Polygon", coordinates: [] }
  });
  assert.equal(calls[0][1].p_village_id, MIBU_ID);
  assert.equal(calls[0][1].p_dataset_id, null);
  assert.equal(calls[0][1].p_teaching_project_id, "project-1");
});

test("published modern datasets keep their own village, preview, and contextual worker request", () => {
  const resources = { imagery: "signed-image", initialExtent: [1, 2, 3, 4] };
  const context = resolveGeoprocessingContext({
    teachingProjectId: "project-1", villageId: "red-uuid", datasetId: "dataset-2",
    village: { publishedDataset: { layer_manifest: { worker_manifest: { files: {} } } } },
    datasetResources: resources
  });
  assert.equal(context.villageId, "red-uuid");
  assert.equal(context.personalVillageId, "red-uuid");
  assert.equal(context.previewVillageId, "red-uuid");
  assert.equal(context.previewResources, resources);
  assert.equal(context.teachingProjectId, "project-1");
  assert.equal(context.datasetId, null);
  assert.equal(context.maxAreaSqKm, null);
});

test("a future modern Mibu dataset is not sent to the legacy worker", () => {
  const context = resolveGeoprocessingContext({
    teachingProjectId: "project-1", villageId: MIBU_ID, datasetId: "dataset-new",
    village: { publishedDataset: { layer_manifest: { worker_manifest: { files: {} } } } }
  });
  assert.equal(context.villageId, MIBU_ID);
  assert.equal(context.datasetId, null);
});

test("drawing uses the current village's planning personal space even when figure-ground space RPC is unavailable", async () => {
  const calls = [];
  await enterPersonalGeoprocessingSpace({
    personalSpace: null,
    spaces: [
      { id: "shared-1", spaceType: "practice_shared", villageId: "mibu-uuid", teachingProjectId: "project-1" },
      { id: "other-personal", spaceType: "practice_personal", villageId: "other-village", teachingProjectId: "project-1" },
      { id: "personal-1", spaceType: "practice_personal", villageId: "mibu-uuid", teachingProjectId: "project-1" }
    ],
    villageId: "mibu-uuid",
    teachingProjectId: "project-1",
    getCurrentSpaceId: () => "shared-1",
    selectSpace: async (id) => { calls.push(`select:${id}`); }
  });
  assert.deepEqual(calls, ["select:personal-1"]);
});

test("drawing in an already selected planning personal space does not reselect it", async () => {
  const calls = [];
  await enterPersonalGeoprocessingSpace({
    personalSpace: null,
    spaces: [{ id: "personal-1", spaceType: "practice_personal", villageId: "mibu-uuid", teachingProjectId: "project-1" }],
    villageId: "mibu-uuid", teachingProjectId: "project-1",
    getCurrentSpaceId: () => "personal-1", selectSpace: async (id) => calls.push(id)
  });
  assert.deepEqual(calls, []);
});

test("legacy figure-ground personal space remains usable when no planning personal space exists", async () => {
  const selected = [];
  await enterPersonalGeoprocessingSpace({
    personalSpace: { id: "legacy-personal" }, spaces: [], villageId: "mibu-uuid", teachingProjectId: "project-1",
    getSpaceById: (id) => id === "legacy-personal" ? { id } : null,
    getCurrentSpaceId: () => "shared-1", selectSpace: async (id) => selected.push(id)
  });
  assert.deepEqual(selected, ["legacy-personal"]);
});

test("drawing cannot continue in shared space when this village has no personal planning space", async () => {
  await assert.rejects(() => enterPersonalGeoprocessingSpace({
    personalSpace: null, spaces: [{ id: "other-personal", spaceType: "practice_personal", villageId: "other-village", teachingProjectId: "project-1" }],
    villageId: "mibu-uuid", teachingProjectId: "project-1", getCurrentSpaceId: () => "shared-1",
    selectSpace: async () => {}
  }), /PERSONAL_SPACE_UNAVAILABLE/);
});
