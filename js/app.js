const mainLayout = document.getElementById("mainLayout");
const villageImage = document.getElementById("villageImage");
const svgOverlay = document.getElementById("svgOverlay");
const infoPanel = document.getElementById("infoPanel");
const detailPanel = document.getElementById("detailPanel");
const statusBadge = document.getElementById("statusBadge");
const detailSubtitle = document.getElementById("detailSubtitle");
const storyItems = document.querySelectorAll(".story-item");

const overviewView = document.getElementById("overviewView");
const plan2dView = document.getElementById("plan2dView");
const model3dView = document.getElementById("model3dView");

let housesData = [];
let activePolygon = null;
let polygonMap = new Map();
let currentGeoJSON = null;
let resizeObserver = null;

const SUPABASE_URL = "https://rzmbmwauomzwiyenafha.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1W6jMCgrYY1tzw9nRctBvQ_Vz9GtYUb";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
/* =========================
   基础加载
========================= */

async function loadText(url) {
  const response = await fetch(url);
  return await response.text();
}

async function loadCSV(url) {
  const text = await loadText(url);
  return parseCSV(text);
}

async function loadGeoJSON(url) {
  const response = await fetch(url);
  return await response.json();
}

async function testSupabaseConnection() {
  const { data, error } = await supabaseClient
    .from("house_photos")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Supabase 连接失败：", error);
  } else {
    console.log("Supabase 连接成功，测试数据：", data);
  }
}

async function testStorageAccess() {
  const testFile = new Blob(["hello village"], { type: "text/plain" });
  const testPath = `test-folder/test-${Date.now()}.txt`;

  const { error: uploadError } = await supabaseClient.storage
    .from("house-photos")
    .upload(testPath, testFile);

  if (uploadError) {
    console.error("Storage 上传测试失败：", uploadError);
    return;
  }

  const { data } = supabaseClient.storage
    .from("house-photos")
    .getPublicUrl(testPath);

  console.log("Storage 上传测试成功，公开地址：", data.publicUrl);
}

/* =========================
   解析 CSV
========================= */

function parseCSV(text) {
  const cleanText = text.replace(/^\uFEFF/, "").trim();
  const lines = cleanText.split(/\r?\n/);

  if (!lines.length) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";

  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.replace(/^\uFEFF/, "").replace(/\r/g, "").trim());

  return lines.slice(1).map((line) => {
    const values = line
      .split(delimiter)
      .map((v) => v.replace(/\r/g, "").trim());

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

/* =========================
   编码统一
========================= */

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
  return (
    p.NAME ||
    p.name ||
    p.Name ||
    p.房屋编码 ||
    p.房屋编号 ||
    p.code ||
    p.Code ||
    p.CODE ||
    p.id ||
    p.ID ||
    ""
  );
}

function getHouseCode(row) {
  return (
    row["房屋编码"] ||
    row["房屋编号"] ||
    row["编码"] ||
    row["code"] ||
    row["Code"] ||
    row["CODE"] ||
    row["id"] ||
    row["ID"] ||
    ""
  );
}

/* =========================
   SVG 跟随图片显示区域
========================= */

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

/* =========================
   GeoJSON 坐标 -> 图片坐标
========================= */

function qgisPointToImagePoint([x, y]) {
  const OFFSET_X = 0;
  const OFFSET_Y = 0;
  return [x + OFFSET_X, -y + OFFSET_Y];
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

/* =========================
   修复视图切换时的 SVG 错位
========================= */

function refresh2DOverlay() {
  if (!currentGeoJSON || !housesData.length) return;
  if (!plan2dView.classList.contains("active")) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ok = setupSVGSize();
      if (ok) {
        drawGeoJSONBuildings(currentGeoJSON, housesData);
      }

      // 再补一次，防止 grid / object-fit 在下一拍才稳定
      setTimeout(() => {
        if (!plan2dView.classList.contains("active")) return;
        const ok2 = setupSVGSize();
        if (ok2) {
          drawGeoJSONBuildings(currentGeoJSON, housesData);
        }
      }, 80);
    });
  });
}

