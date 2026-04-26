import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlanModel } from './src/core/createPlanModel.js';
import { validatePlan } from './src/validate/validatePlan.js';
import { scorePlan } from './src/core/scorePlan.js';
import { DEFAULT_FARMHOUSE_RULES } from './src/config/defaultFarmhouseRules.js';
import { mapRuleConfigToRuntime, buildRuleMappingTable } from './src/config/ruleConfigMapper.js';

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
    minWidth: 1.8, minDepth: 2.2, maxAspectRatio: 3,
    color: '#d2f4de', floor: 0
  },
  storage: {
    label: '储藏间', minArea: 3, maxArea: 8,
    minWidth: 1.8, minDepth: 2.0, maxAspectRatio: 3,
    color: '#f0e4ff', floor: 1
  },
  hot_water_room: {
    label: '热水器房', minArea: 2.5, maxArea: 6,
    minWidth: 1.4, minDepth: 1.8, maxAspectRatio: 3,
    color: '#f3e6d6', floor: 3
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

const HARD_AR_ROOM_TYPES = new Set(['storage', 'bedroom', 'bathroom', 'hot_water_room']);

const RULE_PROFILE = mapRuleConfigToRuntime(DEFAULT_FARMHOUSE_RULES);
Object.keys(RULE_PROFILE.roomRules).forEach(type => {
  const mapped = RULE_PROFILE.roomRules[type];
  if (!ROOM_RULES[type]) {
    ROOM_RULES[type] = {
      label: mapped.label || type,
      minArea: mapped.minArea,
      maxArea: mapped.maxArea,
      minWidth: mapped.minWidth,
      minDepth: mapped.minDepth,
      maxAspectRatio: mapped.maxAspectRatio,
      color: '#dfe7f3',
      floor: 0
    };
    return;
  }
  ROOM_RULES[type].label = mapped.label || ROOM_RULES[type].label;
  ROOM_RULES[type].minArea = mapped.minArea ?? ROOM_RULES[type].minArea;
  ROOM_RULES[type].maxArea = mapped.maxArea ?? ROOM_RULES[type].maxArea;
  ROOM_RULES[type].minWidth = mapped.minWidth ?? ROOM_RULES[type].minWidth;
  ROOM_RULES[type].minDepth = mapped.minDepth ?? ROOM_RULES[type].minDepth;
  ROOM_RULES[type].maxAspectRatio = mapped.maxAspectRatio ?? ROOM_RULES[type].maxAspectRatio;
});

console.log('[RuleProfile] mapping', buildRuleMappingTable(RULE_PROFILE));

// ========== 面积标准速查表（规则清单第五章，用于随机生成） ==========
const AREA_STANDARDS = {
  living_room:  { low: 18, comfort: [22, 25], high: [30, 35], span: [3.9, 4.5], depth: [4.5, 6.0] },
  bedroom:      { low: 9,  comfort: [10, 12], high: [13, 15], span: [3.0, 3.3], depth: [3.6, 4.2] },
  kitchen:      { low: 6,  comfort: [8, 10],  high: [10, 15], span: [2.1, 3.0], depth: [2.8, 4.2] },
  dining:       { low: 6,  comfort: [8, 12],  high: [12, 16], span: [2.4, 3.6], depth: [2.5, 4.2] },
  bathroom:     { low: 4,  comfort: [4, 5],   high: [5, 6],   span: [1.8, 2.2], depth: [2.2, 2.8] },
  study:        { low: 6,  comfort: [8, 10],  high: [10, 12], span: [2.4, 3.0], depth: [2.5, 3.6] },
  storage:      { low: 3,  comfort: [4, 5],   high: [5, 6],   span: [1.8, 2.4], depth: [2.0, 2.8] },
  hot_water_room:{ low: 2.5, comfort: [3, 4], high: [4, 5],   span: [1.4, 1.8], depth: [1.8, 2.6] },
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
setTimeout(() => generateAndRender(), 0);

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
    syncProgramInputs();
    markPendingChanges();
  });

  const f1Bedroom = document.getElementById('f1_bedroom');
  const f2Bedroom = document.getElementById('f2_bedroom');
  const f3Bedroom = document.getElementById('f3_bedroom');
  const f2Bathroom = document.getElementById('f2_bathroom');
  const f3Bathroom = document.getElementById('f3_bathroom');
  f1Bedroom?.addEventListener('change', () => {
    syncProgramInputs();
    markPendingChanges();
  });
  f2Bedroom?.addEventListener('change', () => {
    syncProgramInputs();
    markPendingChanges();
  });
  f3Bedroom?.addEventListener('change', () => {
    syncProgramInputs();
    markPendingChanges();
  });
  f2Bathroom?.addEventListener('change', () => {
    syncProgramInputs();
    markPendingChanges();
  });
  f3Bathroom?.addEventListener('change', () => {
    syncProgramInputs();
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
  syncProgramInputs();
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

function syncProgramInputs() {
  const f1Bedroom = document.getElementById('f1_bedroom');
  const f1Bathroom = document.getElementById('f1_bathroom');
  const f2Bedroom = document.getElementById('f2_bedroom');
  const f2Bathroom = document.getElementById('f2_bathroom');
  const f3Bedroom = document.getElementById('f3_bedroom');
  const f3Bathroom = document.getElementById('f3_bathroom');
  const floors = Number(els.floors?.value || 1);

  if (f1Bedroom) {
    const b1 = clamp(Number(f1Bedroom.value) || 2, 2, 3);
    f1Bedroom.value = String(b1);
    if (f1Bathroom) {
      const bath1 = b1 === 2 ? 2 : 1;
      f1Bathroom.min = '1';
      f1Bathroom.max = '2';
      f1Bathroom.value = String(bath1);
    }
  }

  if (f2Bedroom) {
    const b2 = clamp(Number(f2Bedroom.value) || 2, 2, 4);
    f2Bedroom.value = String(b2);
    if (f2Bathroom) {
      if (b2 >= 4) {
        f2Bathroom.min = '1';
        f2Bathroom.max = '1';
        f2Bathroom.value = '1';
      } else {
        f2Bathroom.min = '1';
        f2Bathroom.max = '2';
        f2Bathroom.value = String(clamp(Number(f2Bathroom.value) || 1, 1, 2));
      }
      f2Bathroom.disabled = floors < 2;
    }
  }

  if (f3Bedroom) {
    const b3 = clamp(Number(f3Bedroom.value) || 2, 2, 4);
    f3Bedroom.value = String(b3);
    if (f3Bathroom) {
      if (b3 >= 4) {
        f3Bathroom.min = '1';
        f3Bathroom.max = '1';
        f3Bathroom.value = '1';
      } else {
        f3Bathroom.min = '1';
        f3Bathroom.max = '2';
        f3Bathroom.value = String(clamp(Number(f3Bathroom.value) || 1, 1, 2));
      }
      f3Bathroom.disabled = floors < 3;
    }
  }
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
  syncProgramInputs();
  const snapHalf = (v) => Math.round(v * 2) / 2;
  let length = snapHalf(clamp(Number(els.length.value), 5, 15));
  let width = snapHalf(clamp(Number(els.width.value), 5, 15));
  let area = length * width;
  if (area < 40) {
    width = snapHalf(clamp(40 / Math.max(5, length), 5, 15));
    area = length * width;
    if (area < 40) {
      length = snapHalf(clamp(40 / Math.max(5, width), 5, 15));
    }
  } else if (area > 150) {
    width = snapHalf(clamp(150 / Math.max(5, length), 5, 15));
    area = length * width;
    if (area > 150) {
      length = snapHalf(clamp(150 / Math.max(5, width), 5, 15));
    }
  }
  els.length.value = String(length);
  els.width.value = String(width);

  const f1Bedroom = clamp(getCount('f1_bedroom'), 2, 3);
  const f1Bathroom = f1Bedroom === 2 ? 2 : 1;
  const f2Bedroom = clamp(getCount('f2_bedroom'), 2, 4);
  const f2Bathroom = f2Bedroom >= 4 ? 1 : clamp(getCount('f2_bathroom'), 1, 2);
  const f3Bedroom = clamp(getCount('f3_bedroom'), 2, 4);
  const f3Bathroom = f3Bedroom >= 4 ? 1 : clamp(getCount('f3_bathroom'), 1, 2);
  const hasSecondFloorTerrace = floors >= 2 ? 1 : 0;
  const hasThirdFloorTerrace = floors >= 3 ? 1 : 0;

  return {
    length,
    width,
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
        bathroom: f1Bathroom,
        bedroom: f1Bedroom,
        stairs: floors >= 2 ? 1 : 0
      },
      2: {
        living_room: floors >= 2 ? 1 : 0,
        bedroom: floors >= 2 ? f2Bedroom : 0,
        bathroom: floors >= 2 ? f2Bathroom : 0,
        terrace: hasSecondFloorTerrace,
        storage: floors >= 2 ? 1 : 0,
        stairs: floors >= 2 ? 1 : 0
      },
      3: {
        living_room: floors >= 3 ? 1 : 0,
        bedroom: floors >= 3 ? f3Bedroom : 0,
        bathroom: floors >= 3 ? f3Bathroom : 0,
        terrace: hasThirdFloorTerrace,
        hot_water_room: floors >= 3 ? 1 : 0,
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
    const result = generateBuildingWithHardRetry(config, 24);
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

function clonePlain(obj) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch (_) {}
  return JSON.parse(JSON.stringify(obj));
}

function generateBuildingWithHardRetry(config, maxAttempts = 6) {
  let best = null;
  let bestPenalty = Infinity;

  for (let i = 0; i < Math.max(1, maxAttempts); i++) {
    const attemptCfg = clonePlain(config);
    const candidate = generateBuilding(attemptCfg);
    const violations = candidate?.violations || [];
    const r11Count = violations.filter(v => v.rule === 'R11').length;
    const hardArCount = violations.filter(v =>
      v.rule === 'R11' &&
      v.code === 'AR_MAX' &&
      HARD_AR_ROOM_TYPES.has(String(v.roomType || ''))
    ).length;
    const r4Count = violations.filter(v => v.rule === 'R4').length;
    const hardCount = violations.length;
    const penalty = hardArCount * 5000 + r11Count * 120 + r4Count * 20 + hardCount;

    if (penalty < bestPenalty) {
      best = candidate;
      bestPenalty = penalty;
    }
    // 以 R11 为第一硬门槛：无比例/净宽净深违规时提前收敛
    if (r11Count === 0) return candidate;
  }

  // 若当前参数在最大重试次数内仍无法达到 R11=0：
  // 不中断生成流程（避免 2D/3D 全空白），返回最优候选并给出显式告警。
  if (best) {
    const r11Violations = (best.violations || []).filter(v => v.rule === 'R11');
    if (r11Violations.length > 0) {
      const sample = r11Violations
        .slice(0, 3)
        .map(v => `第${v.floor || '-'}层${v.room ? v.room : ''}${v.message ? `(${v.message})` : ''}`)
        .join('；');
      best.messages = best.messages || [];
      best.messages.unshift({
        type: 'warn',
        text: `R11 严格约束未完全满足，已返回最优候选方案。建议增大建筑长宽或减少房间数量。${sample ? ` 示例：${sample}` : ''}`
      });
      best.strictR11Failed = true;
    }
  }

  return best || generateBuilding(config);
}

// ========== 硬约束验证层（规则清单 R1~R13）==========

function validateHardConstraints(floorPlans, config) {
  const violations = [];
  const addV = (rule, floor, room, text, extra = null) => {
    violations.push({
      rule,
      floor,
      room: room?.label || '',
      roomType: room?.type || '',
      message: text,
      severity: 'hard',
      ...(extra || {})
    });
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
  const f1baths = floorPlans.find(p => p.floor === 1)?.rooms.filter(r => r.type === 'bathroom') || [];
  if (f1baths.length) {
    floorPlans.forEach(p => {
      if (p.floor <= 1) return;
      p.rooms.filter(r => r.type === 'bathroom').forEach(b => {
        const inside = f1baths.some(f1bath => (
          b.x >= f1bath.x - 0.01 && b.y >= f1bath.y - 0.01 &&
          b.x + b.w <= f1bath.x + f1bath.w + 0.01 &&
          b.y + b.h <= f1bath.y + f1bath.h + 0.01
        ));
        if (!inside) {
          addV('R2', p.floor, b, '上层卫生间投影未完全落入一层任一卫生间内');
        }
      });
    });
  }

  // --- R4: 面积100%功能化 ---
  const totalArea = config.length * config.width;
  floorPlans.forEach(p => {
    const used = p.rooms.reduce((sum, r) => sum + r.area, 0);
    const gap = totalArea - used;
    const maxBlank = RULE_PROFILE.geometry.maxBlankArea;
    if (gap > maxBlank) {
      addV('R4', p.floor, null, `未标注空白区域约 ${round2(gap)}㎡，超过允许阈值 ${maxBlank}㎡`);
    }
  });

  // --- R5: 墙体厚度扣除（面积基准检查） ---
  floorPlans.forEach(p => {
    const netMax = totalArea * RULE_PROFILE.geometry.fillRateTarget;
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

  // --- R7a: 餐厨邻接（优先同层，至少一组厨房-餐厅直接相邻） ---
  floorPlans.forEach(p => {
    const kitchens = p.rooms.filter(r => r.type === 'kitchen');
    const dinings = p.rooms.filter(r => r.type === 'dining');
    if (!kitchens.length || !dinings.length) return;
    let hasAdjacentPair = false;
    kitchens.forEach(k => {
      const n = getRoomNeighbors(k, p.rooms);
      if (n.some(x => x.type === 'dining')) hasAdjacentPair = true;
    });
    if (!hasAdjacentPair) {
      addV('R7a', p.floor, null, '厨房与餐厅未直接邻接，不满足餐厨协同动线');
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
    const f1Beds = f1.rooms.filter(r => r.type === 'bedroom');
    const f1Baths = f1.rooms.filter(r => r.type === 'bathroom');
    if (f1Beds.length < 2 || f1Beds.length > 3) {
      addV('R8', 1, null, `一层卧室数量应为2或3间，当前为${f1Beds.length}间`);
    }
    const expectedBath1 = f1Beds.length === 2 ? 2 : 1;
    if (f1Baths.length !== expectedBath1) {
      addV('R8', 1, null, `一层卧室${f1Beds.length}间时，卫生间应为${expectedBath1}间，当前为${f1Baths.length}间`);
    }
    f1Beds.forEach(r => {
      if (r.area < 9 - 0.5) addV('R8', 1, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 9㎡`);
    });
    f1Baths.forEach(r => {
      if (r.area < 4 - 0.5) addV('R8', 1, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 4㎡`);
    });
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

    const bathCount = count('bathroom');
    if (beds.length >= 4 && bathCount !== 1) {
      addV('R9', p.floor, null, `第${p.floor}层卧室为4间时，卫生间必须为1间（当前${bathCount}间）`);
    }
    if (beds.length >= 2 && beds.length <= 3 && (bathCount < 1 || bathCount > 2)) {
      addV('R9', p.floor, null, `第${p.floor}层卧室为2-3间时，卫生间必须为1或2间（当前${bathCount}间）`);
    }
    if (p.floor === 2) {
      checkMin('storage', 1, 3, '储藏室');
    }
    if (p.floor === 3) {
      checkMin('hot_water_room', 1, 2.5, '热水器房');
    }
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
      if (w < rule.minWidth - 0.05) addV('R11', p.floor, r, `${r.label} 净宽 ${round2(w)}m 低于最小值 ${rule.minWidth}m`, { code: 'MIN_WIDTH' });
      if (d < rule.minDepth - 0.05) addV('R11', p.floor, r, `${r.label} 净深 ${round2(d)}m 低于最小值 ${rule.minDepth}m`, { code: 'MIN_DEPTH' });
      if (r.area < rule.minArea - 0.5) addV('R11', p.floor, r, `${r.label} 面积 ${round2(r.area)}㎡ 低于最小值 ${rule.minArea}㎡`, { code: 'MIN_AREA' });
      const ar = Math.max(r.w / r.h, r.h / r.w);
      if (ar > rule.maxAspectRatio + 0.01) addV('R11', p.floor, r, `${r.label} 长宽比 ${round2(ar)} 超过上限 ${rule.maxAspectRatio}`, { code: 'AR_MAX' });
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

    const reachable = bfsReachable(living, p.rooms, []);
    const noKitchenReachable = bfsReachable(living, p.rooms, ['kitchen']);
    baths.forEach(bath => {
      if (!reachable.has(bath)) {
        addV('R6a', p.floor, bath, '卫生间与客厅不连通，不可达');
        return;
      }
      if (!noKitchenReachable.has(bath)) {
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
  if (config.length < 5 || config.length > 15) {
    msgs.push({ type: 'warn', text: `建筑长度 ${config.length}m 不在允许范围 5~15m 内` });
  }
  if (config.width < 5 || config.width > 15) {
    msgs.push({ type: 'warn', text: `建筑宽度 ${config.width}m 不在允许范围 5~15m 内` });
  }
  const area = round2(config.length * config.width);
  if (area < 40 || area > 150) {
    msgs.push({ type: 'warn', text: `占地面积 ${area}㎡ 不在允许范围 40~150㎡ 内` });
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

  // Stage 1/2 渐进重构：统一 Plan JSON + 结构化验证与评分
  const plan = createPlanModel({
    config: gridConfig,
    floorPlans
  });
  const planBundle = {
    plan,
    floorPlans
  };
  syncUnifiedPlanDoors(planBundle);
  syncUnifiedPlanWindows({
    ...planBundle,
    config: gridConfig
  });
  const planValidation = validatePlan(planBundle.plan);
  const planScore = scorePlan(planBundle.plan, planValidation);
  if (!planValidation.passed) {
    messages.push({
      type: 'warn',
      text: `⚠️ 统一Plan校验失败：${planValidation.hardViolations.length}项硬约束未通过。`
    });
  }
  if (planValidation.softPenalties.length > 0) {
    messages.push({
      type: 'info',
      text: `统一Plan评分：${round2(planScore)}（软惩罚 ${planValidation.softPenalties.length} 项）`
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
    plan: planBundle.plan,
    planValidation,
    planScore,
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

  const rawRooms = layoutRooms(floor, targetAreas, config.length, config.width, 1, config);
  const filledRooms = fillResidualSpaces(rawRooms, config.length, config.width, floor);
  let normalizedRooms = normalizeCirculationRooms(filledRooms, floor);
  normalizedRooms = enforceProgramRoomCaps(normalizedRooms, floor, config);
  normalizedRooms = renumberRoomIndices(normalizedRooms);
  const rooms = applySingleLivingLabelPolicy(normalizedRooms);

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
      config._stairGeom = stairRoom._stairGeom || null;
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

function fillResidualSpaces(rooms, length, width, floor) {
  if (!Array.isArray(rooms) || rooms.length === 0) return rooms || [];
  const minFillArea = 0.35; // 降低阈值，避免可见空白残留
  const smallResidualLimit = 3.5;
  const eps = 0.02;
  const mergeTol = 0.06;

  const xCuts = Array.from(new Set([0, length, ...rooms.flatMap(r => [r.x, r.x + r.w])]))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);
  const yCuts = Array.from(new Set([0, width, ...rooms.flatMap(r => [r.y, r.y + r.h])]))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (xCuts.length < 2 || yCuts.length < 2) return rooms;

  const nx = xCuts.length - 1;
  const ny = yCuts.length - 1;
  const uncovered = Array.from({ length: ny }, () => Array(nx).fill(false));

  const isCoveredByAnyRoom = (cx, cy) => {
    return rooms.some(r => cx > r.x + eps && cx < r.x + r.w - eps && cy > r.y + eps && cy < r.y + r.h - eps);
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = xCuts[i], x1 = xCuts[i + 1];
      const y0 = yCuts[j], y1 = yCuts[j + 1];
      const cw = x1 - x0, ch = y1 - y0;
      if (cw <= eps || ch <= eps) continue;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      uncovered[j][i] = !isCoveredByAnyRoom(cx, cy);
    }
  }

  const added = [];
  const tryAbsorbResidual = (rx0, ry0, rw, rh) => {
    if (rw <= 0 || rh <= 0) return false;
    const canUse = (room) => room && !['stairs', 'terrace', 'bathroom'].includes(room.type);
    const same = (a, b) => Math.abs(a - b) <= mergeTol;
    const overlapLen = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    const candidates = [];

    rooms.forEach((r, idx) => {
      if (!canUse(r)) return;
      const rx1 = rx0 + rw;
      const ry1 = ry0 + rh;
      const rX1 = r.x + r.w;
      const rY1 = r.y + r.h;

      if (same(rX1, rx0)) {
        const ov = overlapLen(r.y, rY1, ry0, ry1);
        if (ov > 0.25) candidates.push({ idx, side: 'left', score: ov });
      }
      if (same(r.x, rx1)) {
        const ov = overlapLen(r.y, rY1, ry0, ry1);
        if (ov > 0.25) candidates.push({ idx, side: 'right', score: ov });
      }
      if (same(rY1, ry0)) {
        const ov = overlapLen(r.x, rX1, rx0, rx1);
        if (ov > 0.25) candidates.push({ idx, side: 'bottom', score: ov });
      }
      if (same(r.y, ry1)) {
        const ov = overlapLen(r.x, rX1, rx0, rx1);
        if (ov > 0.25) candidates.push({ idx, side: 'top', score: ov });
      }
    });

    if (!candidates.length) return false;
    candidates.sort((a, b) => b.score - a.score);
    const hit = candidates[0];
    const room = rooms[hit.idx];
    if (!room) return false;

    if (hit.side === 'left' && same(room.y, ry0) && same(room.h, rh)) {
      room.w = round2(room.w + rw);
      room.area = round2(room.w * room.h);
      return true;
    }
    if (hit.side === 'right' && same(room.y, ry0) && same(room.h, rh)) {
      room.x = round2(rx0);
      room.w = round2(room.w + rw);
      room.area = round2(room.w * room.h);
      return true;
    }
    if (hit.side === 'bottom' && same(room.x, rx0) && same(room.w, rw)) {
      room.h = round2(room.h + rh);
      room.area = round2(room.w * room.h);
      return true;
    }
    if (hit.side === 'top' && same(room.x, rx0) && same(room.w, rw)) {
      room.y = round2(ry0);
      room.h = round2(room.h + rh);
      room.area = round2(room.w * room.h);
      return true;
    }
    return false;
  };

  const pickResidualType = (rw, rh, area) => {
    // 残余区优先并入客厅语义，避免自动新增储藏间/卫生间等功能房导致“数量失真”。
    if (area <= smallResidualLimit) return 'living_room';
    const minSide = Math.min(rw, rh);
    const ar = Math.max(rw / Math.max(0.01, rh), rh / Math.max(0.01, rw));
    if (area >= 2.0 && (ar >= 2.2 || minSide <= 1.8)) return 'living_room';
    return 'living_room';
  };

  const mergeCorridorFragments = (items) => {
    const list = [...items];
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (!a || !b) continue;
          if (a.type !== 'corridor' || b.type !== 'corridor') continue;
          // 水平拼接
          if (Math.abs(a.y - b.y) <= mergeTol && Math.abs(a.h - b.h) <= mergeTol) {
            if (Math.abs((a.x + a.w) - b.x) <= mergeTol || Math.abs((b.x + b.w) - a.x) <= mergeTol) {
              const x1 = Math.min(a.x, b.x);
              const x2 = Math.max(a.x + a.w, b.x + b.w);
              a.x = round2(x1);
              a.w = round2(x2 - x1);
              a.area = round2(a.w * a.h);
              list.splice(j, 1);
              changed = true;
              break outer;
            }
          }
          // 竖向拼接
          if (Math.abs(a.x - b.x) <= mergeTol && Math.abs(a.w - b.w) <= mergeTol) {
            if (Math.abs((a.y + a.h) - b.y) <= mergeTol || Math.abs((b.y + b.h) - a.y) <= mergeTol) {
              const y1 = Math.min(a.y, b.y);
              const y2 = Math.max(a.y + a.h, b.y + b.h);
              a.y = round2(y1);
              a.h = round2(y2 - y1);
              a.area = round2(a.w * a.h);
              list.splice(j, 1);
              changed = true;
              break outer;
            }
          }
        }
      }
    }
    return list;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!uncovered[j][i]) continue;

      // 先横向扩展
      let i2 = i;
      while (i2 + 1 < nx && uncovered[j][i2 + 1]) i2++;

      // 再纵向扩展（要求每一行在 [i, i2] 都未覆盖）
      let j2 = j;
      let canGrow = true;
      while (canGrow && j2 + 1 < ny) {
        for (let k = i; k <= i2; k++) {
          if (!uncovered[j2 + 1][k]) { canGrow = false; break; }
        }
        if (canGrow) j2++;
      }

      const rx0 = xCuts[i], rx1 = xCuts[i2 + 1];
      const ry0 = yCuts[j], ry1 = yCuts[j2 + 1];
      const rw = rx1 - rx0;
      const rh = ry1 - ry0;
      const area = rw * rh;

      for (let yy = j; yy <= j2; yy++) {
        for (let xx = i; xx <= i2; xx++) uncovered[yy][xx] = false;
      }

      // 先尝试把小碎片并入邻接房间，避免生成“无功能小隔间”
      if ((Math.min(rw, rh) < 1.25 || area < 3.6) && tryAbsorbResidual(rx0, ry0, rw, rh)) {
        continue;
      }

      if (area < minFillArea) continue;
      const type = pickResidualType(rw, rh, area);
      const idx = added.filter(r => r.type === type).length + 1;
      const filler = makeRoomRect({ type, index: idx, label: ROOM_RULES[type]?.label || '补齐空间', floor }, rx0, ry0, rw, rh);
      filler._autoFill = true;
      added.push(filler);
    }
  }

  if (!added.length) return rooms;
  const mergedAdded = mergeCorridorFragments(added);
  return finalizeRooms([...rooms, ...mergedAdded]);
}

function enforceProgramRoomCaps(rooms, floor, config) {
  if (!Array.isArray(rooms) || !rooms.length) return rooms || [];
  const expected = config?.program?.[floor] || {};
  if (!expected || typeof expected !== 'object') return rooms;

  const convertToLiving = (room) => {
    room.type = 'living_room';
    room.label = ROOM_RULES.living_room.label;
    room.color = ROOM_RULES.living_room.color;
    room._mergedFromOverflow = true;
  };

  Object.keys(expected).forEach(type => {
    const cap = Number(expected[type]);
    if (!Number.isFinite(cap) || cap < 0) return;
    const sameType = rooms.filter(r => r.type === type);
    if (sameType.length <= cap) return;

    // 超出数量的房间优先回收自动补齐区，再回收面积最小项
    const overflow = [...sameType]
      .sort((a, b) => {
        const aAuto = a._autoFill ? 0 : 1;
        const bAuto = b._autoFill ? 0 : 1;
        if (aAuto !== bAuto) return aAuto - bAuto;
        return (a.area || 0) - (b.area || 0);
      })
      .slice(cap);

    overflow.forEach(r => convertToLiving(r));
  });

  return rooms;
}

function renumberRoomIndices(rooms) {
  if (!Array.isArray(rooms) || !rooms.length) return rooms || [];
  const groups = new Map();
  rooms.forEach(r => {
    const key = String(r.type || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  groups.forEach((items, type) => {
    const rule = ROOM_RULES[type] || {};
    items
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .forEach((r, idx) => {
        const no = idx + 1;
        r.index = no;
        const baseLabel = rule.label || r.label || type;
        r.label = no > 1 ? `${baseLabel}${no}` : baseLabel;
      });
  });
  return rooms;
}

function allocateRoomAreas(roomList, floorArea) {
  const maxTotalRatio = RULE_PROFILE.geometry.fillRateTarget;
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
    const expandPriority = ['living_room', 'bedroom', 'dining', 'kitchen', 'bathroom', 'study', 'storage', 'hot_water_room'];
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
    const shrinkPriority = ['storage', 'hot_water_room', 'study', 'bedroom', 'living_room', 'dining'];
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
    1: ['living_room', 'dining', 'kitchen', 'bathroom', 'bedroom', 'corridor', 'stairs'],
    2: ['terrace', 'living_room', 'storage', 'bedroom', 'bathroom', 'corridor', 'stairs'],
    3: ['terrace', 'living_room', 'hot_water_room', 'bedroom', 'bathroom', 'corridor', 'stairs']
  };
  const order = orderMap[floor] || Object.keys(program);

  order.forEach(type => {
    let count = Number(program[type] || 0);
    if (type === 'stairs') {
      count = floor >= 2 ? 1 : Math.max(0, count);
    }
    if (type === 'bedroom') {
      count = floor === 1 ? clamp(count, 2, 3) : clamp(count, 2, 4);
    }
    if (type === 'corridor') {
      // 当前策略：取消显式过道房间，避免“客厅被切分为孤岛”
      count = 0;
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

// ===== Stair Generator (code-first, constructible geometry) =====
const STAIR_RULES = {
  treadMin: 220,
  treadPreferredMin: 250,
  treadPreferredTarget: 260,
  treadPreferredMax: 280,
  riserMax: 175,
  riserComfortMin: 160,
  riserComfortMax: 175,
  widthDefault: 1000,
  widthMin: 900,
  maxRisersPerFlight: 18,
  suggestMinRisersPerFlight: 8
};

function mmToM(v) { return v / 1000; }
function mToMm(v) { return Math.round(v * 1000); }

function computeStepCounts(floorHeightMm, targetRiserMm = 170) {
  let n = Math.max(2, Math.ceil(floorHeightMm / targetRiserMm));
  while (floorHeightMm / n > STAIR_RULES.riserMax) n += 1;
  const candidates = [];
  for (let k = Math.max(2, n - 4); k <= n + 8; k++) {
    const r = floorHeightMm / k;
    if (r > STAIR_RULES.riserMax) continue;
    let score = Math.abs(r - targetRiserMm);
    if (r < STAIR_RULES.riserComfortMin || r > STAIR_RULES.riserComfortMax) score += 30;
    candidates.push({ k, r, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0] || { k: n, r: floorHeightMm / n };
  return {
    total_risers: best.k,
    riser_height_mm: round2(best.r)
  };
}

function chooseTread(maxTreadAllowedMm) {
  const seq = [280, 270, 260, 250, 240, 230, 220];
  return seq.find(v => v <= maxTreadAllowedMm) || null;
}

function stepPolylinesVertical(x, y, w, tread, count, up = true) {
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const yy = up ? y + i * tread : y - i * tread;
    lines.push([[x, yy], [x + w, yy]]);
  }
  return lines;
}

function stepPolylinesHorizontal(x, y, h, tread, count, right = true) {
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const xx = right ? x + i * tread : x - i * tread;
    lines.push([[xx, y], [xx, y + h]]);
  }
  return lines;
}

function checkStairBBoxFit(stair, availableBBox) {
  const b = stair.bbox;
  return b.x >= availableBBox.x - 1e-6 &&
    b.y >= availableBBox.y - 1e-6 &&
    b.x + b.width <= availableBBox.x + availableBBox.width + 1e-6 &&
    b.y + b.height <= availableBBox.y + availableBBox.height + 1e-6;
}

function checkHeadroomPlaceholder() {
  return [{ code: 'HEADROOM_PENDING', severity: 'warn', message: '净高校核需3D阶段补充' }];
}

function checkDoorConflict(stair, doorClearances = []) {
  const issues = [];
  if (!doorClearances.length) return issues;
  const a = stair.bbox;
  doorClearances.forEach((d, i) => {
    const overlap = !(a.x + a.width <= d.x || d.x + d.width <= a.x || a.y + a.height <= d.y || d.y + d.height <= a.y);
    if (overlap) issues.push({ code: 'DOOR_CONFLICT', severity: 'error', message: `与门洞开启范围冲突 #${i}` });
  });
  return issues;
}

function checkFlightStepConsistency(stair) {
  const issues = [];
  stair.flights.forEach(f => {
    if (f.riser_count > STAIR_RULES.maxRisersPerFlight) {
      issues.push({ code: 'FLIGHT_TOO_LONG', severity: 'error', message: `梯段${f.index}踏步数>${STAIR_RULES.maxRisersPerFlight}` });
    } else if (f.riser_count < STAIR_RULES.suggestMinRisersPerFlight) {
      issues.push({ code: 'FLIGHT_TOO_SHORT', severity: 'warn', message: `梯段${f.index}踏步数<${STAIR_RULES.suggestMinRisersPerFlight}` });
    }
  });
  return issues;
}

function checkPlatformWidth(stair) {
  return stair.platform_width_mm < stair.flight_width_mm
    ? [{ code: 'PLATFORM_TOO_NARROW', severity: 'error', message: '平台净宽小于梯段净宽' }]
    : [];
}

function checkRiserTreadLimits(stair) {
  const issues = [];
  if (stair.riser_height_mm > STAIR_RULES.riserMax) issues.push({ code: 'RISER_LIMIT_FAIL', severity: 'error', message: 'riser > 175mm' });
  if (stair.tread_depth_mm < STAIR_RULES.treadMin) issues.push({ code: 'TREAD_LIMIT_FAIL', severity: 'error', message: 'tread < 220mm' });
  if (stair.riser_height_mm < STAIR_RULES.riserComfortMin || stair.riser_height_mm > STAIR_RULES.riserComfortMax) {
    issues.push({ code: 'RISER_COMFORT_WARN', severity: 'warn', message: 'riser 不在 160~175 舒适区' });
  }
  if (stair.tread_depth_mm < STAIR_RULES.treadPreferredMin || stair.tread_depth_mm > STAIR_RULES.treadPreferredMax) {
    issues.push({ code: 'TREAD_COMFORT_WARN', severity: 'warn', message: 'tread 不在 250~280 舒适区' });
  }
  return issues;
}

function checkAccessibilityOfStairEntryExit(stair, startPoint, endPoint) {
  const issues = [];
  const b = stair.bbox;
  const near = (pt, edge, tol = 1200) => {
    if (!pt) return true;
    const [px, py] = pt;
    if (edge === 'south') return Math.abs(py - b.y) <= tol;
    if (edge === 'north') return Math.abs(py - (b.y + b.height)) <= tol;
    if (edge === 'west') return Math.abs(px - b.x) <= tol;
    if (edge === 'east') return Math.abs(px - (b.x + b.width)) <= tol;
    return true;
  };
  if (!near(startPoint, stair.entry_edge)) issues.push({ code: 'ENTRY_ACCESS_RISK', severity: 'warn', message: '楼梯下口连通性偏弱' });
  if (!near(endPoint, stair.exit_edge)) issues.push({ code: 'EXIT_ACCESS_RISK', severity: 'warn', message: '楼梯上口连通性偏弱' });
  return issues;
}

function validateStair(stair, availableBBox, startPointMm = null, endPointMm = null, doorClearances = []) {
  const issues = [];
  if (!checkStairBBoxFit(stair, availableBBox)) {
    issues.push({ code: 'BBOX_FIT_FAIL', severity: 'error', message: '楼梯投影超出 available_bbox' });
  }
  issues.push(...checkHeadroomPlaceholder());
  issues.push(...checkDoorConflict(stair, doorClearances));
  issues.push(...checkFlightStepConsistency(stair));
  issues.push(...checkPlatformWidth(stair));
  issues.push(...checkRiserTreadLimits(stair));
  issues.push(...checkAccessibilityOfStairEntryExit(stair, startPointMm, endPointMm));
  return {
    code_passed: !issues.some(i => i.severity === 'error'),
    issues
  };
}

function generateUStair(params) {
  const { floor_height_mm, available_bbox, step_info, flight_width_mm = STAIR_RULES.widthDefault } = params;
  const { x, y, width, height } = available_bbox;
  const total = step_info.total_risers;
  const riser = step_info.riser_height_mm;
  const n1 = Math.floor(total / 2);
  const n2 = total - n1;
  const platform = flight_width_mm;
  const middleGap = 120;
  const needW = flight_width_mm * 2 + middleGap;
  if (needW > width) return null;
  const maxTread = (height - platform) / Math.max(n1, n2);
  const tread = chooseTread(maxTread);
  if (!tread) return null;
  const run1 = n1 * tread;
  const run2 = n2 * tread;
  // U形双跑在平面投影上两段通常重叠于同一进深方向，
  // 因此总体进深应为 max(run1, run2) + platform，而不是两段相加
  const runMax = Math.max(run1, run2);
  const needH = runMax + platform;
  if (needH > height) return null;
  const sx = x + (width - needW) / 2;
  const sy = y + (height - needH) / 2;
  const leftX = sx;
  const rightX = sx + flight_width_mm + middleGap;
  const platY = sy + runMax;
  const leftStartY = sy + run1;
  const rightStartY = sy + runMax;
  return {
    stair_type: 'U',
    floor_height_mm,
    total_risers: total,
    riser_height_mm: round2(riser),
    tread_depth_mm: tread,
    flight_width_mm,
    platform_width_mm: platform,
    total_projection_length_mm: round2(needH),
    total_projection_width_mm: round2(needW),
    bbox: { x: round2(sx), y: round2(sy), width: round2(needW), height: round2(needH) },
    flights: [
      {
        index: 1,
        riser_count: n1,
        start_xy: [round2(leftX), round2(leftStartY)],
        direction: 'up_north',
        run_length_mm: round2(run1),
        width_mm: flight_width_mm,
        step_polylines: stepPolylinesVertical(leftX, leftStartY, flight_width_mm, tread, n1, false)
      },
      {
        index: 2,
        riser_count: n2,
        start_xy: [round2(rightX), round2(rightStartY)],
        direction: 'up_south_to_north_return',
        run_length_mm: round2(run2),
        width_mm: flight_width_mm,
        step_polylines: stepPolylinesVertical(rightX, sy + runMax - run2, flight_width_mm, tread, n2, true)
      }
    ],
    platforms: [
      { index: 1, polygon: [[leftX, platY], [leftX + needW, platY], [leftX + needW, platY + platform], [leftX, platY + platform]] }
    ],
    handrails: [
      { side: 'left_outer', polyline: [[leftX, sy], [leftX, sy + run1]], height_mm: 900 },
      { side: 'center_left', polyline: [[leftX + flight_width_mm, sy], [leftX + flight_width_mm, sy + run1]], height_mm: 900 },
      { side: 'center_right', polyline: [[rightX, sy + runMax - run2], [rightX, sy + runMax]], height_mm: 900 },
      { side: 'right_outer', polyline: [[rightX + flight_width_mm, sy + runMax - run2], [rightX + flight_width_mm, sy + runMax]], height_mm: 900 }
    ],
    entry_edge: 'south',
    exit_edge: 'north'
  };
}

function generateLStair(params) {
  const { floor_height_mm, available_bbox, step_info, flight_width_mm = STAIR_RULES.widthDefault } = params;
  const { x, y, width, height } = available_bbox;
  const total = step_info.total_risers;
  const riser = step_info.riser_height_mm;
  const n1 = Math.floor(total / 2);
  const n2 = total - n1;
  const platform = flight_width_mm;
  const maxTread1 = (height - platform) / Math.max(n1, 1);
  const maxTread2 = (width - platform) / Math.max(n2, 1);
  const tread = chooseTread(Math.min(maxTread1, maxTread2));
  if (!tread) return null;
  const run1 = n1 * tread;
  const run2 = n2 * tread;
  const needH = run1 + platform;
  const needW = run2 + platform;
  if (needH > height || needW > width) return null;
  const sx = x + (width - needW) / 2;
  const sy = y + (height - needH) / 2;
  const f1StartY = sy + run1;
  const pX = sx, pY = sy + run1;
  const f2X = pX + platform, f2Y = pY;
  return {
    stair_type: 'L',
    floor_height_mm,
    total_risers: total,
    riser_height_mm: round2(riser),
    tread_depth_mm: tread,
    flight_width_mm,
    platform_width_mm: platform,
    total_projection_length_mm: round2(needH),
    total_projection_width_mm: round2(needW),
    bbox: { x: round2(sx), y: round2(sy), width: round2(needW), height: round2(needH) },
    flights: [
      {
        index: 1,
        riser_count: n1,
        start_xy: [round2(sx), round2(f1StartY)],
        direction: 'up_north',
        run_length_mm: round2(run1),
        width_mm: flight_width_mm,
        step_polylines: stepPolylinesVertical(sx, f1StartY, flight_width_mm, tread, n1, false)
      },
      {
        index: 2,
        riser_count: n2,
        start_xy: [round2(f2X), round2(f2Y)],
        direction: 'up_east',
        run_length_mm: round2(run2),
        width_mm: flight_width_mm,
        step_polylines: stepPolylinesHorizontal(f2X, f2Y, flight_width_mm, tread, n2, true)
      }
    ],
    platforms: [
      { index: 1, polygon: [[pX, pY], [pX + platform, pY], [pX + platform, pY + platform], [pX, pY + platform]] }
    ],
    handrails: [
      { side: 'f1_left', polyline: [[sx, sy], [sx, sy + run1]], height_mm: 900 },
      { side: 'f1_right', polyline: [[sx + flight_width_mm, sy], [sx + flight_width_mm, sy + run1]], height_mm: 900 },
      { side: 'f2_bottom', polyline: [[f2X, f2Y], [f2X + run2, f2Y]], height_mm: 900 },
      { side: 'f2_top', polyline: [[f2X, f2Y + flight_width_mm], [f2X + run2, f2Y + flight_width_mm]], height_mm: 900 }
    ],
    entry_edge: 'south',
    exit_edge: 'east'
  };
}

function generateStraightStair(params) {
  const { floor_height_mm, available_bbox, step_info, flight_width_mm = STAIR_RULES.widthDefault } = params;
  const { x, y, width, height } = available_bbox;
  const total = step_info.total_risers;
  const riser = step_info.riser_height_mm;
  const platform = flight_width_mm;
  const tread = chooseTread((height - platform) / Math.max(total, 1));
  if (!tread) return null;
  const run = total * tread;
  const needH = run + platform;
  const needW = flight_width_mm;
  if (needH > height || needW > width) return null;
  const sx = x + (width - needW) / 2;
  const sy = y + (height - needH) / 2;
  return {
    stair_type: 'STRAIGHT',
    floor_height_mm,
    total_risers: total,
    riser_height_mm: round2(riser),
    tread_depth_mm: tread,
    flight_width_mm,
    platform_width_mm: platform,
    total_projection_length_mm: round2(needH),
    total_projection_width_mm: round2(needW),
    bbox: { x: round2(sx), y: round2(sy), width: round2(needW), height: round2(needH) },
    flights: [{
      index: 1,
      riser_count: total,
      start_xy: [round2(sx), round2(sy + run)],
      direction: 'up_north',
      run_length_mm: round2(run),
      width_mm: flight_width_mm,
      step_polylines: stepPolylinesVertical(sx, sy + run, flight_width_mm, tread, total, false)
    }],
    platforms: [{ index: 1, polygon: [[sx, sy + run], [sx + platform, sy + run], [sx + platform, sy + run + platform], [sx, sy + run + platform]] }],
    handrails: [
      { side: 'left', polyline: [[sx, sy], [sx, sy + run]], height_mm: 900 },
      { side: 'right', polyline: [[sx + flight_width_mm, sy], [sx + flight_width_mm, sy + run]], height_mm: 900 }
    ],
    entry_edge: 'south',
    exit_edge: 'north'
  };
}

function generateStair(params) {
  const {
    floor_height_mm,
    stair_type = null,
    available_bbox,
    start_point = null,
    end_point = null,
    door_clearances = [],
    anchor = null
  } = params;

  const stepInfo = computeStepCounts(floor_height_mm);
  const widthChoices = [STAIR_RULES.widthDefault, STAIR_RULES.widthMin];
  const order = stair_type ? [String(stair_type).toUpperCase()] : ['U', 'L', 'STRAIGHT'];
  let best = null;
  let bestVal = null;
  for (const t of order) {
    for (const fw of widthChoices) {
      const genParams = { floor_height_mm, available_bbox, step_info: stepInfo, flight_width_mm: fw };
      let cand = null;
      if (t === 'U') cand = generateUStair(genParams);
      else if (t === 'L') cand = generateLStair(genParams);
      else if (t === 'STRAIGHT') cand = generateStraightStair(genParams);
      if (!cand) continue;

      if (anchor) {
        const dx = anchor.x - cand.bbox.x;
        const dy = anchor.y - cand.bbox.y;
        const shifted = JSON.parse(JSON.stringify(cand));
        shifted.bbox.x = round2(shifted.bbox.x + dx);
        shifted.bbox.y = round2(shifted.bbox.y + dy);
        shifted.flights.forEach(f => {
          f.start_xy = [round2(f.start_xy[0] + dx), round2(f.start_xy[1] + dy)];
          f.step_polylines = f.step_polylines.map(ln => ln.map(([px, py]) => [round2(px + dx), round2(py + dy)]));
        });
        shifted.platforms.forEach(p => {
          p.polygon = p.polygon.map(([px, py]) => [round2(px + dx), round2(py + dy)]);
        });
        shifted.handrails.forEach(h => {
          h.polyline = h.polyline.map(([px, py]) => [round2(px + dx), round2(py + dy)]);
        });
        if (checkStairBBoxFit(shifted, available_bbox)) cand = shifted;
      }

      const val = validateStair(cand, available_bbox, start_point, end_point, door_clearances);
      cand.validation = val;
      if (val.code_passed) return cand;
      const errCount = val.issues.filter(i => i.severity === 'error').length;
      if (!bestVal || errCount < bestVal.issues.filter(i => i.severity === 'error').length) {
        best = cand;
        bestVal = val;
      }
    }
  }
  if (best) return best;
  return {
    stair_type: stair_type || 'UNKNOWN',
    floor_height_mm,
    total_risers: 0,
    riser_height_mm: 0,
    tread_depth_mm: 0,
    flight_width_mm: 0,
    platform_width_mm: 0,
    flights: [],
    platforms: [],
    handrails: [],
    validation: {
      code_passed: false,
      issues: [{ code: 'NO_SOLUTION', severity: 'error', message: '无法在可用空间内生成合规楼梯' }]
    }
  };
}

function resolveCoreLayout(length, width, stairTargetArea = 9.5, preferredFrontH = null, withStair = true) {
  const MIN_STAIR_W = 2.4;
  const MIN_STAIR_H = 3.6;
  const safeFront = preferredFrontH ?? clamp(width * 0.42, MIN_STAIR_H, width * 0.62);
  if (!withStair) {
    return { stairW: 0, stairH: 0, frontH: safeFront, stairX: 0, stairY: width - safeFront };
  }

  const frontH = clamp(safeFront, MIN_STAIR_H, width - 1.2);
  const maxStairW = Math.min(4.2, Math.max(MIN_STAIR_W, length * 0.38));
  let stairW = clamp(stairTargetArea / frontH, MIN_STAIR_W, maxStairW);
  if (stairW > length * 0.45) {
    stairW = Math.max(MIN_STAIR_W, length * 0.35);
  }

  const stairX = 0;
  return {
    stairW,
    stairH: frontH,
    frontH,
    stairX,
    stairY: width - frontH
  };
}

function resolveMinWidthByRule(room, bandH) {
  if (!room) return 0.9;
  const rule = ROOM_RULES[room.type] || {};
  const safeH = Math.max(0.6, bandH);
  const minW = Math.max(0.9, Number(rule.minWidth) || 0.9);
  const maxAR = Math.max(1.6, Number(rule.maxAspectRatio) || 3);
  const minArea = Math.max(0, Number(rule.minArea) || 0);
  const byAspect = safeH / maxAR;
  const byArea = minArea > 0 ? (minArea / safeH) : 0;
  return Math.max(minW, byAspect, byArea);
}

function resolveServiceColumnNeedWidth(rooms, bandH) {
  if (!rooms || rooms.length === 0) return 0;
  return rooms.reduce((maxW, room) => Math.max(maxW, resolveMinWidthByRule(room, bandH)), 0);
}

function chooseSmartSplitDirection(rooms, w, h, fallback = 'horizontal') {
  return fallback;
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
  const corridors = takeAllByType(pool, 'corridor');
  const corridor = corridors[0] || null;
  const storage = takeFirstByTypes(pool, ['storage']);
  const preferredFrontH = living ? clamp(living.targetArea / Math.max(4.5, length * 0.5), 3.6, width * 0.6) : clamp(width * 0.42, 3.6, width * 0.58);
  const core = resolveCoreLayout(length, width, stair?.targetArea || 9.5, preferredFrontH, !!stair);
  const frontH = core.frontH;
  const stairOnRight = !!stair && core.stairX > (length - core.stairW) / 2;
  const frontRightLimit = stairOnRight ? (length - core.stairW) : length;

  let curX = 0;
  if (stair) {
    const availableBBoxMm = {
      x: mToMm(core.stairX),
      y: mToMm(core.stairY),
      width: mToMm(core.stairW),
      height: mToMm(core.stairH)
    };
    const stairGeom = generateStair({
      floor_height_mm: mToMm(config.floorHeight || 3.3),
      stair_type: null,
      available_bbox: availableBBoxMm,
      start_point: [mToMm(core.stairX + core.stairW * 0.5), mToMm(core.stairY)],
      end_point: [mToMm(core.stairX + core.stairW * 0.5), mToMm(core.stairY + core.stairH)],
      anchor: null
    });

    // 楼梯房间外框固定贴墙（按 core 布局矩形），
    // 仅把 stairGeom 用于台阶/平台绘制，不反推房间外边界。
    const sx = core.stairX;
    const sy = core.stairY;
    const sw = core.stairW;
    const sh = core.stairH;
    const stairRect = makeRoomRect(stair, sx, sy, sw, sh);
    if (stairGeom) stairRect._stairGeom = stairGeom;
    result.push(stairRect);
    if (!stairOnRight) curX += sw;
  }

  let corridorFrontW = 0;
  if (corridor) {
    corridorFrontW = clamp((corridor.targetArea || 4) / Math.max(3.6, frontH), 0.9, 1.4);
    if (curX + corridorFrontW < frontRightLimit - 3.6) {
      pushRoomRectIfValid(result, corridor, curX, width - frontH, corridorFrontW, frontH);
      curX += corridorFrontW;
    } else {
      corridorFrontW = 0;
    }
  }

  if (living) {
    const reserveDining = dining ? 2.4 : 0;
    const livingW = Math.max(4, frontRightLimit - curX - reserveDining);
    pushRoomRectIfValid(result, living, curX, width - frontH, livingW, frontH);
    curX += livingW;
  }
  if (dining) {
    const dw = Math.max(2.2, frontRightLimit - curX);
    if (dw > 0.9) pushRoomRectIfValid(result, dining, curX, width - frontH, dw, frontH);
  }

  const backH = width - frontH;
  if (backH < 0.5) return finalizeRooms(result);

  // 一层楼梯连通性硬约束：
  // 在楼梯上口与主客厅之间预留>=1.0m 的客厅连通带，避免出现“楼梯出来是客厅但被卧室隔断”。
  const canReserveStairLink = !!stair && backH >= 1.2 && (length - core.stairW) >= 4.2;
  const stairLinkW = canReserveStairLink ? 1.05 : 0;
  const stairLinkH = canReserveStairLink ? clamp(backH * 0.22, 1.0, 1.3) : 0;
  const backStartX = canReserveStairLink
    ? (stairOnRight ? 0 : core.stairW + stairLinkW)
    : 0;
  const backAvailW = Math.max(2.6, length - (canReserveStairLink && stairOnRight ? (core.stairW + stairLinkW) : backStartX));

  if (canReserveStairLink) {
    const livingBridgeSeed = { type: 'living_room', label: ROOM_RULES.living_room.label, index: 99, floor: 1 };
    if (stairOnRight) {
      // A: 楼梯上口北侧客厅带（右侧）
      pushRoomRectIfValid(result, livingBridgeSeed, core.stairX, 0, core.stairW, backH);
      // B: 向左侧主客厅的连通口
      pushRoomRectIfValid(result, livingBridgeSeed, Math.max(0, core.stairX - stairLinkW), Math.max(0, backH - stairLinkH), stairLinkW, stairLinkH);
    } else {
      // A: 楼梯上口北侧客厅带（左侧）
      pushRoomRectIfValid(result, livingBridgeSeed, 0, 0, core.stairW, backH);
      // B: 与主客厅衔接的1m连通口（保证至少1m有效通道）
      pushRoomRectIfValid(result, livingBridgeSeed, core.stairW, Math.max(0, backH - stairLinkH), stairLinkW, stairLinkH);
    }
  }

  // 大进深时：卧室列 + 过道列 + 厨卫服务列，避免卧室串联交通
  const useCorridorColumn = !!corridor && bedrooms.length >= 2 && backH >= 3.6;
  if (useCorridorColumn) {
    const serviceRooms = [];
    if (kitchen) serviceRooms.push(kitchen);
    if (bathroom) serviceRooms.push(bathroom);
    if (storage) serviceRooms.push(storage);
    const serviceNeedW = resolveServiceColumnNeedWidth(serviceRooms, backH);
    const corridorW = clamp((corridor.targetArea || 4.5) / Math.max(2.8, backH), 0.9, 1.2);
    const minBedSliceW = Math.max(1.2, backH / Math.max(2.4, ROOM_RULES.bedroom.maxAspectRatio || 3));
    const minBedroomBlockW = bedrooms.length ? bedrooms.length * minBedSliceW : 0;
    const serviceUpperW = Math.max(1.8, backAvailW - corridorW - Math.max(2.2, minBedroomBlockW));
    let serviceW = clamp(serviceNeedW, 1.8, serviceUpperW);
    let leftW = backAvailW - serviceW - corridorW;
    if (bedrooms.length > 0 && leftW < 2.2) {
      const recover = 2.2 - leftW;
      serviceW = Math.max(1.8, serviceW - recover);
      leftW = backAvailW - serviceW - corridorW;
    }
    leftW = Math.max(0, leftW);

    if (bedrooms.length) {
      const bedDir = chooseSmartSplitDirection(bedrooms, leftW, backH, 'horizontal');
      result.push(...splitBand(bedrooms, backStartX, 0, leftW, backH, scale, bedDir));
    }
    pushRoomRectIfValid(result, corridor, backStartX + leftW, 0, corridorW, backH);

    const sx = backStartX + leftW + corridorW;
    // 厨房放上侧，贴外墙；卫生间/储藏间竖向分配，避免细长条
    if (serviceRooms.length) {
      result.push(...splitBand(serviceRooms, sx, 0, Math.max(2.0, serviceW), backH, scale, 'vertical'));
    }
  } else {
    // 非过道模式：后带采用“卧室主带 + 厨卫服务带”，
    // 服务带宽度按硬约束反推并优先挤占客厅侧余量，避免厨房/卫生间长条化。
    const serviceRooms = [];
    if (kitchen) serviceRooms.push(kitchen);
    if (bathroom) serviceRooms.push(bathroom);
    if (storage) serviceRooms.push(storage);

    if (serviceRooms.length > 0) {
      const serviceNeedW = resolveServiceColumnNeedWidth(serviceRooms, backH);
      const minBedSliceW = Math.max(1.2, backH / Math.max(2.4, ROOM_RULES.bedroom.maxAspectRatio || 3));
      const minBedroomBlockW = bedrooms.length ? bedrooms.length * minBedSliceW : 0;
      const serviceUpperW = Math.max(2.2, backAvailW - Math.max(2.6, minBedroomBlockW));
      let serviceW = clamp(serviceNeedW, Math.min(2.2, backAvailW * 0.35), serviceUpperW);
      if (serviceW > backAvailW - 2.2) serviceW = Math.max(2.0, backAvailW - 2.2);

      const bedroomW = Math.max(0, backAvailW - serviceW);
      const sx = backStartX + bedroomW;

      if (bedrooms.length > 0 && bedroomW > 2.2) {
        const bedDir = chooseSmartSplitDirection(bedrooms, bedroomW, backH, 'horizontal');
        result.push(...splitBand(bedrooms, backStartX, 0, bedroomW, backH, scale, bedDir));
      }

      if (serviceRooms.length === 1) {
        pushRoomRectIfValid(result, serviceRooms[0], sx, 0, serviceW, backH);
      } else {
        result.push(...splitBand(serviceRooms, sx, 0, serviceW, backH, scale, 'vertical'));
      }
    } else {
      const backRooms = [...bedrooms];
      if (backRooms.length) {
        const backDir = chooseSmartSplitDirection(backRooms, backAvailW, backH, 'horizontal');
        result.push(...splitBand(backRooms, backStartX, 0, backAvailW, backH, scale, backDir));
      }
    }
  }

  return finalizeRooms(result);
}

function layoutUpperFloor(floor, targetRooms, length, width, scale, config) {
  const pool = [...targetRooms];
  const result = [];

  const terrace = takeFirstByTypes(pool, ['terrace']);
  const hasTerrace = !!terrace;
  const living = takeFirstByTypes(pool, ['living_room', 'lounge', 'multi']);
  const stair = takeFirstByTypes(pool, ['stairs']);
  const bathrooms = takeAllByType(pool, 'bathroom');
  const bedrooms = takeAllByType(pool, 'bedroom');
  const storages = takeAllByType(pool, 'storage');
  const hotWaterRooms = takeAllByType(pool, 'hot_water_room');
  const corridors = takeAllByType(pool, 'corridor');
  const corridor = corridors[0] || null;

  // 使用预生成的共享露台参数
  const terracePos = config._terracePos || 'tr';
  const terraceDepth = config._terraceDepth || clamp(width * 0.2, 1.5, Math.min(3, width * 0.35));
  const terraceW = config._terraceW || clamp(length * 0.25, 2, length * 0.4);

  // 一层楼梯间和卫生间位置（上层复用，确保上下层精确对齐）
  const stairX = config._stairX !== undefined ? config._stairX : 0;
  const stairY = config._stairY !== undefined ? config._stairY : width * 0.5;
  const stairW = config._stairW !== undefined ? config._stairW : length * 0.2;
  const stairH = config._stairH !== undefined ? config._stairH : width * 0.3;
  const stairOnRight = stairX > (length - stairW) / 2;

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

  if (hasTerrace) {
    pushRoomRectIfValid(result, { ...terrace, _corner: terracePos }, tx, ty, terraceW, terraceDepth);
  }

  // front带高度（与一层一致）
  const frontH = width - stairY;

  // === front 带 ===
  // 楼梯间（与一层同位置同大小）
  if (stair) {
    const sRect = makeRoomRect(stair, stairX, stairY, stairW, stairH);
    if (config._stairGeom) sRect._stairGeom = config._stairGeom;
    result.push(sRect);
  }

  // 起居厅 / 过道（楼梯间右侧，作为上层首达空间）
  if (living) {
    let livingX = stairOnRight ? 0 : (stairX + stairW);
    let livingW = stairOnRight ? stairX : (length - stairW);
    let corridorW = 0;
    if (corridor) {
      corridorW = clamp((corridor.targetArea || 4) / Math.max(3.6, frontH), 0.9, 1.4);
      if (stairOnRight) {
        if (livingW - corridorW > 3.5) {
          pushRoomRectIfValid(result, corridor, livingX + livingW - corridorW, stairY, corridorW, frontH);
          livingW -= corridorW;
        }
      } else {
        if (livingX + corridorW < length - 3.5) {
          pushRoomRectIfValid(result, corridor, livingX, stairY, corridorW, frontH);
          livingX += corridorW;
          livingW -= corridorW;
        }
      }
    }
    if (hasTerrace && (terracePos === 'tr' || terracePos === 'tl')) {
      livingW = Math.max(4, length - (livingX - stairX) - terraceW);
      if (livingW < 3.5) {
        const backCorners = ['bl', 'br'];
        const forcedPos = backCorners[Math.floor(Math.random() * backCorners.length)];
        config._terracePos = forcedPos;
        if (forcedPos === 'bl') { tx = 0; ty = 0; }
        else { tx = length - terraceW; ty = 0; }
        const tRoom = result.find(r => r.type === 'terrace');
        if (tRoom) { tRoom.x = tx; tRoom.y = ty; }
        livingW = length - livingX;
      }
    }
    if (livingW > 3.5) {
      pushRoomRectIfValid(result, living, livingX, stairY, Math.max(3.5, livingW), frontH);
    }
  } else if (corridor) {
    const corridorW = clamp((corridor.targetArea || 4) / Math.max(3.6, frontH), 0.9, 1.4);
    if (stairOnRight) {
      pushRoomRectIfValid(result, corridor, 0, stairY, Math.max(1.0, stairX), frontH);
    } else {
      pushRoomRectIfValid(result, corridor, stairX + stairW, stairY, Math.max(1.0, length - stairW), frontH);
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
    // 左列：卧室；中列：可选过道；右列：卫生间，避免卧室串联交通
    const rightW = Math.max(2.2, Math.min(3.2, length * 0.24));
    const corridorW = corridor ? clamp((corridor.targetArea || 4.5) / Math.max(2.6, backH), 0.9, 1.35) : 0;
    const leftW = Math.max(3.0, length - rightW - corridorW);
    if (bedrooms.length) {
      let bedX = 0, bedW = leftW;
      if (hasTerrace && terracePos === 'bl') { bedX = terraceW; bedW = leftW - terraceW; }
      if (bedW > 2.5) {
        const bedDir = chooseSmartSplitDirection(bedrooms, bedW, backH, 'horizontal');
        result.push(...splitBand(bedrooms, bedX, 0, bedW, backH, scale, bedDir));
      }
    }
    if (corridor && corridorW > 0.85) {
      pushRoomRectIfValid(result, corridor, leftW, 0, corridorW, backH);
    }
    // 右列：卫生间 + 储藏间 + 热水器房
    const serviceRooms = [...bathrooms, ...storages, ...hotWaterRooms];
    if (serviceRooms.length) {
      let bX = leftW + corridorW, bW = rightW;
      if (hasTerrace && terracePos === 'br') { bW = Math.max(1.5, bathW - terraceW); }
      if (serviceRooms.length === 1) {
        pushRoomRectIfValid(result, serviceRooms[0], bX, 0, bW, backH);
      } else {
        result.push(...splitBand(serviceRooms, bX, 0, bW, backH, scale, 'vertical'));
      }
    }
  } else {
    // 高度不足时：优先保留交通连续性（corridor 若存在放最前）
    let backX = 0, backW = length;
    if (hasTerrace && terracePos === 'bl') { backX = terraceW; backW = length - terraceW; }
    if (backW <= 2.5) return finalizeRooms(result);

    const serviceRooms = [...bathrooms, ...storages, ...hotWaterRooms];
    const bedroomsRooms = [...bedrooms];

    if (!serviceRooms.length) {
      const backRooms = corridor ? [corridor, ...bedroomsRooms] : bedroomsRooms;
      if (backRooms.length) {
        const backDir = chooseSmartSplitDirection(backRooms, backW, backH, 'horizontal');
        result.push(...splitBand(backRooms, backX, 0, backW, backH, scale, backDir));
      }
      return finalizeRooms(result);
    }

    // 硬约束目标：服务房间（卫生间/储藏间/热水器房）按长宽比反推所需宽度，
    // 宽度优先从卧室/客厅可用带宽让渡，避免细长条。
    const serviceNeedW = serviceRooms.reduce((sum, room) => {
      const rule = ROOM_RULES[room.type] || {};
      const minW = Math.max(0.9, Number(rule.minWidth) || 0.9);
      const maxAR = Math.max(1.6, Number(rule.maxAspectRatio) || 3);
      const minArea = Math.max(0, Number(rule.minArea) || 0);
      const wByAR = backH / maxAR;
      const wByArea = minArea > 0 ? (minArea / Math.max(0.6, backH)) : 0;
      return sum + Math.max(minW, wByAR, wByArea);
    }, 0);

    const bedMinSliceW = Math.max(1.2, backH / Math.max(2.4, ROOM_RULES.bedroom.maxAspectRatio || 3));
    const minBedroomBlockW = bedroomsRooms.length ? bedroomsRooms.length * bedMinSliceW : 0;
    const serviceWUpper = Math.max(1.8, backW - Math.max(2.2, minBedroomBlockW));
    let serviceW = clamp(serviceNeedW, Math.min(2.2, backW * 0.35), serviceWUpper);
    if (serviceW > backW - 2.0) serviceW = Math.max(1.6, backW - 2.0);

    const serviceX = backX + backW - serviceW;
    const bedroomBlockW = Math.max(0, serviceX - backX);

    if (bedroomsRooms.length && bedroomBlockW > 2.2) {
      const bedRoomsToSplit = corridor ? [corridor, ...bedroomsRooms] : bedroomsRooms;
      const bedDir = chooseSmartSplitDirection(bedRoomsToSplit, bedroomBlockW, backH, 'horizontal');
      result.push(...splitBand(bedRoomsToSplit, backX, 0, bedroomBlockW, backH, scale, bedDir));
    } else if (corridor && bedroomBlockW > 1.2) {
      result.push(...splitBand([corridor], backX, 0, bedroomBlockW, backH, scale, 'horizontal'));
    }

    result.push(...splitServiceRoomsByHardWidth(serviceRooms, serviceX, 0, backW - bedroomBlockW, backH, scale));
  }

  return finalizeRooms(result);
}

function splitBand(rooms, x, y, w, h, scale, direction = 'horizontal') {
  if (!rooms.length || w <= 0 || h <= 0) return [];
  const totalArea = sumScaledArea(rooms, scale);

  const buildRectsByDirection = (dir) => {
    if (!totalArea || Number.isNaN(totalArea)) {
      const avg = dir === 'horizontal' ? w / rooms.length : h / rooms.length;
      return rooms.map((room, idx) => {
        if (dir === 'horizontal') return makeRoomRect(room, x + idx * avg, y, avg, h);
        return makeRoomRect(room, x, y + idx * avg, w, avg);
      });
    }

    const out = [];
    let cursor = dir === 'horizontal' ? x : y;
    const bound = dir === 'horizontal' ? x + w : y + h;
    rooms.forEach((room, idx) => {
      const last = idx === rooms.length - 1;
      const scaledArea = (room.targetArea || 8) * scale;
      const ratio = scaledArea / totalArea;

      let rw = w;
      let rh = h;
      if (dir === 'horizontal') {
        rw = last ? Math.max(0.3, bound - cursor) : Math.max(0.3, Math.min(w * ratio, bound - cursor - 0.3 * (rooms.length - idx - 1)));
        rh = h;
        out.push(makeRoomRect(room, cursor, y, rw, rh));
        cursor += rw;
      } else {
        rw = w;
        rh = last ? Math.max(0.3, bound - cursor) : Math.max(0.3, Math.min(h * ratio, bound - cursor - 0.3 * (rooms.length - idx - 1)));
        out.push(makeRoomRect(room, x, cursor, rw, rh));
        cursor += rh;
      }
    });
    return out;
  };

  const evaluateRects = (rects) => {
    let score = 0;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const src = rooms[i] || {};
      const rule = ROOM_RULES[src.type];
      if (!rule) continue;
      const shortSide = Math.min(r.w, r.h);
      const longSide = Math.max(r.w, r.h);
      const ar = longSide / Math.max(0.01, shortSide);
      if (shortSide < rule.minWidth) {
        score += (rule.minWidth - shortSide) * 20;
      }
      if (ar > rule.maxAspectRatio) {
        score += (ar - rule.maxAspectRatio) * 30;
      }
      // 对硬约束房型额外惩罚，逼迫切分远离细长条
      if (HARD_AR_ROOM_TYPES.has(src.type) && ar > 2) {
        score += (ar - 2) * 260;
      }
    }
    return score;
  };

  const minNeedHorizontal = rooms.reduce((s, room) => {
    const rule = ROOM_RULES[room.type] || {};
    const minW = Math.max(0.8, Number(rule.minWidth) || 0.9);
    const maxAR = Math.max(1.6, Number(rule.maxAspectRatio) || 3);
    const minArea = Math.max(0, Number(rule.minArea) || 0);
    const byAspect = Math.max(0.8, h / maxAR);
    const byArea = minArea > 0 ? (minArea / Math.max(0.6, h)) : 0;
    return s + Math.max(minW, byAspect, byArea);
  }, 0);
  const minNeedVertical = rooms.reduce((s, room) => {
    const rule = ROOM_RULES[room.type] || {};
    const minH = Math.max(0.8, Number(rule.minWidth) || 0.9);
    const maxAR = Math.max(1.6, Number(rule.maxAspectRatio) || 3);
    const minArea = Math.max(0, Number(rule.minArea) || 0);
    const byAspect = Math.max(0.8, w / maxAR);
    const byArea = minArea > 0 ? (minArea / Math.max(0.6, w)) : 0;
    return s + Math.max(minH, byAspect, byArea);
  }, 0);
  const horizontalFeasible = minNeedHorizontal <= w + 0.25;
  const verticalFeasible = minNeedVertical <= h + 0.25;

  const hRects = horizontalFeasible ? buildRectsByDirection('horizontal') : null;
  const vRects = verticalFeasible ? buildRectsByDirection('vertical') : null;

  if (hRects && !vRects) return hRects;
  if (vRects && !hRects) return vRects;
  if (!hRects && !vRects) return buildRectsByDirection(direction);

  const hScore = evaluateRects(hRects);
  const vScore = evaluateRects(vRects);
  const preferH = direction === 'horizontal';
  const chosen = (hScore + (preferH ? 0 : 0.35)) <= (vScore + (preferH ? 0.35 : 0)) ? hRects : vRects;
  return chosen;
}

function splitServiceRoomsByHardWidth(rooms, x, y, totalW, h, scale = 1) {
  if (!rooms.length || totalW <= 0 || h <= 0) return [];
  const safeH = Math.max(0.6, h);

  const req = rooms.map(room => {
    const rule = ROOM_RULES[room.type] || {};
    const minW = Math.max(0.9, Number(rule.minWidth) || 0.9);
    const maxAR = Math.max(1.6, Number(rule.maxAspectRatio) || 3);
    const minArea = Math.max(0, Number(rule.minArea) || 0);
    const wByAR = safeH / maxAR;
    const wByArea = minArea > 0 ? (minArea / safeH) : 0;
    const base = Math.max(minW, wByAR, wByArea);
    return { room, base, weight: Math.max(1, Number(room.targetArea) || minArea || 4) };
  });

  const sumBase = req.reduce((s, i) => s + i.base, 0);
  let widths = req.map(i => i.base);
  if (sumBase > totalW) {
    // 空间不足时按同比压缩，但尽量不低于0.9m；这类情况后续会触发硬约束告警
    const ratio = totalW / Math.max(0.001, sumBase);
    widths = widths.map(w => Math.max(0.9, w * ratio));
  } else {
    const extra = totalW - sumBase;
    const weightSum = req.reduce((s, i) => s + i.weight, 0);
    widths = widths.map((w, idx) => w + extra * (req[idx].weight / Math.max(0.001, weightSum)));
  }

  // 末项吸收四舍五入误差
  const curSum = widths.reduce((s, v) => s + v, 0);
  widths[widths.length - 1] = Math.max(0.9, widths[widths.length - 1] + (totalW - curSum));

  const out = [];
  let cursor = x;
  rooms.forEach((room, idx) => {
    const rw = idx === rooms.length - 1 ? Math.max(0.9, x + totalW - cursor) : Math.max(0.9, widths[idx]);
    out.push(makeRoomRect(room, cursor, y, rw, h));
    cursor += rw;
  });
  return out;
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

function isOpenPlanPair(typeA, typeB) {
  const a = String(typeA || '');
  const b = String(typeB || '');
  const openTypes = ['living_room', 'lounge', 'multi'];
  if (a === 'corridor' && b === 'corridor') return true;
  if (openTypes.includes(a) && openTypes.includes(b)) return true;
  return (a === 'corridor' && openTypes.includes(b)) ||
    (b === 'corridor' && openTypes.includes(a));
}

function resolveStairPlatformExitSides(room) {
  if (!room) return { platformSide: 'bottom', exitSide: 'top' };
  // 约定：长边为左右时，平台贴下短边，出口在上短边
  if (room.h >= room.w) return { platformSide: 'bottom', exitSide: 'top' };
  // 横向楼梯兜底：平台贴左短边，出口在右短边
  return { platformSide: 'left', exitSide: 'right' };
}

function isStairExitTargetType(type) {
  return ['living_room', 'lounge', 'multi', 'corridor', 'entrance'].includes(String(type || ''));
}

function isStairDesignatedOpenPair(roomA, sideA, roomB, sideB) {
  if (!roomA || !roomB) return false;
  if (roomA.type === 'stairs') {
    const { exitSide } = resolveStairPlatformExitSides(roomA);
    return sideA === exitSide && isStairExitTargetType(roomB.type);
  }
  if (roomB.type === 'stairs') {
    const { exitSide } = resolveStairPlatformExitSides(roomB);
    return sideB === exitSide && isStairExitTargetType(roomA.type);
  }
  return false;
}

function normalizeCirculationRooms(rooms, floor) {
  if (!Array.isArray(rooms) || rooms.length === 0) return rooms || [];
  // 统一策略：所有过道都转为客厅语义，避免“过道+客厅”重复空间标注
  const corridorRooms = rooms.filter(r => r.type === 'corridor');
  corridorRooms.forEach(c => {
    c.type = 'living_room';
    c.label = ROOM_RULES.living_room.label;
    c.color = ROOM_RULES.living_room.color;
    c._mergedFromCorridor = true;
  });

  return rooms;
}

function applySingleLivingLabelPolicy(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) return rooms || [];
  const livingRooms = rooms
    .map((r, idx) => ({ r, idx }))
    .filter(item => item.r.type === 'living_room');
  if (!livingRooms.length) return rooms;

  const totalArea = round2(livingRooms.reduce((sum, item) => sum + (item.r.area || 0), 0));
  const primary = [...livingRooms].sort((a, b) => (b.r.area || 0) - (a.r.area || 0))[0];

  livingRooms.forEach(item => {
    item.r.type = 'living_room';
    item.r.label = ROOM_RULES.living_room.label;
    item.r.color = ROOM_RULES.living_room.color;
    item.r._hideLivingLabel = item.idx !== primary.idx;
    item.r._livingSummaryArea = item.idx === primary.idx ? totalArea : null;
  });

  return rooms;
}

function generateDoorsByPriority(rooms, floorNumber = 1) {
  const isCirculationRoom = (room) =>
    room.type === 'corridor' ||
    room.type === 'living_room' ||
    room.type === 'lounge' ||
    room.type === 'multi' ||
    room.type === 'entrance';

  const edges = [];
  const tol = 0.06;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];

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

  const getOtherId = (edge, id) => (edge.a === id ? edge.b : edge.a);
  const getSideFor = (edge, id) => (edge.a === id ? edge.sideA : edge.sideB);
  const edgeKey = (edge) => `${Math.min(edge.a, edge.b)}-${Math.max(edge.a, edge.b)}`;
  const stairStateForEdge = (edge) => {
    const aRoom = rooms[edge.a];
    const bRoom = rooms[edge.b];
    if (aRoom?.type === 'stairs') {
      const { exitSide } = resolveStairPlatformExitSides(aRoom);
      return {
        hasStair: true,
        stairId: edge.a,
        stairSide: edge.sideA,
        exitSide,
        otherId: edge.b,
        other: bRoom,
        isDesignatedOpen: edge.sideA === exitSide && isStairExitTargetType(bRoom?.type)
      };
    }
    if (bRoom?.type === 'stairs') {
      const { exitSide } = resolveStairPlatformExitSides(bRoom);
      return {
        hasStair: true,
        stairId: edge.b,
        stairSide: edge.sideB,
        exitSide,
        otherId: edge.a,
        other: aRoom,
        isDesignatedOpen: edge.sideB === exitSide && isStairExitTargetType(aRoom?.type)
      };
    }
    return { hasStair: false, isDesignatedOpen: false };
  };
  const edgeRoomMap = new Map();
  edges.forEach(edge => edgeRoomMap.set(edgeKey(edge), [edge.a, edge.b]));
  const edgeOfRoom = new Map();
  for (let i = 0; i < rooms.length; i++) edgeOfRoom.set(i, []);
  edges.forEach(edge => {
    edgeOfRoom.get(edge.a)?.push(edge);
    edgeOfRoom.get(edge.b)?.push(edge);
  });

  const doorSpecs = [];
  const usedEdge = new Set();
  const addDoorFromEdge = (edge, roomId, opts = {}) => {
    const rA = rooms[edge.a];
    const rB = rooms[edge.b];
    if (rA && rB && isOpenPlanPair(rA.type, rB.type)) return;
    const stairState = stairStateForEdge(edge);
    if (stairState.hasStair && !stairState.isDesignatedOpen) return;
    const key = edgeKey(edge);
    if (usedEdge.has(key)) return;
    usedEdge.add(key);
    const fullSpanOpen = !!opts.fullSpanOpen;
    doorSpecs.push({
      edgeId: key,
      roomId,
      side: getSideFor(edge, roomId),
      mid: edge.mid,
      spanStart: fullSpanOpen ? edge.start : edge.start,
      spanEnd: fullSpanOpen ? edge.end : edge.end,
      terraceDoor: !!opts.terraceDoor,
      openingOnly: !!opts.openingOnly,
      fullSpanOpen
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

  rooms.forEach((room, roomId) => {
    if (room.type !== 'stairs') return;
    const { exitSide } = resolveStairPlatformExitSides(room);
    const exitEdges = (edgeOfRoom.get(roomId) || []).filter(edge => getSideFor(edge, roomId) === exitSide);
    let candidate = exitEdges.filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
      return other && isStairExitTargetType(other.type);
    });

    // 出口侧若不是交通核，优先把可转换空间提升为 corridor，确保楼梯上口合法
    if (!candidate.length) {
      const convertible = exitEdges
        .map(edge => ({ edge, other: rooms[getOtherId(edge, roomId)] }))
        .filter(item => item.other && !['stairs', 'terrace', 'kitchen', 'bathroom'].includes(item.other.type))
        .sort((a, b) => b.edge.overlap - a.edge.overlap);
      if (convertible.length) {
        const target = convertible[0].other;
        target.type = 'living_room';
        target.label = ROOM_RULES.living_room.label;
        target.color = ROOM_RULES.living_room.color;
        target._forcedByStairExit = true;
        candidate = [convertible[0].edge];
      }
    }

    const picked = pickBest(candidate, edge => {
      const other = rooms[getOtherId(edge, roomId)];
      const livingBonus = other && (other.type === 'living_room' || other.type === 'lounge') ? 40 : 0;
      const corridorBonus = other && other.type === 'corridor' ? 25 : 0;
      return edge.overlap + livingBonus + corridorBonus;
    });
    // 楼梯仅允许“平台对侧整边敞开”，其余三边禁止开洞
    if (picked) addDoorFromEdge(picked, roomId, { openingOnly: true, fullSpanOpen: true });
  });

  rooms.forEach((room, roomId) => {
    if (room.type !== 'terrace') return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
      return other && ['bedroom', 'lounge', 'living_room', 'multi', 'study'].includes(other.type);
    });
    const livingOptions = options.filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
      return other && (other.type === 'living_room' || other.type === 'lounge');
    });
    const bedroomOptions = options.filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
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

  rooms.forEach((room, roomId) => {
    if (room.type === 'corridor' || room.type === 'stairs' || room.type === 'terrace' || isCirculationRoom(room)) return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
      return other && isCirculationRoom(other);
    });
    const picked = pickBest(options, edge => edge.overlap);
    if (picked) addDoorFromEdge(picked, roomId);
  });

  const bedroomRooms = rooms
    .map((room, idx) => ({ room, idx }))
    .filter(item => item.room.type === 'bedroom');
  bedroomRooms.forEach(item => {
    const roomId = item.idx;
    const hasDoor = roomHasPassage(roomId);
    if (hasDoor) return;
    const preferredTypes = ['corridor', 'living_room', 'lounge', 'entrance', 'storage', 'bathroom'];
    let picked = null;
    for (const pt of preferredTypes) {
      const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = rooms[getOtherId(edge, roomId)];
        return other && other.type === pt;
      });
      if (options.length) {
        picked = pickBest(options, edge => edge.overlap);
        if (picked) break;
      }
    }
    if (!picked) {
      const fallback = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = rooms[getOtherId(edge, roomId)];
        return other && other.type !== 'stairs' && other.type !== 'terrace';
      });
      picked = pickBest(fallback, edge => edge.overlap);
    }
    if (picked) addDoorFromEdge(picked, roomId);
  });

  const bathroomRooms = rooms
    .map((room, idx) => ({ room, idx }))
    .filter(item => item.room.type === 'bathroom');
  bathroomRooms.forEach(item => {
    const roomId = item.idx;
    const hasDoor = roomHasPassage(roomId);
    if (hasDoor) return;

    const preferredTypes = ['living_room', 'lounge', 'corridor', 'bedroom', 'storage', 'kitchen'];
    let picked = null;
    for (const pt of preferredTypes) {
      const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = rooms[getOtherId(edge, roomId)];
        return other && other.type === pt;
      });
      if (options.length) {
        picked = pickBest(options, edge => edge.overlap);
        if (picked) break;
      }
    }

    if (!picked) {
      const fallback = (edgeOfRoom.get(roomId) || []).filter(edge => {
        const other = rooms[getOtherId(edge, roomId)];
        return other && other.type !== 'stairs' && other.type !== 'terrace';
      });
      picked = pickBest(fallback, edge => edge.overlap);
    }
    if (picked) addDoorFromEdge(picked, roomId);
  });

  rooms.forEach((room, roomId) => {
    if (room.type === 'stairs') return;
    if (isCirculationRoom(room)) return;
    if (roomHasPassage(roomId)) return;
    const options = (edgeOfRoom.get(roomId) || []).filter(edge => {
      const other = rooms[getOtherId(edge, roomId)];
      return other && other.type !== 'stairs';
    });
    const picked = pickBest(options, edge => {
      const other = rooms[getOtherId(edge, roomId)];
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

  return doorSpecs;
}

function syncUnifiedPlanDoors(result) {
  if (!result?.plan?.floors?.length || !result?.floorPlans?.length) return;
  result.plan.floors.forEach(floorModel => {
    const fp = result.floorPlans.find(p => p.floor === floorModel.index);
    if (!fp) return;
    const specs = generateDoorsByPriority(fp.rooms || [], floorModel.index);
    floorModel.doors = specs.map((d, idx) => {
      const [aStr, bStr] = String(d.edgeId).split('-');
      const a = Number(aStr);
      const b = Number(bStr);
      const toIdx = d.roomId === a ? b : a;
      const hostRoom = floorModel.rooms[d.roomId];
      const offsetBase = (d.side === 'left' || d.side === 'right') ? hostRoom?.y : hostRoom?.x;
      const openingWidth = Math.max(0.75, Math.min(1.1, (d.spanEnd - d.spanStart) * 0.75));
      return {
        id: `d-f${floorModel.index}-${idx + 1}`,
        floor: floorModel.index,
        from: hostRoom?.id || null,
        to: floorModel.rooms[toIdx]?.id || null,
        hostWallOf: hostRoom?.id || null,
        wallSide: d.side,
        offset: round2(Math.max(0, d.mid - (offsetBase || 0))),
        width: round2(openingWidth),
        swing: d.terraceDoor ? 'sliding' : (d.openingOnly ? 'none' : 'single')
      };
    });

    // 统一外门：一层默认入户门（front 中央），避免3D自行猜测
    if (floorModel.index === 1) {
      floorModel.doors = (floorModel.doors || []).filter(d => !String(d.id).startsWith('ext-main-'));
      floorModel.doors.push({
        id: `ext-main-f${floorModel.index}`,
        floor: floorModel.index,
        from: null,
        to: null,
        hostWallOf: null,
        wallSide: 'front',
        offset: round2((result.plan.building.length || 0) / 2),
        width: 1.35,
        swing: 'double'
      });
    }
  });
}

function syncUnifiedPlanWindows(result) {
  if (!result?.plan?.floors?.length || !result?.floorPlans?.length) return;
  const density = result?.config?.windowDensity || 'medium';
  const densityFactor = density === 'high' ? 1.35 : (density === 'low' ? 0.75 : 1);
  const eps = 0.08;
  const bLen = result.plan.building.length;
  const bWid = result.plan.building.width;

  const sideTouches = (r) => ({
    back: r.y <= eps,
    front: r.y + r.h >= bWid - eps,
    left: r.x <= eps,
    right: r.x + r.w >= bLen - eps
  });

  result.plan.floors.forEach(floorModel => {
    const fp = result.floorPlans.find(p => p.floor === floorModel.index);
    if (!fp) return;

    const windows = [];
    let idSeq = 1;
    (floorModel.rooms || []).forEach(room => {
      if (!room.windowsRequired || ['stairs', 'terrace', 'corridor'].includes(room.type)) return;
      const touch = sideTouches(room);
      const placeOnSide = (wallSide, spanStart, spanLen, hostLen) => {
        const countRaw = spanLen * densityFactor;
        const count = Math.max(1, Math.min(3, Math.floor(countRaw / 2.4) + 1));
        const seg = spanLen / count;
        for (let i = 0; i < count; i++) {
          const center = spanStart + (i + 0.5) * seg;
          const width = round2(clamp(seg * 0.42, 0.85, Math.min(1.6, spanLen * 0.7)));
          windows.push({
            id: `w-f${floorModel.index}-${idSeq++}`,
            floor: floorModel.index,
            room: room.id,
            wallSide,
            offset: round2(clamp(center, 0, hostLen)),
            width,
            sillHeight: 0.9,
            headHeight: round2(Math.min((result.config.floorHeight || 3.3) - 0.2, 2.25))
          });
        }
      };

      if (touch.front) placeOnSide('front', room.x, room.w, bLen);
      if (touch.back) placeOnSide('back', room.x, room.w, bLen);
      if (touch.left) placeOnSide('left', room.y, room.h, bWid);
      if (touch.right) placeOnSide('right', room.y, room.h, bWid);
    });

    floorModel.windows = windows;
  });
}

function renderPlan(floorPlans, floorNumber) {
  const plan = floorPlans.find(item => item.floor === floorNumber) || floorPlans[0];
  if (!plan) {
    els.planSvg.innerHTML = '';
    return;
  }
  // 渲染兜底：统一消除 corridor 语义，避免后续流程回写导致“过道”再次出现
  (plan.rooms || []).forEach(room => {
    if (room.type === 'corridor') {
      room.type = 'living_room';
      room.label = ROOM_RULES.living_room.label;
      room.color = ROOM_RULES.living_room.color;
      room._mergedFromCorridor = true;
    }
  });
  applySingleLivingLabelPolicy(plan.rooms || []);

  const svg = els.planSvg;
  const viewW = 1000;
  const viewH = 700;
  const padding = 56;
  const length = generatedState.config.length;
  const width = generatedState.config.width;
  const scale = Math.min((viewW - padding * 2) / length, (viewH - padding * 2) / width);
  const offsetX = (viewW - length * scale) / 2;
  const offsetY = (viewH - width * scale) / 2;
  const wallStroke = Math.max(1.9, Math.min(3.8, scale * 0.052));
  const roomStroke = Math.max(1.1, wallStroke * 0.35);
  const wallBandPx = Math.max(2.2, Math.min(6.8, scale * ((generatedState?.plan?.building?.wallThickness || 0.24) * 0.45)));
  const eps = 0.08;

  const getRoomPattern = (room) => {
    if (room.type === 'bathroom' || room.type === 'kitchen') return 'url(#tilePattern)';
    if (room.type === 'corridor' || room.type === 'stairs') return 'url(#stonePattern)';
    if (room.type === 'terrace') return 'url(#terracePattern)';
    return 'url(#woodPattern)';
  };

  const doorSpecs = generateDoorsByPriority(plan.rooms, plan.floor);
  const planFloorModel = (generatedState?.plan?.floors || []).find(f => f.index === plan.floor) || null;

  const buildInnerWallBands = () => {
    const bands = [];
    const seen = new Set();
    const tol = 0.06;
    const addBand = (key, markup) => {
      if (seen.has(key)) return;
      seen.add(key);
      bands.push(markup);
    };
    for (let i = 0; i < plan.rooms.length; i++) {
      for (let j = i + 1; j < plan.rooms.length; j++) {
        const a = plan.rooms[i];
        const b = plan.rooms[j];
        if (isOpenPlanPair(a.type, b.type)) continue;

        if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
          const xShared = Math.abs(a.x + a.w - b.x) < tol ? a.x + a.w : b.x + b.w;
          const aRight = Math.abs(a.x + a.w - b.x) < tol;
          const sideA = aRight ? 'right' : 'left';
          const sideB = aRight ? 'left' : 'right';
          if (isStairDesignatedOpenPair(a, sideA, b, sideB)) continue;
          const y1 = Math.max(a.y, b.y);
          const y2 = Math.min(a.y + a.h, b.y + b.h);
          if (y2 - y1 > 0.45) {
            const px = offsetX + xShared * scale - wallBandPx / 2;
            const py = offsetY + y1 * scale;
            const ph = (y2 - y1) * scale;
            const key = `v-${round2(xShared)}-${round2(y1)}-${round2(y2)}`;
            addBand(key, `<rect x="${px}" y="${py}" width="${wallBandPx}" height="${ph}" fill="#0f1318" />`);
          }
        }

        if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
          const yShared = Math.abs(a.y + a.h - b.y) < tol ? a.y + a.h : b.y + b.h;
          const aBottom = Math.abs(a.y + a.h - b.y) < tol;
          const sideA = aBottom ? 'bottom' : 'top';
          const sideB = aBottom ? 'top' : 'bottom';
          if (isStairDesignatedOpenPair(a, sideA, b, sideB)) continue;
          const x1 = Math.max(a.x, b.x);
          const x2 = Math.min(a.x + a.w, b.x + b.w);
          if (x2 - x1 > 0.45) {
            const px = offsetX + x1 * scale;
            const py = offsetY + yShared * scale - wallBandPx / 2;
            const pw = (x2 - x1) * scale;
            const key = `h-${round2(yShared)}-${round2(x1)}-${round2(x2)}`;
            addBand(key, `<rect x="${px}" y="${py}" width="${pw}" height="${wallBandPx}" fill="#0f1318" />`);
          }
        }
      }
    }
    return bands.join('');
  };

  const buildOpenPlanMasks = () => {
    const masks = [];
    const tol = 0.06;
    const maskThickness = Math.max(2.4, roomStroke * 1.45);
    for (let i = 0; i < plan.rooms.length; i++) {
      for (let j = i + 1; j < plan.rooms.length; j++) {
        const a = plan.rooms[i];
        const b = plan.rooms[j];
        const shouldOpen = (() => {
          if (isOpenPlanPair(a.type, b.type)) return true;
          if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
            const aRight = Math.abs(a.x + a.w - b.x) < tol;
            const sideA = aRight ? 'right' : 'left';
            const sideB = aRight ? 'left' : 'right';
            return isStairDesignatedOpenPair(a, sideA, b, sideB);
          }
          if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
            const aBottom = Math.abs(a.y + a.h - b.y) < tol;
            const sideA = aBottom ? 'bottom' : 'top';
            const sideB = aBottom ? 'top' : 'bottom';
            return isStairDesignatedOpenPair(a, sideA, b, sideB);
          }
          return false;
        })();
        if (!shouldOpen) continue;
        const maskFill = (a.type === 'corridor' || b.type === 'corridor') ? 'url(#stonePattern)' : 'url(#woodPattern)';

        if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
          const xShared = Math.abs(a.x + a.w - b.x) < tol ? a.x + a.w : b.x + b.w;
          const y1 = Math.max(a.y, b.y);
          const y2 = Math.min(a.y + a.h, b.y + b.h);
          if (y2 - y1 > 0.35) {
            const px = offsetX + xShared * scale - maskThickness / 2;
            const py = offsetY + y1 * scale;
            const ph = Math.max(1.5, (y2 - y1) * scale);
            masks.push(`<rect x="${px}" y="${py}" width="${maskThickness}" height="${ph}" fill="${maskFill}" />`);
          }
        }

        if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
          const yShared = Math.abs(a.y + a.h - b.y) < tol ? a.y + a.h : b.y + b.h;
          const x1 = Math.max(a.x, b.x);
          const x2 = Math.min(a.x + a.w, b.x + b.w);
          if (x2 - x1 > 0.35) {
            const px = offsetX + x1 * scale;
            const py = offsetY + yShared * scale - maskThickness / 2;
            const pw = Math.max(1.5, (x2 - x1) * scale);
            masks.push(`<rect x="${px}" y="${py}" width="${pw}" height="${maskThickness}" fill="${maskFill}" />`);
          }
        }
      }
    }
    return masks.join('');
  };

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

    // 露台整边玻璃门由专属露台立面渲染，普通门层不重复绘制
    if (door.terraceDoor) return '';
    // 楼梯出口整边敞开：不绘制门扇/白缝，直接依靠墙体逻辑留空
    if (door.fullSpanOpen) return '';

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

  const buildWindowOpenings = () => {
    let windows = planFloorModel?.windows || [];
    if (!windows.length) {
      const fallback = [];
      (plan.rooms || []).forEach(room => {
        if (!room || ['stairs', 'terrace'].includes(room.type)) return;
        if (room.y <= eps) {
          fallback.push({ wallSide: 'back', offset: room.x + room.w / 2, width: clamp(room.w * 0.38, 0.9, 1.8) });
        }
        if (room.y + room.h >= width - eps) {
          fallback.push({ wallSide: 'front', offset: room.x + room.w / 2, width: clamp(room.w * 0.38, 0.9, 1.8) });
        }
        if (room.x <= eps) {
          fallback.push({ wallSide: 'left', offset: room.y + room.h / 2, width: clamp(room.h * 0.38, 0.9, 1.8) });
        }
        if (room.x + room.w >= length - eps) {
          fallback.push({ wallSide: 'right', offset: room.y + room.h / 2, width: clamp(room.h * 0.38, 0.9, 1.8) });
        }
      });
      windows = fallback;
    }
    if (!windows.length) return '';

    const wallOpenW = Math.max(6.2, wallStroke * 2.35);
    const jambStroke = Math.max(1.0, roomStroke * 0.72);
    const centerStroke = Math.max(1.1, roomStroke * 0.78);
    const bg = '#f8f8f5';
    const xMin = offsetX + 1;
    const xMax = offsetX + length * scale - 1;
    const yMin = offsetY + 1;
    const yMax = offsetY + width * scale - 1;

    return windows.map(win => {
      const side = String(win.wallSide || '');
      const offset = Number(win.offset) || 0;
      const halfSpan = Math.max(6, Math.min(44, ((Number(win.width) || 1.1) * scale) / 2));

      if (side === 'front' || side === 'back') {
        const yWall = side === 'back' ? offsetY : offsetY + width * scale;
        let x1 = offsetX + offset * scale - halfSpan;
        let x2 = offsetX + offset * scale + halfSpan;
        x1 = clamp(x1, xMin, xMax);
        x2 = clamp(x2, xMin, xMax);
        if (x2 - x1 < 4) return '';
        const y0 = yWall - wallOpenW / 2;
        return `
          <g>
            <rect x="${x1}" y="${y0}" width="${x2 - x1}" height="${wallOpenW}" fill="${bg}" />
            <line x1="${x1}" y1="${y0}" x2="${x1}" y2="${y0 + wallOpenW}" stroke="#171b22" stroke-width="${jambStroke}" />
            <line x1="${x2}" y1="${y0}" x2="${x2}" y2="${y0 + wallOpenW}" stroke="#171b22" stroke-width="${jambStroke}" />
            <line x1="${x1 + 1}" y1="${yWall}" x2="${x2 - 1}" y2="${yWall}" stroke="#171b22" stroke-width="${centerStroke}" />
          </g>
        `;
      }

      if (side === 'left' || side === 'right') {
        const xWall = side === 'left' ? offsetX : offsetX + length * scale;
        let y1 = offsetY + offset * scale - halfSpan;
        let y2 = offsetY + offset * scale + halfSpan;
        y1 = clamp(y1, yMin, yMax);
        y2 = clamp(y2, yMin, yMax);
        if (y2 - y1 < 4) return '';
        const x0 = xWall - wallOpenW / 2;
        return `
          <g>
            <rect x="${x0}" y="${y1}" width="${wallOpenW}" height="${y2 - y1}" fill="${bg}" />
            <line x1="${x0}" y1="${y1}" x2="${x0 + wallOpenW}" y2="${y1}" stroke="#171b22" stroke-width="${jambStroke}" />
            <line x1="${x0}" y1="${y2}" x2="${x0 + wallOpenW}" y2="${y2}" stroke="#171b22" stroke-width="${jambStroke}" />
            <line x1="${xWall}" y1="${y1 + 1}" x2="${xWall}" y2="${y2 - 1}" stroke="#171b22" stroke-width="${centerStroke}" />
          </g>
        `;
      }

      return '';
    }).join('');
  };

  const makeTerraceFacadeMarkup = (room, x, y, w, h) => {
    if (room.type !== 'terrace') return '';
    const touchLeft = room.x <= eps;
    const touchRight = room.x + room.w >= length - eps;
    const touchTop = room.y <= eps;
    const touchBottom = room.y + room.h >= width - eps;
    // 露台角点必须优先由几何触边推断，避免 _corner 与实际坐标不一致时画错外墙边
    const cornerByGeom = touchLeft && touchTop ? 'tl'
      : touchRight && touchTop ? 'tr'
        : touchLeft && touchBottom ? 'bl'
          : touchRight && touchBottom ? 'br'
            : null;
    const corner = cornerByGeom || room._corner || null;
    if (!corner) return '';

    const railSides = corner === 'tl'
      ? ['top', 'left']
      : corner === 'tr'
        ? ['top', 'right']
        : corner === 'bl'
          ? ['bottom', 'left']
          : ['bottom', 'right'];
    const glassSide = (corner === 'tl' || corner === 'bl') ? 'right' : 'left';

    const maskW = Math.max(6.2, wallStroke * 1.95);
    const railStroke = Math.max(1.15, roomStroke * 0.65);
    const railGap = Math.max(3.1, roomStroke * 1.35);
    const postStroke = Math.max(0.95, railStroke * 0.92);

    const railSideMarkup = (side) => {
      if (side === 'top' || side === 'bottom') {
        const y0 = side === 'top' ? y : y + h;
        const y1 = y0 + (side === 'top' ? railGap : -railGap);
        const maskY = y0 - maskW / 2;
        const span = Math.max(4, w);
        const postCount = Math.max(4, Math.floor(span / 18));
        const dx = span / (postCount + 1);
        const posts = Array.from({ length: postCount }).map((_, i) => {
          const px = x + dx * (i + 1);
          return `<line x1="${px}" y1="${y0}" x2="${px}" y2="${y1}" stroke="#1c232c" stroke-width="${postStroke}" />`;
        }).join('');
        return `
          <rect x="${x}" y="${maskY}" width="${w}" height="${maskW}" fill="#f8f8f5" />
          <line x1="${x}" y1="${y0}" x2="${x + w}" y2="${y0}" stroke="#1c232c" stroke-width="${railStroke}" />
          <line x1="${x}" y1="${y1}" x2="${x + w}" y2="${y1}" stroke="#1c232c" stroke-width="${railStroke}" />
          ${posts}
        `;
      }
      const x0 = side === 'left' ? x : x + w;
      const x1 = x0 + (side === 'left' ? railGap : -railGap);
      const maskX = x0 - maskW / 2;
      const span = Math.max(4, h);
      const postCount = Math.max(4, Math.floor(span / 18));
      const dy = span / (postCount + 1);
      const posts = Array.from({ length: postCount }).map((_, i) => {
        const py = y + dy * (i + 1);
        return `<line x1="${x0}" y1="${py}" x2="${x1}" y2="${py}" stroke="#1c232c" stroke-width="${postStroke}" />`;
      }).join('');
      return `
        <rect x="${maskX}" y="${y}" width="${maskW}" height="${h}" fill="#f8f8f5" />
        <line x1="${x0}" y1="${y}" x2="${x0}" y2="${y + h}" stroke="#1c232c" stroke-width="${railStroke}" />
        <line x1="${x1}" y1="${y}" x2="${x1}" y2="${y + h}" stroke="#1c232c" stroke-width="${railStroke}" />
        ${posts}
      `;
    };

    const glassSideMarkup = (side) => {
      const slotW = Math.max(6.8, wallStroke * 2.1);
      const frameStroke = Math.max(1.05, roomStroke * 0.62);
      const mullionStroke = Math.max(1.1, roomStroke * 0.72);
      if (side === 'left' || side === 'right') {
        const x0 = side === 'left' ? x : x + w;
        const sx = x0 - slotW / 2;
        const innerX = x0 + (side === 'left' ? slotW * 0.24 : -slotW * 0.24);
        return `
          <rect x="${sx}" y="${y + 1}" width="${slotW}" height="${Math.max(2, h - 2)}" fill="#f7f7f5" stroke="#1a2028" stroke-width="${frameStroke}" />
          <line x1="${x0}" y1="${y + 1.5}" x2="${x0}" y2="${y + h - 1.5}" stroke="#1a2028" stroke-width="${mullionStroke}" />
          <line x1="${innerX}" y1="${y + 1.5}" x2="${innerX}" y2="${y + h - 1.5}" stroke="#1a2028" stroke-width="${mullionStroke}" />
        `;
      }
      const y0 = side === 'top' ? y : y + h;
      const sy = y0 - slotW / 2;
      const innerY = y0 + (side === 'top' ? slotW * 0.24 : -slotW * 0.24);
      return `
        <rect x="${x + 1}" y="${sy}" width="${Math.max(2, w - 2)}" height="${slotW}" fill="#f7f7f5" stroke="#1a2028" stroke-width="${frameStroke}" />
        <line x1="${x + 1.5}" y1="${y0}" x2="${x + w - 1.5}" y2="${y0}" stroke="#1a2028" stroke-width="${mullionStroke}" />
        <line x1="${x + 1.5}" y1="${innerY}" x2="${x + w - 1.5}" y2="${innerY}" stroke="#1a2028" stroke-width="${mullionStroke}" />
      `;
    };

    return `
      <g>
        ${railSides.map(railSideMarkup).join('')}
        ${glassSideMarkup(glassSide)}
      </g>
    `;
  };

  const makeStairsMarkup = (room, x, y, w, h) => {
    if (room.type !== 'stairs') return '';
    const inset = Math.max(4, Math.min(8, Math.min(w, h) * 0.055));
    const sx = x + inset;
    const sy = y + inset;
    const sw = Math.max(24, w - inset * 2);
    const sh = Math.max(28, h - inset * 2);
    const isVertical = sh >= sw;

    const stairGeom = room._stairGeom;
    if (stairGeom && stairGeom.bbox && Array.isArray(stairGeom.flights) && stairGeom.flights.length) {
      const bx = Number(stairGeom.bbox.x) || 0;
      const by = Number(stairGeom.bbox.y) || 0;
      const bw = Math.max(1, Number(stairGeom.bbox.width) || 1);
      const bh = Math.max(1, Number(stairGeom.bbox.height) || 1);
      const mapPt = (pt) => {
        const px = sx + ((pt[0] - bx) / bw) * sw;
        const py = sy + ((pt[1] - by) / bh) * sh;
        return [round2(px), round2(py)];
      };
      const flightLines = stairGeom.flights.map(f => {
        const ls = (f.step_polylines || []).map(line => {
          const [p1, p2] = line;
          const [x1, y1] = mapPt(p1);
          const [x2, y2] = mapPt(p2);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2b3038" stroke-width="1" />`;
        }).join('');
        const sxy = mapPt(f.start_xy || [bx, by]);
        const dir = String(f.direction || '');
        let ex = sxy[0], ey = sxy[1];
        const arrowLen = Math.max(18, Math.min(34, Math.min(sw, sh) * 0.2));
        if (dir.includes('north')) ey -= arrowLen;
        else if (dir.includes('south')) ey += arrowLen;
        else if (dir.includes('east')) ex += arrowLen;
        else ex -= arrowLen;
        return `
          ${ls}
          <line x1="${sxy[0]}" y1="${sxy[1]}" x2="${ex}" y2="${ey}" stroke="#1f2630" stroke-width="1.5" />
        `;
      }).join('');
      const platformPolys = (stairGeom.platforms || []).map(p => {
        const pts = (p.polygon || []).map(mapPt).map(q => `${q[0]},${q[1]}`).join(' ');
        return `<polygon points="${pts}" fill="#d7dce3" stroke="#626a75" stroke-width="1" />`;
      }).join('');
      const handrails = (stairGeom.handrails || []).map(hd => {
        const pts = (hd.polyline || []).map(mapPt);
        if (pts.length < 2) return '';
        return `<polyline points="${pts.map(q => `${q[0]},${q[1]}`).join(' ')}" fill="none" stroke="#2a313b" stroke-width="1.1" />`;
      }).join('');
      return `
        <g>
          <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#stonePattern)" stroke="#1c222b" stroke-width="1.1" />
          ${platformPolys}
          ${flightLines}
          ${handrails}
          <line x1="${sx + 2}" y1="${sy + sh * 0.56}" x2="${sx + sw - 2}" y2="${sy + sh * 0.68}" stroke="#5a606a" stroke-width="1.1" stroke-dasharray="6 4" />
          <text x="${sx + sw / 2}" y="${sy + sh / 2 + 3}" text-anchor="middle" font-size="11" fill="#2f3640">楼梯间</text>
        </g>
      `;
    }

    if (!isVertical) {
      return `
        <g>
          <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#stonePattern)" stroke="#1c222b" stroke-width="1.3" />
          <text x="${sx + sw / 2}" y="${sy + sh / 2 + 4}" text-anchor="middle" font-size="12" fill="#2f3640">楼梯间</text>
        </g>
      `;
    }

    // 双跑：左跑 + 中栏杆 + 右跑；中部留站台（不画踏步线）
    const railW = Math.max(5, Math.min(8, sw * 0.1));
    const runW = (sw - railW) / 2;
    const leftX = sx;
    const railX = sx + runW;
    const rightX = railX + railW;
    const platformH = Math.max(14, Math.min(22, sh * 0.27));
    const platformY = sy + sh - platformH;
    const landingY = sy + sh * 0.44;
    const landingH = Math.max(9, Math.min(14, sh * 0.11));

    const treadTop = [];
    const treadBottom = [];
    const topH = landingY - sy;
    const bottomH = Math.max(0, platformY - (landingY + landingH));
    const stepTop = Math.max(4, topH / Math.max(4, Math.floor(topH / 11)));
    const stepBottom = Math.max(4, bottomH / Math.max(4, Math.floor(bottomH / 11)));

    for (let yy = sy + stepTop; yy < landingY - 1; yy += stepTop) {
      treadTop.push(`<line x1="${leftX + 1}" y1="${yy}" x2="${leftX + runW - 1}" y2="${yy}" stroke="#2b3038" stroke-width="1" />`);
      treadTop.push(`<line x1="${rightX + 1}" y1="${yy}" x2="${rightX + runW - 1}" y2="${yy}" stroke="#2b3038" stroke-width="1" />`);
    }
    for (let yy = landingY + landingH + stepBottom; yy < platformY - 1; yy += stepBottom) {
      treadBottom.push(`<line x1="${leftX + 1}" y1="${yy}" x2="${leftX + runW - 1}" y2="${yy}" stroke="#2b3038" stroke-width="1" />`);
      treadBottom.push(`<line x1="${rightX + 1}" y1="${yy}" x2="${rightX + runW - 1}" y2="${yy}" stroke="#2b3038" stroke-width="1" />`);
    }

    const leftCenter = leftX + runW / 2;
    const rightCenter = rightX + runW / 2;

    // 上楼箭头：左跑中心线向上
    const upY0 = sy + sh * 0.84;
    const upY1 = landingY + landingH * 0.55;
    const upArrow = `
      <path d="M ${leftCenter} ${upY0} L ${leftCenter} ${upY1}" stroke="#222a33" stroke-width="1.6" fill="none" />
      <path d="M ${leftCenter} ${upY1} l -5 7 l 10 0 Z" fill="#222a33" />
      <text x="${leftCenter + 9}" y="${(upY0 + upY1) / 2}" font-size="10" fill="#222a33">UP</text>
    `;

    // 下楼箭头：右跑中心线向下到站台，再转到左跑并继续向下（与上楼箭头相对）
    const dnTop = sy + sh * 0.16;
    const dnToLanding = landingY + landingH * 0.45;
    const dnLeftEnd = sy + sh * 0.72;
    const downArrow = `
      <path d="M ${rightCenter} ${dnTop} L ${rightCenter} ${dnToLanding} L ${leftCenter} ${dnToLanding} L ${leftCenter} ${dnLeftEnd}" stroke="#222a33" stroke-width="1.5" fill="none" />
      <path d="M ${leftCenter} ${dnLeftEnd} l -5 -7 l 10 0 Z" fill="#222a33" />
      <text x="${rightCenter + 9}" y="${dnTop + 14}" font-size="10" fill="#222a33">DN</text>
    `;

    // 横剖切断线（斜线）
    const cutX1 = sx + 1.5;
    const cutY1 = platformY - 2;
    const cutX2 = sx + sw - 1.5;
    const cutY2 = cutY1 + sh * 0.12;

    return `
      <g>
        <rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#stonePattern)" stroke="#1c222b" stroke-width="1.1" />
        <rect x="${leftX}" y="${landingY}" width="${runW}" height="${landingH}" fill="#d7dce3" stroke="#626a75" stroke-width="1" />
        <rect x="${rightX}" y="${landingY}" width="${runW}" height="${landingH}" fill="#d7dce3" stroke="#626a75" stroke-width="1" />
        <rect x="${sx}" y="${platformY}" width="${sw}" height="${platformH}" fill="#d7dce3" stroke="#626a75" stroke-width="1" />
        <rect x="${railX}" y="${sy + 1}" width="${railW}" height="${sh - 2}" fill="#eef2f8" stroke="#2a313b" stroke-width="1.1" />
        ${treadTop.join('')}
        ${treadBottom.join('')}
        ${upArrow}
        ${downArrow}
        <line x1="${cutX1}" y1="${cutY1}" x2="${cutX2}" y2="${cutY2}" stroke="#5a606a" stroke-width="1.2" stroke-dasharray="6 4" />
        <text x="${sx + sw / 2}" y="${sy + sh / 2 + 3}" text-anchor="middle" font-size="11" fill="#2f3640">楼梯间</text>
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
    const labelLine2 = room.type === 'living_room' && Number.isFinite(room._livingSummaryArea)
      ? `${room._livingSummaryArea}㎡`
      : `${room.area}㎡`;
    const fontScale = Math.max(11, Math.min(18, Math.min(w, h) / 6.6));
    const suppressAutoFillLabel = !!room._autoFill && (room.area || 0) < 3.2;
    const suppressLivingDuplicate = room.type === 'living_room' && !!room._hideLivingLabel;
    const showDefaultLabel = room.type !== 'stairs' && !suppressAutoFillLabel && !suppressLivingDuplicate;
    const showArea = !suppressLivingDuplicate;
    const isOpenZone = ['living_room', 'lounge', 'multi'].includes(room.type);
    const rectStroke = isOpenZone ? 'none' : '#1a2028';
    const rectStrokeWidth = isOpenZone ? 0 : roomStroke;
    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${getRoomPattern(room)}" stroke="${rectStroke}" stroke-width="${rectStrokeWidth}" />
        ${makeStairsMarkup(room, x, y, w, h)}
        ${showDefaultLabel ? `<text x="${cx}" y="${cy - 6}" text-anchor="middle" class="room-label" style="font-size:${fontScale}px">${room.label}</text>` : ''}
        ${showArea ? (showDefaultLabel ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" class="room-area">${labelLine2}</text>` : `<text x="${cx}" y="${cy + 20}" text-anchor="middle" class="room-area">${labelLine2}</text>`) : ''}
      </g>
    `;
  }).join('');

  const terraceFacadeMarkup = plan.rooms.map(room => {
    const x = offsetX + room.x * scale;
    const y = offsetY + room.y * scale;
    const w = room.w * scale;
    const h = room.h * scale;
    return makeTerraceFacadeMarkup(room, x, y, w, h);
  }).join('');

  const doorMarkup = doorSpecs.map(item => makeDoorMarkup(item)).join('');
  const windowMarkup = buildWindowOpenings();

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
    <rect x="${offsetX - 2}" y="${offsetY - 2}" width="${length * scale + 4}" height="${width * scale + 4}" fill="#f8f8f5" stroke="#0f1318" stroke-width="${Math.max(3.2, wallStroke)}" />
    <text x="80" y="48" font-size="24" fill="#243241" font-weight="800">第 ${plan.floor} 层平面图</text>
    <text x="80" y="74" font-size="14" fill="#6b7785">建筑尺寸 ${length}m x ${width}m · 本层净面积 ${plan.usedArea}㎡</text>
    ${roomMarkup}
    ${buildInnerWallBands()}
    ${buildOpenPlanMasks()}
    ${windowMarkup}
    ${terraceFacadeMarkup}
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
  const shellOpenings = buildWallOpenings(cfg, result.floorPlans, terraceSpecs, result.plan || null);

  const bodyHeight = cfg.floors * cfg.floorHeight;
  addExteriorShell(group, cfg, preset, terraceSpecs, shellOpenings);
  addInteriorPreview(group, cfg, result.floorPlans, result.plan || null);
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

  const topTerraceSpecRaw = getTerraceSpecForFloor(terraceSpecs, cfg.floors);
  const topTerraceSpec = topTerraceSpecRaw?.cuttable ? topTerraceSpecRaw : null;
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
  const eps = 0.08;
  const inferCorner = (x1, x2, y1, y2, fallback = '') => {
    const touchLeft = x1 <= eps;
    const touchRight = x2 >= cfg.length - eps;
    // 2D平面坐标系中：y=0 在上侧，y=width 在下侧
    // 之前这里把 top/bottom 反了，会导致露台角点判定错误，进而在3D误裁整面外墙。
    const touchTop = y1 <= eps;
    const touchBottom = y2 >= cfg.width - eps;
    if (touchLeft && touchTop) return 'tl';
    if (touchRight && touchTop) return 'tr';
    if (touchLeft && touchBottom) return 'bl';
    if (touchRight && touchBottom) return 'br';
    // 仅当几何无法稳定判定时，才回退到已有标记
    if (['tl', 'tr', 'bl', 'br'].includes(fallback)) return fallback;
    return null;
  };

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
    // 优先使用几何真实触边结果；_corner 仅作兜底
    const cornerByGeom = inferCorner(x1, x2, y1, y2, '');
    const corner = cornerByGeom || inferCorner(x1, x2, y1, y2, terrace._corner);
    const cuttable = Boolean(corner);

    specs.push({
      floor: plan.floor,
      x1,
      x2,
      y1,
      y2,
      corner: corner || null,
      cuttable,
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
  // 内侧围护：两道内墙都保留，仅在一道墙开单门洞
  const mkFullSpanOpening = (span) => {
    if (span <= 0.2) return [];
    const sideGap = 0.04;
    return [{ u1: sideGap, u2: Math.max(sideGap + 0.1, span - sideGap), v1: 0.06, v2: Math.max(0.12, h - 0.06) }];
  };
  // 为了与3D露台玻璃门表现保持一致，内侧门洞统一开在X向内墙
  const openOnX = true;
  const innerXOpenings = openOnX ? mkFullSpanOpening(td) : [];
  const innerZOpenings = [];

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

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, innerZOpenings, wallMat);
    innerZWall.position.set(-cfg.length / 2 + tw / 2, y, -cfg.width / 2 + terrace.y2 - wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'tr') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(cfg.length / 2 - terrace.x1 + wallThickness / 2, y, -cfg.width / 2 + td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, innerZOpenings, wallMat);
    innerZWall.position.set(cfg.length / 2 - tw / 2, y, -cfg.width / 2 + terrace.y2 - wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'bl') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(-cfg.length / 2 + terrace.x2 - wallThickness / 2, y, cfg.width / 2 - td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, innerZOpenings, wallMat);
    innerZWall.position.set(-cfg.length / 2 + tw / 2, y, cfg.width / 2 - terrace.y1 + wallThickness / 2);
    group.add(innerZWall);
  } else if (corner === 'br') {
    const innerXWall = createWallPanelWithOpenings(td, h, wallThickness, innerXOpenings, wallMat);
    innerXWall.position.set(cfg.length / 2 - terrace.x1 + wallThickness / 2, y, cfg.width / 2 - td / 2);
    innerXWall.rotation.y = Math.PI / 2;
    group.add(innerXWall);

    const innerZWall = createWallPanelWithOpenings(tw, h, wallThickness, innerZOpenings, wallMat);
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

    if (terrace?.cuttable) {
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

    if (!terrace?.cuttable) {
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

function buildWallOpenings(cfg, floorPlans = [], terraceSpecs = [], planModel = null) {
  const openings = { front: [], back: [], left: [], right: [] };
  const winH = Math.max(1.05, Math.min(1.35, cfg.floorHeight * 0.36));
  const winCenter = cfg.floorHeight * 0.56;
  const winV1 = Math.max(0.25, winCenter - winH / 2);
  const winV2 = Math.min(cfg.floorHeight - 0.22, winCenter + winH / 2);
  const doorW = 1.35;
  const doorH = Math.min(2.25, cfg.floorHeight - 0.15);
  const eps = 0.08;

  // 优先读取 unified plan openings（阶段5：2D/3D同源）；缺失时回退旧逻辑
  if (planModel?.floors?.length) {
    for (let floor = 0; floor < cfg.floors; floor++) {
      const front = [];
      const back = [];
      const left = [];
      const right = [];
      const floorIndex = floor + 1;
      const pf = (planModel.floors || []).find(f => f.index === floorIndex);

      const pushBySide = (side, item) => {
        const list = side === 'front' ? front : side === 'back' ? back : side === 'left' ? left : right;
        if (!list) return;
        pushOpening(list, item, (side === 'front' || side === 'back') ? cfg.length : cfg.width, cfg.floorHeight);
      };

      (pf?.windows || []).forEach(w => {
        const side = w.wallSide;
        if (!['front', 'back', 'left', 'right'].includes(side)) return;
        const spanMax = (side === 'front' || side === 'back') ? cfg.length : cfg.width;
        const center = clamp(Number(w.offset) || 0, 0, spanMax);
        const half = clamp((Number(w.width) || 1.1) / 2, 0.2, 1.2);
        const v1 = clamp(Number(w.sillHeight) || 0.9, 0.2, cfg.floorHeight - 0.8);
        const v2 = clamp(Number(w.headHeight) || Math.min(cfg.floorHeight - 0.2, 2.2), v1 + 0.45, cfg.floorHeight - 0.1);
        pushBySide(side, { u1: center - half, u2: center + half, v1, v2, kind: 'window' });
      });

      (pf?.doors || []).forEach(d => {
        const side = d.wallSide;
        const isExterior = ['front', 'back', 'left', 'right'].includes(side) && (!d.from || !d.to);
        if (!isExterior) return;
        const spanMax = (side === 'front' || side === 'back') ? cfg.length : cfg.width;
        const center = clamp(Number(d.offset) || 0, 0, spanMax);
        const half = clamp((Number(d.width) || doorW) / 2, 0.4, 1.0);
        pushBySide(side, { u1: center - half, u2: center + half, v1: 0.02, v2: doorH, kind: 'door' });
      });

      // 若统一模型暂无外门，保留一层默认入户门兜底
      if (floor === 0 && front.filter(o => (o.kind || 'window') === 'door').length === 0) {
        const center = cfg.length / 2;
        pushOpening(front, { u1: center - doorW / 2, u2: center + doorW / 2, v1: 0.02, v2: doorH, kind: 'door' }, cfg.length, cfg.floorHeight);
      }

      const terrace = getTerraceSpecForFloor(terraceSpecs, floorIndex);
      if (terrace?.cuttable) {
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

      const sortByU = arr => arr.sort((a, b) => a.u1 - b.u1);
      openings.front.push(sortByU(front));
      openings.back.push(sortByU(back));
      openings.left.push(sortByU(left));
      openings.right.push(sortByU(right));
    }
    return openings;
  }

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
    if (terrace?.cuttable) {
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

function addInteriorPreview(group, cfg, floorPlans = [], planModel = null) {
  const floorMatByType = {
    living_room: 0xe8e2d7,
    lounge: 0xe8e2d7,
    bedroom: 0xece7de,
    study: 0xe6e2d7,
    dining: 0xe3ddd2,
    kitchen: 0xe0ddd7,
    bathroom: 0xd8dde3,
    storage: 0xe4dfd8,
    hot_water_room: 0xe8ddd1,
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

  const projectDoorGuides = (planFloor) => {
    if (!planFloor?.doors?.length || !planFloor?.rooms?.length) return [];
    const roomById = new Map((planFloor.rooms || []).map(r => [r.id, r]));
    const guides = [];
    (planFloor.doors || []).forEach(d => {
      const host = roomById.get(d.hostWallOf || d.from || '');
      if (!host) return;
      const side = d.wallSide;
      const width = clamp(Number(d.width) || 0.85, 0.7, 1.3);
      const half = width / 2;
      if (side === 'left' || side === 'right') {
        const x = side === 'left' ? host.x : host.x + host.w;
        const yMid = host.y + (Number(d.offset) || 0);
        guides.push({
          dir: 'v',
          line: x,
          a: yMid - half,
          b: yMid + half,
          swing: d.swing || 'single'
        });
      } else if (side === 'top' || side === 'bottom') {
        const y = side === 'top' ? host.y : host.y + host.h;
        const xMid = host.x + (Number(d.offset) || 0);
        guides.push({
          dir: 'h',
          line: y,
          a: xMid - half,
          b: xMid + half,
          swing: d.swing || 'single'
        });
      }
    });
    return guides;
  };

  (floorPlans || []).forEach(plan => {
    const yBase = (plan.floor - 1) * cfg.floorHeight + 0.02;
    const rooms = (plan.rooms || []).filter(r => r.type !== 'terrace');
    rooms.forEach(room => addFloorPatch(room, yBase));
    const planFloor = (planModel?.floors || []).find(f => f.index === plan.floor) || null;
    const doorGuides = projectDoorGuides(planFloor);

    const segmentMap = new Map();
    const putSeg = (key, seg) => {
      if (!segmentMap.has(key)) segmentMap.set(key, seg);
    };

    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        if (isOpenPlanPair(a.type, b.type)) continue;

        if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
          const aRight = Math.abs(a.x + a.w - b.x) < eps;
          const sideA = aRight ? 'right' : 'left';
          const sideB = aRight ? 'left' : 'right';
          if (isStairDesignatedOpenPair(a, sideA, b, sideB)) continue;
          const xShared = Math.abs(a.x + a.w - b.x) < eps ? a.x + a.w : b.x + b.w;
          const y1 = Math.max(a.y, b.y);
          const y2 = Math.min(a.y + a.h, b.y + b.h);
          if (y2 - y1 > 0.7 && xShared > eps && xShared < cfg.length - eps) {
            putSeg(`v-${round2(xShared)}-${round2(y1)}-${round2(y2)}`, { dir: 'v', x: xShared, y1, y2 });
          }
        }

        if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) {
          const aBottom = Math.abs(a.y + a.h - b.y) < eps;
          const sideA = aBottom ? 'bottom' : 'top';
          const sideB = aBottom ? 'top' : 'bottom';
          if (isStairDesignatedOpenPair(a, sideA, b, sideB)) continue;
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

    const pickOpeningForSegment = (seg) => {
      const lineTol = 0.08;
      const candidates = doorGuides.filter(g => {
        if (g.dir !== seg.dir) return false;
        if (Math.abs(g.line - (seg.dir === 'v' ? seg.x : seg.y)) > lineTol) return false;
        const s0 = seg.dir === 'v' ? seg.y1 : seg.x1;
        const s1 = seg.dir === 'v' ? seg.y2 : seg.x2;
        const ov = Math.min(s1, g.b) - Math.max(s0, g.a);
        return ov > 0.2;
      });
      if (!candidates.length) return null;
      candidates.sort((a, b) => (b.b - b.a) - (a.b - a.a));
      const best = candidates[0];
      const seg0 = seg.dir === 'v' ? seg.y1 : seg.x1;
      const seg1 = seg.dir === 'v' ? seg.y2 : seg.x2;
      const a = clamp(best.a, seg0 + 0.05, seg1 - 0.05);
      const b = clamp(best.b, seg0 + 0.05, seg1 - 0.05);
      if (b - a < 0.5) return null;
      return { a, b, swing: best.swing };
    };

    segmentMap.forEach(seg => {
      if (seg.dir === 'v') {
        const totalLen = seg.y2 - seg.y1;
        if (totalLen > 1.3) {
          const explicit = pickOpeningForSegment(seg);
          const mid = explicit ? (explicit.a + explicit.b) / 2 : (seg.y1 + seg.y2) / 2;
          const dHalf = explicit
            ? Math.min((explicit.b - explicit.a) / 2, totalLen * 0.42)
            : Math.min(doorW / 2, totalLen * 0.3);
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
          // 门扇（swing=none 时只留洞口）
          const openingOnly = explicit && explicit.swing === 'none';
          if (!openingOnly) {
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(wallT * 0.6, doorH, doorW / 2 - 0.02), doorLeafMat);
            const leafGroup = new THREE.Group();
            leafGroup.position.set(-cfg.length / 2 + seg.x, yBase + doorH / 2 + 0.04, -cfg.width / 2 + mid - doorW / 4 + 0.01);
            leaf.position.set(0, 0, doorW / 4 - 0.01);
            leafGroup.add(leaf);
            leafGroup.rotation.y = 0.25;
            group.add(leafGroup);
          }
        } else {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, Math.max(0.2, totalLen)), interiorWallMat);
          wall.position.set(-cfg.length / 2 + seg.x, yBase + wallH / 2, -cfg.width / 2 + (seg.y1 + seg.y2) / 2);
          group.add(wall);
        }
      } else {
        const totalLen = seg.x2 - seg.x1;
        if (totalLen > 1.3) {
          const explicit = pickOpeningForSegment(seg);
          const mid = explicit ? (explicit.a + explicit.b) / 2 : (seg.x1 + seg.x2) / 2;
          const dHalf = explicit
            ? Math.min((explicit.b - explicit.a) / 2, totalLen * 0.42)
            : Math.min(doorW / 2, totalLen * 0.3);
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
          const openingOnly = explicit && explicit.swing === 'none';
          if (!openingOnly) {
            const leaf = new THREE.Mesh(new THREE.BoxGeometry(doorW / 2 - 0.02, doorH, wallT * 0.6), doorLeafMat);
            const leafGroup = new THREE.Group();
            leafGroup.position.set(-cfg.length / 2 + mid - doorW / 4 + 0.01, yBase + doorH / 2 + 0.04, -cfg.width / 2 + seg.y);
            leaf.position.set(doorW / 4 - 0.01, 0, 0);
            leafGroup.add(leaf);
            leafGroup.rotation.y = -0.25;
            group.add(leafGroup);
          }
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
  let style = cfg.balconyStyle || 'railing';
  // 用户选择 random 时，默认回落到带栏杆方案，避免出现“露台无栏杆”的观感回退
  if (style === 'random') style = 'railing';
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

  const edgeDefsByCorner = (corner, spec) => {
    if (corner === 'tl') return [
      { kind: 'h', z: spec.zMin + 0.012, x1: spec.xMin, x2: spec.xMax },
      { kind: 'v', x: spec.xMin + 0.012, z1: spec.zMin, z2: spec.zMax }
    ];
    if (corner === 'tr') return [
      { kind: 'h', z: spec.zMin + 0.012, x1: spec.xMin, x2: spec.xMax },
      { kind: 'v', x: spec.xMax - 0.012, z1: spec.zMin, z2: spec.zMax }
    ];
    if (corner === 'bl') return [
      { kind: 'h', z: spec.zMax - 0.012, x1: spec.xMin, x2: spec.xMax },
      { kind: 'v', x: spec.xMin + 0.012, z1: spec.zMin, z2: spec.zMax }
    ];
    return [
      { kind: 'h', z: spec.zMax - 0.012, x1: spec.xMin, x2: spec.xMax },
      { kind: 'v', x: spec.xMax - 0.012, z1: spec.zMin, z2: spec.zMax }
    ];
  };

  (terraceSpecs || []).forEach(spec => {
    const level = spec.floor;
    if (level < 2 || !spec.cuttable) return;
    const slabY = (level - 1) * cfg.floorHeight + slabThickness / 2 + 0.01;
    const width = Math.max(0.5, spec.xMax - spec.xMin);
    const depth = Math.max(0.5, spec.zMax - spec.zMin);
    const xCenter = (spec.xMin + spec.xMax) / 2;
    const zCenter = (spec.zMin + spec.zMax) / 2;
    const corner = spec.corner || 'tl';
    const edges = edgeDefsByCorner(corner, spec);

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width - 0.02, slabThickness, depth - 0.02),
      new THREE.MeshStandardMaterial({ color: 0xdbd9d2, roughness: 0.9, metalness: 0.02 })
    );
    slab.position.set(xCenter, slabY, zCenter);
    group.add(slab);

    if (style === 'none') return;

    if (style === 'glass') {
      edges.forEach(e => {
        if (e.kind === 'h') {
          const span = Math.max(0.2, e.x2 - e.x1);
          const cx = (e.x1 + e.x2) / 2;
          const topRail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.04, 0.045), railMat);
          topRail.position.set(cx, slabY + railHeight, e.z);
          group.add(topRail);
          const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.16, span - 0.04), railHeight - 0.06, 0.012), glassMat);
          glass.position.set(cx, slabY + railHeight / 2 + 0.02, e.z);
          group.add(glass);
        } else {
          const span = Math.max(0.2, e.z2 - e.z1);
          const cz = (e.z1 + e.z2) / 2;
          const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, span), railMat);
          topRail.position.set(e.x, slabY + railHeight, cz);
          group.add(topRail);
          const glass = new THREE.Mesh(new THREE.BoxGeometry(0.012, railHeight - 0.06, Math.max(0.16, span - 0.04)), glassMat);
          glass.position.set(e.x, slabY + railHeight / 2 + 0.02, cz);
          group.add(glass);
        }
      });

      const postH = railHeight - 0.02;
      const postPts = corner === 'tl'
        ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012]]
        : corner === 'tr'
          ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]]
          : corner === 'bl'
            ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]]
            : [[spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]];
      postPts.forEach(([px, pz]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, postH, 0.03), postMat);
        post.position.set(px, slabY + postH / 2, pz);
        group.add(post);
      });
      return;
    }

    // railing
    edges.forEach(e => {
      if (e.kind === 'h') {
        const span = Math.max(0.2, e.x2 - e.x1);
        const cx = (e.x1 + e.x2) / 2;
        const topRail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.04, 0.045), railMat);
        topRail.position.set(cx, slabY + railHeight, e.z);
        group.add(topRail);
        const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.03, 0.04), railMat);
        bottomRail.position.set(cx, slabY + railBottomY, e.z);
        group.add(bottomRail);
        addRailBalustersLine(e.x1 + 0.03, e.z, e.x2 - 0.03, e.z, slabY);
      } else {
        const span = Math.max(0.2, e.z2 - e.z1);
        const cz = (e.z1 + e.z2) / 2;
        const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, span), railMat);
        topRail.position.set(e.x, slabY + railHeight, cz);
        group.add(topRail);
        const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, span), railMat);
        bottomRail.position.set(e.x, slabY + railBottomY, cz);
        group.add(bottomRail);
        addRailBalustersLine(e.x, e.z1 + 0.03, e.x, e.z2 - 0.03, slabY);
      }
    });

    const postH = railHeight - 0.02;
    const postPts = corner === 'tl'
      ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012]]
      : corner === 'tr'
        ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]]
        : corner === 'bl'
          ? [[spec.xMin + 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]]
          : [[spec.xMax - 0.012, spec.zMin + 0.012], [spec.xMin + 0.012, spec.zMax - 0.012], [spec.xMax - 0.012, spec.zMax - 0.012]];
    postPts.forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, postH, 0.03), postMat);
      post.position.set(px, slabY + postH / 2, pz);
      group.add(post);
    });
  });
}

function addBalconyDoors(group, cfg, preset, terraceSpecs = []) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65, metalness: 0.04 });
  const mullionMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.5, metalness: 0.18 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfd7e6,
    roughness: 0.1,
    metalness: 0.12,
    transparent: true,
    opacity: 0.24,
    transmission: 0.82,
    thickness: 0.02,
    depthWrite: false,
    ior: 1.5
  });
  const frameH = Math.max(2.2, cfg.floorHeight - 0.14);
  const frameDepth = 0.08;
  const frameThick = 0.04;

  (terraceSpecs || []).forEach(spec => {
    if (!spec.cuttable || spec.floor < 2) return;
    const level = spec.floor;
    const corner = spec.corner || 'tl';
    const doorOnRightSide = corner === 'tl' || corner === 'bl';
    const xWall = doorOnRightSide ? spec.xMax - 0.11 : spec.xMin + 0.11;
    const zCenter = (spec.zMin + spec.zMax) / 2;
    const maxSpan = Math.max(0.8, (spec.zMax - spec.zMin) - 0.08);
    const doorSpan = maxSpan;
    const y = (level - 1) * cfg.floorHeight + frameH / 2 + 0.06;
    const sign = doorOnRightSide ? 1 : -1;
    const frameX = xWall + sign * 0.012;

    // 外框
    const top = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, frameThick, doorSpan + frameThick * 2), frameMat);
    top.position.set(frameX, y + frameH / 2 + frameThick / 2, zCenter);
    group.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, frameThick, doorSpan + frameThick * 2), frameMat);
    bottom.position.set(frameX, y - frameH / 2 - frameThick / 2, zCenter);
    group.add(bottom);
    const left = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, frameH, frameThick), frameMat);
    left.position.set(frameX, y, zCenter - doorSpan / 2 - frameThick / 2);
    group.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(frameDepth, frameH, frameThick), frameMat);
    right.position.set(frameX, y, zCenter + doorSpan / 2 + frameThick / 2);
    group.add(right);

    // 整面玻璃
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, Math.max(0.1, frameH - frameThick * 0.8), Math.max(0.1, doorSpan - frameThick * 0.8)),
      glassMat
    );
    glass.position.set(frameX + sign * 0.01, y, zCenter);
    group.add(glass);

    // 推拉门中梃（中心分缝）
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.008, frameH - frameThick * 0.5, 0.018), mullionMat);
    mid.position.set(frameX + sign * 0.012, y, zCenter);
    group.add(mid);
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
  els.length.value = randomBetween(7, 15, 0.5);
  els.width.value = randomBetween(6, 13, 0.5);
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
  const f1Bed = randomChoice([2, 2, 3]);
  setInput('f1_bedroom', f1Bed);
  setInput('f1_kitchen', 1);
  setInput('f1_bathroom', f1Bed === 2 ? 2 : 1);

  setInput('f2_living', 1);
  const f2Bed = randomChoice([2, 3, 3, 4]);
  setInput('f2_bedroom', f2Bed);
  setInput('f2_bathroom', f2Bed === 4 ? 1 : randomChoice([1, 1, 2]));
  setInput('f2_terrace', 1);
  setInput('f2_storage', 1);

  setInput('f3_living', 1);
  const f3Bed = randomChoice([2, 3, 3, 4]);
  setInput('f3_bedroom', f3Bed);
  setInput('f3_bathroom', f3Bed === 4 ? 1 : randomChoice([1, 1, 2]));
  setInput('f3_terrace', 1);
  setInput('f3_hot_water_room', 1);
  syncProgramInputs();

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
    unified_plan: generatedState.plan || null,
    unified_plan_validation: generatedState.planValidation || null,
    unified_plan_score: generatedState.planScore ?? null,
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
