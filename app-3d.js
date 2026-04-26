(function () {
  const GEOJSON_URL = "data/buildings.geojson";
  const ROAD_GEOJSON_URL = "data/roads.geojson";
  const CSV_URL = "data/houses.csv";

  const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";
  const OBJECT_EDITS_TABLE = "object_attribute_edits";
  const PLANNING_FEATURES_TABLE = "planning_features";

  const MODEL_BASE_SPACE_ID = "current_3d";
  const MODEL_BASE_OBJECT_TYPE = "building_3d";

  const CODE_FIELDS = ["房屋编码", "编码", "CODE", "Code", "code", "ID", "id", "NAME", "Name", "name"];
  const NAME_FIELDS = ["房屋名称", "名称", "NAME", "Name", "name"];
  const YEAR_FIELDS = ["建成年代", "年代", "year", "YEAR", "Year"];
  const AREA_FIELDS = ["占地面积", "面积", "建筑面积", "area", "AREA", "Area"];
  const FUNCTION_FIELDS = ["房屋功能信息", "房屋功能", "功能", "function", "FUNCTION"];
  const STRUCTURE_FIELDS = ["房屋结构信息", "房屋结构", "结构", "structure", "STRUCTURE"];
  const OWNER_FIELDS = ["户主信息", "户主", "owner", "OWNER", "Owner"];
  const HEIGHT_FIELDS = ["建筑高度", "房屋高度", "height", "HEIGHT", "Height", "H", "h", "floors", "楼层", "层数"];

  const DEFAULT_HEIGHT = 9;

  const MODEL_EDITABLE_FIELDS = [
    { key: "房屋编码", label: "房屋编码", type: "text" },
    { key: "户主信息", label: "户主信息", type: "text" },
    { key: "建成年代", label: "建成年代", type: "text" },
    { key: "房屋结构信息", label: "房屋结构", type: "text" },
    { key: "占地面积", label: "占地面积", type: "number", step: "0.01", suffix: "㎡" },
    { key: "建筑高度", label: "建筑高度", type: "number", step: "0.01", suffix: "m" }
  ];

  const MODEL_SCALE_BASE = 0.1;
  const HOUSE_GENERATOR_MESSAGE_TYPE = "village-house-generator:model-ready";
  const HOUSE_GENERATOR_DEFAULT_SCALE = 10;

  const MODEL_PRESETS = [
    { id: "house_type_a", name: "传统祠堂-01", url: "assets/models/house_type_a.glb", scale: 120, heading: 0, heightOffset: 6.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_b", name: "一层现代住宅-01", url: "assets/models/house_type_b.glb", scale: 1, heading: 0, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_c", name: "二层现代住宅-01", url: "assets/models/house_type_c.glb", scale: 1, heading: 0, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_d", name: "三层现代住宅-01", url: "assets/models/house_type_d.glb", scale: 1, heading: 0, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 },
    { id: "house_type_e", name: "四层现代住宅-01", url: "assets/models/house_type_e.glb", scale: 1, heading: 0, heightOffset: 0.0, offsetX: 0.0, offsetY: 0.0 }
  ];

  const BASE_COLOR = Cesium.Color.WHITE.withAlpha(0.92);
  const OUTLINE_COLOR = Cesium.Color.fromCssColorString("#c5ccd3");
  const ACTIVE_COLOR = Cesium.Color.fromCssColorString("#90caf9").withAlpha(0.72);
  const ACTIVE_OUTLINE_COLOR = Cesium.Color.fromCssColorString("#1565c0");
  const REPLACED_BASE_COLOR = Cesium.Color.fromCssColorString("#90caf9").withAlpha(0.35);
  const REPLACED_OUTLINE_COLOR = Cesium.Color.fromCssColorString("#1565c0");

  // Initial 3D overview camera preset (global village view)
  const OVERVIEW_CAMERA_HEADING_DEG = 10;
  const OVERVIEW_CAMERA_PITCH_DEG = -52;
  const OVERVIEW_CAMERA_RANGE = 780;
  // 3D performance profile: keep interaction smooth on common laptops
  const PERF_TERRAIN_MAX_SCREEN_SPACE_ERROR = 6;
  const PERF_RESOLUTION_SCALE_CAP = 1.0;
  const ONLINE_RESOURCE_TIMEOUT_MS = 12000;

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
  let roadsDataSource = null;
  let roadEntitiesForWidthSync = [];
  let clickHandler = null;
  let roadWidthSyncRaf = 0;
  let roadsLoadTask = null;
  let roadsLoadToken = 0;
  const terrainHeightCache = new Map();

  let csvRows = [];
  let rowMap = new Map();
  let entityMap = new Map();
  let replacementModelMap = new Map();
  let replacementRequestTokenMap = new Map();
  let runtimeGeneratedModelStateMap = new Map();
  let runtimeGeneratedBlobUrlMap = new Map();
  let activeEntity = null;
  let houseGeneratorMessageBound = false;
  let houseGeneratorMessageHandler = null;

  let showReplacementBase = false;
  let showReplacementAnchor = false;

  let currentInfoMode = "readonly";
  let currentSelectedEntityCode = "";
  let measureModeActive = false;
  let measurePoints = [];
  let measurePointEntities = [];
  let measureLineEntity = null;
  let measureLabelEntity = null;

  function getBasemapGeoref() {
    const fallback = {
      imageUrl: "assets/orthophoto.png",
      minX: 113.65670800209045,
      minY: 23.67331624031067,
      maxX: 113.66360664367676,
      maxY: 23.67930293083191
    };

    const candidate = window.__BASEMAP_GEOREF;
    if (!candidate || typeof candidate !== "object") return fallback;

    const minX = Number(candidate.minX);
    const minY = Number(candidate.minY);
    const maxX = Number(candidate.maxX);
    const maxY = Number(candidate.maxY);
    if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return fallback;

    return {
      imageUrl: candidate.imageUrl || fallback.imageUrl,
      minX,
      minY,
      maxX,
      maxY
    };
  }

  function getLinked2DSpaceIdFor3D() {
    return window.__active2DSpaceId || "current";
  }

  function makeDbBuildingFeatureCollection(rows) {
    return {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: "Feature",
        properties: {
          房屋编码: row.object_code,
          房屋名称: row.object_name || row.object_code,
          ...(row.props || {})
        },
        geometry: row.geom
      }))
    };
  }

  function makeDbRoadFeatureCollection(rows) {
    const isRenderableRoadGeometry = (geometry) => {
      if (!geometry || typeof geometry !== "object") return false;
      const type = geometry.type;
      const coords = geometry.coordinates;
      if (!type || !Array.isArray(coords)) return false;
      if (type === "LineString") return coords.length >= 2;
      if (type === "MultiLineString") {
        return coords.some((line) => Array.isArray(line) && line.length >= 2);
      }
      if (type === "Polygon") {
        return coords.some((ring) => Array.isArray(ring) && ring.length >= 4);
      }
      if (type === "MultiPolygon") {
        return coords.some(
          (poly) => Array.isArray(poly) && poly.some((ring) => Array.isArray(ring) && ring.length >= 4)
        );
      }
      return false;
    };

    return {
      type: "FeatureCollection",
      features: rows
        .filter((row) => row && isRenderableRoadGeometry(row.geom))
        .map((row) => ({
          type: "Feature",
          properties: {
            道路编码: row.object_code,
            道路名称: row.object_name || row.object_code,
            ...(row.props || {})
          },
          geometry: row.geom
        }))
    };
  }

  function getRoadCodeFromFeatureLike(featureLike) {
    const props = featureLike?.properties || {};
    const code =
      props["道路编码"] ??
      props["ROAD_CODE"] ??
      props["road_code"] ??
      props["NAME"] ??
      props["name"] ??
      props["Code"] ??
      props["code"] ??
      "";
    return normalizeCode(code);
  }

  function getFeatureGeometryTypeStats(features) {
    const stats = {};
    (features || []).forEach((f) => {
      const type = f?.geometry?.type || "Unknown";
      stats[type] = (stats[type] || 0) + 1;
    });
    return stats;
  }

  async function list3DBuildingsFromDb() {
    if (!supabaseClient) return [];

    const linkedSpaceId = getLinked2DSpaceIdFor3D();

    const { data, error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .select("*")
      .eq("space_id", linkedSpaceId)
      .eq("layer_key", "building")
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("object_code", { ascending: true });

    if (error) {
      console.warn("3D 读取数据库建筑失败：", error);
      return [];
    }

    return data || [];
  }

  async function list3DRoadsFromDb() {
    if (!supabaseClient) return [];

    const linkedSpaceId = getLinked2DSpaceIdFor3D();

    const { data, error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .select("*")
      .eq("space_id", linkedSpaceId)
      .eq("layer_key", "road")
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("object_code", { ascending: true });

    if (error) {
      console.warn("3D 读取数据库道路失败：", error);
      return [];
    }

    return data || [];
  }

  async function hasAny3DBuildingRowsForSpace(spaceId) {
    if (!supabaseClient) return false;

    const { data, error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .select("id")
      .eq("space_id", spaceId)
      .eq("layer_key", "building")
      .or("is_deleted.is.null,is_deleted.eq.false")
      .limit(1);

    if (error) {
      console.warn("Failed to check whether 3D building rows are initialized:", error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  }

  async function hasAny3DRoadRowsForSpace(spaceId) {
    if (!supabaseClient) return false;

    const { data, error } = await supabaseClient
      .from(PLANNING_FEATURES_TABLE)
      .select("id")
      .eq("space_id", spaceId)
      .eq("layer_key", "road")
      .or("is_deleted.is.null,is_deleted.eq.false")
      .limit(1);

    if (error) {
      console.warn("Failed to check whether 3D road rows are initialized:", error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  }
  
  function byId(id) {
    return document.getElementById(id);
  }

  function formatDistanceText(distanceMeters) {
    const n = Number(distanceMeters);
    if (!Number.isFinite(n) || n <= 0) return "0 m";
    if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
    return `${n.toFixed(1)} m`;
  }

  function set3DMeasureReadout(message = "", visible = false) {
    const el = byId("measure3dReadout");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("show", !!visible);
  }

  function clear3DMeasureGraphics() {
    if (!viewer) return;

    measurePointEntities.forEach((entity) => {
      try {
        viewer.entities.remove(entity);
      } catch (_) {
      }
    });
    measurePointEntities = [];

    if (measureLineEntity) {
      try {
        viewer.entities.remove(measureLineEntity);
      } catch (_) {
      }
      measureLineEntity = null;
    }

    if (measureLabelEntity) {
      try {
        viewer.entities.remove(measureLabelEntity);
      } catch (_) {
      }
      measureLabelEntity = null;
    }
  }

  function getMeasurePickPosition(screenPosition) {
    if (!viewer || !screenPosition) return null;
    const scene = viewer.scene;

    let picked = null;
    if (scene.pickPositionSupported) {
      try {
        picked = scene.pickPosition(screenPosition);
      } catch (_) {
        picked = null;
      }
    }
    if (Cesium.defined(picked)) return picked;

    try {
      return viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
    } catch (_) {
      return null;
    }
  }

  function calc3DMeasureDistanceMeters(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Cesium.Cartesian3.distance(points[i - 1], points[i]);
    }
    return total;
  }

  function refresh3DMeasureEntities() {
    if (!viewer || measurePoints.length < 1) return;

    clear3DMeasureGraphics();

    measurePointEntities = measurePoints.map((p) => viewer.entities.add({
      position: p,
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString("#f59e0b"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    }));

    if (measurePoints.length >= 2) {
      measureLineEntity = viewer.entities.add({
        polyline: {
          positions: measurePoints.slice(),
          width: 3,
          material: Cesium.Color.fromCssColorString("#f59e0b"),
          clampToGround: false
        }
      });
    }

    const totalMeters = calc3DMeasureDistanceMeters(measurePoints);
    const latest = measurePoints[measurePoints.length - 1];
    measureLabelEntity = viewer.entities.add({
      position: latest,
      label: {
        text: `总长 ${formatDistanceText(totalMeters)}`,
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -26),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(31,53,82,0.8)")
      }
    });

    set3DMeasureReadout(`总长：${formatDistanceText(totalMeters)}`, true);
    viewer.scene.requestRender();
  }

  function handle3DMeasureClick(screenPosition) {
    const pos = getMeasurePickPosition(screenPosition);
    if (!pos) {
      set3DMeasureReadout("未获取到地面点，请重新点击", true);
      return;
    }
    measurePoints.push(pos);
    refresh3DMeasureEntities();
  }

  function toggleMeasureMode(force = null) {
    const next = force === null ? !measureModeActive : !!force;
    const btn = byId("measure3dBtn");

    if (!next) {
      measureModeActive = false;
      measurePoints = [];
      clear3DMeasureGraphics();
      set3DMeasureReadout("", false);
      btn?.classList.remove("is-active");
      viewer?.scene.requestRender();
      return false;
    }

    measureModeActive = true;
    measurePoints = [];
    clear3DMeasureGraphics();
    btn?.classList.add("is-active");
    set3DMeasureReadout("测量中：左键逐点，双击结束", true);
    viewer?.scene.requestRender();
    return true;
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

  function is3DViewActive() {
    const view = byId("model3dView");
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

  function makeRuntimeGeneratedModelKey(spaceId, sourceCode) {
    const normalizedSpaceId = String(spaceId || "current").trim() || "current";
    const normalizedCode = normalizeCode(sourceCode);
    return `${normalizedSpaceId}::${normalizedCode}`;
  }

  function revokeRuntimeGeneratedBlobUrlByKey(key) {
    const oldUrl = runtimeGeneratedBlobUrlMap.get(key);
    if (oldUrl && String(oldUrl).startsWith("blob:")) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch (_) {}
    }
    runtimeGeneratedBlobUrlMap.delete(key);
  }

  function clearRuntimeGeneratedModelState(spaceId, sourceCode) {
    const key = makeRuntimeGeneratedModelKey(spaceId, sourceCode);
    runtimeGeneratedModelStateMap.delete(key);
    revokeRuntimeGeneratedBlobUrlByKey(key);
  }

  function setRuntimeGeneratedModelState(spaceId, sourceCode, modelState) {
    const key = makeRuntimeGeneratedModelKey(spaceId, sourceCode);
    revokeRuntimeGeneratedBlobUrlByKey(key);
    if (!modelState) {
      runtimeGeneratedModelStateMap.delete(key);
      return;
    }

    runtimeGeneratedModelStateMap.set(key, modelState);
    const url = String(modelState.modelUrl || "");
    if (url.startsWith("blob:")) {
      runtimeGeneratedBlobUrlMap.set(key, url);
    }
  }

  function getRuntimeGeneratedModelState(spaceId, sourceCode) {
    const key = makeRuntimeGeneratedModelKey(spaceId, sourceCode);
    return runtimeGeneratedModelStateMap.get(key) || null;
  }

  function clearAllRuntimeGeneratedModels() {
    const keys = Array.from(runtimeGeneratedBlobUrlMap.keys());
    keys.forEach((key) => {
      revokeRuntimeGeneratedBlobUrlByKey(key);
    });
    runtimeGeneratedModelStateMap.clear();
  }

  function getRoadWidthFromEntity(entity) {
    const props = entityPropertiesToPlainObject(entity);
    const n = parseMaybeNumber(
      props["道路宽度"] ??
      props["width"] ??
      props["宽度"] ??
      props["WIDTH"] ??
      props["road_width"] ??
      props["閬撹矾瀹斤拷"] ??
      4
    );
    const widthMeters = Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 4;
    return widthMeters;
  }

  function getRoadMidpointCartesian(entity) {
    if (!entity?.polyline?.positions) return null;
    try {
      const positions = entity.polyline.positions.getValue(Cesium.JulianDate.now());
      if (!Array.isArray(positions) || positions.length < 2) return null;
      const midIndex = Math.floor(positions.length / 2);
      return positions[midIndex] || positions[0] || null;
    } catch (_) {
      return null;
    }
  }

  function update3DRoadPolylineWidths() {
    if (!viewer || !Array.isArray(roadEntitiesForWidthSync) || !roadEntitiesForWidthSync.length) return;

    const scene = viewer.scene;
    const w = scene?.drawingBufferWidth || 1920;
    const h = scene?.drawingBufferHeight || 1080;

    roadEntitiesForWidthSync.forEach((entity) => {
      if (!entity?.polyline) return;
      const widthMeters = Number(entity.__roadWidthMeters);
      if (!Number.isFinite(widthMeters) || widthMeters <= 0) return;

      const mid = entity.__roadMidpoint || getRoadMidpointCartesian(entity);
      if (!mid) return;
      entity.__roadMidpoint = mid;

      const mpp = viewer.camera.getPixelSize(new Cesium.BoundingSphere(mid, 1), w, h);
      if (!Number.isFinite(mpp) || mpp <= 0) return;

      const pixelWidth = widthMeters / mpp;
      entity.polyline.width = Math.max(2.5, Math.min(26, pixelWidth));
    });
  }

  function scheduleRoadWidthSync() {
    if (!viewer) return;
    if (roadWidthSyncRaf) return;
    roadWidthSyncRaf = requestAnimationFrame(() => {
      roadWidthSyncRaf = 0;
      update3DRoadPolylineWidths();
    });
  }

  function getOverviewCameraOffset() {
    return new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(OVERVIEW_CAMERA_HEADING_DEG),
      Cesium.Math.toRadians(OVERVIEW_CAMERA_PITCH_DEG),
      OVERVIEW_CAMERA_RANGE
    );
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function toBooleanFlag(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return fallback;
  }

  function normalizeStretch(value, fallback = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return clampNumber(num, 0.1, 20, fallback);
  }

  function normalizeStoredModelScale(value, fallback = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;

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

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function hasUsableCesiumIonToken() {
    return !!(
      window.CESIUM_ION_TOKEN &&
      !String(window.CESIUM_ION_TOKEN).includes("你的")
    );
  }

  async function createSingleTileImageryProvider(url, rectangle) {
    if (
      Cesium.SingleTileImageryProvider &&
      typeof Cesium.SingleTileImageryProvider.fromUrl === "function"
    ) {
      return Cesium.SingleTileImageryProvider.fromUrl(url, { rectangle });
    }

    return new Cesium.SingleTileImageryProvider({
      url,
      rectangle
    });
  }

  async function addViewerImageryLayers(canUseIonServices) {
    if (!viewer) return;

    viewer.imageryLayers.removeAll();

    let hasImagery = false;

    if (canUseIonServices) {
      try {
        const provider = await withTimeout(
          Cesium.createWorldImageryAsync({
            style: Cesium.IonWorldImageryStyle.AERIAL
          }),
          ONLINE_RESOURCE_TIMEOUT_MS,
          "在线卫星影像服务响应超时"
        );
        viewer.imageryLayers.addImageryProvider(provider);
        hasImagery = true;
      } catch (error) {
        console.warn("在线卫星底图加载失败：", error?.message || error);
      }
    }

    const georef = getBasemapGeoref();
    const localRect = Cesium.Rectangle.fromDegrees(
      georef.minX,
      georef.minY,
      georef.maxX,
      georef.maxY
    );

    try {
      const localProvider = await createSingleTileImageryProvider(georef.imageUrl, localRect);
      const localLayer = viewer.imageryLayers.addImageryProvider(localProvider);
      viewer.imageryLayers.raiseToTop(localLayer);
      hasImagery = true;
    } catch (error) {
      console.warn("无法加载本地正射影像，3D 白模将使用纯色地球底图。", error);
    }

    if (!hasImagery && viewer.scene?.globe) {
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#dfe8ee");
    }
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
    return pickFirstValue(props, NAME_FIELDS) || fallbackCode || "Unnamed Building";
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

  function setEntityReplacementVisual(entity, hasReplacement, hasRenderableReplacement = hasReplacement) {
    if (!entity || !entity.polygon) return;

    if (hasReplacement) {
      // Default behavior: hide base when replacement model is visible.
      // If user explicitly enables "show blue base", or replacement model is missing,
      // keep base visible with replacement styling.
      if (showReplacementBase || !hasRenderableReplacement) {
        entity.show = true;
        entity.polygon.fill = true;
        entity.polygon.material = activeEntity === entity ? ACTIVE_COLOR : REPLACED_BASE_COLOR;
        entity.polygon.outline = true;
        entity.polygon.outlineColor = activeEntity === entity ? ACTIVE_OUTLINE_COLOR : REPLACED_OUTLINE_COLOR;
        entity.polygon.outlineWidth = activeEntity === entity ? 2.5 : 2.0;
      } else {
        entity.show = false;
        entity.polygon.fill = false;
        entity.polygon.outline = false;
      }
      return;
    }

    entity.show = true;
    entity.polygon.fill = true;

    if (activeEntity === entity) {
      setEntityActiveStyle(entity);
    } else {
      setEntityDefaultStyle(entity);
    }
  }

  function refreshAllEntityVisualStates() {
    entityMap.forEach((entity, key) => {
      if (!entity || !entity.polygon) return;

      const replacementItem = replacementModelMap.get(key) || null;
      const hasReplacement = !!replacementItem;
      const hasRenderableReplacement = !!replacementItem?.primitive;
      setEntityReplacementVisual(entity, hasReplacement, hasRenderableReplacement);
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
    // Expose to 2D for selection sync
    window.__active3DEntityCode = entity?.__sourceCode || null;
    refreshAllEntityVisualStates();
  }

  function getEntityCenterCartographic(entity) {
    if (!entity || !entity.polygon || !entity.polygon.hierarchy) return null;

    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
    if (!hierarchy || !hierarchy.positions || hierarchy.positions.length < 3) return null;

    let positions = hierarchy.positions.slice();

    if (positions.length >= 2) {
      const first = Cesium.Cartographic.fromCartesian(positions[0]);
      const last = Cesium.Cartographic.fromCartesian(positions[positions.length - 1]);

      const samePoint =
        Math.abs(first.longitude - last.longitude) < 1e-12 &&
        Math.abs(first.latitude - last.latitude) < 1e-12;

      if (samePoint) {
        positions = positions.slice(0, -1);
      }
    }

    if (positions.length < 3) return null;

    let lon0 = 0;
    let lat0 = 0;
    const cartographics = positions.map((p) => Cesium.Cartographic.fromCartesian(p));
    cartographics.forEach((c) => {
      lon0 += c.longitude;
      lat0 += c.latitude;
    });
    lon0 /= cartographics.length;
    lat0 /= cartographics.length;

    const R = 6378137;
    const cosLat0 = Math.cos(lat0);

    const pts = cartographics.map((c) => ({
      x: (c.longitude - lon0) * R * cosLat0,
      y: (c.latitude - lat0) * R
    }));

    let area2 = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      area2 += cross;
      cx += (pts[i].x + pts[j].x) * cross;
      cy += (pts[i].y + pts[j].y) * cross;
    }

    if (Math.abs(area2) < 1e-8) {
      return new Cesium.Cartographic(lon0, lat0, 0);
    }

    cx /= (3 * area2);
    cy /= (3 * area2);

    return new Cesium.Cartographic(
      lon0 + cx / (R * cosLat0),
      lat0 + cy / R,
      0
    );
  }

  async function applyTerrainHeights(entities) {
    if (!entities.length || !viewer) return;

    const applyEntityHeights = (entity, terrainHeightValue) => {
      if (!entity || !entity.polygon) return;
      const sourceCode = entity.__sourceCode || "";
      const baseRow = rowMap.get(normalizeCode(sourceCode)) || null;
      const props = entityPropertiesToPlainObject(entity);

      const height = baseRow
        ? readBuildingHeightFromObject(baseRow)
        : readBuildingHeightFromObject(props);

      const terrainHeight = Number.isFinite(terrainHeightValue) ? Math.max(0, terrainHeightValue) : 0;

      entity.__terrainHeight = terrainHeight;
      entity.__baseHeight = height;
      entity.__buildingHeight = height;

      entity.polygon.height = terrainHeight;
      entity.polygon.extrudedHeight = terrainHeight + height;
    };

    const cartographics = [];
    const refs = [];

    entities.forEach((entity) => {
      const cacheKey = normalizeCode(entity?.__sourceCode || "");
      if (cacheKey && terrainHeightCache.has(cacheKey)) {
        applyEntityHeights(entity, terrainHeightCache.get(cacheKey));
        return;
      }

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
        const terrainHeight = Number.isFinite(cartographic.height) ? Math.max(0, cartographic.height) : 0;
        const cacheKey = normalizeCode(entity?.__sourceCode || "");
        if (cacheKey) terrainHeightCache.set(cacheKey, terrainHeight);
        applyEntityHeights(entity, terrainHeight);
      });
    } catch (error) {
      console.warn("Terrain sampling failed, fallback to 0 base height:", error);

      entities.forEach((entity) => {
        const cacheKey = normalizeCode(entity?.__sourceCode || "");
        if (cacheKey && !terrainHeightCache.has(cacheKey)) {
          terrainHeightCache.set(cacheKey, 0);
        }
        applyEntityHeights(entity, 0);
      });
    }
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
      modelOffsetY: toFiniteNumber(row?.modelOffsetY, preset?.offsetY ?? 0),
      modelStretchX: normalizeStretch(row?.modelStretchX, 1),
      modelStretchY: normalizeStretch(row?.modelStretchY, 1),
      modelExpectedHeight: toFiniteNumber(row?.modelExpectedHeight, NaN),
      modelExpectedLength: toFiniteNumber(row?.modelExpectedLength, NaN),
      modelExpectedWidth: toFiniteNumber(row?.modelExpectedWidth, NaN),
      modelSnapToBase: toBooleanFlag(row?.modelSnapToBase, true)
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
        modelOffsetY: "",
        modelStretchX: "",
        modelStretchY: "",
        modelExpectedHeight: "",
        modelExpectedLength: "",
        modelExpectedWidth: "",
        modelSnapToBase: "1"
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
        modelOffsetY: "",
        modelStretchX: "",
        modelStretchY: "",
        modelExpectedHeight: "",
        modelExpectedLength: "",
        modelExpectedWidth: "",
        modelSnapToBase: "1"
      };
    }

    const nextScale = manualOverrides.modelScale ?? preset.scale ?? 1;
    const nextHeading = manualOverrides.modelHeading ?? preset.heading ?? 0;
    const nextHeightOffset = manualOverrides.modelHeightOffset ?? preset.heightOffset ?? 0;
    const nextOffsetX = manualOverrides.modelOffsetX ?? preset.offsetX ?? 0;
    const nextOffsetY = manualOverrides.modelOffsetY ?? preset.offsetY ?? 0;
    const nextStretchX = manualOverrides.modelStretchX ?? 1;
    const nextStretchY = manualOverrides.modelStretchY ?? 1;
    const nextSnapToBase = true;

    return {
      ...(existingRow || {}),
      modelPreset: preset.id,
      modelUrl: preset.url,
      modelScale: String(nextScale),
      modelHeading: String(nextHeading),
      modelHeightOffset: String(nextHeightOffset),
      modelOffsetX: String(nextOffsetX),
      modelOffsetY: String(nextOffsetY),
      modelStretchX: String(nextStretchX),
      modelStretchY: String(nextStretchY),
      modelExpectedHeight: "",
      modelExpectedLength: "",
      modelExpectedWidth: "",
      modelSnapToBase: nextSnapToBase ? "1" : "0"
    };
  }

  function getBaseRowForEntity(entity) {
    const code = normalizeCode(entity?.__sourceCode || "");
    return rowMap.get(code) || null;
  }

  function buildBase3DRow(entity) {
    const sourceCode = entity?.__sourceCode || "";
    const displayName = entity?.__displayName || sourceCode || "Unnamed Building";
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
      modelOffsetY: "",
      modelStretchX: "",
      modelStretchY: "",
      modelExpectedHeight: "",
      modelExpectedLength: "",
      modelExpectedWidth: "",
      modelSnapToBase: "1"
    };
  }

  function getEntityAutoHeading(entity) {
    const props = entityPropertiesToPlainObject(entity);
    return toFiniteNumber(props.cesium, 0);
  }

  function mergeRow(baseRow, editData) {
    return { ...(baseRow || {}), ...(editData || {}) };
  }

  function buildModelReplaceCardHtml(row, allowEdit) {
    const modelState = getModelStateFromRow(row);
    const currentPreset = getModelPresetById(modelState.modelPreset);
    const modelStatusText = currentPreset
      ? `已替换为 ${currentPreset.name}`
      : (modelState.modelUrl ? "已替换为自定义生成模型" : "白模");

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
                  <span class="form-suffix">度</span>
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
                <span class="form-label">拉伸 X</span>
                <span class="form-input-wrap">
                  <input id="modelStretchXInput" class="form-input" type="number" min="0.1" max="20" step="0.01" value="${escapeHtml(String(modelState.modelStretchX || 1))}" />
                  <span class="form-suffix">倍</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">拉伸 Y</span>
                <span class="form-input-wrap">
                  <input id="modelStretchYInput" class="form-input" type="number" min="0.1" max="20" step="0.01" value="${escapeHtml(String(modelState.modelStretchY || 1))}" />
                  <span class="form-suffix">倍</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">东-西偏移</span>
                <span class="form-input-wrap">
                  <input id="modelOffsetXInput" class="form-input" type="number" step="0.1" value="${escapeHtml(String(modelState.modelOffsetX || 0))}" />
                  <span class="form-suffix">m</span>
                </span>
              </label>

              <label class="form-row">
                <span class="form-label">南-北偏移</span>
                <span class="form-input-wrap">
                  <input id="modelOffsetYInput" class="form-input" type="number" step="0.1" value="${escapeHtml(String(modelState.modelOffsetY || 0))}" />
                  <span class="form-suffix">m</span>
                </span>
              </label>

              <div class="edit-actions" style="margin-top:10px;">
                <button id="applyModelPresetBtn" class="upload-btn" type="button">种上该模型</button>
                <button id="removeModelPresetBtn" class="upload-btn secondary-btn" type="button">恢复白模</button>
                <button id="openHouseGeneratorBtn" class="upload-btn secondary-btn" type="button">生成模型</button>
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

        <div class="house-row">当前状态：${escapeHtml(modelStatusText)}</div>
        ${modelState.modelUrl ? `<div class="house-row">模型路径：${escapeHtml(modelState.modelUrl)}</div>` : ""}
        <div class="house-row">调参建议：模型会在种上时自动贴合建筑底面，可继续微调拉伸 X/Y、偏移与旋转。</div>
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
    
    // 从 window 获取当前空间信息（由 app.js 同步）
    const spaces = typeof window.__get2DSpaces === 'function' ? window.__get2DSpaces() : [];
    const currentSpaceId = window.__active2DSpaceId || 'current';
    const currentSpace = spaces.find(s => s.id === currentSpaceId) || { title: "村庄现状" };

    if (statusBadge) {
      if (currentSelectedEntityCode && activeEntity) {
        const name = activeEntity.__displayName || activeEntity.__sourceCode || "Unnamed Building";
        statusBadge.textContent = `当前模式：村庄 3D 模型｜空间：${currentSpace?.title || "村庄现状"}｜已选建筑：${name}`;
      } else {
        statusBadge.textContent = `当前模式：村庄 3D 模型｜空间：${currentSpace?.title || "村庄现状"}`;
      }
    }

    if (detailSubtitle) {
      if (currentSelectedEntityCode && activeEntity) {
        const name = activeEntity.__displayName || activeEntity.__sourceCode || "Unnamed Building";
        detailSubtitle.textContent = `当前查看：3D 建筑 - ${name}`;
      } else {
        detailSubtitle.textContent = "当前显示地形与可点击建筑白模";
      }
    }
  }

  async function fetchCurrentSpaceAllEdits() {
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const objectType = linkedSpaceId === 'current' ? null : `${MODEL_BASE_OBJECT_TYPE}__${linkedSpaceId}`;
    if (!objectType || !supabaseClient) return [];

    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("object_code,data")
      .eq("object_type", objectType);

    if (error) {
      console.warn("Failed to fetch current 3D space edits:", error);
      return [];
    }

    return data || [];
  }

  async function fetchSingle3DEdit(sourceCode) {
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const objectType = linkedSpaceId === 'current' ? null : `${MODEL_BASE_OBJECT_TYPE}__${linkedSpaceId}`;
    if (!objectType || !supabaseClient || !sourceCode) return null;

    const { data, error } = await supabaseClient
      .from(OBJECT_EDITS_TABLE)
      .select("data")
      .eq("object_code", sourceCode)
      .eq("object_type", objectType)
      .maybeSingle();

    if (error) {
      console.warn("Failed to fetch single 3D edit record:", error);
      return null;
    }

    return data?.data || null;
  }

  async function saveSingle3DEdit(sourceCode, payload) {
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const objectType = linkedSpaceId === 'current' ? null : `${MODEL_BASE_OBJECT_TYPE}__${linkedSpaceId}`;
    if (!objectType) {
      throw new Error("Current base space is read-only and cannot be saved.");
    }
    if (!supabaseClient) {
      throw new Error("Supabase is not configured.");
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

    const key = normalizeCode(entity.__sourceCode || "");
    const replacementItem = replacementModelMap.get(key) || null;
    setEntityReplacementVisual(entity, !!replacementItem, !!replacementItem?.primitive);

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
        console.warn("Failed to remove replacement model:", error);
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
        console.warn("Failed to delete replacement model:", error);
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

  function getDesiredModelBaseHeight(entity, modelState = {}) {
    const terrainHeight = Number.isFinite(entity?.__terrainHeight) ? entity.__terrainHeight : 0;
    const heightOffset = toFiniteNumber(modelState.modelHeightOffset, 0);
    return terrainHeight + heightOffset;
  }

  function resolveExpectedModelHeightMeters(entity, modelState = {}) {
    const byState = toFiniteNumber(modelState.modelExpectedHeight, NaN);
    if (Number.isFinite(byState) && byState > 0.1) return byState;

    const byEntity = toFiniteNumber(entity?.__buildingHeight, NaN);
    if (Number.isFinite(byEntity) && byEntity > 0.1) return byEntity;

    return NaN;
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

  function applyLocalScaleToMatrix(matrix, scaleX, scaleY, scaleZ) {
    const scale = new Cesium.Cartesian3(
      Math.max(0.001, toFiniteNumber(scaleX, 1)),
      Math.max(0.001, toFiniteNumber(scaleY, 1)),
      Math.max(0.001, toFiniteNumber(scaleZ, 1))
    );

    const result = Cesium.Matrix4.clone(matrix, new Cesium.Matrix4());
    Cesium.Matrix4.multiplyByScale(result, scale, result);
    return result;
  }

  function alignPrimitiveBottomToBaseHeight(primitive, modelMatrix, desiredBaseHeight, expectedHeightMeters = NaN) {
    if (!primitive || !modelMatrix || !Number.isFinite(desiredBaseHeight)) return modelMatrix;

    try {
      const boundingSphere = primitive.boundingSphere;
      if (!boundingSphere || !Number.isFinite(boundingSphere.radius)) return modelMatrix;

      const centerCartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
      if (!centerCartographic || !Number.isFinite(centerCartographic.height)) return modelMatrix;

      let currentBottomHeight = centerCartographic.height - boundingSphere.radius;
      if (Number.isFinite(expectedHeightMeters) && expectedHeightMeters > 0.1) {
        currentBottomHeight = centerCartographic.height - expectedHeightMeters / 2;
      }
      const deltaHeight = desiredBaseHeight - currentBottomHeight;

      if (!Number.isFinite(deltaHeight) || Math.abs(deltaHeight) < 0.005) {
        return modelMatrix;
      }

      return applyLocalOffsetToMatrix(modelMatrix, 0, 0, deltaHeight);
    } catch (error) {
      console.warn("Failed to align model bottom:", error);
      return modelMatrix;
    }
  }

  function getEntityFootprintSize(entity) {
    if (!entity?.polygon?.hierarchy) return null;
    const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
    const positions = hierarchy?.positions || [];
    if (positions.length < 3) return null;

    const cartographics = positions.map((p) => Cesium.Cartographic.fromCartesian(p));
    let lon0 = 0;
    let lat0 = 0;
    cartographics.forEach((c) => {
      lon0 += c.longitude;
      lat0 += c.latitude;
    });
    lon0 /= cartographics.length;
    lat0 /= cartographics.length;

    const R = 6378137;
    const cosLat0 = Math.max(1e-6, Math.cos(lat0));
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    cartographics.forEach((c) => {
      const x = (c.longitude - lon0) * R * cosLat0;
      const y = (c.latitude - lat0) * R;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const width = Math.max(0.1, maxX - minX);
    const depth = Math.max(0.1, maxY - minY);
    return { width, depth };
  }

  function getAutoFitScaleXY(entity, primitive) {
    const footprint = getEntityFootprintSize(entity);
    const radius = primitive?.boundingSphere?.radius;
    if (!footprint || !Number.isFinite(radius) || radius <= 0) {
      return { x: 1, y: 1 };
    }

    const modelDiameter = Math.max(0.1, radius * 2);
    // Raw fit factor based on footprint vs. current model footprint proxy.
    const rawX = footprint.width / modelDiameter;
    const rawY = footprint.depth / modelDiameter;

    // Soften auto-fit to avoid aggressive over-stretch on certain GLB origins/sizes.
    const damp = (v) => {
      const eased = Math.pow(Math.max(0.01, v), 0.6);
      const blended = 1 + (eased - 1) * 0.75;
      return clampNumber(blended, 0.35, 2.8, 1);
    };

    return {
      x: damp(rawX),
      y: damp(rawY)
    };
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

    removeReplacementModel(key);

    const requestToken = Symbol(`request_${key}_${Date.now()}`);
    replacementRequestTokenMap.set(key, requestToken);

    const anchorPosition = getModelEntityPosition(entity, modelState);
    if (!anchorPosition) return false;

    const uiScale = Math.max(0.1, toFiniteNumber(modelState.modelScale, 1));
    const stretchX = normalizeStretch(modelState.modelStretchX, 1);
    const stretchY = normalizeStretch(modelState.modelStretchY, 1);
    const snapToBase = toBooleanFlag(modelState.modelSnapToBase, true);
    const desiredBaseHeight = getDesiredModelBaseHeight(entity, modelState);
    const buildingHeadingDeg = getEntityAutoHeading(entity);
    const modelHeadingCorrectionDeg = toFiniteNumber(modelState.modelHeading, 0);
    const headingDeg = buildingHeadingDeg + modelHeadingCorrectionDeg;
    const heading = Cesium.Math.toRadians(headingDeg);

    const offsetX = toFiniteNumber(modelState.modelOffsetX, 0);
    const offsetY = toFiniteNumber(modelState.modelOffsetY, 0);

    const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
    let modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(
      anchorPosition,
      hpr
    );

    modelMatrix = applyLocalOffsetToMatrix(modelMatrix, offsetX, offsetY, 0);
    const baseScale = uiScale * MODEL_SCALE_BASE;
    const expectedModelHeightMeters = resolveExpectedModelHeightMeters(entity, modelState);
    const expectedModelHeightWorld = Number.isFinite(expectedModelHeightMeters)
      ? Math.max(0.1, expectedModelHeightMeters * baseScale)
      : NaN;
    modelMatrix = applyLocalScaleToMatrix(
      modelMatrix,
      baseScale * stretchX,
      baseScale * stretchY,
      baseScale
    );

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
      const primitive = await Cesium.Model.fromGltfAsync({
        url: modelUrl,
        modelMatrix,
        scale: 1,
        minimumPixelSize: 0,
        maximumScale: undefined,
        incrementallyLoadTextures: true,
        runAnimations: true
      });

      if (replacementRequestTokenMap.get(key) !== requestToken) {
        try {
          if (pointEntity) viewer.entities.remove(pointEntity);
        } catch (_) {}

        try {
          if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) {
            primitive.destroy();
          }
        } catch (_) {}

        console.log("Discarded stale model request:", key);
        return false;
      }

      primitive.__isReplacementModel = true;
      primitive.__sourceCode = key;

      viewer.scene.primitives.add(primitive);

      const applyPostLoadAdjustments = () => {
        try {
          if (replacementRequestTokenMap.get(key) !== requestToken) {
            try {
              viewer.scene.primitives.remove(primitive);
              if (typeof primitive.destroy === "function" && !primitive.isDestroyed?.()) {
                primitive.destroy();
              }
            } catch (_) {}
            return;
          }

          let adjustedMatrix = primitive.modelMatrix || modelMatrix;
          const fitScale = getAutoFitScaleXY(entity, primitive);
          adjustedMatrix = applyLocalScaleToMatrix(adjustedMatrix, fitScale.x, fitScale.y, 1);
          primitive.modelMatrix = adjustedMatrix;

          const updateAnchorPoint = (matrix) => {
            if (!pointEntity || !matrix) return;
            pointEntity.position = Cesium.Matrix4.getTranslation(
              matrix,
              new Cesium.Cartesian3()
            );
          };

          const runSnapPass = () => {
            const baseMatrix = primitive.modelMatrix || adjustedMatrix;
            const snappedMatrix = alignPrimitiveBottomToBaseHeight(
              primitive,
              baseMatrix,
              desiredBaseHeight,
              expectedModelHeightWorld
            );
            primitive.modelMatrix = snappedMatrix;
            adjustedMatrix = snappedMatrix;
            updateAnchorPoint(snappedMatrix);
          };

          if (snapToBase) {
            runSnapPass();
            setTimeout(() => {
              if (replacementRequestTokenMap.get(key) !== requestToken) return;
              runSnapPass();
              viewer.scene.requestRender();
            }, 90);
            setTimeout(() => {
              if (replacementRequestTokenMap.get(key) !== requestToken) return;
              runSnapPass();
              viewer.scene.requestRender();
            }, 220);
          } else {
            updateAnchorPoint(adjustedMatrix);
          }

          primitive.debugShowBoundingVolume = false;
          primitive.silhouetteColor = Cesium.Color.YELLOW;
          primitive.silhouetteSize = 1.0;

          console.log("GLB loaded successfully:", modelUrl);
          viewer.scene.requestRender();
        } catch (err) {
          console.error("模型加载后处理失败：", err);
          viewer.scene.requestRender();
        }
      };

      if (primitive.ready) {
        applyPostLoadAdjustments();
      } else {
        primitive.readyEvent.addEventListener(() => {
          applyPostLoadAdjustments();
        });
      }

      primitive.errorEvent.addEventListener((error) => {
        console.error("GLB loading failed:", modelUrl, error);
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
      console.error("Cesium.Model.fromGltfAsync failed:", modelUrl, error);

      if (replacementRequestTokenMap.get(key) === requestToken) {
        replacementModelMap.set(key, {
          primitive: null,
          pointEntity
        });

        setEntityReplacementVisual(entity, true, false);
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

  async function applyRuntimeGeneratedModelsForSpace(spaceId) {
    const prefix = `${String(spaceId || "current").trim() || "current"}::`;
    const pending = [];

    runtimeGeneratedModelStateMap.forEach((state, key) => {
      if (!key.startsWith(prefix)) return;
      const code = key.slice(prefix.length);
      if (!code) return;
      const entity = entityMap.get(normalizeCode(code));
      if (!entity) return;
      pending.push(applyModelStateToEntity(entity, state));
    });

    if (pending.length) {
      await Promise.allSettled(pending);
    }
  }

  async function applyCurrent3DSpaceToScene() {
    resetSceneToBaseHeights();

    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    if (linkedSpaceId !== "current") {
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
    }

    await applyRuntimeGeneratedModelsForSpace(linkedSpaceId);

    update3DStatusText();
    viewer?.scene.requestRender();
  }

  async function loadRoads() {
    if (!viewer) {
      await initViewer();
    }

    if (roadsDataSource) {
      viewer.dataSources.remove(roadsDataSource, true);
      roadsDataSource = null;
    }
    roadEntitiesForWidthSync = [];

    let featureCollection = null;
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const isBaseLinkedSpace = linkedSpaceId === "current";

    if (isBaseLinkedSpace) {
      const geojsonText = await loadText(ROAD_GEOJSON_URL);
      featureCollection = JSON.parse(geojsonText);
      const baseFeatures = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
      console.info("[3D roads] space=current, source=local", {
        total: baseFeatures.length,
        geomTypes: getFeatureGeometryTypeStats(baseFeatures)
      });
    } else {
      const dbRows = await list3DRoadsFromDb();
      const hasAnyDbRows = await hasAny3DRoadRowsForSpace(linkedSpaceId);
      const dbFeatureCollection = makeDbRoadFeatureCollection(dbRows);
      const dbFeatures = Array.isArray(dbFeatureCollection?.features) ? dbFeatureCollection.features : [];

      const localGeojsonText = await loadText(ROAD_GEOJSON_URL);
      const localFeatureCollection = JSON.parse(localGeojsonText);
      const localFeatures = Array.isArray(localFeatureCollection?.features) ? localFeatureCollection.features : [];

      // Keep local fallback roads in planning spaces, while DB rows with same code take precedence.
      const dbCodeSet = new Set();
      dbFeatures.forEach((f) => {
        const code = getRoadCodeFromFeatureLike(f);
        if (code) dbCodeSet.add(code);
      });

      const mergedLocal = localFeatures.filter((f) => {
        const code = getRoadCodeFromFeatureLike(f);
        if (!code) return true;
        return !dbCodeSet.has(code);
      });

      const mergedFeatures = [...dbFeatures, ...mergedLocal];

      if (hasAnyDbRows || dbRows.length) {
        featureCollection = {
          type: "FeatureCollection",
          features: mergedFeatures
        };
        if (!dbFeatures.length) {
          console.warn("3D 道路数据存在但几何不可渲染，已回退到本地 roads.geojson。");
        }
      } else {
        featureCollection = localFeatureCollection;
      }

      console.info("[3D roads] space=" + linkedSpaceId, {
        dbRows: dbRows.length,
        dbRenderable: dbFeatures.length,
        local: localFeatures.length,
        merged: Array.isArray(featureCollection?.features) ? featureCollection.features.length : 0,
        dbCodesSample: dbRows.slice(0, 8).map((r) => r?.object_code || "").filter(Boolean),
        geomTypes: getFeatureGeometryTypeStats(featureCollection?.features || [])
      });
    }

    roadsDataSource = await Cesium.GeoJsonDataSource.load(featureCollection, {
      clampToGround: true,
      stroke: Cesium.Color.fromCssColorString("#1565c0").withAlpha(0.95),
      fill: Cesium.Color.fromCssColorString("#64b5f6").withAlpha(0.28),
      strokeWidth: 2.4
    });

    viewer.dataSources.add(roadsDataSource);

    const roadEntities = roadsDataSource.entities.values || [];
    let polylineCount = 0;
    let polygonCount = 0;
    let corridorCount = 0;
    const ROAD_SURFACE_COLOR = Cesium.Color.fromCssColorString("#4f8fca").withAlpha(0.52);
    const ROAD_EDGE_COLOR = Cesium.Color.fromCssColorString("#1f5f9e").withAlpha(0.95);
    const ROAD_CENTERLINE_COLOR = Cesium.Color.fromCssColorString("#1f5f9e").withAlpha(0.45);
    roadEntities.forEach((entity) => {
      if (!entity) return;
      entity.__isRoadEntity = true;

      if (entity.polyline) {
        polylineCount += 1;
        const widthMeters = getRoadWidthFromEntity(entity);
        entity.__roadWidthMeters = widthMeters;
        entity.__roadMidpoint = getRoadMidpointCartesian(entity);
        entity.polyline.clampToGround = true;

        // LineString roads in source data are centerlines.
        // Render them as meter-based road surfaces in 3D via corridor.
        entity.corridor = new Cesium.CorridorGraphics({
          positions: entity.polyline.positions,
          width: Math.max(1, widthMeters),
          material: ROAD_SURFACE_COLOR,
          outline: true,
          outlineColor: ROAD_EDGE_COLOR,
          classificationType: Cesium.ClassificationType.TERRAIN
        });
        corridorCount += 1;

        // Keep a subtle centerline for selection/readability, but color-match it to road edges.
        entity.polyline.width = 1.2;
        entity.polyline.material = ROAD_CENTERLINE_COLOR;
      }

      if (entity.polygon) {
        polygonCount += 1;
        entity.polygon.material = ROAD_SURFACE_COLOR;
        entity.polygon.outline = true;
        entity.polygon.outlineColor = ROAD_EDGE_COLOR;
        entity.polygon.outlineWidth = 1.5;
        entity.polygon.perPositionHeight = false;
        entity.polygon.height = undefined;
        entity.polygon.extrudedHeight = undefined;
      }
    });

    console.info("[3D roads] entities", {
      total: roadEntities.length,
      polyline: polylineCount,
      polygon: polygonCount,
      corridor: corridorCount
    });

    scheduleRoadWidthSync();
  }

  function loadRoadsInBackground(reason = "") {
    const token = ++roadsLoadToken;
    roadsLoadTask = (async () => {
      try {
        await loadRoads();
        if (token !== roadsLoadToken) return;
        viewer?.scene.requestRender();
      } catch (error) {
        if (token !== roadsLoadToken) return;
        console.warn(`3D 道路后台加载失败（${reason || "unknown"}）：`, error);
      }
    })();
    return roadsLoadTask;
  }

  async function loadBuildings() {
    if (!viewer) {
      await initViewer();
    }

    clearAllReplacementModels();
    clearActiveEntity();

    if (buildingsDataSource) {
      viewer.dataSources.remove(buildingsDataSource, true);
      buildingsDataSource = null;
    }
    if (roadsDataSource) {
      viewer.dataSources.remove(roadsDataSource, true);
      roadsDataSource = null;
    }

    entityMap.clear();

    await loadCSVRows();

    let featureCollection = null;

    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const isBaseLinkedSpace = linkedSpaceId === "current";

    if (isBaseLinkedSpace) {
      // 现状空间直接读取本地 GeoJSON
      const geojsonText = await loadText(GEOJSON_URL);
      featureCollection = JSON.parse(geojsonText);
    } else {
      const dbRows = await list3DBuildingsFromDb();
      const hasAnyDbRows = await hasAny3DBuildingRowsForSpace(linkedSpaceId);

      if (hasAnyDbRows) {
        featureCollection = makeDbBuildingFeatureCollection(dbRows);
      } else if (dbRows.length) {
        featureCollection = makeDbBuildingFeatureCollection(dbRows);
      } else {
        const geojsonText = await loadText(GEOJSON_URL);
        featureCollection = JSON.parse(geojsonText);
      }
    }

    buildingsDataSource = await Cesium.GeoJsonDataSource.load(featureCollection, {
      clampToGround: false,
      stroke: OUTLINE_COLOR,
      fill: BASE_COLOR,
      strokeWidth: 1.2
    });

    viewer.dataSources.add(buildingsDataSource);

    const entities = buildingsDataSource.entities.values || [];
    entities.forEach((entity) => {
      if (!entity || !entity.polygon) return;

      const sourceCode = normalizeCode(getEntitySourceCode(entity));
      if (!sourceCode) return;

      entity.__sourceCode = sourceCode;
      entity.__isBuildingEntity = true;
      setEntityDefaultStyle(entity);
      entityMap.set(sourceCode, entity);
    });

    await applyTerrainHeights(entities);
    await applyCurrent3DSpaceToScene();
    loadRoadsInBackground("after-load-buildings");

    if (entities.length) {
      viewer.flyTo(buildingsDataSource, {
        duration: 1.0,
        offset: getOverviewCameraOffset()
      });
    }

    viewer.scene.requestRender();
  }

  async function showEntityInfo(entity) {
    const infoPanel = getInfoPanel();
    if (!infoPanel || !entity) return;

    const sourceCode = entity.__sourceCode || "";
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    // 规划空间允许编辑，现状空间只读
    const allowEdit = linkedSpaceId !== 'current';

    const baseRow = buildBase3DRow(entity);

    let mergedRow = baseRow;

    try {
      // Fetch shared fields from 2D namespace
      const fetchObjectEdits = window.__fetchObjectEdits;
      const objectType2D = linkedSpaceId === 'current' ? 'building' : `building__${linkedSpaceId}`;
      const sharedEditData = allowEdit && fetchObjectEdits
        ? await fetchObjectEdits(sourceCode, objectType2D)
        : null;

      // Fetch 3D-specific fields (建筑高度, model state)
      const editData3D = allowEdit ? await fetchSingle3DEdit(sourceCode) : null;

      // Merge: 3D-specific data first, then shared fields override (for synchronization)
      mergedRow = mergeRow(baseRow, { ...editData3D, ...sharedEditData });
    } catch (error) {
      console.warn("Error fetching entity edit data:", error);
      // Continue with baseRow if fetching fails
    }

    const runtimeGeneratedState = getRuntimeGeneratedModelState(linkedSpaceId, sourceCode);
    if (runtimeGeneratedState) {
      mergedRow = mergeRow(mergedRow, runtimeGeneratedState);
    }

    currentSelectedEntityCode = sourceCode;
    update3DStatusText();

    infoPanel.classList.remove("empty");
    infoPanel.innerHTML = `
      ${buildModelReplaceCardHtml(mergedRow, allowEdit)}

      <div class="info-card">
        <h3 class="house-title">3D 模型说明</h3>
        <div class="house-row">当前空间：${escapeHtml(linkedSpaceId || "current")}</div>
        <div class="house-row">地形高程：${escapeHtml((entity.__terrainHeight ?? 0).toFixed(2))} m</div>
        <div class="house-row">当前挤出高度：${escapeHtml(String(entity.__buildingHeight ?? DEFAULT_HEIGHT))} m</div>
      </div>
    `;

    bindEntityInfoEvents(entity, baseRow, allowEdit);
  }

  function openHouseGeneratorForEntity(entity, statusEl) {
    const sourceCode = String(entity?.__sourceCode || "").trim();
    const sourceName = String(entity?.__displayName || sourceCode || "").trim();
    const linkedSpaceId = getLinked2DSpaceIdFor3D();

    const generatorUrl = new URL("rural_house_generator/index.html", window.location.href);
    if (sourceCode) generatorUrl.searchParams.set("targetCode", sourceCode);
    if (linkedSpaceId) generatorUrl.searchParams.set("targetSpace", linkedSpaceId);
    if (sourceName) generatorUrl.searchParams.set("targetName", sourceName);

    const opened = window.open(generatorUrl.toString(), "_blank");
    if (!opened && statusEl) {
      statusEl.textContent = "打开失败：请允许浏览器弹出新窗口。";
    }
    return !!opened;
  }

  async function handleHouseGeneratorModelMessage(event) {
    const message = event?.data;
    if (!message || typeof message !== "object") return;
    if (message.type !== HOUSE_GENERATOR_MESSAGE_TYPE) return;

    const origin = String(event.origin || "");
    if (origin && origin !== "null" && origin !== window.location.origin) return;

    const payload = message.payload || {};
    const linkedSpaceId = getLinked2DSpaceIdFor3D();
    const targetSpaceId = String(payload.spaceId || linkedSpaceId || "current").trim() || "current";
    const fallbackCode = activeEntity?.__sourceCode || currentSelectedEntityCode;
    const sourceCode = normalizeCode(payload.sourceCode || fallbackCode);
    const glbBuffer = payload.glbBuffer;

    if (!sourceCode || !(glbBuffer instanceof ArrayBuffer)) return;

    const scale = clampNumber(payload.modelScale, 0.1, 120, HOUSE_GENERATOR_DEFAULT_SCALE);
    const heading = clampNumber(payload.modelHeading, -360, 360, 0);
    const heightOffset = clampNumber(payload.modelHeightOffset, -100, 300, 0);
    const offsetX = clampNumber(payload.modelOffsetX, -200, 200, 0);
    const offsetY = clampNumber(payload.modelOffsetY, -200, 200, 0);
    const stretchX = clampNumber(payload.modelStretchX, 0.1, 20, 1);
    const stretchY = clampNumber(payload.modelStretchY, 0.1, 20, 1);
    const snapToBase = payload.modelSnapToBase === undefined ? true : toBooleanFlag(payload.modelSnapToBase, true);
    const expectedHeight = clampNumber(payload?.modelMetrics?.totalHeight, 0.1, 300, NaN);
    const expectedLength = clampNumber(payload?.modelMetrics?.length, 0.1, 300, NaN);
    const expectedWidth = clampNumber(payload?.modelMetrics?.width, 0.1, 300, NaN);

    const blob = new Blob([glbBuffer], { type: "model/gltf-binary" });
    const runtimeUrl = URL.createObjectURL(blob);

    const runtimeState = {
      modelPreset: "",
      modelUrl: runtimeUrl,
      modelScale: String(scale),
      modelHeading: String(heading),
      modelHeightOffset: String(heightOffset),
      modelOffsetX: String(offsetX),
      modelOffsetY: String(offsetY),
      modelStretchX: String(stretchX),
      modelStretchY: String(stretchY),
      modelExpectedHeight: Number.isFinite(expectedHeight) ? String(expectedHeight) : "",
      modelExpectedLength: Number.isFinite(expectedLength) ? String(expectedLength) : "",
      modelExpectedWidth: Number.isFinite(expectedWidth) ? String(expectedWidth) : "",
      modelSnapToBase: snapToBase ? "1" : "0"
    };

    setRuntimeGeneratedModelState(targetSpaceId, sourceCode, runtimeState);

    if (targetSpaceId === linkedSpaceId) {
      const entity = entityMap.get(sourceCode);
      if (entity) {
        await applyModelStateToEntity(entity, runtimeState);

        if (activeEntity && normalizeCode(activeEntity.__sourceCode) === sourceCode) {
          await showEntityInfo(entity);
          const statusEl = byId("applyModelPresetStatus");
          if (statusEl) statusEl.textContent = "已接收生成模型，白模已替换。";
        }
      }
    }

    viewer?.scene.requestRender();
  }

  function bindHouseGeneratorMessageBridge() {
    if (houseGeneratorMessageBound) return;
    houseGeneratorMessageBound = true;
    houseGeneratorMessageHandler = (event) => {
      void handleHouseGeneratorModelMessage(event);
    };
    window.addEventListener("message", houseGeneratorMessageHandler);
  }

  function bindEntityInfoEvents(entity, baseRow, allowEdit) {
    const applyModelBtn = byId("applyModelPresetBtn");
    if (applyModelBtn) {
      applyModelBtn.onclick = async () => {
        const statusEl = byId("applyModelPresetStatus");
        const selectEl = byId("modelPresetSelect");
        const scaleEl = byId("modelScaleInput");
        const scaleRangeEl = byId("modelScaleRange");
        const headingEl = byId("modelHeadingInput");
        const offsetEl = byId("modelHeightOffsetInput");
        const stretchXEl = byId("modelStretchXInput");
        const stretchYEl = byId("modelStretchYInput");
        const offsetXEl = byId("modelOffsetXInput");
        const offsetYEl = byId("modelOffsetYInput");

        const presetId = selectEl?.value || "";
        if (!presetId) {
          if (statusEl) statusEl.textContent = "请选择预设模型";
          return;
        }

        const scaleValue = scaleEl?.value ?? scaleRangeEl?.value;
        const manualScale = clampNumber(scaleValue, 0.1, 120, 1);
        const manualHeading = clampNumber(headingEl?.value, -360, 360, 0);
        const manualOffset = clampNumber(offsetEl?.value, -100, 300, 0);
        const manualStretchX = clampNumber(stretchXEl?.value, 0.1, 20, 1);
        const manualStretchY = clampNumber(stretchYEl?.value, 0.1, 20, 1);
        const manualOffsetX = clampNumber(offsetXEl?.value, -200, 200, 0);
        const manualOffsetY = clampNumber(offsetYEl?.value, -200, 200, 0);

        applyModelBtn.disabled = true;
        if (statusEl) statusEl.textContent = "正在应用模型...";

        try {
          const linkedSpaceId = getLinked2DSpaceIdFor3D();
          const existingEditData = linkedSpaceId !== 'current'
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
              modelStretchX: manualStretchX,
              modelStretchY: manualStretchY,
              modelOffsetX: manualOffsetX,
              modelOffsetY: manualOffsetY
            }
          );

          clearRuntimeGeneratedModelState(linkedSpaceId, entity.__sourceCode);
          await saveSingle3DEdit(entity.__sourceCode, payload);
          await applyModelStateToEntity(entity, payload);

          if (statusEl) statusEl.textContent = "模型已应用并自动贴合。";
          await showEntityInfo(entity);
        } catch (error) {
          console.error("应用模型失败：", error);
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
          const linkedSpaceId = getLinked2DSpaceIdFor3D();
          const existingEditData = linkedSpaceId !== 'current'
            ? (await fetchSingle3DEdit(entity.__sourceCode)) || {}
            : {};
          const baseMerged = { ...(baseRow || {}), ...existingEditData };
          const payload = buildModelPayloadPatchFromPreset("", baseMerged);

          clearRuntimeGeneratedModelState(linkedSpaceId, entity.__sourceCode);
          await saveSingle3DEdit(entity.__sourceCode, payload);
          removeReplacementModel(entity.__sourceCode);

          if (statusEl) statusEl.textContent = "已恢复为白模。";
          await showEntityInfo(entity);
        } catch (error) {
          console.error("Failed to restore white model:", error);
          if (statusEl) statusEl.textContent = `操作失败：${error.message}`;
        } finally {
          removeModelBtn.disabled = false;
        }
      };
    }

    const openGeneratorBtn = byId("openHouseGeneratorBtn");
    if (openGeneratorBtn) {
      openGeneratorBtn.onclick = () => {
        const statusEl = byId("applyModelPresetStatus");
        const opened = openHouseGeneratorForEntity(entity, statusEl);
        if (opened && statusEl) {
          statusEl.textContent = "已打开生成器。生成后点击“应用到主平台”即可替换当前白模。";
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

    const spaces = typeof window.__get2DSpaces === 'function' ? window.__get2DSpaces() : [];
    const currentSpaceId = window.__active2DSpaceId || 'current';
    const currentSpace = spaces.find(s => s.id === currentSpaceId) || { title: "村庄现状" };
    
    currentSelectedEntityCode = "";
    update3DStatusText();

    infoPanel.classList.add("empty");
    infoPanel.innerHTML = "";
  }

  function bindClickEvents() {
    if (!viewer) return;

    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }

    clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    clickHandler.setInputAction(async (movement) => {
      if (measureModeActive) {
        handle3DMeasureClick(movement.position);
        return;
      }

      const picked = viewer.scene.pick(movement.position);

      if (!Cesium.defined(picked)) {
        clearActiveEntity();
        showEmpty3DInfo();
        viewer.scene.requestRender();
        return;
      }

      let entity = null;

      if (picked.id) {
        if (picked.id.__isReplacementAnchor) {
          entity = entityMap.get(normalizeCode(picked.id.__sourceCode || "")) || null;
        } else if (picked.id.__isRoadEntity) {
          entity = null;
        } else if (picked.id.polygon && picked.id.__isBuildingEntity) {
          entity = picked.id;
        }
      }

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

    clickHandler.setInputAction(() => {
      if (!measureModeActive) return;
      toggleMeasureMode(false);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  async function initViewer() {
    if (initialized) return;

    if (typeof Cesium === "undefined") {
      throw new Error("Cesium not found. Please include Cesium.js in index.html first.");
    }

    if (!byId("cesiumContainer")) {
      throw new Error("Cannot find #cesiumContainer. Please check the 3D container in index.html.");
    }

    const canUseIonServices = hasUsableCesiumIonToken();
    if (canUseIonServices) {
      Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;
    } else {
      console.warn("Cesium Ion token 未配置，3D 将跳过在线地形/影像服务。");
    }

    // 尝试加载地形，如果失败则不使用地形
    let terrainProvider = null;
    if (canUseIonServices) {
      try {
        terrainProvider = await withTimeout(
          Cesium.createWorldTerrainAsync(),
          ONLINE_RESOURCE_TIMEOUT_MS,
          "在线地形服务响应超时"
        );
        console.log("在线地形加载成功");
      } catch (error) {
        console.warn("在线地形加载失败：", error?.message || error);
        console.warn("提示：Cesium Ion 服务在中国大陆可能访问受限，建议检查网络或开启代理后刷新页面。");
      }
    }

    const viewerOptions = {
      animation: false,
      timeline: false,
      baseLayer: false,
      imageryProvider: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      shouldAnimate: false
    };
    
    if (terrainProvider) {
      viewerOptions.terrainProvider = terrainProvider;
    }
    
    viewer = new Cesium.Viewer("cesiumContainer", viewerOptions);
    await addViewerImageryLayers(canUseIonServices);

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.maximumScreenSpaceError = PERF_TERRAIN_MAX_SCREEN_SPACE_ERROR;
    viewer.scene.requestRenderMode = true;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    // Disable post-process anti-aliasing and cap render scale to reduce first-open jank.
    viewer.scene.fxaa = false;
    if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
      viewer.scene.postProcessStages.fxaa.enabled = false;
    }
    const deviceScale = Number(window.devicePixelRatio) || 1;
    viewer.resolutionScale = Math.min(deviceScale, PERF_RESOLUTION_SCALE_CAP);
    viewer.camera.percentageChanged = 0.01;
    viewer.camera.changed.addEventListener(() => {
      scheduleRoadWidthSync();
    });

    if (viewer.cesiumWidget && viewer.cesiumWidget.creditContainer) {
      viewer.cesiumWidget.creditContainer.style.display = "none";
    }

    bindClickEvents();
    initialized = true;
  }

  async function enter() {
    await initViewer();
    bindHouseGeneratorMessageBridge();

    if (!buildingsDataSource) {
      await loadBuildings();
    } else {
      await applyCurrent3DSpaceToScene();
      loadRoadsInBackground("enter-refresh");
    }

    // 延迟飞行到建筑物，确保数据已完全加载渲染
    setTimeout(async () => {
      await flyToCurrent3DBuildings();
    }, 300);

    setTimeout(() => {
      if (viewer) {
        viewer.resize();
        viewer.scene.requestRender();
      }
    }, 60);

    update3DStatusText();

    // 与3D同步选中状态
    try {
      const selectedCode2D = window.__active2DSelectedCode;
      if (selectedCode2D && entityMap && entityMap.has && entityMap.has(selectedCode2D)) {
        const entity = entityMap.get(selectedCode2D);
        if (entity) {
          setActiveEntity(entity);
          await showEntityInfo(entity);
        } else {
          showEmpty3DInfo();
        }
      } else if (!activeEntity) {
        showEmpty3DInfo();
      } else {
        await showEntityInfo(activeEntity);
      }
    } catch (error) {
      console.error("Error syncing selection from 2D:", error);
      showEmpty3DInfo();
    }
  }

  async function reload(selectCode) {
    if (!initialized) {
      await enter();
      return;
    }

    const savedSelectedCode = selectCode || activeEntity?.__sourceCode;
    
    await loadBuildings();
    
    if (savedSelectedCode && entityMap.has(normalizeCode(savedSelectedCode))) {
      const entity = entityMap.get(normalizeCode(savedSelectedCode));
      setActiveEntity(entity);
      await showEntityInfo(entity);
    } else {
      showEmpty3DInfo();
    }
    
    viewer.scene.requestRender();
  }
  
  async function flyToCurrent3DBuildings() {
    if (!viewer) {
      console.warn("flyToCurrent3DBuildings: viewer not ready");
      return;
    }
    
    if (!buildingsDataSource) {
      console.warn("flyToCurrent3DBuildings: buildingsDataSource not ready, using recenter");
      recenter();
      return;
    }

    const entities = buildingsDataSource.entities.values || [];
    if (!entities.length) {
      console.warn("flyToCurrent3DBuildings: no entities, using recenter");
      recenter();
      return;
    }

    try {
      await viewer.flyTo(buildingsDataSource, {
        duration: 0.9,
        offset: getOverviewCameraOffset()
      });
    } catch (error) {
      console.warn("3D 自动跳转当前建筑范围失败，尝试使用默认位置", error);
      // 后备方案：飞到默认中心
      recenter();
    }
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

  function recenter() {
    if (!viewer) {
      console.warn("recenter: viewer not ready");
      return;
    }
    
    // 如果有建筑数据，使用与初始化一致的 flyTo 方法
    if (buildingsDataSource) {
      const entities = buildingsDataSource.entities.values || [];
      if (entities.length > 0) {
        viewer.flyTo(buildingsDataSource, {
          duration: 0.9,
          offset: getOverviewCameraOffset()
        });
        return;
      }
    }
    
    // 后备方案：建筑数据未加载时，飞到默认中心
    const georef = getBasemapGeoref();
    const center = Cesium.Cartesian3.fromDegrees(
      (georef.minX + georef.maxX) / 2,
      (georef.minY + georef.maxY) / 2
    );
    
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(center, 100),
      {
        offset: getOverviewCameraOffset(),
        duration: 0.9
      }
    );
  }

  function refreshBuildingHeight(sourceCode, nextHeight) {
    const entity = entityMap.get(normalizeCode(sourceCode));
    if (!entity || !entity.polygon) return false;

    applyHeightToEntity(entity, nextHeight);
    viewer?.scene.requestRender();
    return true;
  }

  async function refreshEntityInfo(sourceCode) {
    if (!sourceCode) return;
    if (!is3DViewActive()) return;
    if (!activeEntity || normalizeCode(activeEntity.__sourceCode) !== normalizeCode(sourceCode)) return;
    await showEntityInfo(activeEntity);
  }

  function destroy() {
    toggleMeasureMode(false);
    roadsLoadToken += 1;
    roadsLoadTask = null;
    if (roadWidthSyncRaf) {
      cancelAnimationFrame(roadWidthSyncRaf);
      roadWidthSyncRaf = 0;
    }

    if (clickHandler) {
      clickHandler.destroy();
      clickHandler = null;
    }

    clearAllReplacementModels();
    clearAllRuntimeGeneratedModels();

    if (houseGeneratorMessageBound && houseGeneratorMessageHandler) {
      window.removeEventListener("message", houseGeneratorMessageHandler);
      houseGeneratorMessageHandler = null;
      houseGeneratorMessageBound = false;
    }

    if (viewer) {
      if (roadsDataSource) {
        viewer.dataSources.remove(roadsDataSource, true);
        roadsDataSource = null;
      }
      viewer.destroy();
      viewer = null;
    }

    initialized = false;
    buildingsDataSource = null;
    roadsDataSource = null;
    roadEntitiesForWidthSync = [];
    clearActiveEntity();
    entityMap.clear();
    currentSelectedEntityCode = "";
  }

  window.Village3D = {
    enter,
    reload,
    flyToBuilding,
    refreshBuildingHeight,
    refreshEntityInfo,
    toggleMeasureMode,
    recenter,
    destroy
  };
})();








