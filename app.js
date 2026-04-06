const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";
const OBJECT_EDITS_TABLE = "object_attribute_edits";

const PLANNING_FEATURES_TABLE = "planning_features";

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
  isDrawingActive: false
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
    { key: "路面材质", label: "路面材质", type: "text" },
    { key: "道路状态", label: "道路状态", type: "text" }
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

const mainLayout = document.getElementById("mainLayout");
const map2dEl = document.getElementById("map2d");
const infoPanel = document.getElementById("infoPanel");
const statusBadge = document.getElementById("statusBadge");
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

const layerDataCache = {};
let currentSelectedObject = null;
let currentInfoMode = "readonly";

let spaces = [];
let currentSpaceId = BASE_SPACE_ID;

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
    codeFields: ["道路编码", "编码", "CODE", "code", "Code", "ID", "id"],
    nameFields: ["道路名称", "名称", "name", "NAME"],
    photoFields: ["照片", "图片", "photo", "PHOTO"]
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
    label: "广场",
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
    geojsonUrl: "data/contours.geojson",
    tableUrl: null,
    codeFields: ["id", "ID", "elev", "ELEV", "Contour", "CONTOUR"],
    nameFields: ["name", "NAME", "elev", "ELEV", "Contour", "CONTOUR"],
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
  imageUrl: "assets/orthophoto_hd.png",
  minX: 113.65670800209045,
  minY: 23.67331624031067,
  maxX: 113.66360664367676,
  maxY: 23.67930293083191,
  crs: "EPSG:4326"
};

const HIGHRES_SWITCH_ZOOM = 17.2;
const TDT_TOKEN = "a2a034ff8616a35957abf8951339fedb";

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
      viewMode: '2d' // 默认2D视图
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
        viewMode: '2d'
      });
    }

    return parsed.map((s) => ({
      id: s.id,
      title: s.id === BASE_SPACE_ID ? "现状空间" : (s.title || "规划空间"),
      readonly: s.id === BASE_SPACE_ID ? true : !!s.readonly,
      editEnabled: s.id === BASE_SPACE_ID ? !!s.editEnabled : true,
      expanded: typeof s.expanded === "boolean" ? s.expanded : true,
      selectedLayers: Array.isArray(s.selectedLayers)
        ? s.selectedLayers
        : (s.id === BASE_SPACE_ID ? ["figureGround"] : ["building"]),
      basemapVisible: !!s.basemapVisible,
      viewMode: s.viewMode || '2d' // 兼容旧数据，默认2d
    }));
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

function getCurrentSpace() {
  return spaces.find((s) => s.id === currentSpaceId) || spaces[0];
}

function getSpaceById(spaceId) {
  return spaces.find((s) => s.id === spaceId) || null;
}

