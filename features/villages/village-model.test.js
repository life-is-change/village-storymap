const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SPACE_TYPES,
  VILLAGE_STATUSES,
  normalizeVillage,
  normalizeTeachingProject,
  buildProjectEntries,
  filterSpacesForContext,
  buildContextKey,
  canBindFormalVillage,
  buildHomepageProjectVillages,
  resolveHomepageCommand
} = require("./village-model.js");

test("米埗村练习条目不暴露小组空间", () => {
  const entries = buildProjectEntries({
    project: {
      id: "p1",
      practiceVillageId: "mibu",
      formalVillageId: "v2",
      formalProjectOpen: true
    },
    villages: [
      { id: "mibu", name: "米埗村", isPractice: true, status: "published" },
      { id: "v2", name: "正式村庄", isPractice: false, status: "published" }
    ]
  });

  assert.deepEqual(entries.map((item) => item.role), ["formal", "practice"]);

  const visible = filterSpacesForContext({
    spaces: [
      {
        id: "a",
        teachingProjectId: "p1",
        villageId: "mibu",
        spaceType: SPACE_TYPES.PRACTICE_PERSONAL,
        ownerId: "u1"
      },
      {
        id: "b",
        teachingProjectId: "p1",
        villageId: "mibu",
        spaceType: SPACE_TYPES.PRACTICE_SHARED
      },
      {
        id: "c",
        teachingProjectId: "p1",
        villageId: "mibu",
        spaceType: SPACE_TYPES.GROUP_PLAN,
        groupId: "g1"
      }
    ],
    context: { teachingProjectId: "p1", villageId: "mibu", villageRole: "practice" },
    actor: { userId: "u1", groupId: "g1", isStaff: false }
  });

  assert.deepEqual(visible.map((space) => space.id), ["a", "b"]);
});

test("正式村庄只显示本人的个人空间、共享现状和本组方案", () => {
  const visible = filterSpacesForContext({
    spaces: [
      { id: "mine", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_PERSONAL, ownerId: "u1" },
      { id: "other", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_PERSONAL, ownerId: "u2" },
      { id: "shared", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_SHARED },
      { id: "my-group", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.GROUP_PLAN, groupId: "g1" },
      { id: "other-group", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.GROUP_PLAN, groupId: "g2" },
      { id: "other-project", teachingProjectId: "p2", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_SHARED }
    ],
    context: { teachingProjectId: "p1", villageId: "v1", villageRole: "formal" },
    actor: { userId: "u1", groupId: "g1", isStaff: false }
  });

  assert.deepEqual(visible.map((space) => space.id), ["mine", "shared", "my-group"]);
});

test("工作人员普通工作区不暴露其他人的个人空间和全部小组方案", () => {
  const visible = filterSpacesForContext({
    spaces: [
      { id: "mine", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_PERSONAL, ownerId: "staff" },
      { id: "personal", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_PERSONAL, ownerId: "u2" },
      { id: "shared", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_SHARED },
      { id: "group", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.GROUP_PLAN, groupId: "g2" },
      { id: "other-project", teachingProjectId: "p2", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_SHARED }
    ],
    context: { teachingProjectId: "p1", villageId: "v1", villageRole: "formal" },
    actor: { userId: "staff", isStaff: true }
  });

  assert.deepEqual(visible.map((space) => space.id), ["mine", "shared"]);
});

test("工作人员只有明确属于当前小组时才在普通工作区看到本组方案", () => {
  const visible = filterSpacesForContext({
    spaces: [
      { id: "shared", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.FORMAL_SHARED },
      { id: "my-group", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.GROUP_PLAN, groupId: "g1" },
      { id: "other-group", teachingProjectId: "p1", villageId: "v1", spaceType: SPACE_TYPES.GROUP_PLAN, groupId: "g2" }
    ],
    context: { teachingProjectId: "p1", villageId: "v1", villageRole: "formal" },
    actor: { userId: "staff", groupId: "g1", isStaff: true }
  });

  assert.deepEqual(visible.map((space) => space.id), ["shared", "my-group"]);
});

test("未开放正式项目时只生成练习条目", () => {
  const entries = buildProjectEntries({
    project: {
      id: "p1",
      practiceVillageId: "mibu",
      formalVillageId: "v2",
      formalProjectOpen: false
    },
    villages: [
      { id: "mibu", name: " 米埗村 ", isPractice: true, status: "published" },
      { id: "v2", name: "正式村庄", isPractice: false, status: "published" }
    ]
  });

  assert.deepEqual(entries.map((item) => [item.villageId, item.role]), [["mibu", "practice"]]);
});

