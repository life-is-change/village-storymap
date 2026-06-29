import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const els = {
  presetList: document.getElementById('presetList'),
  presetCount: document.getElementById('presetCount'),
  searchInput: document.getElementById('searchInput'),
  lengthInput: document.getElementById('lengthInput'),
  widthInput: document.getElementById('widthInput'),
  floorsInput: document.getElementById('floorsInput'),
  floorHeightInput: document.getElementById('floorHeightInput'),
  generateBtn: document.getElementById('generateBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  sendBtn: document.getElementById('sendBtn'),
  statusText: document.getElementById('statusText'),
  progressFill: document.getElementById('progressFill'),
  downloadLink: document.getElementById('downloadLink'),
  viewer: document.getElementById('viewer'),
  activeLabel: document.getElementById('activeLabel')
};

const state = {
  meta: null,
  presets: [],
  selected: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  currentGroup: null,
  currentBlob: null,
  currentUrl: null,
  targetCode: '',
  targetSpace: 'current',
  targetName: ''
};

init();

async function init() {
  parseTargetParams();
  initThree();
  bindEvents();
  await loadMeta();
}

function parseTargetParams() {
  const params = new URLSearchParams(window.location.search);
  state.targetCode = String(params.get('targetCode') || '').trim();
  state.targetSpace = String(params.get('targetSpace') || 'current').trim() || 'current';
  state.targetName = String(params.get('targetName') || '').trim();
}

function bindEvents() {
  els.searchInput.addEventListener('input', renderPresetList);
  els.generateBtn.addEventListener('click', generateModel);
  els.downloadBtn.addEventListener('click', downloadGlb);
  els.sendBtn.addEventListener('click', replaceOriginalBuilding);
}

async function loadMeta() {
  try {
    setProgress(8, '读取 normalization_meta.json ...');
    const res = await fetch('./normalization_meta.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`normalization_meta.json 读取失败：${res.status}`);

    state.meta = await res.json();
    state.presets = [...(state.meta.presets || [])].sort(sortPreset);
    if (!state.presets.length) throw new Error('normalization_meta.json 中没有 presets。');

    state.selected = state.presets[0];
    applyPresetToInputs(state.selected);
    renderPresetList();
    setProgress(20, `已载入 ${state.presets.length} 个建筑预设`);
    setStatus('已载入预设。点击左侧样式后，基础参数会自动同步。');
  } catch (err) {
    console.error(err);
    setProgress(0, '加载失败');
    setStatus(`加载失败：${err.message}\n请使用本地静态服务打开 index.html。`, true);
  }
}

function sortPreset(a, b) {
  const pa = String(a.id || '').split('-').map(Number);
  const pb = String(b.id || '').split('-').map(Number);
  return (pa[0] || 0) - (pb[0] || 0) || (pa[1] || 0) - (pb[1] || 0);
}

function renderPresetList() {
  const q = els.searchInput.value.trim().toLowerCase();
  const filtered = state.presets.filter((preset) => {
    const text = `${preset.id} ${preset.name || ''} ${preset.floors}层 ${preset.dimensions?.length} ${preset.dimensions?.width}`.toLowerCase();
    return !q || text.includes(q);
  });

  els.presetCount.textContent = `${filtered.length}/${state.presets.length}`;
  els.presetList.innerHTML = '';

  for (const preset of filtered) {
    const card = document.createElement('article');
    card.className = `preset-card ${state.selected?.id === preset.id ? 'active' : ''}`;
    card.innerHTML = `
      <img src="${preset.url}" alt="${preset.id}" loading="lazy" />
      <div class="preset-info">
        <div>
          <h3>${preset.id}</h3>
          <p>${preset.floors} 层建筑样式</p>
          <p>L=${formatNum(preset.dimensions?.length)}m, W=${formatNum(preset.dimensions?.width)}m</p>
        </div>
        <button class="choose" type="button">${state.selected?.id === preset.id ? '当前样式' : '选择此样式'}</button>
      </div>`;
    card.addEventListener('click', () => selectPreset(preset));
    els.presetList.appendChild(card);
  }
}

function selectPreset(preset) {
  state.selected = preset;
  applyPresetToInputs(preset);
  renderPresetList();
  setStatus(`已选择 ${preset.id}，基础参数已同步更新。可直接生成，也可继续微调。`);
}

function applyPresetToInputs(preset) {
  els.lengthInput.value = formatInputDimension(preset.dimensions?.length ?? 10);
  els.widthInput.value = formatInputDimension(preset.dimensions?.width ?? 7);
  els.floorsInput.value = preset.floors ?? 2;
  els.floorHeightInput.value = formatInputDimension(preset.dimensions?.floorHeight ?? 3);
  els.activeLabel.textContent = `当前：${preset.id}`;
}

async function generateModel() {
  if (!state.selected) return;
  const preset = state.selected;

  try {
    els.generateBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.sendBtn.disabled = true;
    clearCurrentUrl();

    setProgress(28, '读取四立面图片...');
    setStatus(`正在处理 ${preset.id}：按 JSON 参数拆分 front/back/left/right。`);
    const image = await loadImage(preset.url);

    setProgress(45, '裁切立面贴图...');
    const extracted = extractFacadeTextures(image, preset);

    setProgress(62, '生成 3D 建筑...');
    const config = readConfig(preset);
    const group = createBuildingGroup(preset, config, extracted.textures);
    replaceModel(group);
    frameModel(group);

    setProgress(82, '导出 GLB ...');
    const { blob, url } = await exportGlb(group);
    state.currentBlob = blob;
    state.currentUrl = url;
    els.downloadBtn.disabled = false;
    els.sendBtn.disabled = false;
    els.downloadLink.innerHTML = `<a href="${url}" download="${preset.id}.glb">下载 ${preset.id}.glb</a>`;
    setProgress(100, '生成完成');
    setStatus(buildGenerateCompleteMessage(preset.id));
  } catch (err) {
    console.error(err);
    setProgress(0, '生成失败');
    setStatus(`生成失败：${err.message}`, true);
  } finally {
    els.generateBtn.disabled = false;
  }
}

function buildGenerateCompleteMessage(presetId) {
  if (state.targetCode && window.opener) {
    return `生成完成：${presetId}\n可下载 GLB，也可点击“替换原建筑”同步到主平台。`;
  }
  return `生成完成：${presetId}\n可下载 GLB。`;
}

function readConfig(preset) {
  const floors = clamp(Number(els.floorsInput.value || preset.floors || 2), 1, 8);
  const floorHeight = clamp(Number(els.floorHeightInput.value || preset.dimensions?.floorHeight || 3), 2.4, 6);

  return {
    length: clamp(Number(els.lengthInput.value || preset.dimensions?.length || 10), 3, 100),
    width: clamp(Number(els.widthInput.value || preset.dimensions?.width || 7), 3, 100),
    floors,
    floorHeight,
    bodyHeight: floors * floorHeight
  };
}

function extractFacadeTextures(image, preset) {
  const textures = {};

  for (const side of ['front', 'back', 'left', 'right']) {
    const facade = preset.facades?.[side];
    if (!facade) throw new Error(`${preset.id} 缺少 ${side} 立面参数。`);

    const rect = getPixelCrop(image, facade);
    const canvas = cropToCanvas(image, rect, 1024);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, state.renderer.capabilities.getMaxAnisotropy?.() || 4);
    texture.needsUpdate = true;
    textures[side] = texture;
  }

  return { textures };
}

function getPixelCrop(image, facade) {
  if (facade.pixelCrop) {
    return {
      x: facade.pixelCrop.x,
      y: facade.pixelCrop.y,
      w: facade.pixelCrop.w,
      h: facade.pixelCrop.h
    };
  }

  if (facade.sourceCrop) {
    return {
      x: facade.sourceCrop.x * image.width,
      y: facade.sourceCrop.y * image.height,
      w: facade.sourceCrop.w * image.width,
      h: facade.sourceCrop.h * image.height
    };
  }

  const quadrant = state.meta.imageLayout?.quadrants?.[facade.quadrant || 'front'];
  if (!quadrant) throw new Error('找不到 crop 参数。');

  return {
    x: quadrant.x * image.width,
    y: quadrant.y * image.height,
    w: quadrant.w * image.width,
    h: quadrant.h * image.height
  };
}

function cropToCanvas(image, rect, longSide = 1024) {
  const aspect = rect.w / rect.h;
  let w;
  let h;

  if (aspect >= 1) {
    w = longSide;
    h = Math.max(64, Math.round(longSide / aspect));
  } else {
    h = longSide;
    w = Math.max(64, Math.round(longSide * aspect));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return canvas;
}

function createBuildingGroup(preset, config, textures) {
  const group = new THREE.Group();
  group.name = `rural_house_${preset.id}`;
  group.userData = {
    app: 'rural-house-front-end-generator',
    presetId: preset.id,
    floors: config.floors,
    dimensions: {
      length: config.length,
      width: config.width,
      height: config.bodyHeight
    }
  };

  const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  const core = new THREE.Mesh(new THREE.BoxGeometry(config.length, config.bodyHeight, config.width), coreMat);
  core.name = 'white_core_body';
  core.position.y = config.bodyHeight / 2;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  group.add(createFacadePlanes(config, textures));
  group.add(createRoof(preset.roof || {}, config));
  group.add(createBase(config));
  return group;
}

function createFacadePlanes(config, textures) {
  const group = new THREE.Group();
  group.name = 'facade_textures';
  const eps = 0.018;
  const createMat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.88, side: THREE.FrontSide });

  const front = new THREE.Mesh(new THREE.PlaneGeometry(config.length, config.bodyHeight), createMat(textures.front));
  front.name = 'facade_front';
  front.position.set(0, config.bodyHeight / 2, config.width / 2 + eps);
  group.add(front);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(config.length, config.bodyHeight), createMat(textures.back));
  back.name = 'facade_back';
  back.position.set(0, config.bodyHeight / 2, -config.width / 2 - eps);
  back.rotation.y = Math.PI;
  group.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(config.width, config.bodyHeight), createMat(textures.left));
  left.name = 'facade_left';
  left.position.set(-config.length / 2 - eps, config.bodyHeight / 2, 0);
  left.rotation.y = -Math.PI / 2;
  group.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(config.width, config.bodyHeight), createMat(textures.right));
  right.name = 'facade_right';
  right.position.set(config.length / 2 + eps, config.bodyHeight / 2, 0);
  right.rotation.y = Math.PI / 2;
  group.add(right);

  return group;
}

