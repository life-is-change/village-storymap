const test = require("node:test");
const assert = require("node:assert/strict");

const { isAdminUser, isTeacherUser, isStaffUser } = require("./access-control.js");

test("administrator access comes only from the trusted profile role", () => {
  assert.equal(isAdminUser({ name: "管理员", studentId: "332", role: "admin" }), true);
  assert.equal(isAdminUser({ name: "管理员", studentId: "332", role: "student" }), false);
  assert.equal(isAdminUser({ name: "管理员", studentId: "332" }), false);
  assert.equal(isAdminUser({ name: "张三", studentId: "2026001", role: "admin" }), true);
});

test("teacher and staff checks use normalized database roles", () => {
  assert.equal(isTeacherUser({ role: "teacher" }), true);
  assert.equal(isTeacherUser({ role: " TEACHER " }), true);
  assert.equal(isStaffUser({ role: "teacher" }), true);
  assert.equal(isStaffUser({ role: "admin" }), true);
  assert.equal(isStaffUser({ role: "student" }), false);
});
