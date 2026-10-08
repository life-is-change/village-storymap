const test = require("node:test");
const assert = require("node:assert/strict");

const { resolve3DEditPolicy } = require("./3d-edit-policy.js");

test("管理员可编辑全班共享空间且始终使用真实空间 ID", () => {
  const policy = resolve3DEditPolicy({
    space: { id: "current", actualSpaceId: "formal-shared-uuid", type: "formal_shared" },
    isAdmin: true,
    canManage: true
  });
  assert.equal(policy.canEditModel, true);
  assert.equal(policy.actualSpaceId, "formal-shared-uuid");
});

test("学生只能在小组方案空间编辑 3D", () => {
  assert.equal(resolve3DEditPolicy({
    space: { id: "formal-shared", type: "formal_shared" },
    isAdmin: false,
    canManage: true
  }).canEditModel, false);
  assert.equal(resolve3DEditPolicy({
    space: { id: "group-1", type: "group_plan" },
    isAdmin: false,
    canManage: true
  }).canEditModel, true);
});

test("只读或无管理权限的空间不能编辑 3D", () => {
  assert.equal(resolve3DEditPolicy({
    space: { id: "group-1", type: "group_plan", readonly: true },
    isAdmin: true,
    canManage: true
  }).canEditModel, false);
  assert.equal(resolve3DEditPolicy({
    space: { id: "group-1", type: "group_plan" },
    isAdmin: false,
    canManage: false
  }).canEditModel, false);
  assert.equal(resolve3DEditPolicy({
    space: { id: "formal-shared", type: "formal_shared" },
    isAdmin: true,
    canManage: false
  }).canEditModel, false);
});