function createBase(config) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(config.length * 1.04, 0.16, config.width * 1.04), mat);
  mesh.name = 'base_plinth';
  mesh.position.y = 0.08;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoof(roofInfo, config) {
  const roofHeight = Math.max(0.45, Number(roofInfo.height || 0) || config.bodyHeight * Number(roofInfo.heightRatioToBody || 0.24));
  const overhang = Math.max(0.08, config.width * Number(roofInfo.overhangRatioToWidth || 0.05));
  const mat = createRoofMaterial(roofInfo.material || {});
  const type = String(roofInfo.type || '').toLowerCase();

  if (type.includes('hip')) return createHipRoof(config.length, config.width, config.bodyHeight, roofHeight, overhang, mat);
  return createGableRoof(config.length, config.width, config.bodyHeight, roofHeight, overhang, mat, type.includes('front'));
}

function createGableRoof(length, width, y0, h, over, mat, ridgeAlongZ = false) {
  const L = length / 2 + over;
  const W = width / 2 + over;
  const y1 = y0 + h;
  let positions;
  let uvs;
  let indices;

  if (!ridgeAlongZ) {
    positions = new Float32Array([
      -L, y0, W, L, y0, W, L, y1, 0, -L, y1, 0,
      -L, y1, 0, L, y1, 0, L, y0, -W, -L, y0, -W,
      L, y0, W, L, y0, -W, L, y1, 0,
      -L, y0, -W, -L, y0, W, -L, y1, 0
    ]);
    uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1]);
    indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  } else {
    positions = new Float32Array([
      -L, y0, -W, -L, y0, W, 0, y1, W, 0, y1, -W,
      0, y1, -W, 0, y1, W, L, y0, W, L, y0, -W,
      -L, y0, W, L, y0, W, 0, y1, W,
      L, y0, -W, -L, y0, -W, 0, y1, -W
    ]);
    uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1]);
    indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'roof_gable';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHipRoof(length, width, y0, h, over, mat) {
  const L = length / 2 + over;
  const W = width / 2 + over;
  const y1 = y0 + h;
  const ridge = Math.max(0.05, L * 0.42);
  const vertices = [
    [-L, y0, W], [L, y0, W], [L, y0, -W], [-L, y0, -W],
    [-ridge, y1, 0], [ridge, y1, 0]
  ];
  const faces = [
    [0, 1, 5, 4], [3, 4, 5, 2], [1, 2, 5], [3, 0, 4]
  ];

  const pos = [];
  const uv = [];
  const idx = [];

  for (const face of faces) {
    const start = pos.length / 3;
    for (const vertexIndex of face) pos.push(...vertices[vertexIndex]);

    if (face.length === 4) {
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
    } else {
      uv.push(0, 0, 1, 0, 0.5, 1);
      idx.push(start, start + 1, start + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'roof_hip';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoofMaterial(info) {
  const tex = proceduralRoofTexture(info);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(info.baseColor || '#2d2d30'),
    map: tex,
    roughness: Number(info.roughness ?? 0.86),
    side: THREE.DoubleSide
  });
}

function proceduralRoofTexture(info) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = info.baseColor || '#303033';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = info.tileColor || '#1f1f22';
  ctx.lineWidth = 3;

  for (let y = 10; y < 128; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 18) {
      ctx.quadraticCurveTo(x + 9, y + 5, x + 18, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#fff';
  for (let x = 0; x < 256; x += 30) ctx.fillRect(x, 0, 2, 128);
  ctx.globalAlpha = 1;

  return new THREE.CanvasTexture(canvas);
}

function initThree() {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  els.viewer.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 8;
  controls.maxDistance = 90;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.enablePan = false;

  scene.add(new THREE.AmbientLight(0xffffff, 1.35));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(14, 18, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-10, 8, -10);
  scene.add(fill);

  const grid = new THREE.GridHelper(60, 60, 0x9eb1c3, 0xd6e1eb);
  grid.name = 'grid';
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ opacity: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;

  resetIdleCamera();
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

function resetIdleCamera() {
  state.controls.target.set(0, 0, 0);
  state.camera.position.set(0, 18, 24);
  state.camera.lookAt(0, 0, 0);
  state.controls.update();
}

function resizeRenderer() {
  const rect = els.viewer.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(360, rect.height);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height, false);
}

function replaceModel(group) {
  if (state.currentGroup) {
    state.scene.remove(state.currentGroup);
    state.currentGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose?.();
        });
      }
    });
  }

  state.currentGroup = group;
  state.scene.add(group);
}

