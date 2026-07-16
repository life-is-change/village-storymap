(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AccessControlModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const ADMIN_NAME = "管理员";
  const ADMIN_CREDENTIAL = "332";

  function normalize(value) {
    return String(value || "").trim();
  }

  function isAdminCredential(name, credential) {
    return normalize(name) === ADMIN_NAME && normalize(credential) === ADMIN_CREDENTIAL;
  }

  function isAdminUser(user) {
    return isAdminCredential(user?.name, user?.studentId ?? user?.student_id);
  }

  return { ADMIN_NAME, ADMIN_CREDENTIAL, isAdminCredential, isAdminUser };
});
