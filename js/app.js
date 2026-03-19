const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const PHOTO_BUCKET = "house-photos";
const OBJECT_PHOTOS_TABLE = "object_photos";

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

const substoryList = document.getElementById("substoryList");
const substoryItems = document.querySelectorAll(".substory-item");

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
let currentGeoJSON = null;
let current2DLayer = "building";
let currentLayerTableData = [];
let resizeObserver = null;

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
  }
};

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
    substoryList
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

async function load2DLayer(layerKey) {
  const config = layerConfigs[layerKey];
  if (!config) return;

  current2DLayer = layerKey;
  currentLayerTableData = await loadCSVOrEmpty(config.tableUrl);
  currentGeoJSON = await loadGeoJSON(config.geojsonUrl);

  setActiveSubstory(layerKey);

  if (plan2dView.classList.contains("active")) {
    refresh2DOverlay();
  }

  showLayerOverview(layerKey);
}

function refresh2DOverlay() {
  if (!currentGeoJSON || !plan2dView.classList.contains("active")) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (setupSVGSize()) {
        drawGeoJSONLayer(currentGeoJSON, currentLayerTableData, current2DLayer);
      }

      setTimeout(() => {
        if (!plan2dView.classList.contains("active")) return;
        if (setupSVGSize()) {
          drawGeoJSONLayer(currentGeoJSON, currentLayerTableData, current2DLayer);
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

function setActiveSubstory(layerKey) {
  substoryItems.forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.layer === layerKey) {
      item.classList.add("active");
    }
  });
}

function switchMode(mode) {
  mainLayout.classList.remove("mode-overview");
  hideAllViews();
  if (substoryList) substoryList.classList.remove("active");

  if (mode === "overview") {
    mainLayout.classList.add("mode-overview");
    overviewView.classList.add("active");
    statusBadge.textContent = "当前模式：村庄基本信息";
    detailSubtitle.textContent = "当前模式为整合展示";
  } else if (mode === "plan2d") {
    plan2dView.classList.add("active");
    statusBadge.textContent = `当前图层：${layerConfigs[current2DLayer]?.label || "2D图层"}`;
    detailSubtitle.textContent = "点击图层对象查看详情";
    if (substoryList) substoryList.classList.add("active");
    refresh2DOverlay();
  } else if (mode === "model3d") {
    model3dView.classList.add("active");
    statusBadge.textContent = "当前模式：村庄 3D 模型";
    detailSubtitle.textContent = "当前显示三维模型说明";
  }
}

function drawGeoJSONLayer(geojson, tableData, layerKey) {
  svgOverlay.innerHTML = "";
  polygonMap.clear();

  const rowMap = new Map();
  tableData.forEach((row) => {
    const normCode = normalizeCode(getRowCode(row, layerKey));
    if (normCode) rowMap.set(normCode, row);
  });

  geojson.features.forEach((feature) => {
    const rawCode = getFeatureCode(feature);
    const normCode = normalizeCode(rawCode);
    const row = rowMap.get(normCode) || null;

    const points = geometryToSVGPoints(feature);
    if (!points.length) return;

    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", pointsToString(points));
    polygon.setAttribute("class", "house-polygon");
    polygon.dataset.code = rawCode || "";
    polygon.dataset.layer = layerKey;

    polygon.addEventListener("click", async () => {
      switchMode("plan2d");
      setActiveStoryView("plan2d");
      setActiveSubstory(layerKey);
      setActivePolygon(polygon);

      if (row) {
        await showObjectInfo(row, layerKey);
      } else {
        showUnmatchedObjectInfo(rawCode, layerKey);
      }
    });

    svgOverlay.appendChild(polygon);
    polygonMap.set(rawCode, { polygon, row, layerKey });
  });
}

function setActivePolygon(polygon) {
  if (activePolygon) activePolygon.classList.remove("active");
  if (polygon) {
    polygon.classList.add("active");
    activePolygon = polygon;
  } else {
    activePolygon = null;
  }
}

async function fetchObjectPhotos(objectCode, objectType) {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from(OBJECT_PHOTOS_TABLE)
    .select("*")
    .eq("object_code", objectCode)
    .eq("object_type", objectType)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("读取对象照片失败：", error);
    return [];
  }
  return data || [];
}