function frameModel(group) {
  const box = new THREE.Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 6);
  const aspect = Math.max(state.camera.aspect || 1, 1);
  const vFov = THREE.MathUtils.degToRad(state.camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fitHeightDistance = radius / Math.tan(vFov / 2);
  const fitWidthDistance = radius / Math.tan(hFov / 2);
  const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.55;
  const target = new THREE.Vector3(center.x, center.y * 0.45, center.z);
  const viewDirection = new THREE.Vector3(0.72, 0.48, 1).normalize();

  state.controls.target.copy(target);
  state.camera.position.copy(target).addScaledVector(viewDirection, distance);
  state.camera.near = Math.max(0.1, distance / 100);
  state.camera.far = Math.max(1000, distance * 10);
  state.camera.updateProjectionMatrix();
  state.camera.lookAt(state.controls.target);
  state.controls.update();
}

function exportGlb(group) {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (arrayBuffer) => {
        const blob = new Blob([arrayBuffer], { type: 'model/gltf-binary' });
        resolve({ blob, url: URL.createObjectURL(blob) });
      },
      reject,
      { binary: true, embedImages: true, onlyVisible: true }
    );
  });
}

function downloadGlb() {
  if (!state.currentUrl || !state.selected) return;
  const link = document.createElement('a');
  link.href = state.currentUrl;
  link.download = `${state.selected.id}.glb`;
  link.click();
}

