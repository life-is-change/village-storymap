const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeStudentId,
  buildSyntheticEmail,
  validatePassword,
  profileToLegacyUser
} = require("./supabase-auth-model.js");

test("student ids are normalized and converted to a hidden deterministic email", () => {
  assert.equal(normalizeStudentId(" 2026001 "), "2026001");
  assert.equal(normalizeStudentId(" AbC_01 "), "abc_01");
  assert.equal(buildSyntheticEmail(" AbC_01 "), "sid-abc_01@rzmbmwauomzwiyenafha.supabase.co");
  assert.throws(() => normalizeStudentId("张三"), /学号/);
});

test("password validation rejects short or blank passwords", () => {
  assert.deepEqual(validatePassword("1234567"), { valid: false, message: "密码至少需要 8 位" });
  assert.deepEqual(validatePassword("12345678"), { valid: true, message: "" });
});

test("Supabase profile is mapped to the legacy user shape used by the platform", () => {
  const user = profileToLegacyUser(
    { id: "auth-uuid" },
    {
      id: "auth-uuid",
      student_id: "2026001",
      display_name: "张三",
      role: "teacher",
      class_name: "规划一班",
      grade: "2026",
      gender: "男"
    }
  );

  assert.deepEqual(user, {
    id: "auth-uuid",
    authUserId: "auth-uuid",
    name: "张三",
    studentId: "2026001",
    student_id: "2026001",
    role: "teacher",
    className: "规划一班",
    grade: "2026",
    gender: "男"
  });
});
