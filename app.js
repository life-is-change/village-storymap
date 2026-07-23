const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
// 默认开启 Supabase；如需临时切回纯本地模式，可将 village_enable_supabase 设为 "false"。
const ENABLE_SUPABASE_SYNC = (() => {
  try {
    return localStorage.getItem("village_enable_supabase") !== "false";
  } catch (_) {
    return true;
  }
})();

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";
const OBJECT_EDITS_TABLE = "object_attribute_edits";
const OBJECT_COMMENTS_TABLE = "object_comments";
const COMMUNITY_TASKS_TABLE = "community_tasks";
const POINTS_LEDGER_TABLE = "points_ledger";
const USER_STATS_TABLE = "user_stats";
const COMMUNITY_TASK_PHOTO_OBJECT_TYPE = "community_task";
const COMMUNITY_TASK_REQUIRED_PHOTO_CATEGORIES = new Set(["garbage", "road_damage", "drainage_issue"]);
const COMMUNITY_DAILY_POINTS_CAP = 20;
const BUILDING_EDGE_LABEL_LAYER_KEY = "__buildingEdgeLabel";

const PLANNING_FEATURES_TABLE = "planning_features";
const PLANNING_SPACES_TABLE = "planning_spaces";
const ROAD_DEFAULT_WIDTH = 4;
const EDITABLE_GEOMETRY_LAYERS = ["building", "road", "water", "contours"];
const LAYER_CODE_PREFIX = {
  building: "H",
  road: "R",
  water: "W"
};
const LAYER_CODE_FIELD = {
  building: "房屋编码",
  road: "道路编码",
  cropland: "农田编码",
  openSpace: "公共空间编码"
};
LAYER_CODE_FIELD.water = "水系编码";

const LAYER_NAME_FIELD = {
  building: "房屋名称",
  road: "道路名称",
  cropland: "农田名称",
  openSpace: "公共空间名称"
};

LAYER_NAME_FIELD.water = "水系名称";

const buildingEditState = {
  mode: "idle",
  draw: null,
  modify: null,
  snap: null,
  translate: null,
  drawSketchGeometry: null,
  drawSketchGeometryChangeHandler: null,
  dirtyCodes: new Set(),
  deletedCodes: new Set(),
  pendingDeletedFeatures: [],
  pendingAddedFeatures: [],
  originalGeoms: new Map(),
  activeFeatureLocks: new Map(),
  lockHeartbeatTimer: null,
  isDrawingActive: false,
  editLayerKey: "",
  nextBuildingSerial: null,
  nextBuildingSerialPromise: null
};

const EDITABLE_FIELDS_BY_LAYER = {
  building: [
    { key: "房屋编码", label: "房屋编码", type: "text" },
    { key: "户主信息", label: "户主信息", type: "text" },
    { key: "建成年代", label: "建成年代", type: "text" },
    { key: "房屋结构信息", label: "房屋结构", type: "text" },
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
    { key: "种植情况", label: "种植情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ],
  openSpace: [
    { key: "公共空间编码", label: "公共空间编码", type: "text" },
    { key: "公共空间名称", label: "公共空间名称", type: "text" },
    { key: "空间类型", label: "空间类型", type: "text" },
    { key: "设施情况", label: "设施情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ],
  water: [
    { key: "水体编码", label: "水体编码", type: "text" },
    { key: "水体名称", label: "水体名称", type: "text" },
    { key: "水体类型", label: "水体类型", type: "text" },
    { key: "水质情况", label: "水质情况", type: "text" },
    { key: "备注", label: "备注", type: "text" }
  ]
};

const BASE_SPACE_ID = "current";
const SPACE_STORAGE_KEY = "village_planning_spaces_v3";
const USER_STORAGE_KEY = "village_planning_users_v1";
const ACTIVE_USER_STORAGE_KEY = "village_planning_active_user_v1";
const APP_STATE_KEY = "village_planning_app_state_v2";
const DEFAULT_SELECTED_LAYER_KEYS = ["building", "road", "water"];

const mainLayout = document.getElementById("mainLayout");
const map2dEl = document.getElementById("map2d");
const infoPanel = document.getElementById("infoPanel");
const statusBadge = document.getElementById("statusBadge");
const userGreetingBadge = document.getElementById("userGreetingBadge");
const floatingUserGreetingBadge = document.getElementById("floatingUserGreetingBadge");
const detailSubtitle = document.getElementById("detailSubtitle");
const storyItems = document.querySelectorAll(".story-item");

const overviewView = document.getElementById("overviewView");
const courseTaskSidebar = document.getElementById("courseTaskSidebar");
const courseTaskToggleBtn = document.getElementById("courseTaskToggleBtn");
const courseWorkbenchContent = document.getElementById("courseWorkbenchContent");
const courseTaskNav = document.getElementById("courseTaskNav");
const workspaceVillageLabel = document.getElementById("workspaceVillageLabel");
const workspaceStageLabel = document.getElementById("workspaceStageLabel");
const classDiscussionBtn = document.getElementById("classDiscussionBtn");
const projectSettingsBtn = document.getElementById("projectSettingsBtn");
const projectSettingsDrawer = document.getElementById("projectSettingsDrawer");
const projectSettingsCloseBtn = document.getElementById("projectSettingsCloseBtn");
const plan2dView = document.getElementById("plan2dView");
const model3dView = document.getElementById("model3dView");

const spaceList = document.getElementById("spaceList");
const floatingHomeBtn = document.getElementById("floatingHomeBtn");
const leftPanelToggleBtn = document.getElementById("leftPanelToggleBtn");
const rightPanelToggleBtn = document.getElementById("rightPanelToggleBtn");
const mapScaleBar = document.getElementById("mapScaleBar");
const mapScaleLabel = document.getElementById("mapScaleLabel");

const basemapToggle = document.getElementById("basemapToggle");
const basemapToggleWrap = document.getElementById("basemapToggleWrap");

const BASEMAP_LABEL_VISIBLE_KEY = "village_planning_basemap_label_visible_v1";
const COURSE_TASK_SIDEBAR_KEY = "village_course_task_sidebar_expanded_v1";
let basemapLabelToggle = null;

const supabaseClient = window.VillageSupabaseClient || (
  ENABLE_SUPABASE_SYNC &&
  typeof supabase !== "undefined" &&
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("你的项目ref") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("publishable key")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null
);

let planMap = null;
let planVectorSource = null;
let planVectorLayer = null;
let planOnlineLayer = null;
let planLabelLayer = null;
let planHighResLayer = null;
let edgeLabelSource = null;
let edgeLabelLayer = null;
let initialBaselineSource = null;
let initialBaselineLayer = null;
let initialBaselineDisplayMode = "";
let activeFeature = null;
let hoverFeature = null;
let olReady = null;
let resizeObserver = null;
let resizeOverlayRaf = 0;

const layerDataCache = {};
const buildingDbRowsCache = new Map();
const buildingDbHasAnyCache = new Map();
const roadDbRowsCache = new Map();
const roadDbHasAnyCache = new Map();
const croplandDbRowsCache = new Map();
const croplandDbHasAnyCache = new Map();
const openSpaceDbRowsCache = new Map();
const openSpaceDbHasAnyCache = new Map();
const waterDbRowsCache = new Map();
const waterDbHasAnyCache = new Map();
let currentSelectedObject = null;
let messageBoardSortOrder = "time_desc";
let currentInfoMode = "readonly";
const measure2DState = {
  active: false,
  source: null,
  layer: null,
  draw: null
};

let spaces = [];
let currentSpaceId = BASE_SPACE_ID;
let lastPlanningSpaceId = BASE_SPACE_ID;
let lastCollabSpaceId = BASE_SPACE_ID;
let userProfiles = [];
let currentUserName = "";
let activeWorkspaceAccountKey = "";
let courseService = null;
let activityLogger = null;
let courseWorkbench = null;
let geoprocessingPanel = null;
let geoprocessingAoiController = null;
let geoprocessingResultPreview = null;
let villagePreviewController = null;
let personalSpaceClient = null;
let objectInfoRequestSerial = 0;
let personalVersionCompareController = null;
let isCreatingSpace = false;
let currentGeometryEditLayer = "";
let communityGameTablesReady = true;
const communityTasksCache = new Map();
const communityTaskEditState = {
  mode: "idle",
  category: null,
  categoryLabel: "",
  promptTitle: "",
  hintText: "",
  pendingPayload: null
};
const communityTaskVisibleCategories = new Set([
  "garbage",
  "road_damage",
  "drainage_issue",
  "safety_hazard",
  "public_space_need"
]);

const COMMUNITY_TASK_TYPE_META = {
  garbage: {
    label: "垃圾点",
    promptTitle: "垃圾点",
    hintText: "点击地图标记垃圾点位置。"
  },
  road_damage: {
    label: "道路破损",
    promptTitle: "道路破损",
    hintText: "点击地图标记道路破损位置。"
  },
  drainage_issue: {
    label: "排水问题",
    promptTitle: "排水问题",
    hintText: "点击地图标记积水/排水问题位置。"
  },
  safety_hazard: {
    label: "安全隐患",
    promptTitle: "安全隐患",
    hintText: "点击地图标记安全隐患位置。"
  },
  public_space_need: {
    label: "公共空间需求",
    promptTitle: "公共空间需求",
    hintText: "点击地图标记需要增设公共空间的位置。"
  }
};

// 统一侧边栏展开状态（默认展开，空间列表常驻显示）
let isSpaceSidebarExpanded = true;
let isToolboxExpanded = false;
let isSpaceOptionsExpanded = true;
  let isCommunityExpanded = true;
  let isCommunityCompact = true;
  let isTeachingExpanded = false;
let isPlanningMode = false;
let isLeftPanelCollapsed = false;
let isRightPanelCollapsed = false;
let isCourseTaskSidebarExpanded = true;
let isProjectSettingsOpen = false;
let activeCourseTaskContext = null;
let shouldApplyInitialPlatformDefaults = false;
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
  imageUrl: "assets/orthophoto.webp",
  minX: 113.65748461603198,
  minY: 23.674477657916892,
  maxX: 113.67092900422122,
  maxY: 23.68110466469279,
  crs: "EPSG:4326"
};
const DEFAULT_VILLAGE_VIEW_ZOOM = 17.5;
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
      fetch(worldUrl).then((res) => {
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
      creatorName: "系统",
      createdAt: "",
      readonly: false,
      editEnabled: true,
      expanded: true,
      selectedLayers: [...DEFAULT_SELECTED_LAYER_KEYS],
      contourLabelsVisible: false,
      basemapVisible: false,
      viewMode: "2d"
    }
  ];
}

function normalizeSpaceTitleForCompare(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isSpaceTitleDuplicateInList(title, spaceList, ignoreSpaceId = "") {
  const normalizedTitle = normalizeSpaceTitleForCompare(title);
  if (!normalizedTitle) return false;

  return (Array.isArray(spaceList) ? spaceList : []).some((space) => {
    if (!space || space.id === ignoreSpaceId) return false;
    return normalizeSpaceTitleForCompare(space.title) === normalizedTitle;
  });
}

function isSpaceTitleDuplicate(title, ignoreSpaceId = "") {
  return isSpaceTitleDuplicateInList(title, spaces, ignoreSpaceId);
}

function makeUniqueSpaceTitle(baseTitle = "规划空间", spaceList = spaces, ignoreSpaceId = "") {
  const trimmedBase = String(baseTitle || "").trim() || "规划空间";
  if (!isSpaceTitleDuplicateInList(trimmedBase, spaceList, ignoreSpaceId)) {
    return trimmedBase;
  }

  for (let index = 2; index < 1000; index += 1) {
    const nextTitle = `${trimmedBase} ${index}`;
    if (!isSpaceTitleDuplicateInList(nextTitle, spaceList, ignoreSpaceId)) {
      return nextTitle;
    }
  }

  return `${trimmedBase} ${Date.now()}`;
}

function ensureUniqueSpaceTitles(spaceList) {
  const result = [];
  (Array.isArray(spaceList) ? spaceList : []).forEach((space) => {
    if (!space) return;
    if (space.id === BASE_SPACE_ID) {
      result.push(space);
      return;
    }

    result.push({
      ...space,
      title: makeUniqueSpaceTitle(space.title || "规划空间", result, space.id)
    });
  });
  return result;
}

function loadSpacesFromStorage() {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(SPACE_STORAGE_KEY));
    if (!raw) return getDefaultSpaces();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return getDefaultSpaces();

    const hasBase = parsed.some((s) => s.id === BASE_SPACE_ID);
    if (!hasBase) {
      parsed.unshift({
        id: BASE_SPACE_ID,
        title: "现状空间",
        creatorName: "系统",
        createdAt: "",
        readonly: true,
        editEnabled: false,
        expanded: true,
        selectedLayers: [...DEFAULT_SELECTED_LAYER_KEYS],
        basemapVisible: false,
        viewMode: "2d"
      });
    }

    const loadedSpaces = parsed.map((s) => {
      const rawTitle = String(s?.title || "");
      const normalizedTitle =
        s.id === BASE_SPACE_ID
          ? "现状空间"
          : (rawTitle.trim() || "规划空间");

      return {
      id: s.id,
      title: normalizedTitle,
      creatorName: s.id === BASE_SPACE_ID
        ? "系统"
        : String(s?.creatorName || s?.ownerName || s?.createdBy || "").trim(),
      createdAt: String(s?.createdAt || ""),
      readonly: s.id === BASE_SPACE_ID ? false : !!s.readonly,
      editEnabled: s.id === BASE_SPACE_ID ? true : (typeof s.editEnabled === "boolean" ? s.editEnabled : true),
      expanded: typeof s.expanded === "boolean" ? s.expanded : true,
      selectedLayers: Array.isArray(s.selectedLayers)
        ? s.selectedLayers
        : (s.id === BASE_SPACE_ID ? [...DEFAULT_SELECTED_LAYER_KEYS] : ["building"]),
      contourLabelsVisible: s.contourLabelsVisible === true,
      basemapVisible: !!s.basemapVisible,
      viewMode: s.viewMode || "2d",
      courseId: String(s?.courseId || ""),
      courseGroupId: String(s?.courseGroupId || ""),
      spaceType: String(s?.spaceType || "")
    };
    });

    return ensureUniqueSpaceTitles(loadedSpaces);
  } catch (error) {
    console.warn("读取空间配置失败，已回退默认值：", error);
    return getDefaultSpaces();
  }
}

function saveSpacesToStorage({ syncRemote = true } = {}) {
  try {
    localStorage.setItem(getAccountStorageKey(SPACE_STORAGE_KEY), JSON.stringify(spaces));
  } catch (error) {
    console.warn("保存空间配置失败：", error);
  }
  // 异步同步到 Supabase（不阻塞）
  if (syncRemote) saveSpacesToSupabase();
}

async function loadSpacesFromSupabase() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from(PLANNING_SPACES_TABLE)
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("从 Supabase 加载空间列表失败：", error);
      return null;
    }

    if (!Array.isArray(data) || data.length === 0) return null;

    return data.map((row) => ({
      id: row.id,
      title: row.title,
      creatorName: row.creator_name || "",
      createdAt: row.created_at,
      readonly: !!row.readonly,
      editEnabled: typeof row.edit_enabled === "boolean" ? row.edit_enabled : true,
      expanded: typeof row.expanded === "boolean" ? row.expanded : true,
      selectedLayers: Array.isArray(row.selected_layers) ? row.selected_layers : ["building"],
      basemapVisible: !!row.basemap_visible,
      viewMode: row.view_mode || "2d",
      courseId: row.course_id || "",
      courseGroupId: row.group_id || "",
      spaceType: row.space_type || ""
    }));
  } catch (err) {
    console.warn("从 Supabase 加载空间列表异常：", err);
    return null;
  }
}

async function saveSpacesToSupabase() {
  if (!supabaseClient) return;

  // 只保存规划空间（排除现状空间）
  const planningSpaces = spaces.filter((s) => (
    s.id !== BASE_SPACE_ID && s.spaceType !== "course_personal"
  ));
  if (planningSpaces.length === 0) return;

  try {
    const rows = planningSpaces.map((s) => ({
      id: s.id,
      title: s.title,
      creator_name: s.creatorName,
      created_at: s.createdAt || new Date().toISOString(),
      readonly: !!s.readonly,
      edit_enabled: typeof s.editEnabled === "boolean" ? s.editEnabled : true,
      expanded: typeof s.expanded === "boolean" ? s.expanded : true,
      selected_layers: Array.isArray(s.selectedLayers) ? s.selectedLayers : ["building"],
      basemap_visible: !!s.basemapVisible,
      view_mode: s.viewMode || "2d",
      course_id: s.courseId || null,
      group_id: s.courseGroupId || null,
      space_type: s.spaceType || null
    }));

    const { error } = await supabaseClient
      .from(PLANNING_SPACES_TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) {
      console.warn("保存空间列表到 Supabase 失败：", error);
    }
  } catch (err) {
    console.warn("保存空间列表到 Supabase 异常：", err);
  }
}

async function deleteSpaceFromSupabase(spaceId) {
  if (!supabaseClient || !spaceId || spaceId === BASE_SPACE_ID) return;
  try {
    const { error } = await supabaseClient
      .from(PLANNING_SPACES_TABLE)
      .delete()
      .eq("id", spaceId);

    if (error) {
      console.warn("从 Supabase 删除空间失败：", error);
    }
  } catch (err) {
    console.warn("从 Supabase 删除空间异常：", err);
  }
}

async function syncSpacesFromSupabase() {
  const remoteSpaces = await loadSpacesFromSupabase();
  if (!remoteSpaces) return;

  // 以服务器数据为准：保留本地现状空间 + 远程规划空间
  // 不再保留本地独有的规划空间，确保删除操作能跨设备同步
  const baseSpace = spaces.find((s) => s.id === BASE_SPACE_ID);

  const merged = [
    baseSpace || getDefaultSpaces()[0],
    ...remoteSpaces
  ];

  spaces = ensureUniqueSpaceTitles(merged);
  try {
    localStorage.setItem(getAccountStorageKey(SPACE_STORAGE_KEY), JSON.stringify(spaces));
  } catch (e) {}

  renderSpaceList();

  // 如果当前选中的空间在合并后不存在了，切换到现状空间
  if (!getSpaceById(currentSpaceId)) {
    currentSpaceId = BASE_SPACE_ID;
    saveAppState();
  }
}

  function saveAppState() {
  try {
    localStorage.setItem(getAccountStorageKey(APP_STATE_KEY), JSON.stringify({
      isPlanningMode,
      currentSpaceId,
      lastPlanningSpaceId,
      lastCollabSpaceId,
      isSpaceOptionsExpanded,
      isCommunityExpanded,
      isToolboxExpanded,
      isCommunityCompact,
      isTeachingExpanded,
      communityTaskVisibleCategories: Array.from(communityTaskVisibleCategories)
    }));
  } catch (error) {
    console.warn("保存应用状态失败：", error);
  }
}

function loadAppState() {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(APP_STATE_KEY));
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (typeof state.isPlanningMode === "boolean") isPlanningMode = state.isPlanningMode;
    if (typeof state.currentSpaceId === "string" && state.currentSpaceId.trim()) {
      currentSpaceId = state.currentSpaceId.trim();
    }
    if (typeof state.lastPlanningSpaceId === "string" && state.lastPlanningSpaceId.trim()) {
      lastPlanningSpaceId = state.lastPlanningSpaceId.trim();
    }
    if (typeof state.lastCollabSpaceId === "string" && state.lastCollabSpaceId.trim()) {
      lastCollabSpaceId = state.lastCollabSpaceId.trim();
    }
    if (typeof state.isSpaceOptionsExpanded === "boolean") isSpaceOptionsExpanded = state.isSpaceOptionsExpanded;
    if (typeof state.isCommunityExpanded === "boolean") isCommunityExpanded = state.isCommunityExpanded;
    if (typeof state.isToolboxExpanded === "boolean") isToolboxExpanded = state.isToolboxExpanded;
    if (typeof state.isCommunityCompact === "boolean") isCommunityCompact = state.isCommunityCompact;
    if (typeof state.isTeachingExpanded === "boolean") isTeachingExpanded = state.isTeachingExpanded;
    if (Array.isArray(state.communityTaskVisibleCategories)) {
      communityTaskVisibleCategories.clear();
      state.communityTaskVisibleCategories.forEach((c) => communityTaskVisibleCategories.add(c));
    }
    return true;
  } catch (error) {
    console.warn("读取应用状态失败：", error);
    return false;
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
    console.warn("读取账号列表失败，已使用默认账号：", error);
    return getDefaultUsers();
  }
}

function saveUsersToStorage() {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userProfiles));
  } catch (error) {
    console.warn("保存账号列表失败：", error);
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
    console.warn("保存当前账号失败：", error);
  }
}

function updateUserGreeting(viewKey = null) {
  const activeView =
    viewKey ||
    (overviewView?.classList.contains("active")
      ? "overview"
      : model3dView?.classList.contains("active")
        ? "model3d"
        : "plan2d");

  if (!currentUserName || activeView === "overview") {
    if (userGreetingBadge) {
      userGreetingBadge.textContent = "";
      userGreetingBadge.style.display = "none";
    }
    if (floatingUserGreetingBadge) {
      floatingUserGreetingBadge.textContent = "";
      floatingUserGreetingBadge.style.display = "none";
    }
    return;
  }

  const greetingHtml = `<span class="map-greeting-prefix">你好，</span><span class="map-greeting-name" role="button" tabindex="0" title="进入个人中心">${escapeHtml(currentUserName)}</span>`;
  if (userGreetingBadge) {
    userGreetingBadge.innerHTML = greetingHtml;
    userGreetingBadge.style.display = "";
  }
  if (floatingUserGreetingBadge) {
    floatingUserGreetingBadge.innerHTML = greetingHtml;
    floatingUserGreetingBadge.style.display = "";
  }
}

