const test = require("node:test");
const assert = require("node:assert/strict");

const {
  filterActivityEvents,
  exportEventsCsv,
  summarizeGroups
} = require("./course-admin.js");

const events = [
  { student_name: "张三", group_id: "g1", action: "photo_uploaded", occurred_at: "2026-07-15T08:00:00Z" },
  { student_name: "李四", group_id: "g2", action: "task_completed", occurred_at: "2026-07-15T09:00:00Z" }
];

test("filters activity events by group, student and action", () => {
  assert.equal(filterActivityEvents(events, { groupId: "g1" }).length, 1);
  assert.equal(filterActivityEvents(events, { student: "李" }).length, 1);
  assert.equal(filterActivityEvents(events, { action: "task_completed" }).length, 1);
});

test("filters activity events by task and inclusive date range", () => {
  const dated = events.map((event, index) => ({ ...event, task_id: index ? "design-workspace" : "survey-collect" }));
  assert.equal(filterActivityEvents(dated, { taskId: "design-workspace" }).length, 1);
  assert.equal(filterActivityEvents(dated, { dateFrom: "2026-07-15", dateTo: "2026-07-15" }).length, 2);
  assert.equal(filterActivityEvents(dated, { dateFrom: "2026-07-16" }).length, 0);
});

test("exports a spreadsheet-friendly csv with a process audit header", () => {
  const csv = exportEventsCsv(events);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /操作时间,学生,小组,任务,操作类型/);
  assert.match(csv, /photo_uploaded/);
});

test("summarizes group membership and completion", () => {
  const summary = summarizeGroups(
    [{ id: "g1", name: "第一组" }],
    [{ group_id: "g1", student_key: "s1" }, { group_id: "g1", student_key: "s2" }],
    [{ group_id: "g1", student_key: "s1", completed: true }]
  );
  assert.deepEqual(summary[0], {
    id: "g1",
    name: "第一组",
    memberCount: 2,
    completedCount: 1
  });
});
