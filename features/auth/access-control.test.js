const test = require("node:test");
const assert = require("node:assert/strict");

const { isAdminUser, isAdminCredential } = require("./access-control.js");

test("only exact 管理员 and 332 credential pair has administrator access", () => {
  assert.equal(isAdminUser({ name: "管理员", studentId: "332" }), true);
  assert.equal(isAdminUser({ name: "管理员", student_id: "332" }), true);
  assert.equal(isAdminUser({ name: "管理员", studentId: "2026001" }), false);
  assert.equal(isAdminUser({ name: "张三", studentId: "332" }), false);
  assert.equal(isAdminUser({ name: "管理员" }), false);
});

test("credential input is trimmed but not loosely matched", () => {
  assert.equal(isAdminCredential(" 管理员 ", " 332 "), true);
  assert.equal(isAdminCredential("管理员1", "332"), false);
  assert.equal(isAdminCredential("管理员", "0332"), false);
});