async function handlePhotoUpload(row, layerKey) {
  const input = document.getElementById("photoUploadInput");
  const statusEl = document.getElementById("uploadStatus");
  const config = layerConfigs[layerKey];
  const objectCode = getRowCode(row, layerKey);
  const objectType = config?.objectType || "";

  if (!supabaseClient) {
    if (statusEl) statusEl.textContent = "请先在 app.js 顶部填入真实的 Supabase URL 和 publishable key。";
    return;
  }

  if (!input || !input.files || !input.files.length) {
    if (statusEl) statusEl.textContent = "请先选择一张图片。";
    return;
  }

  const file = input.files[0];
  if (!objectCode || !objectType) {
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
  const filePath = `${objectType}/${objectCode}/${safeName}`;

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
        object_code: objectCode,
        object_type: objectType,
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
  await showObjectInfo(row, layerKey);
}

async function handlePhotoDelete(photoItem, row, layerKey) {
  const statusEl = document.getElementById("uploadStatus");

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
  await showObjectInfo(row, layerKey);
}

function showVillageOverview() {
  setActivePolygon(null);
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
  setActiveStoryView("plan2d");
  switchMode("plan2d");
  showLayerOverview(current2DLayer);
}

function showLayerOverview(layerKey) {
  const config = layerConfigs[layerKey];
  if (!config) return;

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>${config.label}</h3>
      <p>当前展示的是“${config.label}”图层。点击中间图上的对象，可在右侧查看对应信息，并可上传或删除该对象照片。</p>
    </div>
  `;
}

function showModel3DOverview() {
  setActivePolygon(null);
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
  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">未匹配${label}</h3>
      <div class="house-row"><span class="house-label">对象编码：</span>${code || "-"}</div>
      <div class="house-row">该图层对象已读取，但没有在对应的数据表中找到匹配信息。</div>
    </div>
  `;
}

function buildObjectDetailHtml(row, layerKey) {
  if (layerKey === "building") {
    return `
      <div class="house-row"><span class="house-label">房屋编码：</span>${row["房屋编码"] || row["编码"] || "-"}</div>
      <div class="house-row"><span class="house-label">房屋名称：</span>${row["房屋名称"] || row["名称"] || "-"}</div>
      <div class="house-row"><span class="house-label">建成年代：</span>${row["建成年代"] || "-"}</div>
      <div class="house-row"><span class="house-label">占地面积：</span>${row["占地面积"] || "-"} ㎡</div>
    `;
  }

  if (layerKey === "road") {
    return `
      <div class="house-row"><span class="house-label">道路编码：</span>${row["道路编码"] || row["编码"] || "-"}</div>
      <div class="house-row"><span class="house-label">道路名称：</span>${row["道路名称"] || row["名称"] || "-"}</div>
      <div class="house-row"><span class="house-label">道路类型：</span>${row["道路类型"] || "-"}</div>
      <div class="house-row"><span class="house-label">路面材质：</span>${row["路面材质"] || "-"}</div>
    `;
  }

  if (layerKey === "cropland") {
    return `
      <div class="house-row"><span class="house-label">农田编码：</span>${row["农田编码"] || row["编码"] || "-"}</div>
      <div class="house-row"><span class="house-label">农田名称：</span>${row["农田名称"] || row["名称"] || "-"}</div>
      <div class="house-row"><span class="house-label">作物类型：</span>${row["作物类型"] || "-"}</div>
      <div class="house-row"><span class="house-label">面积：</span>${row["面积"] || "-"} ㎡</div>
    `;
  }

  if (layerKey === "openSpace") {
    return `
      <div class="house-row"><span class="house-label">空间编码：</span>${row["公共空间编码"] || row["编码"] || "-"}</div>
      <div class="house-row"><span class="house-label">空间名称：</span>${row["公共空间名称"] || row["名称"] || "-"}</div>
      <div class="house-row"><span class="house-label">空间类型：</span>${row["空间类型"] || "-"}</div>
      <div class="house-row"><span class="house-label">面积：</span>${row["面积"] || "-"} ㎡</div>
    `;
  }

  return `<div class="house-row"><span class="house-label">编码：</span>${getRowCode(row, layerKey) || "-"}</div>`;
}

async function showObjectInfo(row, layerKey) {
  const config = layerConfigs[layerKey];
  const objectCode = getRowCode(row, layerKey);
  const objectType = config?.objectType || "";
  const objectName = getRowName(row, layerKey) || config?.label || "对象";

  const dbPhotos = objectCode && objectType ? await fetchObjectPhotos(objectCode, objectType) : [];
  const csvPhotoList = getRowPhotoValue(row, layerKey)
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

  const detailHtml = buildObjectDetailHtml(row, layerKey);

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
                  alt="${objectName}-${index + 1}"
                  onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<div class=&quot;img-error&quot;>图片加载失败：${item.src}</div>')"
                >
                ${
                  item.source === "db"
                    ? `<div class="photo-actions">
                         <button class="delete-photo-btn" data-photo-id="${item.id}" type="button">删除这张照片</button>
                       </div>`
                    : `<div class="photo-source-tag">本地预置照片</div>`
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
    <div class="info-card">
      <h3 class="house-title">${config?.label || "对象"}信息</h3>
      ${detailHtml}
    </div>

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

    <div class="house-row"><span class="house-label">对象照片：</span></div>
    ${photosHtml}
  `;

  const uploadBtn = document.getElementById("uploadPhotoBtn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      await handlePhotoUpload(row, layerKey);
    });
  }

  const deleteButtons = document.querySelectorAll(".delete-photo-btn");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photoId = Number(btn.dataset.photoId);
      const targetPhoto = dbPhotos.find((item) => item.id === photoId);
      if (targetPhoto) {
        await handlePhotoDelete(targetPhoto, row, layerKey);
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
        await load2DLayer(current2DLayer);
        showPlan2DOverview();
      } else if (view === "model3d") {
        showModel3DOverview();
      }
    });
  });

  substoryItems.forEach((item) => {
    item.addEventListener("click", async () => {
      const layerKey = item.dataset.layer;
      if (!layerKey) return;
      setActiveStoryView("plan2d");
      switchMode("plan2d");
      await load2DLayer(layerKey);
    });
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

async function init() {
  if (!hasRequiredNewLayout()) {
    console.error("index.html 仍是旧版结构，请同步替换新版 index.html。");
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
    await load2DLayer("building");
    bindStoryEvents();
    bindResizeObserver();
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