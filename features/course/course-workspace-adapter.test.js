const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGroupPlanningSpace,
  canActorAccessGroupSpace,
  buildAccountStorageKey,
  buildPersonalPlanningSpace,
  filterRemotePlanningSpaces,
  mergeWorkspaceSpaces,
  normalizeGroupSpaceType
} = require("./course-workspace-adapter.js");

test("group workspace keeps course ownership while reusing map defaults", () => {
  const space = buildGroupPlanningSpace(
    {
      id: "group-1",
      name: "第1小组",
      courseId: "mibu-village-planning",
      spaceId: "group-space-1",
      baseSnapshotId: "snapshot-v1"
    },
    "张三",
    { selectedLayers: ["building", "road", "water"], basemapVisible: true }
  );

  assert.equal(space.id, "group-space-1");
  assert.equal(space.title, "第1小组 · 规划空间");
  assert.equal(space.courseGroupId, "group-1");
  assert.equal(space.baseSnapshotId, "snapshot-v1");
  assert.equal(space.spaceType, "group_plan");
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
    villageId: "mibu",
    spaceType: "practice_personal"
  });
  assert.deepEqual(space.selectedLayers, ["building", "road", "water", "contours"]);
  assert.equal(space.contourLabelsVisible, true);
  assert.equal(space.spaceType, "practice_personal");
});

test("personal workspace requires an explicit dual-track space type", () => {
  assert.throws(() => buildPersonalPlanningSpace({
    personalSpace: { id: "personal-3" }, courseId: "course-1", villageId: "mibu"
  }), /PERSONAL_SPACE_TYPE_REQUIRED/);
});

test("group workspace is forbidden for the practice village", () => {
  assert.throws(() => buildGroupPlanningSpace(
    { id: "g1", name: "组", courseId: "c1", spaceId: "s1" }, "学生", {},
    { villageRole: "practice", villageId: "mibu", teachingProjectId: "p1" }
  ), /PRACTICE_GROUP_SPACE_FORBIDDEN/);
});

test("group workspace requires a frozen baseline", () => {
  assert.throws(() => buildGroupPlanningSpace(
    { id: "g1", name: "组", courseId: "c1", spaceId: "s1" }, "学生", {},
    { villageRole: "formal", villageId: "v1", teachingProjectId: "p1" }
  ), /GROUP_BASELINE_REQUIRED/);
});

test("legacy course group space type normalizes to group plan", () => {
  assert.equal(normalizeGroupSpaceType("course_group"), "group_plan");
  assert.equal(normalizeGroupSpaceType("group_plan"), "group_plan");
});

test("new personal workspace shows contour values by default", () => {
  const space = buildPersonalPlanningSpace({
    personalSpace: { id: "personal-2" },
    selections: [{ layer_key: "contours" }],
    courseId: "course-1",
    villageId: "mibu",
    spaceType: "practice_personal"
  });
  assert.equal(space.contourLabelsVisible, true);
});

test("students never receive unrelated remote planning spaces", () => {
  const remote = [
    { id: "legacy-other", creatorName: "别人", spaceType: "" },
    { id: "group-other", courseGroupId: "g-other", spaceType: "group_plan" },
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

test("daily workspace sync never exposes migration archives even to staff", () => {
  const remote = [
    { id: "shared", spaceType: "practice_shared" },
    { id: "owned-copy", spaceType: "legacy_personal", creatorName: "管理员" },
    { id: "unscoped", spaceType: "legacy_unscoped" },
    { id: "old-system", spaceType: "", creatorName: "系统" }
  ];
  assert.deepEqual(filterRemotePlanningSpaces(remote, {
    actorName: "管理员", isStaff: true, activeGroupId: ""
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