function setCurrentUser(name) {
  const nextName = String(name || "").trim();
  currentUserName = nextName;
  saveActiveUserToStorage(nextName);
  updateUserGreeting();
  const identityCurrentText = document.getElementById("identityCurrentText");
  if (identityCurrentText) {
    identityCurrentText.textContent = `当前账号：${nextName || "未选择"}`;
  }
  renderHomepageIdentityUi();
  refreshCommunityScoreBadge();
  if (!canManageSpace(currentSpaceId)) {
    clearBuildingInteractions();
  }
  updateBuildingEditorToolbarState();
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
        showToast("请选择账号", "error");
        return;
      }
      setCurrentUser(pickedName);
      showToast(`已切换账号：${pickedName}`, "success");
    });
  }

  if (createBtn && selectEl && !createBtn.dataset.bound) {
    createBtn.dataset.bound = "1";
    createBtn.addEventListener("click", async () => {
      const newName = await customPrompt(
        "请输入新账号名称（1-20个字符）",
        "",
        "创建新账号",
        { maxLength: 20, required: true }
      );
      if (newName === null) return;

      const normalized = String(newName).trim();
      if (!normalized) {
        showToast("请输入账号名称", "error");
        return;
      }

      if (userProfiles.includes(normalized)) {
        showToast("该账号已存在", "error");
        return;
      }

      userProfiles.push(normalized);
      saveUsersToStorage();
      setCurrentUser(normalized);

      selectEl.innerHTML = getUserOptionsHtml(normalized);
      selectEl.value = normalized;
      showToast(`账号创建成功：${normalized}`, "success");
    });
  }

  if (deleteBtn && selectEl && !deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = "1";
    deleteBtn.addEventListener("click", async () => {
      const selectedName = String(selectEl.value || "").trim();
      if (!selectedName) {
        showToast("请选择要删除的账号", "error");
        return;
      }
      if (selectedName === "管理员") {
        showToast("默认账号“管理员”不可删除", "error");
        return;
      }

      const confirmed = await customConfirm(`确认删除账号“${selectedName}”吗？`, {
        title: "删除账号",
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
      showToast(`已删除账号：${selectedName}`, "success");
    });
  }
}

function normalizeBridgeButtonLabel(label) {
  return String(label || "")
    .replace(/\s+/g, "")
    .trim();
}

function getHomeLandingFrameDoc() {
  const frame = document.getElementById("homeLandingFrame");
  return frame?.contentDocument || null;
}

function getHomepageAuthGroups(frameDoc) {
  if (!frameDoc) return [];
  const loginButtons = Array.from(frameDoc.querySelectorAll("button")).filter(
    (btn) => normalizeBridgeButtonLabel(btn.textContent) === "登录"
  );
  const groups = [];
  const seen = new Set();
  loginButtons.forEach((btn) => {
    const groupEl = btn.parentElement;
    if (!groupEl || seen.has(groupEl)) return;
    seen.add(groupEl);
    groups.push(groupEl);
  });
  return groups;
}

function openProfileCenterPage() {
  const user = window.VillageAuth ? window.VillageAuth.getCurrentUser() : null;
  if (!user) {
    if (window.VillageAuth) {
      window.VillageAuth.openAuthModal("login");
    } else {
      showToast("请先登录后再进入个人中心", "error");
    }
    return;
  }
  window.location.href = "./profile.html";
}

function renderHomepageIdentityUi(frameDoc = getHomeLandingFrameDoc()) {
  if (!frameDoc) return;
  if (window.VillageAuth && typeof window.VillageAuth.broadcastAuthState === "function") {
    window.VillageAuth.broadcastAuthState();
  }
}

function applyHomepageVisualTweaks(frameDoc) {
  if (!frameDoc) return;

  // 注入一键回顶按钮
  if (!frameDoc.getElementById("homeBackTopBtn")) {
    let backTopStyle = frameDoc.getElementById("homeBackTopStyle");
    if (!backTopStyle) {
      backTopStyle = frameDoc.createElement("style");
      backTopStyle.id = "homeBackTopStyle";
      backTopStyle.textContent = `
        #homeBackTopBtn {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid rgba(31, 53, 82, 0.12);
          background: rgba(255, 255, 255, 0.92);
          color: #2f7a2a;
          box-shadow: 0 4px 14px rgba(31, 53, 82, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.3s ease, transform 0.3s ease, background 0.2s ease;
          pointer-events: none;
        }
        #homeBackTopBtn.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }
        #homeBackTopBtn:hover {
          background: #ffffff;
          transform: translateY(-2px);
          box-shadow: 0 8px 22px rgba(31, 53, 82, 0.18);
        }
        #homeBackTopBtn svg {
          width: 20px;
          height: 20px;
        }
      `;
      frameDoc.head?.appendChild(backTopStyle);
    }
    const backTopBtn = frameDoc.createElement("button");
    backTopBtn.id = "homeBackTopBtn";
    backTopBtn.setAttribute("aria-label", "回到顶部");
    backTopBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;
    backTopBtn.addEventListener("click", () => {
      frameDoc.defaultView?.scrollTo({ top: 0, behavior: "smooth" });
    });
    frameDoc.body?.appendChild(backTopBtn);

    const toggleBackTop = () => {
      const scrollY = frameDoc.defaultView?.scrollY || 0;
      backTopBtn.classList.toggle("visible", scrollY > 300);
    };
    frameDoc.defaultView?.addEventListener("scroll", toggleBackTop, { passive: true });
    toggleBackTop();
  }

  let styleEl = frameDoc.getElementById("homeBridgeStyleFix");
  if (!styleEl) {
    styleEl = frameDoc.createElement("style");
    styleEl.id = "homeBridgeStyleFix";
    frameDoc.head?.appendChild(styleEl);
  }
  styleEl.textContent = `
    [data-home-more-btn='1'] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 0.75rem !important;
      min-width: 10rem !important;
      padding-left: 1.5rem !important;
      padding-right: 1.5rem !important;
      border-radius: 0.75rem !important;
      background: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.96) !important;
      color: #6b7280 !important;
      font-size: 1.125rem !important;
      font-weight: 600 !important;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
      transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease !important;
      animation: none !important;
    }
    [data-home-more-btn='1'] * {
      color: currentColor !important;
    }
    [data-home-more-btn='1']:hover {
      background: #f3f4f6 !important;
      color: #374151 !important;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
      transform: translateY(-1px) !important;
    }
    [data-home-more-btn='1']:hover * {
      color: currentColor !important;
    }
    [data-home-nav-list='1'] {
      position: absolute !important;
      left: 50% !important;
      top: 50% !important;
      transform: translate(-50%, -50%) !important;
    }
    [data-home-nav-link='1'] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 5rem !important;
      height: 2.5rem !important;
      padding: 0 0.25rem !important;
      line-height: 1 !important;
      text-align: center !important;
      white-space: nowrap !important;
    }
    [data-home-user-wrap='1'] {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.25rem !important;
      color: #ffffff !important;
    }
    [data-home-user-inline='1'] {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0.15rem !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #ffffff !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
    }
    [data-home-greeting-text='1'] {
      color: currentColor !important;
      font-size: 0.95rem !important;
      font-weight: 600 !important;
      line-height: 1 !important;
    }
    [data-home-identity-btn='1'] {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.95rem;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 600;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer;
    }
    [data-home-identity-btn='1'] svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    [data-home-identity-btn='1'] *,
    [data-home-auth-pill='1'] * {
      color: currentColor !important;
    }
    [data-home-identity-btn='1']:hover {
      background: rgba(255, 255, 255, 0.26);
    }
    [data-home-auth-pill='1'] {
      display: inline-flex !important;
      align-items: center !important;
      gap: 0 !important;
      padding: 0 !important;
      border-radius: 0 !important;
      border: 0 !important;
      appearance: none !important;
      font-family: inherit !important;
      line-height: 1 !important;
      font-size: 0.95rem !important;
      font-weight: 700 !important;
      background: transparent !important;
      color: #60a5fa !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      text-decoration: underline !important;
      text-underline-offset: 3px !important;
      transition: color 0.2s ease !important;
      cursor: pointer !important;
    }
    [data-home-auth-pill='1'] svg {
      display: none !important;
    }
    [data-home-auth-pill='1']:hover {
      background: transparent !important;
      color: #3b82f6 !important;
      box-shadow: none !important;
      transform: none !important;
    }
    [data-home-auth-pill='1']:focus-visible {
      outline: 2px solid rgba(96, 165, 250, 0.45) !important;
      outline-offset: 2px !important;
    }
    [data-home-profile-name='1'] {
      color: currentColor !important;
      text-decoration: inherit !important;
    }
    [data-home-logout-btn='1'] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 0.45rem !important;
      padding: 0.5rem 0.85rem !important;
      border-radius: 999px !important;
      border: 1px solid rgba(255, 255, 255, 0.28) !important;
      background: rgba(255, 255, 255, 0.12) !important;
      color: #ffffff !important;
      font-size: 0.9rem !important;
      font-weight: 600 !important;
      backdrop-filter: blur(8px);
      cursor: pointer !important;
      margin-left: 0.8rem !important;
      transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease !important;
    }
    [data-home-logout-btn='1'] svg {
      width: 16px !important;
      height: 16px !important;
      flex-shrink: 0 !important;
    }
    [data-home-logout-btn='1'] * {
      color: currentColor !important;
    }
    [data-home-logout-btn='1']:hover {
      background: rgba(255, 255, 255, 0.22) !important;
      color: #ffffff !important;
    }
    nav.glass [data-home-user-wrap='1'],
    nav.glass [data-home-user-inline='1'] {
      background: transparent !important;
      color: #374151 !important;
      box-shadow: none !important;
    }
    nav.glass [data-home-identity-btn='1'],
    nav.glass [data-home-auth-pill='1'] {
      background: transparent !important;
      border-color: transparent !important;
      color: #2563eb !important;
      box-shadow: none !important;
    }
    nav.glass [data-home-identity-btn='1']:hover,
    nav.glass [data-home-auth-pill='1']:hover {
      background: transparent !important;
      color: #1d4ed8 !important;
    }
    nav.glass [data-home-logout-btn='1'] {
      background: #ffffff !important;
      border-color: rgba(22, 101, 52, 0.16) !important;
      color: #166534 !important;
      box-shadow: 0 8px 20px rgba(22, 101, 52, 0.1) !important;
    }
    nav.glass [data-home-logout-btn='1']:hover {
      background: #ecfdf5 !important;
      color: #14532d !important;
    }
  `;

  const allButtons = Array.from(frameDoc.querySelectorAll("button"));
  const currentAuthUser = window.VillageAuth ? window.VillageAuth.getCurrentUser() : null;
  const bridgeDisplayName = String(currentAuthUser?.name || "").trim();
  allButtons.forEach((btn) => {
    const label = normalizeBridgeButtonLabel(btn.textContent);
    if (label.includes("了解更多")) {
      btn.setAttribute("data-home-more-btn", "1");
    }
    if (
      ["村庄现状", "教学目的", "现状问题", "区位与环境"].includes(label) &&
      btn.parentElement?.classList.contains("md:flex")
    ) {
      btn.setAttribute("data-home-nav-link", "1");
      btn.parentElement.setAttribute("data-home-nav-list", "1");
      btn.parentElement.parentElement?.classList.add("relative");
    }
  });

  const nav = frameDoc.querySelector("nav");
  if (nav) {
    if (!currentAuthUser) {
      nav.querySelectorAll("[data-home-logout-btn='1']").forEach((btn) => btn.remove());
    }
    Array.from(nav.querySelectorAll("div")).forEach((el) => {
      const parent = el.parentElement;
      const isDesktopAuthGroup =
        parent?.classList.contains("md:flex") &&
        parent?.classList.contains("gap-3");
      const looksLikeUserPill =
        el.matches("[data-home-user-inline='1']") ||
        (
          isDesktopAuthGroup &&
          el.classList.contains("rounded-full") &&
          !!el.querySelector("svg") &&
          !!el.querySelector("span")
        );

      if (looksLikeUserPill) {
        el.setAttribute("data-home-user-inline", "1");
        el.removeAttribute("data-home-auth-pill");
        el.removeAttribute("data-home-profile-btn");
        el.removeAttribute("role");
        el.removeAttribute("tabindex");
        el.removeAttribute("title");
        const nameText = bridgeDisplayName || String(el.textContent || "").trim().replace(/^你好，?/, "");
        if (nameText) {
          el.innerHTML = `
            <span data-home-greeting-text="1">你好，</span>
            <button type="button" data-home-auth-pill="1" data-home-profile-btn="1" title="进入个人中心">
              <span data-home-profile-name="1">${escapeHtml(nameText)}</span>
            </button>
          `;
        }

        if (currentAuthUser && parent && !parent.querySelector("[data-home-logout-btn='1']")) {
          const logoutBtn = frameDoc.createElement("button");
          logoutBtn.type = "button";
          logoutBtn.setAttribute("data-home-logout-btn", "1");
          logoutBtn.title = "退出登录";
          logoutBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span>退出登录</span>
          `;
          parent.appendChild(logoutBtn);
        }
      }
    });
  }
}

function ensureHomepageLogoutButton(frameDoc) {
  // 新版账号系统已移除注销按钮，不再在homepage iframe中注入注销按钮
  if (!frameDoc) return;
}

function bindHomepageLandingBridge() {
  const frame = document.getElementById("homeLandingFrame");
  if (!frame || frame.dataset.bridgeBound) return;
  frame.dataset.bridgeBound = "1";

  const scheduleIdentitySync = (frameDoc) => {
    if (!frameDoc) return;
    [0, 80, 250, 600, 1200, 2000].forEach((delay) => {
      setTimeout(() => {
        if (frame.contentDocument !== frameDoc) return;
        renderHomepageIdentityUi(frameDoc);
        ensureHomepageLogoutButton(frameDoc);
      }, delay);
    });
  };

  const bindInFrame = () => {
    const frameDoc = frame.contentDocument;
    if (!frameDoc?.documentElement) return;

    renderHomepageIdentityUi(frameDoc);
    ensureHomepageLogoutButton(frameDoc);
    scheduleIdentitySync(frameDoc);

    if (frameDoc.documentElement.dataset.identityBridgeBound) return;
    frameDoc.documentElement.dataset.identityBridgeBound = "1";

    frameDoc.addEventListener(
      "click",
      (event) => {
        const button = event.target?.closest?.("button, [role='button'], a");
        if (!button) return;

        const label = normalizeBridgeButtonLabel(button.textContent);
        const confirmBtn = document.getElementById("confirmIdentityBtn");
        const createBtn = document.getElementById("createIdentityBtn");
        const deleteBtn = document.getElementById("deleteIdentityBtn");
        const groupEl = button.parentElement;
        const pickedSelect = groupEl?.querySelector?.("[data-identity-picker='1']");
        const pickedName = String(pickedSelect?.value || "").trim();

        if (button.matches?.("[data-home-logout-btn='1']") || label.includes("退出登录")) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          if (window.VillageAuth && typeof window.VillageAuth.logout === "function") {
            (async () => {
              await window.VillageAuth.logout();
            })();
          }
          return;
        }

        if (
          button.matches?.("[data-home-profile-btn='1']") ||
          button.matches?.("[data-home-auth-pill='1']")
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          openProfileCenterPage();
          return;
        }

        if (label.includes("登录") || label.includes("注册")) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          if (window.VillageAuth) {
            window.VillageAuth.openAuthModal("login");
          }
          return;
        }

        if (button.matches?.("[data-home-identity-btn='1']")) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          if (window.VillageAuth) {
            window.VillageAuth.openAuthModal();
          }
          return;
        }

        if (label.includes("进入互动平台") || label.includes("立即进入平台")) {
          event.preventDefault();
          event.stopPropagation();
          statusBadge?.click();
        }
      },
      true
    );
  };

  frame.addEventListener("load", bindInFrame);
  bindInFrame();
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

function getBasemapRenderExtent(georef = activeBasemapGeoref || BASEMAP_GEOREF) {
  const minX = Number(georef?.minX);
  const minY = Number(georef?.minY);
  const maxX = Number(georef?.maxX);
  const maxY = Number(georef?.maxY);
  if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;
  return [minX, minY, maxX, maxY];
}

function isNonInteractiveLayerKey(layerKey) {
  return (
    layerKey === VILLAGE_FILL_LAYER_KEY ||
    layerKey === "contours" ||
    layerKey === "elevationBands" ||
    layerKey === BUILDING_EDGE_LABEL_LAYER_KEY ||
    layerKey === "initialBaseline"
  );
}

function getCurrentSpace() {
  return spaces.find((s) => s.id === currentSpaceId) || spaces[0];
}

function getSpaceById(spaceId) {
  return spaces.find((s) => s.id === spaceId) || null;
}

function getCourseUser() {
  const authUser = window.VillageAuth?.getCurrentUser?.() || {};
  return {
    name: String(authUser.name || currentUserName || "").trim(),
    student_id: String(authUser.student_id || authUser.studentId || "").trim()
  };
}

function getAccountStorageKey(baseKey) {
  const authUser = window.VillageAuth?.getCurrentUser?.() || {};
  return window.CourseWorkspaceAdapterModule.buildAccountStorageKey(baseKey, authUser);
}

function ensureCourseGroupSpace(group) {
  if (!group?.id || !group?.spaceId) return { space: null, created: false };
  const existing = getSpaceById(group.spaceId);
  if (existing) {
    existing.courseId = group.courseId || existing.courseId || "";
    existing.courseGroupId = group.id;
    existing.spaceType = "course_group";
    return { space: existing, created: false };
  }
  const baseSpace = getSpaceById(BASE_SPACE_ID) || getCurrentSpace();
  const newSpace = window.CourseWorkspaceAdapterModule.buildGroupPlanningSpace(
    group,
    getCourseUser().name,
    baseSpace
  );
  spaces.push(newSpace);
  saveSpacesToStorage();
  renderSpaceList();
  return { space: newSpace, created: true };
}

async function initializeCourseGroupSpaceData(spaceId) {
  const results = await Promise.allSettled([
    seedBuildingsForCopySpace(spaceId),
    seedRoadsForCopySpace(spaceId),
    seedWaterForCopySpace(spaceId)
  ]);
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    console.warn("课程小组空间部分基础数据初始化失败：", rejected.map((item) => item.reason));
  }
}

async function openCoursePlanningWorkspace(viewMode, group) {
  if (!group) {
    const baseSpace = getSpaceById(BASE_SPACE_ID);
    if (!baseSpace) {
      showToast("原有规划空间不存在", "error");
      return;
    }
    baseSpace.viewMode = viewMode === "3d" ? "3d" : "2d";
    setCurrentSpaceIdAndRemember(baseSpace.id);
    saveSpacesToStorage();
    saveAppState();
    sync2DSpaceStateTo3D();
    await handleSpaceSelect(baseSpace.id);
    return;
  }
  const { space, created } = ensureCourseGroupSpace(group);
  if (!space) {
    showToast("当前小组尚未建立规划空间", "error");
    return;
  }
  isPlanningMode = true;
  space.viewMode = viewMode === "3d" ? "3d" : "2d";
  setCurrentSpaceIdAndRemember(space.id);
  saveSpacesToStorage();
  saveAppState();
  sync2DSpaceStateTo3D();
  if (created) {
    showToast("正在初始化小组规划空间…", "info");
    await initializeCourseGroupSpaceData(space.id);
  }
  await handleSpaceSelect(space.id);
}

async function ensureCourseWorkbenchInitialized() {
  if (courseWorkbench) return courseWorkbench;
  if (
    !window.CourseModelModule ||
    !window.CourseServiceModule ||
    !window.ActivityLoggerModule ||
    !window.CourseWorkbenchModule ||
    !window.CourseWorkspaceAdapterModule ||
    !window.PersonalSpaceClientModule
  ) {
    throw new Error("课程工作台模块未完整加载。");
  }

  courseService = window.CourseServiceModule.createCourseService({
    storage: localStorage,
    supabaseClient,
    actorName: getCourseUser().name
  });
  activityLogger = window.ActivityLoggerModule.createActivityLogger({
    storage: localStorage,
    supabaseClient,
    getContext: () => {
      const user = getCourseUser();
      const context = courseWorkbench?.getContext?.() || {};
      return {
        actor: {
          studentKey: window.CourseModelModule.buildStudentKey(user),
          name: user.name
        },
        courseId: window.CourseModelModule.DEFAULT_COURSE.id,
        groupId: context.group?.id || "",
        taskId: courseWorkbench?.getActiveTaskId?.() || "",
        spaceId: context.group?.spaceId || currentSpaceId || "",
        viewMode: model3dView?.classList.contains("active") ? "3d" : "2d"
      };
    }
  });
  let coursePersonalSpace = null;
  if (supabaseClient) {
    personalSpaceClient = window.PersonalSpaceClientModule.createPersonalSpaceClient({ supabaseClient });
    try {
      const user = getCourseUser();
      coursePersonalSpace = await personalSpaceClient.ensure({
        courseId: window.CourseModelModule.DEFAULT_COURSE.id,
        villageId: "mibu",
        title: `${user.name || "学生"} · 个人图底空间`
      });
      const existingPersonalWorkspace = spaces.find((space) => String(space.id) === String(coursePersonalSpace.id));
      const selections = await personalSpaceClient.listSelections(coursePersonalSpace.id);
      const workspaceSpace = window.CourseWorkspaceAdapterModule.buildPersonalPlanningSpace({
        personalSpace: coursePersonalSpace,
        user,
        existingSpace: existingPersonalWorkspace,
        selections,
        courseId: window.CourseModelModule.DEFAULT_COURSE.id,
        villageId: "mibu"
      });
      const existingIndex = spaces.findIndex((space) => space.id === workspaceSpace.id);
      if (existingIndex >= 0) spaces[existingIndex] = { ...spaces[existingIndex], ...workspaceSpace };
      else spaces.push(workspaceSpace);
      saveSpacesToStorage();
      renderSpaceList();
    } catch (error) {
      console.warn("个人图底空间暂时无法初始化：", error);
    }
  }
  courseWorkbench = window.CourseWorkbenchModule.createCourseWorkbench({
    container: courseWorkbenchContent,
    navContainer: courseTaskNav,
    course: window.CourseModelModule.DEFAULT_COURSE,
    service: courseService,
    logger: activityLogger,
    getUser: getCourseUser,
    showToast,
    mountGeoprocessing: async (container) => {
      geoprocessingPanel?.destroy?.();
      geoprocessingAoiController?.destroy?.();
      geoprocessingResultPreview?.destroy?.();
      villagePreviewController?.destroy?.();
      geoprocessingPanel = null;
      geoprocessingAoiController = null;
      geoprocessingResultPreview = null;
      villagePreviewController = null;
      if (!container || !planMap || !supabaseClient) return;
      if (!window.GeoprocessingClientModule || !window.GeoprocessingAoiModule
          || !window.VillagePreviewModule
          || !window.GeoprocessingResultLayersModule || !window.GeoprocessingPanelModule) return;
      const client = window.GeoprocessingClientModule.createGeoprocessingClient({ supabaseClient });
      let availability = "offline";
      try { availability = (await client.getAvailability())?.state || "offline"; } catch (_) { /* queue remains usable */ }
      geoprocessingAoiController = window.GeoprocessingAoiModule.createAoiController({
        map: planMap,
        ol: window.__OL__,
        villageBounds: [113.6578225, 23.6739555, 113.6695615, 23.6806181],
        maxAreaSqKm: 2
      });
      villagePreviewController = window.VillagePreviewModule.createVillagePreviewController({
        map: planMap,
        ol: window.__OL__
      });
      geoprocessingResultPreview = window.GeoprocessingResultLayersModule.createResultLayerPreview({
        map: planMap,
        ol: window.__OL__,
        fetchJson: async (artifact) => {
          const signed = await client.createArtifactUrl(artifact.storage_path);
          const url = signed?.signedUrl || signed?.signedURL;
          if (!url) throw new Error("ARTIFACT_SIGNED_URL_REQUIRED");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`ARTIFACT_DOWNLOAD_${response.status}`);
          return response.json();
        }
      });
      geoprocessingPanel = window.GeoprocessingPanelModule.createGeoprocessingPanel({
        container,
        client,
        aoiController: geoprocessingAoiController,
        courseId: window.CourseModelModule.DEFAULT_COURSE.id,
        villageId: "mibu",
        availability,
        onStartAoi: async () => {
          const entry = await villagePreviewController.show("mibu");
          geoprocessingAoiController.setVillageBounds(entry.bounds);
        },
        onCompleted: () => showToast("个人图底生产完成，可加载成果预览", "success"),
        onPreview: async (artifacts) => {
          await geoprocessingResultPreview.show(artifacts);
          geoprocessingResultPreview.syncVisibleLayers(getSelectedLayersForCurrentSpace());
          showToast("成果已临时加载到地图", "success");
        },
        onImported: async () => {
          geoprocessingResultPreview.clear();
          if (coursePersonalSpace && personalSpaceClient) {
            personalSpaceClient.invalidateCache({ spaceId: coursePersonalSpace.id });
            const selections = await personalSpaceClient.listSelections(coursePersonalSpace.id);
            const personalWorkspace = getSpaceById(String(coursePersonalSpace.id));
            if (personalWorkspace) {
              personalWorkspace.selectedLayers = (selections || []).map((item) => item.layer_key);
              setCurrentSpaceIdAndRemember(personalWorkspace.id);
              saveSpacesToStorage();
              renderSpaceList();
              await handleSpaceSelect(personalWorkspace.id);
            }
          }
          showToast("成果已保存到个人空间", "success");
        }
      });
      geoprocessingPanel.mount();
    },
    onTaskSelected: () => setCourseTaskSidebarExpanded(true),
    onTaskChanged: (context) => {
      activeCourseTaskContext = context;
      updateWorkspaceContextBar(context);
    }
  });
  await courseWorkbench.init();
  return courseWorkbench;
}

async function recordCourseActivity(action, target = {}, metadata = {}) {
  if (!activityLogger || !String(currentUserName || "").trim()) return null;
  const event = await activityLogger.record(action, target, metadata);
  activityLogger.flush().catch(() => {});
  return event;
}

function getValidSpaceId(spaceId, fallback = BASE_SPACE_ID) {
  if (getSpaceById(spaceId)) return spaceId;
  if (getSpaceById(fallback)) return fallback;
  return spaces[0]?.id || BASE_SPACE_ID;
}

function rememberCurrentSpaceForActiveMode() {
  const validSpaceId = getValidSpaceId(currentSpaceId);
  if (isPlanningMode) {
    lastPlanningSpaceId = validSpaceId;
  } else {
    lastCollabSpaceId = validSpaceId;
  }
  saveAppState();
}

function setCurrentSpaceIdAndRemember(spaceId) {
  const nextSpaceId = getValidSpaceId(spaceId);
  // 离开现状空间时释放编辑锁
  if (isBaseSpace(currentSpaceId) && currentSpaceId !== nextSpaceId) {
    releaseCurrentSpaceEditLock();
  }
  currentSpaceId = nextSpaceId;
  rememberCurrentSpaceForActiveMode();
}

function normalizeIdentityName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return raw
    .replace(/^上传者[:：]\s*/i, "")
    .replace(/\s*[（(]你[)）]\s*$/i, "")
    .trim();
}

function isAdminIdentity(name) {
  const user = window.VillageAuth?.getCurrentUser?.() || null;
  if (!user || normalizeIdentityName(name) !== normalizeIdentityName(user.name)) return false;
  return Boolean(window.AccessControlModule?.isAdminUser(user));
}

function getSpaceCreatorName(spaceOrId) {
  const space = typeof spaceOrId === "string" ? getSpaceById(spaceOrId) : spaceOrId;
  if (!space) return "";
  if (space.id === BASE_SPACE_ID) return "系统";
  return normalizeIdentityName(space.creatorName);
}

function canManageSpace(spaceOrId, actorName = currentUserName) {
  const space = typeof spaceOrId === "string" ? getSpaceById(spaceOrId) : spaceOrId;
  if (!space) return false;
  const actor = normalizeIdentityName(actorName);
  if (space.id !== BASE_SPACE_ID && isAdminIdentity(actor)) return true;
  if (space.readonly) return false;
  // Personal spaces are already owner-scoped by Supabase RLS. Display-name
  // differences must not disable the owner's attribute editing controls.
  if (space.spaceType === "course_personal") return !!actor;
  if (space.courseGroupId && window.CourseWorkspaceAdapterModule) {
    return window.CourseWorkspaceAdapterModule.canActorAccessGroupSpace(
      space,
      courseWorkbench?.getContext?.() || null,
      isAdminIdentity(actor)
    );
  }
  if (space.id === BASE_SPACE_ID) {
    return !!actor; // 现状空间：登录用户即可编辑
  }
  const creator = getSpaceCreatorName(space);
  if (!creator) return !!actor; // 兼容历史数据：旧空间未记录创建者时，对已登录账号开放编辑
  return !!actor && actor === creator;
}

function canEditCurrentSpace() {
  return canManageSpace(getCurrentSpace());
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
  if (String(spaceId) === String(getCurrentSpaceId()) && geoprocessingResultPreview?.hasPreview?.()) {
    geoprocessingResultPreview.syncVisibleLayers(nextLayers);
  }
  saveSpacesToStorage({ syncRemote: target.spaceType !== "course_personal" });
}

function getSelectedLayersForCurrentSpace() {
  const space = getCurrentSpace();
  if (!Array.isArray(space?.selectedLayers)) return [];
  const available = new Set(getAvailableLayerKeysForSpace(space));
  return space.selectedLayers.filter((layerKey) => available.has(layerKey));
}

function isBaseSpace(spaceId) {
  return spaceId === BASE_SPACE_ID;
}

function getAvailableLayerKeysForSpace(space) {
  if (!space) return [];
  if (space?.spaceType === "course_personal") {
    return ["figureGround", "building", "road", "water", "contours"];
  }
  return ["figureGround", "building", "road", "water"];
}

function syncBasemapUIBySpace(spaceId) {
  const currentSpace = getSpaceById(spaceId);
  const selectedLayers = currentSpace?.selectedLayers || [];
  const isFigureGroundMode = selectedLayers.includes("figureGround");
  const basemapVisible = !!currentSpace?.basemapVisible;
  const labelVisible = loadBasemapLabelVisible();

  if (!planOnlineLayer && !planHighResLayer && !planLabelLayer) return;

  const shouldShow = basemapVisible && !isFigureGroundMode;

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
  if (isCreatingSpace) {
    showToast("正在创建空间，请稍候...", "info");
    return;
  }
  if (!currentUserName) {
    showToast("请先登录后再新建空间", "error");
    return;
  }
  isCreatingSpace = true;

  const baseSpace = getSpaceById(BASE_SPACE_ID) || getCurrentSpace();
  const creatorName = normalizeIdentityName(currentUserName);
  const newSpaceTitle = makeUniqueSpaceTitle("规划空间");

  const filtered = (baseSpace?.selectedLayers || []).filter(
    (key) => !["figureGround"].includes(key)
  );

  const newSpace = {
    id: `copy_${Date.now()}`,
    title: newSpaceTitle,
    creatorName,
    createdAt: new Date().toISOString(),
    readonly: false,
    editEnabled: true,
    expanded: true,
    selectedLayers: filtered.length ? Array.from(new Set([...filtered, "road"])) : ["building", "road"],
    basemapVisible: !!baseSpace?.basemapVisible,
    viewMode: "2d"
  };

  try {
    spaces.push(newSpace);
    setCurrentSpaceIdAndRemember(newSpace.id);
    currentSelectedObject = null;
    currentInfoMode = "readonly";
    isCommunityExpanded = true;
    isCommunityCompact = true;
    buildingEditState.dirtyCodes.clear();
    buildingEditState.deletedCodes.clear();

    saveSpacesToStorage();
    saveAppState();
    sync2DSpaceStateTo3D();

    renderSpaceList();
    syncBasemapUIBySpace(newSpace.id);

    await switchTo2DView();
    showPlan2DOverview();
    showToast("空间已创建，正在初始化建筑/道路数据...", "info");

    const targetSpaceId = newSpace.id;
    Promise.resolve().then(async () => {
      try {
        await seedBuildingsForCopySpace(targetSpaceId);
        try {
          await seedRoadsForCopySpace(targetSpaceId);
        } catch (roadError) {
          console.warn("复制空间道路初始化失败（已跳过，不影响空间创建）：", roadError);
          showToast("道路初始化失败，已跳过；可继续编辑建筑。", "info");
        }
        try { await seedWaterForCopySpace(targetSpaceId); } catch (e) { console.warn("水体初始化失败（已跳过）：", e); }

        if (currentSpaceId === targetSpaceId) {
          await refresh2DOverlay();
        }

        if (
          model3dView.classList.contains("active") &&
          window.Village3D &&
          typeof window.Village3D.reload === "function"
        ) {
          await window.Village3D.reload();
        }

        showToast("空间初始化完成。", "success");
      } catch (seedError) {
        console.error("后台初始化复制空间失败：", seedError);
        showToast(`空间已创建，但初始化失败：${seedError?.message || seedError}`, "error");
      }
    });
  } catch (error) {
    console.error(error);
    alert(`复制空间创建失败：${error?.message || "建筑初始化入库未成功，请查看控制台。"}`);
  } finally {
    isCreatingSpace = false;
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

function isCommunityTaskPhotoRequired(category) {
  return COMMUNITY_TASK_REQUIRED_PHOTO_CATEGORIES.has(String(category || "").trim());
}

function getCommunityTaskPhotoObjectCode(taskId) {
  return `TASK_${taskId}`;
}

function getTodayTimeRangeIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    let done = false;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      window.removeEventListener("focus", onWindowFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const finish = (file) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(file || null);
    };

    const onChange = () => {
      finish(input.files?.[0] || null);
    };

    const onWindowFocus = () => {
      setTimeout(() => {
        if (!done && (!input.files || input.files.length === 0)) {
          finish(null);
        }
      }, 1200);
    };

    input.addEventListener("change", onChange, { once: true });
    window.addEventListener("focus", onWindowFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function getCommunityTasksModule() {
  if (!window.CommunityTasksModule) {
    throw new Error("community-tasks.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.CommunityTasksModule;
}

function buildCommunityTaskDeps() {
  return {
    COMMUNITY_TASKS_TABLE,
    POINTS_LEDGER_TABLE,
    USER_STATS_TABLE,
    OBJECT_EDITS_TABLE,
    COMMUNITY_TASK_PHOTO_OBJECT_TYPE,
    COMMUNITY_DAILY_POINTS_CAP,
    getSupabaseClient: () => supabaseClient,
    getCommunityGameTablesReady: () => communityGameTablesReady,
    setCommunityGameTablesReady: (next) => {
      communityGameTablesReady = !!next;
    },
    getCurrentUserName: () => currentUserName,
    getCurrentSpaceId: () => currentSpaceId,
    getCommunityTasksCache: () => communityTasksCache,
    getTodayTimeRangeIso,
    getBuildingSpaceCacheKey,
    isCommunityGameTableMissingError,
    invalidateCommunityTaskCache,
    fetchObjectPhotos,
    uploadObjectPhoto,
    deleteObjectPhoto,
    getCommunityTaskPhotoObjectCode,
    getCommunityTaskTypeMeta,
    pickImageFile,
    customConfirm,
    customPrompt,
    showToast,
    refresh2DOverlay,
    refreshCommunityScoreBadge,
    refreshCommunityMessageBoard,
    formatDateTime,
    escapeHtml
  };
}

function getMapStyleModule() {
  if (!window.MapStyleModule) {
    throw new Error("map-style.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.MapStyleModule;
}

function buildMapStyleDeps() {
  return {
    VILLAGE_FILL_LAYER_KEY,
    VILLAGE_FILL_COLOR,
    getOL: () => window.__OL__,
    isActiveFeature: (feature) => activeFeature === feature,
    isHoveredFeature: (feature) => hoverFeature === feature,
    getSelectedLayersForCurrentSpace,
    getContourLabelsVisible: () => getCurrentSpace()?.contourLabelsVisible === true,
    getRoadDisplayStrokeWidth,
    getSmoothedRoadLineGeometry,
    getIsPlanningMode: () => isPlanningMode
  };
}

function getSpacePanelModule() {
  if (!window.SpacePanelModule) {
    throw new Error("space-panel.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.SpacePanelModule;
}

function buildSpacePanelDeps() {
  return {
    BASE_SPACE_ID,
    getSpaceListEl: () => spaceList,
    getIsSpaceSidebarExpanded: () => isSpaceSidebarExpanded,
    getSpaces: () => spaces,
    getCurrentSpace: () => getCurrentSpace(),
    getCurrentSpaceId: () => currentSpaceId,
    getAvailableLayerKeysForSpace,
    getLayerConfigs: () => layerConfigs,
    getIsSpaceOptionsExpanded: () => isSpaceOptionsExpanded,
    getIsToolboxExpanded: () => isToolboxExpanded,
    getIsCommunityExpanded: () => isCommunityExpanded,
    getIsCommunityCompact: () => isCommunityCompact,
    getIsPlanningMode: () => isPlanningMode,
    getCurrentUserName: () => currentUserName,
    getSpaceCreatorName,
    canManageSpace,
    escapeHtml,
    loadBasemapLabelVisible,
    resolveGeometryEditLayer,
    setCurrentGeometryEditLayer: (layerKey) => {
      currentGeometryEditLayer = layerKey;
    },
    bindSpaceListEvents,
    ensureBuildingEditorToolbar,
    ensureCommunityBuildPanel,
    updateBuildingEditorToolbarState,
    refreshCommunityScoreBadge,
    canFreezeSnapshot: canFreezeCurrentSnapshot,
    refreshVersionManagerPanel
  };
}

function getSpacePanelEventsModule() {
  if (!window.SpacePanelEventsModule) {
    throw new Error("space-panel-events.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.SpacePanelEventsModule;
}

function buildSpacePanelEventsDeps() {
  return {
    BASE_SPACE_ID,
    getCurrentSpaceId: () => currentSpaceId,
    setCurrentSpaceId: (spaceId) => {
      setCurrentSpaceIdAndRemember(spaceId);
    },
    getLastPlanningSpaceId: () => getValidSpaceId(lastPlanningSpaceId),
    getLastCollabSpaceId: () => getValidSpaceId(lastCollabSpaceId),
    rememberCurrentSpaceForActiveMode,
    getCurrentSpace: () => getCurrentSpace(),
    getSpaces: () => spaces,
    setSpaces: (nextSpaces) => {
      spaces = Array.isArray(nextSpaces) ? nextSpaces : spaces;
    },
    getSpaceById,
    canManageSpace,
    isSpaceTitleDuplicate,
    getDefaultSpaces,
    getPlan2dViewEl: () => plan2dView,
    getAvailableLayerKeysForSpace,
    getCurrentGeometryEditLayer: () => currentGeometryEditLayer,
    setCurrentGeometryEditLayer: (layerKey) => {
      currentGeometryEditLayer = layerKey;
    },
    getBuildingEditState: () => buildingEditState,
    setCurrentSelectedObject: (obj) => {
      currentSelectedObject = obj;
    },
    setCurrentInfoMode: (mode) => {
      currentInfoMode = mode;
    },
    getIsSpaceOptionsExpanded: () => isSpaceOptionsExpanded,
    setIsSpaceOptionsExpanded: (next) => {
      isSpaceOptionsExpanded = !!next;
      saveAppState();
    },
    getIsToolboxExpanded: () => isToolboxExpanded,
    setIsToolboxExpanded: (next) => {
      isToolboxExpanded = !!next;
      saveAppState();
    },
    getIsCommunityExpanded: () => isCommunityExpanded,
    setIsCommunityExpanded: (next) => {
      isCommunityExpanded = !!next;
      saveAppState();
    },
    getIsCommunityCompact: () => isCommunityCompact,
    setIsCommunityCompact: (next) => {
      isCommunityCompact = !!next;
      saveAppState();
    },
    getIsTeachingExpanded: () => isTeachingExpanded,
    setIsTeachingExpanded: (next) => {
      isTeachingExpanded = !!next;
      saveAppState();
    },
    getIsPlanningMode: () => isPlanningMode,
    setIsPlanningMode: (next) => {
      isPlanningMode = !!next;
      saveAppState();
    },
    handleSpaceSelect,
    renderSpaceList,
    saveSpacesToStorage,
    sync2DSpaceStateTo3D,
    clearBuildingInteractions,
    switchTo2DView,
    switchTo3DView,
    setSpaceSelectedLayers,
    resolveGeometryEditLayer,
    ensureSelectedLayersLoaded,
    syncBasemapUIBySpace,
    refresh2DOverlay,
    getPlanVectorLayer: () => planVectorLayer,
    showPlan2DOverview,
    customPrompt,
    customConfirm,
    showToast,
    isBaseSpace,
    deleteSpaceFromSupabase,
    refreshVersionManagerPanel,
    toggleInitialBaseline,
    freezeCurrentSnapshot
  };
}

function getViewSwitcherModule() {
  if (!window.ViewSwitcherModule) {
    throw new Error("view-switcher.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.ViewSwitcherModule;
}

let village3DLoadPromise = null;

function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) {
      const existing = document.getElementById(id);
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`脚本加载失败：${src}`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    if (id) script.id = id;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`脚本加载失败：${src}`));
    document.body.appendChild(script);
  });
}

function loadStyleOnce(href, id) {
  if (id && document.getElementById(id)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  if (id) link.id = id;
  document.head.appendChild(link);
}

async function ensureVillage3DLoaded() {
  if (window.Village3D && typeof window.Village3D.enter === "function") {
    return window.Village3D;
  }
  if (village3DLoadPromise) return village3DLoadPromise;

  village3DLoadPromise = (async () => {
    loadStyleOnce(
      "https://cesium.com/downloads/cesiumjs/releases/1.118/Build/Cesium/Widgets/widgets.css",
      "cesium-widgets-css"
    );

    if (!window.Cesium) {
      try {
        await loadScriptOnce(
          "https://cesium.com/downloads/cesiumjs/releases/1.118/Build/Cesium/Cesium.js",
          "cesium-runtime-script"
        );
      } catch (primaryError) {
        console.warn("Cesium 官方源加载失败，尝试 jsDelivr 备用源：", primaryError);
        await loadScriptOnce(
          "https://cdn.jsdelivr.net/npm/cesium@1.118.0/Build/Cesium/Cesium.js",
          "cesium-runtime-script-fallback"
        );
      }
    }

    await loadScriptOnce("features/first-person/first-person-controller.js?v=20260512", "first-person-controller-script");
    await loadScriptOnce("features/drone/drone-controller.js?v=20260512", "drone-controller-script");
    await loadScriptOnce("app-3d.js?v=20260607-delete-tombstone", "village-3d-script");

    if (!window.Village3D || typeof window.Village3D.enter !== "function") {
      throw new Error("3D 模块加载完成但未找到 Village3D.enter。");
    }
    return window.Village3D;
  })();

  return village3DLoadPromise;
}

function buildViewSwitcherDeps() {
  return {
    BASEMAP_GEOREF,
    DEFAULT_VILLAGE_VIEW_ZOOM,
    getCurrentSpaceId: () => currentSpaceId,
    setCurrentSpaceId: (spaceId) => {
      setCurrentSpaceIdAndRemember(spaceId);
    },
    getCurrentSpace: () => getCurrentSpace(),
    getCurrentSelectedObject: () => currentSelectedObject,
    setCurrentSelectedObject: (obj) => {
      currentSelectedObject = obj;
    },
    setCurrentInfoMode: (mode) => {
      currentInfoMode = mode;
    },
    setCurrentGeometryEditLayer: (layerKey) => {
      currentGeometryEditLayer = layerKey;
    },
    getSelectedLayersForCurrentSpace,
    resolveGeometryEditLayer,
    saveSpacesToStorage,
    sync2DSpaceStateTo3D,
    renderSpaceList,
    ensureBuildingEditorToolbar,
    ensureCommunityBuildPanel,
    updateBuildingEditorToolbarState,
    clearBuildingInteractions,
    syncBasemapUIBySpace,
    setActiveStoryItem,
    switchMainView,
    update2DStatusText,
    ensurePlanMap,
    getInfoPanel: () => infoPanel,
    ensureSelectedLayersLoaded,
    refresh2DOverlay,
    refreshCommunityScoreBadge,
    refreshCommunityMessageBoard,
    getIsPlanningMode: () => isPlanningMode,
    findFeatureBySourceCode,
    setActiveFeature: doSetActiveFeature,
    getPlanVectorLayer: () => planVectorLayer,
    buildFallbackObjectRow,
    showObjectInfo,
    getStatusBadge: () => statusBadge,
    getDetailSubtitle: () => detailSubtitle,
    getActiveBasemapGeoref: () => activeBasemapGeoref,
    escapeHtml,
    ensureVillage3DLoaded
  };
}

function getDataServiceModule() {
  if (!window.DataServiceModule) {
    throw new Error("data-service.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.DataServiceModule;
}

async function acquireCurrentSpaceEditLock() {
  const spaceId = currentSpaceId || BASE_SPACE_ID;
  if (!isBaseSpace(spaceId)) return { success: true };
  if (!currentUserName) return { success: false, reason: "未登录" };
  return getDataServiceModule().acquireSpaceEditLock(buildDataServiceDeps(), spaceId, currentUserName);
}

async function releaseCurrentSpaceEditLock() {
  const spaceId = currentSpaceId || BASE_SPACE_ID;
  if (!isBaseSpace(spaceId)) return;
  return getDataServiceModule().releaseSpaceEditLock(buildDataServiceDeps(), spaceId);
}

function buildDataServiceDeps() {
  return {
    OBJECT_EDITS_TABLE,
    OBJECT_PHOTOS_TABLE,
    PHOTO_BUCKET,
    getSupabaseClient: () => supabaseClient,
    normalizeIdentityName,
    normalizeCode
  };
}

function getFeatureDbModule() {
  if (!window.FeatureDbModule) {
    throw new Error("feature-db.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.FeatureDbModule;
}

function buildFeatureDbDeps() {
  return {
    PLANNING_FEATURES_TABLE,
    getSupabaseClient: () => supabaseClient,
    getBuildingSpaceCacheKey,
    getLayerLabel,
    getLayerCodeField,
    getLayerNameField,
    getRowsCache: (layerKey) => {
      if (layerKey === "building") return buildingDbRowsCache;
      if (layerKey === "road") return roadDbRowsCache;
      if (layerKey === "cropland") return croplandDbRowsCache;
      if (layerKey === "openSpace") return openSpaceDbRowsCache;
      if (layerKey === "water") return waterDbRowsCache;
      return null;
    },
    getHasAnyCache: (layerKey) => {
      if (layerKey === "building") return buildingDbHasAnyCache;
      if (layerKey === "road") return roadDbHasAnyCache;
      if (layerKey === "cropland") return croplandDbHasAnyCache;
      if (layerKey === "openSpace") return openSpaceDbHasAnyCache;
      if (layerKey === "water") return waterDbHasAnyCache;
      return null;
    }
  };
}

function getCopySpaceSeedModule() {
  if (!window.CopySpaceSeedModule) {
    throw new Error("copy-space-seed.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.CopySpaceSeedModule;
}

function buildCopySpaceSeedDeps() {
  return {
    PLANNING_FEATURES_TABLE,
    ROAD_DEFAULT_WIDTH,
    BASE_SPACE_ID,
    getSupabaseClient: () => supabaseClient,
    normalizeCode,
    cloneJson,
    getFeatureCode,
    getFeatureProperties,
    getFeatureGeometry,
    isBaseSpace,
    ensureLayerLoaded,
    hasAnyBuildingFeaturesInDb,
    hasAnyRoadFeaturesInDb,
    hasAnyCroplandFeaturesInDb,
    hasAnyOpenSpaceFeaturesInDb,
    hasAnyWaterFeaturesInDb,
    invalidateRoadDbCache,
    invalidateCroplandDbCache,
    invalidateOpenSpaceDbCache,
    invalidateWaterDbCache,
    getLayerConfigs: () => layerConfigs
  };
}

function getGeometryEditorModule() {
  if (!window.GeometryEditorModule) {
    throw new Error("geometry-editor.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.GeometryEditorModule;
}

function getFeatureEditSessionModule() {
  if (!window.FeatureEditSessionModule) {
    throw new Error("feature-edit-session.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.FeatureEditSessionModule;
}

function buildFeatureEditSessionDeps() {
  return {
    getSupabaseClient: () => (
      getCurrentSpace()?.spaceType === "course_personal" ? null : supabaseClient
    )
  };
}

function getCurrentUserRole() {
  const user = window.VillageAuth?.getCurrentUser?.() || null;
  if (isAdminIdentity(currentUserName)) return "admin";
  return String(user?.role || "student").trim().toLowerCase();
}

async function acquireFeatureEditLock(layerKey, objectCode) {
  if (!currentUserName) return { success: false, reason: "未登录" };
  const module = getFeatureEditSessionModule();
  const target = module.buildLockTarget(currentSpaceId || BASE_SPACE_ID, layerKey, objectCode);
  if (!target) return { success: false, reason: "invalid_target" };
  try {
    const result = await module.acquireFeatureEditLock(buildFeatureEditSessionDeps(), target, currentUserName);
    if (result?.success) {
      const lockKey = buildDirtyFeatureKey(layerKey, objectCode);
      buildingEditState.activeFeatureLocks.set(lockKey, {
        ...target,
        editorName: currentUserName,
        lockToken: result.lockToken || null,
        offline: !!result.offline
      });
      startFeatureLockHeartbeat();
    }
    return result;
  } catch (error) {
    console.error("取得要素编辑锁失败：", error);
    return { success: false, reason: "database_error", error };
  }
}

async function releaseFeatureEditLock(layerKey, objectCode) {
  const lockKey = buildDirtyFeatureKey(layerKey, objectCode);
  const lock = buildingEditState.activeFeatureLocks.get(lockKey);
  if (!lock) return;
  buildingEditState.activeFeatureLocks.delete(lockKey);
  try {
    await getFeatureEditSessionModule().releaseFeatureEditLock(buildFeatureEditSessionDeps(), lock);
  } catch (error) {
    console.warn("释放要素编辑锁失败，等待租约自动过期：", error);
  }
  stopFeatureLockHeartbeatIfIdle();
}

async function releaseAllFeatureEditLocks() {
  const locks = [...buildingEditState.activeFeatureLocks.values()];
  buildingEditState.activeFeatureLocks.clear();
  stopFeatureLockHeartbeatIfIdle();
  await Promise.allSettled(
    locks.map((lock) => getFeatureEditSessionModule().releaseFeatureEditLock(buildFeatureEditSessionDeps(), lock))
  );
}

function startFeatureLockHeartbeat() {
  if (buildingEditState.lockHeartbeatTimer) return;
  const delay = getFeatureEditSessionModule().LOCK_HEARTBEAT_MS;
  buildingEditState.lockHeartbeatTimer = setInterval(async () => {
    const module = getFeatureEditSessionModule();
    for (const [key, lock] of buildingEditState.activeFeatureLocks.entries()) {
      try {
        const result = await module.heartbeatFeatureEditLock(buildFeatureEditSessionDeps(), lock);
        if (!result?.success) {
          buildingEditState.activeFeatureLocks.delete(key);
          showToast(`${lock.editorName || "当前用户"}的要素编辑锁已失效，请重新选择该要素。`, "error");
        }
      } catch (error) {
        console.warn("续期要素编辑锁失败：", error);
      }
    }
    stopFeatureLockHeartbeatIfIdle();
  }, delay);
}

function stopFeatureLockHeartbeatIfIdle() {
  if (buildingEditState.activeFeatureLocks.size || !buildingEditState.lockHeartbeatTimer) return;
  clearInterval(buildingEditState.lockHeartbeatTimer);
  buildingEditState.lockHeartbeatTimer = null;
}

async function saveFeatureEditBatch(payload) {
  if (getSpaceById(payload?.spaceId)?.spaceType === "course_personal") {
    if (!personalSpaceClient) throw new Error("PERSONAL_SPACE_CLIENT_REQUIRED");
    await personalSpaceClient.saveEdits(payload.spaceId, payload.changes || []);
    return { success: true };
  }
  return getFeatureEditSessionModule().saveFeatureEditBatch(buildFeatureEditSessionDeps(), payload);
}

function summarizeFeatureChanges(changes) {
  return getFeatureEditSessionModule().summarizeChanges(changes);
}

async function requestFeatureSaveNote(summary) {
  return customPrompt(
    `本次将保存：${summary}\n可补充调研依据或修改原因，也可以直接确认。`,
    "",
    "保存编辑",
    { required: false, maxLength: 200, placeholder: "补充说明（选填）" }
  );
}

function canFreezeCurrentSnapshot() {
  return getFeatureEditSessionModule().canFreezeSnapshot(getCurrentUserRole());
}

async function refreshVersionManagerPanel(options = {}) {
  const statusEl = document.getElementById("versionManagerStatus");
  if (!statusEl) return;
  const currentSpace = getCurrentSpace();
  if (currentSpace?.spaceType === "course_personal") {
    if (!supabaseClient || !personalSpaceClient || !window.PersonalLayerVersionsModule) {
      statusEl.textContent = "个人图层版本服务尚未初始化。";
      return;
    }
    if (!options.quiet) statusEl.textContent = "正在加载个人图层版本……";
    try {
      const [versions, selections] = await Promise.all([
        personalSpaceClient.listVersions(currentSpace.id),
        personalSpaceClient.listSelections(currentSpace.id)
      ]);
      statusEl.innerHTML = window.PersonalLayerVersionsModule.renderPersonalVersionManager({ versions, selections });
      bindPersonalVersionManagerEvents(statusEl, currentSpace.id);
    } catch (error) {
      console.warn("读取个人图层版本失败：", error);
      statusEl.textContent = "个人图层版本读取失败，请确认已执行个人图底空间 SQL。";
    }
    return;
  }
  if (!supabaseClient) {
    statusEl.textContent = "当前未连接 Supabase，无法读取版本记录。";
    return;
  }
  if (!options.quiet) statusEl.textContent = "正在加载版本记录……";
  try {
    const module = getFeatureEditSessionModule();
    const [snapshots, batches] = await Promise.all([
      module.listSnapshots(buildFeatureEditSessionDeps(), BASE_SPACE_ID),
      module.listRecentVersions(buildFeatureEditSessionDeps(), BASE_SPACE_ID, 8)
    ]);
    const snapshotHtml = snapshots.length
      ? snapshots.map((item) => `
          <div class="version-record-card">
            <strong>${escapeHtml(item.version_name)}</strong>
            <span>${escapeHtml(item.version_type === "initial" ? "永久只读基线" : "正式校核版本")} · ${escapeHtml(formatDateTime(item.created_at))}</span>
          </div>
        `).join("")
      : '<div class="version-manager-empty">尚未建立 V0，请先执行版本与锁定数据库脚本。</div>';
    const batchHtml = batches.length
      ? batches.map((item) => `
          <div class="version-history-row">
            <span>${escapeHtml(item.summary)}</span>
            <small>${escapeHtml(item.editor_name)} · ${escapeHtml(formatDateTime(item.created_at))}</small>
          </div>
        `).join("")
      : '<div class="version-manager-empty">暂无已保存的校核修改</div>';
    statusEl.innerHTML = `
      <div class="version-manager-subtitle">正式版本</div>
      ${snapshotHtml}
      <div class="version-manager-subtitle">最近保存</div>
      ${batchHtml}
    `;
  } catch (error) {
    console.warn("读取版本记录失败：", error);
    statusEl.textContent = "版本表尚未建立或读取失败，请执行 Supabase 版本与锁定脚本。";
  }
}

async function ensurePersonalVersionCompareController() {
  if (personalVersionCompareController) return personalVersionCompareController;
  await ensurePlanMap();
  personalVersionCompareController = window.PersonalLayerVersionsModule.createPersonalVersionCompare({
    map: planMap,
    ol: window.__OL__
  });
  return personalVersionCompareController;
}

function bindPersonalVersionManagerEvents(container, spaceId) {
  container.querySelectorAll("[data-personal-version-select]").forEach((select) => {
    select.addEventListener("change", async () => {
      const layerKey = select.dataset.personalVersionSelect;
      try {
        await personalSpaceClient.setCurrentVersion(spaceId, layerKey, select.value);
        personalVersionCompareController?.clear?.();
        await refresh2DOverlay();
        await refreshVersionManagerPanel();
        showToast(`${getLayerLabel(layerKey)}已切换到所选版本。`, "success");
      } catch (error) {
        console.warn("切换个人图层版本失败：", error);
        showToast("版本切换失败，请稍后重试。", "error");
        await refreshVersionManagerPanel();
      }
    });
  });
  container.querySelectorAll("[data-personal-version-compare]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const rows = await personalSpaceClient.listFeatures(button.dataset.personalVersionCompare);
        const controller = await ensurePersonalVersionCompareController();
        controller.show(rows);
        showToast(`${getLayerLabel(button.dataset.layerKey)}旧版本已半透明叠加，可与当前版本对比。`, "info");
      } catch (error) {
        console.warn("加载对比版本失败：", error);
        showToast("对比版本加载失败，请稍后重试。", "error");
      }
    });
  });
  container.querySelectorAll("[data-personal-version-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await customConfirm("确认删除这个旧版本吗？当前版本不会被删除。", {
        title: "删除旧版本",
        isDanger: true
      });
      if (!confirmed) return;
      try {
        await personalSpaceClient.deleteVersion(button.dataset.personalVersionDelete);
        personalVersionCompareController?.clear?.();
        await refreshVersionManagerPanel();
        showToast("旧版本已删除。", "success");
      } catch (error) {
        console.warn("删除个人图层版本失败：", error);
        showToast("删除失败；当前版本或已提交版本不能删除。", "error");
      }
    });
  });
  container.querySelector("[data-personal-version-compare-clear]")?.addEventListener("click", () => {
    personalVersionCompareController?.clear?.();
    showToast("已结束版本对比。", "info");
  });
}

function clearInitialBaselineOverlay() {
  if (initialBaselineLayer && planMap) planMap.removeLayer(initialBaselineLayer);
  initialBaselineLayer = null;
  initialBaselineSource = null;
  initialBaselineDisplayMode = "";
  planVectorLayer?.setVisible(true);
  planVectorLayer?.changed();
}

async function toggleInitialBaseline(mode = "compare") {
  if (initialBaselineDisplayMode === mode) {
    clearInitialBaselineOverlay();
    showToast("已退出初始版本查看", "info");
    return;
  }
  try {
    await ensurePlanMap();
    const module = getFeatureEditSessionModule();
    const snapshots = await module.listSnapshots(buildFeatureEditSessionDeps(), BASE_SPACE_ID);
    const initial = snapshots.find((item) => item.version_type === "initial");
    if (!initial) {
      showToast("尚未建立初始现状 V0，请先执行版本与锁定数据库脚本。", "error");
      return;
    }
    const OL = await (olReady || window.__olReady || window.__loadOpenLayers?.());
    if (!OL) throw new Error("OpenLayers 尚未加载");
    const format = new OL.GeoJSON();
    initialBaselineSource = new OL.VectorSource();
    // 初始底稿来自仓库内教师提供的静态矢量；planning_features 只保存覆盖项，
    // 不能单独用它还原完整 V0。这里始终加载原始可编辑图层，保证 V0 不受学生校核结果影响。
    await Promise.all(EDITABLE_GEOMETRY_LAYERS.map((layerKey) => ensureLayerLoaded(layerKey)));
    EDITABLE_GEOMETRY_LAYERS.forEach((layerKey) => {
      const cached = layerDataCache[layerKey];
      (cached?.features || []).forEach((rawFeature) => {
        if (!isRenderableGeometry(rawFeature?.geometry)) return;
        const feature = format.readFeature(rawFeature, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:4326"
        });
        feature.set("layerKey", "initialBaseline");
        feature.set("sourceLayerKey", layerKey);
        feature.set("sourceCode", getFeatureCode(rawFeature, layerKey));
        initialBaselineSource.addFeature(feature);
      });
    });
    const compare = mode === "compare";
    initialBaselineLayer = new OL.VectorLayer({
      source: initialBaselineSource,
      style: new OL.Style({
        stroke: new OL.Stroke({
          color: compare ? "#7c3aed" : "#475569",
          width: compare ? 3 : 2,
          lineDash: compare ? [8, 6] : undefined
        }),
        fill: new OL.Fill({ color: compare ? "rgba(124, 58, 237, 0.08)" : "rgba(71, 85, 105, 0.18)" })
      })
    });
    initialBaselineLayer.setZIndex(20);
    if (planMap) planMap.addLayer(initialBaselineLayer);
    planVectorLayer?.setVisible(compare);
    initialBaselineDisplayMode = mode;
    showToast(compare
      ? "已叠加 V0 紫色虚线，可与当前校核成果对比；再次点击可退出。"
      : "当前仅显示只读的初始现状 V0；再次点击可退出。", "success");
  } catch (error) {
    console.error("查看初始版本失败：", error);
    showToast("初始版本加载失败，请确认数据库脚本已经执行。", "error");
  }
}

async function freezeCurrentSnapshot() {
  if (!canFreezeCurrentSnapshot()) {
    showToast("仅管理员或教师可以冻结正式版本。", "error");
    return;
  }
  const versionName = await customPrompt(
    "例如：V1 第一次现场调研校核版",
    "",
    "冻结正式版本",
    { maxLength: 40, emptyError: "请输入版本名称" }
  );
  if (versionName === null) return;
  const description = await customPrompt(
    "可填写本版本的课堂阶段、调研批次或用途。",
    "",
    "版本说明",
    { required: false, maxLength: 200, placeholder: "版本说明（选填）" }
  );
  if (description === null) return;
  try {
    const items = await collectCompleteCurrentVersionItems();
    await getFeatureEditSessionModule().freezeSnapshot(buildFeatureEditSessionDeps(), {
      spaceId: BASE_SPACE_ID,
      versionName,
      description,
      createdBy: currentUserName,
      versionType: "published",
      items
    });
    showToast(`已冻结正式版本“${versionName.trim()}”`, "success");
    await refreshVersionManagerPanel();
  } catch (error) {
    console.error("冻结正式版本失败：", error);
    showToast("冻结失败，请确认版本与锁定数据库脚本已经执行。", "error");
  }
}

async function collectCompleteCurrentVersionItems() {
  const rowsByLayer = {
    building: listBuildingFeaturesFromDbCached,
    road: listRoadFeaturesFromDbCached,
    cropland: listCroplandFeaturesFromDbCached,
    openSpace: listOpenSpaceFeaturesFromDbCached
  };
  const items = [];

  for (const layerKey of EDITABLE_GEOMETRY_LAYERS) {
    const cached = await ensureLayerLoaded(layerKey);
    const merged = new Map();
    (cached?.features || []).forEach((rawFeature) => {
      if (!isRenderableGeometry(rawFeature?.geometry)) return;
      const objectCode = normalizeCode(getFeatureCode(rawFeature, layerKey));
      if (!objectCode) return;
      const sourceProps = getFeatureProperties(rawFeature);
      const rowProps = cached.rowIndex?.get(objectCode) || {};
      merged.set(objectCode, {
        layerKey,
        objectCode,
        objectName: getFirstMatchingField(
          { ...sourceProps, ...rowProps },
          layerConfigs[layerKey]?.nameFields || []
        ) || objectCode,
        geom: cloneJson(rawFeature.geometry),
        props: cloneJson({ ...sourceProps, ...rowProps }),
        isDeleted: false
      });
    });

    const dbRows = await rowsByLayer[layerKey](BASE_SPACE_ID, { force: true });
    dbRows.forEach((row) => {
      const objectCode = normalizeCode(row.object_code);
      if (!objectCode || !isRenderableGeometry(row.geom)) return;
      merged.set(objectCode, {
        layerKey,
        objectCode,
        objectName: row.object_name || objectCode,
        geom: cloneJson(row.geom),
        props: cloneJson(row.props || {}),
        isDeleted: false
      });
    });

    const deletedCodes = await listDeletedLayerFeatureCodesFromDb(BASE_SPACE_ID, layerKey);
    (deletedCodes || []).forEach((code) => merged.delete(normalizeCode(code)));
    items.push(...merged.values());
  }

  return items;
}

function buildGeometryEditorDeps() {
  return {
    ROAD_DEFAULT_WIDTH,
    getDocument: () => document,
    getOlReady: () => (olReady || window.__olReady),
    getVillage3D: () => window.Village3D,
    getBuildingEditState: () => buildingEditState,
    getPlanMap: () => planMap,
    getPlanVectorSource: () => planVectorSource,
    setPlanVectorSource: (source) => {
      planVectorSource = source;
    },
    getPlanVectorLayer: () => planVectorLayer,
    getCurrentGeometryEditLayer: () => currentGeometryEditLayer,
    setCurrentGeometryEditLayer: (layerKey) => {
      currentGeometryEditLayer = layerKey;
    },
    setActiveFeature: doSetActiveFeature,
    normalizeCode,
    buildDirtyFeatureKey,
    getLayerLabel,
    getLayerCodeField,
    getLayerNameField,
    getLayerPrefix,
    getDrawTypeForLayer,
    isEditableSpace,
    canEditCurrentSpace,
    isEditableGeometryLayer,
    getSelectedLayersForCurrentSpace,
    resolveGeometryEditLayer,
    ensurePlanMap,
    getCurrent2DBuildingSpaceId,
    isBaseSpace,
    getCurrentUserName: () => currentUserName,
    releaseAllFeatureEditLocks,
    listBuildingFeaturesFromDbCached,
    listRoadFeaturesFromDbCached,
    listCroplandFeaturesFromDbCached,
    listOpenSpaceFeaturesFromDbCached,
    cloneJson,
    olFeatureToDbGeometry,
    upsertLayerFeatureToDb,
    softDeleteLayerFeatureInDb,
    saveFeatureEditBatch,
    summarizeFeatureChanges,
    requestFeatureSaveNote,
    refresh2DOverlay,
    sync2DSpaceStateTo3D,
    refreshBuildingEdgeLabels,
    refreshDrawingEdgeLengthPreview,
    refreshCommunityScoreBadge,
    showToast
  };
}

function getMcBridgeModule() {
  if (!window.McBridgeModule) {
    throw new Error("mc-bridge.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.McBridgeModule;
}

function buildMcBridgeDeps() {
  return {
    MC_SYNC_CONFIG_TABLE,
    MC_BUILDING_STATE_TABLE,
    MC_VILLAGE_ID,
    getSupabaseClient: () => supabaseClient,
    getCurrentSpaceId: () => currentSpaceId || BASE_SPACE_ID,
    listBuildingFeaturesFromDb,
    invalidateBuildingDbCache,
    getSpaceList: () => spaceList,
    alert: (message) => alert(message)
  };
}

function getMapClickHandlerModule() {
  if (!window.MapClickHandlerModule) {
    throw new Error("map-click-handler.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.MapClickHandlerModule;
}

function scrollToAndHighlightMessage(messageId) {
  const listEl = document.getElementById("communityMessageList");
  if (!listEl) return;
  const card = listEl.querySelector(`.community-message-card[data-message-id="${messageId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("is-highlighted");
  setTimeout(() => {
    card.classList.remove("is-highlighted");
  }, 2000);
}

function buildMapClickHandlerDeps() {
  return {
    COMMUNITY_TASKS_TABLE,
    COMMUNITY_TASK_PHOTO_OBJECT_TYPE,
    getSupabaseClient: () => supabaseClient,
    getIsPlanningMode: () => isPlanningMode,
    getOlReady: () => (olReady || window.__olReady),
    getPlanMap: () => planMap,
    getPlanVectorLayer: () => planVectorLayer,
    getPlanVectorSource: () => planVectorSource,
    getBuildingEditState: () => buildingEditState,
    getCommunityTaskEditState: () => communityTaskEditState,
    getCurrentUserName: () => currentUserName,
    getCurrentSpaceId: () => currentSpaceId,
    getCurrentGeometryEditLayer: () => currentGeometryEditLayer,
    acquireFeatureEditLock,
    releaseFeatureEditLock,
    is2DMeasureActive: () => measure2DState.active,
    getActiveFeature: () => activeFeature,
    setActiveFeature: doSetActiveFeature,
    setCurrentSelectedObject: (obj) => {
      currentSelectedObject = obj;
    },
    setCurrentInfoMode: (mode) => {
      currentInfoMode = mode;
    },
    setActive2DSelectedCode: (code) => {
      window.__active2DSelectedCode = code;
    },
    isNonInteractiveLayerKey,
    getCommunityTaskTypeMeta,
    customPrompt,
    isCommunityTaskPhotoRequired,
    pickImageFile,
    createCommunityTask,
    uploadObjectPhoto,
    getCommunityTaskPhotoObjectCode,
    addCommunityTaskFeatureToMap,
    invalidateCommunityTaskCache,
    refreshCommunityScoreBadge,
    syncCommunityTaskUiState,
    scrollToAndHighlightMessage,
    showToast,
    submitCommunityMessage,
    refreshCommunityMessageBoard,
    normalizeCode,
    buildDirtyFeatureKey,
    getLayerLabel,
    clearBuildingInteractions,
    markBuildingDirty,
    updateBuildingEditorToolbarState,
    update2DStatusText,
    showPlan2DOverview,
    showFigureGroundInfo,
    buildFallbackObjectRow,
    showObjectInfo,
    refreshBuildingEdgeLabels,
    showCommunityTaskReportDialog
  };
}

function getMapHoverHandlerModule() {
  if (!window.MapHoverHandlerModule) {
    throw new Error("map-hover-handler.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.MapHoverHandlerModule;
}

function buildMapHoverHandlerDeps() {
  return {
    getPlanMap: () => planMap,
    getPlanVectorLayer: () => planVectorLayer,
    getBuildingEditState: () => buildingEditState,
    getHoverFeature: () => hoverFeature,
    setHoverFeature: (feature) => {
      hoverFeature = feature;
    },
    isNonInteractiveLayerKey,
    getIsPlanningMode: () => isPlanningMode
  };
}

function getOverlayRendererModule() {
  if (!window.OverlayRendererModule) {
    throw new Error("overlay-renderer.js 未加载，请检查 index.html 脚本顺序。");
  }
  return window.OverlayRendererModule;
}

function buildOverlayRendererDeps() {
  return {
    BASE_SPACE_ID,
    VILLAGE_FILL_LAYER_KEY,
    getPlan2DView: () => plan2dView,
    getCurrentSpaceId: () => currentSpaceId,
    setActive2DSpaceId: (spaceId) => {
      window.__active2DSpaceId = spaceId;
    },
    ensurePlanMap,
    getOlReady: () => (olReady || window.__olReady),
    getPlanVectorSource: () => planVectorSource,
    setPlanVectorSource: (source) => {
      planVectorSource = source;
    },
    getPlanVectorLayer: () => planVectorLayer,
    setActiveFeature: doSetActiveFeature,
    getSelectedLayersForCurrentSpace,
    isCurrentSpacePersonal: () => getCurrentSpace()?.spaceType === "course_personal",
    getPersonalFigureGroundLayerKeys: () => (
      window.PersonalLayerVersionsModule.resolveFigureGroundLayerKeys()
    ),
    listCurrentPersonalLayerFeatures,
    buildRawFeatureFromPersonalRow: (row) => (
      window.PersonalLayerVersionsModule.buildRawFeatureFromPersonalRow(row)
    ),
    shouldShowVillageFillForCurrentSpace,
    buildVillageFillRawFeature,
    listBuildingFeaturesFromDbCached,
    hasAnyBuildingFeaturesInDbCached,
    listRoadFeaturesFromDbCached,
    hasAnyRoadFeaturesInDbCached,
    listCroplandFeaturesFromDbCached,
    listOpenSpaceFeaturesFromDbCached,
    listWaterFeaturesFromDbCached,
    listDeletedLayerFeatureCodesFromDb,
    hasAnyCroplandFeaturesInDbCached,
    hasAnyOpenSpaceFeaturesInDbCached,
    hasAnyWaterFeaturesInDbCached,
    makeBuildingDbRowToRawFeature,
    isRenderableGeometry,
    normalizeCode,
    getFeatureCode,
    getFeatureProperties,
    getFirstMatchingField,
    getLayerLabel,
    getLayerCodeField,
    getLayerNameField,
    buildRoadBaseRow,
    getLayerDataCache: () => layerDataCache,
    getLayerConfigs: () => layerConfigs,
    getIsPlanningMode: () => isPlanningMode,
    refreshCommunityTasksOnMap,
    syncBasemapUIBySpace
  };
}

async function listCurrentPersonalLayerFeatures(spaceId, layerKey) {
  if (!personalSpaceClient) return [];
  const selections = await personalSpaceClient.listSelections(spaceId);
  const selected = (selections || []).find((item) => item.layer_key === layerKey);
  if (!selected?.current_version_id) return [];
  return personalSpaceClient.listFeatures(selected.current_version_id);
}

function syncSidebarExpansionUI() {
  window.isSpaceSidebarExpanded = isSpaceSidebarExpanded;

  if (spaceList) {
    spaceList.classList.toggle("active", isSpaceSidebarExpanded);
  }
}

function getLayerIconSvg(layerKey) {
  return getSpacePanelModule().getLayerIconSvg(layerKey);
}

function renderSpaceList() {
  const result = getSpacePanelModule().renderSpaceList(buildSpacePanelDeps());
  updateWorkspaceContextBar();
  if (isProjectSettingsOpen) {
    Promise.resolve(refreshCommunityMessageBoard()).catch((error) => {
      console.warn("刷新问题与留言失败：", error);
    });
  }
  return result;
}

function bindSpaceListEvents() {
  return getSpacePanelEventsModule().bindSpaceListEvents(buildSpacePanelEventsDeps());
}

async function handleSpaceSelect(spaceId) {
  const result = await getViewSwitcherModule().handleSpaceSelect(buildViewSwitcherDeps(), spaceId);
  saveAppState();
  return result;
}

async function switchTo2DView() {
  return getViewSwitcherModule().switchTo2DView(buildViewSwitcherDeps());
}

async function switchTo3DView() {
  return getViewSwitcherModule().switchTo3DView(buildViewSwitcherDeps());
}

function hasRequiredNewLayout() {
  return !!(
    mainLayout &&
    overviewView &&
    courseTaskSidebar &&
    courseTaskToggleBtn &&
    courseWorkbenchContent &&
    courseTaskNav &&
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载失败：${url}`);
  }
  return response.text();
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载失败：${url}`);
  }
  return response.json();
}

function isEditableSpace(spaceId = currentSpaceId) {
  return canManageSpace(spaceId);
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
  const preferred = isEditableGeometryLayer(currentGeometryEditLayer) ? currentGeometryEditLayer : "";
  return preferred && selectedLayers.includes(preferred) ? preferred : "";
}

function invalidateBuildingDbCache(spaceId = null) {
  return getFeatureDbModule().invalidateBuildingDbCache(buildFeatureDbDeps(), spaceId);
}

function invalidateRoadDbCache(spaceId = null) {
  return getFeatureDbModule().invalidateRoadDbCache(buildFeatureDbDeps(), spaceId);
}

function invalidateCroplandDbCache(spaceId = null) {
  return getFeatureDbModule().invalidateCroplandDbCache(buildFeatureDbDeps(), spaceId);
}

function invalidateOpenSpaceDbCache(spaceId = null) {
  return getFeatureDbModule().invalidateOpenSpaceDbCache(buildFeatureDbDeps(), spaceId);
}

function invalidateWaterDbCache(spaceId = null) {
  return getFeatureDbModule().invalidateWaterDbCache(buildFeatureDbDeps(), spaceId);
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
  return getFeatureDbModule().listBuildingFeaturesFromDb(buildFeatureDbDeps(), spaceId);
}

async function listBuildingFeaturesFromDbCached(spaceId, options = {}) {
  return getFeatureDbModule().listBuildingFeaturesFromDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function listRoadFeaturesFromDbCached(spaceId, options = {}) {
  return getFeatureDbModule().listRoadFeaturesFromDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function listCroplandFeaturesFromDb(spaceId) {
  return getFeatureDbModule().listCroplandFeaturesFromDb(buildFeatureDbDeps(), spaceId);
}

async function listCroplandFeaturesFromDbCached(spaceId, options = {}) {
  return getFeatureDbModule().listCroplandFeaturesFromDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function listOpenSpaceFeaturesFromDb(spaceId) {
  return getFeatureDbModule().listOpenSpaceFeaturesFromDb(buildFeatureDbDeps(), spaceId);
}

async function listOpenSpaceFeaturesFromDbCached(spaceId, options = {}) {
  return getFeatureDbModule().listOpenSpaceFeaturesFromDbCached(buildFeatureDbDeps(), spaceId, options);
}
const MC_SYNC_CONFIG_TABLE = "mc_sync_config";
const MC_BUILDING_STATE_TABLE = "mc_building_state";
const MC_VILLAGE_ID = "village_demo_01";

function getPolygonOuterRing(geom) {
  return getMcBridgeModule().getPolygonOuterRing(geom);
}

function lonLatToMcXZ(lon, lat, config) {
  return getMcBridgeModule().lonLatToMcXZ(lon, lat, config);
}

function polygonRingToMcFootprintBlocks(ring, config) {
  return getMcBridgeModule().polygonRingToMcFootprintBlocks(ring, config);
}

function isPointInPolygon2D(point, polygon) {
  return getMcBridgeModule().isPointInPolygon2D(point, polygon);
}

function inferHeightBlocksFromProps(props = {}) {
  return getMcBridgeModule().inferHeightBlocksFromProps(props);
}

async function loadMcSyncConfig(villageId = MC_VILLAGE_ID) {
  return getMcBridgeModule().loadMcSyncConfig(buildMcBridgeDeps(), villageId);
}

async function exportCurrentSpaceBuildingsToMc() {
  return getMcBridgeModule().exportCurrentSpaceBuildingsToMc(buildMcBridgeDeps());
}

function bindMcExportButton() {
  return getMcBridgeModule().bindMcExportButton(buildMcBridgeDeps());
}

async function upsertBuildingFeatureToDb({
  spaceId,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  return getFeatureDbModule().upsertBuildingFeatureToDb(buildFeatureDbDeps(), {
    spaceId,
    objectCode,
    objectName,
    geom,
    props
  });
}

async function upsertRoadFeatureToDb({
  spaceId,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  return getFeatureDbModule().upsertRoadFeatureToDb(buildFeatureDbDeps(), {
    spaceId,
    objectCode,
    objectName,
    geom,
    props
  });
}

function invalidateLayerDbCache(layerKey, spaceId) {
  return getFeatureDbModule().invalidateLayerDbCache(buildFeatureDbDeps(), layerKey, spaceId);
}

async function upsertLayerFeatureToDb({
  spaceId,
  layerKey,
  objectCode,
  objectName,
  geom,
  props = {}
}) {
  if (getSpaceById(spaceId)?.spaceType === "course_personal") {
    const versionId = await resolveCurrentPersonalVersionId(spaceId, layerKey);
    if (!versionId) throw new Error("PERSONAL_LAYER_VERSION_REQUIRED");
    return personalSpaceClient.upsertFeature({
      spaceId,
      versionId,
      layerKey,
      objectCode,
      objectName,
      geom,
      props
    });
  }
  return getFeatureDbModule().upsertLayerFeatureToDb(buildFeatureDbDeps(), {
    spaceId,
    layerKey,
    objectCode,
    objectName,
    geom,
    props
  });
}

async function softDeleteBuildingFeatureInDb(spaceId, objectCode) {
  return getFeatureDbModule().softDeleteBuildingFeatureInDb(buildFeatureDbDeps(), spaceId, objectCode);
}

async function softDeleteRoadFeatureInDb(spaceId, objectCode) {
  return getFeatureDbModule().softDeleteRoadFeatureInDb(buildFeatureDbDeps(), spaceId, objectCode);
}

async function softDeleteLayerFeatureInDb(spaceId, layerKey, objectCode) {
  if (getSpaceById(spaceId)?.spaceType === "course_personal") {
    const versionId = await resolveCurrentPersonalVersionId(spaceId, layerKey);
    if (!versionId) throw new Error("PERSONAL_LAYER_VERSION_REQUIRED");
    return personalSpaceClient.softDeleteFeature(versionId, objectCode);
  }
  return getFeatureDbModule().softDeleteLayerFeatureInDb(buildFeatureDbDeps(), spaceId, layerKey, objectCode);
}

async function resolveCurrentPersonalVersionId(spaceId, layerKey) {
  if (!personalSpaceClient) return null;
  const selections = await personalSpaceClient.listSelections(spaceId);
  return (selections || []).find((item) => item.layer_key === layerKey)?.current_version_id || null;
}

async function listDeletedLayerFeatureCodesFromDb(spaceId, layerKey) {
  return getFeatureDbModule().listDeletedLayerFeatureCodesFromDb(buildFeatureDbDeps(), spaceId, layerKey);
}

async function hasAnyBuildingFeaturesInDb(spaceId) {
  return getFeatureDbModule().hasAnyBuildingFeaturesInDb(buildFeatureDbDeps(), spaceId);
}

async function hasAnyRoadFeaturesInDb(spaceId) {
  return getFeatureDbModule().hasAnyRoadFeaturesInDb(buildFeatureDbDeps(), spaceId);
}

async function hasAnyCroplandFeaturesInDb(spaceId) {
  return getFeatureDbModule().hasAnyCroplandFeaturesInDb(buildFeatureDbDeps(), spaceId);
}

async function hasAnyOpenSpaceFeaturesInDb(spaceId) {
  return getFeatureDbModule().hasAnyOpenSpaceFeaturesInDb(buildFeatureDbDeps(), spaceId);
}

async function hasAnyBuildingFeaturesInDbCached(spaceId, options = {}) {
  return getFeatureDbModule().hasAnyBuildingFeaturesInDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function hasAnyRoadFeaturesInDbCached(spaceId, options = {}) {
  return getFeatureDbModule().hasAnyRoadFeaturesInDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function hasAnyCroplandFeaturesInDbCached(spaceId, options = {}) {
  return getFeatureDbModule().hasAnyCroplandFeaturesInDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function hasAnyOpenSpaceFeaturesInDbCached(spaceId, options = {}) {
  return getFeatureDbModule().hasAnyOpenSpaceFeaturesInDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function listWaterFeaturesFromDb(spaceId) {
  return getFeatureDbModule().listWaterFeaturesFromDb(buildFeatureDbDeps(), spaceId);
}

async function listWaterFeaturesFromDbCached(spaceId, options = {}) {
  return getFeatureDbModule().listWaterFeaturesFromDbCached(buildFeatureDbDeps(), spaceId, options);
}

async function hasAnyWaterFeaturesInDb(spaceId) {
  return getFeatureDbModule().hasAnyWaterFeaturesInDb(buildFeatureDbDeps(), spaceId);
}

async function hasAnyWaterFeaturesInDbCached(spaceId, options = {}) {
  return getFeatureDbModule().hasAnyWaterFeaturesInDbCached(buildFeatureDbDeps(), spaceId, options);
}

function makeBuildingRawFeatureToDbPayload(rawFeature, row, spaceId) {
  return getCopySpaceSeedModule().makeBuildingRawFeatureToDbPayload(buildCopySpaceSeedDeps(), rawFeature, row, spaceId);
}

function makeRoadRawFeatureToDbPayload(rawFeature, row, spaceId) {
  return getCopySpaceSeedModule().makeRoadRawFeatureToDbPayload(buildCopySpaceSeedDeps(), rawFeature, row, spaceId);
}

async function seedBuildingsForCopySpace(spaceId) {
  return getCopySpaceSeedModule().seedBuildingsForCopySpace(buildCopySpaceSeedDeps(), spaceId);
}

async function seedRoadsForCopySpace(spaceId) {
  return getCopySpaceSeedModule().seedRoadsForCopySpace(buildCopySpaceSeedDeps(), spaceId);
}

async function seedCroplandsForCopySpace(spaceId) {
  return getCopySpaceSeedModule().seedCroplandsForCopySpace(buildCopySpaceSeedDeps(), spaceId);
}

async function seedOpenSpacesForCopySpace(spaceId) {
  return getCopySpaceSeedModule().seedOpenSpacesForCopySpace(buildCopySpaceSeedDeps(), spaceId);
}

async function seedWaterForCopySpace(spaceId) {
  return getCopySpaceSeedModule().seedWaterForCopySpace(buildCopySpaceSeedDeps(), spaceId);
}

function getBuildingFeaturesOnMap() {
  return getGeometryEditorModule().getBuildingFeaturesOnMap(buildGeometryEditorDeps());
}

function getRoadFeaturesOnMap() {
  return getGeometryEditorModule().getRoadFeaturesOnMap(buildGeometryEditorDeps());
}

function getFeaturesOnMapByLayer(layerKey) {
  return getGeometryEditorModule().getFeaturesOnMapByLayer(buildGeometryEditorDeps(), layerKey);
}

async function generateNextBuildingCode(spaceId) {
  return getGeometryEditorModule().generateNextBuildingCode(buildGeometryEditorDeps(), spaceId);
}

async function generateNextRoadCode(spaceId) {
  return getGeometryEditorModule().generateNextRoadCode(buildGeometryEditorDeps(), spaceId);
}

async function generateNextGenericLayerCode(layerKey, spaceId) {
  return getGeometryEditorModule().generateNextGenericLayerCode(buildGeometryEditorDeps(), layerKey, spaceId);
}

function markBuildingDirty(feature) {
  return getGeometryEditorModule().markBuildingDirty(buildGeometryEditorDeps(), feature);
}

function clearBuildingInteractions(options = {}) {
  return getGeometryEditorModule().clearBuildingInteractions(buildGeometryEditorDeps(), options);
}

function updateBuildingEditorToolbarState() {
  return getGeometryEditorModule().updateBuildingEditorToolbarState(buildGeometryEditorDeps());
}

function setGeometryEditLayer(layerKey) {
  return getGeometryEditorModule().setGeometryEditLayer(buildGeometryEditorDeps(), layerKey);
}

function ensureBuildingEditorToolbar() {
  return getGeometryEditorModule().ensureBuildingEditorToolbar(buildGeometryEditorDeps());
}

function getCommunityTaskTypeMeta(category) {
  return COMMUNITY_TASK_TYPE_META[category] || COMMUNITY_TASK_TYPE_META.garbage;
}

function syncCommunityTaskUiState() {
  const mount = document.getElementById("communityBuildMount");
  if (mount) {
    // 同步类型开关按钮状态
    const typeButtons = mount.querySelectorAll("[data-community-task-type]");
    typeButtons.forEach((btn) => {
      const category = btn.dataset.communityTaskType;
      btn.classList.toggle("is-active", communityTaskVisibleCategories.has(category));
    });
  }

  // 同步发布留言按钮状态（可能在 infoPanel 的留言板 header 中）
  document.querySelectorAll("[data-community-action=\"report-point\"]").forEach((btn) => {
    btn.classList.toggle("is-active", communityTaskEditState.mode === "report");
  });
}

function startCommunityTaskReport({ requireLocation = false } = {}) {
  if (!currentUserName) {
    showToast("请先登录后再发布留言", "error");
    communityTaskEditState.mode = "idle";
    return false;
  }

  showCommunityTaskReportDialog({
    requireLocation,
    onSubmit: async ({ category, description, photoFile }) => {
      if (category) {
        // 选择了类型，需要地图选点
        communityTaskEditState.mode = "report";
        communityTaskEditState.category = category;
        communityTaskEditState.pendingPayload = { category, description, photoFile };
        const meta = COMMUNITY_TASK_TYPE_META[category];
        showToast(`请在地图上点击选择【${meta?.label || category}】位置`, "info");
        syncCommunityTaskUiState();
      } else {
        // 普通留言，直接发布（无坐标）
        await submitCommunityMessage({ category: null, description, photoFile, lng: null, lat: null });
      }
    },
    onCancel: () => {
      communityTaskEditState.mode = "idle";
      communityTaskEditState.pendingPayload = null;
      syncCommunityTaskUiState();
    }
  });
  return true;
}

async function submitCommunityMessage({ category, description, photoFile, lng, lat }) {
  const taskMeta = category ? COMMUNITY_TASK_TYPE_META[category] : null;
  try {
    const createdTask = await createCommunityTask({
      spaceId: currentSpaceId,
      reporterName: currentUserName,
      lng,
      lat,
      category,
      description
    });

    if (photoFile) {
      try {
        await uploadObjectPhoto(
          photoFile,
          getCommunityTaskPhotoObjectCode(createdTask.id),
          COMMUNITY_TASK_PHOTO_OBJECT_TYPE,
          currentUserName
        );
      } catch (photoError) {
        const client = getSupabaseClient();
        await client.from(COMMUNITY_TASKS_TABLE).delete().eq("id", createdTask.id);
        throw new Error("照片上传失败，请重新发布");
      }
    }

    communityTaskEditState.mode = "idle";
    communityTaskEditState.pendingPayload = null;
    syncCommunityTaskUiState();

    if (category) {
      try {
        const OL = await getOlReady();
        const format = new OL.GeoJSON();
        // 如果 Supabase 返回的数据缺少坐标字段，用传入的参数补充
        const safeLng = Number(lng);
        const safeLat = Number(lat);
        if (!getCommunityTaskPosition(createdTask) && Number.isFinite(safeLng) && Number.isFinite(safeLat)) {
          createdTask.lng = safeLng;
          createdTask.lat = safeLat;
          createdTask.geom = { type: "Point", coordinates: [safeLng, safeLat] };
        }
        const added = addCommunityTaskFeatureToMap(createdTask, format);
        if (!added) {
          console.warn("[submitCommunityMessage] addCommunityTaskFeatureToMap 返回 null，taskRow:", createdTask);
        }
        planVectorLayer?.changed();
      } catch (e) {
        console.error("[submitCommunityMessage] 添加任务标记到地图失败:", e);
      }
    }

    invalidateCommunityTaskCache(currentSpaceId);
    await refreshCommunityScoreBadge();
    await refreshCommunityMessageBoard();
    showToast(taskMeta ? `【${taskMeta.label}】留言发布成功` : "留言发布成功", "success");
    return true;
  } catch (error) {
    communityTaskEditState.mode = "idle";
    communityTaskEditState.pendingPayload = null;
    syncCommunityTaskUiState();
    showToast(error?.message || "发布失败，请查看控制台。", "error");
    console.error(error);
    return false;
  }
}

function focusCommunityMessageComposer() {
  const board = document.getElementById("communityMessageBoard");
  const input = document.getElementById("communityMessageInput");
  board?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => input?.focus(), 120);
}

function showCommunityTaskReportDialog({ onSubmit, onCancel, requireLocation = false }) {
  const typeMeta = COMMUNITY_TASK_TYPE_META;
  const typeEntries = Object.entries(typeMeta);
  const initialCategory = requireLocation ? (typeEntries[0]?.[0] || "") : "";
  const typeColors = {
    garbage: "#c64040",
    road_damage: "#ef6c00",
    drainage_issue: "#2196f3",
    safety_hazard: "#7b1fa2",
    public_space_need: "#2e7d32"
  };

  const overlay = document.createElement("div");
  overlay.className = "community-report-dialog-overlay";
  overlay.innerHTML = `
    <div class="community-report-dialog">
      <h3 class="dialog-title">${requireLocation ? "标记问题" : "发布留言"}</h3>
      <div class="dialog-body">
        <div class="dialog-field">
          <label class="dialog-label">留言内容<span id="reportDescError" class="dialog-field-error" style="display:none">请输入留言内容</span></label>
          <textarea id="reportDescInput" class="dialog-textarea" rows="3" maxlength="200" placeholder="写下你想说的话（最多200字）"></textarea>
        </div>
        <div class="dialog-field">
          <label class="dialog-label">任务类型（可选，选择后需在地图上标记位置）</label>
          <div class="dialog-type-grid">
            ${requireLocation ? "" : `
              <label class="dialog-type-option is-selected" data-type="">
                <input type="radio" name="reportType" value="" checked>
                <span class="type-dot" style="background:#9e9e9e"></span>
                <span class="type-name">普通留言</span>
              </label>
            `}
            ${typeEntries.map(([key, meta], index) => `
              <label class="dialog-type-option ${requireLocation && index === 0 ? "is-selected" : ""}" data-type="${key}">
                <input type="radio" name="reportType" value="${key}" ${requireLocation && index === 0 ? "checked" : ""}>
                <span class="type-dot" style="background:${typeColors[key] || '#999'}"></span>
                <span class="type-name">${escapeHtml(meta.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="dialog-field">
          <label class="dialog-label">现场照片（可选）</label>
          <div class="dialog-photo-row">
            <button type="button" id="reportPhotoBtn" class="dialog-photo-btn">选择照片</button>
            <span id="reportPhotoName" class="dialog-photo-name">未选择</span>
          </div>
          <input type="file" id="reportPhotoInput" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" id="reportCancelBtn" class="dialog-btn dialog-btn-secondary">取消</button>
        <button type="button" id="reportSubmitBtn" class="dialog-btn dialog-btn-primary">${requireLocation ? "下一步：地图选点" : "发布留言"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let selectedPhotoFile = null;
  let selectedCategory = initialCategory;

  const typeOptions = overlay.querySelectorAll(".dialog-type-option");
  typeOptions.forEach((opt) => {
    opt.addEventListener("click", () => {
      typeOptions.forEach((o) => o.classList.remove("is-selected"));
      opt.classList.add("is-selected");
      selectedCategory = opt.dataset.type;
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  const photoInput = overlay.querySelector("#reportPhotoInput");
  const photoBtn = overlay.querySelector("#reportPhotoBtn");
  const photoName = overlay.querySelector("#reportPhotoName");

  photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (file) {
      selectedPhotoFile = file;
      photoName.textContent = file.name;
    } else {
      selectedPhotoFile = null;
      photoName.textContent = "未选择";
    }
  });

  const descInput = overlay.querySelector("#reportDescInput");

  function cleanup() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  overlay.querySelector("#reportCancelBtn").addEventListener("click", () => {
    cleanup();
    if (onCancel) onCancel();
  });

  const descError = overlay.querySelector("#reportDescError");

  descInput.addEventListener("input", () => {
    if (descError) descError.style.display = "none";
  });

  overlay.querySelector("#reportSubmitBtn").addEventListener("click", async () => {
    const desc = String(descInput.value || "").trim();
    if (!desc) {
      if (descError) descError.style.display = "";
      return;
    }

    overlay.querySelector("#reportSubmitBtn").disabled = true;
    overlay.querySelector("#reportSubmitBtn").textContent = "发布中...";

    try {
      await onSubmit({ category: selectedCategory || null, description: desc, photoFile: selectedPhotoFile });
      cleanup();
    } catch (error) {
      overlay.querySelector("#reportSubmitBtn").disabled = false;
      overlay.querySelector("#reportSubmitBtn").textContent = "发布留言";
      showToast(error?.message || "发布失败", "error");
    }
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      cleanup();
      if (onCancel) onCancel();
    }
  });
}

function ensureCommunityBuildPanel() {
  const mount = document.getElementById("communityBuildMount");
  if (!mount) return;

  const typeMeta = COMMUNITY_TASK_TYPE_META;
  const typeColors = {
    garbage: "#c64040",
    road_damage: "#ef6c00",
    drainage_issue: "#2196f3",
    safety_hazard: "#7b1fa2",
    public_space_need: "#2e7d32"
  };

  mount.innerHTML = `
    <div id="communityBuildPanel" class="community-build-panel">
      <div class="community-panel-actions">
        <button type="button" class="community-report-btn" data-community-action="report-point">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          <span>标记问题</span>
        </button>
      </div>
      <div class="community-type-section">
        <div class="community-type-list" data-community-type-body>
          ${Object.entries(typeMeta).map(([key, meta]) => `
            <button type="button" class="community-type-btn ${communityTaskVisibleCategories.has(key) ? "is-active" : ""}" data-community-task-type="${key}">
              <span class="type-dot" style="background:${typeColors[key] || '#999'}"></span>
              <span class="type-label">${escapeHtml(meta.label)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  mount.querySelectorAll('[data-community-action="report-point"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (communityTaskEditState.mode === "report") {
        communityTaskEditState.mode = "idle";
        communityTaskEditState.pendingPayload = null;
        showToast("已取消问题标记", "info");
      } else {
        startCommunityTaskReport({ requireLocation: true });
      }
      syncCommunityTaskUiState();
    });
  });

  const communityMessageSubmitBtn = document.getElementById("communityMessageSubmitBtn");
  if (communityMessageSubmitBtn && !communityMessageSubmitBtn.dataset.bound) {
    communityMessageSubmitBtn.dataset.bound = "1";
    communityMessageSubmitBtn.addEventListener("click", async () => {
      const input = document.getElementById("communityMessageInput");
      const description = String(input?.value || "").trim();
      if (!currentUserName) {
        showToast("请先登录后再发表留言", "error");
        return;
      }
      if (!description) {
        showToast("请先填写留言内容", "error");
        input?.focus();
        return;
      }
      communityMessageSubmitBtn.disabled = true;
      const published = await submitCommunityMessage({ category: null, description, photoFile: null, lng: null, lat: null });
      communityMessageSubmitBtn.disabled = false;
      if (published && input) input.value = "";
    });
  }

  mount.querySelectorAll("[data-community-task-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const category = btn.dataset.communityTaskType;
      if (communityTaskVisibleCategories.has(category)) {
        communityTaskVisibleCategories.delete(category);
      } else {
        communityTaskVisibleCategories.add(category);
      }
      syncCommunityTaskUiState();
      refreshCommunityTasksOnMapAsync();
      saveAppState();
    });
  });

  refreshCommunityScoreBadge();
  syncCommunityTaskUiState();
}


async function refreshCommunityTasksOnMapAsync() {
  if (!planVectorSource) return;
  const OL = await (olReady || window.__olReady);
  if (!OL) return;
  const format = new OL.GeoJSON();
  const existing = planVectorSource.getFeatures().filter((f) => f.get("layerKey") === "communityTask");
  existing.forEach((f) => planVectorSource.removeFeature(f));
  await refreshCommunityTasksOnMap(format);
  planVectorLayer?.changed();
}

async function refreshCommunityMessageBoard() {
  let listEl = document.getElementById("communityMessageList");
  let boardEl = document.getElementById("communityMessageBoard");

  // 如果已有留言板但没有排序下拉框，补一个
  if (boardEl && !boardEl.querySelector("#communityMessageSortSelect")) {
    const sortRow = document.createElement("div");
    sortRow.className = "community-message-sort-row";
    sortRow.innerHTML = `
      <select id="communityMessageSortSelect" class="community-message-sort-select">
        <option value="time_desc">时间晚→早</option>
        <option value="time_asc">时间早→晚</option>
        <option value="likes_desc">点赞多→少</option>
        <option value="likes_asc">点赞少→多</option>
        <option value="replies_desc">评论多→少</option>
        <option value="replies_asc">评论少→多</option>
      </select>
    `;
    listEl?.parentNode?.insertBefore(sortRow, listEl);
    const sortSelect = document.getElementById("communityMessageSortSelect");
    if (sortSelect) {
      sortSelect.value = messageBoardSortOrder;
      sortSelect.addEventListener("change", (e) => {
        messageBoardSortOrder = e.target.value;
        refreshCommunityMessageBoard();
      });
    }
  }

  if (!listEl) return;
  listEl.innerHTML = '<div class="community-message-loading">加载中...</div>';

  try {
    const module = getCommunityTasksModule();
    const deps = buildCommunityTaskDeps();
    const rows = await module.listCommunityTasksCached(deps, currentSpaceId, { force: true });

    // 先获取所有消息的元数据（点赞数、评论数）
    const messageMeta = await Promise.all(
      (rows || []).map(async (msg) => {
        const likers = await module.fetchMessageLikes(deps, msg.id);
        const replies = await module.fetchMessageReplies(deps, msg.id);
        return {
          msg,
          likers,
          replies,
          likeCount: likers.length,
          replyCount: replies.length,
          createdAt: Date.parse(msg.created_at || "") || 0
        };
      })
    );

    // 主评论排序
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

    // 追评始终按时间晚→早排序
    messageMeta.forEach((meta) => {
      meta.replies.sort((a, b) => {
        const ta = Date.parse(a.created_at || "") || 0;
        const tb = Date.parse(b.created_at || "") || 0;
        return tb - ta;
      });
    });

    const messages = messageMeta.map((m) => m.msg);

    if (messages.length === 0) {
      listEl.innerHTML = '<div class="community-message-empty">暂无留言</div>';
      return;
    }

    const typeMeta = COMMUNITY_TASK_TYPE_META;
    const typeColors = {
      garbage: "#c64040",
      road_damage: "#ef6c00",
      drainage_issue: "#2196f3",
      safety_hazard: "#7b1fa2",
      public_space_need: "#2e7d32"
    };

    const cardsHtml = await Promise.all(
      messageMeta.map(async (meta) => {
        const msg = meta.msg;
        const photos = await module.fetchCommunityTaskPhotos(deps, msg.id);
        const likers = meta.likers;
        const replies = meta.replies;
        const likeCount = meta.likeCount;
        const hasLiked = currentUserName ? likers.includes(currentUserName) : false;
        const isOwner = currentUserName && currentUserName === msg.reporter_name;
        const categoryLabel = msg.category ? (typeMeta[msg.category]?.label || msg.category) : null;
        const categoryColor = msg.category ? (typeColors[msg.category] || "#999") : null;

        const photoHtml = photos.length
          ? `<div class="community-message-photos">${photos.map((p) => `<img src="${escapeHtml(p.photo_url || "")}" alt="照片" onclick="window.open('${escapeHtml(p.photo_url || "")}','_blank')">`).join("")}</div>`
          : "";

        const categoryBadge = categoryLabel
          ? `<span class="community-message-category" style="color:${categoryColor};background:${categoryColor}11;border:1px solid ${categoryColor}22;">${escapeHtml(categoryLabel)}</span>`
          : "";

        const replyItemsHtml = replies.length
          ? replies.map((r) => {
              const rLikers = Array.isArray(r.likers) ? r.likers : [];
              const rLikeCount = rLikers.length;
              const rHasLiked = currentUserName ? rLikers.includes(currentUserName) : false;
              const rIsOwner = currentUserName && currentUserName === r.author;
              return `
            <div class="community-reply-item" data-reply-id="${r.id}">
              <div class="community-reply-header">
                <div>
                  <span class="community-reply-author">${escapeHtml(r.author || "未知")}</span>
                  <span class="community-reply-time">${escapeHtml(formatDateTime(r.created_at))}</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <button class="community-reply-like-btn ${rHasLiked ? "is-liked" : ""}" data-reply-like="${msg.id}" data-reply-id="${r.id}" type="button">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="${rHasLiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                    <span>${rLikeCount}</span>
                  </button>
                  ${rIsOwner ? `<button class="community-reply-like-btn danger" data-reply-delete="${msg.id}" data-reply-id="${r.id}" type="button" title="删除"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ""}
                </div>
              </div>
              <div class="community-reply-content">${escapeHtml(r.content || "")}</div>
            </div>
          `;
            }).join("")
          : "";

        const replySectionHtml = `
          <div class="community-replies ${replies.length ? "has-replies" : "is-empty"}" id="msgReplies_${msg.id}">
            ${currentUserName ? `
              <div class="community-reply-input-row" style="display:none;">
                <textarea class="community-reply-input" id="replyInput_${msg.id}" rows="1" placeholder="写下追评..."></textarea>
                <button class="community-reply-submit" data-msg-reply="${msg.id}">发送</button>
              </div>
            ` : ""}
            <div class="community-reply-list">${replyItemsHtml}</div>
          </div>
        `;

        return `
          <div class="community-message-card" data-message-id="${msg.id}">
            <div class="community-message-header">
              <span class="community-message-author">${escapeHtml(msg.reporter_name || "未知")}</span>
              <span class="community-message-time">${escapeHtml(formatDateTime(msg.created_at))}</span>
            </div>
            ${categoryBadge}
            <div class="community-message-content">${escapeHtml(msg.description || "")}</div>
            ${photoHtml}
            <div class="community-message-actions">
              <button class="community-message-action-btn ${hasLiked ? "is-liked" : ""}" data-msg-like="${msg.id}" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="${hasLiked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                <span>${likeCount}</span>
              </button>
              <button class="community-message-action-btn" data-msg-reply-toggle="${msg.id}" type="button" title="追评 ${replies.length}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
              </button>
              ${isOwner ? `<button class="community-message-action-btn danger" data-msg-delete="${msg.id}" type="button" title="删除"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ""}
              ${getCommunityTaskPosition(msg) ? `<button class="community-message-action-btn" data-msg-locate="${msg.id}" type="button" title="定位"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></button>` : ""}
            </div>
            ${replySectionHtml}
          </div>
        `;
      })
    );

    listEl.innerHTML = cardsHtml.join("");

    // 绑定事件
    listEl.querySelectorAll("[data-msg-like]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!currentUserName) {
          showToast("请先登录", "error");
          return;
        }
        const msgId = Number(btn.dataset.msgLike);
        try {
          const module = getCommunityTasksModule();
          const deps = buildCommunityTaskDeps();
          const result = await module.toggleMessageLike(deps, { messageId: msgId, likerName: currentUserName });
          showToast(result.liked ? "已点赞" : "已取消点赞", "success");
          // 局部更新 DOM
          const card = btn.closest(".community-message-card");
          if (card) {
            const likeBtn = card.querySelector(`[data-msg-like="${msgId}"]`);
            if (likeBtn) {
              likeBtn.classList.toggle("is-liked", result.liked);
              const svg = likeBtn.querySelector("svg");
              if (svg) svg.setAttribute("fill", result.liked ? "currentColor" : "none");
              const countSpan = likeBtn.querySelector("span");
              if (countSpan) countSpan.textContent = result.count;
            }
          }
        } catch (e) {
          showToast(e?.message || "操作失败", "error");
        }
      });
    });

    listEl.querySelectorAll("[data-msg-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msgId = Number(btn.dataset.msgDelete);
        const ok = await customConfirm("确认删除这条留言吗？", { title: "删除留言", okText: "删除", cancelText: "取消", isDanger: true });
        if (!ok) return;
        try {
          const module = getCommunityTasksModule();
          const deps = buildCommunityTaskDeps();
          await module.deleteCommunityMessage(deps, msgId);
          showToast("已删除", "success");
          // 局部移除 DOM
          const card = btn.closest(".community-message-card");
          if (card) {
            card.remove();
            if (listEl.children.length === 0) {
              listEl.innerHTML = '<div class="community-message-empty">暂无留言</div>';
            }
          }
          await refreshCommunityTasksOnMapAsync();
        } catch (e) {
          showToast(e?.message || "删除失败", "error");
        }
      });
    });

    listEl.querySelectorAll("[data-msg-reply-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = btn.dataset.msgReplyToggle;
        const el = document.getElementById(`msgReplies_${msgId}`);
        if (!el) return;
        const inputRow = el.querySelector(".community-reply-input-row");
        if (inputRow) {
          const shouldOpen = !el.classList.contains("is-open");
          el.classList.toggle("is-open", shouldOpen);
          inputRow.style.display = shouldOpen ? "" : "none";
          if (shouldOpen) inputRow.querySelector(".community-reply-input")?.focus();
        }
      });
    });

    listEl.querySelectorAll("[data-msg-locate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = Number(btn.dataset.msgLocate);
        if (!planVectorSource || !planMap) return;
        const feature = planVectorSource.getFeatures().find((f) => f.get("sourceCode") === `TASK_${msgId}`);
        if (!feature) {
          showToast("未找到该留言的地图标记", "error");
          return;
        }
        doSetActiveFeature(feature);
        planVectorLayer?.changed();
        const geom = feature.getGeometry();
        if (geom) {
          const coordinate = geom.getCoordinates();
          planMap.getView().setCenter(coordinate);
          planMap.getView().setZoom(19);
        }
      });
    });

    listEl.querySelectorAll("[data-msg-reply]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const msgId = Number(btn.dataset.msgReply);
        const input = document.getElementById(`replyInput_${msgId}`);
        const content = String(input?.value || "").trim();
        if (!content) {
          showToast("请输入追评内容", "error");
          return;
        }
        try {
          const module = getCommunityTasksModule();
          const deps = buildCommunityTaskDeps();
          const nextReplies = await module.addMessageReply(deps, { messageId: msgId, authorName: currentUserName, content });
          showToast("追评已发布", "success");
          if (input) input.value = "";
          // 收起输入框
          const replySection = document.getElementById(`msgReplies_${msgId}`);
          if (replySection) {
            const inputRow = replySection.querySelector(".community-reply-input-row");
            if (inputRow) inputRow.style.display = "none";
            replySection.classList.remove("is-open", "is-empty");
            replySection.classList.add("has-replies");
          }
          // 局部更新 DOM
          const card = btn.closest(".community-message-card");
          if (card) {
            const replyList = card.querySelector(".community-reply-list");
            if (replyList && Array.isArray(nextReplies) && nextReplies.length > 0) {
              const newReply = nextReplies[nextReplies.length - 1];
              const replyHtml = `
                <div class="community-reply-item" data-reply-id="${newReply.id}">
                  <div class="community-reply-header">
                    <div>
                      <span class="community-reply-author">${escapeHtml(newReply.author || "未知")}</span>
                      <span class="community-reply-time">${escapeHtml(formatDateTime(newReply.created_at))}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                      <button class="community-reply-like-btn" data-reply-like="${msgId}" data-reply-id="${newReply.id}" type="button">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                        <span>0</span>
                      </button>
                      <button class="community-reply-like-btn danger" data-reply-delete="${msgId}" data-reply-id="${newReply.id}" type="button" title="删除"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                    </div>
                  </div>
                  <div class="community-reply-content">${escapeHtml(newReply.content || "")}</div>
                </div>
              `;
              replyList.insertAdjacentHTML("beforeend", replyHtml);
              bindReplyLikeEvent(card);
              bindReplyDeleteEvent(card);
            }
            const replyToggleBtn = card.querySelector(`[data-msg-reply-toggle="${msgId}"]`);
            if (replyToggleBtn) {
              replyToggleBtn.title = `追评 ${nextReplies.length}`;
            }
          }
        } catch (e) {
          showToast(e?.message || "发布失败", "error");
        }
      });
    });

    function bindReplyLikeEvent(root) {
      root.querySelectorAll("[data-reply-like]").forEach((btn) => {
        if (btn.__replyLikeBound) return;
        btn.__replyLikeBound = true;
        btn.addEventListener("click", async () => {
          if (!currentUserName) {
            showToast("请先登录", "error");
            return;
          }
          const msgId = Number(btn.dataset.replyLike);
          const replyId = btn.dataset.replyId;
          try {
            const module = getCommunityTasksModule();
            const deps = buildCommunityTaskDeps();
            const result = await module.toggleReplyLike(deps, { messageId: msgId, replyId, likerName: currentUserName });
            showToast(result.liked ? "已点赞" : "已取消点赞", "success");
            btn.classList.toggle("is-liked", result.liked);
            const svg = btn.querySelector("svg");
            if (svg) svg.setAttribute("fill", result.liked ? "currentColor" : "none");
            const countSpan = btn.querySelector("span");
            if (countSpan) countSpan.textContent = result.count;
          } catch (e) {
            showToast(e?.message || "操作失败", "error");
          }
        });
      });
    }

    function bindReplyDeleteEvent(root) {
      root.querySelectorAll("[data-reply-delete]").forEach((btn) => {
        if (btn.__replyDeleteBound) return;
        btn.__replyDeleteBound = true;
        btn.addEventListener("click", async () => {
          const msgId = Number(btn.dataset.replyDelete);
          const replyId = btn.dataset.replyId;
          const ok = await customConfirm("确认删除这条追评吗？", { title: "删除追评", okText: "删除", cancelText: "取消", isDanger: true });
          if (!ok) return;
          try {
            const module = getCommunityTasksModule();
            const deps = buildCommunityTaskDeps();
            await module.deleteMessageReply(deps, { messageId: msgId, replyId });
            showToast("已删除", "success");
            const replyItem = btn.closest(".community-reply-item");
            if (replyItem) replyItem.remove();
          } catch (e) {
            showToast(e?.message || "删除失败", "error");
          }
        });
      });
    }

    listEl.querySelectorAll("[data-reply-like]").forEach((btn) => {
      if (btn.__replyLikeBound) return;
      btn.__replyLikeBound = true;
      btn.addEventListener("click", async () => {
        if (!currentUserName) {
          showToast("请先登录", "error");
          return;
        }
        const msgId = Number(btn.dataset.replyLike);
        const replyId = btn.dataset.replyId;
        try {
          const module = getCommunityTasksModule();
          const deps = buildCommunityTaskDeps();
          const result = await module.toggleReplyLike(deps, { messageId: msgId, replyId, likerName: currentUserName });
          showToast(result.liked ? "已点赞" : "已取消点赞", "success");
          btn.classList.toggle("is-liked", result.liked);
          const svg = btn.querySelector("svg");
          if (svg) svg.setAttribute("fill", result.liked ? "currentColor" : "none");
          const countSpan = btn.querySelector("span");
          if (countSpan) countSpan.textContent = result.count;
        } catch (e) {
          showToast(e?.message || "操作失败", "error");
        }
      });
    });

    listEl.querySelectorAll("[data-reply-delete]").forEach((btn) => {
      if (btn.__replyDeleteBound) return;
      btn.__replyDeleteBound = true;
      btn.addEventListener("click", async () => {
        const msgId = Number(btn.dataset.replyDelete);
        const replyId = btn.dataset.replyId;
        const ok = await customConfirm("确认删除这条追评吗？", { title: "删除追评", okText: "删除", cancelText: "取消", isDanger: true });
        if (!ok) return;
        try {
          const module = getCommunityTasksModule();
          const deps = buildCommunityTaskDeps();
          await module.deleteMessageReply(deps, { messageId: msgId, replyId });
          showToast("已删除", "success");
          const replyItem = btn.closest(".community-reply-item");
          if (replyItem) replyItem.remove();
        } catch (e) {
          showToast(e?.message || "删除失败", "error");
        }
      });
    });
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div class="community-message-empty">加载失败</div>';
  }
}