function canEditCurrentSpace() {
  const space = getCurrentSpace();
  if (!space) return false;

  // 现状空间不允许几何编辑，规划空间可以
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
    selectedLayers: filtered.length ? filtered : ["building"],
    basemapVisible: !!baseSpace?.basemapVisible,
    viewMode: '2d' // 默认2D
  };

  try {
    await ensureLayerLoaded("building");
    await seedBuildingsForCopySpace(newSpace.id);

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

    // 默认进入2D视图
    await switchTo2DView();

    showPlan2DOverview();
  } catch (error) {
    console.error(error);
    alert("复制空间创建失败：建筑初始化入库未成功，请查看控制台。");
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
              title="切换到2D平面视图">
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
              title="切换到3D立体视图">
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

  // 展示选项折叠/展开按钮
  const toggleBtn = document.querySelector("[data-space-options-toggle]");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      isSpaceOptionsExpanded = !isSpaceOptionsExpanded;
      renderSpaceList();
    });
  }

  // 工具箱折叠/展开按钮
  const toolboxToggle = document.querySelector("[data-toolbox-toggle]");
  if (toolboxToggle) {
    toolboxToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      isToolboxExpanded = !isToolboxExpanded;
      renderSpaceList();
    });
  }

  // 2D/3D视图切换按钮
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
      
      // 切换到对应空间并进入对应视图
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

  // 图层选择按钮（仅在2D模式下显示）
  const layerButtons = document.querySelectorAll("[data-space-layer]");
  layerButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled || button.classList.contains("layer-muted")) return;
      const payload = button.dataset.spaceLayer || "";
      const [spaceId, layerKey] = payload.split("::");
      const target = getSpaceById(spaceId);
      if (!target || !layerKey) return;

      // 只有2D模式下才响应图层切换
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

  // 开发者模式 tooltip 定位
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

      // 防止超出视口右边界
      if (left + tooltipRect.width > window.innerWidth - gap) {
        left = rect.left - tooltipRect.width - gap;
      }
      // 防止超出视口下边界
      if (top + tooltipRect.height > window.innerHeight - gap) {
        top = window.innerHeight - tooltipRect.height - gap;
      }
      // 防止超出视口上边界
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

  // 删除按钮
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
        // 切换到现状空间的对应视图
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
  saveSpacesToStorage();
  sync2DSpaceStateTo3D();
  renderSpaceList();
  ensureBuildingEditorToolbar();
  updateBuildingEditorToolbarState();
  syncBasemapUIBySpace(spaceId);

  const space = getCurrentSpace();
  if (space.viewMode === '2d') {
    // 如果从其他空间切换过来，重置首次定位标记以触发重新定位
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

  // 确保地图初始化并进行首次定位
  const map = await ensurePlanMap();
  if (map && !window.__hasInitialZoomed) {
    const view = map.getView();
    const center = [
      (BASEMAP_GEOREF.minX + BASEMAP_GEOREF.maxX) / 2,
      (BASEMAP_GEOREF.minY + BASEMAP_GEOREF.maxY) / 2
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
  
  // 确保图层数据已加载后再刷新地图
  await ensureSelectedLayersLoaded();
  await refresh2DOverlay();
  ensureBuildingEditorToolbar();
  updateBuildingEditorToolbarState();
  
  // 从3D同步选中状态
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
        // 显示信息面板
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
    "户主信息": row?.["户主信息"] ?? row?.["户主姓名"] ?? "",
    "建成年代": row?.["建成年代"] ?? "",
    "房屋功能信息": row?.["房屋功能信息"] ?? row?.["房屋功能"] ?? "",
    "房屋结构信息": row?.["房屋结构信息"] ?? row?.["房屋结构"] ?? "",
    "占地面积": getCurrentBuildingAreaText(sourceCode, row?.["占地面积"] ?? ""),
    "建筑高度": row?.["建筑高度"] ?? ""
  };
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
    .eq("is_deleted", false)
    .order("object_code", { ascending: true });

  if (error) {
    console.warn("读取 building 数据库要素失败：", error);
    return [];
  }

  return data || [];
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
}

async function hasAnyBuildingFeaturesInDb(spaceId) {
  if (!supabaseClient) return false;

  const { data, error } = await supabaseClient
    .from(PLANNING_FEATURES_TABLE)
    .select("id")
    .eq("space_id", spaceId)
    .eq("layer_key", "building")
    .limit(1);

  if (error) {
    console.warn("检查空间 building 是否已初始化失败：", error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
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

  const payload = rawFeatures
    .map((rawFeature) => {
      const code = normalizeCode(getFeatureCode(rawFeature, "building"));
      const row = rowIndex.get(code) || null;
      return makeBuildingRawFeatureToDbPayload(rawFeature, row, spaceId);
    })
    .filter(Boolean);

  if (!payload.length) {
    console.warn("没有可初始化入库的建筑要素。");
    return;
  }

  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);

    const { error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .upsert(chunk, {
        onConflict: "space_id,layer_key,object_code"
      });

    if (error) throw error;
  }

  console.log(`复制空间 ${spaceId} 建筑初始化完成，共 ${payload.length} 条。`);
}

function getBuildingFeaturesOnMap() {
  if (!planVectorSource) return [];
  return planVectorSource
    .getFeatures()
    .filter((f) => f.get("layerKey") === "building");
}

async function generateNextBuildingCode(spaceId) {
  const dbRows = await listBuildingFeaturesFromDb(spaceId);
  const codes = dbRows.map((row) => String(row.object_code || ""));

  let maxNum = 0;
  codes.forEach((code) => {
    const matched = code.match(/^H(\d+)$/i);
    if (!matched) return;
    maxNum = Math.max(maxNum, Number(matched[1]));
  });

  const nextNum = maxNum + 1;
  return `H${String(nextNum).padStart(3, "0")}`;
}

function markBuildingDirty(feature) {
  const code = normalizeCode(feature?.get("sourceCode"));
  if (!code) return;
  buildingEditState.dirtyCodes.add(code);
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
        const code = normalizeCode(f.get("sourceCode"));
        if (code) buildingEditState.dirtyCodes.delete(code);
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
      buildingEditState.originalGeoms.forEach((geom, code) => {
        const features = getBuildingFeaturesOnMap();
        const feature = features.find((f) => normalizeCode(f.get("sourceCode")) === code);
        if (feature) {
          feature.setGeometry(geom.clone());
        }
        buildingEditState.dirtyCodes.delete(code);
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
  const btnAdd = document.getElementById("btnAddBuilding");
  const btnModify = document.getElementById("btnModifyBuilding");
  const btnMove = document.getElementById("btnMoveBuilding");
  const btnRotate = document.getElementById("btnRotateBuilding");
  const btnDelete = document.getElementById("btnDeleteBuilding");
  const btnSave = document.getElementById("btnSaveBuildingGeom");
  const btnStop = document.getElementById("btnStopBuildingEdit");

  const allButtons = [btnAdd, btnModify, btnMove, btnRotate, btnDelete, btnSave, btnStop];
  allButtons.forEach((btn) => btn?.classList.remove("active"));

  const editable = canEditCurrentSpace();

  if (btnSave) {
    const canSave = editable && !(buildingEditState.mode === "draw" && buildingEditState.isDrawingActive);
    btnSave.disabled = !canSave;
  }
  [btnAdd, btnModify, btnMove, btnRotate, btnDelete].forEach((btn) => {
    if (btn) btn.disabled = !editable;
  });

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

// 更新二维操作区可见性
// 现状空间不显示操作区，规划空间显示
function updateWorkbenchVisibility() {
  // 二维操作区已迁移至左侧工具箱，此函数废弃保留
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
    `;

    mount.innerHTML = "";
    mount.appendChild(toolbar);

    document.getElementById("btnAddBuilding")?.addEventListener("click", () => {
      startAddBuildingMode();
    });

    document.getElementById("btnDeleteBuilding")?.addEventListener("click", async () => {
      await startDeleteBuildingMode();
    });

    document.getElementById("btnModifyBuilding")?.addEventListener("click", () => {
      startModifyBuildingMode();
    });

    document.getElementById("btnMoveBuilding")?.addEventListener("click", async () => {
      await startTranslateBuildingMode();
    });

    document.getElementById("btnRotateBuilding")?.addEventListener("click", async () => {
      await startRotateBuildingMode();
    });

    document.getElementById("btnSaveBuildingGeom")?.addEventListener("click", async () => {
      await saveDirtyBuildings();
    });

    document.getElementById("btnStopBuildingEdit")?.addEventListener("click", () => {
      clearBuildingInteractions();
    });
  } else if (toolbar.parentElement !== mount) {
    mount.innerHTML = "";
    mount.appendChild(toolbar);
  }

  updateBuildingEditorToolbarState();
}

async function startAddBuildingMode() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能新增建筑。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.pendingAddedFeatures = [];

  const OL = await (olReady || window.__olReady);
  const { Draw, Snap } = OL;

  buildingEditState.draw = new Draw({
    source: planVectorSource,
    type: "Polygon"
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
    const nextCode = await generateNextBuildingCode(getCurrent2DBuildingSpaceId());

    feature.set("layerKey", "building");
    feature.set("sourceCode", nextCode);
    feature.set("displayName", nextCode);
    feature.set("baseRow", {
      房屋编码: nextCode,
      房屋名称: nextCode
    });
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
  showToast("点击空白处即可新增", "info");
  updateBuildingEditorToolbarState();
}

async function startModifyBuildingMode() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能修改建筑。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();

  buildingEditState.mode = "modify-pending";
  showToast("点击建筑即可编辑顶点", "info");
  updateBuildingEditorToolbarState();
}

async function startTranslateBuildingMode() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能移动建筑。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();

  buildingEditState.mode = "translate-pending";
  showToast("点击建筑后拖动即可移动", "info");
  updateBuildingEditorToolbarState();
}

async function startRotateBuildingMode() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能旋转建筑。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.originalGeoms.clear();

  buildingEditState.mode = "rotate-pending";
  showToast("点击建筑即可旋转角度", "info");
  updateBuildingEditorToolbarState();
}

async function startDeleteBuildingMode() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能删除建筑。", "error");
    return;
  }

  await ensurePlanMap();
  clearBuildingInteractions();
  buildingEditState.pendingDeletedFeatures = [];

  buildingEditState.mode = "delete";
  showToast("点击建筑即可删除", "info");
  updateBuildingEditorToolbarState();
}

async function saveDirtyBuildings() {
  if (!isEditableSpace()) {
    showToast("现状空间为只读，不能保存建筑。", "error");
    return;
  }

  if (buildingEditState.mode === "draw" && buildingEditState.isDrawingActive) {
    showToast("请先完成当前建筑的绘制", "info");
    return;
  }

  clearBuildingInteractions({ skipRestore: true });

  const spaceId = getCurrent2DBuildingSpaceId();
  const features = getBuildingFeaturesOnMap();
  const targetFeatures = features.filter((feature) => {
    const code = normalizeCode(feature.get("sourceCode"));
    return buildingEditState.dirtyCodes.has(code);
  });

  const hasPendingDelete = (buildingEditState.pendingDeletedFeatures || []).length > 0;

  if (!targetFeatures.length && !hasPendingDelete) {
    showToast("当前没有待保存的建筑修改。", "info");
    return;
  }

  try {
    for (const feature of targetFeatures) {
      const code = normalizeCode(feature.get("sourceCode"));
      const baseRow = feature.get("baseRow") || {};
      const props = cloneJson(baseRow || {});
      const geom = olFeatureToDbGeometry(feature);

      props.房屋编码 = code;
      props.房屋名称 = props.房屋名称 || code;

      await upsertBuildingFeatureToDb({
        spaceId,
        objectCode: code,
        objectName: props.房屋名称 || code,
        geom,
        props
      });
    }

    for (const feature of (buildingEditState.pendingDeletedFeatures || [])) {
      const code = normalizeCode(feature.get("sourceCode"));
      if (code) {
        await softDeleteBuildingFeatureInDb(spaceId, code);
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

    showToast("建筑保存成功", "success");
  } catch (error) {
    console.error(error);
    showToast("建筑保存失败，请查看控制台", "error");
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
      stroke: "rgba(120, 140, 120, 0.55)",
      strokeWidth: 1.2,
      opacity: 1
    },
    road: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(255,170,0,0.30)",
      stroke: isActive ? "#1565c0" : "#ff9800",
      strokeWidth: isActive ? 3.2 : 2.1
    },
    cropland: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(60,179,113,0.30)",
      stroke: isActive ? "#1565c0" : "#3cb371",
      strokeWidth: isActive ? 3.2 : 2.1
    },
    openSpace: {
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(250, 204, 21, 0.30)",
      stroke: isActive ? "#1565c0" : "#eab308",
      strokeWidth: isActive ? 3.2 : 2.1
    },
    water: {
      fill: "rgba(66, 133, 244, 0.55)",
      stroke: "#4285f4",
      strokeWidth: 2.2
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
    ? Array.from(new Set([...selectedLayers, "contours", "building", "road", "water"]))
    : [...selectedLayers];

  for (const layerKey of effective) {
    await ensureLayerLoaded(layerKey);
  }
}

function getOlFeatureStyle(feature) {
  const OL = window.__OL__;
  if (!OL) return null;

  const { Style, Fill, Stroke } = OL;
  const layerKey = feature.get("layerKey");
  const isActive = activeFeature === feature;
  const isHovered = hoverFeature === feature;
  const isHighlighted = isActive || isHovered;
  const selectedLayers = getSelectedLayersForCurrentSpace();
  const figureGroundMode = selectedLayers.includes("figureGround");

  let fill = "rgba(160,160,160,0.25)";
  let stroke = "rgba(90,90,90,0.95)";
  let strokeWidth = 2;

  if (figureGroundMode) {
    if (layerKey === "building") {
      fill = "#000000";
      stroke = "#000000";
      strokeWidth = 1.2;
    } else if (layerKey === "road") {
      fill = "#9a9a9a";
      stroke = "#9a9a9a";
      strokeWidth = 1.2;
    } else if (layerKey === "water") {
      fill = "#4a90ff";
      stroke = "#4a90ff";
      strokeWidth = 1.2;
    } else if (layerKey === "contours") {
      fill = "rgba(0,0,0,0)";
      stroke = "rgba(120,120,120,0.8)";
      strokeWidth = 1;
    }
  } else {
    if (layerKey === "building") {
      fill = "rgba(255,70,70,0.30)";
      stroke = "rgba(210,50,50,0.95)";
    } else if (layerKey === "road") {
      fill = "rgba(255,170,0,0.30)";
      stroke = "rgba(206,136,0,0.95)";
    } else if (layerKey === "cropland") {
      fill = "rgba(60,179,113,0.30)";
      stroke = "rgba(34,139,83,0.95)";
    } else if (layerKey === "openSpace") {
      fill = "rgba(250, 204, 21, 0.30)";
      stroke = "rgba(234, 179, 8, 0.95)";
    } else if (layerKey === "water") {
      fill = "rgba(70,140,255,0.78)";
      stroke = "rgba(44,101,212,0.98)";
    } else if (layerKey === "contours") {
      fill = "rgba(0,0,0,0)";
      stroke = "rgba(120,120,120,0.85)";
      strokeWidth = 1;
    }
  }

  if (isActive) {
    fill = "rgba(33,150,243,0.35)";
    stroke = "#1565c0";
    strokeWidth = 3.5;
  } else if (isHovered) {
    fill = "rgba(33,150,243,0.18)";
    stroke = "#42a5f5";
    strokeWidth = 2.8;
  }

  return new Style({
    fill: new Fill({ color: fill }),
    stroke: new Stroke({
      color: stroke,
      width: strokeWidth
    })
  });
}

async function ensurePlanMap() {
  if (planMap) return planMap;

  olReady = olReady || window.__olReady;
  const OL = await olReady;

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
    style: (feature) => getOlFeatureStyle(feature)
  });

  planOnlineLayer = new TileLayer({
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TOKEN}`,
      crossOrigin: "anonymous",
      maxZoom: 18
    }),
    visible: false,
  });
  
  planLabelLayer = new TileLayer({
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TOKEN}`,
      crossOrigin: "anonymous",
      maxZoom: 18
    }),
    visible: false,
  });

  planHighResLayer = new ImageLayer({
    source: new ImageStatic({
      url: BASEMAP_GEOREF.imageUrl,
      imageExtent: [
        BASEMAP_GEOREF.minX,
        BASEMAP_GEOREF.minY,
        BASEMAP_GEOREF.maxX,
        BASEMAP_GEOREF.maxY
      ],
      projection: "EPSG:4326",
      crossOrigin: "anonymous"
    }),
    visible: false,
    opacity: 0.96
  });

  planMap = new Map({
    target: "map2d",
    layers: [planOnlineLayer, planLabelLayer, planHighResLayer, planVectorLayer],
    view: new View({
      center: [
        (BASEMAP_GEOREF.minX + BASEMAP_GEOREF.maxX) / 2,
        (BASEMAP_GEOREF.minY + BASEMAP_GEOREF.maxY) / 2
      ],
      zoom: 17,
      minZoom: 5,
      maxZoom: 22,
      projection: "EPSG:4326"
    })
  });
  
  const view = planMap.getView();
  view.setCenter([
    (BASEMAP_GEOREF.minX + BASEMAP_GEOREF.maxX) / 2,
    (BASEMAP_GEOREF.minY + BASEMAP_GEOREF.maxY) / 2
  ]);
  view.setZoom(16.5);

  syncBasemapUIBySpace(currentSpaceId);

  view.on("change:resolution", () => {
    syncBasemapUIBySpace(currentSpaceId);
  });

  planMap.on("pointermove", (evt) => {
    let hovered = null;
    planMap.forEachFeatureAtPixel(evt.pixel, (feature) => {
      hovered = feature;
      return true;
    });

    if (hovered !== hoverFeature) {
      hoverFeature = hovered;
      if (buildingEditState.mode !== "modify" && buildingEditState.mode !== "translate") {
        planVectorLayer.changed();
      }
    }

    planMap.getTargetElement().style.cursor = hovered ? "pointer" : "";
  });

  planMap.on("singleclick", async (evt) => {
    let clicked = null;
    planMap.forEachFeatureAtPixel(evt.pixel, (feature) => {
      clicked = feature;
      return true;
    });

    if (buildingEditState.mode === "delete") {
      if (!clicked || clicked.get("layerKey") !== "building") return;
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
      if (!clicked || clicked.get("layerKey") !== "building") {
        showToast("请选择一栋建筑", "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      if (code && !buildingEditState.originalGeoms.has(code)) {
        buildingEditState.originalGeoms.set(code, clicked.getGeometry().clone());
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
      if (!clicked || clicked.get("layerKey") !== "building") {
        showToast("请选择一栋建筑", "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      if (code && !buildingEditState.originalGeoms.has(code)) {
        buildingEditState.originalGeoms.set(code, clicked.getGeometry().clone());
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
      if (!clicked || clicked.get("layerKey") !== "building") {
        showToast("请选择一栋建筑", "info");
        return;
      }
      activeFeature = clicked;
      const code = normalizeCode(clicked.get("sourceCode"));
      if (code && !buildingEditState.originalGeoms.has(code)) {
        buildingEditState.originalGeoms.set(code, clicked.getGeometry().clone());
      }

      const angleText = await customPrompt("请输入旋转角度（单位：度，顺时针可输入负数）", "15", "旋转建筑");
      if (angleText == null) {
        // 用户取消：保持 rotate-pending 状态，让用户可以继续选择其他建筑
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

  const map = await ensurePlanMap();
  const OL = await (olReady || window.__olReady);
  const { GeoJSON } = OL;

  if (!planVectorSource) return;
  planVectorSource.clear();
  activeFeature = null;

  const selectedLayers = getSelectedLayersForCurrentSpace();
  const effectiveLayerKeys = selectedLayers.includes("figureGround")
    ? ["contours", "water", "road", "building"]
    : [...selectedLayers];

  const format = new GeoJSON();

  for (const layerKey of effectiveLayerKeys) {
    if (layerKey === "building" && currentSpaceId !== BASE_SPACE_ID) {
      // 规划空间：首先检查数据库中是否有未删除的建筑
      const dbRows = await listBuildingFeaturesFromDb(currentSpaceId);

      if (dbRows.length > 0) {
        // 数据库中有未删除的建筑，使用数据库
        dbRows.forEach((row) => {
          const rawFeature = makeBuildingDbRowToRawFeature(row);

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

      // 数据库中没有未删除的建筑，检查是否有任何记录（包括已删除的）
      const hasAnyDbRecords = await hasAnyBuildingFeaturesInDb(currentSpaceId);

      if (hasAnyDbRecords) {
        // 数据库有记录但没有未删除的建筑，说明该空间已使用数据库但所有建筑都被删除了
        // 不显示任何建筑，不使用GeoJSON
        continue;
      }

      // 数据库没有任何记录，使用GeoJSON（首次加载或从未编辑过）
    }

    const cached = layerDataCache[layerKey];
    if (!cached?.features) continue;

    cached.features.forEach((rawFeature) => {
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
      olFeature.set("baseRow", row);

      planVectorSource.addFeature(olFeature);
    });
  }

  planVectorLayer.changed();
  syncBasemapUIBySpace(currentSpaceId);
  map.updateSize();
}

function showFigureGroundInfo() {
  currentSelectedObject = null;
  currentInfoMode = "readonly";
  update2DStatusText();

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">图底关系图层</h3>
      <div class="house-row">当前显示图底关系模式：建筑为纯黑、道路为灰色、水体为蓝色、背景为白色。</div>
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
      "道路宽度": "",
      "路面材质": "",
      "道路状态": ""
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

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄基本信息</h3>
      <p>此页面用于展示村庄概况、教学目标、区位条件、现状问题等整体信息。</p>
      <p>如需查看具体建筑或空间对象，请切换到"规划空间"并选择具体空间。</p>
    </div>
  `;
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

  const objectType3D = spaceId === BASE_SPACE_ID ? null : `building_3d__${spaceId}`;
  if (objectType3D) {
    await migrateObjectEdits(oldCode, trimmedNewCode, objectType3D);
  }
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
  // 规划空间可编辑，现状空间只读
  const allowLayerEdit = canEditLayer(layerKey, readonlySpace);
  // 现状空间仍允许上传/删除照片
  const allowPhotoEdit = allowLayerEdit || currentSpace?.id === BASE_SPACE_ID;

  const editObjectType = getEditNamespaceObjectType(baseObjectType, currentSpaceId);
  const photoObjectType = getPhotoNamespaceObjectType(baseObjectType, currentSpaceId);

  const editData = allowLayerEdit
    ? await fetchObjectEdits(sourceCode, editObjectType)
    : null;

  let mergedRow = mergeObjectRow(baseRow, editData);

  if (layerKey === "building") {
    mergedRow = normalizeBuildingInfoRow(mergedRow, sourceCode);
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

  const dbPhotos = sourceCode && photoObjectType ? await fetchObjectPhotos(sourceCode, photoObjectType) : [];
  const csvPhotoList = getRowPhotoValue(baseRow, layerKey)
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item !== "");

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
                  onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<div class=&quot;img-error&quot;>图片加载失败：${item.src}</div>')"
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

  const uploadBlockHtml = allowPhotoEdit
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

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">${layerKey === "building" ? "建筑信息" : `${escapeHtml(config?.label || "对象")}信息`}</h3>
      ${detailHtml}
      ${saveStatusHtml}
    </div>

    ${uploadBlockHtml}
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
}

function bindStoryEvents() {
  // 空间列表常驻显示，不再需要点击展开/收起逻辑
  // 保留此函数以便未来扩展其他导航功能
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
      refresh2DOverlay();
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
        <p>请检查各图层的 CSV、GeoJSON、orthophoto.jpg 和路径是否正确。</p>
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
  const center = [
    (BASEMAP_GEOREF.minX + BASEMAP_GEOREF.maxX) / 2,
    (BASEMAP_GEOREF.minY + BASEMAP_GEOREF.maxY) / 2
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
