const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";
const OBJECT_EDITS_TABLE = "object_attribute_edits";

const BUILDING_EDITABLE_FIELDS = [
  { key: "房屋编码", label: "房屋编码", type: "text" },
  { key: "房屋名称", label: "房屋名称", type: "text" },
  { key: "建成年代", label: "建成年代", type: "text" },
  { key: "占地面积", label: "占地面积", type: "number", suffix: "㎡" }
];

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
      selectedLayers:
        s.id === BASE_SPACE_ID
          ? ["figureGround"]
          : (Array.isArray(s.selectedLayers) && s.selectedLayers.length ? s.selectedLayers : ["building"])
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

  return ["building", "road", "cropland", "openSpace"];
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

  const filtered = (baseSpace?.selectedLayers || ["building"]).filter(
    (key) => !["figureGround", "water"].includes(key)
  );

  const newSpace = {
    id: `copy_${Date.now()}`,
    title: `复制版 ${copyIndex}`,
    readonly: false,
    expanded: true,
    selectedLayers: filtered.length ? filtered : ["building"]
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
                ${layerConfigs[layerKey].label}
              </button>
            `).join("")}
          </div>
        </div>
      `;
    })
    .join("");

  bindSpaceListEvents();
}

function bindSpaceListEvents() {
  const selectButtons = document.querySelectorAll("[data-space-select]");
  selectButtons.forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      const targetInput = event.target.closest("[data-space-rename]");
      if (targetInput) return;

      const spaceId = btn.dataset.spaceSelect;
      if (!spaceId) return;

      currentSpaceId = spaceId;
      currentSelectedObject = null;
      currentInfoMode = "readonly";

      const currentTargetSpace = getSpaceById(spaceId);
      if (currentTargetSpace && currentTargetSpace.id === BASE_SPACE_ID) {
        currentTargetSpace.selectedLayers = ["figureGround"];
        if (basemapToggle) {
          basemapToggle.checked = false;
        }
      }

      saveSpacesToStorage();
      renderSpaceList();
      syncBasemapUIBySpace(spaceId);

      await ensureSelectedLayersLoadedForSpace(spaceId);

      setActiveStoryView("plan2d");
      switchMode("plan2d");
      showPlan2DOverview();
    });
  });

  const renameInputs = document.querySelectorAll("[data-space-rename]");
  renameInputs.forEach((input) => {
    input.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    input.addEventListener("input", (event) => {
      const spaceId = event.target.dataset.spaceRename;
      const target = getSpaceById(spaceId);
      if (!target || target.readonly) return;

      target.title = event.target.value.trim() || "复制版";
      saveSpacesToStorage();
      update2DStatusText();
    });

    input.addEventListener("blur", (event) => {
      const spaceId = event.target.dataset.spaceRename;
      const target = getSpaceById(spaceId);
      if (!target || target.readonly) return;

      target.title = event.target.value.trim() || "复制版";
      saveSpacesToStorage();
      renderSpaceList();
    });
  });

  const toggleButtons = document.querySelectorAll("[data-space-toggle]");
  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const spaceId = btn.dataset.spaceToggle;
      const target = getSpaceById(spaceId);
      if (!target) return;

      target.expanded = !target.expanded;
      saveSpacesToStorage();
      renderSpaceList();
    });
  });

  const layerButtons = document.querySelectorAll("[data-space-layer]");
  layerButtons.forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();

      const raw = btn.dataset.spaceLayer || "";
      const [spaceId, layerKey] = raw.split("::");
      if (!spaceId || !layerKey) return;

      const targetSpace = getSpaceById(spaceId);
      if (!targetSpace) return;

      const allowedLayerKeys = getAvailableLayerKeysForSpace(targetSpace);
      if (!allowedLayerKeys.includes(layerKey)) return;

      const nextSet = new Set(targetSpace.selectedLayers || []);

      if (nextSet.has(layerKey)) {
        nextSet.delete(layerKey);

        if (
          currentSelectedObject &&
          currentSelectedObject.layerKey === layerKey &&
          currentSelectedObject.spaceId === spaceId
        ) {
          currentSelectedObject = null;
          currentInfoMode = "readonly";
          setActivePolygon(null);
        }
      } else {
        if (layerKey === "figureGround") {
          await ensureLayerLoaded("building");
          await ensureLayerLoaded("road");
          await ensureLayerLoaded("water");
        } else {
          await ensureLayerLoaded(layerKey);
        }
        nextSet.add(layerKey);
      }

      if (spaceId === BASE_SPACE_ID && nextSet.size === 0) {
        nextSet.add("figureGround");
      }

      setSpaceSelectedLayers(spaceId, Array.from(nextSet));

      if (currentSpaceId !== spaceId) {
        currentSpaceId = spaceId;
      }

      renderSpaceList();
      syncBasemapUIBySpace(spaceId);

      setActiveStoryView("plan2d");
      switchMode("plan2d");
      showPlan2DOverview();
    });
  });
}

