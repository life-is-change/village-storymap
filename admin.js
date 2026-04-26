(function () {
  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

  const AUTH_USERS_KEY = "village_planning_auth_users_v2";
  const AUTH_SESSION_KEY = "village_planning_auth_session_v2";
  const SPACE_STORAGE_KEY = "village_planning_spaces_v2";
  const LEGACY_USERS_KEY = "village_planning_users_v1";
  const LEGACY_ACTIVE_KEY = "village_planning_active_user_v1";
  const PHOTO_BUCKET = "house-photos";
  const OBJECT_PHOTOS_TABLE = "object_photos";
  const OBJECT_EDITS_TABLE = "object_attribute_edits";
  const PLANNING_FEATURES_TABLE = "planning_features";
  const COMMUNITY_TASKS_TABLE = "community_tasks";
  const TASK_VERIFICATIONS_TABLE = "task_verifications";
  const POINTS_LEDGER_TABLE = "points_ledger";
  const USER_STATS_TABLE = "user_stats";
  const COMMUNITY_TASK_PHOTO_OBJECT_TYPE = "community_task";

  const supabaseClient =
    typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
      : null;

  let isDeletingUser = false;
  let remoteCleanupWarnings = [];
  let messageBoardSortOrder = "time_desc";

  function $(id) {
    return document.getElementById(id);
  }

  function getCurrentUser() {
    return window.VillageAuth && typeof window.VillageAuth.getCurrentUser === "function"
      ? window.VillageAuth.getCurrentUser()
      : null;
  }

  async function getAllUsers() {
    let remoteUsers = [];
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("auth_users")
          .select("name, student_id, gender, class_name, grade, created_at")
          .order("created_at", { ascending: false });
        if (!error && Array.isArray(data)) {
          remoteUsers = data.map((row) => ({
            name: row.name,
            studentId: row.student_id,
            gender: row.gender || "",
            className: row.class_name || "",
            grade: row.grade || "",
            createdAt: row.created_at
          }));
        }
      } catch (e) {
        console.warn("从远端读取用户列表失败：", e);
      }
    }

    // 同时读取本地用户，合并去重（确保当前电脑上注册的用户一定能看到）
    let localUsers = [];
    if (window.VillageAuth && typeof window.VillageAuth.loadAuthUsers === "function") {
      try {
        localUsers = window.VillageAuth.loadAuthUsers() || [];
      } catch (_) {
        localUsers = [];
      }
    }

    const mergedMap = new Map();
    [...remoteUsers, ...localUsers].forEach((u) => {
      const key = `${String(u.name || "").trim()}::${String(u.studentId || "").trim()}`;
      if (!key || key === "::") return;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, u);
      }
    });
    return Array.from(mergedMap.values());
  }

  function writeAuthUsers(users) {
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(Array.isArray(users) ? users : []));
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

  function getSpaceCreator(space) {
    return String(space?.creatorName || space?.ownerName || space?.createdBy || "").trim();
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "—";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day} ${h}:${min}`;
    } catch (_) {
      return "—";
    }
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatContribution(stats) {
    const points = Number(stats?.total_points || 0);
    const level = Number(stats?.level || 1);
    return `${Number.isFinite(points) ? points : 0} | Lv.${Number.isFinite(level) && level > 0 ? level : 1}`;
  }

  function ensureContributionHeader() {
    const headerRow = document.querySelector(".admin-table thead tr");
    if (!headerRow || headerRow.querySelector("[data-contribution-header]")) return;
    const th = document.createElement("th");
    th.dataset.contributionHeader = "1";
    th.textContent = "贡献值";
    const actionHeader = headerRow.lastElementChild;
    const registeredAtHeader = actionHeader?.previousElementSibling;
    headerRow.insertBefore(th, registeredAtHeader || actionHeader);
  }

  async function fetchUserStatsMap(userNames) {
    const names = Array.from(new Set((userNames || []).map((name) => String(name || "").trim()).filter(Boolean)));
    const statsMap = {};
    if (!supabaseClient || names.length === 0) return statsMap;

    const { data, error } = await supabaseClient
      .from(USER_STATS_TABLE)
      .select("user_name, total_points, level")
      .in("user_name", names);

    if (error) {
      if (!isQueryMissingTableError(error)) {
        console.warn("读取贡献值失败：", error);
      }
      return statsMap;
    }

    (data || []).forEach((row) => {
      const key = String(row?.user_name || "").trim();
      if (key) statsMap[key] = row;
    });
    return statsMap;
  }

  function showAdminNotice(message, type = "info") {
    const existing = document.querySelector(".admin-inline-notice");
    if (existing) existing.remove();

    const content = $("adminContent");
    if (!content) return;
    const notice = document.createElement("div");
    notice.className = `admin-inline-notice ${type}`;
    notice.textContent = message;
    content.prepend(notice);
    window.setTimeout(() => notice.remove(), 3600);
  }

  function adminConfirm(message, options = {}) {
    return new Promise((resolve) => {
      const modal = $("adminConfirmModal");
      const titleEl = $("adminConfirmTitle");
      const messageEl = $("adminConfirmMessage");
      const okBtn = $("adminConfirmOk");
      const cancelBtn = $("adminConfirmCancel");
      if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        resolve(window.confirm(message));
        return;
      }

      titleEl.textContent = options.title || "确认";
      messageEl.textContent = message;
      okBtn.textContent = options.okText || "确认";
      cancelBtn.textContent = options.cancelText || "取消";
      okBtn.classList.toggle("danger", options.isDanger !== false);
      modal.classList.remove("is-hidden");

      const cleanup = (result) => {
        modal.classList.add("is-hidden");
        okBtn.removeEventListener("click", handleOk);
        cancelBtn.removeEventListener("click", handleCancel);
        modal.removeEventListener("click", handleOutside);
        document.removeEventListener("keydown", handleKeydown);
        resolve(result);
      };
      const handleOk = () => cleanup(true);
      const handleCancel = () => cleanup(false);
      const handleOutside = (event) => {
        if (event.target === modal) cleanup(false);
      };
      const handleKeydown = (event) => {
        if (event.key === "Escape") cleanup(false);
      };

      okBtn.addEventListener("click", handleOk);
      cancelBtn.addEventListener("click", handleCancel);
      modal.addEventListener("click", handleOutside);
      document.addEventListener("keydown", handleKeydown);
    });
  }

  async function renderTable() {
    ensureContributionHeader();
    const tbody = $("adminTableBody");
    const countEl = $("adminUserCount");
    const users = await getAllUsers();

    if (countEl) countEl.textContent = `共 ${users.length} 个账号`;

    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">暂无注册账号</td></tr>`;
      return;
    }

    const sorted = [...users].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    const statsMap = await fetchUserStatsMap(sorted.map((u) => u.name));

    tbody.innerHTML = sorted.map((u) => {
      const rawName = String(u.name || "").trim();
      const rawStudentId = String(u.studentId || "").trim();
      const name = escapeHtml(rawName || "—");
      const studentId = escapeHtml(rawStudentId || "—");
      const gender = escapeHtml(u.gender || "—");
      const className = escapeHtml(u.className || "—");
      const grade = escapeHtml(u.grade || "—");
      const contribution = escapeHtml(formatContribution(statsMap[rawName]));
      const createdAt = formatDate(u.createdAt);
      const actionHtml = rawName === "管理员"
        ? `<span class="admin-action-muted">管理员账号</span>`
        : `<button type="button" class="admin-btn admin-btn-danger admin-delete-btn" data-delete-user-name="${escapeHtml(rawName)}" data-delete-user-student-id="${escapeHtml(rawStudentId)}">删除</button>`;

      return `
        <tr>
          <td>${name}</td>
          <td>${studentId}</td>
          <td class="${u.gender ? "" : "cell-muted"}">${gender}</td>
          <td class="${u.className ? "" : "cell-muted"}">${className}</td>
          <td class="${u.grade ? "" : "cell-muted"}">${grade}</td>
          <td><span class="admin-contribution-badge">${contribution}</span></td>
          <td class="cell-muted">${createdAt}</td>
          <td>${actionHtml}</td>
        </tr>
      `;
    }).join("");
  }

  async function ignoreMissingTable(label, operation) {
    try {
      return await operation();
    } catch (error) {
      console.warn(`${label} 清理失败：`, error);
      return null;
    }
  }

  function isQueryMissingTableError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    const status = Number(error.status);
    const message = String(error.message || "").toLowerCase();
    return code === "PGRST205" || code === "42P01" || status === 404 || message.includes("does not exist");
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
      const isMissing = isQueryMissingTableError(error);
      console.warn(isMissing ? `${label} 表不存在或不可访问，已跳过。` : `${label} 清理失败，已继续执行。`, error);
      if (!isMissing) remoteCleanupWarnings.push(label);
    }
    return { skipped: !!error, failed: !!error && !isQueryMissingTableError(error) };
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
      const isMissing = isQueryMissingTableError(error);
      console.warn(isMissing ? `${label} 表不存在或不可访问，已跳过读取。` : `${label} 读取失败，已继续执行。`, error);
      if (!isMissing) remoteCleanupWarnings.push(label);
      return [];
    }
    return data || [];
  }

  async function deleteObjectPhotosByRows(photoRows) {
    if (!supabaseClient || !Array.isArray(photoRows) || photoRows.length === 0) return;

    const photoPaths = Array.from(new Set(photoRows.map((row) => row?.photo_path).filter(Boolean)));
    if (photoPaths.length > 0) {
      await ignoreMissingTable("照片文件", async () => {
        const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(photoPaths);
        if (error) {
          remoteCleanupWarnings.push("照片文件");
          throw error;
        }
      });
    }

    const photoIds = Array.from(new Set(photoRows.map((row) => row?.id).filter((id) => id !== null && id !== undefined)));
    if (photoIds.length > 0) {
      await runDeleteQuery("对象照片", () =>
        supabaseClient.from(OBJECT_PHOTOS_TABLE).delete().in("id", photoIds)
      );
    }
  }

  async function cleanupRemoteUserData(userName, removedSpaceIds) {
    remoteCleanupWarnings = [];
    const summary = {
      remoteSkipped: !supabaseClient,
      warningCount: 0
    };

    if (!supabaseClient) return summary;

    const reportedTasks = await fetchRows("社区任务", () =>
      supabaseClient.from(COMMUNITY_TASKS_TABLE).select("id").eq("reporter_name", userName)
    );
    const spaceTasks = removedSpaceIds.length
      ? await fetchRows("社区任务", () =>
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

    await runDeleteQuery("用户核实记录", () =>
      supabaseClient.from(TASK_VERIFICATIONS_TABLE).delete().eq("verifier_name", userName)
    );
    await runDeleteQuery("用户积分流水", () =>
      supabaseClient.from(POINTS_LEDGER_TABLE).delete().eq("user_name", userName)
    );
    await runDeleteQuery("用户统计", () =>
      supabaseClient.from(USER_STATS_TABLE).delete().eq("user_name", userName)
    );
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

    for (const spaceId of removedSpaceIds) {
      await runDeleteQuery("空间对象编辑", () =>
        supabaseClient.from(OBJECT_EDITS_TABLE).delete().like("object_type", `%__${spaceId}`)
      );
    }

    if (removedSpaceIds.length > 0) {
      await runDeleteQuery("规划要素", () =>
        supabaseClient.from(PLANNING_FEATURES_TABLE).delete().in("space_id", removedSpaceIds)
      );
    }

    summary.warningCount = remoteCleanupWarnings.length;
    return summary;
  }

  async function deleteUserAndData(userName, studentId) {
    const targetName = String(userName || "").trim();
    const targetStudentId = String(studentId || "").trim();
    if (!targetName || targetName === "管理员") {
      throw new Error("管理员账号不能删除。");
    }

    const users = await getAllUsers();
    const target = users.find((u) => String(u.name || "").trim() === targetName && String(u.studentId || "").trim() === targetStudentId);
    if (!target) throw new Error("未找到该账号，可能已被删除。");

    const spaces = readJsonArray(SPACE_STORAGE_KEY);
    const removedSpaces = spaces.filter((space) => getSpaceCreator(space) === targetName);
    const removedSpaceIds = removedSpaces.map((space) => space.id).filter(Boolean);
    const nextSpaces = spaces.filter((space) => getSpaceCreator(space) !== targetName);

    const remoteSummary = await cleanupRemoteUserData(targetName, removedSpaceIds);

    writeAuthUsers(users.filter((u) => String(u.name || "").trim() !== targetName));
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(nextSpaces));

    const legacyUsers = readJsonArray(LEGACY_USERS_KEY).filter((name) => String(name || "").trim() !== targetName);
    if (legacyUsers.length > 0) {
      localStorage.setItem(LEGACY_USERS_KEY, JSON.stringify(legacyUsers));
    } else {
      localStorage.removeItem(LEGACY_USERS_KEY);
    }

    try {
      const sessionRaw = localStorage.getItem(AUTH_SESSION_KEY);
      const session = sessionRaw ? JSON.parse(sessionRaw) : null;
      if (session && String(session.name || "").trim() === targetName) {
        localStorage.removeItem(AUTH_SESSION_KEY);
      }
    } catch (_) {
      // ignore malformed session
    }

    if (String(localStorage.getItem(LEGACY_ACTIVE_KEY) || "").trim() === targetName) {
      localStorage.removeItem(LEGACY_ACTIVE_KEY);
    }

    // 从远端用户表和会话表中删除
    if (supabaseClient) {
      await runDeleteQuery("远端用户数据", () =>
        supabaseClient.from("auth_users").delete().eq("name", targetName).eq("student_id", targetStudentId)
      );
      await runDeleteQuery("远端会话数据", () =>
        supabaseClient.from("user_sessions").delete().eq("user_name", targetName)
      );
    }

    return {
      removedSpaceCount: removedSpaceIds.length,
      remoteSkipped: remoteSummary.remoteSkipped,
      remoteWarningCount: Number(remoteSummary.warningCount || 0)
    };
  }

  async function handleDeleteClick(button) {
    if (isDeletingUser) return;
    const userName = String(button.dataset.deleteUserName || "").trim();
    const studentId = String(button.dataset.deleteUserStudentId || "").trim();
    if (!userName || userName === "管理员") return;

    const confirmed = await adminConfirm(
      `确认删除账号“${userName}”（学号：${studentId || "—"}）吗？该操作会删除此账号及其名下的规划空间、照片、任务和积分数据，删除后不可恢复。`,
      {
        title: "高危操作确认",
        okText: "确认删除",
        cancelText: "取消",
        isDanger: true
      }
    );
    if (!confirmed) return;

    isDeletingUser = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "删除中...";
    try {
      const result = await deleteUserAndData(userName, studentId);
      renderTable();
      const remoteTip = result.remoteSkipped
        ? "；当前未连接远端数据库，仅清理了本地数据"
        : result.remoteWarningCount > 0
          ? `；有 ${result.remoteWarningCount} 项远端清理未完成，请检查控制台`
          : "";
      showAdminNotice(`已删除账号“${userName}”及其名下数据，移除规划空间 ${result.removedSpaceCount} 个${remoteTip}。`, result.remoteWarningCount > 0 ? "warning" : "success");
    } catch (error) {
      console.error("删除账号失败：", error);
      button.disabled = false;
      button.textContent = originalText;
      showAdminNotice(error?.message || "删除失败，请稍后重试。", "error");
    } finally {
      isDeletingUser = false;
    }
  }

  async function renderPhotos() {
    const grid = $("adminPhotoGrid");
    const countEl = $("adminPhotoCount");
    if (!grid) return;

    // 直接查询以捕获错误提示；表中可能没有时间戳字段，故不在 SQL 里排序
    let photos = [];
    let queryError = null;
    try {
      const result = await supabaseClient
        .from(OBJECT_PHOTOS_TABLE)
        .select("*")
        .limit(500);
      photos = result?.data || [];
      queryError = result?.error || null;
    } catch (e) {
      queryError = e;
    }

    if (queryError) {
      console.warn("照片查询失败：", queryError);
      grid.innerHTML = `<div class="admin-empty" style="grid-column: 1 / -1;">照片查询失败：${escapeHtml(queryError.message || "请检查控制台")}</div>`;
      if (countEl) countEl.textContent = "共 0 张照片";
      return;
    }

    // 按 id 倒序排列（id 自增，越大的越新）
    photos.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    if (countEl) countEl.textContent = `共 ${photos.length} 张照片`;

    if (photos.length === 0) {
      grid.innerHTML = `<div class="admin-empty" style="grid-column: 1 / -1;">暂无照片</div>`;
      return;
    }

    grid.innerHTML = photos.map((p) => {
      const typeLabel = escapeHtml(p.object_type || "—");
      const code = escapeHtml(p.object_code || "—");
      const uploader = escapeHtml(p.uploaded_by || "—");
      const time = formatDate(p.created_at || p.uploaded_at);
      return `
        <div class="admin-photo-item" data-photo-id="${escapeHtml(String(p.id))}" data-photo-path="${escapeHtml(p.photo_path || "")}">
          <a class="admin-photo-download" href="${escapeHtml(p.photo_url || "")}" download title="下载原图" data-download-src="${escapeHtml(p.photo_url || "")}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </a>
          <button type="button" class="admin-photo-delete" title="删除" data-delete-photo>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
          <img src="${escapeHtml(p.photo_url || "")}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div style="display:none;align-items:center;justify-content:center;height:140px;color:#9aa9b8;font-size:12px;">图片加载失败</div>
          <div class="admin-photo-meta">
            <div class="photo-type">${typeLabel} · ${code}</div>
            <div>上传者：${uploader}</div>
            <div class="cell-muted">${time}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function handlePhotoDelete(button) {
    const item = button.closest(".admin-photo-item");
    if (!item) return;
    const photoId = item.dataset.photoId;
    const photoPath = item.dataset.photoPath;
    if (!photoId) return;

    const confirmed = await adminConfirm(
      `确认删除这张照片吗？删除后不可恢复。`,
      { title: "删除照片", okText: "确认删除", cancelText: "取消", isDanger: true }
    );
    if (!confirmed) return;

    try {
      if (photoPath) {
        await ignoreMissingTable("照片文件", async () => {
          const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove([photoPath]);
          if (error) throw error;
        });
      }
      await runDeleteQuery("对象照片", () =>
        supabaseClient.from(OBJECT_PHOTOS_TABLE).delete().eq("id", photoId)
      );
      item.remove();
      const countEl = $("adminPhotoCount");
      if (countEl) {
        const current = parseInt(countEl.textContent.replace(/\D/g, ""), 10) || 0;
        countEl.textContent = `共 ${Math.max(0, current - 1)} 张照片`;
      }
      showAdminNotice("照片已删除", "success");
    } catch (error) {
      console.error("删除照片失败：", error);
      showAdminNotice("删除照片失败，请稍后重试。", "error");
    }
  }

  async function downloadPhoto(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("下载失败");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.warn("照片下载失败：", err);
      window.open(url, "_blank");
    }
  }

  function bindPhotoEvents() {
    const grid = $("adminPhotoGrid");
    if (!grid || grid.dataset.bound) return;
    grid.dataset.bound = "1";
    grid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-photo]");
      if (button) {
        handlePhotoDelete(button);
        return;
      }
      const downloadLink = event.target.closest("[data-download-src]");
      if (downloadLink) {
        event.preventDefault();
        downloadPhoto(downloadLink.dataset.downloadSrc);
      }
    });
  }

  function bindTableEvents() {
    const tbody = $("adminTableBody");
    if (!tbody || tbody.dataset.bound) return;
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-user-name]");
      if (!button) return;
      handleDeleteClick(button);
    });
  }

  async function fetchAllMessages() {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from(COMMUNITY_TASKS_TABLE)
      .select("*")
      .order("id", { ascending: false })
      .limit(1000);
    if (error) {
      console.warn("读取留言失败：", error);
      return [];
    }
    return data || [];
  }

  async function fetchMessageLikes(messageId) {
    if (!supabaseClient || !messageId) return [];
    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("data")
      .eq("object_code", `MSG_${messageId}`)
      .eq("object_type", "message_likes")
      .maybeSingle();
    if (error) {
      console.warn("读取点赞失败：", error);
      return [];
    }
    return Array.isArray(data?.data?.likers) ? data.data.likers : [];
  }

  async function fetchMessageReplies(messageId) {
    if (!supabaseClient || !messageId) return [];
    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("data")
      .eq("object_code", `MSG_${messageId}`)
      .eq("object_type", "message_replies")
      .maybeSingle();
    if (error) {
      console.warn("读取追评失败：", error);
      return [];
    }
    return Array.isArray(data?.data?.replies) ? data.data.replies : [];
  }

  async function renderMessages() {
    const tbody = $("adminMessageTableBody");
    const countEl = $("adminMessageCount");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="9" class="admin-empty">加载中...</td></tr>`;

    const rows = await fetchAllMessages();
    if (countEl) countEl.textContent = `共 ${rows.length} 条留言`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="admin-empty">暂无留言</td></tr>`;
      return;
    }

    // 获取每条留言的点赞和评论数
    const messageMeta = await Promise.all(
      rows.map(async (msg) => {
        const likers = await fetchMessageLikes(msg.id);
        const replies = await fetchMessageReplies(msg.id);
        return {
          msg,
          likeCount: likers.length,
          replyCount: replies.length,
          createdAt: Date.parse(msg.created_at || "") || 0
        };
      })
    );

    // 排序
    messageMeta.sort((a, b) => {
      switch (messageBoardSortOrder) {
        case "time_desc": return b.createdAt - a.createdAt;
        case "time_asc": return a.createdAt - b.createdAt;
        case "likes_desc":
          if (a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
          return b.createdAt - a.createdAt;
        case "likes_asc":
          if (a.likeCount !== b.likeCount) return a.likeCount - b.likeCount;
          return b.createdAt - a.createdAt;
        case "replies_desc":
          if (a.replyCount !== b.replyCount) return b.replyCount - a.replyCount;
          return b.createdAt - a.createdAt;
        case "replies_asc":
          if (a.replyCount !== b.replyCount) return a.replyCount - b.replyCount;
          return b.createdAt - a.createdAt;
        default: return b.createdAt - a.createdAt;
      }
    });

    const typeMeta = {
      garbage: { label: "垃圾堆积" },
      road_damage: { label: "道路破损" },
      drainage_issue: { label: "排水问题" },
      safety_hazard: { label: "安全隐患" },
      public_space_need: { label: "公共空间需求" }
    };

    tbody.innerHTML = messageMeta.map((meta) => {
      const msg = meta.msg;
      const id = escapeHtml(String(msg.id));
      const typeLabel = escapeHtml(typeMeta[msg.category]?.label || msg.category || "—");
      const reporter = escapeHtml(msg.reporter_name || "—");
      const likes = meta.likeCount;
      const replies = meta.replyCount;
      const time = formatDate(msg.created_at);
      return `
        <tr>
          <td class="cell-muted">${id}</td>
          <td>${typeLabel}</td>
          <td><button type="button" class="admin-btn" data-view-message-id="${msg.id}" style="min-height:28px;padding:0 10px;font-size:12px;">查看</button></td>
          <td>${reporter}</td>
          <td>${likes}</td>
          <td>${replies}</td>
          <td class="cell-muted">${time}</td>
          <td>
            <button type="button" class="admin-btn admin-btn-danger admin-delete-btn" data-delete-message-id="${msg.id}">删除</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function handleMessageDelete(button) {
    const messageId = button.dataset.deleteMessageId;
    if (!messageId) return;

    const confirmed = await adminConfirm(
      `确认删除这条留言吗？删除后不可恢复。`,
      { title: "删除留言", okText: "确认删除", cancelText: "取消", isDanger: true }
    );
    if (!confirmed) return;

    try {
      // 删除关联的点赞和评论记录
      await runDeleteQuery("留言点赞", () =>
        supabaseClient.from(OBJECT_EDITS_TABLE).delete().eq("object_code", `MSG_${messageId}`)
      );
      // 删除关联的照片
      const photoRows = await fetchRows("任务照片", () =>
        supabaseClient
          .from(OBJECT_PHOTOS_TABLE)
          .select("id, photo_path")
          .eq("object_type", COMMUNITY_TASK_PHOTO_OBJECT_TYPE)
          .eq("object_code", `TASK_${messageId}`)
      );
      await deleteObjectPhotosByRows(photoRows);
      // 删除留言本身
      await runDeleteQuery("留言", () =>
        supabaseClient.from(COMMUNITY_TASKS_TABLE).delete().eq("id", messageId)
      );
      button.closest("tr")?.remove();
      const countEl = $("adminMessageCount");
      if (countEl) {
        const current = parseInt(countEl.textContent.replace(/\D/g, ""), 10) || 0;
        countEl.textContent = `共 ${Math.max(0, current - 1)} 条留言`;
      }
      showAdminNotice("留言已删除", "success");
    } catch (error) {
      console.error("删除留言失败：", error);
      showAdminNotice("删除留言失败，请稍后重试。", "error");
    }
  }

  async function showMessageDetailModal(messageId) {
    const modal = $("adminMessageDetailModal");
    const body = $("adminMessageDetailBody");
    if (!modal || !body) return;

    body.innerHTML = '<div style="padding:20px;text-align:center;color:#5f7385;">加载中...</div>';
    modal.classList.remove("is-hidden");

    const rows = await fetchAllMessages();
    const msg = rows.find((r) => String(r.id) === String(messageId));
    if (!msg) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:#5f7385;">留言不存在或已被删除</div>';
      return;
    }

    // 获取照片
    let photos = [];
    try {
      const { data, error } = await supabaseClient
        .from(OBJECT_PHOTOS_TABLE)
        .select("id, photo_url, photo_path, uploaded_by, created_at")
        .eq("object_type", COMMUNITY_TASK_PHOTO_OBJECT_TYPE)
        .eq("object_code", `TASK_${messageId}`);
      if (!error) photos = data || [];
    } catch (e) {
      console.warn("读取留言照片失败：", e);
    }

    // 获取追评
    const replies = await fetchMessageReplies(messageId);
    replies.sort((a, b) => {
      const ta = Date.parse(a.created_at || "") || 0;
      const tb = Date.parse(b.created_at || "") || 0;
      return tb - ta;
    });

    const content = escapeHtml(msg.description || "（无描述）");
    const typeMeta = {
      garbage: { label: "垃圾堆积" },
      road_damage: { label: "道路破损" },
      drainage_issue: { label: "排水问题" },
      safety_hazard: { label: "安全隐患" },
      public_space_need: { label: "公共空间需求" }
    };
    const typeLabel = escapeHtml(typeMeta[msg.category]?.label || msg.category || "—");
    const reporter = escapeHtml(msg.reporter_name || "—");
    const time = formatDate(msg.created_at);

    const photoHtml = photos.length
      ? `<div class="admin-photo-grid" style="margin-top:12px;">
          ${photos.map((p) => `
            <div class="admin-photo-item" data-photo-id="${escapeHtml(String(p.id))}" data-photo-path="${escapeHtml(p.photo_path || "")}">
              <a class="admin-photo-download" href="${escapeHtml(p.photo_url || "")}" download title="下载原图" data-download-src="${escapeHtml(p.photo_url || "")}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </a>
              <button type="button" class="admin-photo-delete" title="删除" data-delete-photo>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <img src="${escapeHtml(p.photo_url || "")}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div style="display:none;align-items:center;justify-content:center;height:140px;color:#9aa9b8;font-size:12px;">图片加载失败</div>
              <div class="admin-photo-meta">
                <div class="photo-type">留言照片</div>
                <div>上传者：${escapeHtml(p.uploaded_by || "—")}</div>
                <div class="cell-muted">${formatDate(p.created_at)}</div>
              </div>
            </div>
          `).join("")}
        </div>`
      : '<div style="margin-top:12px;padding:16px;border-radius:12px;background:rgba(31,53,82,0.04);color:#5f7385;text-align:center;font-size:14px;">暂无照片</div>';

    const repliesHtml = replies.length
      ? `<div style="display:flex;flex-direction:column;gap:10px;">
          ${replies.map((r) => `
            <div style="padding:12px 14px;border-radius:10px;background:rgba(31,53,82,0.03);border:1px solid rgba(31,53,82,0.06);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#1f3552;">${escapeHtml(r.author || "未知")}</span>
                <span style="font-size:12px;color:#728296;">${formatDate(r.created_at)}</span>
              </div>
              <div style="font-size:14px;line-height:1.6;color:#1f3552;white-space:pre-wrap;word-break:break-word;">${escapeHtml(r.content || "")}</div>
            </div>
          `).join("")}
        </div>`
      : '<div style="padding:16px;border-radius:12px;background:rgba(31,53,82,0.04);color:#5f7385;text-align:center;font-size:14px;">暂无追评</div>';

    body.innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:rgba(47,105,40,0.08);border:1px solid rgba(47,105,40,0.18);color:#2f4f66;font-size:12px;font-weight:700;">${typeLabel}</span>
          <span style="color:#728296;font-size:13px;">${reporter} · ${time}</span>
        </div>
        <div style="font-size:15px;line-height:1.7;color:#1f3552;white-space:pre-wrap;word-break:break-word;">${content}</div>
      </div>
      <div style="border-top:1px solid rgba(31,53,82,0.08);padding-top:12px;">
        <div style="font-size:13px;font-weight:700;color:#728296;margin-bottom:4px;" data-photo-count-label>照片（${photos.length} 张）</div>
        ${photoHtml}
      </div>
      <div style="border-top:1px solid rgba(31,53,82,0.08);padding-top:12px;margin-top:12px;">
        <div style="font-size:13px;font-weight:700;color:#728296;margin-bottom:8px;">追评（${replies.length} 条）</div>
        ${repliesHtml}
      </div>
    `;

    // 绑定弹窗内照片事件
    body.querySelectorAll("[data-delete-photo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = btn.closest("[data-photo-id]");
        if (!item) return;
        const photoId = item.dataset.photoId;
        const photoPath = item.dataset.photoPath;
        if (!photoId) return;

        const confirmed = await adminConfirm(
          `确认删除这张照片吗？删除后不可恢复。`,
          { title: "删除照片", okText: "确认删除", cancelText: "取消", isDanger: true }
        );
        if (!confirmed) return;

        try {
          if (photoPath) {
            await ignoreMissingTable("照片文件", async () => {
              const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove([photoPath]);
              if (error) throw error;
            });
          }
          await runDeleteQuery("对象照片", () =>
            supabaseClient.from(OBJECT_PHOTOS_TABLE).delete().eq("id", photoId)
          );
          item.remove();
          // 更新照片计数文字
          const countLabel = body.querySelector("[data-photo-count-label]");
          if (countLabel) {
            const current = parseInt(countLabel.textContent.replace(/\D/g, ""), 10) || 0;
            countLabel.textContent = `照片（${Math.max(0, current - 1)} 张）`;
          }
          showAdminNotice("照片已删除", "success");
        } catch (error) {
          console.error("删除照片失败：", error);
          showAdminNotice("删除照片失败，请稍后重试。", "error");
        }
      });
    });

    body.querySelectorAll("[data-download-src]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        downloadPhoto(link.dataset.downloadSrc);
      });
    });
  }

  function bindMessageEvents() {
    const tbody = $("adminMessageTableBody");
    if (!tbody || tbody.dataset.bound) return;
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", (event) => {
      const viewBtn = event.target.closest("[data-view-message-id]");
      if (viewBtn) {
        showMessageDetailModal(viewBtn.dataset.viewMessageId);
        return;
      }
      const deleteBtn = event.target.closest("[data-delete-message-id]");
      if (deleteBtn) {
        handleMessageDelete(deleteBtn);
      }
    });

    // 弹窗关闭
    const modal = $("adminMessageDetailModal");
    const closeBtn = $("adminMessageDetailClose");
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("is-hidden");
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        modal?.classList.add("is-hidden");
      });
    }

    const sortSelect = $("adminMessageSortSelect");
    if (sortSelect) {
      sortSelect.value = messageBoardSortOrder;
      sortSelect.addEventListener("change", (e) => {
        messageBoardSortOrder = e.target.value;
        renderMessages();
      });
    }
  }

  function bindAdminTabs() {
    const menu = document.querySelector(".admin-menu");
    if (!menu || menu.dataset.bound) return;
    menu.dataset.bound = "1";
    menu.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-admin-tab]");
      if (!btn) return;
      const tab = btn.dataset.adminTab;
      menu.querySelectorAll(".admin-menu-item").forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".admin-tab-panel").forEach((panel) => panel.classList.remove("active"));
      const target = tab === "users" ? $("adminTabUsers") : tab === "messages" ? $("adminTabMessages") : $("adminTabPhotos");
      if (target) target.classList.add("active");
    });
  }

  function init() {
    const user = getCurrentUser();
    const isAdmin = user && user.name === "管理员";

    const locked = $("adminLocked");
    const content = $("adminContent");

    if (!isAdmin) {
      if (locked) locked.style.display = "";
      if (content) content.style.display = "none";
      document.title = "权限不足 - 后台管理";
      return;
    }

    if (locked) locked.style.display = "none";
    if (content) content.style.display = "";
    document.title = "后台管理 - 村庄规划互动平台";
    bindAdminTabs();
    bindTableEvents();
    renderTable();
    bindPhotoEvents();
    renderPhotos();
    bindMessageEvents();
    renderMessages();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
