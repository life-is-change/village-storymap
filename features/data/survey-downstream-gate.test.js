const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
require("./data-service.js");
const service = global.window.DataServiceModule;
const communityTasks = require("../../community-tasks.js");

function context(spaceType = "formal_shared") {
  return {
    teachingProjectId: "p1",
    villageId: "v1",
    spaceId: "s1",
    spaceType
  };
}

test("blocks attributes and photo storage before a survey geometry is reviewed", async () => {
  const calls = [];
  const deps = {
    OBJECT_EDITS_TABLE: "object_attribute_edits",
    OBJECT_PHOTOS_TABLE: "object_photos",
    PHOTO_BUCKET: "photos",
    normalizeCode: (value) => String(value),
    getContext: () => context(),
    getSurveyReview: async () => ({ geometry_status: "pending" }),
    canUseSurveyDownstreamActions: () => false,
    getSupabaseClient: () => ({
      from() { calls.push("table"); },
      storage: { from() { calls.push("storage"); } }
    })
  };

  await assert.rejects(
    () => service.saveObjectEdits(deps, "B1", "building__s1", {}, "building"),
    /GEOMETRY_REVIEW_REQUIRED/
  );
  await assert.rejects(
    () => service.uploadObjectPhoto(deps, { name: "one.jpg" }, "B1", "building__s1", "学生甲", "building"),
    /GEOMETRY_REVIEW_REQUIRED/
  );
  assert.deepEqual(calls, []);
});

test("reviewed survey writes carry the normalized layer key", async () => {
  const payloads = [];
  const query = { upsert: async (payload) => (payloads.push(payload), { error: null }) };
  const deps = {
    OBJECT_EDITS_TABLE: "object_attribute_edits",
    getContext: () => context(),
    getSurveyReview: async () => ({ geometry_status: "confirmed_unchanged" }),
    canUseSurveyDownstreamActions: () => true,
    getSupabaseClient: () => ({ from: () => query })
  };

  await service.saveObjectEdits(deps, "R1", "road__s1", { width: 4 }, "road");
  assert.equal(payloads[0].survey_layer_key, "road");
});

test("removes a newly uploaded file when its database association fails", async () => {
  const removed = [];
  const bucket = {
    upload: async () => ({ error: null }),
    getPublicUrl: () => ({ data: { publicUrl: "https://example.test/photo.jpg" } }),
    remove: async (paths) => (removed.push(...paths), { error: null })
  };
  const deps = {
    OBJECT_PHOTOS_TABLE: "object_photos",
    PHOTO_BUCKET: "photos",
    normalizeCode: (value) => String(value),
    getContext: () => context(),
    getSurveyReview: async () => ({ geometry_status: "modified" }),
    canUseSurveyDownstreamActions: () => true,
    getSupabaseClient: () => ({
      storage: { from: () => bucket },
      from: () => ({ insert: async () => ({ error: new Error("insert failed") }) })
    })
  };

  await assert.rejects(
    () => service.uploadObjectPhoto(deps, { name: "one.jpg" }, "B1", "building__s1", "学生甲", "building"),
    /insert failed/
  );
  assert.equal(removed.length, 1);
});

test("object issues are gated and store an explicit survey target", async () => {
  const calls = [];
  const deps = {
    COMMUNITY_TASKS_TABLE: "community_tasks",
    getContext: () => context(),
    getCommunityGameTablesReady: () => true,
    assertSurveyDownstreamReady: async (target) => calls.push(["gate", target]),
    getSupabaseClient: () => ({
      from: () => ({
        insert(payload) {
          calls.push(["insert", payload]);
          return { select: () => ({ single: async () => ({ data: { id: 8 }, error: null }) }) };
        }
      })
    }),
    invalidateCommunityTaskCache() {},
    isCommunityGameTableMissingError: () => false
  };

  await communityTasks.createCommunityTask(deps, {
    spaceId: "s1", reporterName: "学生甲", description: "建筑入口有误",
    targetLayerKey: "building", targetObjectCode: "B1"
  });
  assert.deepEqual(calls[0], ["gate", { objectCode: "B1", layerKey: "building" }]);
  assert.equal(calls[1][1].target_layer_key, "building");
  assert.equal(calls[1][1].target_object_code, "B1");
});

test("the workspace injects the active layer into every object downstream write", () => {
  const root = path.resolve(__dirname, "../..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /features\/survey\/survey-review-model\.js/);
  assert.match(html, /features\/survey\/survey-review-client\.js/);
  assert.match(app, /function assertSurveyDownstreamReady/);
  assert.match(app, /saveObjectEdits\(context\.sourceCode,\s*context\.editObjectType,\s*payload,\s*context\.layerKey\)/);
  assert.match(app, /uploadObjectPhoto\(file,\s*context\.sourceCode,\s*context\.photoObjectType,\s*uploader,\s*context\.layerKey\)/);
  assert.match(app, /ObjectCommentsModule\.create\([\s\S]*?layerKey:\s*context\.layerKey/);
  assert.match(app, /请先完成几何校核/);
  assert.match(app, /surveyDownstreamReady/);
});