function hasRequiredNewLayout() {
  return !!(
    mainLayout &&
    villageImage &&
    svgOverlay &&
    infoPanel &&
    statusBadge &&
    detailSubtitle &&
    overviewView &&
    plan2dView &&
    model3dView &&
    spaceList &&
    addSpaceBtn
  );
}

async function loadText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载失败：${url}`);
  return await response.text();
}

async function loadCSV(url) {
  const text = await loadText(url);
  return parseCSV(text);
}

async function loadCSVOrEmpty(url) {
  try {
    return await loadCSV(url);
  } catch (error) {
    console.warn(`CSV 加载失败，按空表处理：${url}`, error);
    return [];
  }
}

async function loadGeoJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`加载失败：${url}`);
  return await response.json();
}

function parseCSV(text) {
  const cleanText = text.replace(/^\uFEFF/, "").trim();
  const lines = cleanText.split(/\r?\n/);
  if (!lines.length) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.replace(/^\uFEFF/, "").replace(/\r/g, "").trim());

  return lines
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const values = line.split(delimiter).map((v) => v.replace(/\r/g, "").trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || "";
      });
      return row;
    });
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function getFeatureCode(feature) {
  const p = feature.properties || {};
  return p.CODE || p.Code || p.code || p.NAME || p.Name || p.name || p.编码 || p.ID || p.id || "";
}

function getRowValueByFields(row, fields = []) {
  for (const field of fields) {
    if (row[field]) return row[field];
  }
  return "";
}

function getRowCode(row, layerKey) {
  const config = layerConfigs[layerKey];
  return config ? getRowValueByFields(row, config.codeFields) : "";
}

function getRowName(row, layerKey) {
  const config = layerConfigs[layerKey];
  return config ? getRowValueByFields(row, config.nameFields) : "";
}

function getRowPhotoValue(row, layerKey) {
  const config = layerConfigs[layerKey];
  return config ? getRowValueByFields(row, config.photoFields) : "";
}

function setupSVGSize() {
  if (!villageImage || !villageImage.naturalWidth) return false;

  const imgWidth = villageImage.naturalWidth;
  const imgHeight = villageImage.naturalHeight;
  const rect = villageImage.getBoundingClientRect();
  const wrapperRect = villageImage.parentElement.getBoundingClientRect();

  if (!rect.width || !rect.height) return false;

  svgOverlay.setAttribute("width", rect.width);
  svgOverlay.setAttribute("height", rect.height);
  svgOverlay.setAttribute("viewBox", `0 0 ${imgWidth} ${imgHeight}`);
  svgOverlay.style.width = `${rect.width}px`;
  svgOverlay.style.height = `${rect.height}px`;
  svgOverlay.style.left = `${rect.left - wrapperRect.left}px`;
  svgOverlay.style.top = `${rect.top - wrapperRect.top}px`;

  return true;
}

function qgisPointToImagePoint([x, y]) {
  return [x, -y];
}

function geometryToSVGPoints(feature) {
  const geom = feature.geometry;
  if (!geom) return [];

  let ring = null;
  if (geom.type === "Polygon") {
    ring = geom.coordinates[0];
  } else if (geom.type === "MultiPolygon") {
    ring = geom.coordinates[0][0];
  } else {
    return [];
  }

  return ring.map((point) => qgisPointToImagePoint(point));
}

function pointsToString(points) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

async function ensureLayerLoaded(layerKey) {
  const config = layerConfigs[layerKey];
  if (!config) return null;

  if (layerDataCache[layerKey]) return layerDataCache[layerKey];

  if (layerKey === "figureGround") {
    await ensureLayerLoaded("building");
    await ensureLayerLoaded("road");
    await ensureLayerLoaded("water");
    layerDataCache[layerKey] = { tableData: [], geojson: null };
    return layerDataCache[layerKey];
  }

  const [tableData, geojson] = await Promise.all([
    config.tableUrl ? loadCSVOrEmpty(config.tableUrl) : Promise.resolve([]),
    config.geojsonUrl ? loadGeoJSON(config.geojsonUrl) : Promise.resolve(null)
  ]);

  layerDataCache[layerKey] = { tableData, geojson };
  return layerDataCache[layerKey];
}

async function ensureSelectedLayersLoadedForSpace(spaceId) {
  const target = getSpaceById(spaceId);
  if (!target) return;

  for (const key of target.selectedLayers || []) {
    if (key === "figureGround") {
      await ensureLayerLoaded("building");
      await ensureLayerLoaded("road");
      await ensureLayerLoaded("water");
      await ensureLayerLoaded("figureGround");
    } else {
      await ensureLayerLoaded(key);
    }
  }
}

async function ensureSelectedLayersLoaded() {
  await ensureSelectedLayersLoadedForSpace(currentSpaceId);
}

function mergeObjectRow(baseRow, editData) {
  return { ...(baseRow || {}), ...(editData || {}) };
}

function getEditNamespaceObjectType(baseObjectType, spaceId) {
  if (!spaceId || spaceId === BASE_SPACE_ID) return null;
  return `${baseObjectType}__${spaceId}`;
}

function getPhotoNamespaceObjectType(baseObjectType, spaceId) {
  if (!spaceId || spaceId === BASE_SPACE_ID) return baseObjectType;
  return `${baseObjectType}__${spaceId}`;
}

async function fetchObjectEdits(sourceCode, namespacedObjectType) {
  if (!supabaseClient || !sourceCode || !namespacedObjectType) return null;

  const { data, error } = await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .select("data")
    .eq("object_code", sourceCode)
    .eq("object_type", namespacedObjectType)
    .maybeSingle();

  if (error) {
    console.error("读取对象编辑数据失败：", error);
    return null;
  }

  return data?.data || null;
}

async function saveObjectEdits(sourceCode, namespacedObjectType, payload) {
  if (!supabaseClient) {
    throw new Error("当前未配置 Supabase。");
  }

  const { error } = await supabaseClient
    .from(OBJECT_EDITS_TABLE)
    .upsert(
      [
        {
          object_code: sourceCode,
          object_type: namespacedObjectType,
          data: payload,
          updated_at: new Date().toISOString()
        }
      ],
      { onConflict: "object_code,object_type" }
    );

  if (error) throw error;
}

function getSelectedLayerLabels() {
  return getSelectedLayersForCurrentSpace()
    .map((key) => layerConfigs[key]?.label)
    .filter(Boolean);
}

function update2DStatusText() {
  const labels = getSelectedLayerLabels();
  const currentSpace = getCurrentSpace();

  if (!labels.length) {
    statusBadge.textContent = `当前空间：${currentSpace?.title || "未命名空间"}｜当前图层：未选择`;
    detailSubtitle.textContent = "请在左侧勾选要显示的图层";
    return;
  }

  statusBadge.textContent = `当前空间：${currentSpace?.title || "未命名空间"}｜当前图层：${labels.join(" + ")}`;

  if (currentSelectedObject) {
    const currentName = currentSelectedObject.displayName || currentSelectedObject.sourceCode || "未命名要素";
    detailSubtitle.textContent = `当前查看：${currentSelectedObject.layerLabel} - ${currentName}`;
  } else {
    detailSubtitle.textContent = "鼠标悬停可高亮，点击后查看要素详情";
  }
}

function refresh2DOverlay() {
  if (!plan2dView.classList.contains("active")) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (setupSVGSize()) {
        drawSelectedGeoJSONLayers();
      }

      setTimeout(() => {
        if (!plan2dView.classList.contains("active")) return;
        if (setupSVGSize()) {
          drawSelectedGeoJSONLayers();
        }
      }, 80);
    });
  });
}

function hideAllViews() {
  overviewView.classList.remove("active");
  plan2dView.classList.remove("active");
  model3dView.classList.remove("active");
}

function setActiveStoryView(viewName) {
  storyItems.forEach((item) => {
    item.classList.remove("active");
    if ((item.dataset.view || "") === viewName) {
      item.classList.add("active");
    }
  });
}

function switchMode(mode) {
  mainLayout.classList.remove("mode-overview");
  hideAllViews();

  if (mode === "overview") {
    mainLayout.classList.add("mode-overview");
    overviewView.classList.add("active");
    statusBadge.textContent = "当前模式：村庄基本信息";
    detailSubtitle.textContent = "当前模式为整合展示";
    if (spaceList) spaceList.classList.remove("active");
    if (addSpaceBtn) addSpaceBtn.style.display = "none";
  } else if (mode === "plan2d") {
    plan2dView.classList.add("active");
    update2DStatusText();
    if (spaceList) spaceList.classList.add("active");
    if (addSpaceBtn) addSpaceBtn.style.display = "block";
    renderSpaceList();
    syncBasemapUIBySpace(currentSpaceId);
    refresh2DOverlay();
  } else if (mode === "model3d") {
    model3dView.classList.add("active");
    statusBadge.textContent = "当前模式：村庄 3D 模型";
    detailSubtitle.textContent = "当前显示三维模型说明";
    if (spaceList) spaceList.classList.remove("active");
    if (addSpaceBtn) addSpaceBtn.style.display = "none";
  }
}

function createPolygonElement(points, className, dataset = {}) {
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", pointsToString(points));
  polygon.setAttribute("class", className);

  Object.entries(dataset).forEach(([key, value]) => {
    polygon.dataset[key] = value;
  });

  return polygon;
}

function appendLayerFeaturesToSvg(layerKey, spaceId) {
  const cache = layerDataCache[layerKey];
  if (!cache || !cache.geojson || !Array.isArray(cache.geojson.features)) return;

  const tableData = cache.tableData || [];
  const rowMap = new Map();
  tableData.forEach((row) => {
    const normCode = normalizeCode(getRowCode(row, layerKey));
    if (normCode) rowMap.set(normCode, row);
  });

  cache.geojson.features.forEach((feature, featureIndex) => {
    const points = geometryToSVGPoints(feature);
    if (!points.length) return;

    const rawCode = getFeatureCode(feature) || "";
    const baseRow = rowMap.get(normalizeCode(rawCode)) || null;

    const polygon = createPolygonElement(points, `house-polygon layer-${layerKey}`, {
      code: rawCode,
      layer: layerKey
    });

    polygon.addEventListener("mouseenter", () => {
      if (polygon !== activePolygon) {
        polygon.classList.add("hovering");
      }
    });

    polygon.addEventListener("mouseleave", () => {
      polygon.classList.remove("hovering");
    });

    polygon.addEventListener("click", async (event) => {
      event.stopPropagation();
      polygon.classList.remove("hovering");

      setActiveStoryView("plan2d");
      switchMode("plan2d");
      setActivePolygon(polygon);
      currentInfoMode = "readonly";

      if (baseRow) {
        await showObjectInfo(baseRow, layerKey, rawCode);
      } else {
        showUnmatchedObjectInfo(rawCode, layerKey);
      }
    });

    svgOverlay.appendChild(polygon);
    polygonMap.set(`${spaceId}__${layerKey}__${rawCode}`, { polygon, baseRow, layerKey });
  });
}

function appendFigureGroundToSvg(spaceId) {
  const mapping = [
    { source: "road", className: "house-polygon layer-figureGround-road" },
    { source: "water", className: "house-polygon layer-figureGround-water" },
    { source: "building", className: "house-polygon layer-figureGround-building" }
  ];

  mapping.forEach(({ source, className }) => {
    const cache = layerDataCache[source];
    if (!cache || !cache.geojson || !Array.isArray(cache.geojson.features)) return;

    cache.geojson.features.forEach((feature, featureIndex) => {
      const points = geometryToSVGPoints(feature);
      if (!points.length) return;

      const rawCode = getFeatureCode(feature) || `${source}_${featureIndex}`;
      const polygon = createPolygonElement(points, className, {
        code: rawCode,
        layer: "figureGround",
        fgSource: source
      });

      polygon.addEventListener("mouseenter", () => {
        if (polygon !== activePolygon) {
          polygon.classList.add("hovering");
        }
      });

      polygon.addEventListener("mouseleave", () => {
        polygon.classList.remove("hovering");
      });

      polygon.addEventListener("click", (event) => {
        event.stopPropagation();
        setActivePolygon(polygon);

        currentSelectedObject = {
          sourceCode: rawCode,
          displayName: rawCode,
          layerKey: "figureGround",
          layerLabel: "图底关系",
          spaceId
        };
        update2DStatusText();

        infoPanel.classList.remove("empty");
        infoPanel.innerHTML = `
          <div class="info-card">
            <h3 class="house-title">图底关系</h3>
            <div class="house-row"><span class="house-label">要素来源：</span>${
              source === "building" ? "建筑" : source === "road" ? "道路" : "水体"
            }</div>
            <div class="house-row"><span class="house-label">对象编码：</span>${escapeHtml(rawCode)}</div>
            <div class="house-row">当前图底关系图层仅由建筑、道路、水体三类要素构成。</div>
          </div>
        `;
      });

      svgOverlay.appendChild(polygon);
      polygonMap.set(`${spaceId}__figureGround__${rawCode}`, {
        polygon,
        baseRow: null,
        layerKey: "figureGround"
      });
    });
  });
}

function drawSelectedGeoJSONLayers() {
  svgOverlay.innerHTML = "";
  polygonMap.clear();

  const currentSpace = getCurrentSpace();
  const selectedKeys = getSelectedLayersForCurrentSpace();

  if (!selectedKeys.length || !currentSpace) {
    setActivePolygon(null);
    return;
  }

  if (selectedKeys.includes("figureGround") && currentSpace.id === BASE_SPACE_ID) {
    appendFigureGroundToSvg(currentSpace.id);
  }

  selectedKeys.forEach((layerKey) => {
    if (layerKey === "figureGround") return;
    appendLayerFeaturesToSvg(layerKey, currentSpace.id);
  });

  restoreActivePolygonAfterRedraw();
}

function restoreActivePolygonAfterRedraw() {
  if (!currentSelectedObject) return;

  const key = `${currentSelectedObject.spaceId}__${currentSelectedObject.layerKey}__${currentSelectedObject.sourceCode}`;
  const matched = polygonMap.get(key);
  if (matched && matched.polygon) {
    setActivePolygon(matched.polygon);
  } else {
    activePolygon = null;
  }
}

function setActivePolygon(polygon) {
  if (activePolygon) {
    activePolygon.classList.remove("active");
    activePolygon.classList.remove("hovering");
  }

  if (polygon) {
    polygon.classList.add("active");
    polygon.classList.remove("hovering");
    activePolygon = polygon;
  } else {
    activePolygon = null;
  }
}

async function fetchObjectPhotos(sourceCode, photoObjectType) {
  if (!supabaseClient || !photoObjectType) return [];

  const { data, error } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .select("*")
    .eq("object_code", sourceCode)
    .eq("object_type", photoObjectType)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("读取对象照片失败：", error);
    return [];
  }
  return data || [];
}

async function handlePhotoUpload(context) {
  const input = document.getElementById("photoUploadInput");
  const statusEl = document.getElementById("uploadStatus");

  if (!context) return;
  if (!context.allowEdit) {
    if (statusEl) statusEl.textContent = "村庄现状空间为只读，不能上传。";
    return;
  }

  if (!supabaseClient) {
    if (statusEl) statusEl.textContent = "请先在 app.js 顶部填入真实的 Supabase URL 和 publishable key。";
    return;
  }

  if (!input || !input.files || !input.files.length) {
    if (statusEl) statusEl.textContent = "请先选择一张图片。";
    return;
  }

  const file = input.files[0];
  if (!context.sourceCode || !context.photoObjectType) {
    if (statusEl) statusEl.textContent = "当前对象缺少编码或类型，无法上传。";
    return;
  }

  if (file.size > 6 * 1024 * 1024) {
    if (statusEl) statusEl.textContent = "请上传 6MB 以内图片。";
    return;
  }

  if (statusEl) statusEl.textContent = "正在上传...";

  const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
  const filePath = `${context.photoObjectType}/${context.sourceCode}/${safeName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(PHOTO_BUCKET)
    .upload(filePath, file, {
      upsert: false,
      contentType: file.type || "image/jpeg"
    });

  if (uploadError) {
    console.error("上传失败：", uploadError);
    if (statusEl) statusEl.textContent = `上传失败：${uploadError.message}`;
    return;
  }

  const { data: publicData } = supabaseClient.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(filePath);

  const photoUrl = publicData?.publicUrl || "";

  const { error: insertError } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .insert([
      {
        object_code: context.sourceCode,
        object_type: context.photoObjectType,
        photo_url: photoUrl,
        photo_path: filePath
      }
    ]);

  if (insertError) {
    console.error("写入数据库失败：", insertError);
    if (statusEl) statusEl.textContent = `数据库写入失败：${insertError.message}`;
    return;
  }

  if (statusEl) statusEl.textContent = "上传成功。";
  await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
}

