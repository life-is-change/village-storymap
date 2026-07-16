const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGroupPlanningSpace,
  canActorAccessGroupSpace
} = require("./course-workspace-adapter.js");

test("group workspace keeps course ownership while reusing map defaults", () => {
  const space = buildGroupPlanningSpace(
    {
      id: "group-1",
      name: "第1小组",
      courseId: "mibu-village-planning",
      spaceId: "group-space-1"
    },
    "张三",
    { selectedLayers: ["building", "road", "water"], basemapVisible: true }
  );

  assert.equal(space.id, "group-space-1");
  assert.equal(space.title, "第1小组 · 规划空间");
  assert.equal(space.courseGroupId, "group-1");
  assert.deepEqual(space.selectedLayers, ["building", "road", "water"]);
  assert.equal(space.basemapVisible, true);
});

test("group workspace access requires matching membership unless actor is admin", () => {
  const space = { courseGroupId: "group-1" };
  assert.equal(canActorAccessGroupSpace(space, { group: { id: "group-1" } }, false), true);
  assert.equal(canActorAccessGroupSpace(space, { group: { id: "group-2" } }, false), false);
  assert.equal(canActorAccessGroupSpace(space, null, true), true);
});