async function startAddBuildingMode(layerKey = "building") {
  return getGeometryEditorModule().startAddBuildingMode(buildGeometryEditorDeps(), layerKey);
}

async function startModifyBuildingMode(layerKey = "building") {
  return getGeometryEditorModule().startModifyBuildingMode(buildGeometryEditorDeps(), layerKey);
}

async function startTranslateBuildingMode(layerKey = "building") {
  return getGeometryEditorModule().startTranslateBuildingMode(buildGeometryEditorDeps(), layerKey);
}

async function startRotateBuildingMode(layerKey = "building") {
  return getGeometryEditorModule().startRotateBuildingMode(buildGeometryEditorDeps(), layerKey);
}

async function startDeleteBuildingMode(layerKey = "building") {
  return getGeometryEditorModule().startDeleteBuildingMode(buildGeometryEditorDeps(), layerKey);
}

async function saveDirtyBuildings(layerKey = "building") {
  const result = await getGeometryEditorModule().saveDirtyBuildings(buildGeometryEditorDeps(), layerKey);
  if (result?.success) {
    await recordCourseActivity(
      "feature_geometry_saved",
      { type: layerKey, id: currentSpaceId },
      { layerKey, batchId: result.batchId || null }
    );
  }
  return result;
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

function canEditLayer(layerKey, editableByIdentity) {
  return !!editableByIdentity && getEditableFields(layerKey).length > 0;
}

function canDeletePhotoByUploader(uploadedBy, actorName = currentUserName) {
  const uploader = normalizeIdentityName(uploadedBy);
  const actor = normalizeIdentityName(actorName);
  if (!actor) return false;
  const isUnknownUploader = !uploader || uploader === "未知" || uploader.toLowerCase() === "unknown";
  if (isUnknownUploader) {
    return isAdminIdentity(actor);
  }
  return uploader === actor;
}

function isCommunityGameTableMissingError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    message.includes("does not exist")
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
  // Personal workspaces render their current version rows from Supabase. The
  // static teacher GeoJSON files are unrelated and can be several MB, so do
  // not download them merely because a personal layer button was toggled.
  if (getCurrentSpace()?.spaceType === "course_personal") return;
  const selectedLayers = getSelectedLayersForCurrentSpace();

  const effective = selectedLayers.includes("figureGround")
    ? Array.from(new Set([...selectedLayers, "elevationBands", "contours", "building", "road", "water"]))
    : [...selectedLayers];

  await Promise.all(effective.map((layerKey) => ensureLayerLoaded(layerKey)));
}