async function handlePhotoDelete(photoItem, context) {
  const statusEl = document.getElementById("uploadStatus");

  if (!context.allowEdit) {
    if (statusEl) statusEl.textContent = "村庄现状空间为只读，不能删除。";
    return;
  }

  if (!supabaseClient) {
    if (statusEl) statusEl.textContent = "当前未配置 Supabase。";
    return;
  }

  if (!photoItem || !photoItem.photo_path) {
    if (statusEl) statusEl.textContent = "这张照片没有可删除的存储路径。";
    return;
  }

  const ok = window.confirm("确定要删除这张照片吗？");
  if (!ok) return;

  if (statusEl) statusEl.textContent = "正在删除...";

  const { error: storageError } = await supabaseClient.storage
    .from(PHOTO_BUCKET)
    .remove([photoItem.photo_path]);

  if (storageError) {
    console.error("删除 Storage 文件失败：", storageError);
    if (statusEl) statusEl.textContent = `删除文件失败：${storageError.message}`;
    return;
  }

  const { error: dbError } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .delete()
    .eq("id", photoItem.id);

  if (dbError) {
    console.error("删除数据库记录失败：", dbError);
    if (statusEl) statusEl.textContent = `删除记录失败：${dbError.message}`;
    return;
  }

  if (statusEl) statusEl.textContent = "删除成功。";
  await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode);
}

