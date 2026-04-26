(function () {
  const AUTH_USERS_KEY = "village_planning_auth_users_v2";
  const AUTH_SESSION_KEY = "village_planning_auth_session_v2";

  const LEGACY_USERS_KEY = "village_planning_users_v1";
  const LEGACY_ACTIVE_KEY = "village_planning_active_user_v1";
  const OLD_AUTH_USERS_KEY = "village_planning_auth_users_v1";
  const OLD_AUTH_SESSION_KEY = "village_planning_auth_session_v1";

  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
  const supabaseClient =
    typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
      : null;

  let authModalOverlay = null;
  let hasHandledInitialAuthRequest = false;
  let authMode = "login";

  function clearLegacyIdentityData() {
    try {
      localStorage.removeItem(LEGACY_USERS_KEY);
      localStorage.removeItem(LEGACY_ACTIVE_KEY);
      localStorage.removeItem(OLD_AUTH_USERS_KEY);
      localStorage.removeItem(OLD_AUTH_SESSION_KEY);
    } catch (_) {
      // ignore
    }
  }

  function loadAuthUsers() {
    try {
      const raw = localStorage.getItem(AUTH_USERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveAuthUsers(users) {
    try {
      localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
    } catch (e) {
      console.warn("保存用户数据失败:", e);
    }
  }

  function loadAuthSession() {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveAuthSession(session) {
    try {
      if (!session) {
        localStorage.removeItem(AUTH_SESSION_KEY);
      } else {
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
      }
    } catch (e) {
      console.warn("保存会话失败:", e);
    }
  }

  function syncLegacyActiveUser(name) {
    try {
      if (name) {
        localStorage.setItem(LEGACY_ACTIVE_KEY, name);
      } else {
        localStorage.removeItem(LEGACY_ACTIVE_KEY);
      }
    } catch (_) {
      // ignore
    }
  }

  function generateSessionToken() {
    return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  async function upsertAuthUserToRemote(user) {
    if (!supabaseClient) return;
    try {
      await supabaseClient.from("auth_users").upsert(
        {
          name: user.name,
          student_id: user.studentId,
          gender: user.gender || null,
          class_name: user.className || null,
          grade: user.grade || null,
          created_at: user.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        { onConflict: "name,student_id" }
      );
    } catch (e) {
      console.warn("同步用户到远端失败：", e);
    }
  }

  async function upsertUserSessionToRemote(name, token) {
    if (!supabaseClient || !name || !token) return;
    try {
      await supabaseClient.from("user_sessions").upsert(
        {
          user_name: name,
          session_token: token,
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString()
        },
        { onConflict: "user_name" }
      );
    } catch (e) {
      console.warn("同步会话到远端失败：", e);
    }
  }

  async function removeUserSessionFromRemote(name) {
    if (!supabaseClient || !name) return;
    try {
      await supabaseClient.from("user_sessions").delete().eq("user_name", name);
    } catch (e) {
      console.warn("删除远端会话失败：", e);
    }
  }

  async function validateCurrentSession() {
    const session = loadAuthSession();
    if (!session || !session.name) return false;
    // 兼容老用户：没有 token 的会话视为有效（避免强制登出老用户）
    if (!session.token) return true;
    if (!supabaseClient) return true;
    try {
      const { data, error } = await supabaseClient
        .from("user_sessions")
        .select("session_token")
        .eq("user_name", session.name)
        .maybeSingle();
      if (error) return true;
      if (!data) return false;
      return data.session_token === session.token;
    } catch (e) {
      return true;
    }
  }

  function forceLogoutWithMessage(message) {
    saveAuthSession(null);
    syncLegacyActiveUser("");
    onAuthStateChanged();
    updateAuthModalUI();
    if (typeof window.showToast === "function") {
      window.showToast(message, "error");
    } else {
      alert(message);
    }
  }

  function initSessionRealtimeListener() {
    if (!supabaseClient) return;
    const session = loadAuthSession();
    if (!session || !session.name) return;

    supabaseClient
      .channel("user-sessions-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_sessions",
          filter: `user_name=eq.${session.name}`
        },
        (payload) => {
          const newToken = payload.new?.session_token;
          const currentSession = loadAuthSession();
          // 老用户没有 token，不触发挤下线（避免误踢）
          if (!currentSession || !currentSession.token) return;
          if (newToken && newToken !== currentSession.token) {
            forceLogoutWithMessage("您的账号已在其他地方登录，您已被退出。");
          }
        }
      )
      .subscribe();
  }

  function findUserByName(name) {
    const users = loadAuthUsers();
    return users.find((u) => u.name === name) || null;
  }

  function getCurrentUser() {
    const session = loadAuthSession();
    if (!session || !session.name) return null;
    return findUserByName(session.name);
  }

  function isLoggedIn() {
    return !!getCurrentUser();
  }

  function getCurrentDisplayName() {
    const user = getCurrentUser();
    return user ? user.name : "";
  }

  function normalizeAuthInput(name, studentId) {
    const trimmedName = String(name || "").trim();
    const trimmedId = String(studentId || "").trim();

    if (!trimmedName) return { success: false, message: "请输入姓名" };
    if (!trimmedId) return { success: false, message: "请输入学号" };
    if (trimmedName.length > 20) return { success: false, message: "姓名不能超过20个字符" };
    if (trimmedId.length > 20) return { success: false, message: "学号不能超过20个字符" };

    return { success: true, name: trimmedName, studentId: trimmedId };
  }

  function normalizeProfileDetails(details = {}) {
    const pick = (...keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(details, key)) {
          return String(details[key] || "").trim();
        }
      }
      return "";
    };

    return {
      gender: pick("gender", "sex").slice(0, 12),
      className: pick("className", "class", "class_name").slice(0, 30),
      grade: pick("grade", "year").slice(0, 20)
    };
  }

  function mergeNonEmptyProfileDetails(target, details) {
    let changed = false;
    ["gender", "className", "grade"].forEach((key) => {
      if (details[key] && target[key] !== details[key]) {
        target[key] = details[key];
        changed = true;
      }
    });
    return changed;
  }

  async function loginOrRegister(name, studentId, profileDetails = {}) {
    const normalized = normalizeAuthInput(name, studentId);
    if (!normalized.success) return normalized;

    const trimmedName = normalized.name;
    const trimmedId = normalized.studentId;
    const details = normalizeProfileDetails(profileDetails);
    const users = loadAuthUsers();
    const existing = users.find((u) => u.name === trimmedName && u.studentId === trimmedId);

    const sessionToken = generateSessionToken();

    if (existing) {
      const changed = mergeNonEmptyProfileDetails(existing, details);
      if (changed) {
        existing.updatedAt = new Date().toISOString();
        saveAuthUsers(users);
      }
      saveAuthSession({ name: trimmedName, studentId: trimmedId, loggedInAt: new Date().toISOString(), token: sessionToken });
      syncLegacyActiveUser(trimmedName);
      await upsertAuthUserToRemote(existing);
      await upsertUserSessionToRemote(trimmedName, sessionToken);
      return { success: true, message: "登录成功", user: existing, isNew: false };
    }

    const sameName = users.find((u) => u.name === trimmedName);
    if (sameName) {
      return { success: false, message: "该姓名已存在，但学号不匹配，请检查输入。" };
    }

    const newUser = {
      name: trimmedName,
      studentId: trimmedId,
      gender: details.gender,
      className: details.className,
      grade: details.grade,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveAuthUsers(users);
    saveAuthSession({ name: trimmedName, studentId: trimmedId, loggedInAt: new Date().toISOString(), token: sessionToken });
    syncLegacyActiveUser(trimmedName);
    await upsertAuthUserToRemote(newUser);
    await upsertUserSessionToRemote(trimmedName, sessionToken);

    return { success: true, message: "注册并登录成功", user: newUser, isNew: true };
  }

  function registerOrLogin(name, studentId, profileDetails = {}) {
    return loginOrRegister(name, studentId, profileDetails);
  }

  async function updateCurrentUserProfile(profileDetails = {}) {
    const user = getCurrentUser();
    if (!user) return { success: false, message: "请先登录" };

    const users = loadAuthUsers();
    const targetIndex = users.findIndex((u) => u.name === user.name && u.studentId === user.studentId);
    if (targetIndex < 0) return { success: false, message: "未找到当前用户" };

    const details = normalizeProfileDetails(profileDetails);
    users[targetIndex] = {
      ...users[targetIndex],
      ...details,
      updatedAt: new Date().toISOString()
    };
    saveAuthUsers(users);
    await upsertAuthUserToRemote(users[targetIndex]);
    onAuthStateChanged();
    return { success: true, message: "资料已保存", user: users[targetIndex] };
  }

  function setAuthMode(mode = "login") {
    authMode = mode === "register" ? "register" : "login";
  }

  async function logout() {
    const session = loadAuthSession();
    if (session && session.name) {
      await removeUserSessionFromRemote(session.name);
    }
    saveAuthSession(null);
    syncLegacyActiveUser("");
    onAuthStateChanged();
    updateAuthModalUI();
  }

  async function deleteCurrentUser() {
    const user = getCurrentUser();
    if (!user) return { success: false, message: "请先登录" };

    await removeUserSessionFromRemote(user.name);
    const users = loadAuthUsers();
    const filtered = users.filter((u) => !(u.name === user.name && u.studentId === user.studentId));
    saveAuthUsers(filtered);
    saveAuthSession(null);
    syncLegacyActiveUser("");
    onAuthStateChanged();
    updateAuthModalUI();
    return { success: true, message: "账号已注销" };
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createAuthModal() {
    if (document.getElementById("authModalOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "authModalOverlay";
    overlay.className = "auth-modal-overlay is-hidden";

    overlay.innerHTML = `
      <div class="auth-modal" id="authModal">
        <div class="auth-modal-header">
          <h3 class="auth-modal-title" id="authModalTitle">登录/注册</h3>
          <button type="button" class="auth-modal-close" id="authModalClose" title="关闭">×</button>
        </div>
        <div class="auth-modal-body">
          <div id="authLoggedInPanel" style="display:none;">
            <div class="auth-user-card">
              <div class="auth-user-avatar">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <div class="auth-user-info">
                <div class="auth-user-name" id="authCurrentName">--</div>
                <div class="auth-user-id" id="authCurrentStudentId">--</div>
              </div>
            </div>
            <div class="auth-actions-row" style="margin-top:16px;">
              <button type="button" class="auth-btn auth-btn-secondary" id="authSwitchBtn" style="width:100%;">切换账号</button>
            </div>
          </div>

          <div id="authLoggedOutPanel">
            <div class="auth-form-group">
              <label class="auth-form-label">姓名</label>
              <input type="text" id="authName" class="auth-form-input" placeholder="请输入姓名" maxlength="20">
            </div>
            <div class="auth-form-group">
              <label class="auth-form-label">学号</label>
              <input type="text" id="authStudentId" class="auth-form-input" placeholder="请输入学号" maxlength="20">
            </div>
            <div class="auth-form-tip" id="authModeTip"></div>
            <div class="auth-form-tip" id="authTip"></div>
            <button type="button" class="auth-btn auth-btn-primary" id="authSubmitBtn" style="width:100%;">确认</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    authModalOverlay = overlay;

    bindAuthModalEvents();
  }

  function bindAuthModalEvents() {
    document.getElementById("authModalClose")?.addEventListener("click", closeAuthModal);

    authModalOverlay?.addEventListener("click", (e) => {
      if (e.target === authModalOverlay) closeAuthModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && authModalOverlay && !authModalOverlay.classList.contains("is-hidden")) {
        closeAuthModal();
      }
    });

    document.getElementById("authSubmitBtn")?.addEventListener("click", async () => {
      const name = document.getElementById("authName")?.value || "";
      const studentId = document.getElementById("authStudentId")?.value || "";
      const tipEl = document.getElementById("authTip");
      const result = await registerOrLogin(name, studentId);
      if (!tipEl) return;

      if (result.success) {
        tipEl.textContent = result.message;
        tipEl.className = "auth-form-tip is-success";
        setTimeout(() => {
          closeAuthModal();
          onAuthStateChanged();
        }, 400);
      } else {
        tipEl.textContent = result.message;
        tipEl.className = "auth-form-tip is-error";
      }
    });

    document.getElementById("authSwitchBtn")?.addEventListener("click", () => {
      setAuthMode("login");
      logout();
    });

    document.getElementById("authStudentId")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        document.getElementById("authSubmitBtn")?.click();
      }
    });
  }

  function updateAuthModalUI() {
    const user = getCurrentUser();
    const loggedInPanel = document.getElementById("authLoggedInPanel");
    const loggedOutPanel = document.getElementById("authLoggedOutPanel");
    const titleEl = document.getElementById("authModalTitle");

    if (!loggedInPanel || !loggedOutPanel || !titleEl) return;

    if (user) {
      loggedInPanel.style.display = "";
      loggedOutPanel.style.display = "none";
      titleEl.textContent = "当前账号";
      const currentName = document.getElementById("authCurrentName");
      const currentStudentId = document.getElementById("authCurrentStudentId");
      if (currentName) currentName.textContent = user.name;
      if (currentStudentId) currentStudentId.textContent = `学号：${user.studentId}`;
    } else {
      loggedInPanel.style.display = "none";
      loggedOutPanel.style.display = "";
      titleEl.textContent = "登录/注册";
      const authName = document.getElementById("authName");
      const authStudentId = document.getElementById("authStudentId");
      const tipEl = document.getElementById("authTip");
      const modeTipEl = document.getElementById("authModeTip");
      if (authName) authName.value = "";
      if (authStudentId) authStudentId.value = "";
      if (modeTipEl) {
        modeTipEl.textContent = "未注册的账号将自动注册";
        modeTipEl.className = "auth-form-tip";
      }
      const submitBtn = document.getElementById("authSubmitBtn");
      if (submitBtn) submitBtn.textContent = "登录/注册";
      if (tipEl) {
        tipEl.textContent = "";
        tipEl.className = "auth-form-tip";
      }
    }
  }

  function openAuthModal(mode = "login") {
    setAuthMode(mode);
    createAuthModal();
    updateAuthModalUI();
    if (authModalOverlay) {
      authModalOverlay.classList.remove("is-hidden");
      requestAnimationFrame(() => {
        authModalOverlay.classList.add("is-visible");
      });
    }
  }

  function closeAuthModal() {
    if (authModalOverlay) {
      authModalOverlay.classList.remove("is-visible");
      setTimeout(() => {
        authModalOverlay.classList.add("is-hidden");
      }, 200);
    }
  }

  function onAuthStateChanged() {
    const user = getCurrentUser();
    const displayName = user ? user.name : "";

    if (typeof currentUserName !== "undefined") {
      // eslint-disable-next-line no-global-assign
      currentUserName = displayName;
    }

    if (typeof window.setCurrentUser === "function") {
      window.setCurrentUser(displayName);
    }

    updateAuthFloatingButton();
    broadcastAuthState();

    window.dispatchEvent(
      new CustomEvent("village-auth-change", {
        detail: { user, displayName, isLoggedIn: !!user }
      })
    );
  }

  function updateAuthFloatingButton() {
    const btn = document.getElementById("authLoginBtn");
    if (!btn) return;
    btn.style.display = "none";
    btn.innerHTML = "";
    btn.title = "点击登录账号";
  }

  function broadcastAuthState() {
    const user = getCurrentUser();
    const frame = document.getElementById("homeLandingFrame");
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage(
          {
            type: "village-auth-state",
            payload: {
              isLoggedIn: !!user,
              name: user?.name || "",
              studentId: user?.studentId || "",
              gender: user?.gender || "",
              className: user?.className || "",
              grade: user?.grade || ""
            }
          },
          "*"
        );
      } catch (_) {
        // ignore
      }
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "village-auth-request") {
      broadcastAuthState();
      if (!hasHandledInitialAuthRequest) {
        hasHandledInitialAuthRequest = true;
        return;
      }
      openAuthModal(event.data?.mode === "register" ? "register" : "login");
    }
    if (event.data?.type === "village-auth-logout") {
      logout();
    }
  });

  function ensureDefaultAdmin() {
    const users = loadAuthUsers();
    const hasAdmin = users.some((u) => u.name === "管理员" && u.studentId === "332");
    if (!hasAdmin) {
      const adminUser = {
        name: "管理员",
        studentId: "332",
        createdAt: new Date().toISOString()
      };
      users.push(adminUser);
      saveAuthUsers(users);
      upsertAuthUserToRemote(adminUser).catch(() => {});
    }
  }

  window.VillageAuth = {
    registerOrLogin,
    getCurrentUser,
    getCurrentDisplayName,
    isLoggedIn,
    logout,
    deleteCurrentUser,
    updateCurrentUserProfile,
    openAuthModal,
    closeAuthModal,
    onAuthStateChanged,
    updateAuthFloatingButton,
    broadcastAuthState,
    loadAuthUsers
  };

  clearLegacyIdentityData();
  ensureDefaultAdmin();

  async function syncAllLocalUsersToRemote() {
    const users = loadAuthUsers();
    if (!supabaseClient || users.length === 0) return;
    for (const user of users) {
      await upsertAuthUserToRemote(user);
    }
  }

  (async function syncOnLoad() {
    const session = loadAuthSession();
    if (session) {
      const valid = await validateCurrentSession();
      if (!valid) {
        saveAuthSession(null);
        syncLegacyActiveUser("");
        if (typeof window.showToast === "function") {
          window.showToast("您的账号已在其他地方登录，您已被退出。", "error");
        }
      } else {
        const user = findUserByName(session.name);
        if (user) {
          syncLegacyActiveUser(user.name);
          setTimeout(onAuthStateChanged, 0);
          // 兼容老用户：如果没有 token，生成一个并保存
          if (!session.token) {
            session.token = generateSessionToken();
            saveAuthSession(session);
          }
          // 同步当前用户到远端
          await upsertAuthUserToRemote(user);
          // 把本地所有用户都批量同步到远端（解决其他电脑上的用户看不到的问题）
          await syncAllLocalUsersToRemote();
          // 同步会话并启动 Realtime 监听
          await upsertUserSessionToRemote(session.name, session.token);
          initSessionRealtimeListener();
        } else {
          saveAuthSession(null);
          syncLegacyActiveUser("");
        }
      }
    } else {
      // 即使没有登录，也尝试把本地用户列表同步到远端（后台管理需要看到全部）
      await syncAllLocalUsersToRemote();
    }
    updateAuthFloatingButton();
  })();
})();