/* =========================
   视图切换
========================= */

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
  } else if (mode === "plan2d") {
    plan2dView.classList.add("active");
    statusBadge.textContent = `房屋数量：${currentGeoJSON?.features?.length || 0}`;
    detailSubtitle.textContent = "点击地图中的房屋查看详情";
    refresh2DOverlay();
  } else if (mode === "model3d") {
    model3dView.classList.add("active");
    statusBadge.textContent = "当前模式：村庄 3D 模型";
    detailSubtitle.textContent = "当前显示三维模型说明";
  }
}

/* =========================
   绘制建筑轮廓
========================= */

function drawGeoJSONBuildings(geojson, housesData) {
  svgOverlay.innerHTML = "";
  polygonMap.clear();

  const houseMap = new Map();
  housesData.forEach((row) => {
    const normCode = normalizeCode(getHouseCode(row));
    if (normCode) {
      houseMap.set(normCode, row);
    }
  });

  geojson.features.forEach((feature) => {
    const rawCode = getFeatureCode(feature);
    const normCode = normalizeCode(rawCode);
    const row = houseMap.get(normCode) || null;

    const points = geometryToSVGPoints(feature);
    if (!points.length) return;

    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", pointsToString(points));
    polygon.setAttribute("class", "house-polygon");
    polygon.dataset.code = rawCode || "";

    polygon.addEventListener("click", () => {
      switchMode("plan2d");
      setActiveStoryView("plan2d");
      setActivePolygon(polygon);

      if (row) {
        showHouseInfo(row);
      } else {
        showUnmatchedHouseInfo(rawCode);
      }
    });

    svgOverlay.appendChild(polygon);
    polygonMap.set(rawCode, { polygon, row });
  });
}

/* =========================
   状态切换
========================= */

function setActivePolygon(polygon) {
  if (activePolygon) {
    activePolygon.classList.remove("active");
  }

  if (polygon) {
    polygon.classList.add("active");
    activePolygon = polygon;
  } else {
    activePolygon = null;
  }
}

/* =========================
   右侧信息
========================= */

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

  infoPanel.classList.add("empty");
  infoPanel.innerHTML = `
    <div class="placeholder-block">
      <h3>村庄 2D 平面建筑轮廓</h3>
      <p>当前展示的是村庄航拍图与建筑轮廓热区。点击中间航拍图中的建筑轮廓，右侧将显示对应房屋信息与照片。</p>
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

function showUnmatchedHouseInfo(code) {
  infoPanel.classList.remove("empty");
  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">未匹配房屋</h3>
      <div class="house-row"><span class="house-label">房屋编码：</span>${code || "-"}</div>
      <div class="house-row">该建筑轮廓已读取，但没有在 houses.csv 中找到对应的房屋信息。</div>
    </div>
  `;
}

async function fetchHousePhotos(houseCode) {
  const { data, error } = await supabaseClient
    .from("house_photos")
    .select("*")
    .eq("house_code", houseCode)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("读取房屋照片失败：", error);
    return [];
  }

  return data || [];
}