function showVillageOverview() {
  setActivePolygon(null);
  currentSelectedObject = null;
  setActiveStoryView("overview");
  switchMode("overview");

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄基本信息</h3>
      <p>当前为村庄基本信息模式，中间与右侧区域合并显示。你可以在中间区域布置村庄概况、现状问题、教学目标、区位分析、用地特征等内容。</p>
    </div>
  `;
}

function showPlan2DOverview() {
  setActivePolygon(null);
  currentSelectedObject = null;
  currentInfoMode = "readonly";
  setActiveStoryView("plan2d");
  switchMode("plan2d");

  const labels = getSelectedLayerLabels();
  const currentSpace = getCurrentSpace();

  if (!labels.length) {
    infoPanel.classList.add("empty");
    infoPanel.innerHTML = `
      <div class="placeholder-block">
        <h3>${currentSpace?.title || "当前空间"}</h3>
        <p>当前未选择任何图层。请在左侧勾选要显示的图层。</p>
      </div>
    `;
    return;
  }

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>${currentSpace?.title || "当前空间"}</h3>
      <p>当前已开启：${labels.join("、")}。</p>
      <p>${currentSpace?.readonly ? "该空间为只读，用于保留村庄现状信息。" : "该空间为复制版，可用于教学编辑与保存。"} </p>
      <p>鼠标放到面要素上会临时高亮，点击后会保持高亮，并在右侧显示当前选中要素的详细信息。</p>
    </div>
  `;
}