async function replaceOriginalBuilding() {
  if (!state.currentBlob || !state.selected) {
    setStatus('请先生成 GLB 模型，再替换原建筑。', true);
    return;
  }

  if (!window.opener || window.opener.closed) {
    setStatus('未找到主平台窗口，请从 3D 模块点击“生成模型”打开本页。', true);
    return;
  }

  if (!state.targetCode) {
    setStatus('缺少目标建筑编码，无法替换原建筑。', true);
    return;
  }

  try {
    els.sendBtn.disabled = true;
    setStatus('正在把生成模型发送回主平台...');

    const config = readConfig(state.selected);
    const roofHeight = Math.max(
      0.45,
      Number(state.selected?.roof?.height || 0) || config.bodyHeight * Number(state.selected?.roof?.heightRatioToBody || 0.24)
    );
    const glbBuffer = await state.currentBlob.arrayBuffer();

    window.opener.postMessage(
      {
        type: 'village-house-generator:model-ready',
        payload: {
          sourceCode: state.targetCode,
          sourceName: state.targetName,
          spaceId: state.targetSpace,
          presetId: state.selected.id,
          glbBuffer,
          modelScale: 10,
          modelHeading: 0,
          modelHeightOffset: 0,
          modelMetrics: {
            totalHeight: config.bodyHeight + roofHeight,
            length: config.length,
            width: config.width
          }
        }
      },
      window.location.origin,
      [glbBuffer]
    );

    setStatus('模型已发送，正在返回 3D 模块...');
    try {
      window.opener.focus();
    } catch (_) {}
    window.close();
  } catch (err) {
    console.error(err);
    setStatus(`同步失败：${err.message}`, true);
  } finally {
    els.sendBtn.disabled = false;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${src}`));
    img.src = src;
  });
}

function clearCurrentUrl() {
  if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
  state.currentUrl = null;
  state.currentBlob = null;
  els.downloadLink.innerHTML = '';
}

function setProgress(v, msg) {
  els.progressFill.style.width = `${Math.max(0, Math.min(100, v))}%`;
  if (msg) els.statusText.textContent = msg;
}

function setStatus(msg, isError = false) {
  els.statusText.textContent = msg;
  els.statusText.style.color = isError ? '#b42318' : '#50657f';
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function formatInputDimension(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0';
}

function formatNum(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '-';
}
