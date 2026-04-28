(function () {
  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
  const USER_STATS_TABLE = "user_stats";
  const PHOTO_BUCKET = "house-photos";
  const OBJECT_PHOTOS_TABLE = "object_photos";
  const OBJECT_EDITS_TABLE = "object_attribute_edits";
  const PLANNING_FEATURES_TABLE = "planning_features";
  const COMMUNITY_TASKS_TABLE = "community_tasks";
  const TASK_VERIFICATIONS_TABLE = "task_verifications";
  const POINTS_LEDGER_TABLE = "points_ledger";
  const COMMUNITY_TASK_PHOTO_OBJECT_TYPE = "community_task";
  const SPACE_STORAGE_KEY = "village_planning_spaces_v2";
  const LEGACY_USERS_KEY = "village_planning_users_v1";
  const LEGACY_ACTIVE_KEY = "village_planning_active_user_v1";
  const supabaseClient =
    typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
      : null;
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
      "profileInitial",
      "profileName",
      "profileStudentId",
      "profileFieldName",
      "profileFieldStudentId",
      "profileFieldGender",
      "profileFieldClassName",
      "profileFieldGrade",
      "profileFieldContribution",
      "profileGenderInput",
      "profileClassNameInput",
      "profileGradeInput",
      "profileGenderWrap",
      "profileClassNameWrap",
      "profileGradeWrap",
      "profileToast",
      "deleteAccountBtn",
      "deleteAccountDialog",
      "deleteDialogCloseBtn",
      "deleteDialogCancelBtn",
      "deleteDialogConfirmBtn"
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

  function isStatsTableMissingError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const status = Number(error.status);
    const message = String(error.message || "").toLowerCase();
    return code === "PGRST205" || code === "42P01" || status === 404 || message.includes("does not exist");
  }

  function readJsonArray(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function readJsonObject(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeJsonObject(key, value) {
    localStorage.setItem(key, JSON.stringify(value && typeof value === "object" ? value : {}));
  }

  function getSpaceCreator(space) {
    return String(space?.creatorName || space?.ownerName || space?.createdBy || "").trim();
  }

  async function runDeleteQuery(label, queryBuilder) {
    if (!supabaseClient) return { skipped: true };
    let error = null;
    try {
      const result = await queryBuilder();
      error = result?.error || null;
    } catch (caught) {
      error = caught;
    }
    if (error) {
      const isMissing = isStatsTableMissingError(error);
      console.warn(isMissing ? `${label} 表不存在或不可访问，已跳过。` : `${label} 清理失败，已继续执行。`, error);
    }
    return { skipped: !!error, failed: !!error && !isStatsTableMissingError(error) };
  }

  async function fetchRows(label, queryBuilder) {
    if (!supabaseClient) return [];
    let data = [];
    let error = null;
    try {
      const result = await queryBuilder();
      data = result?.data || [];
      error = result?.error || null;
    } catch (caught) {
      error = caught;
    }
    if (error) {
      const isMissing = isStatsTableMissingError(error);
      console.warn(isMissing ? `${label} 表不存在或不可访问，已跳过读取。` : `${label} 读取失败，已继续执行。`, error);
      return [];
    }
    return data || [];
  }

  async function deleteObjectPhotosByRows(photoRows) {
    if (!supabaseClient || !Array.isArray(photoRows) || photoRows.length === 0) return;

    const photoPaths = Array.from(new Set(photoRows.map((row) => row?.photo_path).filter(Boolean)));
    if (photoPaths.length > 0) {
      try {
        const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(photoPaths);
        if (error) console.warn("照片文件清理失败：", error);
      } catch (e) {
        console.warn("照片文件清理异常：", e);
      }
    }

    const photoIds = Array.from(new Set(photoRows.map((row) => row?.id).filter((id) => id !== null && id !== undefined)));
    if (photoIds.length > 0) {
      await runDeleteQuery("对象照片", () =>
        supabaseClient.from(OBJECT_PHOTOS_TABLE).delete().in("id", photoIds)
      );
    }
  }

  function formatContribution(stats) {
    const points = Number(stats?.total_points || 0);
    const level = Number(stats?.level || 1);
    return `${Number.isFinite(points) ? points : 0} | Lv.${Number.isFinite(level) && level > 0 ? level : 1}`;
  }

  async function refreshContribution(userName) {
    setText(els.profileFieldContribution, "0 | Lv.1");
    const safeName = String(userName || "").trim();
    if (!supabaseClient || !safeName) return;

    const { data, error } = await supabaseClient
      .from(USER_STATS_TABLE)
      .select("total_points, level")
      .eq("user_name", safeName)
      .maybeSingle();

    if (error) {
      if (!isStatsTableMissingError(error)) {
        console.warn("读取贡献值失败：", error);
      }
      return;
    }

    setText(els.profileFieldContribution, formatContribution(data));
  }

  function renderProfile() {
    const user = getCurrentUser();
    const hasUser = !!user;

    if (els.profileLocked) els.profileLocked.style.display = hasUser ? "none" : "";
    if (els.profileContent) els.profileContent.style.display = hasUser ? "" : "none";

    const adminEntryBtn = document.getElementById("adminEntryBtn");
    if (adminEntryBtn) {
      adminEntryBtn.style.display = (hasUser && user.name === "管理员") ? "" : "none";
    }

    // 管理员不显示注销账号
    const deleteAccountRow = document.getElementById("deleteAccountRow");
    if (deleteAccountRow) {
      deleteAccountRow.style.display = (hasUser && user.name === "管理员") ? "none" : "";
    }

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
    refreshContribution(user.name);

    // 预填充输入框
    if (els.profileGenderInput) els.profileGenderInput.value = gender;
    if (els.profileClassNameInput) els.profileClassNameInput.value = className;
    if (els.profileGradeInput) els.profileGradeInput.value = grade;
  }

  function showToast(message, isError) {
    if (!els.profileToast) return;
    els.profileToast.textContent = message;
    els.profileToast.className = `profile-toast ${isError ? "error" : "success"} show`;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.profileToast.classList.remove("show");
    }, 2200);
  }

  function enterEditMode(field) {
    const wrapMap = {
      gender: "profileGenderWrap",
      className: "profileClassNameWrap",
      grade: "profileGradeWrap"
    };
    const valueMap = {
      gender: "profileFieldGender",
      className: "profileFieldClassName",
      grade: "profileFieldGrade"
    };
    const inputMap = {
      gender: "profileGenderInput",
      className: "profileClassNameInput",
      grade: "profileGradeInput"
    };

    const wrap = els[wrapMap[field]];
    const valueEl = els[valueMap[field]];
    const input = els[inputMap[field]];

    if (wrap) wrap.classList.add("is-active");
    if (valueEl) valueEl.style.display = "none";
    if (input) {
      input.focus();
      input._saveHandler = (e) => {
        if (e.key === "Enter") saveField(field);
      };
      input.addEventListener("keydown", input._saveHandler);
    }
  }

  function exitEditMode(field) {
    const wrapMap = {
      gender: "profileGenderWrap",
      className: "profileClassNameWrap",
      grade: "profileGradeWrap"
    };
    const valueMap = {
      gender: "profileFieldGender",
      className: "profileFieldClassName",
      grade: "profileFieldGrade"
    };
    const inputMap = {
      gender: "profileGenderInput",
      className: "profileClassNameInput",
      grade: "profileGradeInput"
    };

    const wrap = els[wrapMap[field]];
    const valueEl = els[valueMap[field]];
    const input = els[inputMap[field]];

    if (wrap) wrap.classList.remove("is-active");
    if (valueEl) valueEl.style.display = "";
    if (input && input._saveHandler) {
      input.removeEventListener("keydown", input._saveHandler);
      input._saveHandler = null;
    }
  }

  async function saveField(field) {
    if (!window.VillageAuth?.updateCurrentUserProfile) {
      showToast("当前账号系统不支持保存资料", true);
      return;
    }

    const inputMap = {
      gender: "profileGenderInput",
      className: "profileClassNameInput",
      grade: "profileGradeInput"
    };
    const valueMap = {
      gender: "profileFieldGender",
      className: "profileFieldClassName",
      grade: "profileFieldGrade"
    };

    const input = els[inputMap[field]];
    const valueEl = els[valueMap[field]];
    const value = input?.value?.trim() || "";

    const payload = { [field]: value };
    const result = await window.VillageAuth.updateCurrentUserProfile(payload);

    if (!result.success) {
      showToast(result.message || "保存失败", true);
      return;
    }

    if (valueEl) valueEl.textContent = displayValue(value);
    showToast("已保存");
    exitEditMode(field);
  }

  function bindEvents() {
    els.profileLoginBtn?.addEventListener("click", () => {
      window.VillageAuth?.openAuthModal?.("login");
    });

    // 编辑按钮点击事件
    document.querySelectorAll(".profile-edit-field-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const field = btn.dataset.edit;
        if (!field) return;
        ["gender", "className", "grade"].forEach((f) => exitEditMode(f));
        enterEditMode(field);
      });
    });

    // 输入框 blur 自动保存
    ["gender", "className", "grade"].forEach((field) => {
      const inputMap = {
        gender: "profileGenderInput",
        className: "profileClassNameInput",
        grade: "profileGradeInput"
      };
      const input = els[inputMap[field]];
      if (input) {
        input.addEventListener("blur", () => saveField(field));
      }
    });

    // 注销账号
    els.deleteAccountBtn?.addEventListener("click", () => {
      const user = getCurrentUser();
      if (!user) {
        showToast("请先登录", true);
        return;
      }
      if (user.name === "管理员") {
        showToast("管理员账号不可注销", true);
        return;
      }
      showDeleteDialog();
    });

    els.deleteDialogCloseBtn?.addEventListener("click", hideDeleteDialog);
    els.deleteDialogCancelBtn?.addEventListener("click", hideDeleteDialog);
    els.deleteDialogConfirmBtn?.addEventListener("click", performDeleteAccount);

    // 点击遮罩关闭弹窗
    els.deleteAccountDialog?.addEventListener("click", (e) => {
      if (e.target === els.deleteAccountDialog) hideDeleteDialog();
    });

    // ESC 关闭弹窗
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.deleteAccountDialog && els.deleteAccountDialog.style.display !== "none") {
        hideDeleteDialog();
      }
    });

    window.addEventListener("village-auth-change", renderProfile);
  }

  function showDeleteDialog() {
    if (els.deleteAccountDialog) els.deleteAccountDialog.style.display = "";
  }

  function hideDeleteDialog() {
    if (els.deleteAccountDialog) els.deleteAccountDialog.style.display = "none";
  }

  async function performDeleteAccount() {
    const user = getCurrentUser();
    if (!user) {
      showToast("请先登录", true);
      hideDeleteDialog();
      return;
    }
    if (user.name === "管理员") {
      showToast("管理员账号不可注销", true);
      hideDeleteDialog();
      return;
    }

    hideDeleteDialog();

    const userName = user.name;
    const studentId = user.studentId;

    // 1. 确定本地要删除的空间
    const spaces = readJsonArray(SPACE_STORAGE_KEY);
    const removedSpaces = spaces.filter((space) => getSpaceCreator(space) === userName);
    const removedSpaceIds = removedSpaces.map((space) => space.id).filter(Boolean);
    const nextSpaces = spaces.filter((space) => getSpaceCreator(space) !== userName);

    // 2. 清理远程数据
    if (supabaseClient) {
      // 2.1 任务及关联数据
      const reportedTasks = await fetchRows("社区任务", () =>
        supabaseClient.from(COMMUNITY_TASKS_TABLE).select("id").eq("reporter_name", userName)
      );
      const spaceTasks = removedSpaceIds.length
        ? await fetchRows("空间任务", () =>
            supabaseClient.from(COMMUNITY_TASKS_TABLE).select("id").in("space_id", removedSpaceIds)
          )
        : [];
      const taskIds = Array.from(new Set([...reportedTasks, ...spaceTasks].map((row) => row?.id).filter((id) => id !== null && id !== undefined)));
      const taskPhotoCodes = taskIds.map((id) => `TASK_${id}`);

      if (taskPhotoCodes.length > 0) {
        const taskPhotoRows = await fetchRows("任务照片", () =>
          supabaseClient
            .from(OBJECT_PHOTOS_TABLE)
            .select("id, photo_path")
            .eq("object_type", COMMUNITY_TASK_PHOTO_OBJECT_TYPE)
            .in("object_code", taskPhotoCodes)
        );
        await deleteObjectPhotosByRows(taskPhotoRows);
      }

      if (taskIds.length > 0) {
        await runDeleteQuery("任务核实", () =>
          supabaseClient.from(TASK_VERIFICATIONS_TABLE).delete().in("task_id", taskIds)
        );
        await runDeleteQuery("积分流水", () =>
          supabaseClient.from(POINTS_LEDGER_TABLE).delete().in("task_id", taskIds)
        );
        await runDeleteQuery("社区任务", () =>
          supabaseClient.from(COMMUNITY_TASKS_TABLE).delete().in("id", taskIds)
        );
      }

      // 2.2 用户直接关联的数据
      await runDeleteQuery("用户核实记录", () =>
        supabaseClient.from(TASK_VERIFICATIONS_TABLE).delete().eq("verifier_name", userName)
      );
      await runDeleteQuery("用户积分流水", () =>
        supabaseClient.from(POINTS_LEDGER_TABLE).delete().eq("user_name", userName)
      );
      await runDeleteQuery("用户统计", () =>
        supabaseClient.from(USER_STATS_TABLE).delete().eq("user_name", userName)
      );

      // 2.3 照片
      const uploadedPhotoRows = await fetchRows("对象照片", () =>
        supabaseClient.from(OBJECT_PHOTOS_TABLE).select("id, photo_path").eq("uploaded_by", userName)
      );
      const spacePhotoRows = [];
      for (const spaceId of removedSpaceIds) {
        const rows = await fetchRows("空间照片", () =>
          supabaseClient.from(OBJECT_PHOTOS_TABLE).select("id, photo_path").like("object_type", `%__${spaceId}`)
        );
        spacePhotoRows.push(...rows);
      }
      await deleteObjectPhotosByRows([...uploadedPhotoRows, ...spacePhotoRows]);

      // 2.4 编辑记录
      for (const spaceId of removedSpaceIds) {
        await runDeleteQuery("空间对象编辑", () =>
          supabaseClient.from(OBJECT_EDITS_TABLE).delete().like("object_type", `%__${spaceId}`)
        );
      }

      // 2.5 规划要素
      if (removedSpaceIds.length > 0) {
        await runDeleteQuery("规划要素", () =>
          supabaseClient.from(PLANNING_FEATURES_TABLE).delete().in("space_id", removedSpaceIds)
        );
      }
    }

    // 3. 清理本地 auth 数据
    if (window.VillageAuth?.deleteCurrentUser) {
      const result = await window.VillageAuth.deleteCurrentUser();
      if (!result.success) {
        showToast(result.message || "本地数据清理失败", true);
        return;
      }
    } else {
      try {
        const AUTH_USERS_KEY = "village_planning_auth_users_v2";
        const AUTH_SESSION_KEY = "village_planning_auth_session_v2";
        const raw = localStorage.getItem(AUTH_USERS_KEY);
        if (raw) {
          const users = JSON.parse(raw);
          const filtered = users.filter((u) => !(u.name === userName && u.studentId === studentId));
          localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(filtered));
        }
        localStorage.removeItem(AUTH_SESSION_KEY);
      } catch (e) {
        showToast("本地数据清理失败", true);
        return;
      }
    }

    // 4. 清理本地空间
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(nextSpaces));

    // 5. 清理 legacy users / active
    const legacyUsers = readJsonArray(LEGACY_USERS_KEY).filter((name) => String(name || "").trim() !== userName);
    if (legacyUsers.length > 0) {
      localStorage.setItem(LEGACY_USERS_KEY, JSON.stringify(legacyUsers));
    } else {
      localStorage.removeItem(LEGACY_USERS_KEY);
    }
    if (String(localStorage.getItem(LEGACY_ACTIVE_KEY) || "").trim() === userName) {
      localStorage.removeItem(LEGACY_ACTIVE_KEY);
    }

    // 6. 触发状态变更并刷新界面
    window.dispatchEvent(new CustomEvent("village-auth-change", { detail: { user: null } }));
    showToast("账号已注销");
    renderProfile();
  }

  document.addEventListener("DOMContentLoaded", () => {
    cacheElements();
    bindEvents();
    renderProfile();
  });
})();
