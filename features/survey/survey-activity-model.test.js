const test = require("node:test");
const assert = require("node:assert/strict");

const activity = require("./survey-activity-model.js");

test("按图层与对象编号聚合几何、属性、照片、讨论和未解决问题", () => {
  const result = activity.buildActivityFlags({
    reviews: [{ layer_key: "buildings", object_code: "B-1", geometry_status: "modified" }],
    edits: [{ survey_layer_key: "buildings", object_code: "B-1" }],
    photos: [{ survey_layer_key: "buildings", object_code: "B-1" }],
    comments: [{ survey_layer_key: "buildings", object_code: "B-1" }],
    tasks: [{ target_layer_key: "buildings", target_object_code: "B-1", status: "open" }]
  });
  assert.deepEqual(result.get("buildings:B-1"), {
    geometryChanged: true,
    attributeEdited: true,
    hasPhoto: true,
    hasDiscussion: true,
    unresolvedIssue: true
  });
});

test("徽标最多展示三个并将剩余数量收进 +N", () => {
  const badges = activity.getVisibleBadges({
    geometryChanged: true,
    attributeEdited: true,
    hasPhoto: true,
    hasDiscussion: true,
    unresolvedIssue: true
  }, { max: 3 });
  assert.deepEqual(badges.map((item) => item.key), ["issue", "geometry", "photo", "more"]);
  assert.equal(badges.at(-1).label, "+2");
});

test("远景只保留未解决问题，筛选不会改变活动事实", () => {
  const flags = { hasPhoto: true, hasDiscussion: true, unresolvedIssue: true };
  assert.deepEqual(activity.getVisibleBadges(flags, { farZoom: true }).map((item) => item.key), ["issue"]);
  assert.equal(activity.matchesActivityFilter(flags, "photo"), true);
  assert.equal(activity.matchesActivityFilter(flags, "geometry"), false);
});

test("旧记录缺少校核图层时从对象类型恢复活动徽标", () => {
  const result = activity.buildActivityFlags({
    edits: [{ survey_layer_key: null, object_type: "building", object_code: "AUTO_BUILDING_000007" }],
    photos: [{ object_type: "building__shared-space", object_code: "AUTO_BUILDING_000007" }],
    comments: [{ object_type: "road", object_code: "R-2" }]
  });

  assert.equal(result.get("building:AUTO_BUILDING_000007")?.attributeEdited, true);
  assert.equal(result.get("building:AUTO_BUILDING_000007")?.hasPhoto, true);
  assert.equal(result.get("road:R-2")?.hasDiscussion, true);
});
