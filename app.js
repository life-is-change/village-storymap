const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";
const OBJECT_EDITS_TABLE = "object_attribute_edits";
const OBJECT_COMMENTS_TABLE = "object_comments";
const COMMUNITY_TASKS_TABLE = "community_tasks";
const TASK_VERIFICATIONS_TABLE = "task_verifications";
const POINTS_LEDGER_TABLE = "points_ledger";
const USER_STATS_TABLE = "user_stats";

const PLANNING_FEATURES_TABLE = "planning_features";
const ROAD_DEFAULT_WIDTH = 4;
const EDITABLE_GEOMETRY_LAYERS = ["building", "road", "cropland", "openSpace"];
const LAYER_CODE_PREFIX = {
  building: "H",
  road: "R",
  cropland: "F",
  openSpace: "S"
};
const LAYER_CODE_FIELD = {
  building: "房屋编码",
  road: "道路编码",
  cropland: "农田编码",
  openSpace: "公共空间编码"
};
const LAYER_NAME_FIELD = {
  building: "房屋名称",
  road: "道路名称",
  cropland: "农田名称",
  openSpace: "公共空间名称"
};

const buildingEditState = {
  mode: "idle",
  draw: null,
  modify: null,
  snap: null,
  translate: null,
  dirtyCodes: new Set(),
  deletedCodes: new Set(),
  pendingDeletedFeatures: [],
  pendingAddedFeatures: [],
  originalGeoms: new Map(),
  isDrawingActive: false,
  editLayerKey: "building",
  nextBuildingSerial: null,
  nextBuildingSerialPromise: null
};

const EDITABLE_FIELDS_BY_LAYER = {
  building: [
    { key: "房屋编码", label: "房屋编码", type: "text" },
    { key: "户主信息", label: "户主信息", type: "text" },
    { key: "建成年代", label: "建成年代", type: "text" },
    { key: "房屋结构信息", label: "房屋结构", type: "text" },
    { key: "占地面积", label: "占地面积", type: "number", suffix: "㎡" },
    { key: "建筑高度", label: "建筑高度", type: "number", suffix: "m" }
  ],
  road: [
    { key: "道路编码", label: "道路编码", type: "text" },
    { key: "道路名称", label: "道路名称", type: "text" },
    { key: "道路类型", label: "道路类型", type: "text" },
    { key: "道路宽度", label: "道路宽度", type: "number", suffix: "m" },
    { key: "路面材质", label: "路面材质", type: "text" }
  ],
  cropland: [
    { key: "农田编码", label: "农田编码", type: "text" },
    { key: "农田名称", label: "农田名称", type: "text" },
    { key: "用地类型", label: "用地类型", type: "text" },
    { key: "面积", label: "面积", type: "number", suffix: "㎡" },
    { key: "种植情况", label: "种植情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ],
  openSpace: [
    { key: "公共空间编码", label: "公共空间编码", type: "text" },
    { key: "公共空间名称", label: "公共空间名称", type: "text" },
    { key: "空间类型", label: "空间类型", type: "text" },
    { key: "面积", label: "面积", type: "number", suffix: "㎡" },
    { key: "设施情况", label: "设施情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ],
  water: [
    { key: "水体编码", label: "水体编码", type: "text" },
    { key: "水体名称", label: "水体名称", type: "text" },
    { key: "水体类型", label: "水体类型", type: "text" },
    { key: "面积", label: "面积", type: "number", suffix: "㎡" },
    { key: "水质情况", label: "水质情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ]
};

const BASE_SPACE_ID = "current";
const SPACE_STORAGE_KEY = "village_planning_spaces_v2"; // 升级版本号以兼容新字段
const USER_STORAGE_KEY = "village_planning_users_v1";
const ACTIVE_USER_STORAGE_KEY = "village_planning_active_user_v1";

const mainLayout = document.getElementById("mainLayout");
const map2dEl = document.getElementById("map2d");
const infoPanel = document.getElementById("infoPanel");
const statusBadge = document.getElementById("statusBadge");
const userGreetingBadge = document.getElementById("userGreetingBadge");
const detailSubtitle = document.getElementById("detailSubtitle");
const storyItems = document.querySelectorAll(".story-item");

const overviewView = document.getElementById("overviewView");
const plan2dView = document.getElementById("plan2dView");
const model3dView = document.getElementById("model3dView");

const spaceList = document.getElementById("spaceList");
const addSpaceBtn = document.getElementById("addSpaceBtn");

const basemapToggle = document.getElementById("basemapToggle");
const basemapToggleWrap = document.getElementById("basemapToggleWrap");

const BASEMAP_LABEL_VISIBLE_KEY = "village_planning_basemap_label_visible_v1";
let basemapLabelToggle = null;

const supabaseClient =
  typeof supabase !== "undefined" &&
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("你的项目ref") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("publishable key")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

let planMap = null;
let planVectorSource = null;
let planVectorLayer = null;
let planOnlineLayer = null;
let planLabelLayer = null;
let planHighResLayer = null;
let planDrawInteraction = null;
let activeFeature = null;
let hoverFeature = null;
let olReady = null;
let resizeObserver = null;
let resizeOverlayRaf = 0;
let hoverCheckRaf = 0;
let pendingHoverPixel = null;

const layerDataCache = {};
const buildingDbRowsCache = new Map();
const buildingDbHasAnyCache = new Map();
const roadDbRowsCache = new Map();
const roadDbHasAnyCache = new Map();
const croplandDbRowsCache = new Map();
const croplandDbHasAnyCache = new Map();
const openSpaceDbRowsCache = new Map();
const openSpaceDbHasAnyCache = new Map();
let currentSelectedObject = null;
let currentInfoMode = "readonly";

let spaces = [];
let currentSpaceId = BASE_SPACE_ID;
let userProfiles = [];
let currentUserName = "";
let commentedFeatureKeys = new Set();
let commentsTableReady = true;
let currentGeometryEditLayer = "building";
let communityGameTablesReady = true;
const communityTasksCache = new Map();
const communityTaskEditState = {
  mode: "idle"
};

// 统一侧边栏展开状态（默认展开，空间列表常驻显示）
let isSpaceSidebarExpanded = true;
let isToolboxExpanded = false;
let isSpaceOptionsExpanded = true;
window.isSpaceSidebarExpanded = isSpaceSidebarExpanded;

const layerConfigs = {
  building: {
    label: "建筑",
    objectType: "building",
    geojsonUrl: "data/buildings.geojson",
    tableUrl: "data/houses.csv",
    codeFields: ["房屋编码", "编码", "CODE", "code", "Code", "ID", "id"],
    nameFields: ["房屋名称", "名称", "name", "NAME"],
    photoFields: ["照片", "图片", "photo", "PHOTO"]
  },
  road: {
    label: "道路",
    objectType: "road",
    geojsonUrl: "data/roads.geojson",
    tableUrl: "data/roads.csv",
    codeFields: ["道路编码", "编码", "NAME", "Name", "name", "CODE", "code", "Code", "ID", "id", "閬撹矾缂栵拷"],
    nameFields: ["道路名称", "名称", "name", "NAME"],
    photoFields: []
  },
  cropland: {
    label: "农田",
    objectType: "cropland",
    geojsonUrl: "data/croplands.geojson",
    tableUrl: "data/croplands.csv",
    codeFields: ["农田编码", "编码", "CODE", "code", "Code", "ID", "id"],
    nameFields: ["农田名称", "名称", "name", "NAME"],
    photoFields: ["照片", "图片", "photo", "PHOTO"]
  },
  openSpace: {
    label: "公共空间",
    objectType: "open_space",
    geojsonUrl: "data/open_spaces.geojson",
    tableUrl: "data/open_spaces.csv",
    codeFields: ["公共空间编码", "编码", "CODE", "code", "Code", "ID", "id"],
    nameFields: ["公共空间名称", "名称", "name", "NAME"],
    photoFields: ["照片", "图片", "photo", "PHOTO"]
  },
  water: {
    label: "水体",
    objectType: "water",
    geojsonUrl: "data/water.geojson",
    tableUrl: "data/water.csv",
    codeFields: ["水体编码", "编码", "CODE", "code", "Code", "ID", "id"],
    nameFields: ["水体名称", "名称", "name", "NAME"],
    photoFields: ["照片", "图片", "photo", "PHOTO"]
  },
  
  contours: {
    label: "等高线",
    objectType: "contours",
    geojsonUrl: "data/contours_smooth.geojson",
    tableUrl: null,
    codeFields: ["id", "ID", "elev", "ELEV", "Contour", "CONTOUR"],
    nameFields: ["name", "NAME", "elev", "ELEV", "Contour", "CONTOUR"],
    photoFields: []
  },
  elevationBands: {
    label: "高程分带",
    objectType: null,
    geojsonUrl: "data/elevation_bands_smooth.geojson",
    tableUrl: null,
    codeFields: ["ELEV_MIN", "elev_min", "min"],
    nameFields: ["ELEV_MIN", "elev_min", "min"],
    photoFields: []
  },

  figureGround: {
    label: "图底关系",
    objectType: "figure_ground",
    geojsonUrl: null,
    tableUrl: null,
    codeFields: [],
    nameFields: [],
    photoFields: []
  }
};

const BASEMAP_GEOREF = {
  imageUrl: "assets/orthophoto.png",
  minX: 113.65670800209045,
  minY: 23.67331624031067,
  maxX: 113.66360664367676,
  maxY: 23.67930293083191,
  crs: "EPSG:4326"
};
let activeBasemapGeoref = { ...BASEMAP_GEOREF };
let basemapGeorefResolvePromise = null;
window.__BASEMAP_GEOREF = { ...activeBasemapGeoref };

const HIGHRES_SWITCH_ZOOM = 17.2;
const TDT_TOKEN = "a2a034ff8616a35957abf8951339fedb";
const VILLAGE_FILL_LAYER_KEY = "__village_fill";
const VILLAGE_FILL_COLOR = "rgba(220, 226, 218, 0.46)";

function getWorldFileUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return "";
  return imageUrl.replace(/\.[^.]+$/i, ".pgw");
}

function loadImageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`无法读取底图尺寸：${url}`));
    img.src = url;
  });
}

async function tryResolveBasemapGeorefFromWorldFile(imageUrl) {
  const worldUrl = getWorldFileUrl(imageUrl);
  if (!worldUrl) return null;

  try {
    const [worldText, size] = await Promise.all([
      fetch(worldUrl, { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error(`读取 world file 失败：${worldUrl}`);
        return res.text();
      }),
      loadImageSize(imageUrl)
    ]);

    const rows = worldText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (rows.length < 6) {
      throw new Error("world file 行数不足（需 6 行）");
    }

    const A = Number(rows[0]); // pixel size X
    const D = Number(rows[1]); // rotation Y
    const B = Number(rows[2]); // rotation X
    const E = Number(rows[3]); // pixel size Y (usually negative)
    const C = Number(rows[4]); // center X of upper-left pixel
    const F = Number(rows[5]); // center Y of upper-left pixel

    if (![A, B, C, D, E, F].every((v) => Number.isFinite(v))) {
      throw new Error("world file 存在非数字参数");
    }

    if (Math.abs(B) > 1e-12 || Math.abs(D) > 1e-12) {
      console.warn("检测到旋转 world file（B/D 非 0），当前仅支持无旋转，已回退固定范围。");
      return null;
    }

    const minX = C - A / 2;
    const maxY = F - E / 2;
    const maxX = minX + A * size.width;
    const minY = maxY + E * size.height;

    return {
      imageUrl,
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      crs: "EPSG:4326"
    };
  } catch (error) {
    console.warn("读取 orthophoto.pgw 失败，已回退固定范围：", error);
    return null;
  }
}

async function resolveBasemapGeoref() {
  if (!basemapGeorefResolvePromise) {
    basemapGeorefResolvePromise = (async () => {
      const resolved = await tryResolveBasemapGeorefFromWorldFile(BASEMAP_GEOREF.imageUrl);
      activeBasemapGeoref = resolved || { ...BASEMAP_GEOREF };
      window.__BASEMAP_GEOREF = { ...activeBasemapGeoref };
      return activeBasemapGeoref;
    })();
  }
  return basemapGeorefResolvePromise;
}

function loadBasemapLabelVisible() {
  try {
    return localStorage.getItem(BASEMAP_LABEL_VISIBLE_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function saveBasemapLabelVisible(value) {
  try {
    localStorage.setItem(BASEMAP_LABEL_VISIBLE_KEY, value ? "1" : "0");
  } catch (error) {
    console.warn("保存地名开关状态失败：", error);
  }
}

function getDefaultSpaces() {
  return [
    {
      id: BASE_SPACE_ID,
      title: "现状空间",
      readonly: true,
      editEnabled: false,
      expanded: true,
      selectedLayers: ["figureGround"],
      basemapVisible: false,
      viewMode: "2d"
    }
  ];
}

function loadSpacesFromStorage() {
  try {
    const raw = localStorage.getItem(SPACE_STORAGE_KEY);
    if (!raw) return getDefaultSpaces();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return getDefaultSpaces();

    const hasBase = parsed.some((s) => s.id === BASE_SPACE_ID);
    if (!hasBase) {
      parsed.unshift({
        id: BASE_SPACE_ID,
        title: "现状空间",
        readonly: true,
        editEnabled: false,
        expanded: true,
        selectedLayers: ["figureGround"],
        basemapVisible: false,
        viewMode: "2d"
      });
    }

    return parsed.map((s) => {
      const rawTitle = String(s?.title || "");
      const normalizedTitle =
        s.id === BASE_SPACE_ID
          ? "现状空间"
          : (!rawTitle || /^规划空间\s*\d*$/.test(rawTitle))
            ? "规划空间"
            : rawTitle;

      return {
      id: s.id,
      title: normalizedTitle,
      readonly: s.id === BASE_SPACE_ID ? true : !!s.readonly,
      editEnabled: s.id === BASE_SPACE_ID ? !!s.editEnabled : true,
      expanded: typeof s.expanded === "boolean" ? s.expanded : true,
      selectedLayers: Array.isArray(s.selectedLayers)
        ? s.selectedLayers
        : (s.id === BASE_SPACE_ID ? ["figureGround"] : ["building"]),
      basemapVisible: !!s.basemapVisible,
      viewMode: s.viewMode || "2d"
    };
    });
  } catch (error) {
    console.warn("读取空间配置失败，已回退默认值：", error);
    return getDefaultSpaces();
  }
}

function saveSpacesToStorage() {
  try {
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(spaces));
  } catch (error) {
    console.warn("保存空间配置失败：", error);
  }
}

function getDefaultUsers() {
  return ["管理员"];
}

function loadUsersFromStorage() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return getDefaultUsers();

    const parsed = JSON.parse(raw);
    const next = Array.isArray(parsed)
      ? parsed
          .map((name) => String(name || "").trim())
          .filter((name) => name.length > 0)
      : [];

    if (!next.length) return getDefaultUsers();
    if (!next.includes("管理员")) next.unshift("管理员");
    return Array.from(new Set(next));
  } catch (error) {
    console.warn("读取身份列表失败，已使用默认身份：", error);
    return getDefaultUsers();
  }
}

function saveUsersToStorage() {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfiles));
  } catch (error) {
    console.warn("保存身份列表失败：", error);
  }
}

function loadActiveUserFromStorage() {
  try {
    return String(localStorage.getItem(ACTIVE_USER_STORAGE_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

function saveActiveUserToStorage(name) {
  try {
    if (!name) {
      localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_USER_STORAGE_KEY, name);
    }
  } catch (error) {
    console.warn("保存当前身份失败：", error);
  }
}

function updateUserGreeting(viewKey = null) {
  if (!userGreetingBadge) return;

  const activeView =
    viewKey ||
    (overviewView?.classList.contains("active")
      ? "overview"
      : model3dView?.classList.contains("active")
        ? "model3d"
        : "plan2d");

  if (!currentUserName || activeView === "overview") {
    userGreetingBadge.textContent = "";
    userGreetingBadge.style.display = "none";
    return;
  }

  userGreetingBadge.textContent = `你好，${currentUserName}`;
  userGreetingBadge.style.display = "";
}

function setCurrentUser(name) {
  const nextName = String(name || "").trim();
  currentUserName = nextName;
  saveActiveUserToStorage(nextName);
  updateUserGreeting();
  const identityCurrentText = document.getElementById("identityCurrentText");
  if (identityCurrentText) {
    identityCurrentText.textContent = `当前身份：${nextName || "未选择"}`;
  }
  refreshCommunityScoreBadge();
}

function shouldShowVillageFillForCurrentSpace() {
  const currentSpace = getCurrentSpace();
  const selectedLayers = Array.isArray(currentSpace?.selectedLayers) ? currentSpace.selectedLayers : [];
  const isFigureGroundMode = selectedLayers.includes("figureGround");
  return !currentSpace?.basemapVisible || isFigureGroundMode;
}

function buildVillageFillRawFeature() {
  const georef = activeBasemapGeoref || BASEMAP_GEOREF;
  const minX = Number(georef?.minX);
  const minY = Number(georef?.minY);
  const maxX = Number(georef?.maxX);
  const maxY = Number(georef?.maxY);
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;

  return {
    type: "Feature",
    properties: {
      layerKey: VILLAGE_FILL_LAYER_KEY,
      sourceCode: "village-fill"
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY]
      ]]
    }
  };
}

function isNonInteractiveLayerKey(layerKey) {
  return layerKey === VILLAGE_FILL_LAYER_KEY || layerKey === "contours" || layerKey === "elevationBands";
}