function getOlFeatureStyle(feature, resolution) {
  return getMapStyleModule().getOlFeatureStyle(buildMapStyleDeps(), feature, resolution);
}

function getNiceScaleDistance(targetMeters) {
  const value = Number(targetMeters);
  if (!Number.isFinite(value) || value <= 0) return 0;

  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const candidates = [1, 2, 5, 10].map((factor) => factor * base);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (candidates[i] <= value) return candidates[i];
  }
  return candidates[0];
}

function formatScaleDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1000) {
    const km = value / 1000;
    return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${Math.round(value)} m`;
}

function updateMapScaleBar() {
  if (!mapScaleBar || !mapScaleLabel || !planMap) return;

  const view = planMap.getView();
  const resolution = Number(view?.getResolution?.());
  const center = view?.getCenter?.();
  const latitude = Array.isArray(center) ? Number(center[1]) : 0;
  if (!Number.isFinite(resolution) || resolution <= 0) return;

  const metersPerDegreeAtLat = 111320 * Math.max(0.08, Math.cos((latitude * Math.PI) / 180));
  const metersPerPixel = resolution * metersPerDegreeAtLat;
  const targetPixels = 112;
  const niceMeters = getNiceScaleDistance(metersPerPixel * targetPixels);
  if (!niceMeters) return;

  const widthPx = Math.max(44, Math.min(130, Math.round(niceMeters / metersPerPixel)));
  mapScaleBar.style.setProperty("--scale-width", `${widthPx}px`);
  mapScaleLabel.textContent = formatScaleDistance(niceMeters);
}

function scheduleMapScaleBarUpdate() {
  if (scheduleMapScaleBarUpdate.raf) return;
  scheduleMapScaleBarUpdate.raf = requestAnimationFrame(() => {
    scheduleMapScaleBarUpdate.raf = 0;
    updateMapScaleBar();
  });
}

async function ensurePlanMap() {
  if (planMap) return planMap;

  if (!window.__olReady && typeof window.__loadOpenLayers === "function") {
    window.__loadOpenLayers();
  }
  olReady = olReady || window.__olReady;
  if (!olReady) {
    throw new Error("OpenLayers 模块尚未加载，请检查 index.html 中的 window.__loadOpenLayers。");
  }
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
    extent: getBasemapRenderExtent(georef) || undefined,
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
    zIndex: 300
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

  edgeLabelSource = new VectorSource();
  edgeLabelLayer = new VectorLayer({
    source: edgeLabelSource,
    style: null
  });
  edgeLabelLayer.setZIndex(50);

  planMap = new Map({
    target: "map2d",
    layers: [planOnlineLayer, planLabelLayer, planHighResLayer, planVectorLayer, edgeLabelLayer],
    view: new View({
      center: [
        (georef.minX + georef.maxX) / 2,
        (georef.minY + georef.maxY) / 2
      ],
      zoom: DEFAULT_VILLAGE_VIEW_ZOOM,
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
  view.setZoom(DEFAULT_VILLAGE_VIEW_ZOOM);

  syncBasemapUIBySpace(currentSpaceId);

  view.on("change:resolution", () => {
    syncBasemapUIBySpace(currentSpaceId);
    planVectorLayer?.changed();
    scheduleMapScaleBarUpdate();
  });

  view.on("change:center", scheduleMapScaleBarUpdate);

  getMapHoverHandlerModule().bindPlanMapHover(buildMapHoverHandlerDeps());

  planMap.on("singleclick", async (evt) => {
    await getMapClickHandlerModule().handlePlanMapSingleClick(buildMapClickHandlerDeps(), evt);
  });

  planMap.on("moveend", updateMapScaleBar);
  updateMapScaleBar();

  return planMap;
}

async function refresh2DOverlay() {
  return getOverlayRendererModule().refresh2DOverlay(buildOverlayRendererDeps());
}

function getCommunityTaskPosition(taskRow) {
  if (Number.isFinite(taskRow?.lng) && Number.isFinite(taskRow?.lat)) {
    return [Number(taskRow.lng), Number(taskRow.lat)];
  }
  let geom = taskRow?.geom;
  // Supabase 可能将 geometry 返回为 JSON 字符串
  if (typeof geom === "string") {
    try { geom = JSON.parse(geom); } catch (_) {}
  }
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
  const taskMeta = getCommunityTaskTypeMeta(taskRow.category);
  feature.set("displayName", `${taskMeta.label}`);
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
      if (!communityTaskVisibleCategories.has(row.category)) return;
      addCommunityTaskFeatureToMap(row, format);
    } catch (taskError) {
      console.warn("渲染社区留言失败（已跳过单条）：", taskError, row);
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
  const isOverview = viewKey === "overview";
  const isMapView = viewKey === "plan2d" || viewKey === "model3d";
  const isEnteringMapFromOverview =
    isMapView &&
    mainLayout &&
    (mainLayout.classList.contains("mode-overview") || document.body.classList.contains("landing-only-mode"));

  if (isEnteringMapFromOverview) {
    mainLayout.classList.add("is-view-switching");
  }

  document.body.classList.toggle("landing-only-mode", isOverview);
  document.body.classList.toggle("map-view-active", isMapView);
  document.body.classList.remove("course-workbench-active");

  overviewView.classList.remove("active");
  plan2dView.classList.remove("active");
  model3dView.classList.remove("active");

  mainLayout.classList.remove("mode-overview", "mode-map");

  if (viewKey === "overview") {
    setProjectSettingsOpen(false);
    overviewView.classList.add("active");
    mainLayout.classList.add("mode-overview");
  } else if (viewKey === "plan2d") {
    plan2dView.classList.add("active");
    mainLayout.classList.add("mode-map");
  } else if (viewKey === "model3d") {
    model3dView.classList.add("active");
    mainLayout.classList.add("mode-map");
  }

  const storyPanelTitle = document.querySelector(".story-panel > .panel-header h2");
  if (storyPanelTitle) {
    storyPanelTitle.textContent = "菜单";
  }

  if (statusBadge) {
    statusBadge.classList.remove("is-enter-btn");
    statusBadge.style.display = "none";
  }
  updateUserGreeting(viewKey);
  syncMapSidePanelLayout();

  if (isEnteringMapFromOverview) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mainLayout.classList.remove("is-view-switching");
      });
    });
  }
}

function updateWorkspaceContextBar(context = activeCourseTaskContext) {
  if (context) activeCourseTaskContext = context;
  const course = window.CourseModelModule?.DEFAULT_COURSE;
  const currentSpace = getCurrentSpace();
  const stageTitle = context?.stage?.title || context?.task?.title || "课程实践";

  if (workspaceVillageLabel) {
    workspaceVillageLabel.textContent = course?.villageName || "米埗村";
  }
  if (workspaceStageLabel) {
    workspaceStageLabel.textContent = stageTitle;
    workspaceStageLabel.title = currentSpace?.title
      ? `${stageTitle} · ${currentSpace.title}`
      : stageTitle;
  }
}

function setProjectSettingsOpen(open) {
  isProjectSettingsOpen = Boolean(open);
  projectSettingsDrawer?.classList.toggle("is-open", isProjectSettingsOpen);
  projectSettingsDrawer?.setAttribute("aria-hidden", String(!isProjectSettingsOpen));
  projectSettingsBtn?.setAttribute("aria-expanded", String(isProjectSettingsOpen));

  if (isProjectSettingsOpen) {
    renderSpaceList();
  }
}

function bindProjectSettingsDrawer() {
  if (classDiscussionBtn && !classDiscussionBtn.dataset.bound) {
    classDiscussionBtn.dataset.bound = "1";
    classDiscussionBtn.addEventListener("click", () => {
      isCommunityExpanded = true;
      saveAppState();
      setProjectSettingsOpen(true);
      window.setTimeout(focusCommunityMessageComposer, 0);
    });
  }
  if (projectSettingsBtn && !projectSettingsBtn.dataset.bound) {
    projectSettingsBtn.dataset.bound = "1";
    projectSettingsBtn.addEventListener("click", () => {
      setProjectSettingsOpen(!isProjectSettingsOpen);
    });
  }
  if (projectSettingsCloseBtn && !projectSettingsCloseBtn.dataset.bound) {
    projectSettingsCloseBtn.dataset.bound = "1";
    projectSettingsCloseBtn.addEventListener("click", () => setProjectSettingsOpen(false));
  }
  if (!document.body.dataset.projectSettingsEscapeBound) {
    document.body.dataset.projectSettingsEscapeBound = "1";
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isProjectSettingsOpen) {
        setProjectSettingsOpen(false);
      }
    });
  }
}

function syncMapSidePanelLayout() {
  if (!mainLayout) return;
  mainLayout.classList.toggle("mode-map-left-collapsed", !!isLeftPanelCollapsed);
  mainLayout.classList.toggle("mode-map-right-collapsed", !!isRightPanelCollapsed);
  mainLayout.classList.toggle("course-task-expanded", !!isCourseTaskSidebarExpanded);
  courseTaskSidebar?.classList.toggle("is-expanded", !!isCourseTaskSidebarExpanded);

  if (courseTaskToggleBtn) {
    courseTaskToggleBtn.setAttribute("aria-expanded", String(isCourseTaskSidebarExpanded));
    courseTaskToggleBtn.title = isCourseTaskSidebarExpanded ? "收起课程任务" : "展开课程任务";
  }

  if (leftPanelToggleBtn) {
    leftPanelToggleBtn.textContent = isLeftPanelCollapsed ? "▶" : "◀";
    leftPanelToggleBtn.title = isLeftPanelCollapsed ? "展开左栏" : "收起左栏";
  }

  if (rightPanelToggleBtn) {
    rightPanelToggleBtn.textContent = isRightPanelCollapsed ? "◀" : "▶";
    rightPanelToggleBtn.title = isRightPanelCollapsed ? "展开右栏" : "收起右栏";
  }

  requestAnimationFrame(() => {
    if (plan2dView.classList.contains("active")) {
      planMap?.updateSize();
    }
  });
}

function setCourseTaskSidebarExpanded(expanded, { persist = true } = {}) {
  isCourseTaskSidebarExpanded = Boolean(expanded);
  if (persist) {
    try {
      localStorage.setItem(COURSE_TASK_SIDEBAR_KEY, String(isCourseTaskSidebarExpanded));
    } catch (error) {
      console.warn("保存课程任务栏状态失败：", error);
    }
  }
  syncMapSidePanelLayout();
}

function bindCourseTaskSidebarToggle() {
  try {
    isCourseTaskSidebarExpanded = localStorage.getItem(COURSE_TASK_SIDEBAR_KEY) !== "false";
  } catch (error) {
    isCourseTaskSidebarExpanded = true;
  }
  if (courseTaskToggleBtn && !courseTaskToggleBtn.dataset.bound) {
    courseTaskToggleBtn.dataset.bound = "1";
    courseTaskToggleBtn.addEventListener("click", () => {
      setCourseTaskSidebarExpanded(!isCourseTaskSidebarExpanded);
    });
  }
  syncMapSidePanelLayout();
}

function bindMapSidePanelToggleButtons() {
  if (leftPanelToggleBtn && !leftPanelToggleBtn.dataset.bound) {
    leftPanelToggleBtn.dataset.bound = "1";
    leftPanelToggleBtn.addEventListener("click", () => {
      isLeftPanelCollapsed = !isLeftPanelCollapsed;
      syncMapSidePanelLayout();
    });
  }

  if (rightPanelToggleBtn && !rightPanelToggleBtn.dataset.bound) {
    rightPanelToggleBtn.dataset.bound = "1";
    rightPanelToggleBtn.addEventListener("click", () => {
      isRightPanelCollapsed = !isRightPanelCollapsed;
      syncMapSidePanelLayout();
    });
  }
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
    identityCurrentText.textContent = `当前账号：${currentUserName || "未选择"}`;
  }

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>欢迎使用</h3>
      <p>请先在首页完成账号选择，再点击右上角“进入互动平台”。</p>
    </div>
  `;
  bindIdentityPanelEvents();
  bindHomepageLandingBridge();
  updateUserGreeting("overview");
}
function showPlan2DOverview() {
  update2DStatusText();

  const selectedLayers = getSelectedLayersForCurrentSpace();

  if (!currentSelectedObject) {
    objectInfoRequestSerial += 1;
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
  return baseObjectType; // 照片全空间共享：现状空间与所有复制空间共用同一命名空间
}

function mergeObjectRow(baseRow, editData) {
  return {
    ...(baseRow || {}),
    ...(editData || {})
  };
}

async function fetchObjectEdits(sourceCode, objectType) {
  return getDataServiceModule().fetchObjectEdits(buildDataServiceDeps(), sourceCode, objectType);
}

async function saveObjectEdits(sourceCode, objectType, payload) {
  const result = await getDataServiceModule().saveObjectEdits(buildDataServiceDeps(), sourceCode, objectType, payload);
  await recordCourseActivity("object_attributes_updated", { type: objectType, id: sourceCode }, {
    fields: Object.keys(payload || {})
  });
  return result;
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

async function refreshCommunityScoreBadge() {
  const el = document.getElementById("communityScoreBadge");
  if (!el) return;
  if (!currentUserName) {
    el.textContent = "贡献值：请先登录";
    return;
  }
  const stats = await getCurrentUserStats(currentUserName);
  const points = Number(stats?.total_points || 0);
  const level = Number(stats?.level || 1);
  el.textContent = `贡献值：${points} ｜ Lv.${level}`;
}

async function renameBuildingCodeInDb(spaceId, oldCode, newCode) {
  if (!supabaseClient) throw new Error("当前未配置 Supabase。");
  if (!oldCode || !newCode || oldCode === newCode) return;

  const trimmedNewCode = newCode.trim();
  if (!trimmedNewCode) throw new Error("请输入房屋编码");

  const { error: pfError } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .update({ object_code: trimmedNewCode, object_name: trimmedNewCode })
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .eq("object_code", oldCode);

  if (pfError) throw pfError;

  const objectType2D = getEditNamespaceObjectType("building", spaceId);
  await migrateObjectEdits(oldCode, trimmedNewCode, objectType2D);

  const objectType3D = spaceId === BASE_SPACE_ID ? null : `building_3d__${spaceId}`;
  if (objectType3D) {
    await migrateObjectEdits(oldCode, trimmedNewCode, objectType3D);
  }
}

async function listRoadFeaturesFromDb(spaceId) {
  return getFeatureDbModule().listRoadFeaturesFromDb(buildFeatureDbDeps(), spaceId);
}

async function listCommunityTasks(spaceId) {
  return getCommunityTasksModule().listCommunityTasks(buildCommunityTaskDeps(), spaceId);
}

async function listCommunityTasksCached(spaceId, options = {}) {
  return getCommunityTasksModule().listCommunityTasksCached(buildCommunityTaskDeps(), spaceId, options);
}

async function fetchCommunityTaskPhotos(taskId) {
  return getCommunityTasksModule().fetchCommunityTaskPhotos(buildCommunityTaskDeps(), taskId);
}

async function createCommunityTask({ spaceId, reporterName, lng, lat, category = "garbage", description = "" }) {
  const result = await getCommunityTasksModule().createCommunityTask(buildCommunityTaskDeps(), {
    spaceId,
    reporterName,
    lng,
    lat,
    category,
    description
  });
  await recordCourseActivity(category ? "diagnosis_created" : "comment_created", {
    type: "community_task",
    id: result?.id || ""
  }, { category: category || "comment", hasLocation: Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) });
  return result;
}

async function awardCommunityPoints({ userName, delta, reason, taskId, spaceId }) {
  return getCommunityTasksModule().awardCommunityPoints(buildCommunityTaskDeps(), {
    userName,
    delta,
    reason,
    taskId,
    spaceId
  });
}

async function transitionCommunityTaskStatus({ taskRow, operatorName, nextStatus }) {
  return getCommunityTasksModule().transitionCommunityTaskStatus(buildCommunityTaskDeps(), {
    taskRow,
    operatorName,
    nextStatus
  });
}

async function getCurrentUserStats(userName) {
  return getCommunityTasksModule().getCurrentUserStats(buildCommunityTaskDeps(), userName);
}

async function fetchObjectPhotos(sourceCode, objectType) {
  return getDataServiceModule().fetchObjectPhotos(buildDataServiceDeps(), sourceCode, objectType);
}

async function uploadObjectPhoto(file, sourceCode, objectType, uploadedBy) {
  const result = await getDataServiceModule().uploadObjectPhoto(buildDataServiceDeps(), file, sourceCode, objectType, uploadedBy);
  await recordCourseActivity("photo_uploaded", { type: objectType, id: sourceCode }, {
    fileName: file?.name || "",
    fileSize: Number(file?.size || 0)
  });
  return result;
}

async function deleteObjectPhoto(photoRecord) {
  return getDataServiceModule().deleteObjectPhoto(buildDataServiceDeps(), photoRecord);
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
      const heightInfoIcon = field.key === "建筑高度"
        ? `<span class="toolbox-info-icon" title="修改建筑高度，将同步到立体空间">i</span>`
        : "";

      if (!isEditable) {
        return divider + `
          <div class="house-row" data-field-key="${escapeHtml(field.key)}">
            <span class="house-label">${escapeHtml(field.label)}：${heightInfoIcon}</span>
            <span class="house-value">${escapeHtml(String(displayValue))}${suffix}</span>
          </div>
        `;
      }

      return divider + `
        <div class="house-row editable-row" data-field-key="${escapeHtml(field.key)}" data-field-label="${escapeHtml(field.label)}">
          <span class="house-label">${escapeHtml(field.label)}：${heightInfoIcon}</span>
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

async function handlePhotoUpload(context) {
  const uploadInput = document.getElementById("photoUploadInput");
  const uploadStatus = document.getElementById("uploadStatus");
  if (!currentUserName) {
    if (uploadStatus) uploadStatus.textContent = "请先登录后再上传";
    return;
  }
  if (!uploadInput || !uploadInput.files?.length) {
    if (uploadStatus) uploadStatus.textContent = "请选择要上传的图片";
    return;
  }

  const file = uploadInput.files[0];

  if (uploadStatus) uploadStatus.textContent = "正在上传...";
  try {
    const authName =
      window.VillageAuth && typeof window.VillageAuth.getCurrentDisplayName === "function"
        ? window.VillageAuth.getCurrentDisplayName()
        : "";
    const uploader = String(authName || currentUserName || "").trim();
    await uploadObjectPhoto(file, context.sourceCode, context.photoObjectType, uploader);
    if (uploadStatus) uploadStatus.textContent = "上传成功。";
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
  } catch (error) {
    console.error("上传照片失败：", error);
    if (uploadStatus) uploadStatus.textContent = `上传失败：${error.message}`;
  }
}

async function handlePhotoDelete(photoRecord, context) {
  if (!canDeletePhotoByUploader(photoRecord?.uploaded_by, currentUserName)) {
    showToast("仅上传者可删除该照片。", "error");
    return;
  }

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
  if (!context?.allowEdit) {
    showToast("仅空间创建者可修改该空间要素。", "error");
    return false;
  }

  const saveStatus = document.getElementById("saveStatus");
  if (saveStatus) saveStatus.textContent = "正在保存...";

  try {
    // Special handling for building code rename
    if (fieldKey === "房屋编码" && newValue.trim() !== context.sourceCode) {
      const previousCode = context.sourceCode;
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
      await recordCourseActivity("object_attributes_updated", { type: context.editObjectType, id: newValue.trim() }, {
        fields: [fieldKey],
        previousCode
      });
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

function renderObjectInfoLoadingState(layerKey, sourceCode, config = layerConfigs[layerKey]) {
  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card object-info-loading" aria-live="polite">
      <h3 class="house-title">${escapeHtml(config?.label || "对象")}信息</h3>
      <div class="house-row">正在读取 ${escapeHtml(sourceCode || "该要素")} 的属性、照片与讨论…</div>
    </div>
  `;
}

async function showObjectInfo(baseRow, layerKey, sourceCode, options = {}) {
  const requestSerial = ++objectInfoRequestSerial;
  const currentSpace = getCurrentSpace();
  const config = layerConfigs[layerKey];
  const baseObjectType = config?.objectType || "";

  const showPhotoBlock = layerKey !== "road";
  const editableByIdentity = canManageSpace(currentSpace);
  const allowLayerEdit = canEditLayer(layerKey, editableByIdentity);
  const allowPhotoUpload = showPhotoBlock && !!currentUserName;

  const editObjectType = getEditNamespaceObjectType(baseObjectType, currentSpaceId);
  const photoObjectType = getPhotoNamespaceObjectType(baseObjectType, currentSpaceId);
  const objectCommentDeps = {
    getClient: getSupabaseClient,
    commentsTable: OBJECT_COMMENTS_TABLE,
    editsTable: OBJECT_EDITS_TABLE
  };

  renderObjectInfoLoadingState(layerKey, sourceCode, config);

  const editPromise = allowLayerEdit
    ? fetchObjectEdits(sourceCode, editObjectType)
    : Promise.resolve(null);
  const photosPromise = (async () => {
    if (!showPhotoBlock || !sourceCode || !photoObjectType) return [];
    const legacyPhotoType = currentSpaceId === BASE_SPACE_ID ? "" : `${baseObjectType}__${currentSpaceId}`;
    const [primaryPhotos, legacyPhotos] = await Promise.all([
      fetchObjectPhotos(sourceCode, photoObjectType),
      legacyPhotoType ? fetchObjectPhotos(sourceCode, legacyPhotoType) : Promise.resolve([])
    ]);
    const mergedPhotos = [...(primaryPhotos || [])];
    const idSet = new Set(mergedPhotos.map((item) => Number(item.id)));
    (legacyPhotos || []).forEach((item) => {
      const id = Number(item.id);
      if (!idSet.has(id)) {
        mergedPhotos.push(item);
        idSet.add(id);
      }
    });
    return mergedPhotos;
  })();
  const commentsPromise = window.ObjectCommentsModule && sourceCode && editObjectType
    ? window.ObjectCommentsModule.list(objectCommentDeps, sourceCode, editObjectType)
    : Promise.resolve([]);

  const [editResult, photosResult, commentsResult] = await Promise.allSettled([
    editPromise,
    photosPromise,
    commentsPromise
  ]);
  if (requestSerial !== objectInfoRequestSerial) return;
  if (editResult.status === "rejected") console.warn("读取对象编辑失败：", editResult.reason);
  if (photosResult.status === "rejected") console.warn("读取对象照片失败：", photosResult.reason);
  if (commentsResult.status === "rejected") console.warn("读取对象留言失败：", commentsResult.reason);

  const editData = editResult.status === "fulfilled" ? editResult.value : null;

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
    config,
    baseRow,
    mergedRow,
    allowEdit: allowLayerEdit,
    allowPhotoUpload,
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
  try {
    refreshBuildingEdgeLabels();
  } catch (error) {
    console.warn("showObjectInfo refreshBuildingEdgeLabels failed:", error);
  }

  const dbPhotos = photosResult.status === "fulfilled" ? photosResult.value : [];

  const csvPhotoList = showPhotoBlock
    ? getRowPhotoValue(baseRow, layerKey)
        .split("|")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : [];

  const objectComments = commentsResult.status === "fulfilled" ? commentsResult.value : [];

  const mergedPhotos = [
    ...csvPhotoList.map((src) => ({ src, source: "csv" })),
    ...dbPhotos.map((item) => ({
      id: item.id,
      src: item.photo_url,
      photo_path: item.photo_path,
      uploaded_by: item.uploaded_by || "",
      uploaded_at: item.uploaded_at || "",
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
                <div class="photo-actions">
                  <a class="download-photo-btn" href="${item.src}" download title="下载原图" data-photo-src="${item.src}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                  </a>
                  ${
                    item.source === "db" && canDeletePhotoByUploader(item.uploaded_by, currentUserName)
                      ? `<button class="delete-photo-btn space-icon-btn space-delete-icon-btn" type="button" data-photo-id="${item.id}" title="删除照片">
                           <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                             <polyline points="3 6 5 6 21 6"></polyline>
                             <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                           </svg>
                         </button>`
                      : ""
                  }
                </div>
                ${
                  item.source === "db" && item.uploaded_by
                    ? `<div class="photo-uploader-info">上传者：${escapeHtml(item.uploaded_by)}</div>`
                    : item.source === "csv"
                      ? `<div class="photo-source-tag">本地预置照片</div>`
                      : `<div class="photo-uploader-info">上传者：未知</div>`
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
    : allowPhotoUpload
      ? `
      <div class="info-card">
        <div class="photo-header-row">
          <h3 class="house-title">照片</h3>
          <button class="space-icon-btn space-add-icon-btn" type="button" id="photoUploadTrigger" title="上传照片">+</button>
        </div>
        <input type="file" id="photoUploadInput" accept="image/*" style="display:none" />
        <div class="house-row" id="uploadStatus">提示：照片会在现状空间和所有复制空间同步展示。</div>
        ${photosHtml}
      </div>
    `
      : `
      <div class="info-card">
        <h3 class="house-title">照片说明</h3>
        <div class="house-row">登录后可上传照片，上传后全空间可见；仅上传者本人可删除。</div>
        ${photosHtml}
      </div>
    `;

  const objectCommentsHtml = objectComments.length
    ? objectComments.map((comment) => {
        const interaction = window.ObjectCommentsModule.normalizeInteractionData(comment.interaction);
        const hasLiked = interaction.likes.includes(currentUserName);
        const repliesHtml = interaction.replies.length
          ? `<div class="object-comment-replies">${interaction.replies.map((reply) => `
              <div class="community-reply-item">
                <div class="community-reply-header">
                  <span class="community-reply-author">${escapeHtml(reply.author || "未知")}</span>
                  <span class="community-reply-time">${escapeHtml(formatDateTime(reply.created_at))}</span>
                </div>
                <div class="community-reply-content">${escapeHtml(reply.content || "")}</div>
              </div>
            `).join("")}</div>`
          : "";
        return `
          <article class="community-message-card object-comment-card">
            <div class="community-message-header">
              <span class="community-message-author">${escapeHtml(comment.author_name || "未知")}</span>
              <span class="community-message-time">${escapeHtml(formatDateTime(comment.created_at))}</span>
            </div>
            <div class="community-message-content">${escapeHtml(comment.content || "")}</div>
            <div class="community-message-actions">
              <button type="button" class="community-message-like-btn ${hasLiked ? "is-liked" : ""}" data-object-comment-like="${comment.id}">赞 ${interaction.likes.length}</button>
              <button type="button" class="community-message-reply-btn" data-object-comment-reply="${comment.id}">回复 ${interaction.replies.length}</button>
            </div>
            ${repliesHtml}
          </article>
        `;
      }).join("")
    : `<div class="object-comment-empty">暂无针对该要素的留言。</div>`;

  const objectDiscussionHtml = `
    <div class="info-card object-discussion-card">
      <div class="photo-header-row">
        <h3 class="house-title">要素讨论</h3>
        <span class="object-discussion-code">${escapeHtml(sourceCode || "")}</span>
      </div>
      ${currentUserName ? `
        <form id="objectCommentForm" class="object-comment-form">
          <textarea id="objectCommentInput" maxlength="200" rows="2" placeholder="围绕这个${escapeHtml(config?.label || "要素")}发表留言……"></textarea>
          <button type="submit">发表</button>
        </form>
      ` : `<div class="object-comment-empty">登录后可留言、点赞和回复。</div>`}
      <div class="object-comment-list">${objectCommentsHtml}</div>
    </div>
  `;



  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">${layerKey === "building" ? "建筑信息" : `${escapeHtml(config?.label || "对象")}信息`}</h3>
      ${detailHtml}
      ${saveStatusHtml}
    </div>

    ${uploadBlockHtml}
    ${objectDiscussionHtml}
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

  const objectCommentForm = document.getElementById("objectCommentForm");
  objectCommentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("objectCommentInput");
    const content = String(input?.value || "").trim();
    if (!content) return;
    try {
      await window.ObjectCommentsModule.create(objectCommentDeps, {
        objectCode: sourceCode,
        objectType: editObjectType,
        authorName: currentUserName,
        content
      });
      await recordCourseActivity("object_comment_created", { type: editObjectType, id: sourceCode });
      await showObjectInfo(baseRow, layerKey, sourceCode);
      showToast("要素留言已发表", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "要素留言发表失败", "error");
    }
  });

  document.querySelectorAll("[data-object-comment-like]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!currentUserName) return showToast("请先登录", "error");
      await window.ObjectCommentsModule.like(objectCommentDeps, button.dataset.objectCommentLike, currentUserName);
      await recordCourseActivity("object_comment_liked", { type: editObjectType, id: sourceCode });
      await showObjectInfo(baseRow, layerKey, sourceCode);
    });
  });

  document.querySelectorAll("[data-object-comment-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!currentUserName) return showToast("请先登录", "error");
      const content = await customPrompt("请输入回复内容", "", "回复要素留言", { maxLength: 200 });
      if (!content) return;
      await window.ObjectCommentsModule.reply(objectCommentDeps, button.dataset.objectCommentReply, currentUserName, content);
      await recordCourseActivity("object_comment_replied", { type: editObjectType, id: sourceCode });
      await showObjectInfo(baseRow, layerKey, sourceCode);
    });
  });

  const downloadLinks = document.querySelectorAll(".download-photo-btn");
  downloadLinks.forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = link.dataset.photoSrc || link.href;
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
    });
  });


}

