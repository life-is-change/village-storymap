import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ========== 空间配置（匹配规则清单 R11 硬约束） ==========
const ROOM_RULES = {
  living_room: {
    label: '客厅', minArea: 18, maxArea: 45,
    minWidth: 3.9, minDepth: 4.5, maxAspectRatio: 3,
    color: '#b8d8ff', floor: 1
  },
  dining: {
    label: '餐厅', minArea: 6, maxArea: 22,
    minWidth: 2.4, minDepth: 2.5, maxAspectRatio: 3,
    color: '#ffd6a5', floor: 1
  },
  kitchen: {
    label: '厨房', minArea: 6, maxArea: 16,
    minWidth: 2.1, minDepth: 2.8, maxAspectRatio: 3,
    color: '#ffe7a0', floor: 1
  },
  bathroom: {
    label: '卫生间', minArea: 4, maxArea: 10,
    minWidth: 1.8, minDepth: 2.2, maxAspectRatio: 2.5,
    color: '#d2f4de', floor: 0
  },
  storage: {
    label: '储藏间', minArea: 3, maxArea: 8,
    minWidth: 1.8, minDepth: 2.0, maxAspectRatio: 3,
    color: '#f0e4ff', floor: 1
  },
  stairs: {
    label: '楼梯', minArea: 4.5, maxArea: 15,
    minWidth: 2.4, minDepth: 3.6, maxAspectRatio: 2,
    color: '#d9d9d9', floor: 1
  },
  bedroom: {
    label: '卧室', minArea: 9, maxArea: 25,
    minWidth: 3.0, minDepth: 3.6, maxAspectRatio: 3,
    color: '#ffd0d7', floor: 2
  },
  study: {
    label: '书房', minArea: 6, maxArea: 14,
    minWidth: 2.4, minDepth: 2.5, maxAspectRatio: 3,
    color: '#d9f4ff', floor: 2
  },
  lounge: {
    label: '起居厅', minArea: 15, maxArea: 35,
    minWidth: 3.6, minDepth: 4.2, maxAspectRatio: 3,
    color: '#f7d7ff', floor: 2
  },
  terrace: {
    label: '露台', minArea: 6, maxArea: 25,
    minWidth: 2.0, minDepth: 3.0, maxAspectRatio: 4,
    color: '#e3e3e3', floor: 3
  },
  multi: {
    label: '多功能房', minArea: 8, maxArea: 18,
    minWidth: 2.8, minDepth: 3.0, maxAspectRatio: 3,
    color: '#ffe1bf', floor: 3
  },
  corridor: {
    label: '过道', minArea: 2, maxArea: 8,
    minWidth: 0.9, minDepth: 2.0, maxAspectRatio: 5,
    color: '#d6dbe2', floor: 0
  }
};

// ========== 面积标准速查表（规则清单第五章，用于随机生成） ==========
const AREA_STANDARDS = {
  living_room:  { low: 18, comfort: [22, 25], high: [30, 35], span: [3.9, 4.5], depth: [4.5, 6.0] },
  bedroom:      { low: 9,  comfort: [10, 12], high: [13, 15], span: [3.0, 3.3], depth: [3.6, 4.2] },
  kitchen:      { low: 6,  comfort: [8, 10],  high: [10, 15], span: [2.1, 3.0], depth: [2.8, 4.2] },
  dining:       { low: 6,  comfort: [8, 12],  high: [12, 16], span: [2.4, 3.6], depth: [2.5, 4.2] },
  bathroom:     { low: 4,  comfort: [4, 5],   high: [5, 6],   span: [1.8, 2.2], depth: [2.2, 2.8] },
  study:        { low: 6,  comfort: [8, 10],  high: [10, 12], span: [2.4, 3.0], depth: [2.5, 3.6] },
  storage:      { low: 3,  comfort: [4, 5],   high: [5, 6],   span: [1.8, 2.4], depth: [2.0, 2.8] },
  stairs:       { low: 4.5, comfort: [5, 6],  high: [6, 8],   span: [2.4, 2.7], depth: [3.6, 6.0] },
  terrace:      { low: 6,  comfort: [8, 10],  high: [10, 15], span: [2.0, 3.0], depth: [3.0, 5.0] },
  lounge:       { low: 15, comfort: [18, 22], high: [25, 30], span: [3.6, 4.2], depth: [4.2, 5.5] },
  multi:        { low: 8,  comfort: [10, 12], high: [14, 18], span: [2.8, 3.6], depth: [3.0, 4.2] }
};

// 随机选择一个面积档位，返回 [minTarget, maxTarget] 范围
function pickAreaRange(type) {
  const std = AREA_STANDARDS[type];
  if (!std) return [ROOM_RULES[type]?.minArea || 8, ROOM_RULES[type]?.maxArea || 30];
  const roll = Math.random();
  if (roll < 0.35) {
    // 低适用
    return [std.low, std.comfort[0]];
  } else if (roll < 0.75) {
    // 舒适
    return [std.comfort[0], std.comfort[1]];
  } else {
    // 高舒适
    return [std.high[0], std.high[1]];
  }
}

const STYLE_PRESETS = {
  simple: {
    wall: 0xf5f1e8,
    accent: 0x8a6d52,
    roof: 0x60666d
  },
  modern: {
    wall: 0xf4f6f8,
    accent: 0x7a8696,
    roof: 0x50555c
  },
  chinese: {
    wall: 0xf6f0e6,
    accent: 0x7d2d1f,
    roof: 0x434343
  }
};

const HOUSE_GENERATOR_MESSAGE_TYPE = 'village-house-generator:model-ready';
const DEFAULT_TRANSFER_MODEL_SCALE = 10;

// 预制窗户模型缓存（key: 'window' => THREE.Group）
let prefabWindowModel = null;
function loadPrefabWindowModel(url) {
  return new Promise((resolve) => {
    if (prefabWindowModel) { resolve(prefabWindowModel); return; }
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.name = 'windowPrefab';
        // 统一缩放比例：预制模型设计时窗洞宽 1.0m，高 1.25m
        // 实际使用时会按目标尺寸再 scale
        prefabWindowModel = model;
        resolve(model);
      },
      undefined,
      () => {
        // 加载失败时不阻塞，后续会回退到程序生成
        resolve(null);
      }
    );
  });
}

const els = {
  length: document.getElementById('length'),
  width: document.getElementById('width'),
  floors: document.getElementById('floors'),
  floorHeight: document.getElementById('floorHeight'),
  roofType: document.getElementById('roofType'),
  styleType: document.getElementById('styleType'),
  windowDensity: document.getElementById('windowDensity'),
  windowStyle: document.getElementById('windowStyle'),
  balconyStyle: document.getElementById('balconyStyle'),
  summary: document.getElementById('summary'),
  messages: document.getElementById('messages'),
  planSvg: document.getElementById('planSvg'),
  floorTabs: document.getElementById('floorTabs'),
  floor1Card: document.getElementById('floor1Card'),
  floor2Card: document.getElementById('floor2Card'),
  floor3Card: document.getElementById('floor3Card'),
  btnGenerate: document.getElementById('btnGenerate'),
  btnRandom: document.getElementById('btnRandom'),
  btnExport: document.getElementById('btnExport'),
  btnApplyToMain: document.getElementById('btnApplyToMain'),
  bridgeNotice: document.getElementById('bridgeNotice'),
  threeContainer: document.getElementById('threeContainer'),
  roofChips: document.querySelectorAll('.roof-chip')
};

let currentModel = null;
let currentFloorView = 1;
let generatedState = null;
let hasPendingChanges = false;
const transferTarget = parseTransferTarget();

const threeState = initThree();
setupEvents();
generateAndRender();

function setupEvents() {
  els.btnGenerate?.addEventListener('click', generateAndRender);
  els.btnRandom?.addEventListener('click', () => {
    randomizeInputs(true);
    generateAndRender();
  });
  els.btnExport?.addEventListener('click', exportJson);
  els.btnApplyToMain?.addEventListener('click', applyModelToMainPlatform);
  els.floors?.addEventListener('change', () => {
    updateFloorCards();
    syncUpperFloorBathroomInputs(2);
    markPendingChanges();
  });

  const f2Bathroom = document.getElementById('f2_bathroom');
  const f3Bathroom = document.getElementById('f3_bathroom');
  f2Bathroom?.addEventListener('change', () => {
    syncUpperFloorBathroomInputs(2);
    markPendingChanges();
  });
  f3Bathroom?.addEventListener('change', () => {
    syncUpperFloorBathroomInputs(3);
    markPendingChanges();
  });

  [
    els.length, els.width, els.floorHeight, els.roofType, els.styleType,
    els.windowDensity, els.windowStyle, els.balconyStyle,
    ...document.querySelectorAll('input[type="number"], select, input[type="checkbox"]')
  ].forEach(el => {
    if (!el) return;
    el.addEventListener('change', () => {
      if (el === els.floors) return;
      markPendingChanges();
    });
  });

  updateFloorCards();
  syncUpperFloorBathroomInputs(2);
  bindFloorCardToggles();
  bindRoofSwitcher();
  els.roofType?.addEventListener('change', () => {
    syncRoofChipState(els.roofType.value);
  });
  syncRoofChipState(els.roofType?.value || 'flat_parapet');
  setupBridgeNotice();

  // 页面加载时默认随机化所有参数
  randomizeInputs(false);
}

function syncUpperFloorBathroomInputs(sourceFloor = 2) {
  const f2Bathroom = document.getElementById('f2_bathroom');
  const f3Bathroom = document.getElementById('f3_bathroom');
  if (!f2Bathroom || !f3Bathroom) return;

  const v2 = clamp(Number(f2Bathroom.value) || 1, 1, 2);
  const v3 = clamp(Number(f3Bathroom.value) || 1, 1, 2);
  const target = sourceFloor === 3 ? v3 : v2;
  f2Bathroom.value = String(target);
  f3Bathroom.value = String(target);
}

function markPendingChanges() {
  hasPendingChanges = true;
  renderMessages([{ type: 'info', text: '参数已修改，请点击“生成建筑”后再查看并应用模型。' }]);
}

function bindFloorCardToggles() {
  const toggles = document.querySelectorAll('.floor-card-toggle');
  toggles.forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const card = btn.closest('.floor-card');
      const body = targetId ? document.getElementById(targetId) : null;
      if (!card || !body) return;

      const collapsed = card.classList.toggle('is-collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
  });
}

function bindRoofSwitcher() {
  if (!els.roofChips || !els.roofChips.length) return;

  els.roofChips.forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const roof = String(btn.dataset.roof || '').trim();
      if (!roof || !els.roofType) return;
      if (els.roofType.value === roof) return;

      els.roofType.value = roof;
      syncRoofChipState(roof);
      generateAndRender();
    });
  });
}

function syncRoofChipState(roofType) {
  if (!els.roofChips || !els.roofChips.length) return;
  els.roofChips.forEach(btn => {
    const active = String(btn.dataset.roof || '') === String(roofType || '');
    btn.classList.toggle('active', active);
  });
}

function parseTransferTarget() {
  const params = new URLSearchParams(window.location.search);
  return {
    sourceCode: String(params.get('targetCode') || '').trim(),
    sourceName: String(params.get('targetName') || '').trim(),
    spaceId: String(params.get('targetSpace') || '').trim() || 'current'
  };
}

function setBridgeNotice(text, level = 'info') {
  if (!els.bridgeNotice) return;
  if (!text) {
    els.bridgeNotice.style.display = 'none';
    els.bridgeNotice.textContent = '';
    return;
  }

  els.bridgeNotice.style.display = '';
  els.bridgeNotice.textContent = text;

  if (level === 'error') {
    els.bridgeNotice.style.background = '#fff1f1';
    els.bridgeNotice.style.borderColor = '#ffd0d0';
    els.bridgeNotice.style.color = '#a63a3a';
    return;
  }

  if (level === 'success') {
    els.bridgeNotice.style.background = '#edfbef';
    els.bridgeNotice.style.borderColor = '#cbeccc';
    els.bridgeNotice.style.color = '#256c2c';
    return;
  }

  els.bridgeNotice.style.background = '#eef5ff';
  els.bridgeNotice.style.borderColor = '#cfe3ff';
  els.bridgeNotice.style.color = '#2b4c82';
}

function setupBridgeNotice() {
  if (!transferTarget.sourceCode) {
    setBridgeNotice('Standalone mode: open this page from the main platform to push generated GLB back.');
    return;
  }

  const targetLabel = transferTarget.sourceName || transferTarget.sourceCode;
  setBridgeNotice(`Target building: ${targetLabel} (space: ${transferTarget.spaceId}). Click "Apply to Main".`);
}

function updateFloorCards() {
  const floors = Number(els.floors.value);
  if (els.floor1Card) {
    els.floor1Card.style.display = '';
  }
  els.floor2Card.style.display = floors >= 2 ? '' : 'none';
  els.floor3Card.style.display = floors >= 3 ? '' : 'none';
  if (currentFloorView > floors) currentFloorView = floors;
}

function collectInputs() {
  const floors = Number(els.floors.value);
  syncUpperFloorBathroomInputs(2);
  const upperBathroomCount = clamp(getCount('f2_bathroom'), 1, 2);

  return {
    length: clamp(Number(els.length.value), 6, 40),
    width: clamp(Number(els.width.value), 6, 30),
    floors,
    floorHeight: clamp(Number(els.floorHeight.value), 2.8, 4.2),
    roofType: els.roofType.value,
    styleType: els.styleType.value,
    windowDensity: els.windowDensity.value,
    windowStyle: els.windowStyle?.value || 'grid',
    balconyStyle: els.balconyStyle?.value || 'railing',
    hasBalcony: true,
    hasPorch: true,
    program: {
      1: {
        living_room: 1,
        dining: 1,
        kitchen: 1,
        bathroom: 1,
        bedroom: clamp(getCount('f1_bedroom'), 1, 3),
        stairs: floors >= 2 ? 1 : 0
      },
      2: {
        living_room: floors >= 2 ? 1 : 0,
        bedroom: clamp(getCount('f2_bedroom'), 2, 3),
        bathroom: floors >= 2 ? upperBathroomCount : 0,
        terrace: floors >= 2 ? 1 : 0,
        stairs: floors >= 2 ? 1 : 0
      },
      3: {
        living_room: floors >= 3 ? 1 : 0,
        bedroom: clamp(getCount('f3_bedroom'), 2, 3),
        bathroom: floors >= 3 ? upperBathroomCount : 0,
        terrace: floors >= 3 ? 1 : 0,
        stairs: floors >= 3 ? 1 : 0
      }
    }
  };
}

function getCount(id) {
  const el = document.getElementById(id);
  return el ? Math.max(0, Number(el.value) || 0) : 0;
}

function generateAndRender() {
  try {
    const config = collectInputs();
    const result = generateBuilding(config);
    generatedState = result;
    hasPendingChanges = false;
    renderSummary(result);
    // 将 violations 转为 message 格式，合并到 messages 中展示
    const allMessages = [...(result.messages || [])];
    if (result.violations && result.violations.length > 0) {
      const hardCount = result.violations.filter(v => v.severity === 'hard').length;
      allMessages.unshift({
        type: 'warn',
        text: `⚠️ 硬约束自检：发现 ${hardCount} 项违规，详见下方列表`
      });
      result.violations.forEach(v => {
        allMessages.push({
          type: 'error',
          text: `【${v.rule}】第${v.floor || '-'}层 ${v.room ? v.room + '：' : ''}${v.message}`
        });
      });
    }
    renderMessages(allMessages);

    // 调试：检查 floorPlans 和 rooms 状态
    const fp = result.floorPlans || [];
    const debugInfo = [];
    fp.forEach(p => {
      const roomCount = (p.rooms || []).length;
      const hasNaN = (p.rooms || []).some(r => Number.isNaN(r.x) || Number.isNaN(r.y) || Number.isNaN(r.w) || Number.isNaN(r.h));
      debugInfo.push(`F${p.floor}: ${roomCount} rooms${hasNaN ? ' (含NaN!)' : ''}`);
    });
    console.log('[Debug] floorPlans:', debugInfo.join(' | '));

    // 安全检查：如果所有楼层都没有房间，给出明确提示
    const totalRooms = fp.reduce((sum, p) => sum + (p.rooms || []).length, 0);
    if (totalRooms === 0) {
      renderMessages([{ type: 'error', text: '生成异常：所有楼层都没有生成房间，请检查控制台日志。' }]);
      console.error('[Debug] 所有楼层 rooms 为空。floorPlans:', fp);
    }

    renderFloorTabs(fp.length);
    renderPlan(fp, currentFloorView);
    renderBuilding3D(result, threeState);
  } catch (err) {
    console.error('生成失败:', err);
    renderMessages([{
      type: 'error',
      text: `生成失败：${err.message || err}（详见浏览器控制台，按F12查看）`
    }]);
  }
}

// ========== 硬约束验证层（规则清单 R1~R13）==========