function getUserOptionsHtml(selectedName = "") {
  return userProfiles
    .map((name) => {
      const selected = name === selectedName ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function bindIdentityPanelEvents() {
  const selectEl = document.getElementById("identitySelect");
  const confirmBtn = document.getElementById("confirmIdentityBtn");
  const createBtn = document.getElementById("createIdentityBtn");
  const deleteBtn = document.getElementById("deleteIdentityBtn");

  if (confirmBtn && selectEl && !confirmBtn.dataset.bound) {
    confirmBtn.dataset.bound = "1";
    confirmBtn.addEventListener("click", () => {
      const pickedName = String(selectEl.value || "").trim();
      if (!pickedName) {
        showToast("请先选择身份", "error");
        return;
      }
      setCurrentUser(pickedName);
      showToast(`已切换身份：${pickedName}`, "success");
    });
  }

  if (createBtn && selectEl && !createBtn.dataset.bound) {
    createBtn.dataset.bound = "1";
    createBtn.addEventListener("click", async () => {
      const newName = await customPrompt(
        "请输入新身份名称（1-20个字符）",
        "",
        "创建新身份",
        { maxLength: 20, required: true }
      );
      if (newName === null) return;

      const normalized = String(newName).trim();
      if (!normalized) {
        showToast("身份名称不能为空", "error");
        return;
      }

      if (userProfiles.includes(normalized)) {
        showToast("该身份已存在", "error");
        return;
      }

      userProfiles.push(normalized);
      saveUsersToStorage();
      setCurrentUser(normalized);

      selectEl.innerHTML = getUserOptionsHtml(normalized);
      selectEl.value = normalized;
      showToast(`身份创建成功：${normalized}`, "success");
    });
  }

  if (deleteBtn && selectEl && !deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = "1";
    deleteBtn.addEventListener("click", async () => {
      const selectedName = String(selectEl.value || "").trim();
      if (!selectedName) {
        showToast("请先选择要删除的身份", "error");
        return;
      }
      if (selectedName === "管理员") {
        showToast("默认身份“管理员”不可删除", "error");
        return;
      }

      const confirmed = await customConfirm(`确认删除身份“${selectedName}”吗？`, {
        title: "删除身份",
        okText: "删除",
        cancelText: "取消"
      });
      if (!confirmed) return;

      userProfiles = userProfiles.filter((name) => name !== selectedName);
      if (!userProfiles.includes("管理员")) userProfiles.unshift("管理员");
      saveUsersToStorage();

      const nextUser = currentUserName === selectedName ? "管理员" : currentUserName || "管理员";
      setCurrentUser(nextUser);
      selectEl.innerHTML = getUserOptionsHtml(nextUser);
      selectEl.value = nextUser;
      showToast(`已删除身份：${selectedName}`, "success");
    });
  }
}

function getCurrentSpace() {
  return spaces.find((s) => s.id === currentSpaceId) || spaces[0];
}

function getSpaceById(spaceId) {
  return spaces.find((s) => s.id === spaceId) || null;
}

function canEditCurrentSpace() {
  const space = getCurrentSpace();
  if (!space) return false;

  // 说明
  if (space.id === BASE_SPACE_ID) {
    return false;
  }

  return !space.readonly;
}

function sync2DSpaceStateTo3D() {
  window.__active2DSpaceId = currentSpaceId || BASE_SPACE_ID;
  window.__get2DSpaces = () => spaces.map((s) => ({ ...s }));
  window.__saveObjectEdits = saveObjectEdits;
  window.__fetchObjectEdits = fetchObjectEdits;
  window.__active2DSelectedCode = currentSelectedObject?.sourceCode || null;
  window.__renameBuildingCodeInDb = renameBuildingCodeInDb;
  window.__refresh2DBuildingInfo = async (sourceCode) => {
    if (!sourceCode) return;
    if (!plan2dView.classList.contains("active")) return;
    if (!currentSelectedObject || normalizeCode(currentSelectedObject.sourceCode) !== normalizeCode(sourceCode)) return;
    const feature = activeFeature;
    const baseRow = feature?.get("baseRow") || buildFallbackObjectRow(sourceCode, "building", feature?.get("rawFeature"));
    await showObjectInfo(baseRow, "building", sourceCode);
  };
}

function setSpaceSelectedLayers(spaceId, nextLayers) {
  const target = getSpaceById(spaceId);
  if (!target) return;
  target.selectedLayers = [...nextLayers];
  saveSpacesToStorage();
}

function getSelectedLayersForCurrentSpace() {
  const space = getCurrentSpace();
  return Array.isArray(space?.selectedLayers) ? space.selectedLayers : [];
}

function isBaseSpace(spaceId) {
  return spaceId === BASE_SPACE_ID;
}

function getAvailableLayerKeysForSpace(space) {
  if (!space) return [];

  if (space.id === BASE_SPACE_ID) {
    return ["figureGround", "building", "road", "cropland", "openSpace", "water"];
  }

  return ["building", "road", "cropland", "openSpace", "water"];
}

function syncBasemapUIBySpace(spaceId) {
  const currentSpace = getSpaceById(spaceId);
  const selectedLayers = currentSpace?.selectedLayers || [];
  const isFigureGroundMode = selectedLayers.includes("figureGround");
  const basemapVisible = !!currentSpace?.basemapVisible;
  const labelVisible = loadBasemapLabelVisible();

  if (!planOnlineLayer && !planHighResLayer && !planLabelLayer) return;

  const isBaseSpace = spaceId === BASE_SPACE_ID;
  const shouldShow = basemapVisible && !(isFigureGroundMode && !basemapVisible) && !(isBaseSpace && isFigureGroundMode);

  if (!shouldShow) {
    if (planOnlineLayer) planOnlineLayer.setVisible(false);
    if (planHighResLayer) planHighResLayer.setVisible(false);
    if (planLabelLayer) planLabelLayer.setVisible(false);
    return;
  }

  const zoom = planMap?.getView()?.getZoom?.() ?? 0;
  const useHighRes = zoom >= HIGHRES_SWITCH_ZOOM;

  if (planOnlineLayer) {
    planOnlineLayer.setVisible(true);
  }

  if (planHighResLayer) {
    planHighResLayer.setVisible(useHighRes);
  }

  if (planLabelLayer) {
    planLabelLayer.setVisible(labelVisible);
  }
}

async function createCopySpace() {
  const copyIndex = spaces.filter((s) => s.id !== BASE_SPACE_ID).length + 1;
  const baseSpace = getSpaceById(BASE_SPACE_ID) || getCurrentSpace();

  const filtered = (baseSpace?.selectedLayers || []).filter(
    (key) => !["figureGround"].includes(key)
  );

  const newSpace = {
    id: `copy_${Date.now()}`,
    title: `规划空间 ${copyIndex}`,
    readonly: false,
    editEnabled: true,
    expanded: true,
    selectedLayers: filtered.length ? Array.from(new Set([...filtered, "road"])) : ["building", "road"],
    basemapVisible: !!baseSpace?.basemapVisible,
    viewMode: "2d"
  };

  try {
    await ensureLayerLoaded("building");
    await seedBuildingsForCopySpace(newSpace.id);
    try {
      await ensureLayerLoaded("road");
      await seedRoadsForCopySpace(newSpace.id);
    } catch (roadError) {
      console.warn("复制空间道路初始化失败（已跳过，不影响空间创建）：", roadError);
      showToast("道路初始化失败，已跳过；可继续编辑建筑。", "info");
    }

    spaces.push(newSpace);
    currentSpaceId = newSpace.id;
    currentSelectedObject = null;
    currentInfoMode = "readonly";
    buildingEditState.dirtyCodes.clear();
    buildingEditState.deletedCodes.clear();

    saveSpacesToStorage();
    sync2DSpaceStateTo3D();

    if (window.Village3D && typeof window.Village3D.reload === "function") {
      await window.Village3D.reload();
    }

    renderSpaceList();
    syncBasemapUIBySpace(newSpace.id);

    // 说明
    await switchTo2DView();

    showPlan2DOverview();
  } catch (error) {
    console.error(error);
    alert(`复制空间创建失败：${error?.message || "建筑初始化入库未成功，请查看控制台。"}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function syncSidebarExpansionUI() {
  window.isSpaceSidebarExpanded = isSpaceSidebarExpanded;

  if (spaceList) {
    spaceList.classList.toggle("active", isSpaceSidebarExpanded);
  }

  // addSpaceBtn removed, new add button is inside spaceList
}

function getLayerIconSvg(layerKey) {
  const icons = {
    figureGround: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    building: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21v-8l7-5 7 5v8"></path></svg>`,
    road: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>`,
    cropland: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4-4-6-8-6-12a6 6 0 0 1 6 6 6 6 0 0 1 6-6c0 4-2 8-6 12z"></path></svg>`,
    openSpace: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>`,
    water: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a5 5 0 0 1-5-5c0-4 5-9 5-9s5 5 5 9a5 5 0 0 1-5 5z"></path></svg>`,
    contours: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8c3-2 5 2 8 0s5-2 8 0 5 2 6 0M2 16c3-2 5 2 8 0s5-2 8 0 5 2 6 0"></path></svg>`,
  };
  return icons[layerKey] || "";
}

function renderSpaceList() {
  if (!spaceList) {
    console.error("spaceList element not found");
    return;
  }

  spaceList.classList.toggle("active", isSpaceSidebarExpanded);
  
  if (!spaces || spaces.length === 0) {
    console.warn("spaces array is empty");
  }

  const currentSpace = getCurrentSpace() || spaces[0];
  if (!currentSpace) {
    spaceList.innerHTML = '';
    return;
  }

  const availableLayerKeys = getAvailableLayerKeysForSpace(currentSpace);
  
  const dropdownOptionsHtml = spaces.map((space) => `
    <option value="${space.id}" ${space.id === currentSpaceId ? 'selected' : ''}>
      ${space.id === BASE_SPACE_ID ? '🏠 ' : ''}${escapeHtml(space.title)}
    </option>
  `).join('');

  const viewModeSwitchHtml = `
    <div class="view-mode-switch">
      <button class="view-mode-btn ${currentSpace.viewMode === '2d' ? 'active' : ''}" 
              type="button" 
              data-space-view="${currentSpace.id}::2d"
              title="切换到 2D 平面视图">
        <span class="view-mode-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
          </svg>
        </span>
        <span class="view-mode-label">平面</span>
      </button>
      <button class="view-mode-btn ${currentSpace.viewMode === '3d' ? 'active' : ''}" 
              type="button" 
              data-space-view="${currentSpace.id}::3d"
              title="切换到 3D 立体视图">
        <span class="view-mode-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l9 5v8l-9 5-9-5V8l9-5z"></path>
            <path d="M12 12l9-5M12 12V3M12 12l-9-5"></path>
          </svg>
        </span>
        <span class="view-mode-label">立体</span>
      </button>
    </div>
  `;

  const figureGroundKeys = availableLayerKeys.filter((k) => k === "figureGround");
  const otherLayerKeys = availableLayerKeys.filter((k) => k !== "figureGround");
  const shouldShowLayers = currentSpace.viewMode === '2d';
  const isFigureGroundActive = currentSpace.selectedLayers.includes("figureGround");
  const basemapVisible = !!currentSpace?.basemapVisible;
  const labelVisible = loadBasemapLabelVisible();

  currentGeometryEditLayer = resolveGeometryEditLayer(currentSpace.selectedLayers);

  const layersHtml = shouldShowLayers ? `
    <div class="substory-list active">
      ${figureGroundKeys.map((layerKey) => `
        <button class="substory-item ${currentSpace.selectedLayers.includes(layerKey) ? 'active' : ''} figure-ground-item" 
                data-space-layer="${currentSpace.id}::${layerKey}" 
                data-layer="${layerKey}"
                type="button">
          <span class="layer-icon">${getLayerIconSvg(layerKey)}</span>
          <span class="layer-label-flex">${escapeHtml(layerConfigs[layerKey].label)}</span>
          <span class="layer-info-icon" title="图底关系无法与其他图层同时显示">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </span>
        </button>
      `).join('')}
      ${figureGroundKeys.length > 0 && otherLayerKeys.length > 0 ? '<div class="layer-divider"></div>' : ''}
      <div class="other-layers-wrap ${isFigureGroundActive ? 'collapsed' : ''}">
        ${otherLayerKeys.map((layerKey) => `
          <button class="substory-item ${currentSpace.selectedLayers.includes(layerKey) ? 'active' : ''}" 
                  data-space-layer="${currentSpace.id}::${layerKey}" 
                  data-layer="${layerKey}"
                  type="button"
                  ${isFigureGroundActive ? 'disabled' : ''}>
            <span class="layer-icon">${getLayerIconSvg(layerKey)}</span>
            <span>${escapeHtml(layerConfigs[layerKey].label)}</span>
          </button>
        `).join('')}
      </div>
      <div class="layer-divider"></div>
      <div class="substory-item-row">
        <button class="substory-item layer-util-btn ${basemapVisible && !isFigureGroundActive ? 'active' : ''}" type="button" data-basemap-toggle ${isFigureGroundActive ? 'disabled' : ''}>
          <span>底图</span>
        </button>
        <button class="substory-item layer-util-btn ${(basemapVisible && labelVisible) && !isFigureGroundActive ? 'active' : ''} ${!basemapVisible || isFigureGroundActive ? 'is-disabled' : ''}" type="button" data-basemap-label-toggle ${!basemapVisible || isFigureGroundActive ? 'disabled' : ''}>
          <span>地名</span>
        </button>
      </div>
    </div>
  ` : '';
  
  const headerSelectHtml = `
    <select class="space-select-dropdown" data-space-dropdown>
      ${dropdownOptionsHtml}
    </select>
    <button class="space-icon-btn space-add-icon-btn" type="button" title="新建空间" data-add-space>+</button>
    <button class="space-icon-btn space-rename-icon-btn ${currentSpace.readonly ? 'is-disabled' : ''}" type="button" data-space-rename-trigger="${currentSpace.id}" title="重命名空间" ${currentSpace.readonly ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    </button>
    <button class="space-icon-btn space-delete-icon-btn ${currentSpace.readonly ? 'is-disabled' : ''}" type="button" data-space-delete="${currentSpace.id}" title="删除空间" ${currentSpace.readonly ? 'disabled' : ''}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    </button>
  `;

  const html = `
    <div class="space-control-panel">
      ${currentSpace.viewMode === '2d' ? `
        <div class="space-options-section">
          <div class="space-options-title-row">
            <div class="space-options-title">图层</div>
            <button class="space-options-toggle" type="button" data-space-options-toggle>
              <svg class="toggle-triangle ${isSpaceOptionsExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          </div>
          ${isSpaceOptionsExpanded ? layersHtml : ''}
        </div>

        ${currentSpace.id !== BASE_SPACE_ID ? `
          <div class="space-toolbox-section">
            <div class="space-options-title-row">
              <div class="space-options-title">工具箱<span class="toolbox-info-icon" title="点击工具按钮后进入对应编辑模式，编辑完成后请点击“保存编辑”，否则编辑结果不会被保存。">i</span></div>
              <button class="space-options-toggle" type="button" data-toolbox-toggle>
                <svg class="toggle-triangle ${isToolboxExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
            </div>
            ${isToolboxExpanded ? `
              <div class="toolbox-content">
                <div id="toolboxToolbarMount"></div>
              </div>
            ` : ''}
          </div>
        ` : ''}
      ` : `
        <div class="space-3d-hint">立体视图下，暂不支持图层与工具箱</div>
      `}
      <button id="exportToMcBtn" class="mc-export-btn toolbox-btn space-export-mc-btn" type="button">导出当前空间到 MC</button>
    </div>
  `;
  
  spaceList.innerHTML = html;

  const headerSelectMount = document.getElementById("spaceHeaderSelect");
  if (headerSelectMount) headerSelectMount.innerHTML = headerSelectHtml;

  const mapSwitchMount = document.getElementById("mapViewModeSwitch");
  const modelSwitchMount = document.getElementById("modelViewModeSwitch");
  if (mapSwitchMount) mapSwitchMount.innerHTML = viewModeSwitchHtml;
  if (modelSwitchMount) modelSwitchMount.innerHTML = viewModeSwitchHtml;

  bindSpaceListEvents();
  ensureBuildingEditorToolbar();
  updateBuildingEditorToolbarState();
}

function bindSpaceListEvents() {
  // 下拉框切换空间
  const dropdown = document.querySelector("[data-space-dropdown]");
  if (dropdown) {
    dropdown.addEventListener("change", async (event) => {
      const spaceId = event.target.value;
      if (!spaceId) return;
      await handleSpaceSelect(spaceId);
    });
  }

  // 显示选项折叠/展开按钮
  const toggleBtn = document.querySelector("[data-space-options-toggle]");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      isSpaceOptionsExpanded = !isSpaceOptionsExpanded;
      renderSpaceList();
    });
  }

  // 说明
  const toolboxToggle = document.querySelector("[data-toolbox-toggle]");
  if (toolboxToggle) {
    toolboxToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      isToolboxExpanded = !isToolboxExpanded;
      renderSpaceList();
    });
  }

  // 说明
  const viewModeButtons = document.querySelectorAll("[data-space-view]");
  viewModeButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const payload = button.dataset.spaceView || "";
      const [spaceId, viewMode] = payload.split("::");
      const target = getSpaceById(spaceId);
      if (!target || !viewMode) return;
      
      if (target.viewMode === viewMode && currentSpaceId === spaceId) return;
      
      target.viewMode = viewMode;
      saveSpacesToStorage();
      
      // 说明
      currentSpaceId = spaceId;
      currentSelectedObject = null;
      currentInfoMode = "readonly";
      saveSpacesToStorage();
      sync2DSpaceStateTo3D();
      
      if (viewMode === '2d') {
        clearBuildingInteractions();
        await switchTo2DView();
      } else {
        clearBuildingInteractions();
        await switchTo3DView();
      }
      
      renderSpaceList();
    });
  });

  // 说明
  const layerButtons = document.querySelectorAll("[data-space-layer]");
  layerButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled || button.classList.contains("layer-muted")) return;
      const payload = button.dataset.spaceLayer || "";
      const [spaceId, layerKey] = payload.split("::");
      const target = getSpaceById(spaceId);
      if (!target || !layerKey) return;

      // 说明
      if (target.viewMode !== '2d') return;

      const availableLayerKeys = getAvailableLayerKeysForSpace(target);
      if (!availableLayerKeys.includes(layerKey)) return;

      const selected = new Set(target.selectedLayers || []);

      if (target.id === BASE_SPACE_ID && layerKey === "figureGround") {
        if (selected.has(layerKey)) {
          selected.delete(layerKey);
        } else {
          selected.clear();
          selected.add("figureGround");
        }
      } else {
        if (selected.has(layerKey)) {
          selected.delete(layerKey);
        } else {
          selected.add(layerKey);
        }
        if (target.id === BASE_SPACE_ID) {
          selected.delete("figureGround");
        }
      }

      if (target.id !== BASE_SPACE_ID) {
        selected.delete("figureGround");
      }

      setSpaceSelectedLayers(spaceId, [...selected]);
      if (!selected.has(currentGeometryEditLayer)) {
        currentGeometryEditLayer = resolveGeometryEditLayer([...selected]);
        buildingEditState.editLayerKey = currentGeometryEditLayer;
        clearBuildingInteractions();
      }
      currentSpaceId = spaceId;
      currentSelectedObject = null;
      currentInfoMode = "readonly";
      sync2DSpaceStateTo3D();

      await ensureSelectedLayersLoaded();
      renderSpaceList();
      syncBasemapUIBySpace(spaceId);

      if (!plan2dView.classList.contains("active")) {
        await switchTo2DView();
      } else {
        refresh2DOverlay();
        showPlan2DOverview();
      }
    });
  });

  // 说明
  const devInfoIcons = document.querySelectorAll(".dev-info-icon");
  devInfoIcons.forEach((icon) => {
    const tooltip = icon.querySelector(".dev-tooltip");
    if (!tooltip) return;

    function showTooltip() {
      const rect = icon.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const gap = 8;
      let left = rect.right + gap;
      let top = rect.top + rect.height / 2 - tooltipRect.height / 2;

      // 说明
      if (left + tooltipRect.width > window.innerWidth - gap) {
        left = rect.left - tooltipRect.width - gap;
      }
      // 说明
      if (top + tooltipRect.height > window.innerHeight - gap) {
        top = window.innerHeight - tooltipRect.height - gap;
      }
      // 说明
      if (top < gap) {
        top = gap;
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.opacity = "1";
      tooltip.style.visibility = "visible";
    }

    function hideTooltip() {
      tooltip.style.opacity = "0";
      tooltip.style.visibility = "hidden";
    }

    icon.addEventListener("mouseenter", showTooltip);
    icon.addEventListener("mouseleave", hideTooltip);
    icon.addEventListener("focus", showTooltip);
    icon.addEventListener("blur", hideTooltip);
  });

  // 重命名按钮
  const renameTriggerButtons = document.querySelectorAll("[data-space-rename-trigger]");
  renameTriggerButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const spaceId = button.dataset.spaceRenameTrigger;
      const target = getSpaceById(spaceId);
      if (!target || target.readonly) return;

      const newTitle = await customPrompt("请输入新的空间名称", target.title, "重命名空间", { maxLength: 10 });
      if (newTitle === null) return;
      const trimmed = newTitle.trim();
      if (!trimmed) {
        renderSpaceList();
        return;
      }
      target.title = trimmed;
      saveSpacesToStorage();
      sync2DSpaceStateTo3D();

      if (window.Village3D && typeof window.Village3D.reload === "function") {
        await window.Village3D.reload();
      }

      renderSpaceList();
    });
  });

  // 说明
  const deleteButtons = document.querySelectorAll("[data-space-delete]");
  deleteButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const spaceId = button.dataset.spaceDelete;
      if (!spaceId || isBaseSpace(spaceId)) return;

      const target = getSpaceById(spaceId);
      const title = target?.title || "该空间";
      const confirmed = await customConfirm("确认要删除吗？删除后不可恢复。", {
        title: "删除空间",
        isDanger: true
      });
      if (!confirmed) return;

      spaces = spaces.filter((s) => s.id !== spaceId);

      if (!spaces.some((s) => s.id === BASE_SPACE_ID)) {
        spaces.unshift(...getDefaultSpaces());
      }

      if (currentSpaceId === spaceId) {
        currentSpaceId = BASE_SPACE_ID;
        // 说明
        const baseSpace = getCurrentSpace();
        if (baseSpace.viewMode === '2d') {
          await switchTo2DView();
        } else {
          await switchTo3DView();
        }
      }

      currentSelectedObject = null;
      currentInfoMode = "readonly";
      saveSpacesToStorage();
      renderSpaceList();
      syncBasemapUIBySpace(currentSpaceId);

      if (getCurrentSpace().viewMode === '2d') {
        await ensureSelectedLayersLoaded();
        refresh2DOverlay();
        showPlan2DOverview();
      }
    });
  });
}

async function handleSpaceSelect(spaceId) {
  const isSpaceChanged = currentSpaceId !== spaceId;
  currentSpaceId = spaceId;
  currentSelectedObject = null;
  currentInfoMode = "readonly";
  currentGeometryEditLayer = resolveGeometryEditLayer(getSelectedLayersForCurrentSpace());
  saveSpacesToStorage();
  sync2DSpaceStateTo3D();
  renderSpaceList();
  ensureBuildingEditorToolbar();
  updateBuildingEditorToolbarState();
  syncBasemapUIBySpace(spaceId);

  const space = getCurrentSpace();
  if (space.viewMode === '2d') {
    // 说明
    if (isSpaceChanged) {
      window.__hasInitialZoomed = false;
    }
    await switchTo2DView();
  } else {
    await switchTo3DView();
  }
}

async function switchTo2DView() {
  setActiveStoryItem("planningSpace");
  switchMainView("plan2d");
  syncBasemapUIBySpace(currentSpaceId);
  update2DStatusText();

  // 说明
  const map = await ensurePlanMap();
  if (map && !window.__hasInitialZoomed) {
    const view = map.getView();
    const georef = activeBasemapGeoref || BASEMAP_GEOREF;
    const center = [
      (georef.minX + georef.maxX) / 2,
      (georef.minY + georef.maxY) / 2
    ];
    view.setCenter(center);
    view.setZoom(16.5);
    window.__hasInitialZoomed = true;
  }
  
  if (!currentSelectedObject) {
    const selectedLayers = getSelectedLayersForCurrentSpace();
    infoPanel.classList.remove("empty");
    if (!selectedLayers.length) {
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>当前未显示任何图层</h3>
          <p>你已将当前空间中的所有图层关闭。</p>
          <p>可在左侧重新点击任意图层按钮，恢复显示。</p>
        </div>
      `;
    } else {
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>村庄 2D 图层</h3>
          <p>可在左侧空间中切换不同图层组合，并点击地图中的对象查看详细信息。</p>

        </div>
      `;
    }
  }
  
  // 说明
  await ensureSelectedLayersLoaded();
  await refresh2DOverlay();
  ensureBuildingEditorToolbar();
  await refreshCommunityScoreBadge();
  updateBuildingEditorToolbarState();
  
  // 与3D同步选中状态
  try {
    const selectedCode3D = window.__active3DEntityCode;
    if (selectedCode3D) {
      const feature = findFeatureBySourceCode(selectedCode3D);
      if (feature) {
        activeFeature = feature;
        const sourceCode = feature.get("sourceCode");
        currentSelectedObject = {
          layerKey: feature.get("layerKey"),
          sourceCode: sourceCode,
          displayName: feature.get("displayName") || sourceCode || "未命名建筑",
          rawFeature: feature
        };
        window.__active2DSelectedCode = sourceCode;
        planVectorLayer.changed();
        update2DStatusText();
        // 说明
        const baseRow = feature.get("baseRow") || buildFallbackObjectRow(sourceCode, "building", feature.get("rawFeature"));
        await showObjectInfo(baseRow, "building", sourceCode);
      }
    }
  } catch (error) {
    console.error("Error syncing selection from 3D:", error);
  }

}

async function switchTo3DView() {
  setActiveStoryItem("planningSpace");
  switchMainView("model3d");
  
  if (statusBadge) {
    statusBadge.textContent = "";
    statusBadge.style.display = "none";
  }
  if (detailSubtitle) {
    detailSubtitle.textContent = "当前显示三维白模与地形";
  }
  
  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
          <h3>村庄 3D 模型</h3>
          <p>正在进入三维模式。点击白模建筑后，可在右侧查看对应对象信息。</p>
    </div>
  `;
  
  if (window.Village3D && typeof window.Village3D.enter === "function") {
    try {
      await window.Village3D.enter();
    } catch (error) {
      console.error("进入 3D 模式失败：", error);
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>3D 模型加载失败</h3>
          <p>${escapeHtml(error.message || "请检查 app-3d.js、Cesium token 与 3D 数据路径。")}</p>
        </div>
      `;
    }
  }
}

function hasRequiredNewLayout() {
  return !!(
    mainLayout &&
    overviewView &&
    plan2dView &&
    model3dView &&
    map2dEl &&
    infoPanel &&
    statusBadge &&
    detailSubtitle &&
    spaceList
  );
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function findFeatureBySourceCode(sourceCode) {
  if (!planVectorSource || !sourceCode) return null;
  
  const features = planVectorSource.getFeatures();
  return features.find(f => {
    const code = f.get("sourceCode");
    return code === sourceCode || normalizeCode(code) === normalizeCode(sourceCode);
  });
}

const BUILDING_INFO_FIELDS = [
  { key: "房屋编码", label: "房屋编码" },
  { key: "户主信息", label: "户主信息" },
  { key: "建成年代", label: "建成年代" },
  { key: "房屋结构信息", label: "房屋结构" },
  { key: "占地面积", label: "占地面积", suffix: "㎡", readonly: true },
  { key: "建筑高度", label: "建筑高度", suffix: "m" }
];

const ROAD_INFO_FIELDS = [
  { key: "道路编码", label: "道路编码" },
  { key: "道路名称", label: "道路名称" },
  { key: "道路类型", label: "道路类型" },
  { key: "道路宽度", label: "道路宽度", suffix: "m" },
  { key: "路面材质", label: "路面材质" }
];

function lonLatToWebMercator(lon, lat) {
  const x = lon * 20037508.34 / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 20037508.34 / 180;
  return [x, y];
}

function getRingAreaSqMeters(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;

  const pts = ring.map(([lon, lat]) => lonLatToWebMercator(Number(lon), Number(lat)));
  let sum = 0;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }

  return Math.abs(sum / 2);
}

function getGeometryAreaSqMeters(geometry) {
  if (!geometry) return 0;

  if (typeof geometry.getType === "function" && typeof geometry.getCoordinates === "function") {
    const type = geometry.getType();
    const coords = geometry.getCoordinates();

    if (type === "Polygon") {
      if (!Array.isArray(coords) || !coords.length) return 0;
      let area = getRingAreaSqMeters(coords[0]);
      for (let i = 1; i < coords.length; i += 1) {
        area -= getRingAreaSqMeters(coords[i]);
      }
      return Math.max(0, area);
    }

    if (type === "MultiPolygon") {
      return coords.reduce((sum, polygon) => {
        if (!Array.isArray(polygon) || !polygon.length) return sum;
        let area = getRingAreaSqMeters(polygon[0]);
        for (let i = 1; i < polygon.length; i += 1) {
          area -= getRingAreaSqMeters(polygon[i]);
        }
        return sum + Math.max(0, area);
      }, 0);
    }

    return 0;
  }

  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) return 0;
    let area = getRingAreaSqMeters(geometry.coordinates[0]);
    for (let i = 1; i < geometry.coordinates.length; i += 1) {
      area -= getRingAreaSqMeters(geometry.coordinates[i]);
    }
    return Math.max(0, area);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((sum, polygon) => {
      if (!Array.isArray(polygon) || !polygon.length) return sum;
      let area = getRingAreaSqMeters(polygon[0]);
      for (let i = 1; i < polygon.length; i += 1) {
        area -= getRingAreaSqMeters(polygon[i]);
      }
      return sum + Math.max(0, area);
    }, 0);
  }

  return 0;
}

