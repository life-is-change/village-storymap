(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SupabaseAuthModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STUDENT_ID_PATTERN = /^[a-z0-9_-]{2,32}$/;
  const ALLOWED_ROLES = new Set(["student", "teacher", "admin"]);

  function normalizeStudentId(value) {
    const studentId = String(value || "").trim().toLowerCase();
    if (!studentId) throw new Error("请输入学号");
    if (!STUDENT_ID_PATTERN.test(studentId)) {
      throw new Error("学号仅支持 2–32 位字母、数字、下划线或连字符");
    }
    return studentId;
  }

  function normalizeDisplayName(value) {
    const name = String(value || "").trim();
    if (!name) throw new Error("请输入姓名");
    if (name.length > 20) throw new Error("姓名不能超过 20 个字符");
    return name;
  }

  function buildSyntheticEmail(studentId) {
    return `sid-${normalizeStudentId(studentId)}@rzmbmwauomzwiyenafha.supabase.co`;
  }

  function validatePassword(value) {
    const password = String(value || "");
    if (password.length < 8) return { valid: false, message: "密码至少需要 8 位" };
    if (password.length > 72) return { valid: false, message: "密码不能超过 72 位" };
    return { valid: true, message: "" };
  }

  function normalizeRole(value) {
    const role = String(value || "student").trim().toLowerCase();
    return ALLOWED_ROLES.has(role) ? role : "student";
  }

  function profileToLegacyUser(authUser, profile) {
    if (!authUser || !profile) return null;
    const id = String(profile.id || authUser.id || "");
    const studentId = String(profile.student_id || authUser.user_metadata?.student_id || "").trim();
    const name = String(profile.display_name || authUser.user_metadata?.display_name || "").trim();
    if (!id || !studentId || !name) return null;
    return {
      id,
      authUserId: id,
      name,
      studentId,
      student_id: studentId,
      role: normalizeRole(profile.role),
      className: String(profile.class_name || ""),
      grade: String(profile.grade || ""),
      gender: String(profile.gender || "")
    };
  }

  return {
    normalizeStudentId,
    normalizeDisplayName,
    buildSyntheticEmail,
    validatePassword,
    normalizeRole,
    profileToLegacyUser
  };
});
