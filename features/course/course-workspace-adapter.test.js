const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGroupPlanningSpace,
  canActorAccessGroupSpace,
  buildAccountStorageKey,
  buildPersonalPlanningSpace,
  filterRemotePlanningSpaces,
  mergeWorkspaceSpaces
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

test("browser workspace state is isolated by authenticated account id", () => {
  assert.equal(
    buildAccountStorageKey("village_planning_spaces_v3", { authUserId: "user-a", studentId: "001" }),
    "village_planning_spaces_v3:user-a"
  );
  assert.notEqual(
    buildAccountStorageKey("village_planning_spaces_v3", { authUserId: "user-a" }),
    buildAccountStorageKey("village_planning_spaces_v3", { authUserId: "user-b" })
  );
});

test("personal workspace restores all selected imported layers including contours", () => {
  const space = buildPersonalPlanningSpace({
    personalSpace: { id: "personal-1", title: "个人图底空间", created_at: "2026-07-23" },
    user: { name: "李同学" },
    existingSpace: { contourLabelsVisible: true, selectedLayers: ["building"] },
    selections: [
      { layer_key: "building" },
      { layer_key: "road" },
      { layer_key: "water" },
      { layer_key: "contours" }
    ],
    courseId: "course-1",
    villageId: "mibu"
  });
  assert.deepEqual(space.selectedLayers, ["building", "road", "water", "contours"]);
  assert.equal(space.contourLabelsVisible, true);
  assert.equal(space.spaceType, "course_personal");
});

test("new personal workspace shows contour values by default", () => {
  const space = buildPersonalPlanningSpace({
    personalSpace: { id: "personal-2" },
    selections: [{ layer_key: "contours" }],
    courseId: "course-1",
    villageId: "mibu"
  });
  assert.equal(space.contourLabelsVisible, true);
});

test("students never receive unrelated remote planning spaces", () => {
  const remote = [
    { id: "legacy-other", creatorName: "别人", spaceType: "" },
    { id: "group-other", courseGroupId: "g-other", spaceType: "course_group" },
    { id: "group-mine", courseGroupId: "g-mine", spaceType: "course_group" }
  ];
  assert.deepEqual(filterRemotePlanningSpaces(remote, {
    actorName: "学生甲",
    isAdmin: false,
    activeGroupId: "g-mine"
  }).map((space) => space.id), ["group-mine"]);
  assert.deepEqual(filterRemotePlanningSpaces(remote, {
    actorName: "新同学",
    isAdmin: false,
    activeGroupId: ""
  }), []);
});

test("successful empty remote sync clears legacy cache but preserves personal space", () => {
  const base = { id: "current", title: "现状空间" };
  const personal = { id: "personal-1", spaceType: "course_personal" };
  const stale = { id: "old-space", creatorName: "别人", spaceType: "" };
  assert.deepEqual(mergeWorkspaceSpaces({
    localSpaces: [base, personal, stale],
    remoteSpaces: [],
    baseSpaceId: "current",
    isAdmin: false,
    actorName: "学生甲",
    activeGroupId: ""
  }), [base, personal]);
});