function getFeatureAreaSqMeters(featureLike) {
  if (!featureLike) return 0;

  if (typeof featureLike.getGeometry === "function") {
    return getGeometryAreaSqMeters(featureLike.getGeometry());
  }

  if (featureLike.geometry) {
    return getGeometryAreaSqMeters(featureLike.geometry);
  }

  return 0;
}

function getCurrentBuildingAreaText(sourceCode, fallback = "") {
  const matched =
    currentSelectedObject &&
    normalizeCode(currentSelectedObject.sourceCode) === normalizeCode(sourceCode)
      ? currentSelectedObject.rawFeature
      : null;

  const area = getFeatureAreaSqMeters(matched);
  if (area > 0) return String(Math.round(area));

  const num = Number(fallback);
  if (Number.isFinite(num) && num > 0) return String(Math.round(num));

  return "";
}

function normalizeBuildingInfoRow(row, sourceCode = "") {
  return {
    "房屋编码": row?.["房屋编码"] ?? "",
    "户主信息": row?.["户主信息"] ?? row?.["户主濮撳悕"] ?? "",
    "建成年代": row?.["建成年代"] ?? "",
    "房屋功能信息": row?.["房屋功能信息"] ?? row?.["房屋功能"] ?? "",
    "房屋结构信息": row?.["房屋结构信息"] ?? row?.["房屋结构"] ?? "",
    "占地面积": getCurrentBuildingAreaText(sourceCode, row?.["占地面积"] ?? ""),
    "建筑高度": row?.["建筑高度"] ?? ""
  };
}

function normalizeRoadInfoRow(row, sourceCode = "") {
  const pickRoadWidth = (...vals) => {
    for (const val of vals) {
      const text = String(val ?? "").trim();
      if (!text) continue;
      const n = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return NaN;
  };
  const widthNum = pickRoadWidth(
    row?.["道路宽度"], // edited width should win
    row?.["width"],   // then local GeoJSON width
    row?.["宽度"],
    row?.["road_width"],
    row?.["WIDTH"]
  );
  const widthText = Number.isFinite(widthNum) ? String(widthNum) : String(ROAD_DEFAULT_WIDTH);

  return {
    "道路编码":
      row?.["道路编码"] ??
      row?.["编码"] ??
      row?.["id"] ??
      row?.["NAME"] ??
      row?.["name"] ??
      sourceCode,
    "道路名称":
      row?.["道路名称"] ??
      row?.["名称"] ??
      row?.["NAME"] ??
      row?.["name"] ??
      sourceCode,
    "道路类型": row?.["道路类型"] ?? row?.["road_type"] ?? row?.["类型"] ?? "",
    "道路宽度": widthText,
    "路面材质": row?.["路面材质"] ?? row?.["材质"] ?? row?.["surface"] ?? ""
  };
}

function buildRoadBaseRow(row, props) {
  const merged = {
    ...(row || {}),
    ...(props || {})
  };

  // Default should come from local centerline width field.
  // Keep "道路宽度/宽度" for explicit edits (object edits), not for local fallback merge.
  const hasLocalWidth =
    String(merged?.width ?? "").trim() !== "" ||
    String(merged?.road_width ?? "").trim() !== "" ||
    String(merged?.WIDTH ?? "").trim() !== "";
  if (hasLocalWidth) {
    delete merged["道路宽度"];
    delete merged["宽度"];
  }

  return merged;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const filteredRows = rows.filter((r) => r.some((item) => String(item).trim() !== ""));
  if (!filteredRows.length) return [];

  const headers = filteredRows[0].map((h) => String(h || "").trim().replace(/^\uFEFF/, ""));
  return filteredRows.slice(1).map((values) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = String(values[index] ?? "").trim();
    });
    return obj;
  });
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`加载失败：${url}`);
  }
  return response.text();
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`加载失败：${url}`);
  }
  return response.json();
}

function isEditableSpace(spaceId = currentSpaceId) {
  const target = getSpaceById(spaceId);
  if (!target) return false;
  if (target.id === BASE_SPACE_ID) {
    return !!target.editEnabled;
  }
  return !target.readonly;
}

function getCurrent2DBuildingSpaceId() {
  return currentSpaceId || BASE_SPACE_ID;
}

function getBuildingSpaceCacheKey(spaceId) {
  return spaceId || BASE_SPACE_ID;
}

function getLayerLabel(layerKey) {
  return layerConfigs[layerKey]?.label || "对象";
}

function getLayerCodeField(layerKey) {
  return LAYER_CODE_FIELD[layerKey] || "编码";
}

function getLayerNameField(layerKey) {
  return LAYER_NAME_FIELD[layerKey] || "名称";
}

function getLayerPrefix(layerKey) {
  return LAYER_CODE_PREFIX[layerKey] || "X";
}

function getDrawTypeForLayer(layerKey) {
  return layerKey === "road" ? "LineString" : "Polygon";
}

function isEditableGeometryLayer(layerKey) {
  return EDITABLE_GEOMETRY_LAYERS.includes(layerKey);
}

function resolveGeometryEditLayer(selectedLayers = getSelectedLayersForCurrentSpace()) {
  const preferred = isEditableGeometryLayer(currentGeometryEditLayer) ? currentGeometryEditLayer : "building";
  if (selectedLayers.includes(preferred)) return preferred;
  const fallback = EDITABLE_GEOMETRY_LAYERS.find((key) => selectedLayers.includes(key));
  return fallback || "building";
}

function invalidateBuildingDbCache(spaceId = null) {
  if (spaceId === null || spaceId === undefined) {
    buildingDbRowsCache.clear();
    buildingDbHasAnyCache.clear();
    return;
  }
  const key = getBuildingSpaceCacheKey(spaceId);
  buildingDbRowsCache.delete(key);
  buildingDbHasAnyCache.delete(key);
}

function invalidateRoadDbCache(spaceId = null) {
  if (spaceId === null || spaceId === undefined) {
    roadDbRowsCache.clear();
    roadDbHasAnyCache.clear();
    return;
  }
  const key = getBuildingSpaceCacheKey(spaceId);
  roadDbRowsCache.delete(key);
  roadDbHasAnyCache.delete(key);
}

function invalidateCroplandDbCache(spaceId = null) {
  if (spaceId === null || spaceId === undefined) {
    croplandDbRowsCache.clear();
    croplandDbHasAnyCache.clear();
    return;
  }
  const key = getBuildingSpaceCacheKey(spaceId);
  croplandDbRowsCache.delete(key);
  croplandDbHasAnyCache.delete(key);
}

function invalidateOpenSpaceDbCache(spaceId = null) {
  if (spaceId === null || spaceId === undefined) {
    openSpaceDbRowsCache.clear();
    openSpaceDbHasAnyCache.clear();
    return;
  }
  const key = getBuildingSpaceCacheKey(spaceId);
  openSpaceDbRowsCache.delete(key);
  openSpaceDbHasAnyCache.delete(key);
}

function buildDirtyFeatureKey(layerKey, sourceCode) {
  const code = normalizeCode(sourceCode);
  if (!layerKey || !code) return "";
  return `${layerKey}::${code}`;
}

function makeBuildingDbRowToRawFeature(row) {
  return {
    type: "Feature",
    properties: {
      房屋编码: row.object_code,
      房屋名称: row.object_name || row.object_code,
      ...(row.props || {})
    },
    geometry: row.geom
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function olFeatureToDbGeometry(feature) {
  if (!feature) return null;
  const OL = window.__OL__ || {};
  const GeoJSON = OL.GeoJSON;
  if (!GeoJSON) return null;

  const format = new GeoJSON();
  const raw = format.writeFeatureObject(feature, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:4326"
  });

  return raw?.geometry || null;
}

async function listBuildingFeaturesFromDb(spaceId) {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("*")
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("object_code", { ascending: true });

  if (error) {
    console.warn("读取 building 数据库要素失败：", error);
    return [];
  }

  return data || [];
}

async function listBuildingFeaturesFromDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && buildingDbRowsCache.has(key)) {
    return buildingDbRowsCache.get(key);
  }

  const rows = await listBuildingFeaturesFromDb(spaceId);
  buildingDbRowsCache.set(key, rows);
  return rows;
}

async function listRoadFeaturesFromDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && roadDbRowsCache.has(key)) {
    return roadDbRowsCache.get(key);
  }

  const rows = await listRoadFeaturesFromDb(spaceId);
  roadDbRowsCache.set(key, rows);
  return rows;
}

async function listCroplandFeaturesFromDb(spaceId) {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("*")
    .eq("space_id", spaceId)
    .eq("layer_key", "cropland")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("object_code", { ascending: true });

  if (error) {
    console.warn("读取 cropland 数据库要素失败：", error);
    return [];
  }

  return data || [];
}

async function listCroplandFeaturesFromDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && croplandDbRowsCache.has(key)) {
    return croplandDbRowsCache.get(key);
  }

  const rows = await listCroplandFeaturesFromDb(spaceId);
  croplandDbRowsCache.set(key, rows);
  return rows;
}

async function listOpenSpaceFeaturesFromDb(spaceId) {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("*")
    .eq("space_id", spaceId)
    .eq("layer_key", "openSpace")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("object_code", { ascending: true });

  if (error) {
    console.warn("读取 openSpace 数据库要素失败：", error);
    return [];
  }

  return data || [];
}

async function listOpenSpaceFeaturesFromDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && openSpaceDbRowsCache.has(key)) {
    return openSpaceDbRowsCache.get(key);
  }

  const rows = await listOpenSpaceFeaturesFromDb(spaceId);
  openSpaceDbRowsCache.set(key, rows);
  return rows;
}
const MC_SYNC_CONFIG_TABLE = "mc_sync_config";
const MC_BUILDING_STATE_TABLE = "mc_building_state";
const MC_VILLAGE_ID = "village_demo_01";

function getPolygonOuterRing(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") {
    return Array.isArray(geom.coordinates?.[0]) ? geom.coordinates[0] : [];
  }
  if (geom.type === "MultiPolygon") {
    return Array.isArray(geom.coordinates?.[0]?.[0]) ? geom.coordinates[0][0] : [];
  }
  return [];
}

function lonLatToMcXZ(lon, lat, config) {
  const {
    min_lon,
    min_lat,
    max_lon,
    max_lat,
    mc_origin_x,
    mc_origin_z,
    mc_width,
    mc_depth
  } = config;

  const lonSpan = max_lon - min_lon;
  const latSpan = max_lat - min_lat;

  if (!lonSpan || !latSpan) {
    throw new Error("mc_sync_config 经纬度范围无效。");
  }

  const nx = (lon - min_lon) / lonSpan;
  const nz = (lat - min_lat) / latSpan;

  const x = Math.round(mc_origin_x + nx * mc_width);
  const z = Math.round(mc_origin_z + (1 - nz) * mc_depth);

  return { x, z };
}

function polygonRingToMcFootprintBlocks(ring, config) {
  const blocks = [];
  if (!Array.isArray(ring) || ring.length < 4) return blocks;

  const mcPoints = ring.map(([lon, lat]) => lonLatToMcXZ(lon, lat, config));

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  mcPoints.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  });

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      if (isPointInPolygon2D({ x, z }, mcPoints)) {
        blocks.push({ x, z });
      }
    }
  }

  return blocks;
}

function isPointInPolygon2D(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;

    const intersect =
      ((zi > point.z) !== (zj > point.z)) &&
      (point.x < ((xj - xi) * (point.z - zi)) / ((zj - zi) || 1e-9) + xi);

    if (intersect) inside = !inside;
  }
  return inside;
}

function inferHeightBlocksFromProps(props = {}) {
  const raw =
    props["建筑高度"] ||
    props["房屋高度"] ||
    props["height"] ||
    props["HEIGHT"] ||
    props["楼层"] ||
    props["层数"] ||
    "";

  const text = String(raw).trim();
  const num = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);

  if (Number.isFinite(num)) {
    if (text.includes("层")) return Math.max(3, Math.round(num * 3));
    return Math.max(3, Math.round(num));
  }

  return 4;
}

async function loadMcSyncConfig(villageId = MC_VILLAGE_ID) {
  const { data, error } = await supabaseClient
    .from(MC_SYNC_CONFIG_TABLE)
    .select("*")
    .eq("village_id", villageId)
    .single();

  if (error) throw error;
  return data;
}

async function exportCurrentSpaceBuildingsToMc() {
  if (!supabaseClient) {
    throw new Error("未配置 Supabase，无法导出到 MC。");
  }

  const spaceId = currentSpaceId || BASE_SPACE_ID;
  const config = await loadMcSyncConfig(MC_VILLAGE_ID);
  const dbRows = await listBuildingFeaturesFromDb(spaceId);

  if (!dbRows.length) {
    throw new Error("当前空间没有可导出的建筑。");
  }

  const payload = dbRows.map((row) => {
    const ring = getPolygonOuterRing(row.geom);
    const footprintBlocks = polygonRingToMcFootprintBlocks(ring, config);

    let bbox = null;
    if (footprintBlocks.length) {
      const xs = footprintBlocks.map((b) => b.x);
      const zs = footprintBlocks.map((b) => b.z);
      bbox = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs)
      };
    }

    return {
      village_id: MC_VILLAGE_ID,
      space_id: spaceId,
      object_code: row.object_code,
      object_name: row.object_name || row.object_code,
      source: "web",
      footprint_blocks: footprintBlocks,
      bbox,
      base_y: config.mc_origin_y || 64,
      height_blocks: inferHeightBlocksFromProps(row.props || {}),
      block_type: "minecraft:white_concrete",
      geom: row.geom,
      props: row.props || {}
    };
  });

  const chunkSize = 100;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);

    const { error } = await supabaseClient
      .from(MC_BUILDING_STATE_TABLE)
      .upsert(chunk, {
        onConflict: "village_id,space_id,object_code"
      });

    if (error) throw error;
  }
  invalidateBuildingDbCache(spaceId);

  return payload.length;
}

function bindMcExportButton() {
  if (!spaceList) return;
  spaceList.addEventListener("click", async (e) => {
    const exportBtn = e.target.closest("#exportToMcBtn");
    if (!exportBtn) return;

    exportBtn.disabled = true;
    const oldText = exportBtn.textContent;

    try {
      exportBtn.textContent = "导出中...";
      const count = await exportCurrentSpaceBuildingsToMc();
      alert(`已成功导出 ${count} 栋建筑到 MC 桥接表。`);
    } catch (error) {
      console.error(error);
      alert(`导出到 MC 失败：${error.message || error}`);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = oldText;
    }
  });
}