function showModel3DOverview() {
  setActivePolygon(null);
  currentSelectedObject = null;
  setActiveStoryView("model3d");
  switchMode("model3d");

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄 3D 模型</h3>
      <p>当前展示的是村庄 3D 模型模式。后续这里可以接入三维浏览、模型漫游、点击查询、规划方案叠加与编辑等功能。</p>
    </div>
  `;
}

function showUnmatchedObjectInfo(code, layerKey) {
  const label = layerConfigs[layerKey]?.label || "对象";
  const displayName = code || "未命名要素";

  currentSelectedObject = {
    sourceCode: code || "",
    displayName,
    layerKey,
    layerLabel: label,
    spaceId: currentSpaceId
  };
  update2DStatusText();

  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">未匹配数据</h3>
      <div class="house-row"><span class="house-label">对象类型：</span>${label}</div>
      <div class="house-row"><span class="house-label">对象编码：</span>${escapeHtml(code || "-")}</div>
      <div class="house-row">该图层对象已读取，但没有在对应的数据表中找到匹配信息。</div>
    </div>
  `;
}

function buildReadOnlyDetailHtml(row, layerKey) {
  if (layerKey === "building") {
    return `
      <div class="house-row"><span class="house-label">房屋编码：</span>${escapeHtml(row["房屋编码"] || row["编码"] || "-")}</div>
      <div class="house-row"><span class="house-label">房屋名称：</span>${escapeHtml(row["房屋名称"] || row["名称"] || "-")}</div>
      <div class="house-row"><span class="house-label">建成年代：</span>${escapeHtml(row["建成年代"] || "-")}</div>
      <div class="house-row"><span class="house-label">占地面积：</span>${escapeHtml(row["占地面积"] || "-")} ㎡</div>
    `;
  }

  if (layerKey === "road") {
    return `
      <div class="house-row"><span class="house-label">道路编码：</span>${escapeHtml(row["道路编码"] || row["编码"] || "-")}</div>
      <div class="house-row"><span class="house-label">道路名称：</span>${escapeHtml(row["道路名称"] || row["名称"] || "-")}</div>
      <div class="house-row"><span class="house-label">道路类型：</span>${escapeHtml(row["道路类型"] || "-")}</div>
      <div class="house-row"><span class="house-label">路面材质：</span>${escapeHtml(row["路面材质"] || "-")}</div>
    `;
  }

  if (layerKey === "cropland") {
    return `
      <div class="house-row"><span class="house-label">农田编码：</span>${escapeHtml(row["农田编码"] || row["编码"] || "-")}</div>
      <div class="house-row"><span class="house-label">农田名称：</span>${escapeHtml(row["农田名称"] || row["名称"] || "-")}</div>
      <div class="house-row"><span class="house-label">作物类型：</span>${escapeHtml(row["作物类型"] || "-")}</div>
      <div class="house-row"><span class="house-label">面积：</span>${escapeHtml(row["面积"] || "-")} ㎡</div>
    `;
  }

  if (layerKey === "openSpace") {
    return `
      <div class="house-row"><span class="house-label">空间编码：</span>${escapeHtml(row["公共空间编码"] || row["编码"] || "-")}</div>
      <div class="house-row"><span class="house-label">空间名称：</span>${escapeHtml(row["公共空间名称"] || row["名称"] || "-")}</div>
      <div class="house-row"><span class="house-label">空间类型：</span>${escapeHtml(row["空间类型"] || "-")}</div>
      <div class="house-row"><span class="house-label">面积：</span>${escapeHtml(row["面积"] || "-")} ㎡</div>
    `;
  }

  if (layerKey === "water") {
    return `
      <div class="house-row"><span class="house-label">水体编码：</span>${escapeHtml(row["水体编码"] || row["编码"] || "-")}</div>
      <div class="house-row"><span class="house-label">水体名称：</span>${escapeHtml(row["水体名称"] || row["名称"] || "-")}</div>
      <div class="house-row"><span class="house-label">类型：</span>${escapeHtml(row["水体类型"] || row["类型"] || "-")}</div>
      <div class="house-row"><span class="house-label">面积：</span>${escapeHtml(row["面积"] || "-")} ㎡</div>
    `;
  }

  if (layerKey === "figureGround") {
    return `<div class="house-row">图底关系图层仅由建筑、道路、水体三类要素构成。</div>`;
  }

  return `<div class="house-row"><span class="house-label">编码：</span>${escapeHtml(getRowCode(row, layerKey) || "-")}</div>`;
}

