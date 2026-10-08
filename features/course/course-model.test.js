const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_COURSE,
  normalizeCourseState,
  getOrderedStages,
  getNextTask,
  buildStudentKey,
  canJoinGroup
} = require("./course-model.js");

test("default course includes individual figure-ground production before survey", () => {
  assert.deepEqual(DEFAULT_COURSE.stages.map((stage) => stage.key), [
    "group_join",
    "learning",
    "figure_ground",
    "survey",
    "diagnosis",
    "design",
    "submission"
  ]);
  assert.deepEqual(DEFAULT_COURSE.stages.map((stage) => stage.kind), [
    "preparation",
    "preparation",
    "practice",
    "practice",
    "practice",
    "practice",
    "practice"
  ]);
  const ids = DEFAULT_COURSE.tasks.map((task) => task.id);
  assert.ok(ids.indexOf("figure-ground-compose") < ids.indexOf("survey-collect"));
});

test("ordered stages return a copy instead of mutating the course", () => {
  const ordered = getOrderedStages(DEFAULT_COURSE);
  ordered.shift();
  assert.equal(DEFAULT_COURSE.stages.length, 7);
});

test("next task is the first incomplete ordered task", () => {
  const state = normalizeCourseState({
    completedTaskIds: ["join-group", "learning-ready", "join-group"]
  });
  assert.deepEqual(state.completedTaskIds, ["join-group", "learning-ready"]);
  assert.equal(getNextTask(DEFAULT_COURSE, state).id, "figure-ground-compose");
});

test("next task is null when every task is complete", () => {
  const completedTaskIds = DEFAULT_COURSE.tasks.map((task) => task.id);
  assert.equal(getNextTask(DEFAULT_COURSE, { completedTaskIds }), null);
});

test("student key keeps student id and name attributable", () => {
  assert.equal(
    buildStudentKey({ student_id: " 2026001 ", name: " 张三 " }),
    "2026001::张三"
  );
});

test("group join is allowed only without an existing membership and before locking", () => {
  assert.equal(canJoinGroup({ id: "g1", locked: false }, null), true);
  assert.equal(canJoinGroup({ id: "g1", locked: true }, null), false);
  assert.equal(canJoinGroup({ id: "g1", locked: false }, { groupId: "g2" }), false);
});