async function upsertBuildingFeatureToDb({
  spaceId,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  if (!supabaseClient) throw new Error("未配置 Supabase，无法保存建筑要素。");

  const payload = {
    space_id: spaceId,
    layer_key: "building",
    object_code: objectCode,
    object_name: objectName || objectCode,
    geom,
    props,
    is_deleted: false
  };

  const { error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(payload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (error) throw error;
  invalidateBuildingDbCache(spaceId);
}

async function upsertRoadFeatureToDb({
  spaceId,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  if (!supabaseClient) throw new Error("未配置 Supabase，无法保存道路要素。");

  const payload = {
    space_id: spaceId,
    layer_key: "road",
    object_code: objectCode,
    object_name: objectName || objectCode,
    geom,
    props,
    is_deleted: false
  };

  const { error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(payload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (error) throw error;
  invalidateRoadDbCache(spaceId);
}

function invalidateLayerDbCache(layerKey, spaceId) {
  if (layerKey === "building") return invalidateBuildingDbCache(spaceId);
  if (layerKey === "road") return invalidateRoadDbCache(spaceId);
  if (layerKey === "cropland") return invalidateCroplandDbCache(spaceId);
  if (layerKey === "openSpace") return invalidateOpenSpaceDbCache(spaceId);
}

async function upsertLayerFeatureToDb({
  spaceId,
  layerKey,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  if (!supabaseClient) throw new Error(`未配置 Supabase，无法保存${getLayerLabel(layerKey)}要素。`);

  const payload = {
    space_id: spaceId,
    layer_key: layerKey,
    object_code: objectCode,
    object_name: objectName || objectCode,
    geom,
    props,
    is_deleted: false
  };

  const { error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(payload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (error) throw error;
  invalidateLayerDbCache(layerKey, spaceId);
}

async function softDeleteBuildingFeatureInDb(spaceId, objectCode) {
  if (!supabaseClient) throw new Error("未配置 Supabase，无法删除建筑要素。");

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .update({
      is_deleted: true
    })
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .eq("object_code", objectCode)
    .select("id");

  if (error) throw error;

  if (Array.isArray(data) && data.length > 0) {
    invalidateBuildingDbCache(spaceId);
    return;
  }

  const fallbackPayload = {
    space_id: spaceId,
    layer_key: "building",
    object_code: objectCode,
    object_name: objectCode,
    geom: {
      type: "Polygon",
      coordinates: []
    },
    props: {
      房屋编码: objectCode,
      房屋名称: objectCode
    },
    is_deleted: true
  };

  const { error: upsertError } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(fallbackPayload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (upsertError) throw upsertError;
  invalidateBuildingDbCache(spaceId);
}

async function softDeleteRoadFeatureInDb(spaceId, objectCode) {
  if (!supabaseClient) throw new Error("未配置 Supabase，无法删除道路要素。");

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .update({
      is_deleted: true
    })
    .eq("space_id", spaceId)
    .eq("layer_key", "road")
    .eq("object_code", objectCode)
    .select("id");

  if (error) throw error;

  if (Array.isArray(data) && data.length > 0) {
    invalidateRoadDbCache(spaceId);
    return;
  }

  const fallbackPayload = {
    space_id: spaceId,
    layer_key: "road",
    object_code: objectCode,
    object_name: objectCode,
    geom: {
      type: "LineString",
      coordinates: []
    },
    props: {
      道路编码: objectCode,
      道路名称: objectCode
    },
    is_deleted: true
  };

  const { error: upsertError } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(fallbackPayload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (upsertError) throw upsertError;
  invalidateRoadDbCache(spaceId);
}

async function softDeleteLayerFeatureInDb(spaceId, layerKey, objectCode) {
  if (layerKey === "building") return softDeleteBuildingFeatureInDb(spaceId, objectCode);
  if (layerKey === "road") return softDeleteRoadFeatureInDb(spaceId, objectCode);
  if (!supabaseClient) throw new Error(`未配置 Supabase，无法删除${getLayerLabel(layerKey)}要素。`);

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .update({
      is_deleted: true
    })
    .eq("space_id", spaceId)
    .eq("layer_key", layerKey)
    .eq("object_code", objectCode)
    .select("id");

  if (error) throw error;

  if (Array.isArray(data) && data.length > 0) {
    invalidateLayerDbCache(layerKey, spaceId);
    return;
  }

  const codeKey = getLayerCodeField(layerKey);
  const nameKey = getLayerNameField(layerKey);
  const fallbackPayload = {
    space_id: spaceId,
    layer_key: layerKey,
    object_code: objectCode,
    object_name: objectCode,
    geom: {
      type: layerKey === "road" ? "LineString" : "Polygon",
      coordinates: []
    },
    props: {
      [codeKey]: objectCode,
      [nameKey]: objectCode
    },
    is_deleted: true
  };

  const { error: upsertError } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .upsert(fallbackPayload, {
      onConflict: "space_id,layer_key,object_code"
    });

  if (upsertError) throw upsertError;
  invalidateLayerDbCache(layerKey, spaceId);
}

async function hasAnyBuildingFeaturesInDb(spaceId) {
  if (!supabaseClient) return false;

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("id")
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .limit(1);

  if (error) {
    console.warn("检查空间 building 是否已初始化失败：", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function hasAnyRoadFeaturesInDb(spaceId) {
  if (!supabaseClient) return false;

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("id")
    .eq("space_id", spaceId)
    .eq("layer_key", "road")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .limit(1);

  if (error) {
    console.warn("检查空间 road 是否已初始化失败：", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function hasAnyCroplandFeaturesInDb(spaceId) {
  if (!supabaseClient) return false;

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("id")
    .eq("space_id", spaceId)
    .eq("layer_key", "cropland")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .limit(1);

  if (error) {
    console.warn("检查空间 cropland 是否已初始化失败：", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function hasAnyOpenSpaceFeaturesInDb(spaceId) {
  if (!supabaseClient) return false;

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("id")
    .eq("space_id", spaceId)
    .eq("layer_key", "openSpace")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .limit(1);

  if (error) {
    console.warn("检查空间 openSpace 是否已初始化失败：", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function hasAnyBuildingFeaturesInDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && buildingDbHasAnyCache.has(key)) {
    return buildingDbHasAnyCache.get(key);
  }

  const hasAny = await hasAnyBuildingFeaturesInDb(spaceId);
  buildingDbHasAnyCache.set(key, hasAny);
  return hasAny;
}

async function hasAnyRoadFeaturesInDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && roadDbHasAnyCache.has(key)) {
    return roadDbHasAnyCache.get(key);
  }

  const hasAny = await hasAnyRoadFeaturesInDb(spaceId);
  roadDbHasAnyCache.set(key, hasAny);
  return hasAny;
}

async function hasAnyCroplandFeaturesInDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && croplandDbHasAnyCache.has(key)) {
    return croplandDbHasAnyCache.get(key);
  }

  const hasAny = await hasAnyCroplandFeaturesInDb(spaceId);
  croplandDbHasAnyCache.set(key, hasAny);
  return hasAny;
}

async function hasAnyOpenSpaceFeaturesInDbCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && openSpaceDbHasAnyCache.has(key)) {
    return openSpaceDbHasAnyCache.get(key);
  }

  const hasAny = await hasAnyOpenSpaceFeaturesInDb(spaceId);
  openSpaceDbHasAnyCache.set(key, hasAny);
  return hasAny;
}

function makeBuildingRawFeatureToDbPayload(rawFeature, row, spaceId) {
  const sourceCode = normalizeCode(getFeatureCode(rawFeature, "building"));
  if (!sourceCode) return null;

  const propsFromGeoJSON = cloneJson(getFeatureProperties(rawFeature) || {});
  const propsFromCSV = cloneJson(row || {});
  const mergedProps = {
    ...propsFromGeoJSON,
    ...propsFromCSV
  };

  mergedProps.房屋编码 =
    mergedProps.房屋编码 ||
    mergedProps.编码 ||
    mergedProps.CODE ||
    sourceCode;

  mergedProps.房屋名称 =
    mergedProps.房屋名称 ||
    mergedProps.名称 ||
    mergedProps.name ||
    mergedProps.NAME ||
    sourceCode;

  return {
    space_id: spaceId,
    layer_key: "building",
    object_code: sourceCode,
    object_name: mergedProps.房屋名称 || sourceCode,
    geom: cloneJson(getFeatureGeometry(rawFeature)),
    props: mergedProps,
    is_deleted: false
  };
}

function makeRoadRawFeatureToDbPayload(rawFeature, row, spaceId) {
  const sourceCode = normalizeCode(getFeatureCode(rawFeature, "road"));
  if (!sourceCode) return null;

  const propsFromGeoJSON = cloneJson(getFeatureProperties(rawFeature) || {});
  const propsFromCSV = cloneJson(row || {});
  const mergedProps = {
    ...propsFromGeoJSON,
    ...propsFromCSV
  };

  mergedProps.道路编码 =
    mergedProps.道路编码 ||
    mergedProps.编码 ||
    mergedProps.CODE ||
    mergedProps["閬撹矾缂栵拷"] ||
    sourceCode;

  mergedProps.道路名称 =
    mergedProps.道路名称 ||
    mergedProps.名称 ||
    mergedProps.name ||
    mergedProps.NAME ||
    sourceCode;

  if (!mergedProps.道路宽度) {
    mergedProps.道路宽度 =
      mergedProps.width ||
      mergedProps.宽度 ||
      mergedProps.road_width ||
      mergedProps.WIDTH ||
      mergedProps["閬撹矾瀹斤拷"] ||
      ROAD_DEFAULT_WIDTH;
  }

  return {
    space_id: spaceId,
    layer_key: "road",
    object_code: sourceCode,
    object_name: mergedProps.道路名称 || sourceCode,
    geom: cloneJson(getFeatureGeometry(rawFeature)),
    props: mergedProps,
    is_deleted: false
  };
}

async function seedBuildingsForCopySpace(spaceId) {
  if (!supabaseClient) {
    throw new Error("未配置 Supabase，无法初始化复制空间建筑。");
  }

  if (!spaceId || isBaseSpace(spaceId)) return;

  const existed = await hasAnyBuildingFeaturesInDb(spaceId);
  if (existed) return;

  const buildingCache = await ensureLayerLoaded("building");
  const rawFeatures = buildingCache?.features || [];
  const rowIndex = buildingCache?.rowIndex || new Map();

  if (!rawFeatures.length) {
    console.warn("building geojson 为空，跳过复制空间初始化。");
    return;
  }

  const payloadRaw = rawFeatures
    .map((rawFeature) => {
      const code = normalizeCode(getFeatureCode(rawFeature, "building"));
      const row = rowIndex.get(code) || null;
      return makeBuildingRawFeatureToDbPayload(rawFeature, row, spaceId);
    })
    .filter(Boolean);

  const dedupedMap = new Map();
  payloadRaw.forEach((item) => {
    const key = `${item.space_id}::${item.layer_key}::${normalizeCode(item.object_code)}`;
    dedupedMap.set(key, item);
  });
  const payload = Array.from(dedupedMap.values());

  if (!payload.length) {
    console.warn("没有可初始化入库的建筑要素。");
    return;
  }

  if (payload.length !== payloadRaw.length) {
    console.warn(`building 初始化检测到重复编码，已自动去重：${payloadRaw.length - payload.length} 条`);
  }

  for (const item of payload) {
    const { error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .upsert(item, {
        onConflict: "space_id,layer_key,object_code"
      });

    if (error) throw error;
  }

  console.log(`复制空间 ${spaceId} 建筑初始化完成，共 ${payload.length} 条。`);
}

async function seedRoadsForCopySpace(spaceId) {
  if (!supabaseClient) {
    throw new Error("未配置 Supabase，无法初始化复制空间道路。");
  }

  if (!spaceId || isBaseSpace(spaceId)) return;

  const existed = await hasAnyRoadFeaturesInDb(spaceId);
  if (existed) return;

  const roadCache = await ensureLayerLoaded("road");
  const rawFeatures = roadCache?.features || [];
  const rowIndex = roadCache?.rowIndex || new Map();

  if (!rawFeatures.length) {
    console.warn("road geojson 为空，跳过复制空间初始化。");
    return;
  }

  const payloadRaw = rawFeatures
    .map((rawFeature) => {
      const code = normalizeCode(getFeatureCode(rawFeature, "road"));
      const row = rowIndex.get(code) || null;
      return makeRoadRawFeatureToDbPayload(rawFeature, row, spaceId);
    })
    .filter(Boolean);

  const dedupedMap = new Map();
  payloadRaw.forEach((item) => {
    const key = `${item.space_id}::${item.layer_key}::${normalizeCode(item.object_code)}`;
    dedupedMap.set(key, item);
  });
  const payload = Array.from(dedupedMap.values());

  if (!payload.length) {
    console.warn("没有可初始化入库的道路要素。");
    return;
  }

  if (payload.length !== payloadRaw.length) {
    console.warn(`road 初始化检测到重复编码，已自动去重：${payloadRaw.length - payload.length} 条`);
  }

  for (const item of payload) {
    const { error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .upsert(item, {
        onConflict: "space_id,layer_key,object_code"
      });

    if (error) throw error;
  }

  invalidateRoadDbCache(spaceId);
  console.log(`复制空间 ${spaceId} 道路初始化完成，共 ${payload.length} 条。`);
}

function getBuildingFeaturesOnMap() {
  if (!planVectorSource) return [];
  return planVectorSource
    .getFeatures()
    .filter((f) => f.get("layerKey") === "building");
}

function getRoadFeaturesOnMap() {
  if (!planVectorSource) return [];
  return planVectorSource
    .getFeatures()
    .filter((f) => f.get("layerKey") === "road");
}

function getFeaturesOnMapByLayer(layerKey) {
  if (!planVectorSource) return [];
  return planVectorSource
    .getFeatures()
    .filter((f) => f.get("layerKey") === layerKey);
}

async function generateNextBuildingCode(spaceId) {
  let maxNum = 0;
  const updateMaxFromCode = (code) => {
    const matched = String(code || "").trim().match(/^H(\d+)$/i);
    if (!matched) return;
    maxNum = Math.max(maxNum, Number(matched[1]));
  };

  if (!Number.isFinite(buildingEditState.nextBuildingSerial)) {
    if (!buildingEditState.nextBuildingSerialPromise) {
      buildingEditState.nextBuildingSerialPromise = (async () => {
        const dbRows = await listBuildingFeaturesFromDbCached(spaceId, { force: true });
        dbRows.forEach((row) => updateMaxFromCode(row.object_code));
        getBuildingFeaturesOnMap().forEach((feature) => {
          updateMaxFromCode(feature.get("sourceCode"));
        });
        buildingEditState.nextBuildingSerial = maxNum + 1;
      })();
    }

    try {
      await buildingEditState.nextBuildingSerialPromise;
    } finally {
      buildingEditState.nextBuildingSerialPromise = null;
    }
  }

  const nextNum = Number.isFinite(buildingEditState.nextBuildingSerial)
    ? buildingEditState.nextBuildingSerial
    : 1;
  buildingEditState.nextBuildingSerial = nextNum + 1;
  return `H${String(nextNum).padStart(3, "0")}`;
}

async function generateNextRoadCode(spaceId) {
  let maxNum = 0;
  const updateMaxFromCode = (code) => {
    const matched = String(code || "").trim().match(/^R(\d+)$/i);
    if (!matched) return;
    maxNum = Math.max(maxNum, Number(matched[1]));
  };

  const dbRows = await listRoadFeaturesFromDbCached(spaceId, { force: true });
  dbRows.forEach((row) => updateMaxFromCode(row.object_code));
  getRoadFeaturesOnMap().forEach((feature) => {
    updateMaxFromCode(feature.get("sourceCode"));
  });

  const nextNum = maxNum + 1;
  return `R${String(nextNum).padStart(3, "0")}`;
}

async function generateNextGenericLayerCode(layerKey, spaceId) {
  const prefix = getLayerPrefix(layerKey);
  let maxNum = 0;
  const pattern = new RegExp(`^${prefix}(\\d+)$`, "i");
  const updateMaxFromCode = (code) => {
    const matched = String(code || "").trim().match(pattern);
    if (!matched) return;
    maxNum = Math.max(maxNum, Number(matched[1]));
  };

  let dbRows = [];
  if (layerKey === "cropland") {
    dbRows = await listCroplandFeaturesFromDbCached(spaceId, { force: true });
  } else if (layerKey === "openSpace") {
    dbRows = await listOpenSpaceFeaturesFromDbCached(spaceId, { force: true });
  }

  dbRows.forEach((row) => updateMaxFromCode(row.object_code));
  getFeaturesOnMapByLayer(layerKey).forEach((feature) => {
    updateMaxFromCode(feature.get("sourceCode"));
  });

  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(3, "0")}`;
}

function markBuildingDirty(feature) {
  const layerKey = feature?.get("layerKey") || "building";
  const key = buildDirtyFeatureKey(layerKey, feature?.get("sourceCode"));
  if (!key) return;
  buildingEditState.dirtyCodes.add(key);
}

function clearBuildingInteractions(options = {}) {
  const { skipRestore = false } = options;
  if (!planMap) return;

  if (buildingEditState.draw) {
    planMap.removeInteraction(buildingEditState.draw);
    buildingEditState.draw = null;
  }
  if (buildingEditState.modify) {
    planMap.removeInteraction(buildingEditState.modify);
    buildingEditState.modify = null;
  }
  if (buildingEditState.translate) {
    planMap.removeInteraction(buildingEditState.translate);
    buildingEditState.translate = null;
  }
  if (buildingEditState.snap) {
    planMap.removeInteraction(buildingEditState.snap);
    buildingEditState.snap = null;
  }

  if (!skipRestore) {
    if (buildingEditState.pendingAddedFeatures?.length) {
      buildingEditState.pendingAddedFeatures.forEach((f) => {
        planVectorSource?.removeFeature(f);
        const key = buildDirtyFeatureKey(f.get("layerKey"), f.get("sourceCode"));
        if (key) buildingEditState.dirtyCodes.delete(key);
      });
      buildingEditState.pendingAddedFeatures = [];
    }

    if (buildingEditState.pendingDeletedFeatures?.length) {
      buildingEditState.pendingDeletedFeatures.forEach((f) => {
        planVectorSource?.addFeature(f);
      });
      buildingEditState.pendingDeletedFeatures = [];
    }

    if (buildingEditState.originalGeoms?.size) {
      buildingEditState.originalGeoms.forEach((geom, featureKey) => {
        const [layerKey, code] = String(featureKey || "").split("::");
        const features = getFeaturesOnMapByLayer(layerKey);
        const feature = features.find((f) => normalizeCode(f.get("sourceCode")) === code);
        if (feature) {
          feature.setGeometry(geom.clone());
        }
        if (featureKey) {
          buildingEditState.dirtyCodes.delete(featureKey);
        }
      });
      buildingEditState.originalGeoms.clear();
    }
  }

  buildingEditState.isDrawingActive = false;
  buildingEditState.mode = "idle";
  updateBuildingEditorToolbarState();
  planVectorLayer?.changed();
}

function updateBuildingEditorToolbarState() {
  const btnTargetBuilding = document.getElementById("btnTargetBuilding");
  const btnTargetRoad = document.getElementById("btnTargetRoad");
  const btnTargetCropland = document.getElementById("btnTargetCropland");
  const btnTargetOpenSpace = document.getElementById("btnTargetOpenSpace");
  const btnAdd = document.getElementById("btnAddBuilding");
  const btnModify = document.getElementById("btnModifyBuilding");
  const btnMove = document.getElementById("btnMoveBuilding");
  const btnRotate = document.getElementById("btnRotateBuilding");
  const btnDelete = document.getElementById("btnDeleteBuilding");
  const btnSave = document.getElementById("btnSaveBuildingGeom");
  const btnStop = document.getElementById("btnStopBuildingEdit");

  const allButtons = [btnTargetBuilding, btnTargetRoad, btnTargetCropland, btnTargetOpenSpace, btnAdd, btnModify, btnMove, btnRotate, btnDelete, btnSave, btnStop];
  allButtons.forEach((btn) => btn?.classList.remove("active"));

  const editable = canEditCurrentSpace();
  const selectedLayers = getSelectedLayersForCurrentSpace();
  const layerKey = resolveGeometryEditLayer(selectedLayers);
  currentGeometryEditLayer = layerKey;
  const isRoadMode = layerKey === "road";

  const targetButtons = [
    { key: "building", btn: btnTargetBuilding },
    { key: "road", btn: btnTargetRoad },
    { key: "cropland", btn: btnTargetCropland },
    { key: "openSpace", btn: btnTargetOpenSpace }
  ];

  targetButtons.forEach(({ key, btn }) => {
    if (!btn) return;
    const enabled = editable && selectedLayers.includes(key);
    btn.disabled = !enabled;
    if (key === layerKey) btn.classList.add("active");
  });

  if (btnSave) {
    const canSave = editable && !(buildingEditState.mode === "draw" && buildingEditState.isDrawingActive);
    btnSave.disabled = !canSave;
  }
  [btnAdd, btnModify, btnMove, btnDelete].forEach((btn) => {
    if (btn) btn.disabled = !editable;
  });
  if (btnRotate) {
    btnRotate.disabled = !editable || isRoadMode;
  }

  if (btnAdd) btnAdd.textContent = isRoadMode ? "新增中心线" : "新增";
  if (btnDelete) btnDelete.textContent = isRoadMode ? "删除中心线" : "删除";

  if (btnStop) btnStop.disabled = false;

  const mode = buildingEditState.mode;
  if (mode === "draw") {
    btnAdd?.classList.add("active");
  } else if (mode === "delete") {
    btnDelete?.classList.add("active");
  } else if (mode === "modify" || mode === "modify-pending") {
    btnModify?.classList.add("active");
  } else if (mode === "translate" || mode === "translate-pending") {
    btnMove?.classList.add("active");
  } else if (mode === "rotate" || mode === "rotate-pending") {
    btnRotate?.classList.add("active");
  }

  if (mode !== "idle") {
    btnSave?.classList.add("active");
    btnStop?.classList.add("active");
  }
}

// 说明
// 说明
function updateWorkbenchVisibility() {
  // 说明
}

function setGeometryEditLayer(layerKey) {
  const selectedLayers = getSelectedLayersForCurrentSpace();
  if (!isEditableGeometryLayer(layerKey)) return;
  if (!selectedLayers.includes(layerKey)) {
    showToast(`请先在图层中勾选“${getLayerLabel(layerKey)}”`, "info");
    return;
  }
  currentGeometryEditLayer = layerKey;
  clearBuildingInteractions();
  updateBuildingEditorToolbarState();
}

function ensureBuildingEditorToolbar() {
  const mount = document.getElementById("toolboxToolbarMount");
  if (!mount) return;

  let toolbar = document.getElementById("buildingEditorToolbar");

  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "buildingEditorToolbar";

    toolbar.innerHTML = `
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnTargetBuilding">建筑</button>
        <button type="button" id="btnTargetRoad">道路</button>
      </div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnTargetCropland">农田</button>
        <button type="button" id="btnTargetOpenSpace">公共空间</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnAddBuilding">新增</button>
        <button type="button" id="btnDeleteBuilding">删除</button>
      </div>
      <div class="toolbar-row">
        <button type="button" id="btnModifyBuilding">编辑顶点</button>
        <button type="button" id="btnMoveBuilding">移动</button>
        <button type="button" id="btnRotateBuilding">旋转</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnSaveBuildingGeom">保存编辑</button>
        <button type="button" id="btnStopBuildingEdit">退出编辑</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-row toolbar-row-center">
        <button type="button" id="btnReportGarbageTask">上报垃圾点</button>
        <button type="button" id="btnRefreshCommunityTask">刷新任务</button>
      </div>
      <div class="toolbar-row toolbar-row-center">
        <div id="communityScoreBadge" style="font-size:12px;color:#1f3552;padding:4px 2px;">贡献值：--</div>
      </div>
    `;

    mount.innerHTML = "";
    mount.appendChild(toolbar);

    document.getElementById("btnTargetBuilding")?.addEventListener("click", () => {
      setGeometryEditLayer("building");
    });

    document.getElementById("btnTargetRoad")?.addEventListener("click", () => {
      setGeometryEditLayer("road");
    });
    document.getElementById("btnTargetCropland")?.addEventListener("click", () => {
      setGeometryEditLayer("cropland");
    });
    document.getElementById("btnTargetOpenSpace")?.addEventListener("click", () => {
      setGeometryEditLayer("openSpace");
    });

    document.getElementById("btnAddBuilding")?.addEventListener("click", () => {
      startAddBuildingMode(currentGeometryEditLayer);
    });

    document.getElementById("btnDeleteBuilding")?.addEventListener("click", async () => {
      await startDeleteBuildingMode(currentGeometryEditLayer);
    });

    document.getElementById("btnModifyBuilding")?.addEventListener("click", () => {
      startModifyBuildingMode(currentGeometryEditLayer);
    });

    document.getElementById("btnMoveBuilding")?.addEventListener("click", async () => {
      await startTranslateBuildingMode(currentGeometryEditLayer);
    });

    document.getElementById("btnRotateBuilding")?.addEventListener("click", async () => {
      await startRotateBuildingMode(currentGeometryEditLayer);
    });

    document.getElementById("btnSaveBuildingGeom")?.addEventListener("click", async () => {
      await saveDirtyBuildings(currentGeometryEditLayer);
    });

    document.getElementById("btnStopBuildingEdit")?.addEventListener("click", () => {
      clearBuildingInteractions();
    });

    document.getElementById("btnReportGarbageTask")?.addEventListener("click", async () => {
      if (!currentUserName) {
        showToast("请先确认身份后再上报。", "error");
        return;
      }
      communityTaskEditState.mode = "report";
      showToast("点击地图标记垃圾点位置。", "info");
    });

    document.getElementById("btnRefreshCommunityTask")?.addEventListener("click", async () => {
      invalidateCommunityTaskCache(currentSpaceId);
      await refresh2DOverlay();
      await refreshCommunityScoreBadge();
      showToast("社区任务已刷新。", "success");
    });
  } else if (toolbar.parentElement !== mount) {
    mount.innerHTML = "";
    mount.appendChild(toolbar);
  }

  refreshCommunityScoreBadge();
  updateBuildingEditorToolbarState();
}

async function startAddBuildingMode(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能新增要素。", "error");
    return;
  }

  if (!isEditableGeometryLayer(layerKey)) return;
  if (!getSelectedLayersForCurrentSpace().includes(layerKey)) {
    showToast(`请先在图层中勾选“${getLayerLabel(layerKey)}”`, "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.pendingAddedFeatures = [];
  buildingEditState.editLayerKey = layerKey;
  if (layerKey === "building") {
    buildingEditState.nextBuildingSerial = null;
    buildingEditState.nextBuildingSerialPromise = null;
  }

  const OL = await (olReady || window.__olReady);
  const { Draw, Snap } = OL;

  buildingEditState.draw = new Draw({
    source: planVectorSource,
    type: getDrawTypeForLayer(layerKey)
  });

  buildingEditState.snap = new Snap({
    source: planVectorSource
  });

  buildingEditState.draw.on("drawstart", () => {
    buildingEditState.isDrawingActive = true;
    updateBuildingEditorToolbarState();
  });

  buildingEditState.draw.on("drawend", async (evt) => {
    const feature = evt.feature;
    let nextCode = "";
    if (layerKey === "road") {
      nextCode = await generateNextRoadCode(getCurrent2DBuildingSpaceId());
    } else if (layerKey === "building") {
      nextCode = await generateNextBuildingCode(getCurrent2DBuildingSpaceId());
    } else {
      nextCode = await generateNextGenericLayerCode(layerKey, getCurrent2DBuildingSpaceId());
    }

    feature.set("layerKey", layerKey);
    feature.set("sourceCode", nextCode);
    feature.set("displayName", nextCode);
    if (layerKey === "road") {
      feature.set("baseRow", {
        道路编码: nextCode,
        道路名称: nextCode,
        道路宽度: ROAD_DEFAULT_WIDTH
      });
    } else {
      const codeField = getLayerCodeField(layerKey);
      const nameField = getLayerNameField(layerKey);
      feature.set("baseRow", {
        [codeField]: nextCode,
        [nameField]: nextCode
      });
    }
    feature.set("rawFeature", null);

    markBuildingDirty(feature);
    activeFeature = feature;
    buildingEditState.pendingAddedFeatures.push(feature);
    buildingEditState.isDrawingActive = false;
    planVectorLayer?.changed();
    updateBuildingEditorToolbarState();
  });

  planMap.addInteraction(buildingEditState.draw);
  planMap.addInteraction(buildingEditState.snap);
  buildingEditState.mode = "draw";
  showToast(layerKey === "road" ? "点击空白处绘制道路中心线" : `点击空白处即可新增${getLayerLabel(layerKey)}`, "info");
  updateBuildingEditorToolbarState();
}

async function startModifyBuildingMode(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能修改要素。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();
  buildingEditState.editLayerKey = layerKey;

  buildingEditState.mode = "modify-pending";
  showToast(layerKey === "road" ? "点击道路中心线即可编辑顶点" : `点击${getLayerLabel(layerKey)}即可编辑顶点`, "info");
  updateBuildingEditorToolbarState();
}

async function startTranslateBuildingMode(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能移动要素。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();
  buildingEditState.editLayerKey = layerKey;

  buildingEditState.mode = "translate-pending";
  showToast(layerKey === "road" ? "点击道路后拖动即可移动" : `点击${getLayerLabel(layerKey)}后拖动即可移动`, "info");
  updateBuildingEditorToolbarState();
}

async function startRotateBuildingMode(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能旋转要素。", "error");
    return;
  }

  if (layerKey === "road") {
    showToast("道路中心线不支持旋转，请使用移动/编辑顶点。", "info");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();
  buildingEditState.editLayerKey = layerKey;

  buildingEditState.mode = "rotate-pending";
  showToast(`点击${getLayerLabel(layerKey)}即可旋转角度`, "info");
  updateBuildingEditorToolbarState();
}

async function startDeleteBuildingMode(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能删除要素。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.pendingDeletedFeatures = [];
  buildingEditState.editLayerKey = layerKey;

  buildingEditState.mode = "delete";
  showToast(layerKey === "road" ? "点击道路中心线即可删除" : `点击${getLayerLabel(layerKey)}即可删除`, "info");
  updateBuildingEditorToolbarState();
}

async function saveDirtyBuildings(layerKey = "building") {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能保存要素。", "error");
    return;
  }
  if (!isEditableGeometryLayer(layerKey)) return;
  const layerLabel = getLayerLabel(layerKey);

  if (buildingEditState.mode === "draw" && buildingEditState.isDrawingActive) {
    showToast(`请先完成当前${layerKey === "road" ? "道路" : layerLabel}的绘制`, "info");
    return;
  }

  clearBuildingInteractions({ skipRestore: true });

  const spaceId = getCurrent2DBuildingSpaceId();
  const features = getFeaturesOnMapByLayer(layerKey);
  const targetFeatures = features.filter((feature) => {
    const key = buildDirtyFeatureKey(layerKey, feature.get("sourceCode"));
    return buildingEditState.dirtyCodes.has(key);
  });

  const hasPendingDelete = (buildingEditState.pendingDeletedFeatures || [])
    .some((feature) => feature.get("layerKey") === layerKey);

  if (!targetFeatures.length && !hasPendingDelete) {
    showToast(`当前没有待保存的${layerKey === "road" ? "道路" : layerLabel}修改。`, "info");
    return;
  }

  try {
    const codeField = getLayerCodeField(layerKey);
    const nameField = getLayerNameField(layerKey);
    for (const feature of targetFeatures) {
      const code = normalizeCode(feature.get("sourceCode"));
      const baseRow = feature.get("baseRow") || {};
      const props = cloneJson(baseRow || {});
      const geom = olFeatureToDbGeometry(feature);

      if (layerKey === "road") {
        props.道路编码 = code;
        props.道路名称 = props.道路名称 || code;
        props.道路宽度 =
          props.width ||
          props.道路宽度 ||
          props.宽度 ||
          props.road_width ||
          props.WIDTH ||
          props["閬撹矾瀹斤拷"] ||
          ROAD_DEFAULT_WIDTH;
      } else {
        props[codeField] = code;
        props[nameField] = props[nameField] || code;
      }
      await upsertLayerFeatureToDb({
        spaceId,
        layerKey,
        objectCode: code,
        objectName: props[nameField] || props.道路名称 || props.房屋名称 || code,
        geom,
        props
      });
    }

    for (const feature of (buildingEditState.pendingDeletedFeatures || [])) {
      if (feature.get("layerKey") !== layerKey) continue;
      const code = normalizeCode(feature.get("sourceCode"));
      if (code) {
        await softDeleteLayerFeatureInDb(spaceId, layerKey, code);
      }
    }

    buildingEditState.dirtyCodes.clear();
    buildingEditState.deletedCodes.clear();
    buildingEditState.pendingDeletedFeatures = [];
    buildingEditState.pendingAddedFeatures = [];
    buildingEditState.originalGeoms.clear();

    await refresh2DOverlay();

    sync2DSpaceStateTo3D();

    if (window.Village3D && typeof window.Village3D.reload === "function") {
      await window.Village3D.reload();
    }

    showToast(`${layerLabel}保存成功`, "success");
  } catch (error) {
    console.error(error);
    showToast(`${layerLabel}保存失败，请查看控制台`, "error");
  }
}

function getGeoJSONFeatures(data) {
  if (!data) return [];
  if (Array.isArray(data.features)) return data.features;
  if (Array.isArray(data)) return data;
  return [];
}

function getFeatureProperties(feature) {
  return feature?.properties || {};
}

function getFeatureGeometry(feature) {
  return feature?.geometry || null;
}

function flattenCoordinates(coords) {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === "number") return [coords];
  return coords.flatMap((item) => flattenCoordinates(item));
}

function getFeatureRings(feature) {
  const geometry = getFeatureGeometry(feature);
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  }

  if (geometry.type === "MultiPolygon") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }

  return [];
}

function getFeatureLines(feature) {
  const geometry = getFeatureGeometry(feature);
  if (!geometry) return [];

  if (geometry.type === "LineString") {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates || [];
  }

  return [];
}

function getFirstMatchingField(obj, fields = []) {
  if (!obj || !fields.length) return "";
  for (const field of fields) {
    if (obj[field] !== undefined && obj[field] !== null && String(obj[field]).trim() !== "") {
      return obj[field];
    }
  }
  return "";
}

function getFeatureCode(feature, layerKey) {
  const config = layerConfigs[layerKey];
  const props = getFeatureProperties(feature);
  return getFirstMatchingField(props, config?.codeFields || []);
}

function getRowCode(row, layerKey) {
  const config = layerConfigs[layerKey];
  return getFirstMatchingField(row, config?.codeFields || []);
}

function getRowName(row, layerKey) {
  const config = layerConfigs[layerKey];
  return getFirstMatchingField(row, config?.nameFields || []);
}

function getRowPhotoValue(row, layerKey) {
  const config = layerConfigs[layerKey];
  return getFirstMatchingField(row, config?.photoFields || []);
}

function buildRowIndex(rows, layerKey) {
  const map = new Map();
  rows.forEach((row) => {
    const code = normalizeCode(getRowCode(row, layerKey));
    if (code) {
      map.set(code, row);
    }
  });
  return map;
}

function getEditableFields(layerKey) {
  return EDITABLE_FIELDS_BY_LAYER[layerKey] || [];
}

function canEditLayer(layerKey, readonlySpace) {
  return !readonlySpace && getEditableFields(layerKey).length > 0;
}

function getFeatureCommentKey(layerKey, sourceCode) {
  const code = normalizeCode(sourceCode);
  if (!layerKey || !code) return "";
  return `${layerKey}::${code}`;
}

function hasFeatureComments(layerKey, sourceCode) {
  const key = getFeatureCommentKey(layerKey, sourceCode);
  return key ? commentedFeatureKeys.has(key) : false;
}

function isCommentsTableMissingError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes("object_comments") && (message.includes("not found") || message.includes("does not exist"))
  );
}

function isCommunityGameTableMissingError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes("community_tasks") ||
    message.includes("task_verifications") ||
    message.includes("points_ledger") ||
    message.includes("user_stats")
  );
}

function invalidateCommunityTaskCache(spaceId = null) {
  if (spaceId === null || spaceId === undefined) {
    communityTasksCache.clear();
    return;
  }
  const key = getBuildingSpaceCacheKey(spaceId);
  communityTasksCache.delete(key);
}

function getLayerStyle(layerKey) {
  const isActive = false;
  const styles = {
    building: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(255,70,70,0.30)",
      stroke: isActive ? "#1565c0" : "#ef5350",
      strokeWidth: isActive ? 3.2 : 2.3
    },
    contours: {
      fill: "none",
      stroke: "rgba(128, 136, 126, 0.38)",
      strokeWidth: 0.9,
      opacity: 1
    },
    elevationBands: {
      fill: "rgba(182, 202, 178, 0.72)",
      stroke: "rgba(0, 0, 0, 0)",
      strokeWidth: 0
    },
    road: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(98, 167, 224, 0.45)",
      stroke: isActive ? "#1565c0" : "rgba(26, 78, 130, 0.95)",
      strokeWidth: isActive ? 3.2 : 2.2
    },
    cropland: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(186, 206, 76, 0.28)",
      stroke: isActive ? "#1565c0" : "rgba(124, 146, 39, 0.95)",
      strokeWidth: isActive ? 3.2 : 1.6
    },
    openSpace: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(255, 193, 79, 0.30)",
      stroke: isActive ? "#1565c0" : "rgba(230, 138, 0, 0.95)",
      strokeWidth: isActive ? 3.2 : 1.8
    },
    water: {
      fill: "rgba(57, 173, 181, 0.40)",
      stroke: "rgba(18, 121, 141, 0.95)",
      strokeWidth: 1.8
    },
    figureGroundBuilding: {
      fill: "rgba(0,0,0,0.96)",
      stroke: "#000000",
      strokeWidth: 1.2
    },
    figureGroundRoad: {
      fill: "rgba(128,128,128,0.95)",
      stroke: "#808080",
      strokeWidth: 1.1
    },
    figureGroundWater: {
      fill: "rgba(66,133,244,0.92)",
      stroke: "#4285f4",
      strokeWidth: 1.1
    },
    default: {
      fill: "rgba(120, 120, 120, 0.25)",
      stroke: "#666666",
      strokeWidth: 2
    }
  };

  return styles[layerKey] || styles.default;
}

function getRoadWidthMeters(feature) {
  const baseRow = feature?.get("baseRow") || {};
  const rawFeatureProps = getFeatureProperties(feature?.get("rawFeature")) || {};
  const pickRoadWidth = (...vals) => {
    for (const val of vals) {
      const text = String(val ?? "").trim();
      if (!text) continue;
      const n = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return NaN;
  };
  const raw =
    pickRoadWidth(
      baseRow["道路宽度"], // edited width should win
      baseRow["width"],   // then local width
      baseRow["宽度"],
      baseRow["road_width"],
      baseRow["WIDTH"],
      rawFeatureProps["width"],
      rawFeatureProps["道路宽度"],
      rawFeatureProps["宽度"],
      rawFeatureProps["road_width"],
      rawFeatureProps["WIDTH"],
      baseRow["閬撹矾瀹斤拷"],
      rawFeatureProps["閬撹矾瀹斤拷"]
    );
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : ROAD_DEFAULT_WIDTH;
}

function getRoadMetersPerPixel(feature, resolution) {
  const view = planMap?.getView?.();
  const fallbackResolution = view?.getResolution?.();
  const res = Number.isFinite(resolution) && resolution > 0 ? resolution : fallbackResolution;
  if (!Number.isFinite(res) || res <= 0) return 1;

  const projection = view?.getProjection?.();
  const projectionCode = projection?.getCode?.() || "";

  if (projectionCode === "EPSG:4326") {
    const geom = feature?.getGeometry?.();
    let latDeg = null;
    if (geom?.getType?.()?.includes("Line") && typeof geom.getCoordinateAt === "function") {
      const mid = geom.getCoordinateAt(0.5);
      latDeg = Array.isArray(mid) ? Number(mid[1]) : null;
    }
    if (!Number.isFinite(latDeg)) {
      const center = view?.getCenter?.();
      latDeg = Array.isArray(center) ? Number(center[1]) : 0;
    }
    const cosLat = Math.max(0.2, Math.cos((latDeg * Math.PI) / 180));
    return Math.max(0.001, res * 111320 * cosLat);
  }

  const metersPerUnit = projection?.getMetersPerUnit?.();
  if (Number.isFinite(metersPerUnit) && metersPerUnit > 0) {
    return Math.max(0.001, res * metersPerUnit);
  }
  return Math.max(0.001, res);
}

function getRoadDisplayStrokeWidth(feature, resolution) {
  const widthMeters = getRoadWidthMeters(feature);
  const metersPerPixel = getRoadMetersPerPixel(feature, resolution);
  const pixels = widthMeters / metersPerPixel;
  return Math.max(1.8, Math.min(60, pixels));
}

function isRenderableGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!type || !Array.isArray(coords)) return false;

  if (type === "LineString") {
    return coords.length >= 2;
  }
  if (type === "MultiLineString") {
    return coords.some((line) => Array.isArray(line) && line.length >= 2);
  }
  if (type === "Polygon") {
    return coords.some((ring) => Array.isArray(ring) && ring.length >= 4);
  }
  if (type === "MultiPolygon") {
    return coords.some((poly) => Array.isArray(poly) && poly.some((ring) => Array.isArray(ring) && ring.length >= 4));
  }
  return false;
}

function smoothLineCoords(coords, iterations = 2) {
  if (!Array.isArray(coords) || coords.length < 3) return coords;

  let current = coords.map((pt) => [Number(pt[0]), Number(pt[1])]);
  for (let k = 0; k < iterations; k += 1) {
    if (current.length < 3) break;
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const p0 = current[i];
      const p1 = current[i + 1];
      const q = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]];
      const r = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]];
      next.push(q, r);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function getSmoothedRoadLineGeometry(feature) {
  if (!feature || typeof feature.getGeometry !== "function") return null;

  const geom = feature.getGeometry();
  if (!geom || geom.getType?.() !== "LineString") return geom || null;

  const revision = typeof feature.getRevision === "function" ? feature.getRevision() : 0;
  const cachedRevision = feature.get("__roadSmoothRevision");
  const cachedGeom = feature.get("__roadSmoothGeometry");
  if (cachedGeom && cachedRevision === revision) {
    return cachedGeom;
  }

  const coords = geom.getCoordinates();
  if (!Array.isArray(coords) || coords.length < 3) return geom;

  const smoothed = smoothLineCoords(coords, 2);
  const smoothGeom = geom.clone();
  if (typeof smoothGeom.setCoordinates === "function") {
    smoothGeom.setCoordinates(smoothed);
  } else {
    return geom;
  }
  feature.set("__roadSmoothRevision", revision, true);
  feature.set("__roadSmoothGeometry", smoothGeom, true);
  return smoothGeom;
}

async function ensureLayerLoaded(layerKey) {
  if (layerDataCache[layerKey]) return layerDataCache[layerKey];

  if (layerKey === "figureGround") {
    const result = { features: [], rows: [], rowIndex: new Map() };
    layerDataCache[layerKey] = result;
    return result;
  }

  const config = layerConfigs[layerKey];
  if (!config) {
    throw new Error(`未找到图层配置：${layerKey}`);
  }

  const [geojson, csvText] = await Promise.all([
    fetchJSON(config.geojsonUrl),
    config.tableUrl ? fetchText(config.tableUrl).catch(() => "") : Promise.resolve("")
  ]);

  const features = getGeoJSONFeatures(geojson);
  const rows = csvText ? parseCSV(csvText) : [];
  const rowIndex = buildRowIndex(rows, layerKey);

  const result = { features, rows, rowIndex };
  layerDataCache[layerKey] = result;
  return result;
}

async function ensureSelectedLayersLoaded() {
  const selectedLayers = getSelectedLayersForCurrentSpace();

  const effective = selectedLayers.includes("figureGround")
    ? Array.from(new Set([...selectedLayers, "elevationBands", "contours", "building", "road", "water"]))
    : [...selectedLayers];

  for (const layerKey of effective) {
    await ensureLayerLoaded(layerKey);
  }
}

function getOlFeatureStyle(feature, resolution) {
  const OL = window.__OL__;
  if (!OL) return null;

  const { Style, Fill, Stroke, Text } = OL;
  const CircleStyle = OL.CircleStyle || OL.Circle;
  const layerKey = feature.get("layerKey");
  const sourceCode = feature.get("sourceCode");
  const geomType = feature?.getGeometry?.()?.getType?.() || "";
  const isActive = activeFeature === feature;
  const isHovered = hoverFeature === feature;
  const isCommented = hasFeatureComments(layerKey, sourceCode);
  const selectedLayers = getSelectedLayersForCurrentSpace();
  const figureGroundMode = selectedLayers.includes("figureGround");

  let fill = "rgba(160,160,160,0.25)";
  let stroke = "rgba(90,90,90,0.95)";
  let strokeWidth = 2;
  let strokeLineDash = undefined;

  if (layerKey === "communityTask") {
    const taskRow = feature.get("taskRow") || {};
    const status = taskRow.status || "pending";
    let color = "#f59e0b";
    if (status === "verified") color = "#10b981";
    else if (status === "rejected") color = "#ef4444";
    if (isActive) color = "#1565c0";

    if (typeof CircleStyle !== "function") {
      return new Style({
        stroke: new Stroke({ color, width: 2 }),
        fill: new Fill({ color: `${color}66` })
      });
    }

    return new Style({
      image: new CircleStyle({
        radius: isHovered || isActive ? 8 : 7,
        fill: new Fill({ color: `${color}cc` }),
        stroke: new Stroke({ color: "#ffffff", width: 2 })
      })
    });
  }

  if (layerKey === VILLAGE_FILL_LAYER_KEY) {
    return new Style({
      fill: new Fill({ color: VILLAGE_FILL_COLOR }),
      stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 })
    });
  }

  if (layerKey === "elevationBands") {
    const pickNumber = (...vals) => {
      for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return NaN;
    };
    const elevMin = pickNumber(
      feature.get("ELEV_MIN"),
      feature.get("elev_min"),
      feature.get("MIN"),
      feature.get("min"),
      feature.get("value")
    );

    let fillColor = "rgba(225, 231, 222, 0.90)";
    if (Number.isFinite(elevMin)) {
      if (elevMin < 80) fillColor = "rgba(225, 231, 222, 0.90)";
      else if (elevMin < 100) fillColor = "rgba(191, 217, 186, 0.90)";
      else if (elevMin < 120) fillColor = "rgba(133, 199, 130, 0.90)";
      else if (elevMin < 140) fillColor = "rgba(62, 163, 84, 0.90)";
      else fillColor = "rgba(0, 104, 45, 0.92)";
    }

    return new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 0 })
    });
  }

  const contourValueRaw =
    feature.get("ELEV") ??
    feature.get("elev") ??
    feature.get("ELEVATION") ??
    feature.get("elevation") ??
    feature.get("VALUE") ??
    feature.get("value") ??
    feature.get("CONTOUR") ??
    feature.get("contour");
  const contourValueNum = Number(contourValueRaw);
  const contourLabel = Number.isFinite(contourValueNum)
    ? String(Math.round(contourValueNum * 10) / 10)
    : (contourValueRaw != null ? String(contourValueRaw) : "");

  if (figureGroundMode) {
    if (layerKey === "building") {
      fill = "#000000";
      stroke = "#000000";
      strokeWidth = 1.2;
    } else if (layerKey === "road") {
      fill = "#9a9a9a";
      stroke = "#9a9a9a";
      strokeWidth = geomType.includes("Line") ? getRoadDisplayStrokeWidth(feature, resolution) : 1.2;
    } else if (layerKey === "water") {
      fill = "#4a90ff";
      stroke = "#4a90ff";
      strokeWidth = 1.2;
    } else if (layerKey === "contours") {
      fill = "rgba(0,0,0,0)";
      stroke = "rgba(128, 136, 126, 0.38)";
      strokeWidth = 0.9;
      strokeLineDash = [3, 3];
    }
  } else {
    if (layerKey === "building") {
      fill = "rgba(255,70,70,0.30)";
      stroke = "rgba(210,50,50,0.95)";
    } else if (layerKey === "road") {
      fill = geomType.includes("Line") ? "rgba(0,0,0,0)" : "rgba(154,154,154,0.90)";
      stroke = "rgba(140,140,140,0.96)";
      strokeWidth = geomType.includes("Line") ? getRoadDisplayStrokeWidth(feature, resolution) : 2.6;
    } else if (layerKey === "cropland") {
      fill = "rgba(186, 206, 76, 0.28)";
      stroke = "rgba(124, 146, 39, 0.95)";
      strokeWidth = 1.6;
      strokeLineDash = [6, 4];
    } else if (layerKey === "openSpace") {
      fill = "rgba(255, 193, 79, 0.30)";
      stroke = "rgba(230, 138, 0, 0.95)";
      strokeWidth = 1.8;
    } else if (layerKey === "water") {
      fill = "rgba(74, 144, 255, 0.90)";
      stroke = "rgba(74, 144, 255, 0.96)";
      strokeWidth = 1.2;
    } else if (layerKey === "contours") {
      fill = "rgba(0,0,0,0)";
      stroke = "rgba(128, 136, 126, 0.38)";
      strokeWidth = 0.9;
      strokeLineDash = [3, 3];
    }
  }

  if (!figureGroundMode && layerKey === "road" && geomType.includes("Line")) {
    const baseWidth = getRoadDisplayStrokeWidth(feature, resolution);
    const smoothGeometry = getSmoothedRoadLineGeometry(feature);
    let strokeColor = "rgba(154,154,154,0.96)";
    let strokeWidthRoad = Math.max(1.8, baseWidth);

    if (isActive) {
      strokeColor = "#1565c0";
      strokeWidthRoad = Math.max(2.4, baseWidth + 0.9);
    } else if (isHovered) {
      strokeColor = "#1e88e5";
      strokeWidthRoad = Math.max(2.2, baseWidth + 0.5);
    } else if (isCommented) {
      strokeColor = "#ff9800";
      strokeWidthRoad = Math.max(2.4, baseWidth + 0.9);
    }

    return new Style({
      geometry: smoothGeometry || undefined,
      stroke: new Stroke({
        color: strokeColor,
        width: strokeWidthRoad,
        lineCap: "round",
        lineJoin: "round"
      })
    });
  }

  if (isActive) {
    fill = "rgba(33,150,243,0.35)";
    stroke = "#1565c0";
    strokeWidth = 3.5;
  } else if (isHovered) {
    fill = "rgba(33,150,243,0.18)";
    stroke = "#42a5f5";
    strokeWidth = 2.8;
  } else if (isCommented) {
    if (layerKey === "road") {
      if (!geomType.includes("Line")) {
        fill = "rgba(30, 136, 229, 0.30)";
      }
      stroke = "#ff9800";
      strokeWidth = geomType.includes("Line") ? Math.max(getRoadDisplayStrokeWidth(feature, resolution), 3.5) : 3.2;
    } else {
      fill = "rgba(255, 193, 7, 0.18)";
      stroke = "#ff9800";
      strokeWidth = 3.1;
    }
  }

  return new Style({
    fill: new Fill({ color: fill }),
    stroke: new Stroke({
      color: stroke,
      width: strokeWidth,
      lineDash: strokeLineDash
    }),
    text:
      layerKey === "contours" &&
      contourLabel &&
      typeof Text === "function" &&
      Number.isFinite(resolution) &&
      resolution <= 0.000075
        ? new Text({
            text: contourLabel,
            font: "10px 'Microsoft YaHei', 'PingFang SC', sans-serif",
            // More aggressive zoom-adaptive scaling to avoid oversized labels when zoomed out.
            scale: Math.max(0.24, Math.min(0.68, 0.000043 / Math.max(resolution, 1e-9))),
            fill: new Fill({ color: "rgba(92, 100, 88, 0.58)" }),
            stroke: new Stroke({ color: "rgba(242, 246, 239, 0.75)", width: 1.1 }),
            overflow: true,
            placement: "line",
            repeat: 520
          })
        : undefined
  });
}

async function ensurePlanMap() {
  if (planMap) return planMap;

  olReady = olReady || window.__olReady;
  const OL = await olReady;
  const georef = await resolveBasemapGeoref();

  const {
    Map,
    View,
    TileLayer,
    ImageLayer,
    VectorLayer,
    XYZ,
    ImageStatic,
    VectorSource
  } = OL;

  planVectorSource = new VectorSource();

  planVectorLayer = new VectorLayer({
    source: planVectorSource,
    style: (feature, resolution) => getOlFeatureStyle(feature, resolution)
  });

  planOnlineLayer = new TileLayer({
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TOKEN}`,
      crossOrigin: "anonymous",
      maxZoom: 18
    }),
    visible: false,
    zIndex: 1
  });
  
  planLabelLayer = new TileLayer({
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TOKEN}`,
      crossOrigin: "anonymous",
      maxZoom: 18
    }),
    visible: false,
    zIndex: 3
  });

  planHighResLayer = new ImageLayer({
    source: new ImageStatic({
      url: georef.imageUrl,
      imageExtent: [
        georef.minX,
        georef.minY,
        georef.maxX,
        georef.maxY
      ],
      projection: "EPSG:4326",
      crossOrigin: "anonymous"
    }),
    visible: false,
    opacity: 0.96,
    zIndex: 2
  });

  planVectorLayer.setZIndex(4);

  planMap = new Map({
    target: "map2d",
    layers: [planOnlineLayer, planLabelLayer, planHighResLayer, planVectorLayer],
    view: new View({
      center: [
        (georef.minX + georef.maxX) / 2,
        (georef.minY + georef.maxY) / 2
      ],
      zoom: 17,
      minZoom: 5,
      maxZoom: 22,
      projection: "EPSG:4326"
    })
  });
  
  const view = planMap.getView();
  view.setCenter([
    (georef.minX + georef.maxX) / 2,
    (georef.minY + georef.maxY) / 2
  ]);
  view.setZoom(16.5);

  syncBasemapUIBySpace(currentSpaceId);

  view.on("change:resolution", () => {
    syncBasemapUIBySpace(currentSpaceId);
    planVectorLayer?.changed();
  });

  planMap.on("pointermove", (evt) => {
    if (evt.dragging) return;
    pendingHoverPixel = Array.isArray(evt.pixel) ? [...evt.pixel] : evt.pixel;
    if (hoverCheckRaf) return;

    hoverCheckRaf = requestAnimationFrame(() => {
      hoverCheckRaf = 0;
      if (!planMap || !pendingHoverPixel) return;

      let hovered = null;
      planMap.forEachFeatureAtPixel(pendingHoverPixel, (feature) => {
        const layerKey = feature?.get?.("layerKey");
        if (isNonInteractiveLayerKey(layerKey)) return false;
        hovered = feature;
        return true;
      });
      pendingHoverPixel = null;

      if (hovered !== hoverFeature) {
        hoverFeature = hovered;
        if (buildingEditState.mode !== "modify" && buildingEditState.mode !== "translate") {
          planVectorLayer?.changed();
        }
      }

      const targetEl = planMap.getTargetElement();
      if (targetEl) {
        targetEl.style.cursor = hovered ? "pointer" : "";
      }
    });
  });

  planMap.on("singleclick", async (evt) => {
    let clicked = null;
    planMap.forEachFeatureAtPixel(evt.pixel, (feature) => {
      const layerKey = feature?.get?.("layerKey");
      if (isNonInteractiveLayerKey(layerKey)) return false;
      clicked = feature;
      return true;
    });

    if (communityTaskEditState.mode === "report") {
      if (!currentUserName) {
        showToast("请先确认身份后再上报任务。", "error");
        communityTaskEditState.mode = "idle";
        return;
      }
      const coord = evt.coordinate;
      const lng = Number(coord?.[0]);
      const lat = Number(coord?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        showToast("坐标无效，请重试。", "error");
        communityTaskEditState.mode = "idle";
        return;
      }
      const desc = await customPrompt("请输入垃圾点描述（可选）", "", "上报垃圾点", { requireNonEmpty: false, maxLength: 120 });
      if (desc === null) {
        communityTaskEditState.mode = "idle";
        showToast("已取消上报。", "info");
        return;
      }
      try {
        const createdTask = await createCommunityTask({
          spaceId: currentSpaceId,
          reporterName: currentUserName,
          lng,
          lat,
          category: "garbage",
          description: String(desc || "").trim()
        });
        communityTaskEditState.mode = "idle";
        try {
          const OL = await (olReady || window.__olReady);
          const format = new OL.GeoJSON();
          addCommunityTaskFeatureToMap(createdTask, format);
          planVectorLayer?.changed();
        } catch (_) {}
        invalidateCommunityTaskCache(currentSpaceId);
        await refreshCommunityScoreBadge();
        showToast("垃圾点上报成功，等待他人核实。", "success");
      } catch (error) {
        communityTaskEditState.mode = "idle";
        showToast(error?.message || "上报失败，请查看控制台。", "error");
        console.error(error);
      }
      return;
    }

    const editLayerKey = buildingEditState.editLayerKey || currentGeometryEditLayer || "building";

    if (
      buildingEditState.mode === "idle" &&
      clicked &&
      clicked.get("layerKey") === "communityTask"
    ) {
      activeFeature = clicked;
      planVectorLayer?.changed();
      await showCommunityTaskInfo(clicked.get("taskRow"));
      return;
    }

    if (buildingEditState.mode === "delete") {
      if (!clicked || clicked.get("layerKey") !== editLayerKey) return;
      planVectorSource.removeFeature(clicked);
      buildingEditState.pendingDeletedFeatures.push(clicked);
      if (activeFeature === clicked) {
        activeFeature = null;
        currentSelectedObject = null;
        window.__active2DSelectedCode = null;
      }
      planVectorLayer.changed();
      return;
    }

    if (buildingEditState.mode === "modify-pending" || buildingEditState.mode === "modify") {
      if (!clicked || clicked.get("layerKey") !== editLayerKey) {
        showToast(`请选择一个${getLayerLabel(editLayerKey)}要素`, "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      const featureKey = buildDirtyFeatureKey(editLayerKey, code);
      if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
        buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
      }
      const OL = await (olReady || window.__olReady);
      const { Modify, Snap, Collection } = OL;
      clearBuildingInteractions({ skipRestore: true });
      buildingEditState.modify = new Modify({
        features: new Collection([clicked])
      });
      buildingEditState.snap = new Snap({ source: planVectorSource });
      buildingEditState.modify.on("modifystart", () => { currentInfoMode = "readonly"; });
      buildingEditState.modify.on("modifyend", (evt) => {
        evt.features.forEach((feature) => markBuildingDirty(feature));
        planVectorLayer?.changed();
      });
      planMap.addInteraction(buildingEditState.modify);
      planMap.addInteraction(buildingEditState.snap);
      buildingEditState.mode = "modify";
      updateBuildingEditorToolbarState();
      return;
    }

    if (buildingEditState.mode === "translate-pending" || buildingEditState.mode === "translate") {
      if (!clicked || clicked.get("layerKey") !== editLayerKey) {
        showToast(`请选择一个${getLayerLabel(editLayerKey)}要素`, "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      const featureKey = buildDirtyFeatureKey(editLayerKey, code);
      if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
        buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
      }
      const OL = await (olReady || window.__olReady);
      const { Translate, Collection } = OL;
      clearBuildingInteractions({ skipRestore: true });
      buildingEditState.translate = new Translate({
        features: new Collection([clicked])
      });
      buildingEditState.translate.on("translatestart", () => { currentInfoMode = "readonly"; });
      buildingEditState.translate.on("translateend", (evt) => {
        evt.features.forEach((feature) => markBuildingDirty(feature));
        planVectorLayer?.changed();
      });
      planMap.addInteraction(buildingEditState.translate);
      buildingEditState.mode = "translate";
      updateBuildingEditorToolbarState();
      return;
    }

    if (buildingEditState.mode === "rotate-pending" || buildingEditState.mode === "rotate") {
      if (!clicked || clicked.get("layerKey") !== editLayerKey) {
        showToast(`请选择一个${getLayerLabel(editLayerKey)}要素`, "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      const featureKey = buildDirtyFeatureKey(editLayerKey, code);
      if (featureKey && !buildingEditState.originalGeoms.has(featureKey)) {
        buildingEditState.originalGeoms.set(featureKey, clicked.getGeometry().clone());
      }

      const angleText = await customPrompt("请输入旋转角度（单位：度，顺时针可输入负数）", "15", `旋转${getLayerLabel(editLayerKey)}`);
      if (angleText == null) {
        // 说明
        return;
      }
      const angleDeg = Number(angleText);
      if (!Number.isFinite(angleDeg)) {
        showToast("请输入有效数字", "error");
        return;
      }
      const geometry = clicked.getGeometry();
      if (geometry) {
        const extent = geometry.getExtent();
        const center = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
        geometry.rotate((angleDeg * Math.PI) / 180, center);
        markBuildingDirty(clicked);
        planVectorLayer?.changed();
      }
      buildingEditState.mode = "rotate";
      updateBuildingEditorToolbarState();
      return;
    }

    if (!clicked) {
      activeFeature = null;
      currentSelectedObject = null;
      window.__active2DSelectedCode = null;
      currentInfoMode = "readonly";
      planVectorLayer.changed();
      update2DStatusText();
      showPlan2DOverview();
      return;
    }

    activeFeature = clicked;
    planVectorLayer.changed();

    const layerKey = clicked.get("layerKey");
    const sourceCode = clicked.get("sourceCode");
    const featureData = clicked.get("rawFeature");
    const baseRow = clicked.get("baseRow") || null;

    currentSelectedObject = {
      layerKey,
      sourceCode,
      displayName: clicked.get("displayName") || sourceCode || "未命名对象",
      rawFeature: clicked || featureData || null
    };
    window.__active2DSelectedCode = sourceCode;

    currentInfoMode = "readonly";
    update2DStatusText();

    if (layerKey === "figureGround") {
      showFigureGroundInfo();
      return;
    }

    const effectiveRow = baseRow || buildFallbackObjectRow(sourceCode, layerKey, featureData);
    await showObjectInfo(effectiveRow, layerKey, sourceCode);
  });

  return planMap;
}

async function refresh2DOverlay() {
  if (!plan2dView.classList.contains("active")) return;

  window.__active2DSpaceId = currentSpaceId;

  await ensurePlanMap();
  const OL = await (olReady || window.__olReady);
  const { GeoJSON } = OL;

  if (!planVectorSource) return;
  planVectorSource.clear();
  activeFeature = null;

  const selectedLayers = getSelectedLayersForCurrentSpace();
  const effectiveLayerKeys = selectedLayers.includes("figureGround")
    ? ["elevationBands", "contours", "water", "road", "building"]
    : [...selectedLayers];

  const format = new GeoJSON();

  if (shouldShowVillageFillForCurrentSpace()) {
    const fillRawFeature = buildVillageFillRawFeature();
    if (fillRawFeature) {
      const fillFeature = format.readFeature(fillRawFeature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:4326"
      });
      fillFeature.set("layerKey", VILLAGE_FILL_LAYER_KEY);
      fillFeature.set("sourceCode", "village-fill");
      fillFeature.set("displayName", "村庄底色");
      fillFeature.set("rawFeature", fillRawFeature);
      fillFeature.set("baseRow", {});
      planVectorSource.addFeature(fillFeature);
    }
  }

  for (const layerKey of effectiveLayerKeys) {
    try {
    if (layerKey === "building" && currentSpaceId !== BASE_SPACE_ID) {
      // 说明
      const dbRows = await listBuildingFeaturesFromDbCached(currentSpaceId);

      if (dbRows.length > 0) {
        // 说明
        dbRows.forEach((row) => {
          const rawFeature = makeBuildingDbRowToRawFeature(row);
          if (!isRenderableGeometry(rawFeature?.geometry)) return;

          const olFeature = format.readFeature(rawFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:4326"
          });

          olFeature.set("layerKey", "building");
          olFeature.set("sourceCode", row.object_code);
          olFeature.set("displayName", row.object_name || row.object_code || "未命名建筑");
          olFeature.set("rawFeature", rawFeature);
          olFeature.set("baseRow", row.props || {});

          planVectorSource.addFeature(olFeature);
        });

        continue;
      }

      // 说明
      const hasAnyDbRecords = await hasAnyBuildingFeaturesInDbCached(currentSpaceId);

      if (hasAnyDbRecords) {
        // 说明
        // 不显示任何建筑，不使用 GeoJSON
        continue;
      }

      // 说明
    }

    if (layerKey === "road" && currentSpaceId !== BASE_SPACE_ID) {
      const dbRows = await listRoadFeaturesFromDbCached(currentSpaceId);

      if (dbRows.length > 0) {
        const dbCodeSet = new Set();
        dbRows.forEach((row) => {
          dbCodeSet.add(normalizeCode(row.object_code));
          const rawFeature = {
            type: "Feature",
            properties: {
              道路编码: row.object_code,
              道路名称: row.object_name || row.object_code,
              ...(row.props || {})
            },
            geometry: row.geom
          };
          if (!isRenderableGeometry(rawFeature?.geometry)) return;

          const olFeature = format.readFeature(rawFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:4326"
          });

          olFeature.set("layerKey", "road");
          olFeature.set("sourceCode", row.object_code);
          olFeature.set("displayName", row.object_name || row.object_code || "未命名道路");
          olFeature.set("rawFeature", rawFeature);
          olFeature.set("baseRow", row.props || {});

          planVectorSource.addFeature(olFeature);
        });

        const roadCached = layerDataCache["road"];
        if (roadCached?.features?.length) {
          roadCached.features.forEach((rawFeature) => {
            if (!isRenderableGeometry(rawFeature?.geometry)) return;
            const sourceCode = getFeatureCode(rawFeature, "road");
            const normCode = normalizeCode(sourceCode);
            if (!normCode || dbCodeSet.has(normCode)) return;

            const props = getFeatureProperties(rawFeature);
            const row = roadCached.rowIndex.get(normCode) || null;
            const displayName =
              (row && getFirstMatchingField(row, layerConfigs.road?.nameFields || [])) ||
              getFirstMatchingField(props, layerConfigs.road?.nameFields || []) ||
              sourceCode ||
              "未命名道路";

            const olFeature = format.readFeature(rawFeature, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:4326"
            });

            olFeature.set("layerKey", "road");
            olFeature.set("sourceCode", sourceCode);
            olFeature.set("displayName", displayName);
            olFeature.set("rawFeature", rawFeature);
            olFeature.set("baseRow", buildRoadBaseRow(row, props));
            planVectorSource.addFeature(olFeature);
          });
        }

        continue;
      }

      const hasAnyDbRecords = await hasAnyRoadFeaturesInDbCached(currentSpaceId);
      if (hasAnyDbRecords) {
        continue;
      }
    }

    if ((layerKey === "cropland" || layerKey === "openSpace") && currentSpaceId !== BASE_SPACE_ID) {
      const dbRows = layerKey === "cropland"
        ? await listCroplandFeaturesFromDbCached(currentSpaceId)
        : await listOpenSpaceFeaturesFromDbCached(currentSpaceId);

      if (dbRows.length > 0) {
        const codeField = getLayerCodeField(layerKey);
        const nameField = getLayerNameField(layerKey);
        const dbCodeSet = new Set();

        dbRows.forEach((row) => {
          dbCodeSet.add(normalizeCode(row.object_code));
          const rawFeature = {
            type: "Feature",
            properties: {
              [codeField]: row.object_code,
              [nameField]: row.object_name || row.object_code,
              ...(row.props || {})
            },
            geometry: row.geom
          };
          if (!isRenderableGeometry(rawFeature?.geometry)) return;

          const olFeature = format.readFeature(rawFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:4326"
          });

          olFeature.set("layerKey", layerKey);
          olFeature.set("sourceCode", row.object_code);
          olFeature.set("displayName", row.object_name || row.object_code || `未命名${getLayerLabel(layerKey)}`);
          olFeature.set("rawFeature", rawFeature);
          olFeature.set("baseRow", row.props || {});
          planVectorSource.addFeature(olFeature);
        });

        const cached = layerDataCache[layerKey];
        if (cached?.features?.length) {
          cached.features.forEach((rawFeature) => {
            if (!isRenderableGeometry(rawFeature?.geometry)) return;
            const sourceCode = getFeatureCode(rawFeature, layerKey);
            const normCode = normalizeCode(sourceCode);
            if (!normCode || dbCodeSet.has(normCode)) return;

            const props = getFeatureProperties(rawFeature);
            const row = cached.rowIndex.get(normCode) || null;
            const displayName =
              (row && getFirstMatchingField(row, layerConfigs[layerKey]?.nameFields || [])) ||
              getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) ||
              sourceCode ||
              `未命名${getLayerLabel(layerKey)}`;

            const olFeature = format.readFeature(rawFeature, {
              dataProjection: "EPSG:4326",
              featureProjection: "EPSG:4326"
            });

            olFeature.set("layerKey", layerKey);
            olFeature.set("sourceCode", sourceCode);
            olFeature.set("displayName", displayName);
            olFeature.set("rawFeature", rawFeature);
            olFeature.set("baseRow", row);
            planVectorSource.addFeature(olFeature);
          });
        }

        continue;
      }

      const hasAnyDbRecords = layerKey === "cropland"
        ? await hasAnyCroplandFeaturesInDbCached(currentSpaceId)
        : await hasAnyOpenSpaceFeaturesInDbCached(currentSpaceId);
      if (hasAnyDbRecords) {
        continue;
      }
    }

    const cached = layerDataCache[layerKey];
    if (!cached?.features) continue;

    cached.features.forEach((rawFeature) => {
      if (!isRenderableGeometry(rawFeature?.geometry)) return;
      const sourceCode = getFeatureCode(rawFeature, layerKey);
      const props = getFeatureProperties(rawFeature);
      const row = cached.rowIndex.get(normalizeCode(sourceCode)) || null;

      const displayName =
        (row && getFirstMatchingField(row, layerConfigs[layerKey]?.nameFields || [])) ||
        getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) ||
        sourceCode ||
        layerConfigs[layerKey]?.label ||
        "未命名对象";

      const olFeature = format.readFeature(rawFeature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:4326"
      });

      olFeature.set("layerKey", layerKey);
      olFeature.set("sourceCode", sourceCode);
      olFeature.set("displayName", displayName);
      olFeature.set("rawFeature", rawFeature);
      const mergedBaseRow =
        layerKey === "road"
          ? buildRoadBaseRow(row, props)
          : (row || props || {});
      olFeature.set("baseRow", mergedBaseRow);

      planVectorSource.addFeature(olFeature);
    });
    } catch (layerError) {
      console.warn(`渲染图层失败（${layerKey}）：`, layerError);
      continue;
    }
  }

  try {
    await refreshCommunityTasksOnMap(format);
  } catch (taskLayerError) {
    console.warn("社区任务图层刷新失败（不影响基础图层）：", taskLayerError);
  }

  await refreshCommentHighlightsForCurrentSpace(effectiveLayerKeys);
  planVectorLayer.changed();
  syncBasemapUIBySpace(currentSpaceId);
}

function getCommunityTaskPosition(taskRow) {
  if (Number.isFinite(taskRow?.lng) && Number.isFinite(taskRow?.lat)) {
    return [Number(taskRow.lng), Number(taskRow.lat)];
  }
  const geom = taskRow?.geom;
  if (geom?.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    const lng = Number(geom.coordinates[0]);
    const lat = Number(geom.coordinates[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  return null;
}

function makeCommunityTaskRawFeature(taskRow) {
  const coords = getCommunityTaskPosition(taskRow);
  if (!coords) return null;
  return {
    type: "Feature",
    properties: {
      taskId: taskRow.id,
      status: taskRow.status,
      reporterName: taskRow.reporter_name
    },
    geometry: {
      type: "Point",
      coordinates: coords
    }
  };
}

function addCommunityTaskFeatureToMap(taskRow, format) {
  if (!planVectorSource || !format || !taskRow) return null;
  const rawFeature = makeCommunityTaskRawFeature(taskRow);
  if (!rawFeature) return null;

  const feature = format.readFeature(rawFeature, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:4326"
  });
  feature.set("layerKey", "communityTask");
  feature.set("sourceCode", `TASK_${taskRow.id}`);
  feature.set("displayName", taskRow.category === "garbage" ? "垃圾点任务" : "社区任务");
  feature.set("taskRow", taskRow);
  feature.set("baseRow", taskRow);
  planVectorSource.addFeature(feature);
  return feature;
}

async function refreshCommunityTasksOnMap(format) {
  if (!planVectorSource || !format) return;
  if (!supabaseClient || !communityGameTablesReady) return;
  const rows = await listCommunityTasksCached(currentSpaceId, { force: true });
  rows.forEach((row) => {
    try {
      addCommunityTaskFeatureToMap(row, format);
    } catch (taskError) {
      console.warn("渲染社区任务失败（已跳过单条）：", taskError, row);
    }
  });
}

function showFigureGroundInfo() {
  currentSelectedObject = null;
  currentInfoMode = "readonly";
  update2DStatusText();

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">图底关系图层</h3>
      <div class="house-row">当前显示图底关系模式：建筑为黑色、道路为灰色、水体为蓝色；关闭底图时显示浅绿色底块。</div>
      <div class="house-row">图底关系中已叠加高程分带（按 ELEV_MIN 分级着色）与等高线数值标注。</div>
      <div class="house-row">该模式主要用于识别村庄空间肌理、道路骨架与水系关系。</div>
      <div class="house-row">可通过左侧图层按钮继续叠加建筑、道路、水体等图层。</div>
    </div>
  `;
}

function showUnmatchedObjectInfo(sourceCode, layerKey, feature = null) {
  const layerLabel = layerConfigs[layerKey]?.label || "对象";
  const props = feature ? getFeatureProperties(feature) : {};

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">${layerKey === "building" ? "建筑信息" : `${escapeHtml(layerLabel)}信息`}</h3>
      <div class="house-row"><span class="house-label">对象编码：</span>${escapeHtml(sourceCode || "未识别")}</div>
      <div class="house-row"><span class="house-label">对象名称：</span>${escapeHtml(getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) || "未命名")}</div>
      <div class="house-row">当前 GeoJSON 要素已识别，但在对应 CSV 中未匹配到详细属性。</div>
      <div class="house-row">请检查该对象在 CSV 中是否有同名编码字段。</div>
    </div>
  `;
}

function buildFallbackObjectRow(sourceCode, layerKey, feature = null) {
  const config = layerConfigs[layerKey] || {};
  const props = feature ? getFeatureProperties(feature) : {};

  const displayName =
    getFirstMatchingField(props, config.nameFields || []) ||
    sourceCode ||
    "未命名对象";

  if (layerKey === "building") {
    return {
      "房屋编码": sourceCode || "",
      "房屋名称": displayName,
      "建成年代": "",
      "房屋结构信息": "",
      "占地面积": "",
      "建筑高度": "",
      "房屋功能信息": "",
      "户主信息": ""
    };
  }

  if (layerKey === "road") {
    return {
      "道路编码": sourceCode || "",
      "道路名称": displayName,
      "道路类型": "",
      "道路宽度": ROAD_DEFAULT_WIDTH,
      "路面材质": ""
    };
  }

  if (layerKey === "cropland") {
    return {
      "农田编码": sourceCode || "",
      "农田名称": displayName,
      "用地类型": "",
      "面积": "",
      "种植情况": "",
      "备注": ""
    };
  }

  if (layerKey === "openSpace") {
    return {
      "公共空间编码": sourceCode || "",
      "公共空间名称": displayName,
      "空间类型": "",
      "面积": "",
      "设施情况": "",
      "备注": ""
    };
  }

  if (layerKey === "water") {
    return {
      "水体编码": sourceCode || "",
      "水体名称": displayName,
      "水体类型": "",
      "面积": "",
      "水质情况": "",
      "备注": ""
    };
  }

  return {
    "对象编码": sourceCode || "",
    "对象名称": displayName
  };
}

function setActiveStoryItem(viewKey) {
  storyItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewKey);
  });
}

function switchMainView(viewKey) {
  overviewView.classList.remove("active");
  plan2dView.classList.remove("active");
  model3dView.classList.remove("active");

  if (viewKey === "overview") {
    overviewView.classList.add("active");
    mainLayout.classList.add("mode-overview");
    mainLayout.classList.remove("mode-map");
  } else if (viewKey === "plan2d") {
    plan2dView.classList.add("active");
    mainLayout.classList.remove("mode-overview");
    mainLayout.classList.add("mode-map");
  } else if (viewKey === "model3d") {
    model3dView.classList.add("active");
    mainLayout.classList.remove("mode-overview");
    mainLayout.classList.add("mode-map");
  }

  if (statusBadge) {
    statusBadge.classList.remove("is-enter-btn");
    statusBadge.style.display = "none";
  }
  updateUserGreeting(viewKey);
}

function update2DStatusText() {
  if (!statusBadge) return;
  statusBadge.textContent = "";
  statusBadge.style.display = "none";
}

function showVillageOverview() {
  setActiveStoryItem("overview");
  switchMainView("overview");

  if (statusBadge) {
    statusBadge.textContent = "进入互动平台";
    statusBadge.classList.add("is-enter-btn");
    statusBadge.style.display = "";
  }

  if (detailSubtitle) {
    detailSubtitle.textContent = "当前模式为整合展示";
  }

  const identitySelect = document.getElementById("identitySelect");
  if (identitySelect) {
    identitySelect.innerHTML = getUserOptionsHtml(currentUserName || "管理员");
    identitySelect.value = currentUserName || "管理员";
  }
  const identityCurrentText = document.getElementById("identityCurrentText");
  if (identityCurrentText) {
    identityCurrentText.textContent = `当前身份：${currentUserName || "未选择"}`;
  }

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>欢迎使用</h3>
      <p>请先在首页完成身份选择，再点击右上角“进入互动平台”。</p>
    </div>
  `;
  bindIdentityPanelEvents();
  updateUserGreeting("overview");
}
function showPlan2DOverview() {
  update2DStatusText();

  const selectedLayers = getSelectedLayersForCurrentSpace();

  if (!currentSelectedObject) {
    infoPanel.classList.remove("empty");

    if (!selectedLayers.length) {
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>当前未显示任何图层</h3>
          <p>你已将当前空间中的所有图层关闭。</p>
          <p>可在左侧重新点击任意图层按钮，恢复显示。</p>
        </div>
      `;
    } else {
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>村庄 2D 图层</h3>
          <p>可在左侧空间中切换不同图层组合，并点击地图中的对象查看详细信息。</p>

        </div>
      `;
    }
  }
}

function getEditNamespaceObjectType(baseObjectType, spaceId) {
  if (!baseObjectType) return "";
  return spaceId === BASE_SPACE_ID ? baseObjectType : `${baseObjectType}__${spaceId}`;
}

function getPhotoNamespaceObjectType(baseObjectType, spaceId) {
  if (!baseObjectType) return "";
  return spaceId === BASE_SPACE_ID ? baseObjectType : `${baseObjectType}__${spaceId}`;
}

function getCommentNamespaceObjectType(baseObjectType, spaceId) {
  if (!baseObjectType) return "";
  return spaceId === BASE_SPACE_ID ? baseObjectType : `${baseObjectType}__${spaceId}`;
}

function mergeObjectRow(baseRow, editData) {
  return {
    ...(baseRow || {}),
    ...(editData || {})
  };
}

async function fetchObjectEdits(sourceCode, objectType) {
  if (!supabaseClient || !sourceCode || !objectType) return null;

  const { data, error } = await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .select("data")
    .eq("object_code", sourceCode)
    .eq("object_type", objectType)
    .maybeSingle();

  if (error) {
    console.warn("读取对象编辑信息失败：", error);
    return null;
  }

  return data?.data || null;
}

async function saveObjectEdits(sourceCode, objectType, payload) {
  if (!supabaseClient) {
    throw new Error("当前未配置 Supabase。");
  }

  const { error } = await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .upsert(
      {
        object_code: sourceCode,
        object_type: objectType,
        data: payload,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "object_code,object_type"
      }
    );

  if (error) {
    throw error;
  }
}

async function migrateObjectEdits(oldCode, newCode, objectType) {
  if (!supabaseClient || !objectType) return;

  const { data: oldEdit, error: fetchError } = await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .select("data")
    .eq("object_code", oldCode)
    .eq("object_type", objectType)
    .maybeSingle();

  if (fetchError || !oldEdit) return;

  await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .delete()
    .eq("object_code", oldCode)
    .eq("object_type", objectType);

  await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .upsert(
      {
        object_code: newCode,
        object_type: objectType,
        data: { ...oldEdit.data, "房屋编码": newCode },
        updated_at: new Date().toISOString()
      },
      { onConflict: "object_code,object_type" }
    );
}

async function migrateObjectComments(oldCode, newCode, objectType) {
  if (!supabaseClient || !objectType || !commentsTableReady) return;

  const { error } = await supabaseClient
    .from(OBJECT_COMMENTS_TABLE)
    .update({ object_code: newCode })
    .eq("object_code", oldCode)
    .eq("object_type", objectType);

  if (error) {
    if (isCommentsTableMissingError(error)) {
      commentsTableReady = false;
      return;
    }
    console.warn("迁移留言编码失败：", error);
  }
}

async function refreshCommunityScoreBadge() {
  const el = document.getElementById("communityScoreBadge");
  if (!el) return;
  if (!currentUserName) {
    el.textContent = "贡献值：请先确认身份";
    return;
  }
  const stats = await getCurrentUserStats(currentUserName);
  const points = Number(stats?.total_points || 0);
  const level = Number(stats?.level || 1);
  el.textContent = `贡献值：${points} ｜ Lv.${level}`;
}

async function showCommunityTaskInfo(taskRow) {
  if (!taskRow) return;
  const statusMap = {
    pending: "待核实",
    verified: "已确认",
    rejected: "已驳回"
  };
  const canVerify = !!currentUserName && currentUserName !== taskRow.reporter_name && taskRow.status === "pending";

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">社区任务</h3>
      <div class="house-row"><span class="house-label">任务类型：</span>垃圾点上报</div>
      <div class="house-row"><span class="house-label">状态：</span>${escapeHtml(statusMap[taskRow.status] || taskRow.status || "待核实")}</div>
      <div class="house-row"><span class="house-label">上报人：</span>${escapeHtml(taskRow.reporter_name || "未知")}</div>
      <div class="house-row"><span class="house-label">描述：</span>${escapeHtml(taskRow.description || "（无）")}</div>
      <div class="house-row"><span class="house-label">时间：</span>${escapeHtml(formatDateTime(taskRow.created_at))}</div>
      <div class="house-row"><span class="house-label">核实次数：</span>${Number(taskRow.verify_count || 0)}</div>
      <div class="toolbar-row toolbar-row-center" style="margin-top:10px;">
        <button id="taskVerifyApproveBtn" type="button" ${canVerify ? "" : "disabled"}>核实通过 +3</button>
        <button id="taskVerifyRejectBtn" type="button" ${canVerify ? "" : "disabled"}>核实驳回 +1</button>
      </div>
      <div class="house-row" style="margin-top:8px;color:#607080;">
        规则：核实通过后，上报者 +7，核实者 +3。
      </div>
    </div>
  `;

  const approveBtn = document.getElementById("taskVerifyApproveBtn");
  const rejectBtn = document.getElementById("taskVerifyRejectBtn");
  const bindVerify = (result) => async () => {
    if (!currentUserName) {
      showToast("请先确认身份后再核实。", "error");
      return;
    }
    try {
      const note = await customPrompt("可填写核实备注（可选）", "", "核实备注", { requireNonEmpty: false, maxLength: 120 });
      if (note === null) return;
      await verifyCommunityTask({
        taskRow,
        verifierName: currentUserName,
        result,
        note: String(note || "").trim()
      });
      await refresh2DOverlay();
      const rows = await listCommunityTasksCached(currentSpaceId, { force: true });
      const latest = rows.find((r) => r.id === taskRow.id) || { ...taskRow, status: result === "approve" ? "verified" : "rejected" };
      await showCommunityTaskInfo(latest);
      await refreshCommunityScoreBadge();
      showToast("核实提交成功。", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "核实失败，请稍后重试。", "error");
    }
  };
  approveBtn?.addEventListener("click", bindVerify("approve"));
  rejectBtn?.addEventListener("click", bindVerify("reject"));
}

async function renameBuildingCodeInDb(spaceId, oldCode, newCode) {
  if (!supabaseClient) throw new Error("当前未配置 Supabase。");
  if (!oldCode || !newCode || oldCode === newCode) return;

  const trimmedNewCode = newCode.trim();
  if (!trimmedNewCode) throw new Error("房屋编码不能为空。");

  const { error: pfError } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .update({ object_code: trimmedNewCode, object_name: trimmedNewCode })
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .eq("object_code", oldCode);

  if (pfError) throw pfError;

  const objectType2D = getEditNamespaceObjectType("building", spaceId);
  await migrateObjectEdits(oldCode, trimmedNewCode, objectType2D);
  await migrateObjectComments(oldCode, trimmedNewCode, objectType2D);

  const objectType3D = spaceId === BASE_SPACE_ID ? null : `building_3d__${spaceId}`;
  if (objectType3D) {
    await migrateObjectEdits(oldCode, trimmedNewCode, objectType3D);
    await migrateObjectComments(oldCode, trimmedNewCode, objectType3D);
  }
}

async function fetchObjectComments(sourceCode, objectType) {
  if (!supabaseClient || !sourceCode || !objectType || !commentsTableReady) return [];

  const { data, error } = await supabaseClient
    .from(OBJECT_COMMENTS_TABLE)
    .select("id, object_code, object_type, author_name, content, created_at")
    .eq("object_code", sourceCode)
    .eq("object_type", objectType)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    if (isCommentsTableMissingError(error)) {
      commentsTableReady = false;
      console.warn("留言表不存在，请先执行 SQL 创建 object_comments：", error);
      return [];
    }
    console.warn("读取留言失败：", error);
    return [];
  }

  return data || [];
}

async function listRoadFeaturesFromDb(spaceId) {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("*")
    .eq("space_id", spaceId)
    .eq("layer_key", "road")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("object_code", { ascending: true });

  if (error) {
    console.warn("读取 road 数据库要素失败：", error);
    return [];
  }

  return data || [];
}

async function createObjectComment(sourceCode, objectType, authorName, content) {
  if (!supabaseClient) {
    throw new Error("当前未配置 Supabase。");
  }
  if (!commentsTableReady) {
    throw new Error("留言表尚未创建，请先执行 SQL。");
  }

  const safeAuthor = String(authorName || "").trim();
  const safeContent = String(content || "").trim();
  if (!safeAuthor) throw new Error("请先确认身份后再留言。");
  if (!safeContent) throw new Error("留言内容不能为空。");

  const { error } = await supabaseClient
    .from(OBJECT_COMMENTS_TABLE)
    .insert({
      object_code: sourceCode,
      object_type: objectType,
      author_name: safeAuthor,
      content: safeContent
    });

  if (error) {
    if (isCommentsTableMissingError(error)) {
      commentsTableReady = false;
      throw new Error("留言表尚未创建，请先执行 SQL。");
    }
    throw error;
  }
}

async function listCommunityTasks(spaceId) {
  if (!supabaseClient || !communityGameTablesReady) return [];

  const { data, error } = await supabaseClient
    .from(COMMUNITY_TASKS_TABLE)
    .select("*")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    if (isCommunityGameTableMissingError(error)) {
      communityGameTablesReady = false;
      console.warn("社区任务表不存在，请先执行 SQL：", error);
      return [];
    }
    console.warn("读取社区任务失败：", error);
    return [];
  }
  return data || [];
}

async function listCommunityTasksCached(spaceId, options = {}) {
  const { force = false } = options;
  const key = getBuildingSpaceCacheKey(spaceId);
  if (!force && communityTasksCache.has(key)) {
    return communityTasksCache.get(key);
  }
  const rows = await listCommunityTasks(spaceId);
  communityTasksCache.set(key, rows);
  return rows;
}

async function createCommunityTask({ spaceId, reporterName, lng, lat, category = "garbage", description = "" }) {
  if (!supabaseClient) throw new Error("当前未配置 Supabase。");
  if (!communityGameTablesReady) throw new Error("社区任务功能未启用，请先执行 SQL。");

  const payload = {
    space_id: spaceId,
    reporter_name: reporterName,
    category,
    description,
    status: "pending",
    lng,
    lat,
    geom: {
      type: "Point",
      coordinates: [lng, lat]
    },
    verify_count: 0,
    settled_at: null
  };

  const { data, error } = await supabaseClient
    .from(COMMUNITY_TASKS_TABLE)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isCommunityGameTableMissingError(error)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw error;
  }

  invalidateCommunityTaskCache(spaceId);
  return data;
}

async function awardCommunityPoints({ userName, delta, reason, taskId, spaceId }) {
  if (!supabaseClient || !userName || !Number.isFinite(delta) || delta === 0) return;

  const { error: ledgerError } = await supabaseClient
    .from(POINTS_LEDGER_TABLE)
    .insert({
      user_name: userName,
      task_id: taskId,
      space_id: spaceId,
      delta,
      reason
    });

  if (ledgerError) {
    if (isCommunityGameTableMissingError(ledgerError)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw ledgerError;
  }

  const { data: oldRow, error: fetchError } = await supabaseClient
    .from(USER_STATS_TABLE)
    .select("*")
    .eq("user_name", userName)
    .maybeSingle();

  if (fetchError && !isCommunityGameTableMissingError(fetchError)) throw fetchError;
  if (fetchError && isCommunityGameTableMissingError(fetchError)) {
    communityGameTablesReady = false;
    throw new Error("社区任务功能未启用，请先执行 SQL。");
  }

  const totalPoints = Number(oldRow?.total_points || 0) + delta;
  const reportsCount = Number(oldRow?.reports_count || 0) + (reason.includes("上报") ? 1 : 0);
  const verifyCount = Number(oldRow?.verify_count || 0) + (reason.includes("核实") ? 1 : 0);

  const { error: upsertError } = await supabaseClient
    .from(USER_STATS_TABLE)
    .upsert(
      {
        user_name: userName,
        total_points: totalPoints,
        reports_count: reportsCount,
        verify_count: verifyCount,
        level: Math.max(1, Math.floor(totalPoints / 100) + 1),
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_name" }
    );

  if (upsertError) {
    if (isCommunityGameTableMissingError(upsertError)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw upsertError;
  }
}

async function verifyCommunityTask({ taskRow, verifierName, result, note }) {
  if (!supabaseClient) throw new Error("当前未配置 Supabase。");
  if (!communityGameTablesReady) throw new Error("社区任务功能未启用，请先执行 SQL。");
  if (!taskRow?.id) throw new Error("任务无效。");
  if (!verifierName) throw new Error("请先确认身份。");
  if (taskRow.reporter_name === verifierName) throw new Error("不能核实自己上报的任务。");
  if (taskRow.status === "verified" || taskRow.status === "rejected") {
    throw new Error("该任务已结束，不能重复核实。");
  }

  const { data: existsRows, error: existsError } = await supabaseClient
    .from(TASK_VERIFICATIONS_TABLE)
    .select("id")
    .eq("task_id", taskRow.id)
    .eq("verifier_name", verifierName)
    .limit(1);

  if (existsError) {
    if (isCommunityGameTableMissingError(existsError)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw existsError;
  }

  if (Array.isArray(existsRows) && existsRows.length > 0) {
    throw new Error("你已核实过该任务。");
  }

  const { error: insertError } = await supabaseClient
    .from(TASK_VERIFICATIONS_TABLE)
    .insert({
      task_id: taskRow.id,
      verifier_name: verifierName,
      result,
      note: note || ""
    });

  if (insertError) {
    if (isCommunityGameTableMissingError(insertError)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw insertError;
  }

  const verifyCount = Number(taskRow.verify_count || 0) + 1;
  const nextStatus = result === "approve" ? "verified" : "rejected";

  const { data: updatedTask, error: updateError } = await supabaseClient
    .from(COMMUNITY_TASKS_TABLE)
    .update({
      status: nextStatus,
      verify_count: verifyCount,
      verifier_name: verifierName,
      verified_at: new Date().toISOString(),
      settled_at: nextStatus === "verified" ? new Date().toISOString() : taskRow.settled_at
    })
    .eq("id", taskRow.id)
    .select("*")
    .single();

  if (updateError) {
    if (isCommunityGameTableMissingError(updateError)) {
      communityGameTablesReady = false;
      throw new Error("社区任务功能未启用，请先执行 SQL。");
    }
    throw updateError;
  }

  if (result === "approve") {
    await awardCommunityPoints({
      userName: taskRow.reporter_name,
      delta: 7,
      reason: "任务核实通过（上报奖励）",
      taskId: taskRow.id,
      spaceId: taskRow.space_id
    });
    await awardCommunityPoints({
      userName: verifierName,
      delta: 3,
      reason: "任务核实通过（核实奖励）",
      taskId: taskRow.id,
      spaceId: taskRow.space_id
    });
  } else {
    await awardCommunityPoints({
      userName: verifierName,
      delta: 1,
      reason: "任务核实（驳回）",
      taskId: taskRow.id,
      spaceId: taskRow.space_id
    });
  }

  invalidateCommunityTaskCache(taskRow.space_id);
  return updatedTask;
}

async function getCurrentUserStats(userName) {
  if (!supabaseClient || !communityGameTablesReady || !userName) return null;
  const { data, error } = await supabaseClient
    .from(USER_STATS_TABLE)
    .select("*")
    .eq("user_name", userName)
    .maybeSingle();

  if (error) {
    if (isCommunityGameTableMissingError(error)) {
      communityGameTablesReady = false;
      return null;
    }
    console.warn("读取积分统计失败：", error);
    return null;
  }
  return data || null;
}

async function refreshCommentHighlightsForCurrentSpace(effectiveLayerKeys = null) {
  if (!planVectorSource) return;

  if (!supabaseClient || !commentsTableReady) {
    if (commentedFeatureKeys.size > 0) {
      commentedFeatureKeys = new Set();
      planVectorLayer?.changed();
    }
    return;
  }

  const layerKeys = Array.isArray(effectiveLayerKeys) && effectiveLayerKeys.length
    ? effectiveLayerKeys
    : getSelectedLayersForCurrentSpace().includes("figureGround")
      ? ["elevationBands", "contours", "water", "road", "building"]
      : [...getSelectedLayersForCurrentSpace()];

  const targetLayerKeys = layerKeys.filter((key) => layerConfigs[key]?.objectType);
  if (!targetLayerKeys.length) {
    if (commentedFeatureKeys.size > 0) {
      commentedFeatureKeys = new Set();
      planVectorLayer?.changed();
    }
    return;
  }

  const objectTypeToLayer = new Map();
  const objectTypes = targetLayerKeys.map((layerKey) => {
    const type = getCommentNamespaceObjectType(layerConfigs[layerKey].objectType, currentSpaceId);
    objectTypeToLayer.set(type, layerKey);
    return type;
  });

  const { data, error } = await supabaseClient
    .from(OBJECT_COMMENTS_TABLE)
    .select("object_code, object_type")
    .in("object_type", objectTypes)
    .limit(5000);

  if (error) {
    if (isCommentsTableMissingError(error)) {
      commentsTableReady = false;
      commentedFeatureKeys = new Set();
      planVectorLayer?.changed();
      return;
    }
    console.warn("读取留言高亮数据失败：", error);
    return;
  }

  const nextKeys = new Set();
  (data || []).forEach((row) => {
    const layerKey = objectTypeToLayer.get(row.object_type);
    if (!layerKey) return;
    const key = getFeatureCommentKey(layerKey, row.object_code);
    if (key) nextKeys.add(key);
  });

  commentedFeatureKeys = nextKeys;
  planVectorLayer?.changed();
}

async function fetchObjectPhotos(sourceCode, objectType) {
  if (!supabaseClient || !sourceCode || !objectType) return [];

  const { data, error } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .select("id, object_code, object_type, photo_url, photo_path, uploaded_at")
    .eq("object_code", sourceCode)
    .eq("object_type", objectType)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.warn("读取照片列表失败：", error);
    return [];
  }

  return data || [];
}

async function uploadObjectPhoto(file, sourceCode, objectType) {
  if (!supabaseClient) {
    throw new Error("当前未配置 Supabase。");
  }

  const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeCode = normalizeCode(sourceCode || "object");
  const fileName = `${objectType}/${safeCode}_${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(PHOTO_BUCKET)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = supabaseClient.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(fileName);

  const photoUrl = publicUrlData?.publicUrl || "";

  const { error: insertError } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .insert({
      object_code: sourceCode,
      object_type: objectType,
      photo_url: photoUrl,
      photo_path: fileName
    });

  if (insertError) {
    throw insertError;
  }

  return { photoUrl, photoPath: fileName };
}

async function deleteObjectPhoto(photoRecord) {
  if (!supabaseClient) {
    throw new Error("当前未配置 Supabase。");
  }

  if (photoRecord.photo_path) {
    const { error: storageError } = await supabaseClient.storage
      .from(PHOTO_BUCKET)
      .remove([photoRecord.photo_path]);

    if (storageError) {
      console.warn("删除存储文件失败：", storageError);
    }
  }

  const { error: deleteError } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .delete()
    .eq("id", photoRecord.id);

  if (deleteError) {
    throw deleteError;
  }
}

function buildEditableDetailHtml(row, layerKey, allowEdit) {
  if (layerKey === "building") {
    const displayRow = normalizeBuildingInfoRow(row, currentSelectedObject?.sourceCode || "");
    const fields = getEditableFields(layerKey);

    return BUILDING_INFO_FIELDS.map((field) => {
      const divider = field.key === "占地面积" ? '<div class="field-divider"></div>' : "";
      const rawValue = displayRow?.[field.key] ?? "";
      const value = rawValue === "" ? "" : rawValue;
      const suffix = field.suffix && rawValue !== "" ? field.suffix : "";
      const isEditable = allowEdit && fields.some((f) => f.key === field.key);
      const displayValue = value === "" ? "—" : value;

      if (!isEditable) {
        return divider + `
          <div class="house-row" data-field-key="${escapeHtml(field.key)}">
            <span class="house-label">${escapeHtml(field.label)}：</span>
            <span class="house-value">${escapeHtml(String(displayValue))}${suffix}</span>
          </div>
        `;
      }

      return divider + `
        <div class="house-row editable-row" data-field-key="${escapeHtml(field.key)}" data-field-label="${escapeHtml(field.label)}">
          <span class="house-label">${escapeHtml(field.label)}：</span>
          <span class="house-value">${escapeHtml(String(displayValue))}${suffix}</span>
          <button class="edit-field-btn" type="button" title="编辑" data-field-key="${escapeHtml(field.key)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
      `;
    }).join("");
  }

  if (layerKey === "road") {
    const displayRow = normalizeRoadInfoRow(row, currentSelectedObject?.sourceCode || "");
    const fields = getEditableFields(layerKey);

    return ROAD_INFO_FIELDS.map((field) => {
      const rawValue = displayRow?.[field.key] ?? "";
      const value = rawValue === "" ? "" : rawValue;
      const suffix = field.suffix && rawValue !== "" ? field.suffix : "";
      const isEditable = allowEdit && fields.some((f) => f.key === field.key);
      const displayValue = value === "" ? "—" : value;

      if (!isEditable) {
        return `
          <div class="house-row" data-field-key="${escapeHtml(field.key)}">
            <span class="house-label">${escapeHtml(field.label)}：</span>
            <span class="house-value">${escapeHtml(String(displayValue))}${suffix}</span>
          </div>
        `;
      }

      return `
        <div class="house-row editable-row" data-field-key="${escapeHtml(field.key)}" data-field-label="${escapeHtml(field.label)}">
          <span class="house-label">${escapeHtml(field.label)}：</span>
          <span class="house-value">${escapeHtml(String(displayValue))}${suffix}</span>
          <button class="edit-field-btn" type="button" title="编辑" data-field-key="${escapeHtml(field.key)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
      `;
    }).join("");
  }

  const entries = Object.entries(row || {}).filter(([_, value]) => {
    return String(value ?? "").trim() !== "";
  });

  if (!entries.length) {
    return `<div class="house-row">暂无详细信息。</div>`;
  }

  const editableKeys = allowEdit ? getEditableFields(layerKey).map((f) => f.key) : [];

  return entries.map(([key, value]) => {
    const isEditable = editableKeys.includes(key);

    if (!isEditable) {
      return `
        <div class="house-row" data-field-key="${escapeHtml(key)}">
          <span class="house-label">${escapeHtml(key)}：</span>
          <span class="house-value">${escapeHtml(String(value))}</span>
        </div>
      `;
    }

    return `
      <div class="house-row editable-row" data-field-key="${escapeHtml(key)}" data-field-label="${escapeHtml(key)}">
        <span class="house-label">${escapeHtml(key)}：</span>
        <span class="house-value">${escapeHtml(String(value))}</span>
        <button class="edit-field-btn" type="button" title="编辑" data-field-key="${escapeHtml(key)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join("");
}

function buildEditFormHtml(row, layerKey) {
  const fields = getEditableFields(layerKey);
  const displayRow =
    layerKey === "building"
      ? normalizeBuildingInfoRow(row, currentSelectedObject?.sourceCode || "")
      : layerKey === "road"
        ? normalizeRoadInfoRow(row, currentSelectedObject?.sourceCode || "")
      : row;

  return fields.map((field) => {
    const value = displayRow?.[field.key] ?? "";
    const inputType = field.type === "number" ? "number" : "text";
    const readonlyAttr = field.readonly ? 'readonly aria-readonly="true"' : "";
    const stepValue = field.type === "number" ? 'step="1"' : "";

    return `
      <label class="form-row">
        <span class="form-label">${escapeHtml(field.label)}</span>
        <span class="form-input-wrap">
          <input
            class="form-input"
            type="${inputType}"
            ${stepValue}
            value="${escapeHtml(value)}"
            data-edit-field="${escapeHtml(field.key)}"
            ${readonlyAttr}
          />
          ${field.suffix ? `<span class="form-suffix">${escapeHtml(field.suffix)}</span>` : ""}
        </span>
      </label>
    `;
  }).join("");
}

function buildInfoModeSwitchHtml({ layerKey, allowEdit, readonlySpace }) {
  if (!allowEdit) {
    return `
      <div class="mode-switch-card">
        <button class="mode-switch-btn active" type="button" disabled>只读模式</button>
        <span class="mode-tip">${readonlySpace ? "现状空间仅可查看" : "当前对象暂不支持编辑"}</span>
      </div>
    `;
  }

  return `
    <div class="mode-switch-card">
      <button class="mode-switch-btn ${currentInfoMode === "readonly" ? "active" : ""}" type="button" data-mode="readonly">只读模式</button>
      <button class="mode-switch-btn ${currentInfoMode === "edit" ? "active" : ""}" type="button" data-mode="edit">编辑模式</button>
    </div>
  `;
}

function collectEditPayload(layerKey, sourceCode = "") {
  const inputs = document.querySelectorAll("[data-edit-field]");
  const payload = {};
  const fields = getEditableFields(layerKey);

  fields.forEach((field) => {
    const input = Array.from(inputs).find((el) => el.dataset.editField === field.key);
    payload[field.key] = input ? input.value.trim() : "";
  });

  if (layerKey === "building") {
    payload["占地面积"] = getCurrentBuildingAreaText(sourceCode, payload["占地面积"]);
  }

  return payload;
}

async function handlePhotoUpload(context) {
  const uploadInput = document.getElementById("photoUploadInput");
  const uploadStatus = document.getElementById("uploadStatus");
  if (!uploadInput || !uploadInput.files?.length) {
    if (uploadStatus) uploadStatus.textContent = "请先选择要上传的图片。";
    return;
  }

  const file = uploadInput.files[0];

  if (uploadStatus) uploadStatus.textContent = "正在上传...";
  try {
    await uploadObjectPhoto(file, context.sourceCode, context.photoObjectType);
    if (uploadStatus) uploadStatus.textContent = "上传成功。";
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
  } catch (error) {
    console.error("上传照片失败：", error);
    if (uploadStatus) uploadStatus.textContent = `上传失败：${error.message}`;
  }
}

async function handlePhotoDelete(photoRecord, context) {
  const confirmed = await customConfirm("确定要删除这张照片吗？", {
    title: "删除照片",
    isDanger: true
  });
  if (!confirmed) return;

  try {
    await deleteObjectPhoto(photoRecord);
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
  } catch (error) {
    console.error("删除照片失败：", error);
    window.alert(`删除失败：${error.message}`);
  }
}

async function handleFieldSave(context, fieldKey, newValue) {
  const saveStatus = document.getElementById("saveStatus");
  if (saveStatus) saveStatus.textContent = "正在保存...";

  try {
    // Special handling for building code rename
    if (fieldKey === "房屋编码" && newValue.trim() !== context.sourceCode) {
      await renameBuildingCodeInDb(context.spaceId, context.sourceCode, newValue.trim());

      if (activeFeature && activeFeature.get("sourceCode") === context.sourceCode) {
        activeFeature.set("sourceCode", newValue.trim());
        activeFeature.set("displayName", newValue.trim());
        const oldBaseRow = activeFeature.get("baseRow") || {};
        activeFeature.set("baseRow", { ...oldBaseRow, "房屋编码": newValue.trim(), "房屋名称": newValue.trim() });
      }

      if (currentSelectedObject && currentSelectedObject.sourceCode === context.sourceCode) {
        currentSelectedObject.sourceCode = newValue.trim();
        currentSelectedObject.displayName = newValue.trim();
      }

      if (window.Village3D && typeof window.Village3D.reload === "function") {
        await window.Village3D.reload(newValue.trim());
      }

      const refreshedBaseRow = activeFeature?.get("baseRow") || context.baseRow || buildFallbackObjectRow(newValue.trim(), context.layerKey, activeFeature?.get("rawFeature"));
      await showObjectInfo(refreshedBaseRow, context.layerKey, newValue.trim(), { flashSaved: true });

      if (saveStatus) saveStatus.textContent = "保存成功。";
      setTimeout(() => { if (saveStatus) saveStatus.textContent = ""; }, 2000);
      return true;
    }

    const payload = { [fieldKey]: newValue.trim() };
    await saveObjectEdits(context.sourceCode, context.editObjectType, payload);

    if (activeFeature && activeFeature.get("sourceCode") === context.sourceCode) {
      const oldBaseRow = activeFeature.get("baseRow") || {};
      activeFeature.set("baseRow", { ...oldBaseRow, [fieldKey]: newValue.trim() });
      planVectorLayer?.changed();
    }

    const rowEl = document.querySelector(`[data-field-key="${fieldKey}"]`);
    if (rowEl) {
      const valueEl = rowEl.querySelector(".house-value");
      const editableFields = getEditableFields(context.layerKey);
      const fieldConfig = editableFields.find((f) => f.key === fieldKey);
      const suffix = fieldConfig?.suffix && newValue.trim() !== "" ? fieldConfig.suffix : "";
      const displayValue = newValue.trim() === "" ? "—" : newValue.trim();
      if (valueEl) {
        valueEl.textContent = displayValue + suffix;
      }
    }

    if (saveStatus) saveStatus.textContent = "保存成功。";
    setTimeout(() => {
      if (saveStatus) saveStatus.textContent = "";
    }, 2000);

    // Notify 3D to refresh if same building is selected
    if (context.layerKey === "building" && window.Village3D && typeof window.Village3D.refreshEntityInfo === "function") {
      await window.Village3D.refreshEntityInfo(context.sourceCode);
    }

    // Sync building height geometry in 3D immediately
    if (context.layerKey === "building" && fieldKey === "建筑高度" && window.Village3D && typeof window.Village3D.refreshBuildingHeight === "function") {
      window.Village3D.refreshBuildingHeight(context.sourceCode, newValue.trim());
    }

    return true;
  } catch (error) {
    console.error("保存字段失败：", error);
    if (saveStatus) saveStatus.textContent = `保存失败：${error.message}`;
    return false;
  }
}

async function handleObjectSave(context) {
  const saveStatus = document.getElementById("saveStatus");
  const saveBtn = document.getElementById("saveBuildingBtn");

  const payload = collectEditPayload(context.layerKey, context.sourceCode);
  if (!payload) return;

  if (saveBtn) saveBtn.disabled = true;
  if (saveStatus) saveStatus.textContent = "正在保存...";

  try {
    await saveObjectEdits(context.sourceCode, context.editObjectType, payload);
    if (saveStatus) saveStatus.textContent = "保存成功。";
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode, { flashSaved: true });
  } catch (error) {
    console.error("保存对象属性失败：", error);
    if (saveStatus) saveStatus.textContent = `保存失败：${error.message}`;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function bindInfoModeSwitch(context) {
  const modeButtons = document.querySelectorAll(".mode-switch-btn");
  modeButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const nextMode = button.dataset.mode;
      if (!nextMode || nextMode === currentInfoMode) return;
      currentInfoMode = nextMode;
      await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
    });
  });
}

function bindInlineEdit(context) {
  if (!context.allowEdit) return;

  const editButtons = document.querySelectorAll(".edit-field-btn");
  editButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const rowEl = btn.closest(".editable-row");
      if (!rowEl) return;

      const fieldKey = rowEl.dataset.fieldKey;
      const fieldLabel = rowEl.dataset.fieldLabel;
      const valueEl = rowEl.querySelector(".house-value");
      if (!valueEl || rowEl.querySelector(".inline-edit-input")) return;

      const currentText = valueEl.textContent;
      const currentValue = currentText === "—" ? "" : currentText;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-edit-input";
      input.value = currentValue;
      input.style.cssText = "flex:1;padding:4px 8px;border:1px solid #1976d2;border-radius:4px;font-size:14px;outline:none;";

      valueEl.style.display = "none";
      btn.style.display = "none";
      rowEl.insertBefore(input, btn);
      input.focus();
      input.select();

      const saveEdit = async () => {
        const newValue = input.value;
        if (newValue !== currentValue) {
          const success = await handleFieldSave(context, fieldKey, newValue);
          if (!success) {
            valueEl.style.display = "";
            btn.style.display = "";
            input.remove();
            return;
          }
        }

        const editableFields = getEditableFields(context.layerKey);
        const fieldConfig = editableFields.find((f) => f.key === fieldKey);
        const suffix = fieldConfig?.suffix && newValue.trim() !== "" ? fieldConfig.suffix : "";
        const displayValue = newValue.trim() === "" ? "—" : newValue.trim();
        valueEl.textContent = displayValue + suffix;
        valueEl.style.display = "";
        btn.style.display = "";
        input.remove();
      };

      const cancelEdit = () => {
        valueEl.style.display = "";
        btn.style.display = "";
        input.remove();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelEdit();
        }
      });

      input.addEventListener("blur", () => {
        setTimeout(() => {
          if (document.activeElement !== input) {
            saveEdit();
          }
        }, 200);
      });
    });
  });
}

async function showObjectInfo(baseRow, layerKey, sourceCode, options = {}) {
  const currentSpace = getCurrentSpace();
  const config = layerConfigs[layerKey];
  const baseObjectType = config?.objectType || "";

  const readonlySpace = !!currentSpace?.readonly;
  const showPhotoBlock = layerKey !== "road";
  // 说明
  const allowLayerEdit = canEditLayer(layerKey, readonlySpace);
  // 说明
  const allowPhotoEdit = showPhotoBlock && (allowLayerEdit || currentSpace?.id === BASE_SPACE_ID);

  const editObjectType = getEditNamespaceObjectType(baseObjectType, currentSpaceId);
  const photoObjectType = getPhotoNamespaceObjectType(baseObjectType, currentSpaceId);
  const commentObjectType = getCommentNamespaceObjectType(baseObjectType, currentSpaceId);

  const editData = allowLayerEdit
    ? await fetchObjectEdits(sourceCode, editObjectType)
    : null;

  let mergedRow = mergeObjectRow(baseRow, editData);

  if (layerKey === "building") {
    mergedRow = normalizeBuildingInfoRow(mergedRow, sourceCode);
  } else if (layerKey === "road") {
    mergedRow = normalizeRoadInfoRow(mergedRow, sourceCode);
  }

  const objectName = getRowName(mergedRow, layerKey) || sourceCode || config?.label || "对象";

  const context = {
    sourceCode,
    layerKey,
    baseObjectType,
    editObjectType,
    photoObjectType,
    commentObjectType,
    config,
    baseRow,
    mergedRow,
    allowEdit: allowLayerEdit,
    spaceId: currentSpaceId
  };

  currentSelectedObject = {
    sourceCode,
    displayName: objectName,
    layerKey,
    layerLabel: config?.label || "对象",
    spaceId: currentSpaceId
  };
  update2DStatusText();

  const dbPhotos = showPhotoBlock && sourceCode && photoObjectType ? await fetchObjectPhotos(sourceCode, photoObjectType) : [];
  const commentList = sourceCode && commentObjectType ? await fetchObjectComments(sourceCode, commentObjectType) : [];
  const csvPhotoList = showPhotoBlock
    ? getRowPhotoValue(baseRow, layerKey)
        .split("|")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : [];

  const mergedPhotos = [
    ...csvPhotoList.map((src) => ({ src, source: "csv" })),
    ...dbPhotos.map((item) => ({
      id: item.id,
      src: item.photo_url,
      photo_path: item.photo_path,
      source: "db"
    }))
  ];

  const detailHtml = buildEditableDetailHtml(mergedRow, layerKey, allowLayerEdit);
  const saveStatusHtml = options.flashSaved
    ? `<div id="saveStatus" class="save-status success-inline">保存成功。</div>`
    : `<div id="saveStatus" class="save-status"></div>`;

  const photosHtml = mergedPhotos.length
    ? `
      <div class="photo-card">
        <div class="photo-slider-wrapper">
          <div class="photo-slider">
            ${mergedPhotos.map((item, index) => `
              <div class="photo-slide">
                <img
                  class="house-photo"
                  src="${item.src}"
                  alt="${escapeHtml(objectName)}-${index + 1}"
                  onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<div class=&quot;img-error&quot;>图片加载失败</div>')"
                >
                ${
                  item.source === "db" && allowPhotoEdit
                    ? `<div class="photo-actions">
                         <button class="delete-photo-btn space-icon-btn space-delete-icon-btn" type="button" data-photo-id="${item.id}" title="删除照片">
                           <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                             <polyline points="3 6 5 6 21 6"></polyline>
                             <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                           </svg>
                         </button>
                       </div>`
                    : item.source === "csv"
                      ? `<div class="photo-source-tag">本地预置照片</div>`
                      : `<div class="photo-source-tag">${readonlySpace ? "当前空间仅查看" : "对象照片"}</div>`
                }
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `
    : `<div class="no-photo">暂无照片</div>`;

  const uploadBlockHtml = !showPhotoBlock
    ? ""
    : allowPhotoEdit
      ? `
      <div class="info-card">
        <div class="photo-header-row">
          <h3 class="house-title">照片</h3>
          <button class="space-icon-btn space-add-icon-btn" type="button" id="photoUploadTrigger" title="上传照片">+</button>
        </div>
        <input type="file" id="photoUploadInput" accept="image/*" style="display:none" />
        <div class="house-row" id="uploadStatus"></div>
        ${photosHtml}
      </div>
    `
      : `
      <div class="info-card">
        <h3 class="house-title">照片说明</h3>
        <div class="house-row">当前空间为只读，仅展示该对象已有照片。</div>
        ${photosHtml}
      </div>
    `;

  const commentStatusHtml = !supabaseClient
    ? `<div class="comment-tip">当前未配置 Supabase，留言功能不可用。</div>`
    : !commentsTableReady
      ? `<div class="comment-tip">留言功能未启用：请先创建 Supabase 表 <code>object_comments</code>。</div>`
      : !currentUserName
        ? `<div class="comment-tip">请先在首页确认身份后再留言。</div>`
        : `<div class="comment-tip">以“${escapeHtml(currentUserName)}”身份发言</div>`;

  const commentListHtml = commentList.length
    ? `<div class="comment-list">${commentList.map((item) => `
        <div class="comment-item">
          <div class="comment-meta">
            <span class="comment-author">${escapeHtml(item.author_name || "匿名")}</span>
            <span class="comment-time">${escapeHtml(formatDateTime(item.created_at))}</span>
          </div>
          <div class="comment-content">${escapeHtml(item.content || "")}</div>
        </div>
      `).join("")}</div>`
    : `<div class="comment-empty">暂无留言，欢迎发表第一条意见。</div>`;

  const commentInputHtml = supabaseClient && commentsTableReady
    ? `
      <div class="comment-compose">
        <textarea
          id="commentInput"
          class="comment-input"
          maxlength="200"
          placeholder="请围绕该要素提出问题、建议或修改意见（最多200字）"
          ${currentUserName ? "" : "disabled"}
        ></textarea>
        <div class="comment-compose-footer">
          <span id="commentCount" class="comment-count">0/200</span>
          <button id="commentSubmitBtn" class="upload-btn" type="button" ${currentUserName ? "" : "disabled"}>发布留言</button>
        </div>
      </div>
    `
    : "";

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">${layerKey === "building" ? "建筑信息" : `${escapeHtml(config?.label || "对象")}信息`}</h3>
      ${detailHtml}
      ${saveStatusHtml}
    </div>

    ${uploadBlockHtml}
    <div class="info-card comment-card">
      <h3 class="house-title">留言板</h3>
      ${commentStatusHtml}
      ${commentInputHtml}
      ${commentListHtml}
    </div>
  `;

  bindInlineEdit(context);

  const uploadInput = document.getElementById("photoUploadInput");
  if (uploadInput) {
    uploadInput.addEventListener("change", async () => {
      await handlePhotoUpload(context);
      uploadInput.value = "";
    });
  }

  const uploadTrigger = document.getElementById("photoUploadTrigger");
  if (uploadTrigger && uploadInput) {
    uploadTrigger.addEventListener("click", () => {
      uploadInput.click();
    });
  }

  const deleteButtons = document.querySelectorAll(".delete-photo-btn");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photoId = Number(btn.dataset.photoId);
      const targetPhoto = dbPhotos.find((item) => item.id === photoId);
      if (targetPhoto) {
        await handlePhotoDelete(targetPhoto, context);
      }
    });
  });

  const commentInput = document.getElementById("commentInput");
  const commentCount = document.getElementById("commentCount");
  const commentSubmitBtn = document.getElementById("commentSubmitBtn");

  if (commentInput && commentCount) {
    const syncCount = () => {
      commentCount.textContent = `${commentInput.value.length}/200`;
    };
    commentInput.addEventListener("input", syncCount);
    syncCount();
  }

  if (commentSubmitBtn && commentInput) {
    commentSubmitBtn.addEventListener("click", async () => {
      const content = String(commentInput.value || "").trim();
      if (!content) {
        showToast("留言内容不能为空", "error");
        return;
      }
      if (!currentUserName) {
        showToast("请先在首页确认身份后再留言", "error");
        return;
      }

      commentSubmitBtn.disabled = true;
      try {
        await createObjectComment(context.sourceCode, context.commentObjectType, currentUserName, content);
        await refreshCommentHighlightsForCurrentSpace();
        await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
        showToast("留言已发布", "success");
      } catch (error) {
        console.error("发布留言失败：", error);
        showToast(error?.message || "发布留言失败，请稍后重试", "error");
      } finally {
        commentSubmitBtn.disabled = false;
      }
    });
  }
}

function bindStoryEvents() {
  // 说明
  // 说明
}

function bindHomeButton() {
  const homeBtn = document.getElementById("homeBtn");
  if (!homeBtn) return;
  homeBtn.addEventListener("click", () => {
    showVillageOverview();
  });
}

function bindStatusBadgeClick() {
  if (!statusBadge) return;
  statusBadge.addEventListener("click", async () => {
    if (!statusBadge.classList.contains("is-enter-btn")) return;
    if (!currentUserName) {
      showToast("请先确认身份后再进入互动平台", "error");
      return;
    }

    const baseSpace = getSpaceById(BASE_SPACE_ID);
    if (!baseSpace) return;

    baseSpace.viewMode = "2d";
    baseSpace.basemapVisible = true;
    saveBasemapLabelVisible(true);
    setSpaceSelectedLayers(BASE_SPACE_ID, ["building"]);

    await handleSpaceSelect(BASE_SPACE_ID);
  });
}

function bindResizeObserver() {
  const mapFrame = document.querySelector(".map-frame");
  if (!mapFrame || typeof ResizeObserver === "undefined") return;

  resizeObserver = new ResizeObserver(() => {
    if (plan2dView.classList.contains("active")) {
      if (resizeOverlayRaf) return;
      resizeOverlayRaf = requestAnimationFrame(() => {
        resizeOverlayRaf = 0;
        if (planMap) planMap.updateSize();
      });
    }
  });

  resizeObserver.observe(mapFrame);
}

function bindBasemapToggle() {
  document.body.addEventListener("click", async (e) => {
    const basemapBtn = e.target.closest("[data-basemap-toggle]");
    const labelBtn = e.target.closest("[data-basemap-label-toggle]");

    if (basemapBtn) {
      const target = getSpaceById(currentSpaceId);
      if (target) {
        target.basemapVisible = !target.basemapVisible;
        saveSpacesToStorage();
        if (!target.basemapVisible) {
          saveBasemapLabelVisible(false);
        }
      }
      await ensurePlanMap();
      syncBasemapUIBySpace(currentSpaceId);
      await refresh2DOverlay();
      renderSpaceList();
      return;
    }

    if (labelBtn) {
      const currentVisible = loadBasemapLabelVisible();
      saveBasemapLabelVisible(!currentVisible);
      await ensurePlanMap();
      syncBasemapUIBySpace(currentSpaceId);
      renderSpaceList();
      return;
    }
  });
}

function bindAddSpaceButton() {
  document.body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-add-space]")) {
      await createCopySpace();
    }
  });
}

async function init() {
  if (!hasRequiredNewLayout()) {
    console.error("index.html 结构不匹配，请同步替换新版 index.html / style.css / app.js。");
    if (infoPanel) {
      infoPanel.innerHTML = `
        <div class="placeholder-block">
          <h3>页面结构不匹配</h3>
          <p>请同步替换新版 index.html、style.css、app.js。</p>
        </div>
      `;
    }
    return;
  }

  try {
    userProfiles = loadUsersFromStorage();
    saveUsersToStorage();
    const persistedUser = loadActiveUserFromStorage();
    currentUserName = userProfiles.includes(persistedUser) ? persistedUser : "";

    spaces = loadSpacesFromStorage();
    console.log("Initialized spaces:", spaces);
    sync2DSpaceStateTo3D();

    renderSpaceList();
    syncSidebarExpansionUI();
    bindStoryEvents();
    bindHomeButton();
    bindStatusBadgeClick();
    bindBasemapToggle();
    bindAddSpaceButton();
    bindResizeObserver();
    ensureBuildingEditorToolbar();
    showVillageOverview();

    await ensurePlanMap();

    window.addEventListener("resize", () => {
      if (plan2dView.classList.contains("active")) {
        planMap?.updateSize();
      }
    });
  } catch (error) {
    console.error("初始化失败：", error);
    infoPanel.classList.remove("empty");
    infoPanel.innerHTML = `
      <div class="placeholder-block">
        <h3>加载失败</h3>
        <p>请检查各图层的 CSV、GeoJSON、orthophoto.png 与路径是否正确。</p>
      </div>
    `;
  }

  bindMcExportButton();
  bindRecenterButton();
}

function bindRecenterButton() {
  // 绑定2D定位按钮
  const btn2d = document.getElementById("recenterBtn");
  if (btn2d) {
    btn2d.addEventListener("click", () => {
      recenterMapToVillage();
    });
  }
  
  // 绑定3D定位按钮
  const btn3d = document.getElementById("recenter3dBtn");
  if (btn3d) {
    btn3d.addEventListener("click", () => {
      if (window.Village3D && typeof window.Village3D.recenter === "function") {
        window.Village3D.recenter();
      }
    });
  }
}

function recenterMapToVillage() {
  if (!planMap) return;
  const view = planMap.getView();
  const georef = activeBasemapGeoref || BASEMAP_GEOREF;
  const center = [
    (georef.minX + georef.maxX) / 2,
    (georef.minY + georef.maxY) / 2
  ];
  view.animate({
    center: center,
    zoom: 16.5,
    duration: 400
  });
}

// ===== Custom Confirm Modal =====
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast-item ${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, 3000);
}

function customConfirm(message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customConfirmModal");
    const messageEl = document.getElementById("customConfirmMessage");
    const okBtn = document.getElementById("customConfirmOk");
    const cancelBtn = document.getElementById("customConfirmCancel");
    const titleEl = modal.querySelector(".custom-modal-title");
    
    // Set content
    messageEl.textContent = message;
    if (options.title) {
      titleEl.textContent = options.title;
    } else {
      titleEl.textContent = "确认";
    }
    
    // Set button text
    if (options.okText) {
      okBtn.textContent = options.okText;
    } else {
      okBtn.textContent = "确认";
    }
    
    if (options.cancelText) {
      cancelBtn.textContent = options.cancelText;
    } else {
      cancelBtn.textContent = "取消";
    }
    
    // Set danger style if needed
    if (options.isDanger) {
      okBtn.classList.add("danger");
    } else {
      okBtn.classList.remove("danger");
    }
    
    // Show modal
    modal.style.display = "flex";
    
    // Handle OK
    const handleOk = () => {
      cleanup();
      resolve(true);
    };
    
    // Handle Cancel
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    // Handle click outside
    const handleOutside = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(false);
      }
    };
    
    // Handle Escape key
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      }
    };
    
    // Cleanup function
    const cleanup = () => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", handleOk);
      cancelBtn.removeEventListener("click", handleCancel);
      modal.removeEventListener("click", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    
    // Add listeners
    okBtn.addEventListener("click", handleOk);
    cancelBtn.addEventListener("click", handleCancel);
    modal.addEventListener("click", handleOutside);
    document.addEventListener("keydown", handleEscape);
  });
}

function customPrompt(message, defaultValue = "", title = "输入", options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customPromptModal");
    const messageEl = document.getElementById("customPromptMessage");
    const inputEl = document.getElementById("customPromptInput");
    const countEl = document.getElementById("customPromptCount");
    const okBtn = document.getElementById("customPromptOk");
    const cancelBtn = document.getElementById("customPromptCancel");
    const titleEl = document.getElementById("customPromptTitle");

    const maxLength = options.maxLength || null;
    const required = options.required !== false;

    messageEl.textContent = message;
    titleEl.textContent = title;
    inputEl.value = defaultValue || "";
    if (maxLength) {
      inputEl.setAttribute("maxlength", maxLength);
      countEl.textContent = `${inputEl.value.length}/${maxLength}`;
      countEl.style.display = "";
    } else {
      inputEl.removeAttribute("maxlength");
      countEl.textContent = "";
      countEl.style.display = "none";
    }

    modal.style.display = "flex";
    requestAnimationFrame(() => inputEl.focus());

    const cleanup = () => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", handleOk);
      cancelBtn.removeEventListener("click", handleCancel);
      inputEl.removeEventListener("input", handleInput);
      inputEl.removeEventListener("keydown", handleKeydown);
      modal.removeEventListener("click", handleOutside);
    };

    const handleInput = () => {
      if (maxLength) {
        countEl.textContent = `${inputEl.value.length}/${maxLength}`;
      }
    };

    const handleOk = () => {
      if (required && inputEl.value.trim() === "") {
        showToast("输入不能为空", "error");
        return;
      }
      cleanup();
      resolve(inputEl.value);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    const handleKeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    const handleOutside = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    okBtn.addEventListener("click", handleOk);
    cancelBtn.addEventListener("click", handleCancel);
    inputEl.addEventListener("input", handleInput);
    inputEl.addEventListener("keydown", handleKeydown);
    modal.addEventListener("click", handleOutside);
  });
}

// Make it globally available
window.customConfirm = customConfirm;
window.customPrompt = customPrompt;

init();







