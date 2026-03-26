const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";
const OBJECT_EDITS_TABLE = "object_attribute_edits";

const EDITABLE_FIELDS_BY_LAYER = {
  building: [
    { key: "房屋编码", label: "房屋编码", type: "text" },
    { key: "房屋名称", label: "房屋名称", type: "text" },
    { key: "建成年代", label: "建成年代", type: "text" },
    { key: "占地面积", label: "占地面积", type: "number", suffix: "㎡" },
    { key: "房屋功能信息", label: "房屋功能信息", type: "text" },
    { key: "房屋结构信息", label: "房屋结构信息", type: "text" },
    { key: "户主信息", label: "户主信息", type: "text" }
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
const SPACE_STORAGE_KEY = "village_planning_spaces_v1";

const mainLayout = document.getElementById("mainLayout");
const villageImage = document.getElementById("villageImage");
const svgOverlay = document.getElementById("svgOverlay");
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
const mapWrapper = document.querySelector(".map-wrapper");

const supabaseClient =
  typeof supabase !== "undefined" &&
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("你的项目ref") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("publishable key")
    ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

let activePolygon = null;
let polygonMap = new Map();
let resizeObserver = null;

const layerDataCache = {};
let currentSelectedObject = null;
let currentInfoMode = "readonly";

let spaces = [];
let currentSpaceId = BASE_SPACE_ID;

const layerConfigs = {
  building: {
    label: "建筑轮廓",
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
  imageUrl: "assets/orthophoto_georef.png",
  minX: 113.6572059645772157,
  minY: 23.6744933311960075,
  maxX: 113.6634436030307853,
  maxY: 23.6792748321960076,
  crs: "EPSG:4326"
};

function getDefaultSpaces() {
  return [
    {
      id: BASE_SPACE_ID,
      title: "村庄现状",
      readonly: true,
      expanded: true,
      selectedLayers: ["figureGround"]
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
        title: "村庄现状",
        readonly: true,
        expanded: true,
        selectedLayers: ["figureGround"]
      });
    }

    return parsed.map((s) => ({
      id: s.id,
      title: s.id === BASE_SPACE_ID ? "村庄现状" : (s.title || "复制版"),
      readonly: s.id === BASE_SPACE_ID ? true : !!s.readonly,
      expanded: typeof s.expanded === "boolean" ? s.expanded : true,
      selectedLayers: Array.isArray(s.selectedLayers)
        ? s.selectedLayers
        : (s.id === BASE_SPACE_ID ? ["figureGround"] : ["building"])
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
  const isBase = isBaseSpace(spaceId);
  const currentSpace = getSpaceById(spaceId);
  const selectedLayers = currentSpace?.selectedLayers || [];
  const isFigureGroundMode = isBase && selectedLayers.includes("figureGround");

  if (basemapToggleWrap) {
    basemapToggleWrap.style.display = isBase ? "" : "none";
  }

  if (!mapWrapper) return;

  if (!isBase) {
    mapWrapper.classList.add("hide-basemap");
    return;
  }

  if (isFigureGroundMode) {
    if (basemapToggle && basemapToggle.checked) {
      mapWrapper.classList.remove("hide-basemap");
    } else {
      mapWrapper.classList.add("hide-basemap");
    }
    return;
  }

  if (basemapToggle && basemapToggle.checked) {
    mapWrapper.classList.remove("hide-basemap");
  } else {
    mapWrapper.classList.add("hide-basemap");
  }
}

function createCopySpace() {
  const copyIndex = spaces.filter((s) => s.id !== BASE_SPACE_ID).length + 1;
  const baseSpace = getSpaceById(BASE_SPACE_ID) || getCurrentSpace();

  const filtered = (baseSpace?.selectedLayers || []).filter(
    (key) => !["figureGround"].includes(key)
  );

  const newSpace = {
    id: `copy_${Date.now()}`,
    title: `复制版 ${copyIndex}`,
    readonly: false,
    expanded: true,
    selectedLayers: filtered
  };

  spaces.push(newSpace);
  currentSpaceId = newSpace.id;
  currentSelectedObject = null;
  currentInfoMode = "readonly";
  saveSpacesToStorage();
  renderSpaceList();
  syncBasemapUIBySpace(newSpace.id);
  refresh2DOverlay();
  showPlan2DOverview();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSpaceList() {
  if (!spaceList) return;

  spaceList.classList.add("active");
  spaceList.innerHTML = spaces
    .map((space) => {
      const isCurrent = space.id === currentSpaceId;
      const triangle = space.expanded ? "▼" : "▲";
      const availableLayerKeys = getAvailableLayerKeysForSpace(space);

      return `
        <div class="space-panel ${isCurrent ? "current" : ""}" data-space-id="${space.id}">
          <div class="space-header">
            <button class="space-select-btn ${isCurrent ? "active" : ""}" type="button" data-space-select="${space.id}">
              ${
                space.readonly
                  ? `
                    <span class="substory-group-title">
                      ${escapeHtml(space.title)}
                      <span class="space-readonly-badge">只读</span>
                    </span>
                  `
                  : `
                    <input
                      class="space-title-input"
                      type="text"
                      value="${escapeHtml(space.title)}"
                      data-space-rename="${space.id}"
                    />
                  `
              }
            </button>

            <button
              class="substory-toggle-btn"
              type="button"
              data-space-toggle="${space.id}"
              aria-expanded="${space.expanded ? "true" : "false"}"
            >
              ${triangle}
            </button>
          </div>

          <div class="substory-list ${space.expanded ? "active" : ""}">
            ${availableLayerKeys.map((layerKey) => `
              <button
                class="substory-item ${space.selectedLayers.includes(layerKey) ? "active" : ""}"
                data-space-layer="${space.id}::${layerKey}"
                type="button"
              >
                ${escapeHtml(layerConfigs[layerKey].label)}
              </button>
            `).join("")}
          </div>

          ${
            !space.readonly
              ? `
                <div class="space-actions">
                  <button class="space-delete-btn" type="button" data-space-delete="${space.id}">删除空间</button>
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  bindSpaceListEvents();
}

function bindSpaceListEvents() {
  const selectButtons = document.querySelectorAll("[data-space-select]");
  selectButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      if (event.target && event.target.matches(".space-title-input")) return;

      const spaceId = button.dataset.spaceSelect;
      if (!spaceId) return;

      currentSpaceId = spaceId;
      currentSelectedObject = null;
      currentInfoMode = "readonly";
      saveSpacesToStorage();
      renderSpaceList();
      syncBasemapUIBySpace(spaceId);

      if (plan2dView.classList.contains("active")) {
        await ensureSelectedLayersLoaded();
        refresh2DOverlay();
        showPlan2DOverview();
      }
    });
  });

  const toggleButtons = document.querySelectorAll("[data-space-toggle]");
  toggleButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const spaceId = button.dataset.spaceToggle;
      const target = getSpaceById(spaceId);
      if (!target) return;

      target.expanded = !target.expanded;
      saveSpacesToStorage();
      renderSpaceList();
    });
  });

  const renameInputs = document.querySelectorAll("[data-space-rename]");
  renameInputs.forEach((input) => {
    input.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    input.addEventListener("input", () => {
      const spaceId = input.dataset.spaceRename;
      const target = getSpaceById(spaceId);
      if (!target || target.readonly) return;
      target.title = input.value.trim() || "复制版";
      saveSpacesToStorage();
    });
  });

  const layerButtons = document.querySelectorAll("[data-space-layer]");
  layerButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const payload = button.dataset.spaceLayer || "";
      const [spaceId, layerKey] = payload.split("::");
      const target = getSpaceById(spaceId);
      if (!target || !layerKey) return;

      const availableLayerKeys = getAvailableLayerKeysForSpace(target);
      if (!availableLayerKeys.includes(layerKey)) return;

      const selected = new Set(target.selectedLayers || []);

      if (selected.has(layerKey)) {
        selected.delete(layerKey);
      } else {
        selected.add(layerKey);
      }

      // 复制空间本来就没有 figureGround，这里只是保险
      if (target.id !== BASE_SPACE_ID) {
        selected.delete("figureGround");
      }

      setSpaceSelectedLayers(spaceId, [...selected]);
      currentSpaceId = spaceId;
      currentSelectedObject = null;
      currentInfoMode = "readonly";

      await ensureSelectedLayersLoaded();
      renderSpaceList();
      syncBasemapUIBySpace(spaceId);
      refresh2DOverlay();
      showPlan2DOverview();
    });
  });

  const deleteButtons = document.querySelectorAll("[data-space-delete]");
  deleteButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const spaceId = button.dataset.spaceDelete;
      if (!spaceId || isBaseSpace(spaceId)) return;

      const target = getSpaceById(spaceId);
      const title = target?.title || "该空间";
      const confirmed = window.confirm(`确定要删除“${title}”吗？此操作不会删除村庄现状空间。`);
      if (!confirmed) return;

      spaces = spaces.filter((s) => s.id !== spaceId);

      if (!spaces.some((s) => s.id === BASE_SPACE_ID)) {
        spaces.unshift(...getDefaultSpaces());
      }

      if (currentSpaceId === spaceId) {
        currentSpaceId = BASE_SPACE_ID;
      }

      currentSelectedObject = null;
      currentInfoMode = "readonly";
      saveSpacesToStorage();
      renderSpaceList();
      syncBasemapUIBySpace(currentSpaceId);

      if (plan2dView.classList.contains("active")) {
        await ensureSelectedLayersLoaded();
        refresh2DOverlay();
        showPlan2DOverview();
      }
    });
  });
}