function bindAuthLoginButton() {
  const btn = document.getElementById("authLoginBtn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    if (window.VillageAuth) {
      window.VillageAuth.openAuthModal();
    }
  });
}

function bindProfileCenterEntrypoints() {
  [userGreetingBadge, floatingUserGreetingBadge].forEach((entry) => {
    if (!entry || entry.dataset.profileBound) return;
    entry.dataset.profileBound = "1";
    entry.addEventListener("click", (event) => {
      if (event.target.closest(".map-greeting-name")) {
        openProfileCenterPage();
      }
    });
    entry.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest(".map-greeting-name")) {
        event.preventDefault();
        openProfileCenterPage();
      }
    });
  });
}

function updateAuthButtonUI() {
  if (window.VillageAuth) {
    window.VillageAuth.updateAuthFloatingButton();
  }
}

function bindHomeButton() {
  const homeBtn = document.getElementById("homeBtn");
  if (homeBtn && !homeBtn.dataset.bound) {
    homeBtn.dataset.bound = "1";
    homeBtn.addEventListener("click", () => {
      showVillageOverview();
    });
  }

  if (floatingHomeBtn && !floatingHomeBtn.dataset.bound) {
    floatingHomeBtn.dataset.bound = "1";
    floatingHomeBtn.addEventListener("click", () => {
      showVillageOverview();
    });
  }
}