function buildBuildingEditFormHtml(row) {
  return `
    <form id="buildingEditForm" class="edit-form">
      ${BUILDING_EDITABLE_FIELDS.map((field) => {
        const value = row[field.key] ?? "";
        const inputMode = field.type === "number" ? "decimal" : "text";
        return `
          <div class="form-row">
            <label class="form-label" for="field_${field.key}">${field.label}</label>
            <div class="form-input-wrap">
              <input
                id="field_${field.key}"
                class="form-input"
                name="${field.key}"
                type="${field.type === "number" ? "number" : "text"}"
                inputmode="${inputMode}"
                step="any"
                value="${escapeHtml(value)}"
              />
              ${field.suffix ? `<span class="form-suffix">${field.suffix}</span>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </form>
  `;
}

function buildInfoModeSwitchHtml(options) {
  const { layerKey, allowEdit, readonlySpace } = options;

  if (readonlySpace) {
    return `
      <div class="mode-switch-card readonly-only-note">
        <div class="mode-switch-title">信息模式</div>
        <div class="mode-switch-tip">当前处于“村庄现状”空间，为只读展示，不提供编辑入口。</div>
      </div>
    `;
  }

  if (!allowEdit) {
    return `
      <div class="mode-switch-card readonly-only-note">
        <div class="mode-switch-title">信息模式</div>
        <div class="mode-switch-tip">当前复制版仅对建筑图层开放属性编辑；${layerConfigs[layerKey]?.label || "该图层"}仍为只读展示。</div>
      </div>
    `;
  }

  return `
    <div class="mode-switch-card">
      <div class="mode-switch-header">
        <div class="mode-switch-title">信息模式</div>
        <div class="mode-switch-pill">
          <button type="button" class="mode-switch-btn ${currentInfoMode === "readonly" ? "active" : ""}" data-mode="readonly">只读模式</button>
          <button type="button" class="mode-switch-btn ${currentInfoMode === "edit" ? "active" : ""}" data-mode="edit">编辑模式</button>
        </div>
      </div>
      <div class="mode-switch-tip">当前为复制版空间，编辑后只会保存到本复制版，不会覆盖“村庄现状”。</div>
    </div>
  `;
}

function collectBuildingFormData() {
  const form = document.getElementById("buildingEditForm");
  if (!form) return null;

  const formData = new FormData(form);
  const payload = {};

  BUILDING_EDITABLE_FIELDS.forEach((field) => {
    let value = formData.get(field.key);
    if (typeof value === "string") value = value.trim();
    payload[field.key] = value || "";
  });

  return payload;
}

async function handleBuildingSave(context) {
  const saveStatus = document.getElementById("saveStatus");
  const saveBtn = document.getElementById("saveBuildingBtn");

  if (!context) return;
  if (!context.allowEdit || !context.editObjectType) {
    if (saveStatus) saveStatus.textContent = "当前空间不可编辑。";
    return;
  }
  if (!supabaseClient) {
    if (saveStatus) saveStatus.textContent = "当前未配置 Supabase，无法保存。";
    return;
  }

  const payload = collectBuildingFormData();
  if (!payload) return;

  if (!payload["房屋编码"]) {
    if (saveStatus) saveStatus.textContent = "房屋编码不能为空。";
    return;
  }

  if (saveBtn) saveBtn.disabled = true;
  if (saveStatus) saveStatus.textContent = "正在保存...";

  try {
    await saveObjectEdits(context.sourceCode, context.editObjectType, payload);
    currentInfoMode = "readonly";
    if (saveStatus) saveStatus.textContent = "保存成功。";
    await showObjectInfo(context.baseRow, context.layerKey, context.sourceCode, { flashSaved: true });
  } catch (error) {
    console.error("保存建筑属性失败：", error);
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
  const allowBuildingEdit = !readonlySpace && layerKey === "building";

  const editObjectType = getEditNamespaceObjectType(baseObjectType, currentSpaceId);
  const photoObjectType = getPhotoNamespaceObjectType(baseObjectType, currentSpaceId);

  const editData = allowBuildingEdit
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
    allowEdit: allowBuildingEdit,
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

  const detailHtml = allowBuildingEdit && currentInfoMode === "edit"
    ? buildBuildingEditFormHtml(mergedRow)
    : buildReadOnlyDetailHtml(mergedRow, layerKey);

  const saveBarHtml = allowBuildingEdit && currentInfoMode === "edit"
    ? `
      <div class="edit-actions">
        <button id="saveBuildingBtn" class="upload-btn" type="button">保存修改</button>
        <div id="saveStatus" class="save-status">${options.flashSaved ? "保存成功。" : ""}</div>
      </div>
    `
    : options.flashSaved
      ? `<div class="save-status success-inline">已显示本复制版的最新保存版本。</div>`
      : "";

  const uploadBlockHtml = allowBuildingEdit
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
                  item.source === "db" && allowBuildingEdit
                    ? `<div class="photo-actions">
                         <button class="delete-photo-btn" data-photo-id="${item.id}" type="button">删除这张照片</button>
                       </div>`
                    : item.source === "csv"
                      ? `<div class="photo-source-tag">本地预置照片</div>`
                      : `<div class="photo-source-tag">${readonlySpace ? "复制版照片仅查看" : "对象照片"}</div>`
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
      allowEdit: allowBuildingEdit,
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
      await handleBuildingSave(context);
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
        showModel3DOverview();
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
    currentSpaceId = spaces[0]?.id || BASE_SPACE_ID;

    if (basemapToggle) {
      basemapToggle.checked = false;
    }

    await ensureLayerLoaded("building");
    await ensureLayerLoaded("road");
    await ensureLayerLoaded("water");
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