async function handlePhotoUpload(row) {
  const input = document.getElementById("photoUploadInput");
  const statusEl = document.getElementById("uploadStatus");

  if (!input || !input.files || !input.files.length) {
    if (statusEl) statusEl.textContent = "请先选择一张图片。";
    return;
  }

  const file = input.files[0];
  const houseCode = row["房屋编码"] || "UNKNOWN";

  if (file.size > 6 * 1024 * 1024) {
    if (statusEl) statusEl.textContent = "请上传 6MB 以内图片。";
    return;
  }

  if (statusEl) statusEl.textContent = "正在上传...";

  const fileExt = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
  const filePath = `${houseCode}/${safeName}`;

  const { error: uploadError } = await supabaseClient.storage
    .from("house-photos")
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
    .from("house-photos")
    .getPublicUrl(filePath);

  const photoUrl = publicData?.publicUrl || "";

  const { error: insertError } = await supabaseClient
    .from("house_photos")
    .insert([
      {
        house_code: houseCode,
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

  await showHouseInfo(row);
}

async function showHouseInfo(row) {
  infoPanel.classList.remove("empty");

  const houseCode = row["房屋编码"] || "";
  const dbPhotos = await fetchHousePhotos(houseCode);

  const csvPhotoList = (row["照片"] || "")
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item !== "");

  const mergedPhotos = [
    ...csvPhotoList.map((src) => ({ src, source: "csv" })),
    ...dbPhotos.map((item) => ({ src: item.photo_url, source: "db" }))
  ];

  const photosHtml = mergedPhotos.length
    ? `
      <div class="photo-card">
        <div class="photo-slider-wrapper">
          <div class="photo-slider">
            ${mergedPhotos
              .map(
                (item, index) => `
              <div class="photo-slide">
                <img
                  class="house-photo"
                  src="${item.src}"
                  alt="${row["房屋名称"] || "房屋照片"}-${index + 1}"
                  onerror="this.style.display='none'; this.insertAdjacentHTML('afterend', '<div class=&quot;img-error&quot;>图片加载失败：${item.src}</div>')"
                >
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>
    `
    : `<div class="no-photo">暂无照片</div>`;

  infoPanel.innerHTML = `
    <div class="info-card">
      <h3 class="house-title">${row["房屋名称"] || "未命名房屋"}</h3>
      <div class="house-row"><span class="house-label">房屋编码：</span>${houseCode || "-"}</div>
      <div class="house-row"><span class="house-label">建成年代：</span>${row["建成年代"] || "-"}</div>
      <div class="house-row"><span class="house-label">占地面积：</span>${row["占地面积"] || "-"} ㎡</div>
    </div>

    <div class="info-card">
      <h3 class="house-title">上传照片</h3>
      <div class="house-row">
        <input type="file" id="photoUploadInput" accept="image/*" />
      </div>
      <div class="house-row">
        <button id="uploadPhotoBtn" class="upload-btn">上传到该房屋</button>
      </div>
      <div class="house-row" id="uploadStatus"></div>
    </div>

    <div class="house-row"><span class="house-label">房屋照片：</span></div>
    ${photosHtml}
  `;

  const uploadBtn = document.getElementById("uploadPhotoBtn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      await handlePhotoUpload(row);
    });
  }
}

/* =========================
   左侧点击绑定
========================= */

function bindStoryEvents() {
  storyItems.forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view || "";

      if (view === "overview") {
        showVillageOverview();
      } else if (view === "plan2d") {
        showPlan2DOverview();
      } else if (view === "model3d") {
        showModel3DOverview();
      }
    });
  });
}

/* =========================
   监听容器尺寸变化，进一步防止错位
========================= */

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

/* =========================
   初始化
========================= */

async function init() {
  try {
    housesData = await loadCSV("data/houses.csv");
    currentGeoJSON = await loadGeoJSON("data/buildings.geojson");

    const afterImageReady = () => {
      bindStoryEvents();
      bindResizeObserver();
      showVillageOverview();
    };

    if (villageImage.complete) {
      afterImageReady();
    } else {
      villageImage.onload = afterImageReady;
    }

    window.addEventListener("resize", () => {
      if (plan2dView.classList.contains("active")) {
        refresh2DOverlay();
      }
    });

    console.log("housesData:", housesData);
    console.log("housesData keys:", housesData[0] ? Object.keys(housesData[0]) : []);
    console.log("geojson:", currentGeoJSON);
  } catch (error) {
    console.error("初始化失败：", error);
    infoPanel.classList.remove("empty");
    infoPanel.innerHTML = `
      <div class="placeholder-block">
        <h3>加载失败</h3>
        <p>请检查 houses.csv、buildings.geojson、orthophoto.jpg 和照片路径是否正确。</p>
      </div>
    `;
  }
}

init();