function bindStatusBadgeClick() {
  if (!statusBadge) return;
  statusBadge.addEventListener("click", async () => {
    if (!statusBadge.classList.contains("is-enter-btn")) return;
    if (!currentUserName) {
      showToast("请先登录", "error");
      return;
    }
    try {
      const workbench = await ensureCourseWorkbenchInitialized();
      const context = await workbench.showDashboard();
      await openCoursePlanningWorkspace("2d", context?.group || null);
      await recordCourseActivity("course_entered", {
        type: "course",
        id: window.CourseModelModule.DEFAULT_COURSE.id
      });
      shouldApplyInitialPlatformDefaults = false;
    } catch (error) {
      console.error("进入课程工作台失败：", error);
      showToast(error?.message || "课程工作台加载失败", "error");
    }
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

function resetWorkspaceStateDefaults() {
  currentSpaceId = BASE_SPACE_ID;
  lastPlanningSpaceId = BASE_SPACE_ID;
  lastCollabSpaceId = BASE_SPACE_ID;
  isPlanningMode = false;
  isSpaceOptionsExpanded = true;
  isToolboxExpanded = false;
  isCommunityExpanded = true;
  isCommunityCompact = true;
  isTeachingExpanded = false;
  currentGeometryEditLayer = "";
  currentSelectedObject = null;
}

async function reloadWorkspaceForAuthenticatedAccount() {
  geoprocessingPanel?.destroy?.();
  geoprocessingAoiController?.destroy?.();
  geoprocessingResultPreview?.destroy?.();
  villagePreviewController?.destroy?.();
  personalVersionCompareController?.destroy?.();
  courseWorkbench?.destroy?.();
  geoprocessingPanel = null;
  geoprocessingAoiController = null;
  geoprocessingResultPreview = null;
  villagePreviewController = null;
  personalVersionCompareController = null;
  courseWorkbench = null;
  courseService = null;
  activityLogger = null;
  personalSpaceClient = null;

  resetWorkspaceStateDefaults();
  spaces = loadSpacesFromStorage();
  await syncSpacesFromSupabase();
  loadAppState();
  currentSpaceId = getValidSpaceId(currentSpaceId, BASE_SPACE_ID);
  lastPlanningSpaceId = getValidSpaceId(lastPlanningSpaceId, BASE_SPACE_ID);
  lastCollabSpaceId = getValidSpaceId(lastCollabSpaceId, BASE_SPACE_ID);
  sync2DSpaceStateTo3D();
  renderSpaceList();

  if (window.VillageAuth?.getCurrentUser?.()) {
    await ensureCourseWorkbenchInitialized();
  }
  if (plan2dView?.classList.contains("active") && planMap) {
    await refresh2DOverlay();
  }
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
    await window.VillageAuth?.ready;

    // 清空旧账号信息（与新系统保持一致）
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    } catch (e) {}

    userProfiles = ["管理员"];
    currentUserName = "";

    // 如果认证系统存在且已有登录用户，优先使用认证系统的用户
    if (window.VillageAuth) {
      const authUser = window.VillageAuth.getCurrentUser();
      if (authUser) {
        currentUserName = authUser.name || "";
        userProfiles = [currentUserName];
      }
    }
    activeWorkspaceAccountKey = getAccountStorageKey("workspace-account");

    spaces = loadSpacesFromStorage();
    console.log("Initialized spaces:", spaces);

    // 尝试从 Supabase 同步空间列表（跨设备）
    await syncSpacesFromSupabase();

    const hasPreviousState = loadAppState();
    shouldApplyInitialPlatformDefaults = !hasPreviousState;
    if (!getSpaceById(currentSpaceId)) {
      currentSpaceId = BASE_SPACE_ID;
    }
    lastPlanningSpaceId = getValidSpaceId(
      lastPlanningSpaceId,
      isPlanningMode ? currentSpaceId : BASE_SPACE_ID
    );
    lastCollabSpaceId = getValidSpaceId(
      lastCollabSpaceId,
      !isPlanningMode ? currentSpaceId : BASE_SPACE_ID
    );
    if (!hasPreviousState) {
      // 首次访问：保存默认配置
      saveSpacesToStorage();
      saveAppState();
    }

    sync2DSpaceStateTo3D();

    renderSpaceList();
    await ensureCourseWorkbenchInitialized();
    syncSidebarExpansionUI();
    bindHomeButton();
    bindAuthLoginButton();
    bindProfileCenterEntrypoints();
    bindStatusBadgeClick();
    bindCourseTaskSidebarToggle();
    bindMapSidePanelToggleButtons();
    bindProjectSettingsDrawer();
    bindBasemapToggle();
    bindAddSpaceButton();
    bindResizeObserver();
    ensureBuildingEditorToolbar();
    bindHomepageLandingBridge();
    showVillageOverview();
    syncMapSidePanelLayout();

    // 监听认证状态变化
    window.addEventListener("village-auth-change", async () => {
      updateAuthButtonUI();
      const user = window.VillageAuth ? window.VillageAuth.getCurrentUser() : null;
      const displayName = user ? user.name : "";
      if (typeof setCurrentUser === "function") {
        setCurrentUser(displayName);
      }
      renderHomepageIdentityUi();
      const nextAccountKey = getAccountStorageKey("workspace-account");
      if (nextAccountKey !== activeWorkspaceAccountKey) {
        activeWorkspaceAccountKey = nextAccountKey;
        await reloadWorkspaceForAuthenticatedAccount();
        return;
      }
      if (courseWorkbench) {
        await courseWorkbench.refresh();
      }
    });
    updateAuthButtonUI();
    // 首次加载时同步认证状态到旧系统
    if (window.VillageAuth) {
      const user = window.VillageAuth.getCurrentUser();
      if (user && typeof setCurrentUser === "function") {
        setCurrentUser(user.name);
      }
    }

    // 首页阶段不再提前初始化 2D 地图和大体量图层；用户进入 2D/3D 时再按需加载。
    setTimeout(async () => {
      try {
        await seedBuildingsForCopySpace(BASE_SPACE_ID);
        await seedRoadsForCopySpace(BASE_SPACE_ID);
        await seedWaterForCopySpace(BASE_SPACE_ID);
      } catch (seedError) {
        console.warn("现状空间数据初始化到云端失败（不影响正常使用）：", seedError);
      }
    }, 1200);

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
        <p>请检查各图层的 CSV、GeoJSON、orthophoto.webp 与路径是否正确。</p>
      </div>
    `;
  }

  bindMcExportButton();
  bindMeasureButtons();
  bindRecenterButton();
  initRealtimeSubscriptions();
}

/* ===================== Realtime 实时同步 ===================== */
let realtimeRefreshTimer = null;
const REALTIME_REFRESH_DELAY = 800;

function scheduleRealtimeRefresh(refreshFn) {
  if (realtimeRefreshTimer) {
    clearTimeout(realtimeRefreshTimer);
  }
  realtimeRefreshTimer = setTimeout(async () => {
    realtimeRefreshTimer = null;
    try {
      await refreshFn();
    } catch (err) {
      console.warn("Realtime 刷新失败：", err);
    }
  }, REALTIME_REFRESH_DELAY);
}

function initRealtimeSubscriptions() {
  if (!supabaseClient) {
    console.warn("Supabase 未配置，跳过 Realtime 订阅");
    return;
  }

  // 订阅规划要素变更（建筑、道路、农田、公共空间的几何/属性修改）
  supabaseClient
    .channel("planning-features-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: PLANNING_FEATURES_TABLE },
      (payload) => {
        console.log("[Realtime] planning_features changed:", payload.eventType);
        if (buildingEditState.dirtyCodes.size || buildingEditState.pendingDeletedFeatures.length) {
          showToast("其他同学已保存图层修改；请先保存或放弃你的草稿，再刷新图层。", "info");
          return;
        }
        scheduleRealtimeRefresh(async () => {
          invalidateBuildingDbCache();
          invalidateRoadDbCache();
          invalidateCroplandDbCache();
          invalidateOpenSpaceDbCache();
          invalidateWaterDbCache();

          // 刷新 2D 地图
          if (plan2dView?.classList.contains("active")) {
            await refresh2DOverlay();
          }
          // 刷新 3D 视图
          if (
            model3dView?.classList.contains("active") &&
            window.Village3D &&
            typeof window.Village3D.reload === "function"
          ) {
            await window.Village3D.reload();
          }
        });
      }
    )
    .subscribe((status) => {
      console.log("[Realtime] planning-features channel:", status);
    });

  // 订阅规划空间列表变更（空间创建/重命名/删除/属性修改）
  supabaseClient
    .channel("planning-spaces-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: PLANNING_SPACES_TABLE },
      (payload) => {
        console.log("[Realtime] planning_spaces changed:", payload.eventType);
        scheduleRealtimeRefresh(async () => {
          await syncSpacesFromSupabase();
          renderSpaceList();
        });
      }
    )
    .subscribe((status) => {
      console.log("[Realtime] planning-spaces channel:", status);
    });

  // 订阅社区任务/留言变更（发布/删除）
  supabaseClient
    .channel("community-tasks-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: COMMUNITY_TASKS_TABLE },
      (payload) => {
        console.log("[Realtime] community_tasks changed:", payload.eventType);
        scheduleRealtimeRefresh(async () => {
          invalidateCommunityTaskCache(currentSpaceId);
          await refreshCommunityTasksOnMapAsync();
          await refreshCommunityScoreBadge();
          await refreshCommunityMessageBoard();
        });
      }
    )
    .subscribe((status) => {
      console.log("[Realtime] community-tasks channel:", status);
    });

  // 订阅留言点赞/追评变更（存储在 object_attribute_edits 表中）
  supabaseClient
    .channel("message-edits-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: OBJECT_EDITS_TABLE },
      (payload) => {
        const objType = payload.new?.object_type || payload.old?.object_type;
        if (objType !== "message_likes" && objType !== "message_replies") return;
        console.log("[Realtime] message likes/replies changed:", payload.eventType);
        scheduleRealtimeRefresh(async () => {
          invalidateCommunityTaskCache(currentSpaceId);
          await refreshCommunityTasksOnMapAsync();
          await refreshCommunityScoreBadge();
          await refreshCommunityMessageBoard();
        });
      }
    )
    .subscribe((status) => {
      console.log("[Realtime] message-edits channel:", status);
    });
}

function calcPolygonEdgeLengths(geometry) {
  if (!geometry || typeof geometry.getType !== "function") return [];
  const type = geometry.getType();
  let rings = [];
  if (type === "Polygon") {
    const coords = geometry.getCoordinates();
    if (Array.isArray(coords) && coords.length > 0) rings = [coords[0]];
  } else if (type === "MultiPolygon") {
    const coords = geometry.getCoordinates();
    if (Array.isArray(coords) && coords.length > 0) rings = coords.map((p) => p[0]);
  }
  const lengths = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      const dist = getGeoDistanceMeters(ring[i], ring[i + 1]);
      if (dist > 0.01) lengths.push(dist);
    }
  }
  return lengths;
}

function areCoordinatesClose(a, b, tolerance = 1e-10) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const ax = Number(a[0]);
  const ay = Number(a[1]);
  const bx = Number(b[0]);
  const by = Number(b[1]);
  if (![ax, ay, bx, by].every((value) => Number.isFinite(value))) return false;
  return Math.abs(ax - bx) <= tolerance && Math.abs(ay - by) <= tolerance;
}

function getCurrentSketchSegmentInfo(geometry) {
  if (!geometry || typeof geometry.getType !== "function" || typeof geometry.getCoordinates !== "function") {
    return null;
  }

  const type = geometry.getType();
  let coords = [];

  if (type === "Polygon") {
    const polygonCoords = geometry.getCoordinates();
    const outerRing = Array.isArray(polygonCoords) && polygonCoords.length > 0 ? polygonCoords[0] : [];
    coords = Array.isArray(outerRing) ? outerRing.slice() : [];
    if (coords.length >= 2 && areCoordinatesClose(coords[coords.length - 1], coords[0])) {
      coords.pop();
    }
  } else if (type === "LineString") {
    const lineCoords = geometry.getCoordinates();
    coords = Array.isArray(lineCoords) ? lineCoords.slice() : [];
  } else {
    return null;
  }

  if (coords.length < 2) return null;

  const start = coords[coords.length - 2];
  const end = coords[coords.length - 1];
  const lengthMeters = getGeoDistanceMeters(start, end);
  if (!Number.isFinite(lengthMeters) || lengthMeters <= 0.01) return null;

  return {
    start,
    end,
    midpoint: [
      (Number(start[0]) + Number(end[0])) / 2,
      (Number(start[1]) + Number(end[1])) / 2
    ],
    lengthMeters
  };
}

function buildEdgeLengthLabelFeature(position, text, color = "#c0392b") {
  const OL = window.__OL__;
  if (!OL) return null;

  const { Feature, Point, Style, Text, Fill, Stroke } = OL;
  if (!Feature || !Point || !Style || !Text || !Fill || !Stroke) return null;

  const labelFeature = new Feature({
    geometry: new Point(position)
  });
  labelFeature.set("layerKey", BUILDING_EDGE_LABEL_LAYER_KEY);

  labelFeature.setStyle(
    new Style({
      zIndex: 999,
      text: new Text({
        text,
        font: 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif',
        fill: new Fill({ color }),
        stroke: new Stroke({ color: "#ffffff", width: 3 }),
        offsetY: -2,
        textAlign: "center",
        textBaseline: "middle"
      })
    })
  );

  return labelFeature;
}

function refreshDrawingEdgeLengthPreview(geometry) {
  if (!edgeLabelSource) return;
  edgeLabelSource.clear();

  const segmentInfo = getCurrentSketchSegmentInfo(geometry);
  if (!segmentInfo) return;

  const labelFeature = buildEdgeLengthLabelFeature(
    segmentInfo.midpoint,
    formatDistanceText(segmentInfo.lengthMeters),
    "#2f6928"
  );

  if (!labelFeature) return;
  labelFeature.set("preview", true);
  edgeLabelSource.addFeature(labelFeature);
}

function getSelectedBuildingFeatureForEdgeLabels() {
  if (activeFeature?.get?.("layerKey") === "building" && typeof activeFeature.getGeometry === "function") {
    return activeFeature;
  }

  if (currentSelectedObject?.layerKey !== "building" || !planVectorSource) {
    return null;
  }

  const selectedCode = normalizeCode(currentSelectedObject?.sourceCode);
  if (!selectedCode) return null;

  const features = typeof planVectorSource.getFeatures === "function" ? planVectorSource.getFeatures() : [];
  return (
    features.find((feature) => {
      if (feature?.get?.("layerKey") !== "building") return false;
      return normalizeCode(feature.get("sourceCode")) === selectedCode;
    }) || null
  );
}

async function refreshBuildingEdgeLabels() {
  if (!edgeLabelSource) return;
  edgeLabelSource.clear();

  const selectedBuildingFeature = getSelectedBuildingFeatureForEdgeLabels();
  if (!selectedBuildingFeature) return;

  const geom = selectedBuildingFeature.getGeometry();
  if (!geom) return;
  const type = geom.getType();
  let rings = [];

  if (type === "Polygon") {
    const coords = geom.getCoordinates();
    if (Array.isArray(coords) && coords.length > 0) rings = [coords[0]];
  } else if (type === "MultiPolygon") {
    const coords = geom.getCoordinates();
    if (Array.isArray(coords) && coords.length > 0) rings = coords.map((p) => p[0]);
  }

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      const dist = getGeoDistanceMeters(ring[i], ring[i + 1]);
      if (dist <= 0.01) continue;

      const midX = (ring[i][0] + ring[i + 1][0]) / 2;
      const midY = (ring[i][1] + ring[i + 1][1]) / 2;
      const labelFeature = buildEdgeLengthLabelFeature([midX, midY], formatDistanceText(dist));
      if (!labelFeature) continue;
      labelFeature.set("layerKey", BUILDING_EDGE_LABEL_LAYER_KEY);
      labelFeature.set("sourceCode", selectedBuildingFeature.get("sourceCode") || "");
      labelFeature.set("parentLayerKey", "building");

      edgeLabelSource.addFeature(labelFeature);
    }
  }
}

function doSetActiveFeature(feature) {
  activeFeature = feature;
  try {
    refreshBuildingEdgeLabels();
  } catch (e) {
    console.warn("refreshBuildingEdgeLabels failed:", e);
  }
}

function formatDistanceText(distanceMeters) {
  const n = Number(distanceMeters);
  if (!Number.isFinite(n) || n <= 0) return "0 m";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${n.toFixed(1)} m`;
}

function getGeoDistanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const lon1 = Number(a[0]);
  const lat1 = Number(a[1]);
  const lon2 = Number(b[0]);
  const lat2 = Number(b[1]);
  if (![lon1, lat1, lon2, lat2].every((v) => Number.isFinite(v))) return 0;

  const R = 6371008.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(p1) * Math.cos(p2) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function calcLineLengthMeters(coords = []) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += getGeoDistanceMeters(coords[i - 1], coords[i]);
  }
  return total;
}