function hasRequiredNewLayout() {
  return !!(
    mainLayout &&
    overviewView &&
    plan2dView &&
    model3dView &&
    villageImage &&
    svgOverlay &&
    infoPanel &&
    statusBadge &&
    detailSubtitle &&
    spaceList &&
    addSpaceBtn
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
      fill: isActive ? "rgba(33, 150, 243, 0.20)" : "rgba(70,140,255,0.30)",
      stroke: isActive ? "#1565c0" : "#468cff",
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

function setPolygonVisualState(polygon, layerKey, active = false) {
  if (!polygon) return;

  let style = getLayerStyle(layerKey);

  if (active) {
    polygon.setAttribute("fill", "rgba(33, 150, 243, 0.20)");
    polygon.setAttribute("stroke", "#1565c0");
    polygon.setAttribute("stroke-width", "3.2");
    polygon.classList.add("active");
    return;
  }

  polygon.classList.remove("active");
  polygon.setAttribute("fill", style.fill);
  polygon.setAttribute("stroke", style.stroke);
  polygon.setAttribute("stroke-width", String(style.strokeWidth));
}

function setActivePolygon(nextPolygon) {
  if (activePolygon && activePolygon !== nextPolygon) {
    const prevLayerKey = activePolygon.dataset.layerKey;
    setPolygonVisualState(activePolygon, prevLayerKey, false);
  }

  activePolygon = nextPolygon;

  if (activePolygon) {
    const layerKey = activePolygon.dataset.layerKey;
    setPolygonVisualState(activePolygon, layerKey, true);
  }
}

function lonLatToImagePoint(lon, lat, bounds, width, height) {
  const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * width;
  const y = ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * height;
  return [x, y];
}

function getBasemapBounds() {
  if (
    !BASEMAP_GEOREF ||
    !Number.isFinite(BASEMAP_GEOREF.minX) ||
    !Number.isFinite(BASEMAP_GEOREF.minY) ||
    !Number.isFinite(BASEMAP_GEOREF.maxX) ||
    !Number.isFinite(BASEMAP_GEOREF.maxY)
  ) {
    return null;
  }

  return {
    minLon: BASEMAP_GEOREF.minX,
    minLat: BASEMAP_GEOREF.minY,
    maxLon: BASEMAP_GEOREF.maxX,
    maxLat: BASEMAP_GEOREF.maxY
  };
}

function computeBoundsFromLayers(layerKeys) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  layerKeys.forEach((layerKey) => {
    const cached = layerDataCache[layerKey];
    if (!cached?.features) return;

    cached.features.forEach((feature) => {
      const rings = getFeatureRings(feature);
      rings.forEach((polygonRings) => {
        polygonRings.forEach((ring) => {
          ring.forEach(([lon, lat]) => {
            if (typeof lon !== "number" || typeof lat !== "number") return;
            minLon = Math.min(minLon, lon);
            minLat = Math.min(minLat, lat);
            maxLon = Math.max(maxLon, lon);
            maxLat = Math.max(maxLat, lat);
          });
        });
      });
    });
  });

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
    return null;
  }

  if (minLon === maxLon) maxLon = minLon + 0.0001;
  if (minLat === maxLat) maxLat = minLat + 0.0001;

  return { minLon, minLat, maxLon, maxLat };
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

function clearOverlay() {
  svgOverlay.innerHTML = "";
  polygonMap = new Map();
  activePolygon = null;
}

function buildPolygonPointsString(ring, bounds, width, height) {
  return ring
    .map(([lon, lat]) => {
      const [x, y] = lonLatToImagePoint(lon, lat, bounds, width, height);
      return `${x},${y}`;
    })
    .join(" ");
}

function buildLinePointsString(lineCoords, bounds, width, height) {
  return lineCoords
    .map(([lon, lat]) => {
      const [x, y] = lonLatToImagePoint(lon, lat, bounds, width, height);
      return `${x},${y}`;
    })
    .join(" ");
}

function makePolygonElement({
  points,
  layerKey,
  sourceCode,
  displayName,
  feature,
  baseRow
}) {
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", points);
  polygon.setAttribute("class", `map-polygon layer-${layerKey}`);
  polygon.dataset.layerKey = layerKey;
  polygon.dataset.sourceCode = sourceCode || "";
  polygon.dataset.displayName = displayName || "";
  setPolygonVisualState(polygon, layerKey, false);

  polygon.addEventListener("mouseenter", () => {
    if (polygon !== activePolygon) {
      polygon.setAttribute("stroke-width", "3");
    }
  });

  polygon.addEventListener("mouseleave", () => {
    if (polygon !== activePolygon) {
      const style = getLayerStyle(layerKey);
      polygon.setAttribute("stroke-width", String(style.strokeWidth));
    }
  });

  polygon.addEventListener("click", async (event) => {
    event.stopPropagation();
    setActivePolygon(polygon);

    if (layerKey === "figureGround") {
      showFigureGroundInfo();
      return;
    }

    currentInfoMode = "readonly";

    const effectiveRow = baseRow || buildFallbackObjectRow(sourceCode, layerKey, feature);

    currentSelectedObject = {
      sourceCode,
      displayName: displayName || sourceCode || "未匹配对象",
      layerKey,
      layerLabel: layerConfigs[layerKey]?.label || "对象",
      spaceId: currentSpaceId
    };
    update2DStatusText();

    await showObjectInfo(effectiveRow, layerKey, sourceCode);
  });

  return polygon;
}

function makePolylineElement({ points, layerKey }) {
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");

  const style = getLayerStyle(layerKey);
  polyline.setAttribute("stroke", style.stroke);
  polyline.setAttribute("stroke-width", String(style.strokeWidth));
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("opacity", style.opacity != null ? String(style.opacity) : "1");
  polyline.setAttribute("class", `map-line layer-${layerKey}`);

  return polyline;
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
      <h3 class="house-title">${escapeHtml(layerLabel)}信息</h3>
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
      "占地面积": "",
      "房屋功能信息": "",
      "房屋结构信息": "",
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

function refresh2DOverlay() {
  if (!plan2dView.classList.contains("active")) return;
  if (!villageImage || !svgOverlay) return;

  const width = villageImage.clientWidth || villageImage.naturalWidth || 1000;
  const height = villageImage.clientHeight || villageImage.naturalHeight || 600;

  svgOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgOverlay.setAttribute("width", width);
  svgOverlay.setAttribute("height", height);

  clearOverlay();

  const selectedLayers = getSelectedLayersForCurrentSpace();
  const effectiveLayerKeys = selectedLayers.includes("figureGround")
    ? ["contours", "water", "road", "building"]
    : [...selectedLayers];

  const bounds = getBasemapBounds();
  if (!bounds) {
    console.warn("未配置底图地理范围 BASEMAP_GEOREF，无法绘制坐标版图层。");
    return;
  }

  effectiveLayerKeys.forEach((layerKey) => {
    const cached = layerDataCache[layerKey];
    if (!cached?.features) return;

    cached.features.forEach((feature) => {
      const props = getFeatureProperties(feature);
      const sourceCode = getFeatureCode(feature, layerKey);
      const row = cached.rowIndex.get(normalizeCode(sourceCode)) || null;
      const displayName = row
        ? getRowName(row, layerKey) || sourceCode
        : getFirstMatchingField(props, layerConfigs[layerKey]?.nameFields || []) || sourceCode;

      if (layerKey === "contours") {
        const lines = getFeatureLines(feature);

        lines.forEach((line) => {
          if (!line || !line.length) return;

          const points = buildLinePointsString(line, bounds, width, height);
          const polyline = makePolylineElement({
            points,
            layerKey: "contours"
          });

          svgOverlay.appendChild(polyline);
        });

        return;
      }

      const rings = getFeatureRings(feature);

      rings.forEach((polygonRings) => {
        const outerRing = polygonRings?.[0];
        if (!outerRing || !outerRing.length) return;

        let actualLayerKey = layerKey;

        if (selectedLayers.includes("figureGround")) {
          if (layerKey === "building") actualLayerKey = "figureGroundBuilding";
          if (layerKey === "road") actualLayerKey = "figureGroundRoad";
          if (layerKey === "water") actualLayerKey = "figureGroundWater";
        }

        const points = buildPolygonPointsString(outerRing, bounds, width, height);
        const polygon = makePolygonElement({
          points,
          layerKey: actualLayerKey,
          sourceCode,
          displayName,
          feature,
          baseRow: row
        });

        svgOverlay.appendChild(polygon);
        if (sourceCode) {
          polygonMap.set(`${actualLayerKey}::${normalizeCode(sourceCode)}`, polygon);
        }
      });
    });
  });
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
}

function update2DStatusText() {
  const currentSpace = getCurrentSpace();
  if (!statusBadge) return;

  if (!currentSelectedObject) {
    statusBadge.textContent = `当前模式：村庄 2D 图层｜空间：${currentSpace?.title || "村庄现状"}`;
    return;
  }

  statusBadge.textContent = `当前模式：村庄 2D 图层｜空间：${currentSpace?.title || "村庄现状"}｜已选对象：${currentSelectedObject.displayName}`;
}

function showVillageOverview() {
  setActiveStoryItem("overview");
  switchMainView("overview");

  if (statusBadge) {
    statusBadge.textContent = "当前模式：村庄基本信息";
  }

  if (detailSubtitle) {
    detailSubtitle.textContent = "当前模式为整合展示";
  }

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄基本信息</h3>
      <p>此页面用于展示村庄概况、教学目标、区位条件、现状问题等整体信息。</p>
      <p>如需查看具体建筑或空间对象，请切换到“村庄 2D 图层”或“村庄 3D 模型”。</p>
    </div>
  `;
}

function showPlan2DOverview() {
  setActiveStoryItem("plan2d");
  switchMainView("plan2d");
  syncBasemapUIBySpace(currentSpaceId);
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
          <p>复制版空间支持建筑、道路、水体、公共空间、农田等图层的属性编辑，以及对象照片上传与删除；村庄现状空间仅可读。</p>
        </div>
      `;
    }
  }

  refresh2DOverlay();
}

