(function () {
  const EMPTY_TEXT = "未填写";

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      "profileLocked",
      "profileContent",
      "profileLoginBtn",
      "profileLogoutBtn",
      "profileInitial",
      "profileName",
      "profileStudentId",
      "profileFieldName",
      "profileFieldStudentId",
      "profileFieldGender",
      "profileFieldClassName",
      "profileFieldGrade",
      "profileForm",
      "profileGender",
      "profileClassName",
      "profileGrade",
      "profileStatus"
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function readUserField(user, keys) {
    for (const key of keys) {
      const value = String(user?.[key] || "").trim();
      if (value) return value;
    }
    return "";
  }

  function displayValue(value) {
    return String(value || "").trim() || EMPTY_TEXT;
  }

  function getCurrentUser() {
    return window.VillageAuth && typeof window.VillageAuth.getCurrentUser === "function"
      ? window.VillageAuth.getCurrentUser()
      : null;
  }

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  function renderProfile() {
    const user = getCurrentUser();
    const hasUser = !!user;

    if (els.profileLocked) els.profileLocked.style.display = hasUser ? "none" : "";
    if (els.profileContent) els.profileContent.style.display = hasUser ? "" : "none";
    if (els.profileLogoutBtn) els.profileLogoutBtn.style.display = hasUser ? "" : "none";

    if (!hasUser) {
      document.title = "请先登录 - 个人中心";
      return;
    }

    const userName = displayValue(user.name);
    const studentId = displayValue(user.studentId);
    const gender = readUserField(user, ["gender", "sex"]);
    const className = readUserField(user, ["className", "class", "class_name"]);
    const grade = readUserField(user, ["grade", "year"]);

    document.title = `${userName}的个人中心 - 村庄规划互动平台`;
    setText(els.profileInitial, userName.slice(0, 1) || "用");
    setText(els.profileName, userName);
    setText(els.profileStudentId, `学号：${studentId}`);
    setText(els.profileFieldName, userName);
    setText(els.profileFieldStudentId, studentId);
    setText(els.profileFieldGender, displayValue(gender));
    setText(els.profileFieldClassName, displayValue(className));
    setText(els.profileFieldGrade, displayValue(grade));

    if (els.profileGender) els.profileGender.value = gender;
    if (els.profileClassName) els.profileClassName.value = className;
    if (els.profileGrade) els.profileGrade.value = grade;
  }

  function showStatus(message, isError = false) {
    if (!els.profileStatus) return;
    els.profileStatus.textContent = message;
    els.profileStatus.style.color = isError ? "#c94a4a" : "#2f6928";
    if (!message) return;
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => {
      els.profileStatus.textContent = "";
    }, 2200);
  }

  function bindEvents() {
    els.profileLoginBtn?.addEventListener("click", () => {
      window.VillageAuth?.openAuthModal?.("login");
    });

    els.profileLogoutBtn?.addEventListener("click", () => {
      window.VillageAuth?.logout?.();
      window.location.href = "./index.html";
    });

    els.profileForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!window.VillageAuth?.updateCurrentUserProfile) {
        showStatus("当前账号系统不支持保存资料", true);
        return;
      }

      const result = window.VillageAuth.updateCurrentUserProfile({
        gender: els.profileGender?.value || "",
        className: els.profileClassName?.value || "",
        grade: els.profileGrade?.value || ""
      });

      if (!result.success) {
        showStatus(result.message || "保存失败", true);
        return;
      }

      renderProfile();
      showStatus(result.message || "资料已保存");
    });

    window.addEventListener("village-auth-change", renderProfile);
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    renderProfile();
  });
})();