function set2DMeasureReadout(message = "", visible = false) {
  const el = document.getElementById("measure2dReadout");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("show", !!visible);
}

async function ensure2DMeasureLayer() {
  await ensurePlanMap();
  if (!planMap) return false;

  const OL = await (olReady || window.__olReady);
  const { VectorSource, VectorLayer, Style, Stroke, CircleStyle, Fill } = OL;

  if (!measure2DState.source) {
    measure2DState.source = new VectorSource();
  }

  if (!measure2DState.layer) {
    measure2DState.layer = new VectorLayer({
      source: measure2DState.source,
      style: new Style({
        stroke: new Stroke({
          color: "rgba(245, 158, 11, 0.95)",
          width: 3,
          lineDash: [8, 6]
        }),
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({ color: "rgba(245, 158, 11, 0.95)" }),
          stroke: new Stroke({ color: "#ffffff", width: 1.5 })
        })
      })
    });
    measure2DState.layer.setZIndex(900);
    planMap.addLayer(measure2DState.layer);
  }

  return true;
}

async function toggle2DMeasure(force = null) {
  const shouldEnable = force === null ? !measure2DState.active : !!force;
  const btn = document.getElementById("measure2dBtn");

  if (!shouldEnable) {
    if (measure2DState.draw && planMap) {
      planMap.removeInteraction(measure2DState.draw);
    }
    measure2DState.draw = null;
    measure2DState.active = false;
    measure2DState.source?.clear();
    set2DMeasureReadout("", false);
    btn?.classList.remove("is-active");
    return false;
  }

  const ok = await ensure2DMeasureLayer();
  if (!ok || !planMap || !measure2DState.source) return false;

  const OL = await (olReady || window.__olReady);
  const { Draw } = OL;

  if (measure2DState.draw) {
    planMap.removeInteraction(measure2DState.draw);
    measure2DState.draw = null;
  }

  clearBuildingInteractions({ skipRestore: true });
  measure2DState.source.clear();

  const draw = new Draw({
    source: measure2DState.source,
    type: "LineString"
  });

  draw.on("drawstart", (evt) => {
    measure2DState.source.clear();
    const geom = evt.feature?.getGeometry?.();
    if (!geom || typeof geom.on !== "function") return;
    geom.on("change", () => {
      const coords = geom.getCoordinates?.() || [];
      const meters = calcLineLengthMeters(coords);
      set2DMeasureReadout(`距离：${formatDistanceText(meters)}`, true);
    });
  });

  draw.on("drawend", (evt) => {
    const coords = evt.feature?.getGeometry?.()?.getCoordinates?.() || [];
    const meters = calcLineLengthMeters(coords);
    set2DMeasureReadout(`总长：${formatDistanceText(meters)}`, true);
  });

  measure2DState.draw = draw;
  measure2DState.active = true;
  planMap.addInteraction(draw);
  btn?.classList.add("is-active");
  set2DMeasureReadout("测量中：单击打点，双击结束", true);
  return true;
}