function validateHardConstraints(floorPlans, config) {
  const violations = [];
  const addV = (rule, floor, room, text) => {
    violations.push({ rule, floor, room: room?.label || '', message: text, severity: 'hard' });
  };

  // --- R1: 楼梯间全层锁定 ---
  const stairRects = [];
  floorPlans.forEach(p => {
    const r = p.rooms.find(x => x.type === 'stairs');
    if (r) stairRects.push({ floor: p.floor, ...r });
  });
  if (stairRects.length >= 2) {
    const first = stairRects[0];
    for (let i = 1; i < stairRects.length; i++) {
      const s = stairRects[i];
      const dx = Math.abs(s.x - first.x), dy = Math.abs(s.y - first.y);
      const dw = Math.abs(s.w - first.w), dh = Math.abs(s.h - first.h);
      if (dx > 0.01 || dy > 0.01 || dw > 0.01 || dh > 0.01) {
        addV('R1', s.floor, s, `楼梯间与一层不完全对齐（Δx=${round2(dx)}, Δy=${round2(dy)}, Δw=${round2(dw)}, Δh=${round2(dh)}）`);
      }
    }
  }

  // --- R2: 卫生间垂直对齐 ---
  const f1bath = floorPlans.find(p => p.floor === 1)?.rooms.find(r => r.type === 'bathroom');
  if (f1bath) {
    floorPlans.forEach(p => {
      if (p.floor <= 1) return;
      p.rooms.filter(r => r.type === 'bathroom').forEach(b => {
        const inside = b.x >= f1bath.x - 0.01 && b.y >= f1bath.y - 0.01 &&
                       b.x + b.w <= f1bath.x + f1bath.w + 0.01 &&
                       b.y + b.h <= f1bath.y + f1bath.h + 0.01;
        if (!inside) {
          addV('R2', p.floor, b, `上层卫生间投影未完全落入一层卫生间内`);
        }
      });
    });
  }

  // --- R4: 面积100%功能化 ---
  const totalArea = config.length * config.width;
  floorPlans.forEach(p => {
    const used = p.rooms.reduce((sum, r) => sum + r.area, 0);
    const gap = totalArea - used;
    if (gap > 2.5) {
      addV('R4', p.floor, null, `未标注空白区域约 ${round2(gap)}㎡，超过允许阈值 2㎡`);
    }
  });

  // --- R5: 墙体厚度扣除（面积基准检查） ---
  floorPlans.forEach(p => {
    const netMax = totalArea * 0.92;
    const used = p.rooms.reduce((sum, r) => sum + r.area, 0);
    if (used > netMax + 1) {
      addV('R5', p.floor, null, `功能区净面积 ${round2(used)}㎡ 超出墙体扣除后上限 ${round2(netMax)}㎡`);
    }
  });

  // --- R6: 楼梯间出口锁定客厅 ---
  floorPlans.forEach(p => {
    const stair = p.rooms.find(r => r.type === 'stairs');
    if (!stair) return;
    const neighbors = getRoomNeighbors(stair, p.rooms);
    const hasLiving = neighbors.some(n => n.type === 'living_room' || n.type === 'lounge');
    if (!hasLiving) {
      addV('R6', p.floor, stair, `楼梯间出口未直接连接客厅/起居厅（邻接房间：[${neighbors.map(n => n.label).join(', ')}]）`);
    }
  });

  // --- R7: 客厅作为交通枢纽 ---
  floorPlans.forEach(p => {
    const living = p.rooms.find(r => r.type === 'living_room' || r.type === 'lounge');
    if (!living) {
      addV('R7', p.floor, null, `该层缺少客厅/起居厅，无法作为交通枢纽`);
      return;
    }
    const reachable = bfsReachable(living, p.rooms, ['stairs']);
    const nonStairs = p.rooms.filter(r => r.type !== 'stairs');
    const missing = nonStairs.filter(r => !reachable.has(r));
    if (missing.length > 0) {
      addV('R7', p.floor, living, `客厅无法直接通达以下区域：${missing.map(r => r.label).join('、')}`);
    }
  });

  // --- R8: 一层必备功能区 ---
  const f1 = floorPlans.find(p => p.floor === 1);
  if (f1) {
    const count = type => f1.rooms.filter(r => r.type === type).length;
    const checkMin = (type, minCount, minArea, label) => {
      const rs = f1.rooms.filter(r => r.type === type);
      if (rs.length < minCount) addV('R8', 1, null, `一层缺少 ${label}（需≥${minCount}个）`);
      rs.forEach(r => {
        if (r.area < minArea - 0.5) addV('R8', 1, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 ${minArea}㎡`);
      });
    };
    if (count('stairs') < 1 && config.floors >= 2) addV('R8', 1, null, '一层缺少楼梯间');
    checkMin('living_room', 1, 18, '客厅/堂屋');
    checkMin('kitchen', 1, 6, '厨房');
    checkMin('dining', 1, 6, '餐厅');
    checkMin('bedroom', 1, 9, '卧室（老人房）');
    checkMin('bathroom', 1, 4, '卫生间');
  }

  // --- R9: 二层及以上必备功能区 ---
  floorPlans.forEach(p => {
    if (p.floor <= 1) return;
    const count = type => p.rooms.filter(r => r.type === type).length;
    const checkMin = (type, minCount, minArea, label) => {
      const rs = p.rooms.filter(r => r.type === type);
      if (rs.length < minCount) addV('R9', p.floor, null, `第${p.floor}层缺少 ${label}（需≥${minCount}个）`);
      rs.forEach(r => {
        if (r.area < minArea - 0.5) addV('R9', p.floor, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 ${minArea}㎡`);
      });
    };
    if (count('stairs') < 1) addV('R9', p.floor, null, `第${p.floor}层缺少楼梯间`);
    checkMin('living_room', 1, 15, '客厅/家庭厅');
    // 卧室≥2间，其中1间主卧≥12
    const beds = p.rooms.filter(r => r.type === 'bedroom');
    if (beds.length < 2) addV('R9', p.floor, null, `第${p.floor}层卧室数量 ${beds.length} 不足（需≥2间）`);
    const master = beds.sort((a, b) => b.area - a.area)[0];
    if (master && master.area < 12 - 0.5) addV('R9', p.floor, master, `主卧面积 ${round2(master.area)}㎡ 低于最小值 12㎡`);
    checkMin('bathroom', 1, 4, '卫生间');
    checkMin('terrace', 1, 6, '露台/阳台');
  });

  // --- R10: 三层模式检查（简化） ---
  floorPlans.forEach(p => {
    if (p.floor < 3) return;
    const hasLiving = p.rooms.some(r => r.type === 'living_room' || r.type === 'lounge');
    const beds = p.rooms.filter(r => r.type === 'bedroom');
    if (!hasLiving && beds.length < 2) {
      addV('R10', p.floor, null, `第${p.floor}层不符合模式A/B（需至少2间卧室+1起居空间）`);
    }
  });

  // --- R11: 房间最小净尺寸 ---
  floorPlans.forEach(p => {
    p.rooms.forEach(r => {
      const rule = ROOM_RULES[r.type];
      if (!rule) return;
      const w = Math.min(r.w, r.h); // 净宽取较小边
      const d = Math.max(r.w, r.h); // 净深取较大边
      if (w < rule.minWidth - 0.05) addV('R11', p.floor, r, `${r.label} 净宽 ${round2(w)}m 低于最小值 ${rule.minWidth}m`);
      if (d < rule.minDepth - 0.05) addV('R11', p.floor, r, `${r.label} 净深 ${round2(d)}m 低于最小值 ${rule.minDepth}m`);
      if (r.area < rule.minArea - 0.5) addV('R11', p.floor, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 ${rule.minArea}㎡`);
      const ar = Math.max(r.w / r.h, r.h / r.w);
      if (ar > rule.maxAspectRatio + 0.1) addV('R11', p.floor, r, `${r.label} 长宽比 ${round2(ar)} 超过上限 ${rule.maxAspectRatio}`);
    });
  });

  // --- R12: 楼梯间详细规格 ---
  floorPlans.forEach(p => {
    const s = p.rooms.find(r => r.type === 'stairs');
    if (!s) return;
    if (s.area < 4.5 - 0.2) addV('R12', p.floor, s, `楼梯间面积 ${round2(s.area)}㎡ 低于最小值 4.5㎡`);
    if (s.w < 2.4 - 0.05) addV('R12', p.floor, s, `楼梯间开间 ${round2(s.w)}m 低于最小值 2.4m`);
    if (s.h < 3.6 - 0.05) addV('R12', p.floor, s, `楼梯间进深 ${round2(s.h)}m 低于最小值 3.6m`);
  });

  // --- R13: 门窗洞口底线（简化为房间门存在性检查，由 renderPlan 负责具体门尺寸） ---
  // 实际门尺寸在 renderPlan 中由 addDoorFromEdge 控制，此处仅做房间邻接关系检查
  // 入户门、卧室门等由 renderPlan 自动生成，只要房间布局合理即可满足
  // 若需严格校验，可在 renderPlan 输出后二次扫描 doorSpecs

  // --- R6a: 卫生间独立动线检查（v3 新增） ---
  floorPlans.forEach(p => {
    const living = p.rooms.find(r => r.type === 'living_room' || r.type === 'lounge');
    const baths = p.rooms.filter(r => r.type === 'bathroom');
    if (!living || baths.length === 0) return;

    baths.forEach(bath => {
      const visited = new Set();
      const queue = [living];
      const parent = new Map();
      visited.add(living);
      let found = false;

      while (queue.length > 0 && !found) {
        const cur = queue.shift();
        const neighbors = getRoomNeighbors(cur, p.rooms);
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            parent.set(n, cur);
            if (n === bath) { found = true; break; }
            queue.push(n);
          }
        }
      }

      if (!found) {
        addV('R6a', p.floor, bath, '卫生间与客厅不连通，不可达');
        return;
      }

      const path = [];
      let node = bath;
      while (node !== living) {
        path.unshift(node);
        node = parent.get(node);
      }

      const passesKitchen = path.some(r => r.type === 'kitchen');
      const nonKitchenNeighbors = path.filter(r => r.type !== 'kitchen');
      if (passesKitchen && nonKitchenNeighbors.length === 0) {
        addV('R6a', p.floor, bath, '卫生间只能通过厨房进入，违反独立动线规则');
      }
    });
  });

  return violations;
}

// 获取一个房间的所有相邻房间（共享边长度 > 0.45m）
function getRoomNeighbors(room, allRooms) {
  const neighbors = [];
  const eps = 0.06;
  allRooms.forEach(other => {
    if (other === room) return;
    // 检查垂直共享边（左右相邻）
    if (Math.abs(room.x + room.w - other.x) < eps || Math.abs(other.x + other.w - room.x) < eps) {
      const y1 = Math.max(room.y, other.y);
      const y2 = Math.min(room.y + room.h, other.y + other.h);
      if (y2 - y1 > 0.45) neighbors.push(other);
    }
    // 检查水平共享边（上下相邻）
    if (Math.abs(room.y + room.h - other.y) < eps || Math.abs(other.y + other.h - room.y) < eps) {
      const x1 = Math.max(room.x, other.x);
      const x2 = Math.min(room.x + room.w, other.x + other.w);
      if (x2 - x1 > 0.45) neighbors.push(other);
    }
  });
  return neighbors;
}

// 从起始房间 BFS 遍历所有可达房间（通过邻接关系）
function bfsReachable(startRoom, allRooms, excludeTypes = []) {
  const visited = new Set();
  const queue = [startRoom];
  visited.add(startRoom);
  while (queue.length > 0) {
    const cur = queue.shift();
    const neighbors = getRoomNeighbors(cur, allRooms);
    neighbors.forEach(n => {
      if (!visited.has(n) && !excludeTypes.includes(n.type)) {
        visited.add(n);
        queue.push(n);
      }
    });
  }
  return visited;
}

// ========== Pipeline 阶段函数（规则清单第六章）==========

const GRID_MODULUS = 0.3; // 300mm 建筑模数

function snapToGrid(v) {
  return Math.round(v / GRID_MODULUS) * GRID_MODULUS;
}

function alignRoomsToGrid(rooms) {
  rooms.forEach(r => {
    const x0 = snapToGrid(r.x);
    const y0 = snapToGrid(r.y);
    const x1 = snapToGrid(r.x + r.w);
    const y1 = snapToGrid(r.y + r.h);
    r.x = round2(x0);
    r.y = round2(y0);
    r.w = round2(Math.max(GRID_MODULUS, x1 - x0));
    r.h = round2(Math.max(GRID_MODULUS, y1 - y0));
    r.area = round2(r.w * r.h);
  });
  return rooms;
}

// Phase 1: 参数校验
function phase1_validateInputs(config) {
  const msgs = [];
  if (config.length < 8 || config.length > 16) {
    msgs.push({ type: 'warn', text: `建筑长度 ${config.length}m 不在建议范围 8~16m 内` });
  }
  if (config.width < 8 || config.width > 14) {
    msgs.push({ type: 'warn', text: `建筑宽度 ${config.width}m 不在建议范围 8~14m 内` });
  }
  if (config.floors < 1 || config.floors > 4) {
    msgs.push({ type: 'error', text: `楼层数 ${config.floors} 超出允许范围 1~4` });
  }
  return msgs;
}

// Phase 2: 建立网格（输入参数对齐到 300mm 模数）
function phase2_buildGrid(config) {
  // 暂时保留原始尺寸，避免 snapToGrid 导致面积不匹配问题
  // 后续可通过 floorArea 重新计算对齐后的面积
  return {
    ...config,
    length: config.length, // snapToGrid(config.length),
    width: config.width,   // snapToGrid(config.width),
    floorHeight: config.floorHeight // snapToGrid(config.floorHeight)
  };
}

// Phase 3~5: 锁定核心 + 辐射布置 + 功能填充（逐层）
function phase3to5_generateFloorPlans(config, floorArea) {
  const floorPlans = [];
  const messages = [];

  // 预生成共享露台参数，确保2层及以上对齐
  let sharedTerrace = null;

  for (let floor = 1; floor <= config.floors; floor++) {
    if (floor >= 2 && !sharedTerrace) {
      const corners = ['tr', 'bl'];
      const pos = corners[Math.floor(Math.random() * corners.length)];
      const upperLeftW = config.length * 0.6;
      const rawDepth = config.width * (0.2 + Math.random() * 0.16);
      const maxDepth = Math.min(config.width * 0.42, Math.max(1.8, config.width * 0.38));
      const depth = clamp(rawDepth, 1.8, maxDepth);
      const maxW = Math.max(2.2, upperLeftW * 0.55);
      const w = clamp(upperLeftW * (0.22 + Math.random() * 0.28), 2.0, maxW);
      sharedTerrace = { pos, depth, w };
    }
    if (sharedTerrace) {
      config._terracePos = sharedTerrace.pos;
      config._terraceDepth = sharedTerrace.depth;
      config._terraceW = sharedTerrace.w;
    }

    const plan = generateSingleFloor(floor, config, floorArea);
    // 网格对齐（暂时禁用，排查显示问题）
    // plan.rooms = alignRoomsToGrid(plan.rooms);
    // 重新计算 usedArea
    plan.usedArea = round2(plan.rooms.reduce((sum, r) => sum + r.area, 0));

    floorPlans.push(plan);
    messages.push(...plan.messages);
  }

  return { floorPlans, messages };
}

// Phase 6: 几何校验（在验证层统一处理，此处仅做快速修正提示）
function phase6_geoValidate(floorPlans, config) {
  const msgs = [];
  floorPlans.forEach(p => {
    const total = config.length * config.width;
    const used = p.rooms.reduce((sum, r) => sum + r.area, 0);
    if (used < total - 2.5) {
      msgs.push({ type: 'warn', text: `第${p.floor}层面积未完全填满（缺口约${round2(total - used)}㎡）` });
    }
  });
  return msgs;
}

// Phase 9: 汇总 + 硬约束验证
function phase9_aggregateAndValidate(config, floorPlans, floorArea, pipelineMessages) {
  const floorSummaries = floorPlans.map(p => ({
    floor: p.floor,
    usedArea: p.usedArea,
    availableArea: floorArea,
    efficiency: round2((p.usedArea / floorArea) * 100)
  }));

  const totalGrossArea = round2(floorArea * config.floors);
  const totalUsedArea = round2(floorPlans.reduce((sum, p) => sum + p.usedArea, 0));
  const roofHeightMap = {
    flat: 0.3, flat_eave: 0.38, flat_parapet: 0.9, gable: 1.6, hip: 1.2
  };
  const roofHeight = roofHeightMap[config.roofType] ?? 0.9;

  // 硬约束验证（规则清单 R1~R13）
  const violations = validateHardConstraints(floorPlans, config);
  const messages = [...pipelineMessages];
  if (violations.length > 0) {
    messages.push({
      type: 'warn',
      text: `⚠️ 检测到 ${violations.length} 项硬约束违规，详见上方警告列表。`
    });
  }

  return {
    config,
    floorArea,
    totalGrossArea,
    totalUsedArea,
    floorPlans,
    floorSummaries,
    messages,
    violations,
    modelMetrics: {
      length: config.length,
      width: config.width,
      bodyHeight: config.floors * config.floorHeight,
      roofHeight,
      totalHeight: round2(config.floors * config.floorHeight + roofHeight)
    },
    exportVersion: 'v1'
  };
}

// ========== 生成主函数（Pipeline 入口，保留阶段注释）==========
function generateBuilding(config) {
  const floorArea = round2(config.length * config.width);
  const messages = [];
  const floorPlans = [];
  const floorSummaries = [];

  // Phase 1: 参数校验
  messages.push(...phase1_validateInputs(config));

  // Phase 2: 建立网格（暂不修改尺寸，避免面积不匹配）
  const gridConfig = phase2_buildGrid(config);

  // Phase 3~5: 逐层生成
  let sharedTerrace = null;
  for (let floor = 1; floor <= gridConfig.floors; floor++) {
    if (floor >= 2 && !sharedTerrace) {
      const corners = ['tr', 'bl'];
      const pos = corners[Math.floor(Math.random() * corners.length)];
      const upperLeftW = gridConfig.length * 0.6;
      const rawDepth = gridConfig.width * (0.2 + Math.random() * 0.16);
      const maxDepth = Math.min(gridConfig.width * 0.42, Math.max(1.8, gridConfig.width * 0.38));
      const depth = clamp(rawDepth, 1.8, maxDepth);
      const maxW = Math.max(2.2, upperLeftW * 0.55);
      const w = clamp(upperLeftW * (0.22 + Math.random() * 0.28), 2.0, maxW);
      sharedTerrace = { pos, depth, w };
    }
    if (sharedTerrace) {
      gridConfig._terracePos = sharedTerrace.pos;
      gridConfig._terraceDepth = sharedTerrace.depth;
      gridConfig._terraceW = sharedTerrace.w;
    }

    const plan = generateSingleFloor(floor, gridConfig, floorArea);
    floorPlans.push(plan);
    floorSummaries.push({
      floor,
      usedArea: plan.usedArea,
      availableArea: floorArea,
      efficiency: round2((plan.usedArea / floorArea) * 100)
    });
    messages.push(...plan.messages);
  }

  // Phase 6: 几何校验
  messages.push(...phase6_geoValidate(floorPlans, gridConfig));

  const totalGrossArea = round2(floorArea * gridConfig.floors);
  const totalUsedArea = round2(floorPlans.reduce((sum, p) => sum + p.usedArea, 0));
  const roofHeightMap = {
    flat: 0.3, flat_eave: 0.38, flat_parapet: 0.9, gable: 1.6, hip: 1.2
  };
  const roofHeight = roofHeightMap[gridConfig.roofType] ?? 0.9;

  // Phase 9: 硬约束验证
  const violations = validateHardConstraints(floorPlans, gridConfig);
  if (violations.length > 0) {
    messages.push({
      type: 'warn',
      text: `⚠️ 检测到 ${violations.length} 项硬约束违规，详见上方警告列表。`
    });
  }

  return {
    config: gridConfig,
    floorArea,
    totalGrossArea,
    totalUsedArea,
    floorPlans,
    floorSummaries,
    messages,
    violations,
    modelMetrics: {
      length: gridConfig.length,
      width: gridConfig.width,
      bodyHeight: gridConfig.floors * gridConfig.floorHeight,
      roofHeight,
      totalHeight: round2(gridConfig.floors * gridConfig.floorHeight + roofHeight)
    },
    exportVersion: 'v1'
  };
}

function generateSingleFloor(floor, config, floorArea) {
  const roomList = expandRooms(floor, config);
  const messages = [];

  if (!roomList.length) {
    messages.push({ type: 'warn', text: `第 ${floor} 层未配置空间数量，已生成为空层。` });
    return {
      floor,
      rooms: [],
      usedArea: 0,
      availableArea: floorArea,
      messages
    };
  }

  const targetAreas = allocateRoomAreas(roomList, floorArea);

  const rooms = layoutRooms(floor, targetAreas, config.length, config.width, 1, config);

  // 记录一层关键房间位置供上层对齐（卫生间上下层贯通）
  if (floor === 1) {
    const bathRoom = rooms.find(r => r.type === 'bathroom');
    if (bathRoom) {
      config._bathX = bathRoom.x;
      config._bathY = bathRoom.y;
      config._bathW = bathRoom.w;
      config._bathH = bathRoom.h;
    }
    const stairRoom = rooms.find(r => r.type === 'stairs');
    if (stairRoom) {
      config._stairX = stairRoom.x;
      config._stairY = stairRoom.y;
      config._stairW = stairRoom.w;
      config._stairH = stairRoom.h;
    }
  }

  const usedArea = round2(rooms.reduce((sum, room) => sum + room.area, 0));

  return {
    floor,
    rooms,
    usedArea,
    availableArea: floorArea,
    messages
  };
}

function allocateRoomAreas(roomList, floorArea) {
  const maxTotalRatio = 0.98; // v3 修复：从 0.92 放宽到 0.98，减少空白
  const maxTotalArea = floorArea * maxTotalRatio;

  const items = roomList.map(room => {
    const rule = ROOM_RULES[room.type];
    const [randMin, randMax] = pickAreaRange(room.type);
    const minA = rule?.minArea ?? 4;
    const maxA = rule?.maxArea ?? 40;
    // 用 AREA_STANDARDS 的随机档位覆盖原 min/max，但保证不超出硬约束边界
    const effectiveMin = Math.max(minA, randMin);
    const effectiveMax = Math.min(maxA, randMax);
    return { ...room, minA: effectiveMin, maxA: effectiveMax, hardMin: minA, hardMax: maxA, allocated: 0 };
  });

  // 优先级：必要功能空间优先保证最小面积
  const priorityMap = { stairs: 4, bathroom: 3, kitchen: 3, living_room: 2, dining: 2, bedroom: 1 };
  items.sort((a, b) => (priorityMap[b.type] || 0) - (priorityMap[a.type] || 0));

  let remaining = maxTotalArea;

  // 第一步：确保每个房间至少拿到硬约束最小面积
  items.forEach(item => {
    const give = Math.min(item.hardMin, Math.max(2.5, remaining * 0.55));
    item.allocated = give;
    remaining -= give;
  });

  // 第二步：将剩余面积按随机比例分配，但不超过随机档位的上限
  if (remaining > 0.5) {
    items.sort(() => Math.random() - 0.5);

    let pool = remaining;
    items.forEach(item => {
      const headroom = item.maxA - item.allocated;
      if (headroom <= 0.1 || pool <= 0.1) return;
      const ratio = Math.random() * 0.8 + 0.2;
      const extra = Math.min(headroom, pool * ratio);
      item.allocated += extra;
      pool -= extra;
    });

    if (pool > 0.3) {
      items.sort(() => Math.random() - 0.5);
      items.forEach(item => {
        const headroom = item.maxA - item.allocated;
        if (headroom <= 0.1 || pool <= 0.1) return;
        const extra = Math.min(headroom, pool * 0.4);
        item.allocated += extra;
        pool -= extra;
      });
    }
  }

  const allocated = items.map(item => ({
    ...item,
    targetArea: Math.max(item.hardMin, round2(item.allocated))
  }));

  // v3 新增：二次平衡，填满可用面积
  return rebalanceAreas(allocated, maxTotalArea);
}

function rebalanceAreas(rooms, availableNetArea) {
  const total = rooms.reduce((s, r) => s + (r.targetArea || 0), 0);
  const gap = availableNetArea - total;
  if (Math.abs(gap) < 0.3) return rooms;

  const result = rooms.map(r => ({ ...r }));

  if (gap > 0) {
    const expandPriority = ['living_room', 'bedroom', 'dining', 'kitchen', 'bathroom', 'study', 'storage'];
    let remaining = gap;
    for (const type of expandPriority) {
      const candidates = result.filter(r => r.type === type && (r.targetArea || 0) < (r.maxA || 999));
      if (!candidates.length) continue;
      const share = remaining / candidates.length;
      candidates.forEach(r => {
        const headroom = (r.maxA || 999) - (r.targetArea || 0);
        const add = Math.min(headroom, share);
        r.targetArea = (r.targetArea || 0) + add;
        remaining -= add;
      });
      if (remaining <= 0.1) break;
    }
  } else {
    const shrinkPriority = ['storage', 'study', 'bedroom', 'living_room', 'dining'];
    let needShrink = -gap;
    for (const type of shrinkPriority) {
      const candidates = result.filter(r => r.type === type && (r.targetArea || 0) > (r.hardMin || 0));
      if (!candidates.length) continue;
      const share = needShrink / candidates.length;
      candidates.forEach(r => {
        const headroom = (r.targetArea || 0) - (r.hardMin || 0);
        const sub = Math.min(headroom, share);
        r.targetArea = (r.targetArea || 0) - sub;
        needShrink -= sub;
      });
      if (needShrink <= 0.1) break;
    }
  }
  return result;
}

function expandRooms(floor, config) {
  const program = config.program[floor] || {};
  const rooms = [];
  const orderMap = {
    1: ['living_room', 'dining', 'kitchen', 'bathroom', 'bedroom', 'stairs'],
    2: ['terrace', 'living_room', 'bedroom', 'bathroom', 'stairs'],
    3: ['terrace', 'living_room', 'bedroom', 'bathroom', 'stairs']
  };
  const order = orderMap[floor] || Object.keys(program);

  order.forEach(type => {
    let count = Number(program[type] || 0);
    if (type === 'terrace' && floor >= 2 && config.hasBalcony) {
      count = Math.max(1, count);
    }
    if (type === 'stairs') {
      count = floor >= 2 ? 1 : Math.max(0, count);
    }
    if (type === 'bathroom' && floor >= 2) {
      const alignedCount = clamp(Number(config.program?.[2]?.bathroom || count), 1, 2);
      count = alignedCount;
    }
    if (type === 'bedroom') {
      count = Math.min(count, 3);
    }
    for (let i = 0; i < count; i++) {
      rooms.push({ type, label: ROOM_RULES[type].label, index: i + 1, floor });
    }
  });
  return rooms;
}

function layoutRooms(floor, targetRooms, length, width, scale, config) {
  if (floor === 1) {
    return layoutFloor1(targetRooms, length, width, scale, config);
  }
  return layoutUpperFloor(floor, targetRooms, length, width, scale, config);
}

function takeFirstByTypes(pool, types) {
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const idx = pool.findIndex(item => item.type === type);
    if (idx >= 0) {
      return pool.splice(idx, 1)[0];
    }
  }
  return null;
}

function takeAllByType(pool, type) {
  const result = [];
  for (let i = pool.length - 1; i >= 0; i--) {
    if (pool[i].type === type) {
      result.unshift(pool[i]);
      pool.splice(i, 1);
    }
  }
  return result;
}

function pushRoomRectIfValid(result, room, x, y, w, h) {
  if (!room) return;
  if (w < 0.9 || h < 0.9) return;
  result.push(makeRoomRect(room, x, y, w, h));
}

function resolveCoreLayout(length, width, withStair = true) {
  let coreW = clamp(length * 0.28, 3.2, Math.min(4.0, length - 2.0));
  const stairArea = 9.5;
  const minTopZone = 1.8;
  let stairH = withStair ? stairArea / coreW : 0;

  if (withStair && stairH > width - minTopZone) {
    stairH = Math.max(2.2, width - minTopZone);
    coreW = clamp(stairArea / stairH, 2.6, Math.min(4.0, length - 2.0));
  }

  if (withStair) {
    stairH = clamp(stairArea / coreW, 2.2, Math.max(2.2, width - minTopZone));
  }

  const leftW = Math.max(2.4, length - coreW);
  const stairY = withStair ? Math.max(0, width - stairH) : width;
  const bathZoneH = Math.max(1, stairY);
  return {
    coreW,
    leftW,
    stairH,
    stairY,
    bathZoneH
  };
}

function layoutFloor1(targetRooms, length, width, scale, config) {
  const pool = [...targetRooms];
  const result = [];
  const hasUpper = config.floors >= 2;

  const living = takeFirstByTypes(pool, ['living_room', 'lounge']);
  const dining = takeFirstByTypes(pool, ['dining']);
  const kitchen = takeFirstByTypes(pool, ['kitchen']);
  const bathroom = takeFirstByTypes(pool, ['bathroom']);
  const stair = hasUpper ? takeFirstByTypes(pool, ['stairs']) : null;
  const bedrooms = takeAllByType(pool, 'bedroom');
  const storage = takeFirstByTypes(pool, ['storage']);

  // ========== 一层布局（基于规则清单）==========
  // front带（南侧）：楼梯间(左) + 客厅(中) + 餐厅(右) 水平并排
  // 后带（北侧）：左列=卧室垂直排列，右列=厨房(上)+卫生间(下)垂直排列
  // 规则：
  // - 客厅≥20㎡，净宽≥4m，净长≥5m
  // - 楼梯间出口（右侧）必须通向客厅
  // - 餐厅≥8㎡，与客厅相邻
  // - 厨房≥6㎡，与餐厅上下相邻（有内墙分隔）
  // - 卫生间≥4㎡，与上层对齐，在右列底部
  // - 卧室≥1间（建议2间），主卧≥12㎡，净宽≥3m，净长≥3.6m
  // ============================================

  // v3 修复：front带高度最小值放宽，不再硬拉 5m，让面积分配更灵活
  const minFrontH = Math.max(4.2, width * 0.28);
  let frontH = living
    ? clamp(living.targetArea / (length * 0.45), minFrontH, width * 0.55)
    : minFrontH;

  // v3 修复：楼梯间最小开间 2.4m，禁止低于此值
  const MIN_STAIR_W = 2.4;
  let stairW = 0;
  let diningW = 0;
  if (stair) {
    const fromArea = (stair.targetArea || 10) / frontH;
    stairW = clamp(fromArea, MIN_STAIR_W, Math.min(4.0, length * 0.45));
  }
  if (dining) {
    diningW = Math.max(2.4, (dining.targetArea || 10) / frontH);
  }

  // 客厅取剩余宽度（至少4m）
  let livingW = Math.max(4, length - stairW - diningW);

  // 如果总宽超过 length，压缩餐厅/楼梯间（但楼梯间不低于 2.4）
  let finalStairW = stairW;
  let finalDiningW = diningW;
  if (stairW + livingW + diningW > length) {
    const avail = length - livingW;
    if (stair && dining) {
      const totalSD = stairW + diningW;
      const sRatio = stairW / totalSD;
      const newSW = Math.max(MIN_STAIR_W, avail * sRatio);
      const newDW = Math.max(2, avail - newSW);
      finalStairW = Math.min(stairW, newSW);
      finalDiningW = Math.min(diningW, newDW);
      if (finalStairW + finalDiningW + livingW > length) {
        // 压缩客厅
        livingW = Math.max(4, length - finalStairW - finalDiningW);
      }
    } else if (stair) {
      finalStairW = Math.min(stairW, Math.max(MIN_STAIR_W, avail));
      livingW = length - finalStairW;
    } else if (dining) {
      finalDiningW = Math.min(diningW, Math.max(2, avail));
      livingW = length - finalDiningW;
    }
  }

  // 放置 front 带（从左到右：楼梯间 → 客厅 → 餐厅）
  let curX = 0;
  if (stair) {
    pushRoomRectIfValid(result, stair, curX, width - frontH, finalStairW, frontH);
    curX += finalStairW;
  }
  if (living) {
    pushRoomRectIfValid(result, living, curX, width - frontH, livingW, frontH);
    curX += livingW;
  }
  if (dining) {
    const dw = length - curX;
    if (dw > 0.9) {
      pushRoomRectIfValid(result, dining, curX, width - frontH, dw, frontH);
    }
  }

  // ===== Phase 5: 后带功能填充 =====
  const backH = width - frontH;
  if (backH < 0.5) return finalizeRooms(result);

  // 后带分区：左列（居住）+ 右列（服务）
  const leftW = Math.max(3.5, Math.min(length * 0.6, length - 2.5));
  const rightW = length - leftW;

  // 左列：卧室区
  // 策略：若后带高度足够且卧室数量少，垂直排列（自然形成通道）；
  //       否则水平排列（所有卧室都与 front 带相邻）
  const minBedDepth = 3.6;
  const useVertical = bedrooms.length > 0 && backH >= bedrooms.length * minBedDepth * 0.85 && leftW >= 3.0;

  // 后带布局：根据高度选择垂直排列或水平排列
  if (useVertical) {
    // ===== 方案A：垂直排列（后带高度充足）=====
    // 左列：卧室垂直排列，最上面的与 front 带相邻
    if (bedrooms.length) {
      result.push(...splitBand(bedrooms, 0, 0, leftW, backH, scale, 'vertical'));
    }
    // 右列：厨房(上) + 卫生间(下) 垂直排列
    const rightRooms = [];
    if (kitchen) rightRooms.push(kitchen);
    if (bathroom) rightRooms.push(bathroom);
    if (rightRooms.length) {
      result.push(...splitBand(rightRooms, leftW, 0, rightW, backH, scale, 'vertical'));
    } else if (storage) {
      pushRoomRectIfValid(result, storage, leftW, 0, rightW, backH);
    }
  } else {
    // ===== 方案B：水平排列（后带高度不足）=====
    // v3 修复：强制卫生间不与厨房单独锁死在末端，确保独立动线
    const backRooms = [...bedrooms];
    if (kitchen) backRooms.push(kitchen);
    if (bathroom) backRooms.push(bathroom);
    if (storage) backRooms.push(storage);

    if (backRooms.length) {
      const ordered = [];
      const bathIdx = backRooms.findIndex(r => r.type === 'bathroom');
      const kitchenIdx = backRooms.findIndex(r => r.type === 'kitchen');
      const bedCount = backRooms.filter(r => r.type === 'bedroom').length;

      if (bathIdx >= 0 && kitchenIdx >= 0 && backRooms.length >= 3 && bedCount >= 1) {
        // 顺序：卧室... → 卫生间 → 储藏室 → 厨房（厨房放最后贴边）
        backRooms.forEach(r => { if (r.type === 'bedroom') ordered.push(r); });
        ordered.push(backRooms[bathIdx]);
        if (storage) ordered.push(storage);
        ordered.push(backRooms[kitchenIdx]);
      } else {
        ordered.push(...backRooms);
      }
      result.push(...splitBand(ordered, 0, 0, length, backH, scale, 'horizontal'));
    }
  }

  return finalizeRooms(result);
}

function layoutUpperFloor(floor, targetRooms, length, width, scale, config) {
  const pool = [...targetRooms];
  const result = [];

  const terrace = takeFirstByTypes(pool, ['terrace']);
  const living = takeFirstByTypes(pool, ['living_room', 'lounge', 'multi']);
  const stair = takeFirstByTypes(pool, ['stairs']);
  const bathrooms = takeAllByType(pool, 'bathroom');
  const bedrooms = takeAllByType(pool, 'bedroom');

  // 使用预生成的共享露台参数
  const terracePos = config._terracePos || 'tr';
  const terraceDepth = config._terraceDepth || clamp(width * 0.2, 1.5, Math.min(3, width * 0.35));
  const terraceW = config._terraceW || clamp(length * 0.25, 2, length * 0.4);

  // 一层楼梯间和卫生间位置（上层复用，确保上下层精确对齐）
  const stairX = config._stairX !== undefined ? config._stairX : 0;
  const stairY = config._stairY !== undefined ? config._stairY : width * 0.5;
  const stairW = config._stairW !== undefined ? config._stairW : length * 0.2;
  const stairH = config._stairH !== undefined ? config._stairH : width * 0.3;

  const bathX = config._bathX !== undefined ? config._bathX : length * 0.5;
  const bathY = config._bathY !== undefined ? config._bathY : 0;
  const bathW = config._bathW !== undefined ? config._bathW : length * 0.3;
  const bathH = config._bathH !== undefined ? config._bathH : width * 0.2;

  // 放置露台（优先放在与起居厅/卧室相邻的位置）
  let tx = 0, ty = 0;
  if (terracePos === 'tl') { tx = 0; ty = width - terraceDepth; }
  else if (terracePos === 'tr') { tx = length - terraceW; ty = width - terraceDepth; }
  else if (terracePos === 'bl') { tx = 0; ty = 0; }
  else if (terracePos === 'br') { tx = length - terraceW; ty = 0; }

  if (terrace) {
    pushRoomRectIfValid(result, { ...terrace, _corner: terracePos }, tx, ty, terraceW, terraceDepth);
  }

  // front带高度（与一层一致）
  const frontH = width - stairY;

  // === front 带 ===
  // 楼梯间（与一层同位置同大小）
  if (stair) {
    pushRoomRectIfValid(result, stair, stairX, stairY, stairW, stairH);
  }

  // 起居厅（楼梯间右侧，front带中部）
  if (living) {
    let livingX = stairX + stairW;
    let livingW = length - stairW;
    // v3 修复：若露台在 front 带，必须扣除且禁止重叠
    if (terracePos === 'tr' || terracePos === 'tl') {
      livingW = Math.max(4, length - stairW - terraceW);
      // 如果起居厅宽度过小，强制把露台移到 back 带
      if (livingW < 3.5) {
        const backCorners = ['bl', 'br'];
        const forcedPos = backCorners[Math.floor(Math.random() * backCorners.length)];
        config._terracePos = forcedPos;
        if (forcedPos === 'bl') { tx = 0; ty = 0; }
        else { tx = length - terraceW; ty = 0; }
        const tRoom = result.find(r => r.type === 'terrace');
        if (tRoom) { tRoom.x = tx; tRoom.y = ty; }
        livingW = length - stairW;
      }
    }
    if (livingW > 3.5) {
      pushRoomRectIfValid(result, living, livingX, stairY, livingW, frontH);
    }
  }

  // === 后带 ===
  const backH = width - frontH;
  if (backH < 0.5) return finalizeRooms(result);

  // 上层后带自适应布局：
  // - 若后带高度足够，左列卧室垂直排列 + 右列卫生间占满（避免卧室与卫生间水平相邻）
  // - 若高度不足，所有房间水平排列（确保面积填满）
  const minBedDepth = 3.6;
  const useVertical = bedrooms.length > 0 && backH >= bedrooms.length * minBedDepth * 0.85;

  if (useVertical) {
    // 左列：卧室垂直排列
    const leftW = Math.max(3.5, Math.min(length * 0.65, length - 2.5));
    const rightW = length - leftW;
    if (bedrooms.length) {
      let bedX = 0, bedW = leftW;
      if (terracePos === 'bl') { bedX = terraceW; bedW = leftW - terraceW; }
      if (bedW > 2.5) {
        result.push(...splitBand(bedrooms, bedX, 0, bedW, backH, scale, 'vertical'));
      }
    }
    // 右列：卫生间占满
    if (bathrooms.length) {
      let bX = bathX, bW = bathW;
      if (terracePos === 'br') { bW = Math.max(1.5, bathW - terraceW); }
      // 让卫生间占满右列后带高度
      if (bathrooms.length === 1) {
        pushRoomRectIfValid(result, bathrooms[0], bX, 0, bW, backH);
      } else {
        result.push(...splitBand(bathrooms, bX, 0, bW, backH, scale, 'vertical'));
      }
    }
  } else {
    // 高度不足时：所有房间水平排列填满后带
    const backRooms = [...bedrooms];
    if (bathrooms.length) backRooms.push(...bathrooms);
    if (backRooms.length) {
      let backX = 0, backW = length;
      if (terracePos === 'bl') { backX = terraceW; backW = length - terraceW; }
      if (backW > 2.5) {
        result.push(...splitBand(backRooms, backX, 0, backW, backH, scale, 'horizontal'));
      }
    }
  }

  return finalizeRooms(result);
}

function splitBand(rooms, x, y, w, h, scale, direction = 'horizontal') {
  if (!rooms.length || w <= 0 || h <= 0) return [];
  const totalArea = sumScaledArea(rooms, scale);
  if (!totalArea || Number.isNaN(totalArea)) {
    // 面积计算异常，均分
    const avg = direction === 'horizontal' ? w / rooms.length : h / rooms.length;
    return rooms.map((room, idx) => {
      if (direction === 'horizontal') {
        return makeRoomRect(room, x + idx * avg, y, avg, h);
      } else {
        return makeRoomRect(room, x, y + idx * avg, w, avg);
      }
    });
  }

  const result = [];
  let cursor = direction === 'horizontal' ? x : y;
  const bound = direction === 'horizontal' ? x + w : y + h;

  rooms.forEach((room, idx) => {
    const last = idx === rooms.length - 1;
    const scaledArea = (room.targetArea || 8) * scale;
    const ratio = scaledArea / totalArea;

    let rw = w;
    let rh = h;
    if (direction === 'horizontal') {
      rw = last ? Math.max(0.3, bound - cursor) : Math.max(0.3, Math.min(w * ratio, bound - cursor - 0.3 * (rooms.length - idx - 1)));
      rh = h;
      result.push(makeRoomRect(room, cursor, y, rw, rh));
      cursor += rw;
    } else {
      rw = w;
      rh = last ? Math.max(0.3, bound - cursor) : Math.max(0.3, Math.min(h * ratio, bound - cursor - 0.3 * (rooms.length - idx - 1)));
      result.push(makeRoomRect(room, x, cursor, rw, rh));
      cursor += rh;
    }
  });

  return result;
}

function makeRoomRect(room, x, y, w, h) {
  const safe = v => Number.isFinite(v) ? v : 0.3;
  const sx = safe(x), sy = safe(y), sw = Math.max(0.3, safe(w)), sh = Math.max(0.3, safe(h));
  const rule = ROOM_RULES[room.type] || { label: room.label, color: '#e6eefc' };
  const rect = {
    type: room.type,
    label: room.index > 1 ? `${rule.label}${room.index}` : rule.label,
    x: round2(sx),
    y: round2(sy),
    w: round2(sw),
    h: round2(sh),
    area: round2(sw * sh),
    color: rule.color,
    generated: true
  };
  if (room._corner) rect._corner = room._corner;
  return rect;
}

function finalizeRooms(rooms) {
  return rooms.filter(room => room.w > 0 && room.h > 0);
}

function sumScaledArea(rooms, scale) {
  return rooms.reduce((sum, room) => sum + room.targetArea * scale, 0);
}

function renderSummary(result) {
  const summaryItems = [
    ['建筑尺寸', `${result.config.length} x ${result.config.width} m`],
    ['楼层数', `${result.config.floors} 层`],
    ['单层占地', `${result.floorArea} ㎡`],
    ['总建筑面积', `${result.totalGrossArea} ㎡`],
    ['空间净面积', `${result.totalUsedArea} ㎡`],
    ['建筑总高度', `${result.modelMetrics.totalHeight} m`]
  ];

  els.summary.innerHTML = summaryItems.map(([label, value]) => `
    <div class="summary-item">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join('');
}

function renderMessages(messages) {
  if (!messages.length) {
    els.messages.innerHTML = '<div class="message info">生成成功：当前方案已自动生成平面与 3D 建筑体块。</div>';
    return;
  }
  els.messages.innerHTML = messages.map(msg => `
    <div class="message ${msg.type || 'info'}">${msg.text}</div>
  `).join('');
}

function renderFloorTabs(floorCount) {
  els.floorTabs.innerHTML = '';
  for (let i = 1; i <= floorCount; i++) {
    const btn = document.createElement('button');
    btn.className = `floor-tab ${currentFloorView === i ? 'active' : ''}`;
    btn.textContent = `第 ${i} 层`;
    btn.addEventListener('click', () => {
      currentFloorView = i;
      renderFloorTabs(floorCount);
      renderPlan(generatedState.floorPlans, currentFloorView);
    });
    els.floorTabs.appendChild(btn);
  }
}

function renderPlan(floorPlans, floorNumber) {
  const plan = floorPlans.find(item => item.floor === floorNumber) || floorPlans[0];
  if (!plan) {
    els.planSvg.innerHTML = '';
    return;
  }

  const svg = els.planSvg;
  const viewW = 1000;
  const viewH = 700;
  const padding = 56;
  const length = generatedState.config.length;
  const width = generatedState.config.width;
  const scale = Math.min((viewW - padding * 2) / length, (viewH - padding * 2) / width);
  const offsetX = (viewW - length * scale) / 2;
  const offsetY = (viewH - width * scale) / 2;
  const wallStroke = Math.max(3.2, Math.min(6.5, scale * 0.09));
  const roomStroke = Math.max(1.6, wallStroke * 0.62);
  const eps = 0.08;

  const getRoomPattern = (room) => {
    if (room.type === 'bathroom' || room.type === 'kitchen') return 'url(#tilePattern)';
    if (room.type === 'corridor' || room.type === 'stairs') return 'url(#stonePattern)';
    if (room.type === 'terrace') return 'url(#terracePattern)';
    return 'url(#woodPattern)';
  };

  const isCirculationRoom = (room) =>
    room.type === 'corridor' ||
    room.type === 'living_room' ||
    room.type === 'lounge' ||
    room.type === 'multi';

  const buildAdjacencies = () => {
    const edges = [];
    const tol = 0.06;
    for (let i = 0; i < plan.rooms.length; i++) {
      for (let j = i + 1; j < plan.rooms.length; j++) {
        const a = plan.rooms[i];
        const b = plan.rooms[j];

        if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
          const y1 = Math.max(a.y, b.y);
          const y2 = Math.min(a.y + a.h, b.y + b.h);
          const overlap = y2 - y1;
          if (overlap > 0.45) {
            const aRight = Math.abs(a.x + a.w - b.x) < tol;
            edges.push({
              a: i,
              b: j,
              sideA: aRight ? 'right' : 'left',
              sideB: aRight ? 'left' : 'right',
              start: y1,
              end: y2,
              mid: (y1 + y2) / 2,
              overlap
            });
          }
        }

        if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
          const x1 = Math.max(a.x, b.x);
          const x2 = Math.min(a.x + a.w, b.x + b.w);
          const overlap = x2 - x1;
          if (overlap > 0.45) {
            const aBottom = Math.abs(a.y + a.h - b.y) < tol;
            edges.push({
              a: i,
              b: j,
              sideA: aBottom ? 'bottom' : 'top',
              sideB: aBottom ? 'top' : 'bottom',
              start: x1,
              end: x2,
              mid: (x1 + x2) / 2,
              overlap
            });
          }
        }
      }
    }
    return edges;
  };

  const getOtherId = (edge, id) => (edge.a === id ? edge.b : edge.a);
  const getSideFor = (edge, id) => (edge.a === id ? edge.sideA : edge.sideB);
  const edgeKey = (edge) => `${Math.min(edge.a, edge.b)}-${Math.max(edge.a, edge.b)}`;
  const edges = buildAdjacencies();
  const edgeRoomMap = new Map();
  edges.forEach(edge => {
    edgeRoomMap.set(edgeKey(edge), [edge.a, edge.b]);
  });
  const edgeOfRoom = new Map();
  for (let i = 0; i < plan.rooms.length; i++) edgeOfRoom.set(i, []);
  edges.forEach(edge => {
    edgeOfRoom.get(edge.a)?.push(edge);
    edgeOfRoom.get(edge.b)?.push(edge);
  });

  const doorSpecs = [];
  const usedEdge = new Set();
  const addDoorFromEdge = (edge, roomId, opts = {}) => {
    const key = edgeKey(edge);
    if (usedEdge.has(key)) return;
    usedEdge.add(key);
    doorSpecs.push({
      edgeId: key,
      roomId,
      side: getSideFor(edge, roomId),
      mid: edge.mid,
      spanStart: edge.start,
      spanEnd: edge.end,
      terraceDoor: !!opts.terraceDoor,
      openingOnly: !!opts.openingOnly
    });
  };

  const pickBest = (arr, scorer) => {
    if (!arr.length) return null;
    let best = null;
    let bestScore = -Infinity;
    arr.forEach(item => {
      const score = scorer(item);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    });
    return best;
  };

  const getShortSides = (room) => {
    if (!room) return ['left', 'right', 'top', 'bottom'];
    if (Math.abs(room.w - room.h) < 0.05) return ['left', 'right', 'top', 'bottom'];
    return room.w < room.h ? ['top', 'bottom'] : ['left', 'right'];
  };
  const roomHasPassage = (roomId) => {
    return doorSpecs.some(d => {
      if (d.roomId === roomId) return true;
      const pair = edgeRoomMap.get(d.edgeId) || [];
      return pair.includes(roomId);
    });
  };

  plan.rooms.forEach((room, roomId) => {
    if (room.type !== 'stairs') return;
    const shortSides = getShortSides(room);
    const livingOptions = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && (other.type === 'living_room' || other.type === 'lounge');
    });
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && isCirculationRoom(other);
    });
    const fallbackOptions = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && other.type !== 'stairs' && other.type !== 'terrace';
    });
    const allShortOptions = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && other.type !== 'stairs' && shortSides.includes(getSideFor(edge, roomId));
    });
    const candidate = livingOptions.length ? livingOptions : (options.length ? options : fallbackOptions);
    const shortCandidate = candidate.filter(edge => shortSides.includes(getSideFor(edge, roomId)));
    const picked = pickBest(shortCandidate.length ? shortCandidate : (allShortOptions.length ? allShortOptions : candidate), edge => {
      const side = getSideFor(edge, roomId);
      const shortBonus = shortSides.includes(side) ? 220 : 0;
      const leftBonus = side === 'left' ? 100 : 0;
      return shortBonus + leftBonus + edge.overlap;
    });
    if (picked) addDoorFromEdge(picked, roomId, { openingOnly: true });
  });

  plan.rooms.forEach((room, roomId) => {
    if (room.type !== 'terrace') return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && ['bedroom', 'lounge', 'living_room', 'multi', 'study'].includes(other.type);
    });
    const livingOptions = options.filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && (other.type === 'living_room' || other.type === 'lounge');
    });
    const bedroomOptions = options.filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && other.type === 'bedroom';
    });

    const mainEdge = pickBest(livingOptions.length ? livingOptions : options, edge => edge.overlap);
    if (mainEdge) {
      const interiorId = getOtherId(mainEdge, roomId);
      addDoorFromEdge(mainEdge, interiorId, { terraceDoor: true });
    }
    const extraBedroom = pickBest(
      bedroomOptions.filter(edge => edgeKey(edge) !== (mainEdge ? edgeKey(mainEdge) : '')),
      edge => edge.overlap
    );
    if (extraBedroom) {
      const bedroomId = getOtherId(extraBedroom, roomId);
      addDoorFromEdge(extraBedroom, bedroomId, { terraceDoor: true });
    }
  });

  plan.rooms.forEach((room, roomId) => {
    if (room.type === 'corridor' || room.type === 'stairs' || room.type === 'terrace' || isCirculationRoom(room)) return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && isCirculationRoom(other);
    });
    const picked = pickBest(options, edge => edge.overlap);
    if (picked) addDoorFromEdge(picked, roomId);
  });

  const bedroomRooms = plan.rooms
    .map((room, idx) => ({ room, idx }))
    .filter(item => item.room.type === 'bedroom');
  bedroomRooms.forEach(item => {
    const roomId = item.idx;
    const hasDoor = roomHasPassage(roomId);
    if (hasDoor) return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && other.type !== 'stairs' && other.type !== 'terrace';
    });
    const picked = pickBest(options, edge => edge.overlap);
    if (picked) addDoorFromEdge(picked, roomId);
  });

  const bathroomRooms = plan.rooms
    .map((room, idx) => ({ room, idx }))
    .filter(item => item.room.type === 'bathroom');
  bathroomRooms.forEach(item => {
    const roomId = item.idx;
    const hasDoor = roomHasPassage(roomId);
    if (hasDoor) return;

    // v3 修复：卫生间门优先顺序：客厅/过道 > 卧室 > 储藏室 > 厨房
    const preferredTypes = ['living_room', 'lounge', 'corridor', 'bedroom', 'storage', 'kitchen'];
    let picked = null;
    for (const pt of preferredTypes) {
      const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = plan.rooms[getOtherId(edge, roomId)];
        return other && other.type === pt;
      });
      if (options.length) {
        picked = pickBest(options, edge => edge.overlap);
        if (picked) break;
      }
    }

    if (!picked) {
      const fallback = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = plan.rooms[getOtherId(edge, roomId)];
        return other && other.type !== 'stairs' && other.type !== 'terrace';
      });
      picked = pickBest(fallback, edge => edge.overlap);
    }
    if (picked) addDoorFromEdge(picked, roomId);
  });

  plan.rooms.forEach((room, roomId) => {
    if (room.type === 'stairs') return;
    if (roomHasPassage(roomId)) return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      return other && other.type !== 'stairs';
    });
    const picked = pickBest(options, edge => {
      const other = plan.rooms[getOtherId(edge, roomId)];
      const livingBonus = other && (other.type === 'living_room' || other.type === 'lounge') ? 35 : 0;
      const terraceBonus = room.type === 'terrace' && other && (other.type === 'living_room' || other.type === 'lounge') ? 60 : 0;
      return terraceBonus + livingBonus + edge.overlap;
    });
    if (!picked) return;
    if (room.type === 'terrace') {
      addDoorFromEdge(picked, getOtherId(picked, roomId), { terraceDoor: true });
    } else {
      addDoorFromEdge(picked, roomId);
    }
  });

  const makeDoorMarkup = (door) => {
    const room = plan.rooms[door.roomId];
    if (!room) return '';
    const x = offsetX + room.x * scale;
    const y = offsetY + room.y * scale;
    const w = room.w * scale;
    const h = room.h * scale;
    const side = door.side;
    const spanPx = Math.max(12, (door.spanEnd - door.spanStart) * scale);
    const openLen = Math.max(16, Math.min(38, Math.min(Math.min(w, h) * 0.28, spanPx * 0.8)));
    const half = openLen / 2;
    const sw = Math.max(1.3, roomStroke * 0.88);
    const gapStroke = sw + 2.6;
    const arcStroke = Math.max(1, sw * 0.72);
    if (door.openingOnly) {
      if (side === 'left' || side === 'right') {
        const mid = offsetY + door.mid * scale;
        const y1 = mid - half;
        const y2 = mid + half;
        const wallX = side === 'left' ? x : x + w;
        return `<line x1="${wallX}" y1="${y1}" x2="${wallX}" y2="${y2}" stroke="#f7f7f5" stroke-width="${gapStroke}" />`;
      }
      const mid = offsetX + door.mid * scale;
      const x1 = mid - half;
      const x2 = mid + half;
      const wallY = side === 'top' ? y : y + h;
      return `<line x1="${x1}" y1="${wallY}" x2="${x2}" y2="${wallY}" stroke="#f7f7f5" stroke-width="${gapStroke}" />`;
    }

    if (side === 'left') {
      const mid = offsetY + door.mid * scale;
      const y1 = mid - half;
      const y2 = mid + half;
      const wallX = x;
      const hingeX = wallX;
      const hingeY = y1;
      const openTipX = hingeX + openLen;
      const openTipY = hingeY;
      const closeTipX = hingeX;
      const closeTipY = y2;
      return `
        <line x1="${wallX}" y1="${y1}" x2="${wallX}" y2="${y2}" stroke="#f7f7f5" stroke-width="${gapStroke}" />
        <line x1="${hingeX}" y1="${hingeY}" x2="${openTipX}" y2="${openTipY}" stroke="#1f2329" stroke-width="${sw}" />
        <path d="M ${openTipX} ${openTipY} A ${openLen} ${openLen} 0 0 1 ${closeTipX} ${closeTipY}" fill="none" stroke="#58616d" stroke-width="${arcStroke}" />
      `;
    }

    if (side === 'right') {
      const mid = offsetY + door.mid * scale;
      const y1 = mid - half;
      const y2 = mid + half;
      const wallX = x + w;
      const hingeX = wallX;
      const hingeY = y1;
      const openTipX = hingeX - openLen;
      const openTipY = hingeY;
      const closeTipX = hingeX;
      const closeTipY = y2;
      return `
        <line x1="${wallX}" y1="${y1}" x2="${wallX}" y2="${y2}" stroke="#f7f7f5" stroke-width="${gapStroke}" />
        <line x1="${hingeX}" y1="${hingeY}" x2="${openTipX}" y2="${openTipY}" stroke="#1f2329" stroke-width="${sw}" />
        <path d="M ${openTipX} ${openTipY} A ${openLen} ${openLen} 0 0 0 ${closeTipX} ${closeTipY}" fill="none" stroke="#58616d" stroke-width="${arcStroke}" />
      `;
    }

    if (side === 'top') {
      const mid = offsetX + door.mid * scale;
      const x1 = mid - half;
      const x2 = mid + half;
      const wallY = y;
      const hingeX = x1;
      const hingeY = wallY;
      const openTipX = hingeX;
      const openTipY = hingeY + openLen;
      const closeTipX = x2;
      const closeTipY = wallY;
      return `
        <line x1="${x1}" y1="${wallY}" x2="${x2}" y2="${wallY}" stroke="#f7f7f5" stroke-width="${gapStroke}" />
        <line x1="${hingeX}" y1="${hingeY}" x2="${openTipX}" y2="${openTipY}" stroke="#1f2329" stroke-width="${sw}" />
        <path d="M ${openTipX} ${openTipY} A ${openLen} ${openLen} 0 0 0 ${closeTipX} ${closeTipY}" fill="none" stroke="#58616d" stroke-width="${arcStroke}" />
      `;
    }

    const mid = offsetX + door.mid * scale;
    const x1 = mid - half;
    const x2 = mid + half;
    const wallY = y + h;
    const inY = wallY - openLen;
    const hingeX = x1;
    const hingeY = wallY;
    const openTipX = hingeX;
    const openTipY = inY;
    const closeTipX = x2;
    const closeTipY = wallY;
    return `
      <line x1="${x1}" y1="${wallY}" x2="${x2}" y2="${wallY}" stroke="#f7f7f5" stroke-width="${gapStroke}" />
      <line x1="${hingeX}" y1="${hingeY}" x2="${openTipX}" y2="${openTipY}" stroke="#1f2329" stroke-width="${sw}" />
      <path d="M ${openTipX} ${openTipY} A ${openLen} ${openLen} 0 0 1 ${closeTipX} ${closeTipY}" fill="none" stroke="#58616d" stroke-width="${arcStroke}" />
    `;
  };

  const makeWindowMarkup = (room, x, y, w, h) => {
    if (room.type === 'terrace' || room.type === 'stairs') return '';
    const windowSegW = Math.max(16, Math.min(58, w * 0.33));
    const windowSegH = Math.max(16, Math.min(58, h * 0.33));
    const bw = Math.max(1.2, roomStroke * 0.85);
    const windows = [];
    const touchesTop = room.y <= eps;
    const touchesBottom = room.y + room.h >= width - eps;
    const touchesLeft = room.x <= eps;
    const touchesRight = room.x + room.w >= length - eps;

    if (touchesTop) {
      const wx = x + w / 2 - windowSegW / 2;
      windows.push(`<rect x="${wx}" y="${y - bw * 0.75}" width="${windowSegW}" height="${bw * 1.5}" fill="#ffffff" stroke="#171a1f" stroke-width="${bw * 0.55}" />`);
    }
    if (touchesBottom) {
      const wx = x + w / 2 - windowSegW / 2;
      windows.push(`<rect x="${wx}" y="${y + h - bw * 0.75}" width="${windowSegW}" height="${bw * 1.5}" fill="#ffffff" stroke="#171a1f" stroke-width="${bw * 0.55}" />`);
    }
    if (touchesLeft) {
      const wy = y + h / 2 - windowSegH / 2;
      windows.push(`<rect x="${x - bw * 0.75}" y="${wy}" width="${bw * 1.5}" height="${windowSegH}" fill="#ffffff" stroke="#171a1f" stroke-width="${bw * 0.55}" />`);
    }
    if (touchesRight) {
      const wy = y + h / 2 - windowSegH / 2;
      windows.push(`<rect x="${x + w - bw * 0.75}" y="${wy}" width="${bw * 1.5}" height="${windowSegH}" fill="#ffffff" stroke="#171a1f" stroke-width="${bw * 0.55}" />`);
    }
    return windows.join('');
  };

  const makeStairsMarkup = (room, x, y, w, h) => {
    if (room.type !== 'stairs') return '';
    const inset = Math.max(4, Math.min(8, Math.min(w, h) * 0.06));
    const sx = x + inset;
    const sy = y + inset;
    const sw = Math.max(20, w - inset * 2);
    const sh = Math.max(20, h - inset * 2);
    return `
      <g>
        <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#stonePattern)" stroke="#4f5865" stroke-width="1.2" />
        <text x="${sx + sw / 2}" y="${sy + sh / 2 + 4}" text-anchor="middle" font-size="12" fill="#2f3640">楼梯间</text>
      </g>
    `;
  };

  const roomMarkup = plan.rooms.map(room => {
    const x = offsetX + room.x * scale;
    const y = offsetY + room.y * scale;
    const w = room.w * scale;
    const h = room.h * scale;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const labelLine2 = `${room.area}㎡`;
    const fontScale = Math.max(11, Math.min(18, Math.min(w, h) / 6.6));
    const showDefaultLabel = room.type !== 'stairs';
    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${getRoomPattern(room)}" stroke="#111519" stroke-width="${roomStroke}" />
        ${makeWindowMarkup(room, x, y, w, h)}
        ${makeStairsMarkup(room, x, y, w, h)}
        ${showDefaultLabel ? `<text x="${cx}" y="${cy - 6}" text-anchor="middle" class="room-label" style="font-size:${fontScale}px">${room.label}</text>` : ''}
        ${showDefaultLabel ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" class="room-area">${labelLine2}</text>` : `<text x="${cx}" y="${cy + 20}" text-anchor="middle" class="room-area">${labelLine2}</text>`}
      </g>
    `;
  }).join('');

  const doorMarkup = doorSpecs.map(item => makeDoorMarkup(item)).join('');

  const entranceDoor = (() => {
    if (plan.floor !== 1) return '';
    const cx = offsetX + (length * scale) / 2;
    const y = offsetY + width * scale;
    const leaf = 22;
    return `
      <g>
        <line x1="${cx - leaf}" y1="${y}" x2="${cx - leaf}" y2="${y + leaf}" stroke="#1f2228" stroke-width="1.8" />
        <line x1="${cx + leaf}" y1="${y}" x2="${cx + leaf}" y2="${y + leaf}" stroke="#1f2228" stroke-width="1.8" />
        <path d="M ${cx - leaf} ${y + leaf} Q ${cx} ${y + leaf} ${cx} ${y}" fill="none" stroke="#4d535c" stroke-width="1.3" />
        <path d="M ${cx + leaf} ${y + leaf} Q ${cx} ${y + leaf} ${cx} ${y}" fill="none" stroke="#4d535c" stroke-width="1.3" />
      </g>
    `;
  })();

  svg.innerHTML = `
    <defs>
      <pattern id="woodPattern" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#efebe2" />
        <path d="M 0 6 L 24 6 M 0 16 L 24 16" stroke="#e2ddd2" stroke-width="1.2" />
        <path d="M 8 0 L 8 24 M 17 0 L 17 24" stroke="#dfd9cd" stroke-width="0.6" />
      </pattern>
      <pattern id="stonePattern" width="28" height="28" patternUnits="userSpaceOnUse">
        <rect width="28" height="28" fill="#d8dbe0" />
        <path d="M 0 14 L 28 14 M 14 0 L 14 28" stroke="#c5cad2" stroke-width="1" />
        <path d="M 0 0 L 28 28 M 28 0 L 0 28" stroke="#ced3db" stroke-width="0.6" />
      </pattern>
      <pattern id="tilePattern" width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="#efefe9" />
        <path d="M 0 10 L 20 10 M 10 0 L 10 20" stroke="#d7d8d2" stroke-width="1" />
      </pattern>
      <pattern id="terracePattern" width="18" height="18" patternUnits="userSpaceOnUse">
        <rect width="18" height="18" fill="#e5e7ea" />
        <path d="M 0 0 L 18 18 M 18 0 L 0 18" stroke="#d4d8de" stroke-width="0.9" />
      </pattern>
    </defs>
    <rect x="0" y="0" width="1000" height="700" fill="#f6f9fc" />
    <rect x="${offsetX - 2}" y="${offsetY - 2}" width="${length * scale + 4}" height="${width * scale + 4}" fill="#f8f8f5" stroke="#111519" stroke-width="${wallStroke}" />
    <text x="80" y="48" font-size="24" fill="#243241" font-weight="800">第 ${plan.floor} 层平面图</text>
    <text x="80" y="74" font-size="14" fill="#6b7785">建筑尺寸 ${length}m x ${width}m · 本层净面积 ${plan.usedArea}㎡</text>
    ${roomMarkup}
    ${doorMarkup}
    ${entranceDoor}
    <line x1="${offsetX}" y1="${offsetY + width * scale + 28}" x2="${offsetX + length * scale}" y2="${offsetY + width * scale + 28}" stroke="#506070" stroke-width="2" />
    <line x1="${offsetX}" y1="${offsetY + width * scale + 22}" x2="${offsetX}" y2="${offsetY + width * scale + 34}" stroke="#506070" stroke-width="2" />
    <line x1="${offsetX + length * scale}" y1="${offsetY + width * scale + 22}" x2="${offsetX + length * scale}" y2="${offsetY + width * scale + 34}" stroke="#506070" stroke-width="2" />
    <text x="${offsetX + length * scale / 2}" y="${offsetY + width * scale + 52}" text-anchor="middle" font-size="14" fill="#506070">长度 ${length}m</text>
    <line x1="${offsetX + length * scale + 28}" y1="${offsetY}" x2="${offsetX + length * scale + 28}" y2="${offsetY + width * scale}" stroke="#506070" stroke-width="2" />
    <line x1="${offsetX + length * scale + 22}" y1="${offsetY}" x2="${offsetX + length * scale + 34}" y2="${offsetY}" stroke="#506070" stroke-width="2" />
    <line x1="${offsetX + length * scale + 22}" y1="${offsetY + width * scale}" x2="${offsetX + length * scale + 34}" y2="${offsetY + width * scale}" stroke="#506070" stroke-width="2" />
    <text x="${offsetX + length * scale + 52}" y="${offsetY + width * scale / 2}" text-anchor="middle" font-size="14" fill="#506070" transform="rotate(90 ${offsetX + length * scale + 52} ${offsetY + width * scale / 2})">宽度 ${width}m</text>
  `;
}

function initThree() {
  const container = els.threeContainer;
  const scene = new THREE.Scene();
  const skyColor = 0xe8f0f8;
  scene.background = new THREE.Color(skyColor);
  scene.fog = new THREE.Fog(skyColor, 25, 90);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 1000);
  camera.position.set(18, 14, 18);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, Math.max(container.clientHeight, 340));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 4, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8e1eb, 1.1);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xfff5e6, 1.35);
  dir.position.set(12, 22, 8);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 2048;
  dir.shadow.mapSize.height = 2048;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 80;
  dir.shadow.camera.left = -25;
  dir.shadow.camera.right = 25;
  dir.shadow.camera.top = 25;
  dir.shadow.camera.bottom = -25;
  dir.shadow.bias = -0.0005;
  dir.shadow.radius = 3;
  scene.add(dir);

  const grid = new THREE.GridHelper(40, 40, 0xc2cdda, 0xe3ebf5);
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.95, metalness: 0.01 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = Math.max(container.clientHeight, 340);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return { scene, camera, renderer, controls };
}

function renderBuilding3D(result, three) {
  if (currentModel) {
    three.scene.remove(currentModel);
    disposeGroup(currentModel);
  }

  const cfg = result.config;
  const preset = STYLE_PRESETS[cfg.styleType] || STYLE_PRESETS.simple;
  const group = new THREE.Group();
  const terraceSpecs = getTerraceSpecs(result, cfg);
  const shellOpenings = buildWallOpenings(cfg, result.floorPlans, terraceSpecs);

  const bodyHeight = cfg.floors * cfg.floorHeight;
  addExteriorShell(group, cfg, preset, terraceSpecs, shellOpenings);
  addInteriorPreview(group, cfg, result.floorPlans);
  addStairCore(group, cfg, preset, result.floorPlans);
  addFloorBands(group, cfg, preset, bodyHeight);
  addFacadeBands(group, cfg);
  addFacadeVolumes(group, cfg, preset, terraceSpecs);
  addWindows(group, cfg, preset, bodyHeight, terraceSpecs, shellOpenings);
  addDoor(group, cfg, preset);
  addEntrancePortal(group, cfg, preset);

  if (cfg.hasPorch) {
    const porch = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(3.2, cfg.length * 0.35), 0.22, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xd8d1c7 })
    );
    porch.position.set(0, 0.11, cfg.width / 2 + 0.7);
    group.add(porch);
  }

  addBalconies(group, cfg, preset, terraceSpecs);
  addBalconyDoors(group, cfg, preset, terraceSpecs);

  const topTerraceSpec = getTerraceSpecForFloor(terraceSpecs, cfg.floors);
  addRoof(group, cfg, preset, bodyHeight, topTerraceSpec);

  group.position.set(0, 0, 0);
  currentModel = group;
  three.scene.add(group);

  const maxDim = Math.max(cfg.length, cfg.width, bodyHeight + 2);
  three.camera.position.set(maxDim * 1.45, maxDim * 0.95, maxDim * 1.35);
  three.controls.target.set(0, bodyHeight * 0.45, 0);
  three.controls.update();
}

function addFloorBands(group, cfg, preset, bodyHeight) {
  for (let i = 1; i < cfg.floors; i++) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.length + 0.03, 0.08, cfg.width + 0.03),
      new THREE.MeshStandardMaterial({ color: preset.accent })
    );
    band.position.y = i * cfg.floorHeight;
    group.add(band);
  }
}

function getTerraceSpecs(result, cfg) {
  const specs = [];
  (result.floorPlans || []).forEach(plan => {
    if (!plan || plan.floor < 2) return;
    const terrace = (plan.rooms || []).find(r => r.type === 'terrace');
    if (!terrace) return;

    const x1 = clamp(terrace.x, 0, cfg.length);
    const x2 = clamp(terrace.x + terrace.w, 0, cfg.length);
    const y1 = clamp(terrace.y, 0, cfg.width);
    const y2 = clamp(terrace.y + terrace.h, 0, cfg.width);
    if (x2 - x1 < 0.3 || y2 - y1 < 0.3) return;

    specs.push({
      floor: plan.floor,
      x1,
      x2,
      y1,
      y2,
      corner: terrace._corner || 'tl',
      xMin: -cfg.length / 2 + x1,
      xMax: -cfg.length / 2 + x2,
      zMin: -cfg.width / 2 + y1,
      zMax: -cfg.width / 2 + y2
    });
  });
  return specs;
}

function getTerraceSpecForFloor(terraceSpecs, floor) {
  return (terraceSpecs || []).find(s => s.floor === floor) || null;
}

function sliceOpeningsByRange(openings, uStart, uEnd) {
  const result = [];
  (openings || []).forEach(o => {
    const s = Math.max(uStart, o.u1);
    const e = Math.min(uEnd, o.u2);
    if (e - s <= 0.05) return;
    result.push({
      u1: s - uStart,
      u2: e - uStart,
      v1: o.v1,
      v2: o.v2
    });
  });
  return result;
}

function buildCornerTerraceWalls(group, cfg, floor, terrace, openings, wallMat, wallThickness, h, y) {
  const corner = terrace.corner || 'tl';
  const tw = terrace.x2 - terrace.x1;
  const td = terrace.y2 - terrace.y1;
  const doorHalf = Math.min(0.62, Math.max(0.35, td * 0.22));
  const doorCenterU = td / 2;
  const doorU1 = Math.max(0.08, doorCenterU - doorHalf);
  const doorU2 = Math.min(td - 0.08, doorCenterU + doorHalf);
  const innerXOpenings = doorU2 - doorU1 > 0.35
    ? [{ u1: doorU1, u2: doorU2, v1: 0.06, v2: Math.min(h - 0.08, 2.22) }]
    : [];

  // front 墙（z = +width/2）
  if (corner === 'tl' || corner === 'tr') {
    const front = createWallPanelWithOpenings(cfg.length, h, wallThickness, openings.front[floor], wallMat);
    front.position.set(0, y, cfg.width / 2 - wallThickness / 2);
    group.add(front);
  } else if (corner === 'bl') {
    if (cfg.length - terrace.x2 > 0.1) {
      const open = sliceOpeningsByRange(openings.front[floor], terrace.x2, cfg.length);
      const seg = createWallPanelWithOpenings(cfg.length - terrace.x2, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + terrace.x2 + (cfg.length - terrace.x2) / 2, y, cfg.width / 2 - wallThickness / 2);
      group.add(seg);
    }
  } else if (corner === 'br') {
    if (terrace.x1 > 0.1) {
      const open = sliceOpeningsByRange(openings.front[floor], 0, terrace.x1);
      const seg = createWallPanelWithOpenings(terrace.x1, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + terrace.x1 / 2, y, cfg.width / 2 - wallThickness / 2);
      group.add(seg);
    }
  }

  // back 墙（z = -width/2）
  if (corner === 'bl' || corner === 'br') {
    const back = createWallPanelWithOpenings(cfg.length, h, wallThickness, openings.back[floor], wallMat);
    back.position.set(0, y, -cfg.width / 2 + wallThickness / 2);
    group.add(back);
  } else if (corner === 'tl') {
    if (cfg.length - terrace.x2 > 0.1) {
      const open = sliceOpeningsByRange(openings.back[floor], terrace.x2, cfg.length);
      const seg = createWallPanelWithOpenings(cfg.length - terrace.x2, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + terrace.x2 + (cfg.length - terrace.x2) / 2, y, -cfg.width / 2 + wallThickness / 2);
      group.add(seg);
    }
  } else if (corner === 'tr') {
    if (terrace.x1 > 0.1) {
      const open = sliceOpeningsByRange(openings.back[floor], 0, terrace.x1);
      const seg = createWallPanelWithOpenings(terrace.x1, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + terrace.x1 / 2, y, -cfg.width / 2 + wallThickness / 2);
      group.add(seg);
    }
  }

  // left 墙（x = -length/2）
  if (corner === 'tr' || corner === 'br') {
    const left = createWallPanelWithOpenings(cfg.width, h, wallThickness, openings.left[floor], wallMat);
    left.position.set(-cfg.length / 2 + wallThickness / 2, y, 0);
    left.rotation.y = Math.PI / 2;
    group.add(left);
  } else if (corner === 'tl') {
    if (cfg.width - terrace.y2 > 0.1) {
      const open = sliceOpeningsByRange(openings.left[floor], terrace.y2, cfg.width);
      const seg = createWallPanelWithOpenings(cfg.width - terrace.y2, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + wallThickness / 2, y, -cfg.width / 2 + terrace.y2 + (cfg.width - terrace.y2) / 2);
      seg.rotation.y = Math.PI / 2;
      group.add(seg);
    }
  } else if (corner === 'bl') {
    if (terrace.y1 > 0.1) {
      const open = sliceOpeningsByRange(openings.left[floor], 0, terrace.y1);
      const seg = createWallPanelWithOpenings(terrace.y1, h, wallThickness, open, wallMat);
      seg.position.set(-cfg.length / 2 + wallThickness / 2, y, -cfg.width / 2 + terrace.y1 / 2);
      seg.rotation.y = Math.PI / 2;
      group.add(seg);
    }
  }

  // right 墙（x = +length/2）
  if (corner === 'tl' || corner === 'bl') {
    const right = createWallPanelWithOpenings(cfg.width, h, wallThickness, openings.right[floor], wallMat);
    right.position.set(cfg.length / 2 - wallThickness / 2, y, 0);
    right.rotation.y = Math.PI / 2;
    group.add(right);
  } else if (corner === 'tr') {
    if (cfg.width - terrace.y2 > 0.1) {
      const open = sliceOpeningsByRange(openings.right[floor], terrace.y2, cfg.width);
      const seg = createWallPanelWithOpenings(cfg.width - terrace.y2, h, wallThickness, open, wallMat);
      seg.position.set(cfg.length / 2 - wallThickness / 2, y, -cfg.width / 2 + terrace.y2 + (cfg.width - terrace.y2) / 2);
      seg.rotation.y = Math.PI / 2;
      group.add(seg);
    }
  } else if (corner === 'br') {
    if (terrace.y1 > 0.1) {
      const open = sliceOpeningsByRange(openings.right[floor], 0, terrace.y1);
      const seg = createWallPanelWithOpenings(terrace.y1, h, wallThickness, open, wallMat);
      seg.position.set(cfg.length / 2 - wallThickness / 2, y, -cfg.width / 2 + terrace.y1 / 2);
      seg.rotation.y = Math.PI / 2;
      group.add(seg);
    }
  }

  // inner walls
  if (corner === 'tl') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(-cfg.length / 2 + terrace.x2 - wallThickness / 2, y, -cfg.width / 2 + td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, [], wallMat);
    innerZWall.position.set(-cfg.length / 2 + tw / 2, y, -cfg.width / 2 + terrace.y2 - wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'tr') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(cfg.length / 2 - terrace.x1 + wallThickness / 2, y, -cfg.width / 2 + td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, [], wallMat);
    innerZWall.position.set(cfg.length / 2 - tw / 2, y, -cfg.width / 2 + terrace.y2 - wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'bl') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(-cfg.length / 2 + terrace.x2 - wallThickness / 2, y, cfg.width / 2 - td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, [], wallMat);
    innerZWall.position.set(-cfg.length / 2 + tw / 2, y, cfg.width / 2 - terrace.y1 + wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'br') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(cfg.length / 2 - terrace.x1 + wallThickness / 2, y, cfg.width / 2 - td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, [], wallMat);
    innerZWall.position.set(cfg.length / 2 - tw / 2, y, cfg.width / 2 - terrace.y1 + wallThickness / 2);
    group.add(innerZWall);
  }
}

function addExteriorShell(group, cfg, preset, terraceSpecs = [], shellOpenings = null) {
  const wallThickness = 0.22;
  const wallMat = new THREE.MeshStandardMaterial({ color: preset.wall, roughness: 0.92, metalness: 0.02 });
  const openings = shellOpenings || buildWallOpenings(cfg, [], terraceSpecs);
  const h = cfg.floorHeight;
  const eps = 0.12;

  for (let floor = 0; floor < cfg.floors; floor++) {
    const y = floor * h + h / 2;
    const terrace = getTerraceSpecForFloor(terraceSpecs, floor + 1);

    if (terrace) {
      buildCornerTerraceWalls(group, cfg, floor, terrace, openings, wallMat, wallThickness, h, y);
    } else {
      const front = createWallPanelWithOpenings(cfg.length, h, wallThickness, openings.front[floor], wallMat);
      front.position.set(0, y, cfg.width / 2 - wallThickness / 2);
      group.add(front);

      const back = createWallPanelWithOpenings(cfg.length, h, wallThickness, openings.back[floor], wallMat);
      back.position.set(0, y, -cfg.width / 2 + wallThickness / 2);
      group.add(back);

      const left = createWallPanelWithOpenings(cfg.width, h, wallThickness, openings.left[floor], wallMat);
      left.position.set(-cfg.length / 2 + wallThickness / 2, y, 0);
      left.rotation.y = Math.PI / 2;
      group.add(left);

      const right = createWallPanelWithOpenings(cfg.width, h, wallThickness, openings.right[floor], wallMat);
      right.position.set(cfg.length / 2 - wallThickness / 2, y, 0);
      right.rotation.y = Math.PI / 2;
      group.add(right);
    }
  }

  const slabMat = new THREE.MeshStandardMaterial({ color: 0xe3e3e0, roughness: 0.95, metalness: 0.01 });
  const innerL = cfg.length - wallThickness * 0.6;
  const innerW = cfg.width - wallThickness * 0.6;
  for (let i = 0; i <= cfg.floors; i++) {
    const y = i * cfg.floorHeight + 0.04;
    const terrace = i >= 1 ? getTerraceSpecForFloor(terraceSpecs, i) : null;

    if (!terrace) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(innerL, 0.08, innerW),
        slabMat
      );
      slab.position.y = y;
      slab.receiveShadow = true;
      group.add(slab);
      continue;
    }

    const corner = terrace.corner || 'tl';
    const { xMin, xMax, zMin, zMax } = terrace;

    if (corner === 'tl') {
      const rightW = innerL / 2 - xMax;
      if (rightW > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(rightW, 0.08, innerW), slabMat);
        strip.position.set(xMax + rightW / 2, y, 0);
        strip.receiveShadow = true; group.add(strip);
      }
      const bottomH = innerW / 2 - zMax;
      if (bottomH > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(xMax + innerL / 2, 0.08, bottomH), slabMat);
        strip.position.set((-innerL / 2 + xMax) / 2, y, zMax + bottomH / 2);
        strip.receiveShadow = true; group.add(strip);
      }
    } else if (corner === 'tr') {
      const leftW = xMin - (-innerL / 2);
      if (leftW > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(leftW, 0.08, innerW), slabMat);
        strip.position.set(-innerL / 2 + leftW / 2, y, 0);
        strip.receiveShadow = true; group.add(strip);
      }
      const bottomH = innerW / 2 - zMax;
      if (bottomH > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(innerL / 2 - xMin, 0.08, bottomH), slabMat);
        strip.position.set(xMin + (innerL / 2 - xMin) / 2, y, zMax + bottomH / 2);
        strip.receiveShadow = true; group.add(strip);
      }
    } else if (corner === 'bl') {
      const rightW = innerL / 2 - xMax;
      if (rightW > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(rightW, 0.08, innerW), slabMat);
        strip.position.set(xMax + rightW / 2, y, 0);
        strip.receiveShadow = true; group.add(strip);
      }
      const topH = zMin - (-innerW / 2);
      if (topH > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(xMax + innerL / 2, 0.08, topH), slabMat);
        strip.position.set((-innerL / 2 + xMax) / 2, y, -innerW / 2 + topH / 2);
        strip.receiveShadow = true; group.add(strip);
      }
    } else if (corner === 'br') {
      const leftW = xMin - (-innerL / 2);
      if (leftW > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(leftW, 0.08, innerW), slabMat);
        strip.position.set(-innerL / 2 + leftW / 2, y, 0);
        strip.receiveShadow = true; group.add(strip);
      }
      const topH = zMin - (-innerW / 2);
      if (topH > 0.05) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(innerL / 2 - xMin, 0.08, topH), slabMat);
        strip.position.set(xMin + (innerL / 2 - xMin) / 2, y, -innerW / 2 + topH / 2);
        strip.receiveShadow = true; group.add(strip);
      }
    }
  }
}

function pushOpening(list, item, maxU, maxV) {
  const opening = {
    u1: clamp(item.u1, 0, maxU),
    u2: clamp(item.u2, 0, maxU),
    v1: clamp(item.v1, 0, maxV),
    v2: clamp(item.v2, 0, maxV),
    kind: item.kind || 'window'
  };
  if (opening.u2 - opening.u1 < 0.08 || opening.v2 - opening.v1 < 0.2) return;

  // 窗洞不做自动合并，避免出现“洞口大于窗框”导致的空洞外观
  if (opening.kind === 'window') {
    list.push(opening);
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if ((e.kind || 'window') !== opening.kind) continue;
    const overlapU = Math.min(e.u2, opening.u2) - Math.max(e.u1, opening.u1);
    const overlapV = Math.min(e.v2, opening.v2) - Math.max(e.v1, opening.v1);
    if (overlapU > 0.05 && overlapV > 0.2) {
      list[i] = {
        u1: Math.min(e.u1, opening.u1),
        u2: Math.max(e.u2, opening.u2),
        v1: Math.min(e.v1, opening.v1),
        v2: Math.max(e.v2, opening.v2),
        kind: opening.kind
      };
      return;
    }
  }
  list.push(opening);
}

function buildWallOpenings(cfg, floorPlans = [], terraceSpecs = []) {
  const openings = { front: [], back: [], left: [], right: [] };
  const winH = Math.max(1.05, Math.min(1.35, cfg.floorHeight * 0.36));
  const winCenter = cfg.floorHeight * 0.56;
  const winV1 = Math.max(0.25, winCenter - winH / 2);
  const winV2 = Math.min(cfg.floorHeight - 0.22, winCenter + winH / 2);
  const doorW = 1.35;
  const doorH = Math.min(2.25, cfg.floorHeight - 0.15);
  const eps = 0.08;

  for (let floor = 0; floor < cfg.floors; floor++) {
    const front = [];
    const back = [];
    const left = [];
    const right = [];
    const plan = (floorPlans || []).find(item => item.floor === floor + 1);

    if (plan?.rooms?.length) {
      plan.rooms.forEach(room => {
        if (room.type === 'corridor' || room.type === 'stairs' || room.type === 'terrace') return;

        // 窗户密度系数
        const densityMultipliers = { low: 0.5, medium: 1.0, high: 1.7 };
        const densityMul = densityMultipliers[cfg.windowDensity] || 1.0;

        // 基础半宽
        let baseHx = clamp(room.w * 0.18, 0.32, Math.min(0.95, room.w * 0.45));
        let baseHz = clamp(room.h * 0.18, 0.32, Math.min(0.95, room.h * 0.45));

        // 随机窗户形状变化
        const shapeRoll = Math.random();
        let winV1_eff = winV1, winV2_eff = winV2;
        let hx = baseHx, hz = baseHz;

        if (shapeRoll < 0.18) {
          // 横条窗：更宽更矮
          hx = Math.min(baseHx * 1.45, room.w * 0.58);
          hz = baseHz * 0.8;
          winV1_eff = winV1 + 0.22;
        } else if (shapeRoll < 0.32) {
          // 竖条窗：更高更窄
          hx = baseHx * 0.65;
          hz = Math.min(baseHz * 1.25, room.h * 0.62);
          winV1_eff = Math.max(0.1, winV1 - 0.35);
          winV2_eff = Math.min(cfg.floorHeight - 0.1, winV2 + 0.12);
        } else if (shapeRoll < 0.42) {
          // 方形窗
          const sq = Math.min(baseHx, (winV2 - winV1) * 0.5) * 1.1;
          hx = sq; hz = sq;
        }

        // 辅助：在墙面上按密度生成 1~3 个窗洞
        const pushWindows = (wallLen, halfW, offset, maxU, targetArr) => {
          let count = 1;
          if (wallLen * densityMul > 4.2) count = 2;
          if (wallLen * densityMul > 7.0) count = 3;
          count = Math.min(count, Math.floor(wallLen / 1.2));
          const seg = wallLen / count;
          for (let i = 0; i < count; i++) {
            const center = offset + (i + 0.5) * seg;
            pushOpening(targetArr, { u1: center - halfW, u2: center + halfW, v1: winV1_eff, v2: winV2_eff, kind: 'window' }, maxU, cfg.floorHeight);
          }
        };

        if (room.y <= eps) {
          pushWindows(room.w, hx, room.x, cfg.length, back);
        }
        if (room.y + room.h >= cfg.width - eps) {
          let count = 1;
          if (room.w * densityMul > 4.2) count = 2;
          if (room.w * densityMul > 7.0) count = 3;
          count = Math.min(count, Math.floor(room.w / 1.2));
          const seg = room.w / count;
          for (let i = 0; i < count; i++) {
            const center = room.x + (i + 0.5) * seg;
            const u1 = center - hx, u2 = center + hx;
            if (floor === 0) {
              const doorHalf = doorW / 2;
              const doorCenter = cfg.length / 2;
              const doorLeft = doorCenter - doorHalf;
              const doorRight = doorCenter + doorHalf;
              if (u2 > doorLeft && u1 < doorRight) {
                if (u1 < doorLeft) pushOpening(front, { u1, u2: doorLeft, v1: winV1_eff, v2: winV2_eff, kind: 'window' }, cfg.length, cfg.floorHeight);
                if (u2 > doorRight) pushOpening(front, { u1: doorRight, u2, v1: winV1_eff, v2: winV2_eff, kind: 'window' }, cfg.length, cfg.floorHeight);
              } else {
                pushOpening(front, { u1, u2, v1: winV1_eff, v2: winV2_eff, kind: 'window' }, cfg.length, cfg.floorHeight);
              }
            } else {
              pushOpening(front, { u1, u2, v1: winV1_eff, v2: winV2_eff, kind: 'window' }, cfg.length, cfg.floorHeight);
            }
          }
        }
        if (room.x <= eps) {
          pushWindows(room.h, hz, room.y, cfg.width, left);
        }
        if (room.x + room.w >= cfg.length - eps) {
          pushWindows(room.h, hz, room.y, cfg.width, right);
        }
      });
    }

    const terrace = getTerraceSpecForFloor(terraceSpecs, floor + 1);
    if (terrace) {
      const margin = 0.05;
      const corner = terrace.corner || 'tl';
      if (corner === 'tl') {
        const keepBack = back.filter(o => o.u1 >= terrace.x2 + margin);
        const keepLeft = left.filter(o => o.u1 >= terrace.y2 + margin);
        back.length = 0; back.push(...keepBack);
        left.length = 0; left.push(...keepLeft);
      } else if (corner === 'tr') {
        const keepBack = back.filter(o => o.u2 <= terrace.x1 - margin);
        const keepRight = right.filter(o => o.u1 >= terrace.y2 + margin);
        back.length = 0; back.push(...keepBack);
        right.length = 0; right.push(...keepRight);
      } else if (corner === 'bl') {
        const keepFront = front.filter(o => o.u1 >= terrace.x2 + margin);
        const keepLeft = left.filter(o => o.u2 <= terrace.y1 - margin);
        front.length = 0; front.push(...keepFront);
        left.length = 0; left.push(...keepLeft);
      } else if (corner === 'br') {
        const keepFront = front.filter(o => o.u2 <= terrace.x1 - margin);
        const keepRight = right.filter(o => o.u2 <= terrace.y1 - margin);
        front.length = 0; front.push(...keepFront);
        right.length = 0; right.push(...keepRight);
      }
    }

    if (floor === 0) {
      const center = cfg.length / 2;
      pushOpening(front, { u1: center - doorW / 2, u2: center + doorW / 2, v1: 0.02, v2: doorH, kind: 'door' }, cfg.length, cfg.floorHeight);
    }

    const sortByU = arr => arr.sort((a, b) => a.u1 - b.u1);
    openings.front.push(sortByU(front));
    openings.back.push(sortByU(back));
    openings.left.push(sortByU(left));
    openings.right.push(sortByU(right));
  }

  return openings;
}

function createWallPanelWithOpenings(length, height, thickness, openings, material) {
  const g = new THREE.Group();
  const clamped = (openings || [])
    .map(o => ({
      u1: clamp(o.u1, 0, length),
      u2: clamp(o.u2, 0, length),
      v1: clamp(o.v1, 0, height),
      v2: clamp(o.v2, 0, height)
    }))
    .filter(o => o.u2 - o.u1 > 0.05 && o.v2 - o.v1 > 0.05);

  const uCuts = [0, length];
  const vCuts = [0, height];
  clamped.forEach(o => {
    uCuts.push(o.u1, o.u2);
    vCuts.push(o.v1, o.v2);
  });

  const uniq = (arr) => Array.from(new Set(arr.map(v => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);
  const us = uniq(uCuts);
  const vs = uniq(vCuts);

  for (let ui = 0; ui < us.length - 1; ui++) {
    for (let vi = 0; vi < vs.length - 1; vi++) {
      const u0 = us[ui];
      const u1 = us[ui + 1];
      const v0 = vs[vi];
      const v1 = vs[vi + 1];
      const du = u1 - u0;
      const dv = v1 - v0;
      if (du < 0.05 || dv < 0.05) continue;

      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      const insideOpening = clamped.some(o => uc > o.u1 + 1e-4 && uc < o.u2 - 1e-4 && vc > o.v1 + 1e-4 && vc < o.v2 - 1e-4);
      if (insideOpening) continue;

      const seg = new THREE.Mesh(new THREE.BoxGeometry(du, dv, thickness), material);
      seg.position.set(-length / 2 + u0 + du / 2, -height / 2 + v0 + dv / 2, 0);
      seg.castShadow = true;
      seg.receiveShadow = true;
      g.add(seg);
    }
  }

  return g;
}

function addInteriorPreview(group, cfg, floorPlans = []) {
  const floorMatByType = {
    living_room: 0xe8e2d7,
    lounge: 0xe8e2d7,
    bedroom: 0xece7de,
    study: 0xe6e2d7,
    dining: 0xe3ddd2,
    kitchen: 0xe0ddd7,
    bathroom: 0xd8dde3,
    storage: 0xe4dfd8,
    multi: 0xe6e0d8,
    corridor: 0xd6dbe2,
    stairs: 0xd7d5cf
  };

  const interiorWallMat = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.92, metalness: 0.02 });
  const wallH = Math.max(2.2, cfg.floorHeight - 0.35);
  const wallT = 0.06;
  const eps = 0.06;

  const addFloorPatch = (room, yBase) => {
    if (room.type === 'terrace') return;
    const color = floorMatByType[room.type] || 0xe6e2da;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0.01 });
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.2, room.w - 0.04), 0.035, Math.max(0.2, room.h - 0.04)),
      mat
    );
    patch.position.set(
      -cfg.length / 2 + room.x + room.w / 2,
      yBase,
      -cfg.width / 2 + room.y + room.h / 2
    );
    patch.receiveShadow = true;
    group.add(patch);
  };

  (floorPlans || []).forEach(plan => {
    const yBase = (plan.floor - 1) * cfg.floorHeight + 0.02;
    const rooms = (plan.rooms || []).filter(r => r.type !== 'terrace');
    rooms.forEach(room => addFloorPatch(room, yBase));

    const segmentMap = new Map();
    const putSeg = (key, seg) => {
      if (!segmentMap.has(key)) segmentMap.set(key, seg);
    };

    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];

        if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
          const xShared = Math.abs(a.x + a.w - b.x) < eps ? a.x + a.w : b.x + b.w;
          const y1 = Math.max(a.y, b.y);
          const y2 = Math.min(a.y + a.h, b.y + b.h);
          if (y2 - y1 > 0.7 && xShared > eps && xShared < cfg.length - eps) {
            putSeg(`v-${round2(xShared)}-${round2(y1)}-${round2(y2)}`, { dir: 'v', x: xShared, y1, y2 });
          }
        }

        if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) {
          const yShared = Math.abs(a.y + a.h - b.y) < eps ? a.y + a.h : b.y + b.h;
          const x1 = Math.max(a.x, b.x);
          const x2 = Math.min(a.x + a.w, b.x + b.w);
          if (x2 - x1 > 0.7 && yShared > eps && yShared < cfg.width - eps) {
            putSeg(`h-${round2(yShared)}-${round2(x1)}-${round2(x2)}`, { dir: 'h', y: yShared, x1, x2 });
          }
        }
      }
    }

    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ef, roughness: 0.8, metalness: 0.02 });
    const doorLeafMat = new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.65, metalness: 0.02 });
    const doorW = 0.85;
    const doorH = Math.min(2.05, wallH - 0.12);

    segmentMap.forEach(seg => {
      if (seg.dir === 'v') {
        const totalLen = seg.y2 - seg.y1;
        if (totalLen > 1.3) {
          const mid = (seg.y1 + seg.y2) / 2;
          const dHalf = Math.min(doorW / 2, totalLen * 0.3);
          const bLen = mid - dHalf - seg.y1;
          const tLen = seg.y2 - (mid + dHalf);
          if (bLen > 0.05) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, bLen), interiorWallMat);
            w.position.set(-cfg.length / 2 + seg.x, yBase + wallH / 2, -cfg.width / 2 + (seg.y1 + mid - dHalf) / 2);
            group.add(w);
          }
          if (tLen > 0.05) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, tLen), interiorWallMat);
            w.position.set(-cfg.length / 2 + seg.x, yBase + wallH / 2, -cfg.width / 2 + (mid + dHalf + seg.y2) / 2);
            group.add(w);
          }
          // 门框
          const frame = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.015, doorH + 0.08, doorW + 0.04), doorFrameMat);
          frame.position.set(-cfg.length / 2 + seg.x, yBase + doorH / 2 + 0.04, -cfg.width / 2 + mid);
          group.add(frame);
          // 门扇（微开）
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(wallT * 0.6, doorH, doorW / 2 - 0.02), doorLeafMat);
          const leafGroup = new THREE.Group();
          leafGroup.position.set(-cfg.length / 2 + seg.x, yBase + doorH / 2 + 0.04, -cfg.width / 2 + mid - doorW / 4 + 0.01);
          leaf.position.set(0, 0, doorW / 4 - 0.01);
          leafGroup.add(leaf);
          leafGroup.rotation.y = 0.25;
          group.add(leafGroup);
        } else {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, Math.max(0.2, totalLen)), interiorWallMat);
          wall.position.set(-cfg.length / 2 + seg.x, yBase + wallH / 2, -cfg.width / 2 + (seg.y1 + seg.y2) / 2);
          group.add(wall);
        }
      } else {
        const totalLen = seg.x2 - seg.x1;
        if (totalLen > 1.3) {
          const mid = (seg.x1 + seg.x2) / 2;
          const dHalf = Math.min(doorW / 2, totalLen * 0.3);
          const lLen = mid - dHalf - seg.x1;
          const rLen = seg.x2 - (mid + dHalf);
          if (lLen > 0.05) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(lLen, wallH, wallT), interiorWallMat);
            w.position.set(-cfg.length / 2 + (seg.x1 + mid - dHalf) / 2, yBase + wallH / 2, -cfg.width / 2 + seg.y);
            group.add(w);
          }
          if (rLen > 0.05) {
            const w = new THREE.Mesh(new THREE.BoxGeometry(rLen, wallH, wallT), interiorWallMat);
            w.position.set(-cfg.length / 2 + (mid + dHalf + seg.x2) / 2, yBase + wallH / 2, -cfg.width / 2 + seg.y);
            group.add(w);
          }
          const frame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.04, doorH + 0.08, wallT + 0.015), doorFrameMat);
          frame.position.set(-cfg.length / 2 + mid, yBase + doorH / 2 + 0.04, -cfg.width / 2 + seg.y);
          group.add(frame);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(doorW / 2 - 0.02, doorH, wallT * 0.6), doorLeafMat);
          const leafGroup = new THREE.Group();
          leafGroup.position.set(-cfg.length / 2 + mid - doorW / 4 + 0.01, yBase + doorH / 2 + 0.04, -cfg.width / 2 + seg.y);
          leaf.position.set(doorW / 4 - 0.01, 0, 0);
          leafGroup.add(leaf);
          leafGroup.rotation.y = -0.25;
          group.add(leafGroup);
        } else {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, totalLen), wallH, wallT), interiorWallMat);
          wall.position.set(-cfg.length / 2 + (seg.x1 + seg.x2) / 2, yBase + wallH / 2, -cfg.width / 2 + seg.y);
          group.add(wall);
        }
      }
    });
  });
}

function addStairCore(group, cfg, preset, floorPlans = []) {
  if (cfg.floors <= 1) return;

  // 从2D平面布局中找到楼梯位置，确保2D/3D完全对应
  const stairRooms = [];
  (floorPlans || []).forEach(plan => {
    const room = (plan.rooms || []).find(r => r.type === 'stairs');
    if (room) {
      stairRooms.push({
        floor: plan.floor,
        cx: room.x + room.w / 2,
        cy: room.y + room.h / 2,
        w: room.w,
        h: room.h
      });
    }
  });

  if (!stairRooms.length) {
    addDefaultStairCore(group, cfg, preset);
    return;
  }

  // 使用第一层的楼梯位置和尺寸
  const sr = stairRooms[0];
  const shaftW = Math.max(1.4, sr.w * 0.82);
  const shaftD = Math.max(2.0, sr.h * 0.82);
  const shaftX = -cfg.length / 2 + sr.cx;
  const shaftZ = -cfg.width / 2 + sr.cy;
  const shaftH = cfg.floors * cfg.floorHeight - 0.2;

  const coreMat = new THREE.MeshStandardMaterial({ color: 0xd5d4cf, roughness: 0.9, metalness: 0.02 });
  const treadMat = new THREE.MeshStandardMaterial({ color: 0xc4b9aa, roughness: 0.87, metalness: 0.02 });
  const railMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.6, metalness: 0.08 });

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(shaftW, shaftH, shaftD), coreMat);
  shaft.position.set(shaftX, shaftH / 2 + 0.05, shaftZ);
  group.add(shaft);

  for (let level = 0; level < cfg.floors; level++) {
    const baseY = level * cfg.floorHeight + 0.12;
    const stepCount = 8;
    const runDepth = Math.min(1.2, shaftD * 0.45);
    const stepH = Math.max(0.12, (cfg.floorHeight - 0.28) / stepCount);
    const stepD = runDepth / stepCount;

    for (let i = 0; i < stepCount; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(shaftW * 0.82, stepH, stepD + 0.005),
        treadMat
      );
      step.position.set(
        shaftX,
        baseY + stepH * (i + 0.5),
        shaftZ - shaftD * 0.24 + i * stepD
      );
      group.add(step);
    }

    const rail = new THREE.Mesh(new THREE.BoxGeometry(shaftW * 0.86, 0.05, runDepth + 0.06), railMat);
    rail.position.set(shaftX, baseY + stepH * stepCount + 0.36, shaftZ + 0.02);
    group.add(rail);
  }
}

function addDefaultStairCore(group, cfg, preset) {
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xd5d4cf, roughness: 0.9, metalness: 0.02 });
  const treadMat = new THREE.MeshStandardMaterial({ color: 0xc4b9aa, roughness: 0.87, metalness: 0.02 });
  const railMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.6, metalness: 0.08 });

  const shaftW = 1.7;
  const shaftD = 2.7;
  const shaftX = cfg.length * 0.3 - cfg.length / 2;
  const shaftZ = -cfg.width * 0.25;
  const shaftH = cfg.floors * cfg.floorHeight - 0.2;

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(shaftW, shaftH, shaftD), coreMat);
  shaft.position.set(shaftX, shaftH / 2 + 0.05, shaftZ);
  group.add(shaft);

  for (let level = 0; level < cfg.floors; level++) {
    const baseY = level * cfg.floorHeight + 0.12;
    const stepCount = 8;
    const runDepth = 1.2;
    const stepH = Math.max(0.12, (cfg.floorHeight - 0.28) / stepCount);
    const stepD = runDepth / stepCount;

    for (let i = 0; i < stepCount; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(shaftW * 0.82, stepH, stepD + 0.005),
        treadMat
      );
      step.position.set(
        shaftX,
        baseY + stepH * (i + 0.5),
        shaftZ - shaftD * 0.24 + i * stepD
      );
      group.add(step);
    }

    const rail = new THREE.Mesh(new THREE.BoxGeometry(shaftW * 0.86, 0.05, runDepth + 0.06), railMat);
    rail.position.set(shaftX, baseY + stepH * stepCount + 0.36, shaftZ + 0.02);
    group.add(rail);
  }
}

function addFacadeBands(group, cfg) {
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.length + 0.04, 0.16, cfg.width + 0.04),
    new THREE.MeshStandardMaterial({ color: 0xdedddb, roughness: 0.92, metalness: 0.01 })
  );
  plinth.position.y = 0.08;
  group.add(plinth);

  const isPitched = cfg.roofType === 'gable' || cfg.roofType === 'hip';
  const topCornice = new THREE.Mesh(
    new THREE.BoxGeometry(
      cfg.length + (isPitched ? 0.04 : 0.14),
      isPitched ? 0.06 : 0.14,
      cfg.width + (isPitched ? 0.04 : 0.14)
    ),
    new THREE.MeshStandardMaterial({ color: 0xe7e4df, roughness: 0.9, metalness: 0.02 })
  );
  topCornice.position.y = cfg.floors * cfg.floorHeight - (isPitched ? 0.01 : 0.05);
  group.add(topCornice);
}

function addFacadePilasters(group, cfg) {
  const pilasterMat = new THREE.MeshStandardMaterial({ color: 0xe5e3df, roughness: 0.9, metalness: 0.02 });
  const h = cfg.floors * cfg.floorHeight;
  const pw = 0.16;
  const pd = 0.1;
  const x = cfg.length / 2 - pw / 2;
  const z = cfg.width / 2 - pd / 2;

  const corners = [
    [x, z],
    [x, -z],
    [-x, z],
    [-x, -z]
  ];

  corners.forEach(([cx, cz]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(pw, h, pd), pilasterMat);
    p.position.set(cx, h / 2, cz);
    group.add(p);
  });
}

function addFacadeVolumes(group, cfg, preset, terraceSpecs = []) {
  const accentMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.76, metalness: 0.04 });

  for (let i = 1; i < cfg.floors; i++) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.length + 0.05, 0.03, 0.06),
      accentMat
    );
    band.position.set(0, i * cfg.floorHeight + 0.02, cfg.width / 2 + 0.018);
    group.add(band);
  }
}

function resolveWindowParams(cfg) {
  if (cfg._windowParams) return cfg._windowParams;
  const style = cfg.windowStyle || 'random';
  const randomChoice = arr => arr[Math.floor(Math.random() * arr.length)];
  const randomBetween = (min, max) => Math.round((Math.random() * (max - min) + min) * 1000) / 1000;

  if (style === 'grid') {
    cfg._windowParams = { cols: 3, hasHBar: true, hBarRatio: 0.35, hasOpenLeaf: true, openLeafPos: 'tr', frameThick: 0.055, frameDepth: 0.075, sillDepth: 0.08, glassTint: 0xcfd8dc, glassOpacity: 0.18, useTransmission: true };
    return cfg._windowParams;
  }
  if (style === 'modern') {
    cfg._windowParams = { cols: 1, hasHBar: true, hBarRatio: 0.42, hasOpenLeaf: false, openLeafPos: 'tr', frameThick: 0.04, frameDepth: 0.065, sillDepth: 0.065, glassTint: 0xddeeff, glassOpacity: 0.22, useTransmission: true };
    return cfg._windowParams;
  }
  if (style === 'simple') {
    cfg._windowParams = { cols: 0, hasHBar: false, hBarRatio: 0.5, hasOpenLeaf: false, openLeafPos: 'tr', frameThick: 0.045, frameDepth: 0.06, sillDepth: 0.06, glassTint: 0xe8eef2, glassOpacity: 0.15, useTransmission: true };
    return cfg._windowParams;
  }
  // random: 组合出多元变化
  const presets = [
    { cols: 3, hasHBar: true, hBarRatio: 0.32, hasOpenLeaf: true },
    { cols: 3, hasHBar: true, hBarRatio: 0.45, hasOpenLeaf: false },
    { cols: 2, hasHBar: true, hBarRatio: 0.38, hasOpenLeaf: true },
    { cols: 2, hasHBar: false, hBarRatio: 0.5, hasOpenLeaf: true },
    { cols: 1, hasHBar: true, hBarRatio: 0.55, hasOpenLeaf: false },
    { cols: 0, hasHBar: false, hBarRatio: 0.5, hasOpenLeaf: false },
    { cols: 4, hasHBar: true, hBarRatio: 0.28, hasOpenLeaf: true },
    { cols: 3, hasHBar: true, hBarRatio: 0.62, hasOpenLeaf: true }
  ];
  const base = randomChoice(presets);
  cfg._windowParams = {
    cols: base.cols,
    hasHBar: base.hasHBar,
    hBarRatio: base.hBarRatio,
    hasOpenLeaf: base.hasOpenLeaf,
    openLeafPos: randomChoice(['tl', 'tr']),
    frameThick: randomBetween(0.035, 0.07),
    frameDepth: randomBetween(0.05, 0.09),
    sillDepth: randomBetween(0.05, 0.1),
    glassTint: randomChoice([0xcfd8dc, 0xdde5ea, 0xe8eef2, 0xf0f4f7]),
    glassOpacity: randomBetween(0.1, 0.3),
    useTransmission: true
  };
  return cfg._windowParams;
}

function addWindows(group, cfg, preset, bodyHeight, terraceSpecs = [], shellOpenings = null) {
  const openings = shellOpenings || buildWallOpenings(cfg, [], terraceSpecs);
  const params = resolveWindowParams(cfg);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
  const muntinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: params.glassTint,
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity: params.glassOpacity,
    transmission: params.useTransmission ? 0.85 : 0,
    thickness: 0.02,
    depthWrite: false,
    ior: 1.5
  });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xd4c4a8, roughness: 0.6, metalness: 0.02 });
  const minWindowW = 0.28;
  const minWindowH = 0.55;

  const isWindowOpening = (o) => {
    if ((o.kind || 'window') !== 'window') return false;
    const w = o.u2 - o.u1;
    const h = o.v2 - o.v1;
    if (w < minWindowW || h < minWindowH) return false;
    return true;
  };

  const buildWindowFrontBack = (x, y, z, paneWidth, paneHeight, sign) => {
    const ft = params.frameThick;
    const fd = params.frameDepth;
    const frameZ = z + sign * 0.012;
    // 边框
    const top = new THREE.Mesh(new THREE.BoxGeometry(paneWidth + ft * 2, ft, fd), frameMat);
    top.position.set(x, y + paneHeight / 2 + ft / 2, frameZ); top.castShadow = true; group.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(paneWidth + ft * 2, ft, fd), frameMat);
    bottom.position.set(x, y - paneHeight / 2 - ft / 2, frameZ); bottom.castShadow = true; group.add(bottom);
    const left = new THREE.Mesh(new THREE.BoxGeometry(ft, paneHeight, fd), frameMat);
    left.position.set(x - paneWidth / 2 - ft / 2, y, frameZ); left.castShadow = true; group.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(ft, paneHeight, fd), frameMat);
    right.position.set(x + paneWidth / 2 + ft / 2, y, frameZ); right.castShadow = true; group.add(right);
    // 玻璃
    const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, paneWidth - ft * 0.5), Math.max(0.05, paneHeight - ft * 0.5), 0.004), glassMat);
    glass.position.set(x, y, frameZ + sign * 0.008); group.add(glass);
    // 竖条
    if (params.cols > 0) {
      const vBarW = Math.max(0.012, paneWidth * 0.022);
      for (let i = 1; i <= params.cols; i++) {
        const offsetX = -paneWidth / 2 + paneWidth * i / (params.cols + 1);
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(vBarW, Math.max(0.1, paneHeight - ft), 0.01), muntinMat);
        vBar.position.set(x + offsetX, y, frameZ + sign * 0.015); group.add(vBar);
      }
    }
    // 横条
    if (params.hasHBar) {
      const hBarH = Math.max(0.012, paneHeight * 0.022);
      const hBarY = y - paneHeight / 2 + paneHeight * params.hBarRatio;
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, paneWidth - ft), hBarH, 0.01), muntinMat);
      hBar.position.set(x, hBarY, frameZ + sign * 0.016); group.add(hBar);
    }
    // 开启扇
    if (params.hasOpenLeaf) {
      const cellW = paneWidth / (params.cols + 1 || 1);
      const cellH = params.hasHBar ? paneHeight * Math.max(0.25, params.hBarRatio) : paneHeight * 0.5;
      const colIndex = params.openLeafPos === 'tr' ? params.cols : 1;
      const offsetX = -paneWidth / 2 + cellW * (colIndex - 0.5);
      const offsetY = params.hasHBar ? y - paneHeight / 2 + paneHeight * params.hBarRatio + cellH / 2 : y + paneHeight * 0.25;
      const openLeafW = Math.max(0.06, cellW - 0.04);
      const openLeafH = Math.max(0.06, cellH - 0.04);
      const openGroup = new THREE.Group();
      openGroup.position.set(x + offsetX, offsetY, frameZ + sign * 0.018);
      const openLeaf = new THREE.Mesh(new THREE.BoxGeometry(openLeafW, openLeafH, 0.004), leafMat);
      openLeaf.position.set(openLeafW / 2, 0, 0);
      openGroup.add(openLeaf);
      openGroup.rotation.y = params.openLeafPos === 'tr' ? sign * 0.45 : -sign * 0.45;
      group.add(openGroup);
    }
    // 窗台
    const sill = new THREE.Mesh(new THREE.BoxGeometry(paneWidth + ft * 2 + 0.02, ft * 0.75, params.sillDepth), frameMat);
    sill.position.set(x, y - paneHeight / 2 - ft / 2, frameZ + sign * (params.sillDepth / 2 - fd / 2));
    sill.castShadow = true; group.add(sill);
  };

  const buildWindowSide = (x, y, z, paneDepth, paneHeight, sign) => {
    const ft = params.frameThick;
    const fd = params.frameDepth;
    const frameX = x + sign * 0.012;
    // 边框
    const top = new THREE.Mesh(new THREE.BoxGeometry(fd, ft, paneDepth + ft * 2), frameMat);
    top.position.set(frameX, y + paneHeight / 2 + ft / 2, z); top.castShadow = true; group.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(fd, ft, paneDepth + ft * 2), frameMat);
    bottom.position.set(frameX, y - paneHeight / 2 - ft / 2, z); bottom.castShadow = true; group.add(bottom);
    const left = new THREE.Mesh(new THREE.BoxGeometry(fd, paneHeight, ft), frameMat);
    left.position.set(frameX, y, z - paneDepth / 2 - ft / 2); left.castShadow = true; group.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(fd, paneHeight, ft), frameMat);
    right.position.set(frameX, y, z + paneDepth / 2 + ft / 2); right.castShadow = true; group.add(right);
    // 玻璃
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.004, Math.max(0.05, paneHeight - ft * 0.5), Math.max(0.05, paneDepth - ft * 0.5)), glassMat);
    glass.position.set(frameX + sign * 0.008, y, z); group.add(glass);
    // 竖条
    if (params.cols > 0) {
      const vBarD = Math.max(0.012, paneDepth * 0.022);
      for (let i = 1; i <= params.cols; i++) {
        const offsetZ = -paneDepth / 2 + paneDepth * i / (params.cols + 1);
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.01, Math.max(0.1, paneHeight - ft), vBarD), muntinMat);
        vBar.position.set(frameX + sign * 0.015, y, z + offsetZ); group.add(vBar);
      }
    }
    // 横条
    if (params.hasHBar) {
      const hBarH = Math.max(0.012, paneHeight * 0.022);
      const hBarY = y - paneHeight / 2 + paneHeight * params.hBarRatio;
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.01, hBarH, Math.max(0.1, paneDepth - ft)), muntinMat);
      hBar.position.set(frameX + sign * 0.016, hBarY, z); group.add(hBar);
    }
    // 开启扇
    if (params.hasOpenLeaf) {
      const cellD = paneDepth / (params.cols + 1 || 1);
      const cellH = params.hasHBar ? paneHeight * Math.max(0.25, params.hBarRatio) : paneHeight * 0.5;
      const colIndex = params.openLeafPos === 'tr' ? params.cols : 1;
      const offsetZ = -paneDepth / 2 + cellD * (colIndex - 0.5);
      const offsetY = params.hasHBar ? y - paneHeight / 2 + paneHeight * params.hBarRatio + cellH / 2 : y + paneHeight * 0.25;
      const openLeafD = Math.max(0.06, cellD - 0.04);
      const openLeafH = Math.max(0.06, cellH - 0.04);
      const openGroup = new THREE.Group();
      openGroup.position.set(frameX + sign * 0.018, offsetY, z + offsetZ);
      const openLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.004, openLeafH, openLeafD), leafMat);
      openLeaf.position.set(0, 0, openLeafD / 2);
      openGroup.add(openLeaf);
      openGroup.rotation.y = params.openLeafPos === 'tr' ? -sign * 0.45 : sign * 0.45;
      group.add(openGroup);
    }
    // 窗台
    const sill = new THREE.Mesh(new THREE.BoxGeometry(params.sillDepth, ft * 0.75, paneDepth + ft * 2 + 0.02), frameMat);
    sill.position.set(frameX + sign * (params.sillDepth / 2 - fd / 2), y - paneHeight / 2 - ft / 2, z);
    sill.castShadow = true; group.add(sill);
  };

  for (let floor = 0; floor < cfg.floors; floor++) {
    (openings.front[floor] || []).forEach(o => {
      if (!isWindowOpening(o)) return;
      const paneWidth = Math.max(0.28, o.u2 - o.u1 - 0.08);
      const paneHeight = Math.max(0.62, o.v2 - o.v1 - 0.08);
      const x = -cfg.length / 2 + (o.u1 + o.u2) / 2;
      const y = floor * cfg.floorHeight + (o.v1 + o.v2) / 2;
      buildWindowFrontBack(x, y, cfg.width / 2 + 0.05, paneWidth, paneHeight, 1);
    });
    (openings.back[floor] || []).forEach(o => {
      if (!isWindowOpening(o)) return;
      const paneWidth = Math.max(0.28, o.u2 - o.u1 - 0.08);
      const paneHeight = Math.max(0.62, o.v2 - o.v1 - 0.08);
      const x = -cfg.length / 2 + (o.u1 + o.u2) / 2;
      const y = floor * cfg.floorHeight + (o.v1 + o.v2) / 2;
      buildWindowFrontBack(x, y, -cfg.width / 2 - 0.05, paneWidth, paneHeight, -1);
    });
    (openings.left[floor] || []).forEach(o => {
      if (!isWindowOpening(o)) return;
      const paneDepth = Math.max(0.28, o.u2 - o.u1 - 0.08);
      const paneHeight = Math.max(0.62, o.v2 - o.v1 - 0.08);
      const z = -cfg.width / 2 + (o.u1 + o.u2) / 2;
      const y = floor * cfg.floorHeight + (o.v1 + o.v2) / 2;
      buildWindowSide(-cfg.length / 2 - 0.05, y, z, paneDepth, paneHeight, -1);
    });
    (openings.right[floor] || []).forEach(o => {
      if (!isWindowOpening(o)) return;
      const paneDepth = Math.max(0.28, o.u2 - o.u1 - 0.08);
      const paneHeight = Math.max(0.62, o.v2 - o.v1 - 0.08);
      const z = -cfg.width / 2 + (o.u1 + o.u2) / 2;
      const y = floor * cfg.floorHeight + (o.v1 + o.v2) / 2;
      buildWindowSide(cfg.length / 2 + 0.05, y, z, paneDepth, paneHeight, 1);
    });
  }
}

function addDoor(group, cfg, preset) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf1f2f3, roughness: 0.84, metalness: 0.03 });
  const doorMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.52, metalness: 0.08 });

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 2.35, 0.09),
    frameMat
  );
  frame.position.set(0, 1.18, cfg.width / 2 + 0.03);
  group.add(frame);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.28, 2.05, 0.07),
    doorMat
  );
  door.position.set(0, 1.05, cfg.width / 2 + 0.06);
  group.add(door);

  const doorPanelL = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 1.7, 0.018),
    new THREE.MeshStandardMaterial({ color: 0xc7b08f, roughness: 0.7, metalness: 0.02 })
  );
  doorPanelL.position.set(-0.3, 1.07, cfg.width / 2 + 0.094);
  group.add(doorPanelL);
  const doorPanelR = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 1.7, 0.018),
    new THREE.MeshStandardMaterial({ color: 0xc7b08f, roughness: 0.7, metalness: 0.02 })
  );
  doorPanelR.position.set(0.3, 1.07, cfg.width / 2 + 0.094);
  group.add(doorPanelR);

  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.5, metalness: 0.35 });
  const handleL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.02), handleMat);
  handleL.position.set(0.12, 1.1, cfg.width / 2 + 0.1);
  group.add(handleL);
}

function addEntrancePortal(group, cfg, preset) {
  const zBase = cfg.width / 2 + 0.76;
  const colMat = new THREE.MeshStandardMaterial({ color: 0xe5e2dd, roughness: 0.88, metalness: 0.02 });
  const topMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.72, metalness: 0.05 });

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.18, 0.72),
    colMat
  );
  cap.position.set(0, 2.27, zBase - 0.1);
  group.add(cap);

  const arch = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.08, 0.76),
    topMat
  );
  arch.position.set(0, 2.42, zBase - 0.09);
  group.add(arch);

  [-0.72, 0.72].forEach((x) => {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.095, 2.2, 14),
      colMat
    );
    col.position.set(x, 1.1, zBase - 0.12);
    group.add(col);
  });

  const stepEdge = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(3.2, cfg.length * 0.35), 0.05, 1.44),
    new THREE.MeshStandardMaterial({ color: 0xb6b0a4, roughness: 0.86, metalness: 0.02 })
  );
  stepEdge.position.set(0, 0.24, cfg.width / 2 + 0.7);
  group.add(stepEdge);
}

function addBalconies(group, cfg, preset, terraceSpecs = []) {
  const slabThickness = 0.12;
  const railHeight = 0.92;
  const railBottomY = 0.12;
  const randomChoice = arr => arr[Math.floor(Math.random() * arr.length)];
  let style = cfg.balconyStyle || 'railing';
  if (style === 'random') style = randomChoice(['railing', 'glass', 'none']);
  const railMat = new THREE.MeshStandardMaterial({ color: preset.accent, roughness: 0.6, metalness: 0.08 });
  const balusterMat = new THREE.MeshStandardMaterial({ color: 0x202327, roughness: 0.52, metalness: 0.2 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.56, metalness: 0.18 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xaaccdd, roughness: 0.12, metalness: 0.18, transparent: true, opacity: 0.22, depthWrite: false
  });

  const addRailBalustersLine = (x1, z1, x2, z2, yBase) => {
    const len = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    const count = Math.max(6, Math.floor(len / 0.14));
    const dx = (x2 - x1) / (count + 1);
    const dz = (z2 - z1) / (count + 1);
    const balusterH = railHeight - railBottomY;
    for (let i = 1; i <= count; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, balusterH, 8), balusterMat);
      b.position.set(x1 + dx * i, yBase + railBottomY + balusterH / 2, z1 + dz * i);
      group.add(b);
    }
  };

  (terraceSpecs || []).forEach(spec => {
    const level = spec.floor;
    if (level < 2) return;
    const slabY = (level - 1) * cfg.floorHeight + slabThickness / 2 + 0.01;
    const width = Math.max(0.5, spec.xMax - spec.xMin);
    const depth = Math.max(0.5, spec.zMax - spec.zMin);
    const xCenter = (spec.xMin + spec.xMax) / 2;
    const zCenter = (spec.zMin + spec.zMax) / 2;

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.02, slabThickness, depth - 0.02),
      new THREE.MeshStandardMaterial({ color: 0xdbd9d2, roughness: 0.9, metalness: 0.02 })
    );
    slab.position.set(xCenter, slabY, zCenter);
    group.add(slab);

    if (style === 'none') return;

    if (style === 'glass') {
      const topRailFront = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, 0.045), railMat);
      topRailFront.position.set(xCenter, slabY + railHeight, spec.zMin + 0.012);
      group.add(topRailFront);
      const topRailLeft = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, depth), railMat);
      topRailLeft.position.set(spec.xMin + 0.012, slabY + railHeight, zCenter);
      group.add(topRailLeft);

      const glassFront = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, railHeight - 0.06, 0.012), glassMat);
      glassFront.position.set(xCenter, slabY + railHeight / 2 + 0.02, spec.zMin + 0.012);
      group.add(glassFront);
      const glassLeft = new THREE.Mesh(new THREE.BoxGeometry(0.012, railHeight - 0.06, depth - 0.04), glassMat);
      glassLeft.position.set(spec.xMin + 0.012, slabY + railHeight / 2 + 0.02, zCenter);
      group.add(glassLeft);

      const postH = railHeight - 0.02;
      [
        [spec.xMin + 0.012, spec.zMin + 0.012],
        [spec.xMax - 0.012, spec.zMin + 0.012],
        [spec.xMin + 0.012, spec.zMax - 0.012]
      ].forEach(([px, pz]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, postH, 0.03), postMat);
        post.position.set(px, slabY + postH / 2, pz);
        group.add(post);
      });
      return;
    }

    // railing
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, 0.045), railMat);
    topRail.position.set(xCenter, slabY + railHeight, spec.zMin + 0.012);
    group.add(topRail);
    const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.03, 0.04), railMat);
    bottomRail.position.set(xCenter, slabY + railBottomY, spec.zMin + 0.012);
    group.add(bottomRail);
    addRailBalustersLine(spec.xMin + 0.03, spec.zMin + 0.012, spec.xMax - 0.03, spec.zMin + 0.012, slabY);

    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, depth), railMat);
    leftRail.position.set(spec.xMin + 0.012, slabY + railHeight, zCenter);
    group.add(leftRail);
    const leftBottomRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, depth), railMat);
    leftBottomRail.position.set(spec.xMin + 0.012, slabY + railBottomY, zCenter);
    group.add(leftBottomRail);
    addRailBalustersLine(spec.xMin + 0.012, spec.zMin + 0.03, spec.xMin + 0.012, spec.zMax - 0.03, slabY);

    const postH = railHeight - 0.02;
    [
      [spec.xMin + 0.012, spec.zMin + 0.012],
      [spec.xMax - 0.012, spec.zMin + 0.012],
      [spec.xMin + 0.012, spec.zMax - 0.012]
    ].forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, postH, 0.03), postMat);
      post.position.set(px, slabY + postH / 2, pz);
      group.add(post);
    });
  });
}

function addBalconyDoors(group, cfg, preset, terraceSpecs = []) {
  const params = resolveWindowParams(cfg);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
  const muntinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: params.glassTint,
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity: params.glassOpacity,
    transmission: params.useTransmission ? 0.85 : 0,
    thickness: 0.02,
    depthWrite: false,
    ior: 1.5
  });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xd4c4a8, roughness: 0.6, metalness: 0.02 });

  const frameH = Math.min(2.38, cfg.floorHeight - 0.18);
  (terraceSpecs || []).forEach(spec => {
    const level = spec.floor;
    const y = (level - 1) * cfg.floorHeight + frameH / 2 + 0.08;
    const corner = spec.corner || 'tl';
    const doorOnRightSide = corner === 'tl' || corner === 'bl';
    const doorX = doorOnRightSide ? spec.xMax - 0.11 : spec.xMin + 0.11;
    const doorZ = (spec.zMin + spec.zMax) / 2;
    const doorSpan = Math.min(1.34, Math.max(1, spec.zMax - spec.zMin - 0.16));
    const sign = doorOnRightSide ? 1 : -1;
    const ft = params.frameThick;
    const fd = params.frameDepth;
    const frameX = doorX + sign * 0.012;

    // 边框
    const top = new THREE.Mesh(new THREE.BoxGeometry(fd, ft, doorSpan + ft * 2), frameMat);
    top.position.set(frameX, y + frameH / 2 + ft / 2, doorZ); top.castShadow = true; group.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(fd, ft, doorSpan + ft * 2), frameMat);
    bottom.position.set(frameX, y - frameH / 2 - ft / 2, doorZ); bottom.castShadow = true; group.add(bottom);
    const left = new THREE.Mesh(new THREE.BoxGeometry(fd, frameH, ft), frameMat);
    left.position.set(frameX, y, doorZ - doorSpan / 2 - ft / 2); left.castShadow = true; group.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(fd, frameH, ft), frameMat);
    right.position.set(frameX, y, doorZ + doorSpan / 2 + ft / 2); right.castShadow = true; group.add(right);

    // 玻璃
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.004, Math.max(0.05, frameH - ft * 0.5), Math.max(0.05, doorSpan - ft * 0.5)), glassMat);
    glass.position.set(frameX + sign * 0.008, y, doorZ); group.add(glass);

    // 竖条
    if (params.cols > 0) {
      const vBarD = Math.max(0.012, doorSpan * 0.022);
      for (let i = 1; i <= params.cols; i++) {
        const offsetZ = -doorSpan / 2 + doorSpan * i / (params.cols + 1);
        const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.01, Math.max(0.1, frameH - ft), vBarD), muntinMat);
        vBar.position.set(frameX + sign * 0.015, y, doorZ + offsetZ); group.add(vBar);
      }
    }
    // 横条
    if (params.hasHBar) {
      const hBarH = Math.max(0.012, frameH * 0.022);
      const hBarY = y - frameH / 2 + frameH * params.hBarRatio;
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.01, hBarH, Math.max(0.1, doorSpan - ft)), muntinMat);
      hBar.position.set(frameX + sign * 0.016, hBarY, doorZ); group.add(hBar);
    }
    // 开启扇
    if (params.hasOpenLeaf) {
      const cellD = doorSpan / (params.cols + 1 || 1);
      const cellH = params.hasHBar ? frameH * Math.max(0.25, params.hBarRatio) : frameH * 0.5;
      const colIndex = params.openLeafPos === 'tr' ? params.cols : 1;
      const offsetZ = -doorSpan / 2 + cellD * (colIndex - 0.5);
      const offsetY = params.hasHBar ? y - frameH / 2 + frameH * params.hBarRatio + cellH / 2 : y + frameH * 0.25;
      const openLeafD = Math.max(0.06, cellD - 0.04);
      const openLeafH = Math.max(0.06, cellH - 0.04);
      const openGroup = new THREE.Group();
      openGroup.position.set(frameX + sign * 0.018, offsetY, doorZ + offsetZ);
      const openLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.004, openLeafH, openLeafD), leafMat);
      openLeaf.position.set(0, 0, openLeafD / 2);
      openGroup.add(openLeaf);
      openGroup.rotation.y = params.openLeafPos === 'tr' ? -sign * 0.45 : sign * 0.45;
      group.add(openGroup);
    }
    // 窗台/门槛
    const sill = new THREE.Mesh(new THREE.BoxGeometry(params.sillDepth, ft * 0.75, doorSpan + ft * 2 + 0.02), frameMat);
    sill.position.set(frameX + sign * (params.sillDepth / 2 - fd / 2), y - frameH / 2 - ft / 2, doorZ);
    sill.castShadow = true; group.add(sill);
  });
}

function addRoof(group, cfg, preset, bodyHeight, topTerraceSpec = null) {
  const roofY = bodyHeight + 0.02;
  const roofMat = new THREE.MeshStandardMaterial({ color: preset.roof, roughness: 0.9, metalness: 0.05 });
  const pitchedMat = new THREE.MeshStandardMaterial({
    color: preset.roof,
    roughness: 0.9,
    metalness: 0.05,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });

  if (cfg.roofType === 'flat_parapet') {
    addFlatParapetRoof(group, cfg, roofY, roofMat, topTerraceSpec);
    return;
  }

  if (cfg.roofType === 'flat_eave') {
    addFlatEaveRoof(group, cfg, roofY, roofMat, topTerraceSpec);
    return;
  }

  if (cfg.roofType === 'flat') {
    addFlatBasicRoof(group, cfg, roofY, roofMat, topTerraceSpec);
    return;
  }

  if (cfg.roofType === 'gable') {
    const rise = Math.max(0.8, Math.min(1.7, cfg.floorHeight * 0.5));
    const gable = new THREE.Mesh(createGableRoofGeometry(cfg.length, cfg.width, rise, 0.22), pitchedMat);
    gable.position.y = roofY;
    gable.castShadow = true;
    gable.receiveShadow = false;
    group.add(gable);
    return;
  }

  const rise = Math.max(0.7, Math.min(1.4, cfg.floorHeight * 0.42));
  const hip = new THREE.Mesh(createHipRoofGeometry(cfg.length, cfg.width, rise, 0.22), pitchedMat);
  hip.position.y = roofY;
  hip.castShadow = true;
  hip.receiveShadow = false;
  group.add(hip);
}

function addRoofPlateWithOptionalNotch(group, cfg, totalL, totalW, thickness, y, material, topTerraceSpec = null) {
  if (!topTerraceSpec) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(totalL, thickness, totalW), material);
    slab.position.y = y;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    return;
  }

  const corner = topTerraceSpec.corner || 'tl';
  const extL = (totalL - cfg.length) / 2;
  const extW = (totalW - cfg.width) / 2;
  const minX = -cfg.length / 2 - extL;
  const maxX = cfg.length / 2 + extL;
  const minZ = -cfg.width / 2 - extW;
  const maxZ = cfg.width / 2 + extW;

  if (corner === 'tl') {
    const cutX = clamp(topTerraceSpec.x2, 0.3, cfg.length - 0.3);
    const cutY = clamp(topTerraceSpec.y2, 0.3, cfg.width - 0.3);
    const cutXWorld = -cfg.length / 2 + cutX;
    const cutZWorld = -cfg.width / 2 + cutY;
    const rightW = maxX - cutXWorld;
    if (rightW > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(rightW, thickness, totalW), material);
      strip.position.set(cutXWorld + rightW / 2, y, 0);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
    const bottomW = cutXWorld - minX;
    const bottomD = maxZ - cutZWorld;
    if (bottomW > 0.08 && bottomD > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(bottomW, thickness, bottomD), material);
      strip.position.set(minX + bottomW / 2, y, cutZWorld + bottomD / 2);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
  } else if (corner === 'tr') {
    const cutX = clamp(topTerraceSpec.x1, 0.3, cfg.length - 0.3);
    const cutY = clamp(topTerraceSpec.y2, 0.3, cfg.width - 0.3);
    const cutXWorld = -cfg.length / 2 + cutX;
    const cutZWorld = -cfg.width / 2 + cutY;
    const leftW = cutXWorld - minX;
    if (leftW > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(leftW, thickness, totalW), material);
      strip.position.set(minX + leftW / 2, y, 0);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
    const bottomW = maxX - cutXWorld;
    const bottomD = maxZ - cutZWorld;
    if (bottomW > 0.08 && bottomD > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(bottomW, thickness, bottomD), material);
      strip.position.set(cutXWorld + bottomW / 2, y, cutZWorld + bottomD / 2);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
  } else if (corner === 'bl') {
    const cutX = clamp(topTerraceSpec.x2, 0.3, cfg.length - 0.3);
    const cutY = clamp(topTerraceSpec.y1, 0.3, cfg.width - 0.3);
    const cutXWorld = -cfg.length / 2 + cutX;
    const cutZWorld = -cfg.width / 2 + cutY;
    const rightW = maxX - cutXWorld;
    if (rightW > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(rightW, thickness, totalW), material);
      strip.position.set(cutXWorld + rightW / 2, y, 0);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
    const topW = cutXWorld - minX;
    const topD = cutZWorld - minZ;
    if (topW > 0.08 && topD > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(topW, thickness, topD), material);
      strip.position.set(minX + topW / 2, y, minZ + topD / 2);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
  } else if (corner === 'br') {
    const cutX = clamp(topTerraceSpec.x1, 0.3, cfg.length - 0.3);
    const cutY = clamp(topTerraceSpec.y1, 0.3, cfg.width - 0.3);
    const cutXWorld = -cfg.length / 2 + cutX;
    const cutZWorld = -cfg.width / 2 + cutY;
    const leftW = cutXWorld - minX;
    if (leftW > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(leftW, thickness, totalW), material);
      strip.position.set(minX + leftW / 2, y, 0);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
    const topW = maxX - cutXWorld;
    const topD = cutZWorld - minZ;
    if (topW > 0.08 && topD > 0.08) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(topW, thickness, topD), material);
      strip.position.set(cutXWorld + topW / 2, y, minZ + topD / 2);
      strip.castShadow = true; strip.receiveShadow = true; group.add(strip);
    }
  }
}

function addFlatBasicRoof(group, cfg, roofY, roofMat, topTerraceSpec = null) {
  addRoofPlateWithOptionalNotch(group, cfg, cfg.length + 0.3, cfg.width + 0.3, 0.22, roofY + 0.11, roofMat, topTerraceSpec);
}

function addFlatParapetRoof(group, cfg, roofY, roofMat, topTerraceSpec = null) {
  addRoofPlateWithOptionalNotch(
    group,
    cfg,
    cfg.length + 0.26,
    cfg.width + 0.26,
    0.16,
    roofY + 0.08,
    new THREE.MeshStandardMaterial({ color: 0xe6e8eb, roughness: 0.95, metalness: 0.01 }),
    topTerraceSpec
  );

  const parapetHeight = 0.72;
  const parapetThick = 0.18;
  const brownMat = new THREE.MeshStandardMaterial({ color: 0x7b5341, roughness: 0.88, metalness: 0.02 });
  const longLen = cfg.length + 0.34;
  const shortLen = cfg.width + 0.34;
  const y = roofY + parapetHeight / 2;
  const z = cfg.width / 2 + parapetThick / 2 + 0.08;
  const x = cfg.length / 2 + parapetThick / 2 + 0.08;

  const north = new THREE.Mesh(new THREE.BoxGeometry(longLen, parapetHeight, parapetThick), brownMat);
  north.position.set(0, y, z);
  group.add(north);
  const south = new THREE.Mesh(new THREE.BoxGeometry(longLen, parapetHeight, parapetThick), brownMat);
  south.position.set(0, y, -z);
  group.add(south);
  const east = new THREE.Mesh(new THREE.BoxGeometry(parapetThick, parapetHeight, shortLen), brownMat);
  east.position.set(x, y, 0);
  group.add(east);
  const west = new THREE.Mesh(new THREE.BoxGeometry(parapetThick, parapetHeight, shortLen), brownMat);
  west.position.set(-x, y, 0);
  group.add(west);

  const copingMat = new THREE.MeshStandardMaterial({ color: 0x6d4b3f, roughness: 0.78, metalness: 0.03 });
  const copingH = 0.06;
  const copingT = parapetThick + 0.03;
  const cy = roofY + parapetHeight + copingH / 2;
  const copingNorth = new THREE.Mesh(new THREE.BoxGeometry(longLen + 0.03, copingH, copingT), copingMat);
  copingNorth.position.set(0, cy, z);
  group.add(copingNorth);
  const copingSouth = new THREE.Mesh(new THREE.BoxGeometry(longLen + 0.03, copingH, copingT), copingMat);
  copingSouth.position.set(0, cy, -z);
  group.add(copingSouth);
  const copingEast = new THREE.Mesh(new THREE.BoxGeometry(copingT, copingH, shortLen + 0.03), copingMat);
  copingEast.position.set(x, cy, 0);
  group.add(copingEast);
  const copingWest = new THREE.Mesh(new THREE.BoxGeometry(copingT, copingH, shortLen + 0.03), copingMat);
  copingWest.position.set(-x, cy, 0);
  group.add(copingWest);

  const hatch = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xc8c7c2, roughness: 0.85, metalness: 0.04 })
  );
  hatch.position.set(-cfg.length * 0.18, roofY + 0.2, cfg.width * 0.1);
  group.add(hatch);

  const drainPipeMat = new THREE.MeshStandardMaterial({ color: 0x6e6f73, roughness: 0.65, metalness: 0.15 });
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, cfg.floors * cfg.floorHeight - 0.2, 10),
    drainPipeMat
  );
  pipe.position.set(cfg.length / 2 - 0.08, (cfg.floors * cfg.floorHeight - 0.2) / 2 + 0.05, -cfg.width / 2 + 0.08);
  group.add(pipe);
}

function addFlatEaveRoof(group, cfg, roofY, roofMat, topTerraceSpec = null) {
  addRoofPlateWithOptionalNotch(
    group,
    cfg,
    cfg.length + 0.48,
    cfg.width + 0.48,
    0.2,
    roofY + 0.1,
    new THREE.MeshStandardMaterial({ color: 0xe7e8ea, roughness: 0.95, metalness: 0.01 }),
    topTerraceSpec
  );

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8c6151, roughness: 0.87, metalness: 0.02 });
  const trimH = 0.08;
  const trimT = 0.08;
  const y = roofY + 0.24;
  const z = cfg.width / 2 + 0.24;
  const x = cfg.length / 2 + 0.24;

  const north = new THREE.Mesh(new THREE.BoxGeometry(cfg.length + 0.5, trimH, trimT), trimMat);
  north.position.set(0, y, z);
  group.add(north);
  const south = new THREE.Mesh(new THREE.BoxGeometry(cfg.length + 0.5, trimH, trimT), trimMat);
  south.position.set(0, y, -z);
  group.add(south);
  const east = new THREE.Mesh(new THREE.BoxGeometry(trimT, trimH, cfg.width + 0.5), trimMat);
  east.position.set(x, y, 0);
  group.add(east);
  const west = new THREE.Mesh(new THREE.BoxGeometry(trimT, trimH, cfg.width + 0.5), trimMat);
  west.position.set(-x, y, 0);
  group.add(west);

  addRoofPlateWithOptionalNotch(
    group,
    cfg,
    cfg.length + 0.44,
    cfg.width + 0.44,
    0.05,
    roofY - 0.02,
    new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.9, metalness: 0.02 }),
    topTerraceSpec
  );
}

function createGableRoofGeometry(length, width, rise, overhang = 0.18) {
  const l2 = length / 2 + overhang;
  const w2 = width / 2 + overhang;
  const alongLength = length >= width;

  let vertices;
  let indices;
  if (alongLength) {
    vertices = [
      -l2, 0, -w2, // 0
       l2, 0, -w2, // 1
       l2, 0,  w2, // 2
      -l2, 0,  w2, // 3
      -l2, rise, 0, // 4
       l2, rise, 0  // 5
    ];
    indices = [
      0, 1, 5,
      0, 5, 4,
      3, 4, 5,
      3, 5, 2,
      0, 4, 3,
      1, 2, 5
    ];
  } else {
    vertices = [
      -l2, 0, -w2, // 0
       l2, 0, -w2, // 1
       l2, 0,  w2, // 2
      -l2, 0,  w2, // 3
       0, rise, -w2, // 4
       0, rise,  w2  // 5
    ];
    indices = [
      0, 1, 4,
      1, 2, 5,
      1, 5, 4,
      0, 4, 5,
      0, 5, 3,
      3, 5, 2
    ];
  }

  return createIndexedRoofGeometry(vertices, indices);
}

function createHipRoofGeometry(length, width, rise, overhang = 0.18) {
  const l2 = length / 2 + overhang;
  const w2 = width / 2 + overhang;
  const alongLength = length >= width;
  const ridgeHalf = alongLength
    ? Math.max(0.6, Math.min(l2 * 0.48, l2 - Math.max(0.5, w2 * 0.55)))
    : Math.max(0.6, Math.min(w2 * 0.48, w2 - Math.max(0.5, l2 * 0.55)));

  let vertices;
  let indices;
  if (alongLength) {
    vertices = [
      -l2, 0, -w2, // 0
       l2, 0, -w2, // 1
       l2, 0,  w2, // 2
      -l2, 0,  w2, // 3
      -ridgeHalf, rise, 0, // 4
       ridgeHalf, rise, 0  // 5
    ];
    indices = [
      0, 1, 5,
      0, 5, 4,
      3, 4, 5,
      3, 5, 2,
      0, 4, 3,
      1, 2, 5
    ];
  } else {
    vertices = [
      -l2, 0, -w2, // 0
       l2, 0, -w2, // 1
       l2, 0,  w2, // 2
      -l2, 0,  w2, // 3
       0, rise, -ridgeHalf, // 4
       0, rise,  ridgeHalf  // 5
    ];
    indices = [
      0, 1, 4,
      1, 2, 5,
      1, 5, 4,
      0, 4, 5,
      0, 5, 3,
      3, 5, 2
    ];
  }

  return createIndexedRoofGeometry(vertices, indices);
}

function createIndexedRoofGeometry(vertices, indices) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function randomizeInputs(showToast = true) {
  const randomChoice = arr => arr[Math.floor(Math.random() * arr.length)];
  els.length.value = randomBetween(9, 16, 0.5);
  els.width.value = randomBetween(8, 12, 0.5);
  els.floors.value = String(randomChoice([1, 2, 2, 3]));
  els.floorHeight.value = randomBetween(3, 3.6, 0.1);
  els.roofType.value = randomChoice(['flat_parapet', 'flat_eave', 'flat', 'gable', 'hip']);
  syncRoofChipState(els.roofType.value);
  els.styleType.value = randomChoice(['simple', 'modern', 'chinese']);
  els.windowDensity.value = randomChoice(['low', 'medium', 'high']);
  if (els.windowStyle) els.windowStyle.value = Math.random() < 0.7 ? 'random' : randomChoice(['grid', 'modern', 'simple']);
  if (els.balconyStyle) els.balconyStyle.value = Math.random() < 0.7 ? 'random' : randomChoice(['railing', 'glass', 'none']);

  setInput('f1_living', 1);
  setInput('f1_dining', 1);
  setInput('f1_bedroom', randomChoice([1, 2, 2, 3, 4]));
  setInput('f1_kitchen', 1);
  setInput('f1_bathroom', 1);

  setInput('f2_living', 1);
  setInput('f2_bedroom', randomChoice([2, 3, 3, 4]));
  setInput('f2_bathroom', randomChoice([1, 1, 2]));

  setInput('f3_living', 1);
  setInput('f3_bedroom', randomChoice([1, 2, 2, 3]));
  setInput('f3_bathroom', getCount('f2_bathroom'));
  syncUpperFloorBathroomInputs(2);

  updateFloorCards();
  if (showToast) {
    renderMessages([{ type: 'info', text: '已随机生成一组住宅参数，可继续微调后再生成。' }]);
  }
}

function exportJson() {
  if (!generatedState) return;
  const payload = {
    version: generatedState.exportVersion,
    generated_at: new Date().toISOString(),
    config: generatedState.config,
    floor_area: generatedState.floorArea,
    total_gross_area: generatedState.totalGrossArea,
    total_used_area: generatedState.totalUsedArea,
    floor_plans: generatedState.floorPlans,
    model_metrics: generatedState.modelMetrics
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rural_house_scheme.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCurrentModelAsGlb() {
  if (!currentModel) {
    return Promise.reject(new Error('No 3D model to export. Please generate one first.'));
  }

  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      currentModel,
      result => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('Export failed: GLB binary was not produced.'));
      },
      error => {
        reject(error instanceof Error ? error : new Error(String(error || 'Export failed.')));
      },
      {
        binary: true,
        onlyVisible: true,
        trs: false,
        maxTextureSize: 2048
      }
    );
  });
}

async function applyModelToMainPlatform() {
  if (!window.opener) {
    setBridgeNotice('Main platform window not found. Open this page from the 3D panel button.', 'error');
    return;
  }

  if (!generatedState || !currentModel) {
    setBridgeNotice('Please generate a model before applying.', 'error');
    return;
  }

  if (hasPendingChanges) {
    setBridgeNotice('参数有改动未生成，请先点击“生成建筑”再应用到主平台。', 'error');
    return;
  }

  const btn = els.btnApplyToMain;
  if (btn) btn.disabled = true;
  setBridgeNotice('Exporting GLB and sending to main platform...', 'info');

  try {
    const glbBuffer = await exportCurrentModelAsGlb();
    const payload = {
      sourceCode: transferTarget.sourceCode,
      sourceName: transferTarget.sourceName,
      spaceId: transferTarget.spaceId,
      modelScale: DEFAULT_TRANSFER_MODEL_SCALE,
      modelHeading: 0,
      modelHeightOffset: 0,
      modelOffsetX: 0,
      modelOffsetY: 0,
      modelStretchX: 1,
      modelStretchY: 1,
      modelSnapToBase: 0,
      modelMetrics: generatedState.modelMetrics || null,
      generatedAt: new Date().toISOString(),
      glbBuffer
    };

    window.opener.postMessage(
      {
        type: HOUSE_GENERATOR_MESSAGE_TYPE,
        payload
      },
      '*',
      [glbBuffer]
    );

    setBridgeNotice('Model sent. Returning to main platform...', 'success');
    try {
      window.opener?.focus?.();
    } catch (_) {}
    setTimeout(() => {
      try {
        window.close();
      } catch (_) {}
    }, 120);
  } catch (error) {
    console.error('Failed to send model to main platform:', error);
    setBridgeNotice(`Send failed: ${error?.message || error}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function randomBetween(min, max, step = 1) {
  const n = Math.round((Math.random() * (max - min) + min) / step) * step;
  return n.toFixed(step < 1 ? String(step).split('.')[1].length : 0);
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

function disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
      else obj.material.dispose?.();
    }
  });
}

