(function () {
  const GEOJSON_URL = "data/buildings_3d.geojson";
  const CSV_URL = "data/houses.csv";

  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
  const OBJECT_EDITS_TABLE = "object_attribute_edits";

  const MODEL_SPACE_STORAGE_KEY = "village_planning_3d_spaces_v1";
  const MODEL_BASE_SPACE_ID = "current_3d";
  const MODEL_BASE_OBJECT_TYPE = "building_3d";

  const CODE_FIELDS = ["房屋编码", "编码", "CODE", "Code", "code", "ID", "id", "NAME", "Name", "name"];
  const NAME_FIELDS = ["房屋名称", "名称", "NAME", "Name", "name"];
  const YEAR_FIELDS = ["建成年代", "年代", "year", "YEAR", "Year"];
  const AREA_FIELDS = ["占地面积", "面积", "建筑面积", "area", "AREA", "Area"];
  const FUNCTION_FIELDS = ["房屋功能信息", "房屋功能", "功能", "用途", "function", "FUNCTION"];
  const STRUCTURE_FIELDS = ["房屋结构信息", "房屋结构", "结构", "structure", "STRUCTURE"];
  const OWNER_FIELDS = ["户主信息", "户主", "owner", "OWNER", "Owner"];
  const HEIGHT_FIELDS = ["建筑高度", "房屋高度", "height", "HEIGHT", "Height", "H", "h", "floors", "楼层", "层数"];

  const DEFAULT_HEIGHT = 9;

  const MODEL_EDITABLE_FIELDS = [
    { key: "房屋编码", label: "房屋编码", type: "text" },
    { key: "房屋名称", label: "房屋名称", type: "text" },
    { key: "建成年代", label: "建成年代", type: "text" },
    { key: "建筑高度", label: "建筑高度", type: "number", step: "0.01", suffix: "m" },
    { key: "房屋功能信息", label: "房屋功能信息", type: "text" },
    { key: "房屋结构信息", label: "房屋结构信息", type: "text" },
    { key: "占地面积", label: "占地面积", type: "number", step: "0.01", suffix: "㎡" },
    { key: "户主信息", label: "户主信息", type: "text" }
  ];

  const MODEL_SCALE_BASE = 0.1; // 界面里的 1 = Cesium 真实 0.1

  // 这一版默认值调得更“容易看见”
  // 你只有一个 glb 也没关系，可以先把三个都指向同一个文件测试
  const MODEL_PRESETS = [
    { id: "house_type_a", name: "传统祠堂-01", url: "assets/models/house_type_a.glb", scale: 120, heading: 90, heightOffset: 6.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_b", name: "一层现代住宅-01", url: "assets/models/house_type_b.glb", scale: 1, heading: 90, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_c", name: "二层现代住宅-01", url: "assets/models/house_type_c.glb", scale: 1, heading: 90, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_d", name: "三层现代住宅-01", url: "assets/models/house_type_d.glb", scale: 1, heading: 90, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_e", name: "四层现代住宅-01", url: "assets/models/house_type_e.glb", scale: 1, heading: 90, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 }
  ];

  const BASE_COLOR = Cesium.Color.WHITE.withAlpha(0.92);
  const OUTLINE_COLOR = Cesium.Color.fromCssColorString("#c5ccd3");
  const ACTIVE_COLOR = Cesium.Color.fromCssColorString("#90caf9").withAlpha(0.72);
  const ACTIVE_OUTLINE_COLOR = Cesium.Color.fromCssColorString("#1565c0");
  const REPLACED_BASE_COLOR = Cesium.Color.fromCssColorString("#90caf9").withAlpha(0.35);
  const REPLACED_OUTLINE_COLOR = Cesium.Color.fromCssColorString("#1565c0");

  const supabaseClient =
    typeof supabase !== "undefined" &&
    SUPABASE_URL &&
    SUPABASE_PUBLISHABLE_KEY &&
    !SUPABASE_URL.includes("你的项目ref") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("publishable key")
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
      : null;

  let viewer = null;
  let initialized = false;
  let buildingsDataSource = null;
  let clickHandler = null;

  let csvRows = [];
  let rowMap = new Map();
  let entityMap = new Map();
  let replacementModelMap = new Map(); // value: { primitive, pointEntity }
  let replacementRequestTokenMap = new Map(); // key -> Symbol，用来防止旧模型晚到场
  let activeEntity = null;

  // 新增：是否显示“替换后蓝色白模”和“红点锚点”
  let showReplacementBase = false;
  let showReplacementAnchor = false;

  let modelSpaces = [];
  let currentModelSpaceId = MODEL_BASE_SPACE_ID;
  let currentInfoMode = "readonly";
  let currentSelectedEntityCode = "";

  let modelSpaceListEl = null;
  let addModelSpaceBtnEl = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function getInfoPanel() {
    return byId("infoPanel");
  }

  function getStatusBadge() {
    return byId("statusBadge");
  }

  function getDetailSubtitle() {
    return byId("detailSubtitle");
  }

  function getModel3DView() {
    return byId("model3dView");
  }

  function is3DViewActive() {
    const view = getModel3DView();
    return !!(view && view.classList.contains("active"));
  }

  function normalizeCode(value) {
    if (typeof window.normalizeCode === "function") {
      return window.normalizeCode(value);
    }
    return String(value || "")
      .trim()
      .replace(/\uFEFF/g, "")
      .replace(/\s+/g, "")
      .replace(/-/g, "")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pickFirstValue(obj, fields) {
    if (!obj) return "";
    for (const field of fields) {
      if (obj[field] !== undefined && obj[field] !== null && String(obj[field]).trim() !== "") {
        return obj[field];
      }
    }
    return "";
  }

  function parseMaybeNumber(value) {
    if (value === undefined || value === null || value === "") return NaN;
    const str = String(value).trim();

    const direct = Number(str);
    if (!Number.isNaN(direct)) return direct;

    const matched = str.match(/-?\d+(\.\d+)?/);
    if (matched) {
      const num = Number(matched[0]);
      if (!Number.isNaN(num)) return num;
    }
    return NaN;
  }

  function toFiniteNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function normalizeStoredModelScale(value, fallback = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;

    // 兼容旧数据：
    // 旧逻辑里 0.1 才是正常，现在把它映射成新标准 1
    if (num > 0 && num <= 0.2) {
      return num / MODEL_SCALE_BASE;
    }

    return num;
  }

  function readBuildingHeightFromObject(obj) {
    for (const field of HEIGHT_FIELDS) {
      if (!(field in obj)) continue;
      const value = obj[field];
      const num = parseMaybeNumber(value);
      if (!Number.isNaN(num)) {
        if (field === "floors" || field === "楼层" || field === "层数") {
          return Math.max(1, num) * 3;
        }
        return Math.max(1, num);
      }
    }
    return DEFAULT_HEIGHT;
  }

  function loadText(url) {
    return fetch(url, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`读取文件失败：${url}`);
      return res.text();
    });
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell);
        cell = "";
        if (row.some((item) => String(item).trim() !== "")) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      if (row.some((item) => String(item).trim() !== "")) rows.push(row);
    }

    if (!rows.length) return [];

    const headers = rows[0].map((h) => String(h || "").trim().replace(/^\uFEFF/, ""));
    return rows.slice(1).map((values) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = String(values[index] ?? "").trim();
      });
      return obj;
    });
  }

  async function loadCSVRows() {
    try {
      const text = await loadText(CSV_URL);
      csvRows = parseCSV(text);
    } catch (error) {
      console.warn("读取 CSV 失败，将只使用 GeoJSON 属性：", error);
      csvRows = [];
    }

    rowMap = new Map();
    csvRows.forEach((row) => {
      const code = normalizeCode(pickFirstValue(row, CODE_FIELDS));
      if (code) rowMap.set(code, row);
    });
  }

  function entityPropertiesToPlainObject(entity) {
    const result = {};
    if (!entity || !entity.properties || !entity.properties.propertyNames) return result;

    entity.properties.propertyNames.forEach((name) => {
      try {
        result[name] = entity.properties[name]?.getValue(Cesium.JulianDate.now());
      } catch (error) {
        result[name] = "";
      }
    });
    return result;
  }

  function getEntitySourceCode(entity) {
    const props = entityPropertiesToPlainObject(entity);
    return pickFirstValue(props, CODE_FIELDS);
  }

  function getEntityDisplayName(entity, fallbackCode = "") {
    const props = entityPropertiesToPlainObject(entity);
    return pickFirstValue(props, NAME_FIELDS) || fallbackCode || "未命名建筑";
  }

  function setEntityDefaultStyle(entity) {
    if (!entity || !entity.polygon) return;
    entity.polygon.material = BASE_COLOR;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = OUTLINE_COLOR;
    entity.polygon.outlineWidth = 1.2;
  }

  function setEntityActiveStyle(entity) {
    if (!entity || !entity.polygon) return;
    entity.polygon.material = ACTIVE_COLOR;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = ACTIVE_OUTLINE_COLOR;
    entity.polygon.outlineWidth = 2.5;
  }

  function setEntityReplacementVisual(entity, hasReplacement) {
    if (!entity || !entity.polygon) return;

    // 当前选中的对象：始终高亮
    if (activeEntity === entity) {
      entity.show = true;
      setEntityActiveStyle(entity);
      return;
    }

    // 已替换模型的对象
    if (hasReplacement) {
      if (showReplacementBase) {
        // 显示蓝色白模
        entity.show = true;
        entity.polygon.material = Cesium.Color.fromCssColorString("#90caf9").withAlpha(0.35);
        entity.polygon.outline = true;
        entity.polygon.outlineColor = Cesium.Color.fromCssColorString("#1565c0");
        entity.polygon.outlineWidth = 2.0;
      } else {
        // 不显示蓝色白模：直接隐藏白模
        entity.show = false;
      }
      return;
    }

    // 普通未替换对象：正常显示白模
    entity.show = true;
    setEntityDefaultStyle(entity);
  }

  function refreshAllEntityVisualStates() {
    entityMap.forEach((entity, key) => {
      if (!entity || !entity.polygon) return;

      const hasReplacement = replacementModelMap.has(key);
      setEntityReplacementVisual(entity, hasReplacement);
    });

    viewer?.scene.requestRender();
  }

  function clearActiveEntity() {
    activeEntity = null;
    refreshAllEntityVisualStates();
  }

  function setActiveEntity(entity) {
    if (activeEntity === entity) return;
    activeEntity = entity;
    refreshAllEntityVisualStates();
  }

  function getEntityCenterCartographic(entity) {
    if (!entity || !entity.polygon || !entity.polygon.hierarchy) return null;

    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
    if (!hierarchy || !hierarchy.positions || !hierarchy.positions.length) return null;

    let lonSum = 0;
    let latSum = 0;
    let count = 0;

    hierarchy.positions.forEach((position) => {
      const cartographic = Cesium.Cartographic.fromCartesian(position);
      lonSum += cartographic.longitude;
      latSum += cartographic.latitude;
      count += 1;
    });

    if (!count) return null;
    return new Cesium.Cartographic(lonSum / count, latSum / count, 0);
  }

  async function applyTerrainHeights(entities) {
    if (!entities.length || !viewer) return;

    const cartographics = [];
    const refs = [];

    entities.forEach((entity) => {
      const center = getEntityCenterCartographic(entity);
      if (center) {
        cartographics.push(center);
        refs.push(entity);
      }
    });

    if (!cartographics.length) return;

    try {
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
      sampled.forEach((cartographic, index) => {
        const entity = refs[index];
        if (!entity || !entity.polygon) return;

        const sourceCode = entity.__sourceCode || "";
        const baseRow = rowMap.get(normalizeCode(sourceCode)) || null;
        const props = entityPropertiesToPlainObject(entity);

        const height = baseRow
          ? readBuildingHeightFromObject(baseRow)
          : readBuildingHeightFromObject(props);

        const terrainHeight = Number.isFinite(cartographic.height) ? Math.max(0, cartographic.height) : 0;

        entity.__terrainHeight = terrainHeight;
        entity.__baseHeight = height;
        entity.__buildingHeight = height;

        entity.polygon.height = terrainHeight;
        entity.polygon.extrudedHeight = terrainHeight + height;
      });
    } catch (error) {
      console.warn("地形高程采样失败，将使用 0 作为底高：", error);

      entities.forEach((entity) => {
        if (!entity || !entity.polygon) return;

        const sourceCode = entity.__sourceCode || "";
        const baseRow = rowMap.get(normalizeCode(sourceCode)) || null;
        const props = entityPropertiesToPlainObject(entity);

        const height = baseRow
          ? readBuildingHeightFromObject(baseRow)
          : readBuildingHeightFromObject(props);

        entity.__terrainHeight = 0;
        entity.__baseHeight = height;
        entity.__buildingHeight = height;

        entity.polygon.height = 0;
        entity.polygon.extrudedHeight = height;
      });
    }
  }

  function getDefaultModelSpaces() {
    return [
      {
        id: MODEL_BASE_SPACE_ID,
        title: "村庄现状",
        readonly: true,
        expanded: true
      }
    ];
  }

  function loadModelSpacesFromStorage() {
    try {
      const raw = localStorage.getItem(MODEL_SPACE_STORAGE_KEY);
      if (!raw) return getDefaultModelSpaces();

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.length) return getDefaultModelSpaces();

      const hasBase = parsed.some((s) => s.id === MODEL_BASE_SPACE_ID);
      if (!hasBase) parsed.unshift(getDefaultModelSpaces()[0]);

      return parsed.map((s) => ({
        id: s.id === MODEL_BASE_SPACE_ID ? MODEL_BASE_SPACE_ID : (s.id || `model_${Date.now()}`),
        title: s.id === MODEL_BASE_SPACE_ID ? "村庄现状" : (s.title || "3D复制版"),
        readonly: s.id === MODEL_BASE_SPACE_ID ? true : false,
        expanded: typeof s.expanded === "boolean" ? s.expanded : true
      }));
    } catch (error) {
      console.warn("读取 3D 空间配置失败，已回退默认值：", error);
      return getDefaultModelSpaces();
    }
  }

  function saveModelSpacesToStorage() {
    try {
      localStorage.setItem(MODEL_SPACE_STORAGE_KEY, JSON.stringify(modelSpaces));
    } catch (error) {
      console.warn("保存 3D 空间配置失败：", error);
    }
  }

  function getCurrentModelSpace() {
    return modelSpaces.find((s) => s.id === currentModelSpaceId) || modelSpaces[0] || getDefaultModelSpaces()[0];
  }

  function getModelSpaceById(spaceId) {
    return modelSpaces.find((s) => s.id === spaceId) || null;
  }

  function isBaseModelSpace(spaceId) {
    return spaceId === MODEL_BASE_SPACE_ID;
  }

  function getModelEditNamespaceObjectType(spaceId) {
    if (!spaceId || isBaseModelSpace(spaceId)) return null;
    return `${MODEL_BASE_OBJECT_TYPE}__${spaceId}`;
  }

  function getModelPresetById(presetId) {
    return MODEL_PRESETS.find((item) => item.id === presetId) || null;
  }

  function getModelStateFromRow(row) {
    const presetId = row?.modelPreset || "";
    const preset = getModelPresetById(presetId);

    return {
      modelPreset: presetId,
      modelUrl: row?.modelUrl || preset?.url || "",
      modelScale: normalizeStoredModelScale(row?.modelScale, preset?.scale ?? 1),
      modelHeading: toFiniteNumber(row?.modelHeading, preset?.heading ?? 0),
      modelHeightOffset: toFiniteNumber(row?.modelHeightOffset, preset?.heightOffset ?? 0),
      modelOffsetX: toFiniteNumber(row?.modelOffsetX, preset?.offsetX ?? 0),
      modelOffsetY: toFiniteNumber(row?.modelOffsetY, preset?.offsetY ?? 0)
    };
  }

  function buildModelPayloadPatchFromPreset(presetId, existingRow = {}, manualOverrides = {}) {
    if (!presetId) {
      return {
        ...(existingRow || {}),
        modelPreset: "",
        modelUrl: "",
        modelScale: "",
        modelHeading: "",
        modelHeightOffset: "",
        modelOffsetX: "",
        modelOffsetY: ""
      };
    }

    const preset = getModelPresetById(presetId);
    if (!preset) {
      return {
        ...(existingRow || {}),
        modelPreset: "",
        modelUrl: "",
        modelScale: "",
        modelHeading: "",
        modelHeightOffset: "",
        modelOffsetX: "",
        modelOffsetY: ""
      };
    }

    const nextScale = manualOverrides.modelScale ?? preset.scale ?? 1;
    const nextHeading = manualOverrides.modelHeading ?? preset.heading ?? 0;
    const nextHeightOffset = manualOverrides.modelHeightOffset ?? preset.heightOffset ?? 0;
    const nextOffsetX = manualOverrides.modelOffsetX ?? preset.offsetX ?? 0;
    const nextOffsetY = manualOverrides.modelOffsetY ?? preset.offsetY ?? 0;

    return {
      ...(existingRow || {}),
      modelPreset: preset.id,
      modelUrl: preset.url,
      modelScale: String(nextScale),
      modelHeading: String(nextHeading),
      modelHeightOffset: String(nextHeightOffset),
      modelOffsetX: String(nextOffsetX),
      modelOffsetY: String(nextOffsetY)
    };
  }

  function ensure3DSpaceUI() {
    if (modelSpaceListEl && addModelSpaceBtnEl) return;

    const modelStoryItem = document.querySelector('.story-item[data-view="model3d"]');
    if (!modelStoryItem) return;

    const storyGroup = modelStoryItem.closest(".story-group");
    if (!storyGroup) return;

    modelSpaceListEl = byId("modelSpaceList");
    addModelSpaceBtnEl = byId("addModelSpaceBtn");

    if (!modelSpaceListEl) {
      modelSpaceListEl = document.createElement("div");
      modelSpaceListEl.id = "modelSpaceList";
      modelSpaceListEl.className = "space-list-panel";
      storyGroup.appendChild(modelSpaceListEl);
    }

    if (!addModelSpaceBtnEl) {
      addModelSpaceBtnEl = document.createElement("button");
      addModelSpaceBtnEl.id = "addModelSpaceBtn";
      addModelSpaceBtnEl.className = "add-space-btn";
      addModelSpaceBtnEl.type = "button";
      addModelSpaceBtnEl.title = "新建 3D 复制版空间";
      addModelSpaceBtnEl.textContent = "+";
      storyGroup.appendChild(addModelSpaceBtnEl);
    }

    addModelSpaceBtnEl.onclick = () => {
      createModelCopySpace();
    };
  }

  function renderModelSpaceList() {
    ensure3DSpaceUI();
    if (!modelSpaceListEl) return;

    modelSpaceListEl.innerHTML = modelSpaces
      .map((space) => {
        const isCurrent = space.id === currentModelSpaceId;
        const triangle = space.expanded ? "▼" : "▲";

        return `
          <div class="space-panel ${isCurrent ? "current" : ""}" data-model-space-id="${space.id}">
            <div class="space-header">
              <button class="space-select-btn ${isCurrent ? "active" : ""}" type="button" data-model-space-select="${space.id}">
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
                        data-model-space-rename="${space.id}"
                      />
                    `
                }
              </button>

              <button
                class="substory-toggle-btn"
                type="button"
                data-model-space-toggle="${space.id}"
                aria-expanded="${space.expanded ? "true" : "false"}"
              >
                ${triangle}
              </button>
            </div>

            <div class="substory-list ${space.expanded ? "active" : ""}">
              <button
                class="substory-item active"
                type="button"
                data-model-space-select="${space.id}"
              >
                地形 + 建筑白模
              </button>
            </div>

            ${
              !space.readonly
                ? `
                  <div class="space-actions">
                    <button class="space-delete-btn" type="button" data-model-space-delete="${space.id}">删除空间</button>
                  </div>
                `
                : ""
            }
          </div>
        `;
      })
      .join("");
    
    modelSpaceListEl.classList.toggle("active", !!window.isModel3DSidebarExpanded);

    if (addModelSpaceBtnEl) {
      addModelSpaceBtnEl.style.display = !!window.isModel3DSidebarExpanded ? "" : "none";
    }
    
    bindModelSpaceListEvents();
  }

  function bindModelSpaceListEvents() {
    const modelPanels = document.querySelectorAll(".space-panel[data-model-space-id]");
    modelPanels.forEach((panel) => {
      panel.onclick = async (event) => {
        if (
          event.target.closest("[data-model-space-toggle]") ||
          event.target.closest("[data-model-space-delete]") ||
          event.target.closest(".space-title-input")
        ) {
          return;
        }

        const spaceId = panel.dataset.modelSpaceId;
        if (!spaceId) return;
        await switchModelSpace(spaceId);
      };
    });
    
    const selectButtons = document.querySelectorAll("[data-model-space-select]");
    selectButtons.forEach((button) => {
      button.onclick = async (event) => {
        if (event.target && event.target.matches(".space-title-input")) return;
        const spaceId = button.dataset.modelSpaceSelect;
        if (!spaceId) return;
        await switchModelSpace(spaceId);
      };
    });

    const toggleButtons = document.querySelectorAll("[data-model-space-toggle]");
    toggleButtons.forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const spaceId = button.dataset.modelSpaceToggle;
        const target = getModelSpaceById(spaceId);
        if (!target) return;
        target.expanded = !target.expanded;
        saveModelSpacesToStorage();
        renderModelSpaceList();
      };
    });

    const renameInputs = document.querySelectorAll("[data-model-space-rename]");
    renameInputs.forEach((input) => {
      input.onclick = (event) => event.stopPropagation();
      input.oninput = () => {
        const spaceId = input.dataset.modelSpaceRename;
        const target = getModelSpaceById(spaceId);
        if (!target || target.readonly) return;
        target.title = input.value.trim() || "3D复制版";
        saveModelSpacesToStorage();
        update3DStatusText();
      };
    });

    const deleteButtons = document.querySelectorAll("[data-model-space-delete]");
    deleteButtons.forEach((button) => {
      button.onclick = async (event) => {
        event.stopPropagation();
        const spaceId = button.dataset.modelSpaceDelete;
        if (!spaceId || isBaseModelSpace(spaceId)) return;

        const target = getModelSpaceById(spaceId);
        const title = target?.title || "该空间";
        const confirmed = window.confirm(`确定要删除 3D 空间“${title}”吗？`);
        if (!confirmed) return;

        modelSpaces = modelSpaces.filter((s) => s.id !== spaceId);

        if (!modelSpaces.some((s) => s.id === MODEL_BASE_SPACE_ID)) {
          modelSpaces.unshift(getDefaultModelSpaces()[0]);
        }

        if (currentModelSpaceId === spaceId) {
          currentModelSpaceId = MODEL_BASE_SPACE_ID;
        }

        currentInfoMode = "readonly";
        currentSelectedEntityCode = "";
        saveModelSpacesToStorage();
        renderModelSpaceList();

        await applyCurrent3DSpaceToScene();
        showEmpty3DInfo();
      };
    });
  }

  function createModelCopySpace() {
    const copyIndex = modelSpaces.filter((s) => !s.readonly).length + 1;

    const newSpace = {
      id: `model_copy_${Date.now()}`,
      title: `3D复制版 ${copyIndex}`,
      readonly: false,
      expanded: true
    };

    modelSpaces.push(newSpace);
    currentModelSpaceId = newSpace.id;
    currentInfoMode = "readonly";
    currentSelectedEntityCode = "";
    saveModelSpacesToStorage();
    renderModelSpaceList();
    applyCurrent3DSpaceToScene();
    showEmpty3DInfo();
  }

  async function switchModelSpace(spaceId) {
    currentModelSpaceId = spaceId;
    currentInfoMode = "readonly";
    currentSelectedEntityCode = "";
    saveModelSpacesToStorage();
    renderModelSpaceList();
    await applyCurrent3DSpaceToScene();
    showEmpty3DInfo();
  }

  async function fetchCurrentSpaceAllEdits() {
    const objectType = getModelEditNamespaceObjectType(currentModelSpaceId);
    if (!objectType || !supabaseClient) return [];

    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("object_code,data")
      .eq("object_type", objectType);

    if (error) {
      console.warn("读取当前 3D 空间编辑记录失败：", error);
      return [];
    }

    return data || [];
  }

  async function fetchSingle3DEdit(sourceCode) {
    const objectType = getModelEditNamespaceObjectType(currentModelSpaceId);
    if (!objectType || !supabaseClient || !sourceCode) return null;

    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("data")
      .eq("object_code", sourceCode)
      .eq("object_type", objectType)
      .maybeSingle();

    if (error) {
      console.warn("读取单个 3D 对象编辑数据失败：", error);
      return null;
    }

    return data?.data || null;
  }

  async function saveSingle3DEdit(sourceCode, payload) {
    const objectType = getModelEditNamespaceObjectType(currentModelSpaceId);
    if (!objectType) {
      throw new Error("村庄现状空间仅可读，不能保存。");
    }
    if (!supabaseClient) {
      throw new Error("当前未配置 Supabase。");
    }

    const { error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .upsert(
        [
          {
            object_code: sourceCode,
            object_type: objectType,
            data: payload,
            updated_at: new Date().toISOString()
          }
        ],
        { onConflict: "object_code,object_type" }
      );

    if (error) throw error;
  }

  function resetSceneToBaseHeights() {
    clearAllReplacementModels();

    entityMap.forEach((entity) => {
      if (!entity || !entity.polygon) return;

      const terrainHeight = Number.isFinite(entity.__terrainHeight) ? entity.__terrainHeight : 0;
      const baseHeight = Number.isFinite(entity.__baseHeight) ? entity.__baseHeight : DEFAULT_HEIGHT;

      entity.__buildingHeight = baseHeight;
      entity.polygon.height = terrainHeight;
      entity.polygon.extrudedHeight = terrainHeight + baseHeight;
      setEntityReplacementVisual(entity, false);
    });

    viewer?.scene.requestRender();
  }

  function applyHeightToEntity(entity, nextHeight) {
    if (!entity || !entity.polygon) return false;
    const terrainHeight = Number.isFinite(entity.__terrainHeight) ? entity.__terrainHeight : 0;
    const safeHeight = Number.isNaN(parseMaybeNumber(nextHeight))
      ? (Number.isFinite(entity.__baseHeight) ? entity.__baseHeight : DEFAULT_HEIGHT)
      : Math.max(1, parseMaybeNumber(nextHeight));

    entity.__buildingHeight = safeHeight;
    entity.polygon.height = terrainHeight;
    entity.polygon.extrudedHeight = terrainHeight + safeHeight;
    return true;
  }

  function clearAllReplacementModels() {
    if (!viewer) {
      replacementModelMap.clear();
      replacementRequestTokenMap.clear();
      return;
    }

    replacementModelMap.forEach((item) => {
      try {
        if (item?.primitive) {
          viewer.scene.primitives.remove(item.primitive);
          if (typeof item.primitive.destroy === "function" && !item.primitive.isDestroyed?.()) {
            try { item.primitive.destroy(); } catch (_) {}
          }
        }
        if (item?.pointEntity) {
          viewer.entities.remove(item.pointEntity);
        }
      } catch (error) {
        console.warn("移除替换模型失败：", error);
      }
    });

    replacementModelMap.clear();
    replacementRequestTokenMap.clear();

    entityMap.forEach((entity) => {
      if (!entity || !entity.polygon) return;
      entity.show = true;
    });

    refreshAllEntityVisualStates();
    refreshReplacementAnchorVisibility();
    viewer.scene.requestRender();
  }

  function removeReplacementModel(sourceCode) {
    const key = normalizeCode(sourceCode);

    // 让这个 key 之前所有未完成的异步加载都失效
    replacementRequestTokenMap.set(key, Symbol(`cancel_${key}`));

    const existing = replacementModelMap.get(key);

    if (existing && viewer) {
      try {
        if (existing.primitive) {
          viewer.scene.primitives.remove(existing.primitive);
          if (typeof existing.primitive.destroy === "function" && !existing.primitive.isDestroyed?.()) {
            try { existing.primitive.destroy(); } catch (_) {}
          }
        }
        if (existing.pointEntity) {
          viewer.entities.remove(existing.pointEntity);
        }
      } catch (error) {
        console.warn("删除替换模型失败：", error);
      }
    }

    replacementModelMap.delete(key);

    refreshAllEntityVisualStates();
    refreshReplacementAnchorVisibility();
    viewer?.scene.requestRender();
  }

  function refreshReplacementAnchorVisibility() {
    replacementModelMap.forEach((item) => {
      if (item?.pointEntity) {
        item.pointEntity.show = !!showReplacementAnchor;
      }
    });
    viewer?.scene.requestRender();
  }

  function getAdaptiveLift(entity, modelState = {}) {
    const buildingHeight = Number.isFinite(entity?.__buildingHeight) ? entity.__buildingHeight : DEFAULT_HEIGHT;
    const manualOffset = toFiniteNumber(modelState.modelHeightOffset, 8);

    // 给一个更稳的抬升：至少 6m，再叠加白模高度的 0.35 倍
    // 这样很多“原点在中心”的 glb 也更容易先看见
    const autoLift = Math.max(6, buildingHeight * 0.35);

    return autoLift + manualOffset;
  }

  function getModelEntityPosition(entity, modelState = {}) {
    const center = getEntityCenterCartographic(entity);
    if (!center) return null;

    const terrainHeight = Number.isFinite(entity?.__terrainHeight) ? entity.__terrainHeight : 0;
    const heightOffset = toFiniteNumber(modelState.modelHeightOffset, 0);

    return Cesium.Cartesian3.fromRadians(
      center.longitude,
      center.latitude,
      terrainHeight + heightOffset
    );
  }

  function applyLocalOffsetToMatrix(matrix, offsetX, offsetY, offsetZ) {
    const translation = new Cesium.Cartesian3(
      toFiniteNumber(offsetX, 0),
      toFiniteNumber(offsetY, 0),
      toFiniteNumber(offsetZ, 0)
    );

    const result = Cesium.Matrix4.clone(matrix, new Cesium.Matrix4());
    Cesium.Matrix4.multiplyByTranslation(result, translation, result);
    return result;
  }

  async function addOrUpdateReplacementModel(entity, modelState = {}) {
    if (!viewer || !entity) return false;

    const key = normalizeCode(entity.__sourceCode || "");
    if (!key) return false;

    const modelUrl = modelState.modelUrl || "";
    if (!modelUrl) {
      removeReplacementModel(key);
      return false;
    }

    // 先删除当前场景里已有的模型
    removeReplacementModel(key);

    // 为这一次“种房子”生成唯一 token
    const requestToken = Symbol(`request_${key}_${Date.now()}`);
    replacementRequestTokenMap.set(key, requestToken);

    const anchorPosition = getModelEntityPosition(entity, modelState);
    if (!anchorPosition) return false;

    const uiScale = Math.max(0.1, toFiniteNumber(modelState.modelScale, 1));
    const actualScale = uiScale * MODEL_SCALE_BASE;
    const headingDeg = toFiniteNumber(modelState.modelHeading, 0);
    const heading = Cesium.Math.toRadians(headingDeg);

    const offsetX = toFiniteNumber(modelState.modelOffsetX, 0);
    const offsetY = toFiniteNumber(modelState.modelOffsetY, 0);

    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
    let modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(
      anchorPosition,
      hpr
    );

    modelMatrix = applyLocalOffsetToMatrix(modelMatrix, offsetX, offsetY, 0);

    // 先创建红点锚点
    const pointEntity = viewer.entities.add({
      position: anchorPosition,
      show: showReplacementAnchor,
      point: {
        pixelSize: 8,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    pointEntity.__isReplacementAnchor = true;
    pointEntity.__sourceCode = key;

    try {
      const uiScale = Math.max(0.1, toFiniteNumber(modelState.modelScale, 1));
      const actualScale = uiScale * MODEL_SCALE_BASE;

      const primitive = await Cesium.Model.fromGltfAsync({
        url: modelUrl,
        modelMatrix,
        scale: actualScale,
        minimumPixelSize: 0,
        maximumScale: undefined,
        incrementallyLoadTextures: true,
        runAnimations: true
      });

      // 如果这个 primitive 返回时，已经不是当前最新请求了，就直接丢弃
      if (replacementRequestTokenMap.get(key) !== requestToken) {
        try {
          if (pointEntity) viewer.entities.remove(pointEntity);
        } catch (_) {}

        try {
          if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) {
            primitive.destroy();
          }
        } catch (_) {}

        console.log("旧模型请求已丢弃：", key);
        return false;
      }

      primitive.__isReplacementModel = true;
      primitive.__sourceCode = key;

      viewer.scene.primitives.add(primitive);

      primitive.readyEvent.addEventListener(() => {
        try {
          // 再次确认它仍然是当前最新请求
          if (replacementRequestTokenMap.get(key) !== requestToken) {
            try {
              viewer.scene.primitives.remove(primitive);
              if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) {
                primitive.destroy();
              }
            } catch (_) {}
            return;
          }

          primitive.debugShowBoundingVolume = false;
          primitive.silhouetteColor = Cesium.Color.YELLOW;
          primitive.silhouetteSize = 1.0;

          console.log("GLB 已成功加载（仅保留最新一次）：", modelUrl);
          viewer.scene.requestRender();
        } catch (err) {
          console.error("模型加载后处理失败：", err);
          viewer.scene.requestRender();
        }
      });

      primitive.errorEvent.addEventListener((error) => {
        console.error("GLB 加载失败：", modelUrl, error);
      });

      replacementModelMap.set(key, {
        primitive,
        pointEntity
      });

      refreshAllEntityVisualStates();
      refreshReplacementAnchorVisibility();
      viewer.scene.requestRender();

      return true;
    } catch (error) {
      console.error("Cesium.Model.fromGltfAsync 加载失败：", modelUrl, error);

      // 只有当前 token 仍有效时，才保留这个红点状态
      if (replacementRequestTokenMap.get(key) === requestToken) {
        replacementModelMap.set(key, {
          primitive: null,
          pointEntity
        });

        setEntityReplacementVisual(entity, true);
        viewer.scene.requestRender();
      } else {
        try {
          if (pointEntity) viewer.entities.remove(pointEntity);
        } catch (_) {}
      }

      return false;
    }
  }

  async function applyModelStateToEntity(entity, row) {
    if (!entity) return;

    const modelState = getModelStateFromRow(row);
    if (modelState.modelUrl) {
      await addOrUpdateReplacementModel(entity, modelState);
    } else {
      removeReplacementModel(entity.__sourceCode || "");
    }
  }

  async function applyCurrent3DSpaceToScene() {
    resetSceneToBaseHeights();

    if (isBaseModelSpace(currentModelSpaceId)) {
      update3DStatusText();
      viewer?.scene.requestRender();
      return;
    }

    const edits = await fetchCurrentSpaceAllEdits();
    for (const item of edits) {
      const code = normalizeCode(item.object_code);
      const entity = entityMap.get(code);
      if (!entity) continue;

      const data = item.data || {};
      const nextHeight = data["建筑高度"] ?? data["房屋高度"] ?? data.height;
      if (nextHeight !== undefined && nextHeight !== null && String(nextHeight).trim() !== "") {
        applyHeightToEntity(entity, nextHeight);
      }

      await applyModelStateToEntity(entity, data);
    }

    update3DStatusText();
    viewer?.scene.requestRender();
  }

  async function loadBuildings() {
    if (!viewer) return;

    if (buildingsDataSource) {
      viewer.dataSources.remove(buildingsDataSource, true);
      buildingsDataSource = null;
      entityMap.clear();
      clearActiveEntity();
    }

    await loadCSVRows();

    buildingsDataSource = await Cesium.GeoJsonDataSource.load(GEOJSON_URL, {
      clampToGround: false
    });

    viewer.dataSources.add(buildingsDataSource);

    const entities = buildingsDataSource.entities.values.filter((entity) => entity.polygon);

    entities.forEach((entity) => {
      const sourceCode = getEntitySourceCode(entity);
      const displayName = getEntityDisplayName(entity, sourceCode);

      entity.__sourceCode = sourceCode;
      entity.__displayName = displayName;
      setEntityDefaultStyle(entity);

      const key = normalizeCode(sourceCode);
      if (key) entityMap.set(key, entity);
    });

    await applyTerrainHeights(entities);
    await applyCurrent3DSpaceToScene();

    if (entities.length) {
      await viewer.zoomTo(buildingsDataSource, new Cesium.HeadingPitchRange(0, -0.55, 450));
    }
  }

  function getBaseRowForEntity(entity) {
    const code = normalizeCode(entity?.__sourceCode || "");
    return rowMap.get(code) || null;
  }

  function buildBase3DRow(entity) {
    const sourceCode = entity?.__sourceCode || "";
    const displayName = entity?.__displayName || sourceCode || "未命名建筑";
    const baseRow = getBaseRowForEntity(entity) || {};
    const props = entityPropertiesToPlainObject(entity);
    const baseHeight = Number.isFinite(entity?.__buildingHeight) ? entity.__buildingHeight : readBuildingHeightFromObject(baseRow || props);

    return {
      "房屋编码": pickFirstValue(baseRow, CODE_FIELDS) || sourceCode || "",
      "房屋名称": pickFirstValue(baseRow, NAME_FIELDS) || displayName || "",
      "建成年代": pickFirstValue(baseRow, YEAR_FIELDS) || "",
      "建筑高度": baseHeight,
      "房屋功能信息": pickFirstValue(baseRow, FUNCTION_FIELDS) || "",
      "房屋结构信息": pickFirstValue(baseRow, STRUCTURE_FIELDS) || "",
      "占地面积": pickFirstValue(baseRow, AREA_FIELDS) || "",
      "户主信息": pickFirstValue(baseRow, OWNER_FIELDS) || "",
      modelPreset: "",
      modelUrl: "",
      modelScale: "",
      modelHeading: "",
      modelHeightOffset: "",
      modelOffsetX: "",
      modelOffsetY: ""
    };
  }

  function mergeRow(baseRow, editData) {
    return { ...(baseRow || {}), ...(editData || {}) };
  }

  function buildReadOnlyHtml(row) {
    return MODEL_EDITABLE_FIELDS.map((field) => {
      const value = row?.[field.key] ?? "";
      return `
        <div class="house-row">
          <span class="house-label">${escapeHtml(field.label)}：</span>${escapeHtml(value === "" ? "-" : value)}
        </div>
      `;
    }).join("");
  }

  function buildEditFormHtml(row) {
    return `
      <form id="model3dEditForm" class="building-edit-form">
        ${MODEL_EDITABLE_FIELDS.map((field) => {
          const value = row?.[field.key] ?? "";
          const type = field.type === "number" ? "number" : "text";
          return `
            <label class="form-row">
              <span class="form-label">${escapeHtml(field.label)}</span>
              <span class="form-input-wrap">
                <input
                  class="form-input"
                  name="${escapeHtml(field.key)}"
                  type="${type}"
                  step="${field.step || ""}"
                  value="${escapeHtml(value)}"
                />
                ${field.suffix ? `<span class="form-suffix">${escapeHtml(field.suffix)}</span>` : ""}
              </span>
            </label>
          `;
        }).join("")}
      </form>
    `;
  }

  function buildModeSwitchHtml(allowEdit) {
    if (!allowEdit) {
      return `
        <div class="mode-switch-card">
          <div class="mode-switch-header">
            <div class="mode-switch-title">信息模式</div>
            <div class="mode-switch-pill">
              <button type="button" class="mode-switch-btn active" disabled>只读模式</button>
            </div>
          </div>
          <div class="mode-switch-tip">当前为“村庄现状”空间，仅可查看，不能编辑。</div>
        </div>
      `;
    }

    return `
      <div class="mode-switch-card">
        <div class="mode-switch-header">
          <div class="mode-switch-title">信息模式</div>
          <div class="mode-switch-pill">
            <button type="button" class="mode-switch-btn ${currentInfoMode === "readonly" ? "active" : ""}" data-model-mode="readonly">只读模式</button>
            <button type="button" class="mode-switch-btn ${currentInfoMode === "edit" ? "active" : ""}" data-model-mode="edit">编辑模式</button>
          </div>
        </div>
        <div class="mode-switch-tip">当前为 3D 复制版空间，保存后只会影响本 3D 空间，不会覆盖村庄现状。</div>
      </div>
    `;
  }

  function buildModelReplaceCardHtml(row, allowEdit) {
    const modelState = getModelStateFromRow(row);
    const currentPreset = getModelPresetById(modelState.modelPreset);

    return `
      <div class="info-card">
        <h3 class="house-title">种房子</h3>
        ${
          allowEdit
            ? `
              <label class="form-row">
                <span class="form-label">预设模型</span>
                <span class="form-input-wrap">
                  <select id="modelPresetSelect" class="form-input">
                    <option value="">请选择模型</option>
                    ${MODEL_PRESETS.map((preset) => `
                      <option value="${escapeHtml(preset.id)}" ${preset.id === modelState.modelPreset ? "selected" : ""}>
                        ${escapeHtml(preset.name)}
                      </option>
                    `).join("")}
                  </select>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">模型缩放</span>
                <span class="form-input-wrap">
                  <input id="modelScaleInput" class="form-input" type="number" step="0.01" value="${escapeHtml(String(modelState.modelScale || 1))}" />
                  <span class="form-suffix">倍</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">缩放滑条</span>
                <span class="form-input-wrap">
                  <input id="modelScaleRange" class="form-input" type="range" min="0.1" max="120" step="0.01" value="${escapeHtml(String(modelState.modelScale || 1))}" />
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">旋转角度</span>
                <span class="form-input-wrap">
                  <input id="modelHeadingInput" class="form-input" type="number" step="1" value="${escapeHtml(String(modelState.modelHeading || 0))}" />
                  <span class="form-suffix">°</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">抬高偏移</span>
                <span class="form-input-wrap">
                  <input id="modelHeightOffsetInput" class="form-input" type="number" step="0.1" value="${escapeHtml(String(modelState.modelHeightOffset || 0))}" />
                  <span class="form-suffix">m</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">东西偏移</span>
                <span class="form-input-wrap">
                  <input id="modelOffsetXInput" class="form-input" type="number" step="0.1" value="${escapeHtml(String(modelState.modelOffsetX || 0))}" />
                  <span class="form-suffix">m</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">南北偏移</span>
                <span class="form-input-wrap">
                  <input id="modelOffsetYInput" class="form-input" type="number" step="0.1" value="${escapeHtml(String(modelState.modelOffsetY || 0))}" />
                  <span class="form-suffix">m</span>
                </span>
              </label>

              <div class="edit-actions" style="margin-top:10px;">
                <button id="applyModelPresetBtn" class="upload-btn" type="button">种上该模型</button>
                <button id="removeModelPresetBtn" class="upload-btn secondary-btn" type="button">恢复白模</button>
              </div>

              <label class="form-row" style="margin-top:8px;">
                <span class="form-label">显示蓝色白模</span>
                <span class="form-input-wrap" style="justify-content:flex-start;">
                  <input id="toggleReplacementBase" type="checkbox" ${showReplacementBase ? "checked" : ""} />
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">显示红点锚点</span>
                <span class="form-input-wrap" style="justify-content:flex-start;">
                  <input id="toggleReplacementAnchor" type="checkbox" ${showReplacementAnchor ? "checked" : ""} />
                </span>
              </label>

              <div id="applyModelPresetStatus" class="save-status"></div>
            `
            : `
              <div class="house-row">当前为只读空间，不能种房子。</div>
            `
        }

        <div class="house-row">当前状态：${escapeHtml(currentPreset ? `已替换为 ${currentPreset.name}` : "白模")}</div>
        ${modelState.modelUrl ? `<div class="house-row">模型路径：${escapeHtml(modelState.modelUrl)}</div>` : ""}
        <div class="house-row">微调建议：先调“抬高偏移”，再调“东西偏移 / 南北偏移”，最后再微调缩放。</div>
      </div>
    `;
  }

  function collect3DFormData() {
    const form = byId("model3dEditForm");
    if (!form) return null;

    const formData = new FormData(form);
    const payload = {};

    MODEL_EDITABLE_FIELDS.forEach((field) => {
      let value = formData.get(field.key);
      if (typeof value === "string") value = value.trim();
      payload[field.key] = value || "";
    });

    return payload;
  }

  function update3DStatusText() {
    const statusBadge = getStatusBadge();
    const detailSubtitle = getDetailSubtitle();
    const currentSpace = getCurrentModelSpace();

    if (statusBadge) {
      if (currentSelectedEntityCode && activeEntity) {
        const name = activeEntity.__displayName || activeEntity.__sourceCode || "未命名建筑";
        statusBadge.textContent = `当前模式：村庄 3D 模型｜空间：${currentSpace?.title || "村庄现状"}｜已选建筑：${name}`;
      } else {
        statusBadge.textContent = `当前模式：村庄 3D 模型｜空间：${currentSpace?.title || "村庄现状"}`;
      }
    }

    if (detailSubtitle) {
      if (currentSelectedEntityCode && activeEntity) {
        const name = activeEntity.__displayName || activeEntity.__sourceCode || "未命名建筑";
        detailSubtitle.textContent = `当前查看：3D建筑 - ${name}`;
      } else {
        detailSubtitle.textContent = "当前显示起伏地形与可点击单体白模";
      }
    }
  }

  async function showEntityInfo(entity, options = {}) {
    const infoPanel = getInfoPanel();
    if (!infoPanel || !entity) return;

    const sourceCode = entity.__sourceCode || "";
    const currentSpace = getCurrentModelSpace();
    const allowEdit = !currentSpace.readonly;

    const baseRow = buildBase3DRow(entity);
    const editData = allowEdit ? await fetchSingle3DEdit(sourceCode) : null;
    const mergedRow = mergeRow(baseRow, editData);

    currentSelectedEntityCode = sourceCode;
    update3DStatusText();

    infoPanel.classList.remove("empty");
    infoPanel.innerHTML = `
      ${buildModeSwitchHtml(allowEdit)}

      <div class="info-card">
        <h3 class="house-title">${escapeHtml(mergedRow["房屋名称"] || entity.__displayName || sourceCode || "未命名建筑")}</h3>
        ${currentInfoMode === "edit" && allowEdit ? buildEditFormHtml(mergedRow) : buildReadOnlyHtml(mergedRow)}

        ${
          currentInfoMode === "edit" && allowEdit
            ? `
              <div class="edit-actions">
                <button id="saveModel3DBtn" class="upload-btn" type="button">保存修改</button>
                <div id="saveModel3DStatus" class="save-status">${options.flashSaved ? "保存成功。" : ""}</div>
              </div>
            `
            : options.flashSaved
              ? `<div class="save-status success-inline">已显示本 3D 复制版的最新保存版本。</div>`
              : ""
        }
      </div>

      ${buildModelReplaceCardHtml(mergedRow, allowEdit)}

      <div class="info-card">
        <h3 class="house-title">3D 模型说明</h3>
        <div class="house-row">当前空间：${escapeHtml(currentSpace.title)}</div>
        <div class="house-row">地形高程：${escapeHtml((entity.__terrainHeight ?? 0).toFixed(2))} m</div>
        <div class="house-row">当前挤出高度：${escapeHtml(String(entity.__buildingHeight ?? DEFAULT_HEIGHT))} m</div>
      </div>
    `;

    bindEntityInfoEvents(entity, baseRow);
  }

  function bindEntityInfoEvents(entity, baseRow) {
    const modeButtons = document.querySelectorAll("[data-model-mode]");
    modeButtons.forEach((button) => {
      button.onclick = async () => {
        const nextMode = button.dataset.modelMode;
        if (!nextMode || nextMode === currentInfoMode) return;
        currentInfoMode = nextMode;
        await showEntityInfo(entity);
      };
    });

    const saveBtn = byId("saveModel3DBtn");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const saveStatus = byId("saveModel3DStatus");
        const payload = collect3DFormData();
        if (!payload) return;

        const existingEditData = !isBaseModelSpace(currentModelSpaceId)
          ? (await fetchSingle3DEdit(entity.__sourceCode)) || {}
          : {};

        if (!payload["房屋编码"]) {
          if (saveStatus) saveStatus.textContent = "房屋编码不能为空。";
          return;
        }

        saveBtn.disabled = true;
        if (saveStatus) saveStatus.textContent = "正在保存...";

        try {
          const finalPayload = { ...existingEditData, ...payload };
          await saveSingle3DEdit(entity.__sourceCode, finalPayload);

          const newHeight = finalPayload["建筑高度"];
          if (newHeight !== undefined && newHeight !== null && String(newHeight).trim() !== "") {
            applyHeightToEntity(entity, newHeight);
            viewer?.scene.requestRender();
          }

          await applyModelStateToEntity(entity, finalPayload);

          currentInfoMode = "readonly";
          await showEntityInfo(entity, { flashSaved: true });
        } catch (error) {
          console.error("保存 3D 建筑属性失败：", error);
          if (saveStatus) saveStatus.textContent = `保存失败：${error.message}`;
        } finally {
          saveBtn.disabled = false;
        }
      };
    }

    const applyModelBtn = byId("applyModelPresetBtn");
    if (applyModelBtn) {
      applyModelBtn.onclick = async () => {
        const statusEl = byId("applyModelPresetStatus");
        const selectEl = byId("modelPresetSelect");
        const scaleEl = byId("modelScaleInput");
        const scaleRangeEl = byId("modelScaleRange");
        const headingEl = byId("modelHeadingInput");
        const offsetEl = byId("modelHeightOffsetInput");
        const offsetXEl = byId("modelOffsetXInput");
        const offsetYEl = byId("modelOffsetYInput");

        const presetId = selectEl?.value || "";
        if (!presetId) {
          if (statusEl) statusEl.textContent = "请先选择一个预设模型。";
          return;
        }

        const scaleValue = scaleEl?.value ?? scaleRangeEl?.value;
        const manualScale = clampNumber(scaleValue, 0.1, 120, 1);
        const manualHeading = clampNumber(headingEl?.value, -360, 360, 0);
        const manualOffset = clampNumber(offsetEl?.value, -100, 300, 0);
        const manualOffsetX = clampNumber(offsetXEl?.value, -200, 200, 0);
        const manualOffsetY = clampNumber(offsetYEl?.value, -200, 200, 0);

        applyModelBtn.disabled = true;
        if (statusEl) statusEl.textContent = "正在种房子...";

        try {
          const existingEditData = !isBaseModelSpace(currentModelSpaceId)
            ? (await fetchSingle3DEdit(entity.__sourceCode)) || {}
            : {};
          const baseMerged = { ...(baseRow || {}), ...existingEditData };

          const payload = buildModelPayloadPatchFromPreset(
            presetId,
            baseMerged,
            {
              modelScale: manualScale,
              modelHeading: manualHeading,
              modelHeightOffset: manualOffset,
              modelOffsetX: manualOffsetX,
              modelOffsetY: manualOffsetY
            }
          );

          await saveSingle3DEdit(entity.__sourceCode, payload);
          await applyModelStateToEntity(entity, payload);

          if (statusEl) statusEl.textContent = "已替换为预设模型。";
          await showEntityInfo(entity, { flashSaved: true });
        } catch (error) {
          console.error("种房子失败：", error);
          if (statusEl) statusEl.textContent = `操作失败：${error.message}`;
        } finally {
          applyModelBtn.disabled = false;
        }
      };
    }

    const removeModelBtn = byId("removeModelPresetBtn");
    if (removeModelBtn) {
      removeModelBtn.onclick = async () => {
        const statusEl = byId("applyModelPresetStatus");
        removeModelBtn.disabled = true;
        if (statusEl) statusEl.textContent = "正在恢复白模...";

        try {
          const existingEditData = !isBaseModelSpace(currentModelSpaceId)
            ? (await fetchSingle3DEdit(entity.__sourceCode)) || {}
            : {};
          const baseMerged = { ...(baseRow || {}), ...existingEditData };
          const payload = buildModelPayloadPatchFromPreset("", baseMerged);

          await saveSingle3DEdit(entity.__sourceCode, payload);
          removeReplacementModel(entity.__sourceCode);

          if (statusEl) statusEl.textContent = "已恢复为白模。";
          await showEntityInfo(entity, { flashSaved: true });
        } catch (error) {
          console.error("恢复白模失败：", error);
          if (statusEl) statusEl.textContent = `操作失败：${error.message}`;
        } finally {
          removeModelBtn.disabled = false;
        }
      };
    }

    const scaleInput = byId("modelScaleInput");
    const scaleRange = byId("modelScaleRange");

    if (scaleInput && scaleRange) {
      scaleInput.oninput = () => {
        scaleRange.value = scaleInput.value || "1";
      };
      scaleRange.oninput = () => {
        scaleInput.value = scaleRange.value || "1";
      };
    }
    const replacementBaseToggle = byId("toggleReplacementBase");
    if (replacementBaseToggle) {
      replacementBaseToggle.onchange = () => {
        showReplacementBase = !!replacementBaseToggle.checked;
        refreshAllEntityVisualStates();
      };
    }

    const replacementAnchorToggle = byId("toggleReplacementAnchor");
    if (replacementAnchorToggle) {
      replacementAnchorToggle.onchange = () => {
        showReplacementAnchor = !!replacementAnchorToggle.checked;
        refreshReplacementAnchorVisibility();
      };
    }
  }

  function showEmpty3DInfo() {
    const infoPanel = getInfoPanel();
    if (!infoPanel) return;

    const currentSpace = getCurrentModelSpace();
    currentSelectedEntityCode = "";
    update3DStatusText();

    infoPanel.classList.remove("empty");
    infoPanel.innerHTML = `
      <div class="placeholder-block">
        <h3>村庄 3D 模型</h3>
        <p>当前空间：${escapeHtml(currentSpace.title)}</p>
        <p>当前已加载起伏地形与单体建筑白模。</p>
        <p>点击任意建筑，可在右侧查看或编辑该建筑属性。</p>
        ${currentSpace.readonly ? "<p>当前为空间“村庄现状”，仅可读。</p>" : "<p>当前为空间复制版，可切换到编辑模式保存属性。</p>"}
      </div>
    `;
  }

  function bindClickEvents() {
    if (!viewer) return;

    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }

    clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    clickHandler.setInputAction(async (movement) => {
      const picked = viewer.scene.pick(movement.position);

      if (!Cesium.defined(picked)) {
        clearActiveEntity();
        showEmpty3DInfo();
        viewer.scene.requestRender();
        return;
      }

      let entity = null;

      // 1. 点到普通 entity（白模、多边形、红点等）
      if (picked.id) {
        if (picked.id.__isReplacementAnchor) {
          entity = entityMap.get(normalizeCode(picked.id.__sourceCode || "")) || null;
        } else if (picked.id.polygon) {
          entity = picked.id;
        }
      }

      // 2. 点到 glb primitive
      if (!entity && picked.primitive && picked.primitive.__isReplacementModel) {
        entity = entityMap.get(normalizeCode(picked.primitive.__sourceCode || "")) || null;
      }

      if (!entity || !entity.polygon) {
        clearActiveEntity();
        showEmpty3DInfo();
        viewer.scene.requestRender();
        return;
      }

      setActiveEntity(entity);
      await showEntityInfo(entity);
      viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  async function initViewer() {
    if (initialized) return;

    if (typeof Cesium === "undefined") {
      throw new Error("未检测到 Cesium，请先在 index.html 中引入 Cesium.js。");
    }

    if (!byId("cesiumContainer")) {
      throw new Error("未找到 #cesiumContainer，请检查 index.html 中的 3D 容器。");
    }

    if (!window.CESIUM_ION_TOKEN || String(window.CESIUM_ION_TOKEN).includes("你的")) {
      throw new Error("未配置 Cesium ion token。请先设置 window.CESIUM_ION_TOKEN。");
    }

    Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;

    viewer = new Cesium.Viewer("cesiumContainer", {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      shouldAnimate: false,
      terrainProvider: await Cesium.createWorldTerrainAsync()
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.requestRenderMode = false;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

    if (viewer.cesiumWidget && viewer.cesiumWidget.creditContainer) {
      viewer.cesiumWidget.creditContainer.style.display = "none";
    }

    bindClickEvents();
    initialized = true;
  }

  async function enter() {
    ensure3DSpaceUI();

    if (!modelSpaces.length) {
      modelSpaces = loadModelSpacesFromStorage();
      currentModelSpaceId = modelSpaces[0]?.id || MODEL_BASE_SPACE_ID;
      renderModelSpaceList();
    }

    await initViewer();

    if (!buildingsDataSource) {
      await loadBuildings();
    } else {
      await applyCurrent3DSpaceToScene();
    }

    setTimeout(() => {
      if (viewer) {
        viewer.resize();
        viewer.scene.requestRender();
      }
    }, 60);

    update3DStatusText();

    if (!activeEntity) {
      showEmpty3DInfo();
    } else {
      await showEntityInfo(activeEntity);
    }
  }

  async function reload() {
    if (!initialized) {
      await enter();
      return;
    }

    await loadBuildings();
    showEmpty3DInfo();
    viewer.scene.requestRender();
  }

  function flyToBuilding(sourceCode) {
    const entity = entityMap.get(normalizeCode(sourceCode));
    if (!viewer || !entity) return false;

    viewer.flyTo(entity, {
      duration: 1.2,
      offset: new Cesium.HeadingPitchRange(0, -0.45, 120)
    });

    return true;
  }

  function refreshBuildingHeight(sourceCode, nextHeight) {
    const entity = entityMap.get(normalizeCode(sourceCode));
    if (!entity || !entity.polygon) return false;

    applyHeightToEntity(entity, nextHeight);
    viewer?.scene.requestRender();
    return true;
  }

  function destroy() {
    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }

    clearAllReplacementModels();

    if (viewer) {
      viewer.destroy();
      viewer = null;
    }

    initialized = false;
    buildingsDataSource = null;
    clearActiveEntity();
    entityMap.clear();
    currentSelectedEntityCode = "";
  }

  function initModelSpaces() {
    modelSpaces = loadModelSpacesFromStorage();
    currentModelSpaceId = modelSpaces[0]?.id || MODEL_BASE_SPACE_ID;
    ensure3DSpaceUI();
    renderModelSpaceList();
  }

  initModelSpaces();

  window.Village3D = {
    enter,
    reload,
    flyToBuilding,
    refreshBuildingHeight,
    destroy
  };
})();