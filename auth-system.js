(function () {
  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
  const USER_CACHE_KEY = "village_supabase_auth_user_v1";
  const MIGRATION_KEY = "village_supabase_auth_migrated_v1";
  const LEGACY_KEYS = [
    "village_planning_auth_users_v1",
    "village_planning_auth_session_v1",
    "village_planning_auth_users_v2",
    "village_planning_auth_session_v2",
    "village_planning_users_v1",
    "village_planning_active_user_v1"
  ];

  const model = window.SupabaseAuthModel;
  const supabaseClient =
    window.VillageSupabaseClient ||
    (typeof supabase !== "undefined"
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
            storageKey: "village-storymap-supabase-auth-v1",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        })
      : null);

  if (supabaseClient) window.VillageSupabaseClient = supabaseClient;

  let currentUser = loadCachedUser();
  let authModalOverlay = null;
  let authMode = "login";
  let hasHandledInitialAuthRequest = false;
  let authOperationPending = false;
  let authReadyResolve;
  const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
  });

  function loadCachedUser() {
    try {
      const parsed = JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null");
      return parsed && parsed.authUserId && parsed.studentId ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function cacheUser(user) {
    try {
      if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_CACHE_KEY);
    } catch (_) {
      // Local storage is only a display cache; Supabase remains authoritative.
    }
  }

  function expireLegacyIdentityOnce() {
    try {
      if (localStorage.getItem(MIGRATION_KEY) === "done") return;
      LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem(MIGRATION_KEY, "done");
    } catch (_) {
      // ignore
    }
  }

  function getCurrentUser() {
    return currentUser;
  }

  function getCurrentDisplayName() {
    return currentUser?.name || "";
  }

  function isLoggedIn() {
    return !!currentUser;
  }

  function setCurrentUser(user, notify = true) {
    currentUser = user || null;
    cacheUser(currentUser);
    if (notify) notifyAuthStateChanged();
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function loadProfile(authUser, retryCount = 3) {
    if (!supabaseClient || !authUser?.id) return null;
    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, student_id, display_name, role, gender, class_name, grade")
        .eq("id", authUser.id)
        .maybeSingle();
      if (!error && data) return model.profileToLegacyUser(authUser, data);
      lastError = error;
      if (attempt < retryCount) await delay(160 * (attempt + 1));
    }
    if (lastError) console.warn("读取登录资料失败：", lastError.message || lastError);
    return null;
  }

  function translateAuthError(error, fallback) {
    const text = String(error?.message || "").toLowerCase();
    if (text.includes("invalid login credentials")) return "学号或密码不正确";
    if (text.includes("user already registered")) return "该学号已注册，请直接登录";
    if (text.includes("email not confirmed")) return "账号尚未启用，请联系教师处理";
    if (text.includes("password")) return "密码不符合要求，请至少使用 8 位字符";
    if (text.includes("rate limit")) return "操作过于频繁，请稍后再试";
    return fallback || error?.message || "认证服务暂时不可用";
  }

  function validateNameAndStudentId(name, studentId) {
    try {
      return {
        success: true,
        name: model.normalizeDisplayName(name),
        studentId: model.normalizeStudentId(studentId)
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async function register(name, studentId, password, profileDetails = {}) {
    if (!supabaseClient || !model) return { success: false, message: "认证服务未加载，请刷新页面" };
    const identity = validateNameAndStudentId(name, studentId);
    if (!identity.success) return identity;
    const passwordResult = model.validatePassword(password);
    if (!passwordResult.valid) return { success: false, message: passwordResult.message };

    const email = model.buildSyntheticEmail(identity.studentId);
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: identity.name,
          student_id: identity.studentId,
          gender: String(profileDetails.gender || "").trim().slice(0, 12),
          class_name: String(profileDetails.className || profileDetails.class_name || "").trim().slice(0, 30),
          grade: String(profileDetails.grade || "").trim().slice(0, 20)
        }
      }
    });

    if (error) return { success: false, message: translateAuthError(error, "注册失败") };
    if (!data?.session) {
      return {
        success: false,
        message: "账号已创建，但 Supabase 仍要求邮箱确认。请让管理员在 Auth 设置中关闭 Confirm email 后再登录。"
      };
    }

    const user = await loadProfile(data.user);
    if (!user) return { success: false, message: "账号已创建，但用户资料尚未就绪，请稍后重新登录" };
    setCurrentUser(user);
    return { success: true, message: "注册并登录成功", user, isNew: true };
  }

  async function login(studentId, password) {
    if (!supabaseClient || !model) return { success: false, message: "认证服务未加载，请刷新页面" };
    let normalizedStudentId;
    try {
      normalizedStudentId = model.normalizeStudentId(studentId);
    } catch (error) {
      return { success: false, message: error.message };
    }
    const passwordResult = model.validatePassword(password);
    if (!passwordResult.valid) return { success: false, message: passwordResult.message };

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: model.buildSyntheticEmail(normalizedStudentId),
      password
    });
    if (error) return { success: false, message: translateAuthError(error, "登录失败") };

    const user = await loadProfile(data.user);
    if (!user) {
      await supabaseClient.auth.signOut();
      return { success: false, message: "未找到该账号的用户资料，请联系管理员" };
    }
    setCurrentUser(user);
    return { success: true, message: "登录成功", user, isNew: false };
  }

  function registerOrLogin(name, studentId, password, profileDetails = {}) {
    return authMode === "register"
      ? register(name, studentId, password, profileDetails)
      : login(studentId, password);
  }

  async function logout() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    setCurrentUser(null);
    updateAuthModalUI();
    return { success: true, message: "已退出登录" };
  }

  async function updateCurrentUserProfile(profileDetails = {}) {
    if (!supabaseClient || !currentUser) return { success: false, message: "请先登录" };
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(profileDetails, "name")) {
      try {
        payload.display_name = model.normalizeDisplayName(profileDetails.name);
      } catch (error) {
        return { success: false, message: error.message };
      }
    }
    if (Object.prototype.hasOwnProperty.call(profileDetails, "gender")) {
      payload.gender = String(profileDetails.gender || "").trim().slice(0, 12);
    }
    if (Object.prototype.hasOwnProperty.call(profileDetails, "className")) {
      payload.class_name = String(profileDetails.className || "").trim().slice(0, 30);
    }
    if (Object.prototype.hasOwnProperty.call(profileDetails, "grade")) {
      payload.grade = String(profileDetails.grade || "").trim().slice(0, 20);
    }
    if (!Object.keys(payload).length) return { success: true, message: "资料无变化", user: currentUser };

    const { error } = await supabaseClient.from("profiles").update(payload).eq("id", currentUser.authUserId);
    if (error) return { success: false, message: "资料保存失败，请稍后重试" };
    const { data } = await supabaseClient.auth.getUser();
    const user = await loadProfile(data?.user);
    if (user) setCurrentUser(user);
    return { success: true, message: "资料已保存", user: user || currentUser };
  }

  async function deleteCurrentUser() {
    return { success: false, message: "为避免误删课程记录，请联系管理员注销账号" };
  }

  function loadAuthUsers() {
    return currentUser ? [currentUser] : [];
  }

  function setAuthMode(mode) {
    authMode = mode === "register" ? "register" : "login";
    updateAuthModalUI();
  }

  function createAuthModal() {
    if (document.getElementById("authModalOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "authModalOverlay";
    overlay.className = "auth-modal-overlay is-hidden";
    overlay.innerHTML = `
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
        <div class="auth-modal-header">
          <h3 class="auth-modal-title" id="authModalTitle">账号登录</h3>
          <button type="button" class="auth-modal-close" id="authModalClose" title="关闭">×</button>
        </div>
        <div class="auth-modal-body">
          <div id="authLoggedInPanel" style="display:none;">
            <div class="auth-user-card">
              <div class="auth-user-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <div><div class="auth-user-name" id="authCurrentName">--</div><div class="auth-user-id" id="authCurrentStudentId">--</div></div>
            </div>
            <div class="auth-actions-row"><button type="button" class="auth-btn auth-btn-secondary" id="authSwitchBtn">切换账号</button></div>
          </div>
          <div id="authLoggedOutPanel">
            <div class="auth-tabs" role="tablist">
              <button type="button" class="auth-tab" id="authLoginTab">登录</button>
              <button type="button" class="auth-tab" id="authRegisterTab">注册</button>
            </div>
            <form id="authForm">
              <div class="auth-form-group" id="authNameGroup">
                <label class="auth-form-label" for="authName">姓名</label>
                <input type="text" id="authName" class="auth-form-input" placeholder="请输入真实姓名" maxlength="20" autocomplete="name">
              </div>
              <div class="auth-form-group">
                <label class="auth-form-label" for="authStudentId">学号</label>
                <input type="text" id="authStudentId" class="auth-form-input" placeholder="请输入学号" maxlength="32" autocomplete="username">
              </div>
              <div class="auth-form-group">
                <label class="auth-form-label" for="authPassword">密码</label>
                <input type="password" id="authPassword" class="auth-form-input" placeholder="至少 8 位" maxlength="72" autocomplete="current-password">
              </div>
              <div class="auth-form-group" id="authPasswordConfirmGroup">
                <label class="auth-form-label" for="authPasswordConfirm">确认密码</label>
                <input type="password" id="authPasswordConfirm" class="auth-form-input" placeholder="请再次输入密码" maxlength="72" autocomplete="new-password">
              </div>
              <div class="auth-form-tip" id="authModeTip"></div>
              <div class="auth-form-tip" id="authTip" role="status"></div>
              <button type="submit" class="auth-btn auth-btn-primary" id="authSubmitBtn" style="width:100%;">登录</button>
            </form>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    authModalOverlay = overlay;
    bindAuthModalEvents();
  }

  function bindAuthModalEvents() {
    document.getElementById("authModalClose")?.addEventListener("click", closeAuthModal);
    document.getElementById("authLoginTab")?.addEventListener("click", () => setAuthMode("login"));
    document.getElementById("authRegisterTab")?.addEventListener("click", () => setAuthMode("register"));
    document.getElementById("authSwitchBtn")?.addEventListener("click", async () => {
      await logout();
      setAuthMode("login");
    });
    authModalOverlay?.addEventListener("click", (event) => {
      if (event.target === authModalOverlay) closeAuthModal();
    });
    document.getElementById("authForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (authOperationPending) return;
      const name = document.getElementById("authName")?.value || "";
      const studentId = document.getElementById("authStudentId")?.value || "";
      const password = document.getElementById("authPassword")?.value || "";
      const passwordConfirm = document.getElementById("authPasswordConfirm")?.value || "";
      const tip = document.getElementById("authTip");
      const submit = document.getElementById("authSubmitBtn");
      if (authMode === "register" && password !== passwordConfirm) {
        if (tip) { tip.textContent = "两次输入的密码不一致"; tip.className = "auth-form-tip is-error"; }
        return;
      }
      authOperationPending = true;
      if (submit) { submit.disabled = true; submit.textContent = "请稍候…"; }
      const result = await registerOrLogin(name, studentId, password);
      authOperationPending = false;
      if (submit) submit.disabled = false;
      if (tip) {
        tip.textContent = result.message;
        tip.className = `auth-form-tip ${result.success ? "is-success" : "is-error"}`;
      }
      updateAuthModalUI(false);
      if (result.success) setTimeout(closeAuthModal, 450);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && authModalOverlay?.classList.contains("is-visible")) closeAuthModal();
    });
  }

  function updateAuthModalUI(clearInputs = true) {
    const loggedInPanel = document.getElementById("authLoggedInPanel");
    const loggedOutPanel = document.getElementById("authLoggedOutPanel");
    if (!loggedInPanel || !loggedOutPanel) return;
    const title = document.getElementById("authModalTitle");
    if (currentUser) {
      loggedInPanel.style.display = "";
      loggedOutPanel.style.display = "none";
      if (title) title.textContent = "当前账号";
      const name = document.getElementById("authCurrentName");
      const id = document.getElementById("authCurrentStudentId");
      if (name) name.textContent = currentUser.name;
      if (id) id.textContent = `学号：${currentUser.studentId} · ${roleLabel(currentUser.role)}`;
      return;
    }

    loggedInPanel.style.display = "none";
    loggedOutPanel.style.display = "";
    const isRegister = authMode === "register";
    if (title) title.textContent = isRegister ? "注册课程账号" : "账号登录";
    document.getElementById("authNameGroup").style.display = isRegister ? "" : "none";
    document.getElementById("authPasswordConfirmGroup").style.display = isRegister ? "" : "none";
    document.getElementById("authLoginTab")?.classList.toggle("is-active", !isRegister);
    document.getElementById("authRegisterTab")?.classList.toggle("is-active", isRegister);
    const password = document.getElementById("authPassword");
    if (password) password.autocomplete = isRegister ? "new-password" : "current-password";
    const submit = document.getElementById("authSubmitBtn");
    if (submit && !authOperationPending) submit.textContent = isRegister ? "注册并登录" : "登录";
    const modeTip = document.getElementById("authModeTip");
    if (modeTip) modeTip.textContent = isRegister ? "每位同学使用自己的姓名、学号和密码注册。" : "使用注册时的学号和密码登录。";
    if (clearInputs) {
      ["authName", "authStudentId", "authPassword", "authPasswordConfirm"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      const tip = document.getElementById("authTip");
      if (tip) { tip.textContent = ""; tip.className = "auth-form-tip"; }
    }
  }

  function roleLabel(role) {
    if (role === "admin") return "管理员";
    if (role === "teacher") return "教师";
    return "学生";
  }

  function openAuthModal(mode = "login") {
    authMode = mode === "register" ? "register" : "login";
    createAuthModal();
    updateAuthModalUI();
    authModalOverlay.classList.remove("is-hidden");
    requestAnimationFrame(() => authModalOverlay.classList.add("is-visible"));
  }

  function closeAuthModal() {
    if (!authModalOverlay) return;
    authModalOverlay.classList.remove("is-visible");
    setTimeout(() => authModalOverlay?.classList.add("is-hidden"), 200);
  }

  function updateAuthFloatingButton() {
    const button = document.getElementById("authLoginBtn");
    if (!button) return;
    button.style.display = "none";
    button.innerHTML = "";
  }

  function broadcastAuthState() {
    const frame = document.getElementById("homeLandingFrame");
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: "village-auth-state",
        payload: {
          isLoggedIn: !!currentUser,
          name: currentUser?.name || "",
          studentId: currentUser?.studentId || "",
          role: currentUser?.role || "",
          gender: currentUser?.gender || "",
          className: currentUser?.className || "",
          grade: currentUser?.grade || ""
        }
      },
      "*"
    );
  }

  function notifyAuthStateChanged() {
    const displayName = currentUser?.name || "";
    if (typeof currentUserName !== "undefined") currentUserName = displayName;
    if (typeof window.setCurrentUser === "function") window.setCurrentUser(displayName);
    updateAuthFloatingButton();
    broadcastAuthState();
    window.dispatchEvent(new CustomEvent("village-auth-change", {
      detail: { user: currentUser, displayName, isLoggedIn: !!currentUser }
    }));
  }

  function onAuthStateChanged() {
    notifyAuthStateChanged();
  }

  async function refreshCurrentUser() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getUser();
    if (!data?.user) {
      setCurrentUser(null);
      return null;
    }
    const user = await loadProfile(data.user);
    setCurrentUser(user);
    return user;
  }

  window.addEventListener("message", (event) => {
    if (event.data?.type === "village-auth-request") {
      broadcastAuthState();
      if (!hasHandledInitialAuthRequest) {
        hasHandledInitialAuthRequest = true;
        return;
      }
      openAuthModal(event.data?.mode === "register" ? "register" : "login");
    } else if (event.data?.type === "village-auth-logout") {
      logout();
    }
  });

  window.VillageAuth = {
    register,
    login,
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
    loadAuthUsers,
    refreshCurrentUser,
    getSupabaseClient: () => supabaseClient,
    ready: authReady
  };

  expireLegacyIdentityOnce();

  (async function initializeAuth() {
    if (!supabaseClient || !model) {
      setCurrentUser(null);
      authReadyResolve(null);
      return;
    }
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) {
        setCurrentUser(null);
        return;
      }
      const user = await loadProfile(session.user);
      if (user) setCurrentUser(user);
    });
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session?.user) {
      const user = await loadProfile(data.session.user);
      setCurrentUser(user);
    } else {
      setCurrentUser(null);
    }
    authReadyResolve(currentUser);
  })();
})();