function bindMeasureButtons() {
  const btn2d = document.getElementById("measure2dBtn");
  if (btn2d && !btn2d.dataset.bound) {
    btn2d.dataset.bound = "1";
    btn2d.addEventListener("click", async () => {
      await toggle2DMeasure();
    });
  }

  const refreshBtn = document.getElementById("btnRefreshCommunityTask");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", async () => {
      if (buildingEditState.dirtyCodes.size || buildingEditState.pendingDeletedFeatures.length) {
        const discard = await customConfirm("刷新会放弃当前未保存修改，是否继续？", {
          title: "刷新图层",
          okText: "放弃并刷新",
          cancelText: "继续编辑",
          isDanger: true
        });
        if (!discard) return;
        clearBuildingInteractions();
      }
      showToast("正在刷新...", "info");

      // 1. 清除现状空间静态数据缓存（GeoJSON/CSV）
      Object.keys(layerDataCache).forEach((key) => delete layerDataCache[key]);

      // 2. 清除所有规划空间的数据库缓存
      invalidateBuildingDbCache();
      invalidateRoadDbCache();
      invalidateCroplandDbCache();
      invalidateOpenSpaceDbCache();
      invalidateWaterDbCache();

      // 3. 从 Supabase 同步空间列表（跨设备）
      await syncSpacesFromSupabase();

      // 4. 清除社区任务缓存
      invalidateCommunityTaskCache(currentSpaceId);

      // 5. 重新渲染地图（重新加载所有空间数据）
      await refresh2DOverlay();

      // 6. 刷新社区任务标记
      await refreshCommunityTasksOnMapAsync();

      // 7. 刷新评分和留言板
      await refreshCommunityScoreBadge();
      await refreshCommunityMessageBoard();
      await refreshVersionManagerPanel({ quiet: true });

      // 8. 重新渲染空间侧边栏
      renderSpaceList();

      showToast("已刷新到最新。", "success");
    });
  }

  const btn3d = document.getElementById("measure3dBtn");
  if (btn3d && !btn3d.dataset.bound) {
    btn3d.dataset.bound = "1";
    btn3d.addEventListener("click", () => {
      if (!window.Village3D || typeof window.Village3D.toggleMeasureMode !== "function") {
        showToast("3D 视图未就绪，请先切换到立体视图", "info");
        return;
      }
      const active = window.Village3D.toggleMeasureMode();
      btn3d.classList.toggle("is-active", !!active);
    });
  }
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
    zoom: DEFAULT_VILLAGE_VIEW_ZOOM,
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
    messageEl.style.display = String(message || "").trim() ? "" : "none";
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
    modal.classList.remove("is-hidden");
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
      modal.classList.add("is-hidden");
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
    const titleTextEl = document.getElementById("customPromptTitleText");

    const maxLength = options.maxLength || null;
    const required =
      typeof options.required === "boolean"
        ? options.required
        : options.requireNonEmpty !== false;
    const validate = typeof options.validate === "function" ? options.validate : null;
    const emptyError = options.emptyError || "";
    const errorEl = document.getElementById("customPromptError");
    if (errorEl) errorEl.style.display = "none";

    messageEl.textContent = message;
    messageEl.style.display = String(message || "").trim() ? "" : "none";
    if (titleTextEl) titleTextEl.textContent = title;
    inputEl.placeholder = options.placeholder || "";
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
      if (errorEl) errorEl.style.display = "none";
    };

    const handleOk = () => {
      if (required && inputEl.value.trim() === "") {
        if (errorEl && emptyError) {
          errorEl.textContent = emptyError;
          errorEl.style.display = "";
        }
        inputEl.focus();
        return;
      }
      if (validate) {
        const validationResult = validate(inputEl.value);
        if (validationResult) {
          showToast(String(validationResult), "error");
          inputEl.focus();
          return;
        }
        if (validationResult === false) {
          inputEl.focus();
          return;
        }
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
