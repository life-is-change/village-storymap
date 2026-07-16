const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_COURSE } = require("../course/course-model.js");
const {
  renderDashboard,
  renderTaskNavigation,
  getTaskActionState
} = require("./course-workbench.js");

const student = { name: "张三", student_id: "2026001" };

test("task drawer renders only the active stage guidance without a standalone platform card", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: { id: "g1", name: "第1小组" }, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[1],
    activeTaskId: "survey-collect"
  });

  assert.match(html, /整理调研照片与备注/);
  assert.match(html, /调研照片/);
  assert.doesNotMatch(html, /平台入口|进入原有 2D|进入原有 3D/);
  assert.doesNotMatch(html, /最近操作|个人记录/);
});

test("join-group stage shows the join form inside the task drawer", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: "join-group"
  });

  assert.match(html, /data-group-join-form/);
  assert.match(html, /输入老师提供的组码/);
});

test("student without a group can inspect and complete later tasks without map entry buttons", () => {
  const task = DEFAULT_COURSE.tasks.find((item) => item.id === "diagnosis-list");
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: task.id
  });

  assert.match(html, new RegExp(task.title));
  assert.match(html, new RegExp(task.description));
  assert.match(html, /data-complete-task="diagnosis-list"/);
  assert.doesNotMatch(html, /data-workspace-view/);
  assert.doesNotMatch(html, /加入你的线下小组/);
  assert.doesNotMatch(html, /data-group-join-form/);
});

test("design task exposes 2D and 3D as views of one group workspace", () => {
  const state = getTaskActionState({
    task: DEFAULT_COURSE.tasks.find((task) => task.id === "design-workspace"),
    context: { group: { id: "g1", spaceId: "group-space-g1" } }
  });

  assert.equal(state.type, "workspace");
  assert.deepEqual(state.viewModes, ["2d", "3d"]);
  assert.equal(state.spaceId, "group-space-g1");
});

test("task navigation is an icon rail with accessible stage names", () => {
  const html = renderTaskNavigation({
    course: DEFAULT_COURSE,
    completedTaskIds: ["join-group", "learning-ready"],
    activeTaskId: "survey-collect"
  });

  assert.match(html, /course-task-rail-item is-complete/);
  assert.match(html, /course-task-rail-item is-active/);
  assert.match(html, /aria-label="3\. 调研采集，进行中"/);
  assert.match(html, /course-task-rail-icon/);
  assert.doesNotMatch(html, /course-task-nav-copy/);
});