test("村庄和教学项目输入会规范为稳定领域对象", () => {
  assert.deepEqual(normalizeVillage({
    id: " v1 ", name: " 新村 ", is_practice: false, default_crs: " EPSG:4490 ", status: "published"
  }), {
    id: "v1",
    name: "新村",
    isPractice: false,
    defaultCrs: "EPSG:4490",
    status: VILLAGE_STATUSES.PUBLISHED,
    boundary: null
  });

  assert.deepEqual(normalizeTeachingProject({
    id: " p1 ", course_id: " c1 ", practice_village_id: " mibu ", formal_village_id: " v1 ", formal_project_open: true
  }), {
    id: "p1",
    name: "",
    courseId: "c1",
    practiceVillageId: "mibu",
    formalVillageId: "v1",
    formalProjectOpen: true,
    status: "active",
    stage: "preparing"
  });
});

test("上下文键包含教学项目、村庄和空间", () => {
  assert.equal(buildContextKey({ teachingProjectId: " p1 ", villageId: " v1 ", spaceId: " s1 " }), "p1::v1::s1");
  assert.equal(buildContextKey({ teachingProjectId: "p1", villageId: "v1" }), "p1::v1::");
});

test("已有学生数据时不能替换正式村庄", () => {
  assert.deepEqual(canBindFormalVillage({
    project: { formalVillageId: "v1", formalProjectOpen: true },
    village: { id: "v2", status: "published" },
    hasStudentData: true
  }), { ok: false, code: "FORMAL_VILLAGE_LOCKED" });
});

test("正式村庄必须发布后才能绑定", () => {
  assert.deepEqual(canBindFormalVillage({
    project: { formalVillageId: null, formalProjectOpen: false },
    village: { id: "v2", isPractice: false, status: "data_ready" },
    hasStudentData: false
  }), { ok: false, code: "PUBLISHED_DATASET_REQUIRED" });

  assert.deepEqual(canBindFormalVillage({
    project: { formalVillageId: null, formalProjectOpen: false },
    village: { id: "v2", isPractice: false, status: "published" },
    hasStudentData: false
  }), { ok: true, code: "FORMAL_VILLAGE_BINDABLE" });
});

test("首页只公开当前教学项目中已发布的练习村庄和正式村庄", () => {
  const villages = buildHomepageProjectVillages({
    project: {
      id: "project-1",
      practiceVillageId: "practice-1",
      formalVillageId: "formal-1",
      formalProjectOpen: true
    },
    villages: [
      {
        id: "practice-1", name: "米埗村", isPractice: true, status: "published",
        boundary: { type: "Polygon", coordinates: [[[113, 23], [114, 23], [114, 24], [113, 24], [113, 23]]] }
      },
      {
        id: "formal-1", name: "南溪村", status: "published",
        boundary: { type: "Polygon", coordinates: [[[110, 20], [112, 20], [112, 22], [110, 22], [110, 20]]] }
      },
      { id: "draft-1", name: "草稿村", status: "draft" }
    ]
  });

  assert.deepEqual(villages.map((village) => village.id), ["practice-1", "formal-1"]);
  assert.deepEqual([villages[1].longitude, villages[1].latitude], [111, 21]);
  assert.equal(villages[1].role, "formal");
});

test("首页命令只允许管理员进入后台并拒绝进入项目外村庄", () => {
  assert.deepEqual(resolveHomepageCommand(
    { type: "village-open-admin" },
    { isAdmin: true, allowedVillageIds: ["practice-1"] }
  ), { type: "open_admin" });
  assert.equal(resolveHomepageCommand(
    { type: "village-open-admin" },
    { isAdmin: false, allowedVillageIds: ["practice-1"] }
  ), null);
  assert.deepEqual(resolveHomepageCommand(
    { type: "village-home-enter", payload: { villageId: "practice-1" } },
    { isAdmin: false, allowedVillageIds: ["practice-1"] }
  ), { type: "enter_village", villageId: "practice-1" });
  assert.equal(resolveHomepageCommand(
    { type: "village-home-enter", payload: { villageId: "other-project-village" } },
    { isAdmin: true, allowedVillageIds: ["practice-1"] }
  ), null);
});
