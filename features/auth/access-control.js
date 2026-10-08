(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AccessControlModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isAdminUser(user) {
    return normalize(user?.role) === "admin";
  }

  function isTeacherUser(user) {
    return normalize(user?.role) === "teacher";
  }

  function isStaffUser(user) {
    return isAdminUser(user) || isTeacherUser(user);
  }

  // 兼容旧调用：凭据只能验证身份，不能在浏览器内授予管理员角色。
  function isAdminCredential() {
    return false;
  }

  return { isAdminCredential, isAdminUser, isTeacherUser, isStaffUser };
});