async function showModel3DOverview() {
  setActiveStoryItem("model3d");
  switchMainView("model3d");

  if (statusBadge) {
    statusBadge.textContent = "当前模式：村庄 3D 模型";
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

function buildReadOnlyDetailHtml(row, layerKey) {
  const entries = Object.entries(row || {})
    .filter(([key]) => key && String(key).trim() !== "")
    .map(([key, value]) => {
      return `<div class="house-row"><span class="house-label">${escapeHtml(key)}：</span>${escapeHtml(value)}</div>`;
    });

  if (!entries.length) {
    return `<div class="house-row">暂无${escapeHtml(layerConfigs[layerKey]?.label || "对象")}属性信息。</div>`;
  }

  return entries.join("");
}

function buildEditFormHtml(row, layerKey) {
  const fields = getEditableFields(layerKey);

  return fields.map((field) => {
    const value = row?.[field.key] ?? "";
    const inputType = field.type === "number" ? "number" : "text";

    return `
      <label class="form-row">
        <span class="form-label">${escapeHtml(field.label)}</span>
        <span class="form-input-wrap">
          <input
            class="form-input"
            type="${inputType}"
            step="${field.type === "number" ? "0.01" : ""}"
            value="${escapeHtml(value)}"
            data-edit-field="${escapeHtml(field.key)}"
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
        <span class="mode-tip">${readonlySpace ? "村庄现状空间仅可查看" : "当前对象暂不支持编辑"}</span>
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

function collectEditPayload(layerKey) {
  const inputs = document.querySelectorAll("[data-edit-field]");
  const payload = {};
  const fields = getEditableFields(layerKey);

  fields.forEach((field) => {
    const input = Array.from(inputs).find((el) => el.dataset.editField === field.key);
    payload[field.key] = input ? input.value.trim() : "";
  });

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
  const confirmed = window.confirm("确定要删除这张照片吗？");
  if (!confirmed) return;

  try {
    await deleteObjectPhoto(photoRecord);
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
  } catch (error) {
    console.error("删除照片失败：", error);
    window.alert(`删除失败：${error.message}`);
  }
}

async function handleObjectSave(context) {
  const saveStatus = document.getElementById("saveStatus");
  const saveBtn = document.getElementById("saveBuildingBtn");

  const payload = collectEditPayload(context.layerKey);
  if (!payload) return;

  if (saveBtn) saveBtn.disabled = true;
  if (saveStatus) saveStatus.textContent = "正在保存...";

  try {
    await saveObjectEdits(context.sourceCode, context.editObjectType, payload);
    currentInfoMode = "readonly";
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

async function showObjectInfo(baseRow, layerKey, sourceCode, options = {}) {
  const currentSpace = getCurrentSpace();
  const config = layerConfigs[layerKey];
  const baseObjectType = config?.objectType || "";

  const readonlySpace = !!currentSpace?.readonly;
  const allowLayerEdit = canEditLayer(layerKey, readonlySpace);

  const editObjectType = getEditNamespaceObjectType(baseObjectType, currentSpaceId);
  const photoObjectType = getPhotoNamespaceObjectType(baseObjectType, currentSpaceId);

  const editData = allowLayerEdit
    ? await fetchObjectEdits(sourceCode, editObjectType)
    : null;

  const mergedRow = mergeObjectRow(baseRow, editData);
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

  const detailHtml = allowLayerEdit && currentInfoMode === "edit"
    ? buildEditFormHtml(mergedRow, layerKey)
    : buildReadOnlyDetailHtml(mergedRow, layerKey);

  const saveBarHtml = allowLayerEdit && currentInfoMode === "edit"
    ? `
      <div class="edit-actions">
        <button id="saveBuildingBtn" class="upload-btn" type="button">保存修改</button>
        <div id="saveStatus" class="save-status">${options.flashSaved ? "保存成功。" : ""}</div>
      </div>
    `
    : options.flashSaved
      ? `<div class="save-status success-inline">已显示本复制版的最新保存版本。</div>`
      : "";

  const uploadBlockHtml = allowLayerEdit
    ? `
      <div class="info-card">
        <h3 class="house-title">上传照片</h3>
        <div class="house-row">
          <input type="file" id="photoUploadInput" accept="image/*" />
        </div>
        <div class="house-row">
          <button id="uploadPhotoBtn" class="upload-btn" type="button">上传到该对象</button>
        </div>
        <div class="house-row" id="uploadStatus"></div>
      </div>
    `
    : `
      <div class="info-card">
        <h3 class="house-title">照片说明</h3>
        <div class="house-row">当前空间为只读，仅展示该对象已有照片。</div>
      </div>
    `;

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
                  item.source === "db" && allowLayerEdit
                    ? `<div class="photo-actions">
                         <button class="delete-photo-btn" data-photo-id="${item.id}" type="button">删除这张照片</button>
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

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    ${buildInfoModeSwitchHtml({
      layerKey,
      allowEdit: allowLayerEdit,
      readonlySpace
    })}

    <div class="info-card">
      <h3 class="house-title">${escapeHtml(config?.label || "对象")}信息</h3>
      ${detailHtml}
      ${saveBarHtml}
    </div>

    ${uploadBlockHtml}

    <div class="house-row"><span class="house-label">对象照片：</span></div>
    ${photosHtml}
  `;

  bindInfoModeSwitch(context);

  const saveBtn = document.getElementById("saveBuildingBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      await handleObjectSave(context);
    });
  }

  const uploadBtn = document.getElementById("uploadPhotoBtn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      await handlePhotoUpload(context);
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
  storyItems.forEach((item) => {
    item.addEventListener("click", async () => {
      const view = item.dataset.view || "";
      if (view === "overview") {
        showVillageOverview();
      } else if (view === "plan2d") {
        await ensureSelectedLayersLoaded();
        showPlan2DOverview();
      } else if (view === "model3d") {
        await showModel3DOverview();
      }
    });
  });
}

function bindMapBackgroundClick() {
  const mapFrame = document.querySelector(".map-frame");
  if (!mapFrame) return;

  mapFrame.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.closest && target.closest("polygon")) return;

    setActivePolygon(null);
    currentSelectedObject = null;
    currentInfoMode = "readonly";
    update2DStatusText();
    showPlan2DOverview();
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
  if (!basemapToggle || !mapWrapper) return;

  basemapToggle.addEventListener("change", () => {
    syncBasemapUIBySpace(currentSpaceId);
  });
}

function bindAddSpaceButton() {
  if (!addSpaceBtn) return;
  addSpaceBtn.addEventListener("click", () => {
    createCopySpace();
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
    if (villageImage && BASEMAP_GEOREF?.imageUrl) {
      villageImage.src = BASEMAP_GEOREF.imageUrl;
    }
    currentSpaceId = spaces[0]?.id || BASE_SPACE_ID;

    if (basemapToggle) {
      basemapToggle.checked = false;
    }

    await ensureLayerLoaded("building");
    await ensureLayerLoaded("road");
    await ensureLayerLoaded("water");
    await ensureLayerLoaded("contours");
    await ensureLayerLoaded("figureGround");

    bindStoryEvents();
    bindMapBackgroundClick();
    bindResizeObserver();
    bindBasemapToggle();
    bindAddSpaceButton();

    renderSpaceList();
    syncBasemapUIBySpace(currentSpaceId);
    showVillageOverview();

    const handleImageReady = () => {
      if (plan2dView.classList.contains("active")) {
        refresh2DOverlay();
      }
    };

    if (villageImage.complete) {
      handleImageReady();
    } else {
      villageImage.onload = handleImageReady;
      villageImage.onerror = () => {
        console.warn("orthophoto.jpg 加载失败，2D 底图不会显示，但左侧导航仍可正常切换。");
      };
    }

    window.addEventListener("resize", () => {
      if (plan2dView.classList.contains("active")) {
        refresh2DOverlay();
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
}

init();