/**
 * 建筑组装器 - Building Assembler
 * 实现类似明日之后的房屋搭建功能
 */

// ==========================================
// 组件定义和配置
// ==========================================
const COMPONENT_CONFIG = {
  // 基础结构
  foundation: {
    name: '地基',
    size: [3, 0.35, 3],
    snapToGrid: true,
    allowStack: true,
    material: 'concrete',
    cost: 560,
    category: 'structure'
  },
  floor: {
    name: '地板',
    size: [3, 0.15, 3],
    snapToGrid: true,
    allowStack: true,
    material: 'wood',
    cost: 300,
    category: 'structure'
  },
  wall: {
    name: '墙体',
    size: [3, 3, 0.2],
    snapToGrid: true,
    allowStack: false,
    material: 'brick',
    cost: 400,
    category: 'structure'
  },
  wall_window: {
    name: '窗户墙',
    size: [3, 3, 0.2],
    snapToGrid: true,
    allowStack: false,
    material: 'brick',
    cost: 500,
    category: 'structure',
    hasWindow: true
  },
  wall_door: {
    name: '门框墙',
    size: [3, 3, 0.2],
    snapToGrid: true,
    allowStack: false,
    material: 'brick',
    cost: 450,
    category: 'structure',
    hasDoor: true
  },
  stairs: {
    name: '楼梯',
    size: [1.6, 3, 5.2],
    snapToGrid: true,
    allowStack: false,
    material: 'concrete',
    cost: 600,
    category: 'structure'
  },

  // 屋顶
  roof_flat: {
    name: '平屋顶',
    size: [3, 0.2, 3],
    snapToGrid: true,
    allowStack: false,
    material: 'concrete',
    cost: 400,
    category: 'roof'
  },
  roof_gable: {
    name: '人字顶',
    size: [3, 1.5, 3],
    snapToGrid: true,
    allowStack: false,
    material: 'tile',
    cost: 600,
    category: 'roof',
    shape: 'gable'
  },
  roof_pyramid: {
    name: '尖顶',
    size: [3, 2, 3],
    snapToGrid: true,
    allowStack: false,
    material: 'tile',
    cost: 700,
    category: 'roof',
    shape: 'pyramid'
  },

  // 装饰
  fence: {
    name: '围栏',
    size: [3, 1.2, 0.1],
    snapToGrid: true,
    allowStack: false,
    material: 'wood',
    cost: 200,
    category: 'decoration'
  },
  column: {
    name: '柱子',
    size: [0.4, 3, 0.4],
    snapToGrid: true,
    allowStack: false,
    material: 'concrete',
    cost: 300,
    category: 'decoration'
  },
  balcony: {
    name: '阳台',
    size: [3, 0.1, 1],
    snapToGrid: true,
    allowStack: false,
    material: 'stone',
    cost: 800,
    category: 'decoration'
  }
};

// 材质配置
const MATERIAL_CONFIG = {
  concrete: { color: 0x8a8a8a, roughness: 0.9, metalness: 0.1, name: '混凝土' },
  brick: { color: 0xc4745a, roughness: 0.8, metalness: 0.0, name: '红砖' },
  wood: { color: 0x8b7355, roughness: 0.7, metalness: 0.0, name: '木材' },
  tile: { color: 0x4a6741, roughness: 0.6, metalness: 0.1, name: '青瓦' },
  stone: { color: 0x6b6b6b, roughness: 0.9, metalness: 0.0, name: '石材' }
};

// ==========================================
// 全局变量
// ==========================================
let scene, camera, renderer, controls;
let raycaster, mouse;
let gridHelper, plane;
let drawPlane;
let placedComponents = [];
let selectedComponent = null;
let currentTool = null;
let currentMaterial = 'concrete';
let currentLevel = 1;
let currentRotation = 0;
let stairHeight = 3;
let roofHeight = 3.5;
let snapToGrid = true;
let isDragging = false;
let dragObject = null;
let dragOffset = new THREE.Vector3();
let editorSnapshot = null;

// 预览相关
let previewMesh = null;
let isDrawingFloor = false;
let floorStartPoint = null;
let floorPreviewMesh = null;
let floorPreviewKey = '';
let dimensionReadoutKey = '';

// 网格大小 - 改为0.5米，让组件可以更紧密放置
const GRID_SIZE = 0.5;

// 目标建筑信息
let targetCode = '';
let targetSpace = 'current';
let targetName = '';

// 历史记录用于撤销
let history = [];
const MAX_HISTORY = 20;

// ==========================================
// 初始化
// ==========================================
function init() {
  console.log('=== 初始化开始 ===');
  
  try {
    // 解析URL参数
    parseUrlParams();
    console.log('URL参数解析完成');

    // 初始化Three.js场景
    initThreeJS();
    console.log('Three.js场景初始化完成');

    // 初始化事件监听
    initEvents();
    console.log('事件监听初始化完成');

    // 更新UI
    updateUI();
    console.log('UI更新完成');

    showToast('建筑组装器已就绪，选择组件开始搭建');
    console.log('=== 初始化完成 ===');
  } catch (error) {
    console.error('初始化失败:', error);
    alert('初始化失败: ' + error.message);
  }
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  targetCode = params.get('targetCode') || '';
  targetSpace = params.get('targetSpace') || 'current';
  targetName = params.get('targetName') || '';

  const targetInfo = document.getElementById('targetInfo');
  if (targetInfo) {
    if (targetCode) {
      targetInfo.textContent = '目标建筑: ' + (targetName || targetCode);
    } else {
      targetInfo.textContent = '未选择目标建筑 (自由搭建模式)';
    }
  }
}

function initThreeJS() {
  const container = document.getElementById('canvas-container');

  // 场景
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.Fog(0x0a0a1a, 20, 100);

  // 相机
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(15, 15, 15);
  camera.lookAt(0, 0, 0);

  // 渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 控制器
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.1;
  controls.minDistance = 5;
  controls.maxDistance = 50;
  
  // 修改鼠标操作方式
  // 0: 左键, 1: 中键(滚轮), 2: 右键
  controls.mouseButtons = {
    LEFT: null,      // 左键不用于控制（用于放置组件）
    MIDDLE: THREE.MOUSE.ROTATE,  // 滚轮按住+移动 = 旋转
    RIGHT: null      // 右键不设置功能
  };

  // 灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -20;
  directionalLight.shadow.camera.right = 20;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  scene.add(directionalLight);

  // 网格地面 - 使用更精细的网格 (0.5米)
  gridHelper = new THREE.GridHelper(30, 60, 0x444444, 0x222222);
  scene.add(gridHelper);

  // 隐形平面用于射线检测
  const planeGeometry = new THREE.PlaneGeometry(100, 100);
  planeGeometry.rotateX(-Math.PI / 2);
  const planeMesh = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({ visible: false }));
  planeMesh.name = 'ground';
  scene.add(planeMesh);
  drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // 射线检测
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // 渲染循环
  animate();

  // 窗口调整
  window.addEventListener('resize', onWindowResize);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

// ==========================================
// 事件处理
// ==========================================
function initEvents() {
  // 组件选择
  const componentItems = document.querySelectorAll('.component-item');
  console.log('找到组件项数量:', componentItems.length);
  
  componentItems.forEach(function(item) {
    const type = item.dataset.type;
    console.log('绑定组件:', type);
    
    item.addEventListener('click', function(e) {
      console.log('点击组件:', type);
      if (currentTool === type) {
        clearCurrentTool();
        return;
      }
      document.querySelectorAll('.component-item').forEach(function(i) {
        i.classList.remove('selected');
      });
      item.classList.add('selected');
      currentTool = type;
      console.log('当前工具设置为:', currentTool);
      var config = COMPONENT_CONFIG[currentTool];
      showToast('已选择: ' + (config ? config.name : type));
      
      // 清除之前的预览
      clearPreview();
      
      // 如果是地板，启用画范围模式
      if (type === 'floor' || type === 'foundation') {
        isDrawingFloor = false;
        floorStartPoint = null;
      }
    });
  });

  // 材质选择
  document.querySelectorAll('.material-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.querySelectorAll('.material-item').forEach(function(i) {
        i.classList.remove('active');
      });
      item.classList.add('active');
      currentMaterial = item.dataset.material;
      // 更新预览材质
      updatePreviewMaterial();
    });
  });

  // 工具栏按钮
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('exportBtn').addEventListener('click', exportModel);

  // 视图控制
  document.getElementById('snapGrid').addEventListener('change', function(e) {
    snapToGrid = e.target.checked;
  });
  document.getElementById('rotationStep').addEventListener('change', function(e) {
    currentRotation = parseInt(e.target.value) * (Math.PI / 180);
  });
  const stairHeightInput = document.getElementById('stairHeightInput');
  if (stairHeightInput) {
    stairHeightInput.addEventListener('change', function(e) {
      stairHeight = clamp(Number(e.target.value) || 3, 0.5, 6);
      e.target.value = stairHeight.toFixed(1);
      if (currentTool === 'stairs') {
        clearPreview();
      }
    });
  }
  const roofHeightInput = document.getElementById('roofHeightInput');
  if (roofHeightInput) {
    roofHeightInput.addEventListener('change', function(e) {
      roofHeight = clamp(Number(e.target.value) || 3.5, 0, 12);
      e.target.value = roofHeight.toFixed(1);
      if (isRoofTool(currentTool)) {
        clearPreview();
      }
    });
  }
  document.getElementById('levelUpBtn').addEventListener('click', function() {
    currentLevel++;
    document.getElementById('currentLevel').textContent = currentLevel;
    updateGridHelperLevel();
  });
  document.getElementById('levelDownBtn').addEventListener('click', function() {
    if (currentLevel > 1) {
      currentLevel--;
      document.getElementById('currentLevel').textContent = currentLevel;
      updateGridHelperLevel();
    }
  });

  // 3D视图交互
  const container = document.getElementById('canvas-container');
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('click', onClick);
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  container.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      clearCurrentTool();
    }
  });
}

function clearCurrentTool() {
  currentTool = null;
  document.querySelectorAll('.component-item').forEach(function(item) {
    item.classList.remove('selected');
  });
  clearPreview();
  showToast('已退出建造模式，可以选择已放置组件');
}

// 清除预览
function clearPreview() {
  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh = null;
  }
  if (floorPreviewMesh) {
    scene.remove(floorPreviewMesh);
    floorPreviewMesh = null;
  }
  floorPreviewKey = '';
  hideDimensionReadout();
  isDrawingFloor = false;
  floorStartPoint = null;
}

// 更新预览材质
function updatePreviewMaterial() {
  if (previewMesh && currentTool) {
    applyComponentMaterial(previewMesh, currentTool, currentMaterial, 0.5);
  }

  if (floorPreviewMesh && currentTool) {
    applyComponentMaterial(floorPreviewMesh, currentTool, currentMaterial, 0.5);
  }
}

function onMouseMove(event) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // 地基/地板使用范围绘制，不显示跟随光标的单块预览。
  if (currentTool && !isRangeDrawingTool(currentTool) && !isDragging && !isDrawingFloor) {
    updatePreviewPosition();
  }

  // 更新范围绘制预览
  if (isDrawingFloor && floorStartPoint) {
    updateRangePreview();
  }

  // 拖拽移动
  if (isDragging && dragObject) {
    const drawPoint = getPointerPointOnDrawPlane(dragObject.userData.type || currentTool);
    
    if (drawPoint) {
      let pos = drawPoint.clone().add(dragOffset);
      if (snapToGrid) {
        pos.x = Math.round(pos.x / GRID_SIZE) * GRID_SIZE;
        pos.z = Math.round(pos.z / GRID_SIZE) * GRID_SIZE;
      }
      dragObject.position.x = pos.x;
      dragObject.position.z = pos.z;
    }
  }
}

// 更新预览位置
function updatePreviewPosition() {
  if (!currentTool) return;

  const drawPoint = getPointerPointOnDrawPlane(currentTool);

  if (drawPoint) {
    const config = COMPONENT_CONFIG[currentTool];
    let x = drawPoint.x;
    let z = drawPoint.z;
    let y = getPlacementBaseY(currentTool);

    if (snapToGrid) {
      // 使用组件中心点对齐网格
      const halfSizeX = config.size[0] / 2;
      const halfSizeZ = config.size[2] / 2;
      x = Math.round((x - halfSizeX) / GRID_SIZE) * GRID_SIZE + halfSizeX;
      z = Math.round((z - halfSizeZ) / GRID_SIZE) * GRID_SIZE + halfSizeZ;
    }

    const wallPlacement = getWallPlacementOnFloor(currentTool, x, z, currentRotation, currentLevel);
    if (wallPlacement) {
      x = wallPlacement.x;
      z = wallPlacement.z;
    }
    const supportPlacement = getSupportedComponentPlacement(currentTool, x, z, currentRotation, currentLevel);
    if (supportPlacement) {
      x = supportPlacement.x;
      z = supportPlacement.z;
    }

    // 创建或更新预览
    if (!previewMesh) {
      previewMesh = createComponentMesh(currentTool, config);
      applyComponentMaterial(previewMesh, currentTool, currentMaterial, 0.5);
      previewMesh.userData.isPreview = true;
      scene.add(previewMesh);
    }

    previewMesh.position.set(x, y + config.size[1] / 2, z);
    previewMesh.rotation.y = currentRotation;
    previewMesh.visible = true;
  }
}

// 更新地基、地板、墙体的拖拽范围预览
function updateRangePreview() {
  if (!floorStartPoint || !currentTool) return;

  const drawPoint = getPointerPointOnDrawPlane(currentTool);

  if (drawPoint) {
    let endX = drawPoint.x;
    let endZ = drawPoint.z;

    if (snapToGrid) {
      endX = Math.round(endX / GRID_SIZE) * GRID_SIZE;
      endZ = Math.round(endZ / GRID_SIZE) * GRID_SIZE;
    }

    const range = constrainRangeToSupport(
      currentTool,
      getRangeDrawingMetrics(currentTool, floorStartPoint.x, floorStartPoint.z, endX, endZ),
      currentRotation,
      currentLevel
    );
    const config = COMPONENT_CONFIG[currentTool];
    const size = range.size;
    const height = size[1];
    const nextPreviewKey = getRangePreviewKey(currentTool, size, currentRotation);
    updateDimensionReadout(currentTool, size);

    // 更新或创建预览
    if (!floorPreviewMesh) {
      const previewConfig = config || COMPONENT_CONFIG.floor;
      floorPreviewMesh = createComponentMesh(currentTool, {
        ...previewConfig,
        size
      });
      applyComponentMaterial(floorPreviewMesh, currentTool, currentMaterial, 0.5);
      floorPreviewMesh.userData.isPreview = true;
      scene.add(floorPreviewMesh);
      floorPreviewKey = nextPreviewKey;
    }

    if (floorPreviewKey !== nextPreviewKey) {
      floorPreviewMesh.geometry.dispose();
      floorPreviewMesh.geometry = createComponentGeometry(currentTool, size);
      floorPreviewMesh.userData.componentSize = size.slice();
      refreshSelectionHelper(floorPreviewMesh);
      floorPreviewKey = nextPreviewKey;
    }

    floorPreviewMesh.position.set(range.centerX, getPlacementBaseY(currentTool) + height / 2, range.centerZ);
    floorPreviewMesh.rotation.y = currentRotation;
  }
}

function onClick(event) {
  if (isDragging) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);

  // 范围绘制工具需要允许从已有组件表面开始绘制，才能贴合已有结构。
  if (isRangeDrawingTool(currentTool)) {
    handleRangeDrawing(event);
    return;
  }

  if (currentTool) {
    const drawPoint = getPointerPointOnDrawPlane(currentTool);
    if (drawPoint) {
      placeComponent(drawPoint);
      return;
    }
  }

  // 检查是否点击了已放置的组件
  const componentIntersect = intersects.find(function(i) {
    return i.object.userData.isComponent;
  });
  if (componentIntersect) {
    if (event.shiftKey) {
      removeComponent(componentIntersect.object);
    } else {
      selectComponent(componentIntersect.object);
    }
    return;
  }

  if (!currentTool) {
    showToast('请先从左侧选择一个组件');
  }
}

// 处理范围绘制
function handleRangeDrawing(event) {
  const drawPoint = getPointerPointOnDrawPlane(currentTool);

  if (!drawPoint) return;

  if (!isDrawingFloor) {
    // 开始绘制
    if (previewMesh) {
      scene.remove(previewMesh);
      previewMesh = null;
    }
    isDrawingFloor = true;
    let x = drawPoint.x;
    let z = drawPoint.z;
    
    if (snapToGrid) {
      x = Math.round(x / GRID_SIZE) * GRID_SIZE;
      z = Math.round(z / GRID_SIZE) * GRID_SIZE;
    }
    
    floorStartPoint = { x: x, z: z };
    updateDimensionReadout(currentTool, COMPONENT_CONFIG[currentTool].size);
    showToast(getRangeDrawingHint(currentTool));
  } else {
    // 完成绘制
    finishRangeDrawing(drawPoint);
  }
}

// 完成范围绘制
function finishRangeDrawing(endPoint) {
  if (!floorStartPoint) return;

  let endX = endPoint.x;
  let endZ = endPoint.z;

  if (snapToGrid) {
    endX = Math.round(endX / GRID_SIZE) * GRID_SIZE;
    endZ = Math.round(endZ / GRID_SIZE) * GRID_SIZE;
  }

  const range = constrainRangeToSupport(
    currentTool,
    getRangeDrawingMetrics(currentTool, floorStartPoint.x, floorStartPoint.z, endX, endZ),
    currentRotation,
    currentLevel
  );
  const size = range.size;
  const minLength = isWallTool(currentTool) ? GRID_SIZE : 0.5;
  const mainLength = isWallTool(currentTool) ? size[0] : Math.min(size[0], size[2]);

  // 如果范围太小，使用默认大小
  if (mainLength < minLength) {
    placeComponent(endPoint);
  } else {
    // 创建自定义尺寸组件
    saveHistory();
    
    const config = COMPONENT_CONFIG[currentTool];
    const height = size[1];
    const mesh = createComponentMesh(currentTool, {
      ...config,
      size
    });
    applyComponentMaterial(mesh, currentTool, currentMaterial);
    mesh.position.set(
      range.centerX,
      getPlacementBaseY(currentTool) + height / 2,
      range.centerZ
    );
    mesh.rotation.y = currentRotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const area = size[0] * size[2];
    const unitCost = config.cost / (config.size[0] * config.size[2]);
    mesh.userData = {
      isComponent: true,
      type: currentTool,
      config: {
        name: config.name + (isWallTool(currentTool) || currentTool === 'stairs' ? '(自定义)' : '(大范围)'),
        size,
        cost: Math.round(area * unitCost)
      },
      id: Date.now(),
      level: currentLevel,
      material: currentMaterial,
      componentSize: size.slice()
    };

    scene.add(mesh);
    placedComponents.push(mesh);
    updateUI();
    showToast('已放置' + config.name);
  }

  // 重置绘制状态
  isDrawingFloor = false;
  floorStartPoint = null;
  if (floorPreviewMesh) {
    scene.remove(floorPreviewMesh);
    floorPreviewMesh = null;
  }
  floorPreviewKey = '';
  hideDimensionReadout();
}

function onMouseDown(event) {
  if (event.button !== 0) return;
  if (isDrawingFloor) return; // 地板绘制模式下不处理拖拽
  if (isRangeDrawingTool(currentTool)) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const componentIntersect = intersects.find(function(i) { return i.object.userData.isComponent; });

  if (componentIntersect) {
    selectComponent(componentIntersect.object);
    beginSelectedComponentEdit();
    isDragging = true;
    dragObject = componentIntersect.object;
    dragOffset.copy(componentIntersect.point).sub(dragObject.position).negate();
    controls.enabled = false;
    // 隐藏预览
    if (previewMesh) previewMesh.visible = false;
  }
}

function onMouseUp() {
  if (isDrawingFloor && floorStartPoint) {
    // 地板绘制模式：完成绘制
    const drawPoint = getPointerPointOnDrawPlane(currentTool);
    if (drawPoint) {
      finishRangeDrawing(drawPoint);
    }
  }

  if (isDragging) {
    commitSelectedComponentEdit('已移动组件');
    isDragging = false;
    dragObject = null;
    controls.enabled = true;
    updateUI();
    // 恢复预览
    if (previewMesh) previewMesh.visible = true;
  }
}

// ==========================================
// 组件操作
// ==========================================
function placeComponent(point) {
  const config = COMPONENT_CONFIG[currentTool];
  if (!config) return;

  // 保存历史
  saveHistory();

  // 计算位置
  let x = point.x;
  let z = point.z;
  let y = getPlacementBaseY(currentTool);

  if (snapToGrid) {
    // 使用组件中心点对齐网格
    const halfSizeX = config.size[0] / 2;
    const halfSizeZ = config.size[2] / 2;
    x = Math.round((x - halfSizeX) / GRID_SIZE) * GRID_SIZE + halfSizeX;
    z = Math.round((z - halfSizeZ) / GRID_SIZE) * GRID_SIZE + halfSizeZ;
  }

  const wallPlacement = getWallPlacementOnFloor(currentTool, x, z, currentRotation, currentLevel);
  if (wallPlacement) {
    x = wallPlacement.x;
    z = wallPlacement.z;
  }
  const supportPlacement = getSupportedComponentPlacement(currentTool, x, z, currentRotation, currentLevel);
  if (supportPlacement) {
    x = supportPlacement.x;
    z = supportPlacement.z;
  }

  // 检查重叠
  const centerY = y + config.size[1] / 2;
  if (checkOverlap(x, centerY, z, config.size, currentTool)) {
    showToast('该位置已有组件，无法放置');
    return;
  }

  // 创建组件
  const mesh = createComponentMesh(currentTool, config);
  applyComponentMaterial(mesh, currentTool, currentMaterial);
  mesh.position.set(x, centerY, z);
  mesh.rotation.y = currentRotation;
  mesh.userData = {
    isComponent: true,
    type: currentTool,
    config: config,
    id: Date.now(),
    level: currentLevel,
    material: currentMaterial,
    componentSize: config.size.slice()
  };

  scene.add(mesh);
  placedComponents.push(mesh);

  // 添加入场动画
  mesh.scale.set(0.1, 0.1, 0.1);
  animateScale(mesh, 1);

  updateUI();
  showToast('已放置: ' + config.name);
}

function createComponentMesh(type, config) {
  const geometry = createComponentGeometry(type, config.size);

  const materialProps = MATERIAL_CONFIG[config.material] || MATERIAL_CONFIG.concrete;
  const material = createComponentMaterial(type, materialProps);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.componentSize = config.size.slice();

  // 选中框
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe94560, visible: false }));
  line.name = 'selection';
  mesh.add(line);

  return mesh;
}

function isRangeDrawingTool(type) {
  return type === 'floor' || type === 'foundation' || type === 'stairs' || isWallTool(type);
}

function createComponentGeometry(type, size) {
  switch (type) {
    case 'stairs':
      return createStairsGeometry(size);
    case 'roof_gable':
      return createGableRoofGeometry(size);
    case 'roof_pyramid':
      return createPyramidRoofGeometry(size);
    case 'wall_window':
      return createWindowWallGeometry(size);
    case 'wall_door':
      return createDoorWallGeometry(size);
    default:
      return new THREE.BoxGeometry(size[0], size[1], size[2]);
  }
}

function refreshSelectionHelper(mesh) {
  const oldSelection = mesh.getObjectByName('selection');
  const wasVisible = !!oldSelection?.visible;
  if (oldSelection) {
    oldSelection.geometry?.dispose?.();
    if (Array.isArray(oldSelection.material)) {
      oldSelection.material.forEach(function(material) {
        material?.dispose?.();
      });
    } else {
      oldSelection.material?.dispose?.();
    }
    mesh.remove(oldSelection);
  }

  const edges = new THREE.EdgesGeometry(mesh.geometry);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe94560, visible: wasVisible }));
  line.name = 'selection';
  mesh.add(line);
}

function getPlacementBaseY(type) {
  return getPlacementBaseYForLevel(type, currentLevel);
}

function getPointerPointOnDrawPlane(type) {
  raycaster.setFromCamera(mouse, camera);
  const drawY = getDrawPlaneY(type);
  drawPlane.set(new THREE.Vector3(0, 1, 0), -drawY);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(drawPlane, point) ? point : null;
}

function getDrawPlaneY(type) {
  return getPlacementBaseY(type || currentTool || 'foundation');
}

function updateGridHelperLevel() {
  if (!gridHelper) return;
  gridHelper.position.y = (currentLevel - 1) * 3;
}

function getPlacementBaseYForLevel(type, level) {
  const levelBaseY = (Math.max(1, Number(level) || 1) - 1) * 3;
  if (type === 'floor') {
    return levelBaseY + COMPONENT_CONFIG.foundation.size[1];
  }
  if (isWallTool(type)) {
    return levelBaseY + COMPONENT_CONFIG.foundation.size[1] + COMPONENT_CONFIG.floor.size[1];
  }
  if (type === 'stairs') {
    return levelBaseY + COMPONENT_CONFIG.foundation.size[1] + COMPONENT_CONFIG.floor.size[1];
  }
  if (isRoofTool(type)) {
    return levelBaseY + getRoofHeight();
  }
  return levelBaseY;
}

function isWallTool(type) {
  return type === 'wall' || type === 'wall_window' || type === 'wall_door';
}

function isRoofTool(type) {
  return type === 'roof_flat' || type === 'roof_gable' || type === 'roof_pyramid';
}

function isFloorSupportedTool(type) {
  return type === 'stairs';
}

function getRangeDrawingMetrics(type, startX, startZ, endX, endZ) {
  const config = COMPONENT_CONFIG[type];
  const height = type === 'stairs' ? getStairHeight() : config.size[1];

  if (isWallTool(type)) {
    const horizontal = isWallHorizontal(currentRotation);
    if (horizontal) {
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      const length = Math.max(GRID_SIZE, maxX - minX);
      return {
        centerX: (minX + maxX) / 2,
        centerZ: startZ,
        size: [length, height, config.size[2]]
      };
    }

    const minZ = Math.min(startZ, endZ);
    const maxZ = Math.max(startZ, endZ);
    const length = Math.max(GRID_SIZE, maxZ - minZ);
    return {
      centerX: startX,
      centerZ: (minZ + maxZ) / 2,
      size: [length, height, config.size[2]]
    };
  }

  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minZ = Math.min(startZ, endZ);
  const maxZ = Math.max(startZ, endZ);
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size: [maxX - minX, height, maxZ - minZ]
  };
}

function getStairHeight() {
  const input = document.getElementById('stairHeightInput');
  const value = input ? Number(input.value) : stairHeight;
  stairHeight = clamp(value || stairHeight || 3, 0.5, 6);
  return stairHeight;
}

function getRoofHeight() {
  const input = document.getElementById('roofHeightInput');
  const value = input ? Number(input.value) : roofHeight;
  roofHeight = clamp(value || roofHeight || 3.5, 0, 12);
  return roofHeight;
}

function getRangeDrawingHint(type) {
  if (isWallTool(type)) return '拖拽确定墙面长度，松开完成';
  if (type === 'stairs') return '拖拽确定楼梯长宽，高度可在顶部输入框调整';
  return '按住拖拽绘制范围，松开完成';
}

function getWallPlacementOnFloor(type, rawX, rawZ, rotation, level) {
  if (!isWallTool(type)) return null;

  const config = COMPONENT_CONFIG[type];
  const supports = getFloorSupportsForLevel(level);
  if (!config || supports.length === 0) return null;

  const horizontal = isWallHorizontal(rotation);
  const wallLength = config.size[0];
  const wallThickness = config.size[2];
  let best = null;

  supports.forEach(function(support) {
    const minX = support.position.x - support.size[0] / 2;
    const maxX = support.position.x + support.size[0] / 2;
    const minZ = support.position.z - support.size[2] / 2;
    const maxZ = support.position.z + support.size[2] / 2;

    if (horizontal) {
      const x = clamp(rawX, minX + wallLength / 2, maxX - wallLength / 2);
      const z = clamp(rawZ, minZ + wallThickness / 2, maxZ - wallThickness / 2);
      const distance = Math.abs(rawX - x) + Math.abs(rawZ - z);
      best = pickCloserWallPlacement(best, { x, z, distance });
      return;
    }

    const x = clamp(rawX, minX + wallThickness / 2, maxX - wallThickness / 2);
    const z = clamp(rawZ, minZ + wallLength / 2, maxZ - wallLength / 2);
    const distance = Math.abs(rawX - x) + Math.abs(rawZ - z);
    best = pickCloserWallPlacement(best, { x, z, distance });
  });

  return best ? { x: best.x, z: best.z } : null;
}

function getSupportedComponentPlacement(type, rawX, rawZ, rotation, level) {
  if (!isFloorSupportedTool(type)) return null;

  const config = COMPONENT_CONFIG[type];
  const supports = getFloorSupportsForLevel(level);
  if (!config || supports.length === 0) return null;

  const footprint = getComponentFootprintHalfSize(type, config, rotation);
  let best = null;

  supports.forEach(function(support) {
    const minX = support.position.x - support.size[0] / 2;
    const maxX = support.position.x + support.size[0] / 2;
    const minZ = support.position.z - support.size[2] / 2;
    const maxZ = support.position.z + support.size[2] / 2;
    const x = clamp(rawX, minX + footprint.x, maxX - footprint.x);
    const z = clamp(rawZ, minZ + footprint.z, maxZ - footprint.z);
    const distance = Math.abs(rawX - x) + Math.abs(rawZ - z);
    best = pickCloserWallPlacement(best, { x, z, distance });
  });

  return best ? { x: best.x, z: best.z } : null;
}

function constrainRangeToSupport(type, range, rotation, level) {
  if (type === 'stairs') {
    return constrainRectangleToSupport(range, level);
  }

  if (!isWallTool(type)) return range;

  const supports = getFloorSupportsForLevel(level);
  if (supports.length === 0) return range;

  const horizontal = isWallHorizontal(rotation);
  let best = null;

  supports.forEach(function(support) {
    const minX = support.position.x - support.size[0] / 2;
    const maxX = support.position.x + support.size[0] / 2;
    const minZ = support.position.z - support.size[2] / 2;
    const maxZ = support.position.z + support.size[2] / 2;
    const thickness = range.size[2];
    let candidate;

    if (horizontal) {
      const maxLength = Math.max(GRID_SIZE, maxX - minX);
      const length = Math.min(range.size[0], maxLength);
      const centerX = clamp(range.centerX, minX + length / 2, maxX - length / 2);
      const centerZ = clamp(range.centerZ, minZ + thickness / 2, maxZ - thickness / 2);
      candidate = {
        centerX,
        centerZ,
        size: [length, range.size[1], thickness],
        distance: Math.abs(range.centerX - centerX) + Math.abs(range.centerZ - centerZ)
      };
    } else {
      const maxLength = Math.max(GRID_SIZE, maxZ - minZ);
      const length = Math.min(range.size[0], maxLength);
      const centerX = clamp(range.centerX, minX + thickness / 2, maxX - thickness / 2);
      const centerZ = clamp(range.centerZ, minZ + length / 2, maxZ - length / 2);
      candidate = {
        centerX,
        centerZ,
        size: [length, range.size[1], thickness],
        distance: Math.abs(range.centerX - centerX) + Math.abs(range.centerZ - centerZ)
      };
    }

    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  });

  return best
    ? { centerX: best.centerX, centerZ: best.centerZ, size: best.size }
    : range;
}

function constrainRectangleToSupport(range, level) {
  const supports = getFloorSupportsForLevel(level);
  if (supports.length === 0) return range;

  let best = null;
  supports.forEach(function(support) {
    const minX = support.position.x - support.size[0] / 2;
    const maxX = support.position.x + support.size[0] / 2;
    const minZ = support.position.z - support.size[2] / 2;
    const maxZ = support.position.z + support.size[2] / 2;
    const width = Math.min(Math.max(GRID_SIZE, range.size[0]), maxX - minX);
    const depth = Math.min(Math.max(GRID_SIZE, range.size[2]), maxZ - minZ);
    const centerX = clamp(range.centerX, minX + width / 2, maxX - width / 2);
    const centerZ = clamp(range.centerZ, minZ + depth / 2, maxZ - depth / 2);
    const candidate = {
      centerX,
      centerZ,
      size: [width, range.size[1], depth],
      distance: Math.abs(range.centerX - centerX) + Math.abs(range.centerZ - centerZ)
    };

    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  });

  return best
    ? { centerX: best.centerX, centerZ: best.centerZ, size: best.size }
    : range;
}

function getFloorSupportsForLevel(level) {
  const normalizedLevel = Math.max(1, Number(level) || 1);
  let floors = placedComponents.filter(function(mesh) {
    return mesh.userData.type === 'floor' && mesh.userData.level === normalizedLevel;
  });

  if (floors.length === 0) {
    floors = placedComponents.filter(function(mesh) {
      return mesh.userData.type === 'foundation' && mesh.userData.level === normalizedLevel;
    });
  }

  return floors.map(function(mesh) {
    return {
      position: mesh.position,
      size: mesh.userData.componentSize || mesh.userData.config.size
    };
  });
}

function isWallHorizontal(rotation) {
  const quarterTurns = Math.round(rotation / (Math.PI / 2));
  return Math.abs(quarterTurns % 2) === 0;
}

function usesRotatedFootprint(type) {
  return isWallTool(type) || type === 'stairs';
}

function getComponentFootprintHalfSize(type, config, rotation) {
  const horizontal = !usesRotatedFootprint(type) || isWallHorizontal(rotation);
  return {
    x: (horizontal ? config.size[0] : config.size[2]) / 2,
    z: (horizontal ? config.size[2] : config.size[0]) / 2
  };
}

function pickCloserWallPlacement(current, candidate) {
  if (!current || candidate.distance < current.distance) {
    return candidate;
  }
  return current;
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function updateDimensionReadout(type, size) {
  const readout = document.getElementById('dimensionReadout');
  if (!readout || !type || !Array.isArray(size)) return;

  const nextKey = getRangePreviewKey(type, size, 0);
  if (dimensionReadoutKey === nextKey && readout.style.display !== 'none') return;
  dimensionReadoutKey = nextKey;

  const config = COMPONENT_CONFIG[type] || {};
  const title = config.name || type;
  const length = formatDimension(size[0]);
  const height = formatDimension(size[1]);
  const depth = formatDimension(size[2]);

  if (isWallTool(type)) {
    readout.innerHTML =
      '<strong>' + title + '尺寸</strong>' +
      '<span>长度：' + length + ' m</span>' +
      '<span>厚度：' + depth + ' m</span>' +
      '<span>高度：' + height + ' m</span>';
  } else if (type === 'stairs') {
    readout.innerHTML =
      '<strong>' + title + '尺寸</strong>' +
      '<span>长：' + length + ' m</span>' +
      '<span>宽：' + depth + ' m</span>' +
      '<span>高度：' + height + ' m</span>';
  } else {
    readout.innerHTML =
      '<strong>' + title + '尺寸</strong>' +
      '<span>长：' + length + ' m</span>' +
      '<span>宽：' + depth + ' m</span>' +
      '<span>厚度：' + height + ' m</span>';
  }

  readout.style.display = '';
}

function hideDimensionReadout() {
  const readout = document.getElementById('dimensionReadout');
  if (readout) readout.style.display = 'none';
  dimensionReadoutKey = '';
}

function formatDimension(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.0';
  return num.toFixed(1);
}

function getRangePreviewKey(type, size, rotation) {
  return [
    type || '',
    Math.round((size?.[0] || 0) * 1000),
    Math.round((size?.[1] || 0) * 1000),
    Math.round((size?.[2] || 0) * 1000),
    Math.round((rotation || 0) * 1000)
  ].join('|');
}

function createComponentMaterial(type, materialProps, opacity) {
  if (type === 'foundation') {
    return createFoundationMaterial(materialProps, opacity);
  }

  if (type === 'floor') {
    return createFloorMaterial(materialProps, opacity);
  }

  return createStandardMaterial(materialProps, opacity);
}

function createStandardMaterial(materialProps, opacity) {
  const material = new THREE.MeshStandardMaterial({
    color: materialProps.color,
    roughness: materialProps.roughness,
    metalness: materialProps.metalness
  });

  if (typeof opacity === 'number') {
    material.opacity = opacity;
    material.transparent = opacity < 1;
  }

  return material;
}

function createFoundationMaterial(materialProps, opacity) {
  const foundationGray = new THREE.Color(0x777777);
  const topColor = foundationGray.clone().offsetHSL(0, 0, 0.03);
  const sideColor = foundationGray.clone();
  const bottomColor = foundationGray.clone().offsetHSL(0, 0, -0.05);
  const foundationProps = {
    ...materialProps,
    roughness: 0.95,
    metalness: 0
  };

  return [
    createStandardMaterial({ ...foundationProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...foundationProps, color: topColor.getHex() }, opacity),
    createStandardMaterial({ ...foundationProps, color: bottomColor.getHex() }, opacity),
    createStandardMaterial({ ...foundationProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...foundationProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...foundationProps, color: sideColor.getHex() }, opacity)
  ];
}

function createFloorMaterial(materialProps, opacity) {
  const baseColor = new THREE.Color(materialProps.color);
  const lightBase = baseColor.clone().lerp(new THREE.Color(0xf4f1e8), 0.78);
  const topColor = lightBase.clone().offsetHSL(0, 0, 0.05);
  const sideColor = lightBase.clone().offsetHSL(0, 0, -0.08);
  const bottomColor = lightBase.clone().offsetHSL(0, 0, -0.13);

  return [
    createStandardMaterial({ ...materialProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...materialProps, color: topColor.getHex() }, opacity),
    createStandardMaterial({ ...materialProps, color: bottomColor.getHex() }, opacity),
    createStandardMaterial({ ...materialProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...materialProps, color: sideColor.getHex() }, opacity),
    createStandardMaterial({ ...materialProps, color: sideColor.getHex() }, opacity)
  ];
}

function applyComponentMaterial(mesh, type, materialKey, opacity) {
  const materialProps = MATERIAL_CONFIG[materialKey] || MATERIAL_CONFIG[COMPONENT_CONFIG[type]?.material] || MATERIAL_CONFIG.concrete;
  const nextMaterial = createComponentMaterial(type, materialProps, opacity);

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(function(material) {
      if (material && typeof material.dispose === 'function') material.dispose();
    });
  } else if (mesh.material && typeof mesh.material.dispose === 'function') {
    mesh.material.dispose();
  }

  mesh.material = nextMaterial;
  rebuildComponentDetail(mesh, type, materialProps, opacity);
}

function rebuildComponentDetail(mesh, type, materialProps, opacity) {
  removeComponentDetail(mesh);

  if (type === 'foundation') {
    addFoundationDetail(mesh, materialProps, opacity);
    return;
  }
}

function removeComponentDetail(mesh) {
  const detail = mesh.getObjectByName('component-detail');
  if (!detail) return;

  detail.traverse(function(child) {
    if (child.geometry && typeof child.geometry.dispose === 'function') {
      child.geometry.dispose();
    }

    if (Array.isArray(child.material)) {
      child.material.forEach(function(material) {
        if (material && typeof material.dispose === 'function') material.dispose();
      });
    } else if (child.material && typeof child.material.dispose === 'function') {
      child.material.dispose();
    }
  });

  mesh.remove(detail);
}

function addFoundationDetail(mesh, materialProps, opacity) {
  const size = mesh.userData.componentSize || [3, 0.6, 3];
  const width = size[0];
  const height = size[1];
  const depth = size[2];
  const detailGroup = new THREE.Group();
  detailGroup.name = 'component-detail';

  const foundationGray = new THREE.Color(0x777777);
  const capColor = foundationGray.clone().offsetHSL(0, 0, 0.04);
  const seamColor = foundationGray.clone().offsetHSL(0, 0, -0.08);

  const capInset = Math.min(0.18, width * 0.08, depth * 0.08);
  const capHeight = Math.min(0.06, height * 0.18);
  const capGeometry = new THREE.BoxGeometry(
    Math.max(0.2, width - capInset * 2),
    capHeight,
    Math.max(0.2, depth - capInset * 2)
  );
  const capMaterial = createStandardMaterial({
    ...materialProps,
    color: capColor.getHex(),
    roughness: Math.min(1, materialProps.roughness + 0.05)
  }, opacity);
  const capMesh = new THREE.Mesh(capGeometry, capMaterial);
  capMesh.position.set(0, height / 2 - capHeight / 2 + 0.002, 0);
  detailGroup.add(capMesh);

  const seamMaterial = new THREE.LineBasicMaterial({
    color: seamColor.getHex(),
    transparent: typeof opacity === 'number' && opacity < 1,
    opacity: typeof opacity === 'number' ? opacity : 1
  });

  const seamInset = Math.min(0.12, width * 0.06, depth * 0.06);
  const seamY = height / 2 - capHeight - 0.01;
  const seamPoints = [
    new THREE.Vector3(-width / 2 + seamInset, seamY, -depth / 2 + seamInset),
    new THREE.Vector3(width / 2 - seamInset, seamY, -depth / 2 + seamInset),
    new THREE.Vector3(width / 2 - seamInset, seamY, depth / 2 - seamInset),
    new THREE.Vector3(-width / 2 + seamInset, seamY, depth / 2 - seamInset),
    new THREE.Vector3(-width / 2 + seamInset, seamY, -depth / 2 + seamInset)
  ];
  const seamGeometry = new THREE.BufferGeometry().setFromPoints(seamPoints);
  detailGroup.add(new THREE.Line(seamGeometry, seamMaterial));

  if (width >= 2.5) {
    const jointMaterial = seamMaterial.clone();
    const jointPoints = [
      new THREE.Vector3(0, -height / 2 + 0.02, -depth / 2 + seamInset),
      new THREE.Vector3(0, height / 2 - capHeight - 0.02, -depth / 2 + seamInset)
    ];
    const jointGeometry = new THREE.BufferGeometry().setFromPoints(jointPoints);
    detailGroup.add(new THREE.Line(jointGeometry, jointMaterial));
  }

  if (depth >= 2.5) {
    const jointMaterial = seamMaterial.clone();
    const jointPoints = [
      new THREE.Vector3(-width / 2 + seamInset, -height / 2 + 0.02, 0),
      new THREE.Vector3(-width / 2 + seamInset, height / 2 - capHeight - 0.02, 0)
    ];
    const jointGeometry = new THREE.BufferGeometry().setFromPoints(jointPoints);
    detailGroup.add(new THREE.Line(jointGeometry, jointMaterial));
  }

  mesh.add(detailGroup);
}

// 特殊几何体创建函数
function createStairsGeometry(size) {
  const shape = new THREE.Shape();
  const steps = Math.max(6, Math.round(size[1] / 0.25));
  const stepHeight = size[1] / steps;
  const stepDepth = size[2] / steps;

  shape.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    shape.lineTo(i * stepDepth, (i + 1) * stepHeight);
    shape.lineTo((i + 1) * stepDepth, (i + 1) * stepHeight);
  }
  shape.lineTo(size[2], 0);
  shape.lineTo(0, 0);

  const extrudeSettings = { depth: size[0], bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(size[0] / 2, -size[1] / 2, -size[2] / 2);
  return geometry;
}

function createGableRoofGeometry(size) {
  const shape = new THREE.Shape();
  shape.moveTo(-size[0] / 2, 0);
  shape.lineTo(0, size[1]);
  shape.lineTo(size[0] / 2, 0);
  shape.lineTo(-size[0] / 2, 0);

  const extrudeSettings = { depth: size[2], bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.translate(0, -size[1] / 2, -size[2] / 2);
  return geometry;
}

function createPyramidRoofGeometry(size) {
  const geometry = new THREE.ConeGeometry(size[0] / 1.4, size[1], 4);
  geometry.rotateY(Math.PI / 4);
  return geometry;
}

function createWindowWallGeometry(size) {
  const shape = new THREE.Shape();
  const wallThickness = 0.2;
  const windowWidth = 1.5;
  const windowHeight = 1.5;
  const windowY = 0.75;

  // 外框
  shape.moveTo(-size[0] / 2, 0);
  shape.lineTo(size[0] / 2, 0);
  shape.lineTo(size[0] / 2, size[1]);
  shape.lineTo(-size[0] / 2, size[1]);
  shape.lineTo(-size[0] / 2, 0);

  // 窗户洞口
  const hole = new THREE.Path();
  hole.moveTo(-windowWidth / 2, windowY);
  hole.lineTo(windowWidth / 2, windowY);
  hole.lineTo(windowWidth / 2, windowY + windowHeight);
  hole.lineTo(-windowWidth / 2, windowY + windowHeight);
  hole.lineTo(-windowWidth / 2, windowY);
  shape.holes.push(hole);

  const extrudeSettings = { depth: wallThickness, bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.translate(0, -size[1] / 2, -wallThickness / 2);
  return geometry;
}

function createDoorWallGeometry(size) {
  const shape = new THREE.Shape();
  const wallThickness = 0.2;
  const doorWidth = 1.2;
  const doorHeight = 2.1;

  // 外框
  shape.moveTo(-size[0] / 2, 0);
  shape.lineTo(size[0] / 2, 0);
  shape.lineTo(size[0] / 2, size[1]);
  shape.lineTo(-size[0] / 2, size[1]);
  shape.lineTo(-size[0] / 2, 0);

  // 门洞口
  const hole = new THREE.Path();
  hole.moveTo(-doorWidth / 2, 0);
  hole.lineTo(doorWidth / 2, 0);
  hole.lineTo(doorWidth / 2, doorHeight);
  hole.lineTo(-doorWidth / 2, doorHeight);
  hole.lineTo(-doorWidth / 2, 0);
  shape.holes.push(hole);

  const extrudeSettings = { depth: wallThickness, bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.translate(0, -size[1] / 2, -wallThickness / 2);
  return geometry;
}

function animateScale(mesh, targetScale) {
  const duration = 300;
  const start = Date.now();
  const startScale = mesh.scale.x;

  function update() {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = startScale + (targetScale - startScale) * easeOut;
    mesh.scale.set(current, current, current);

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  update();
}

function checkOverlap(x, y, z, size, type) {
  const halfSize = [size[0] / 2, size[1] / 2, size[2] / 2];
  const verticalTolerance = 0.03;

  for (let i = 0; i < placedComponents.length; i++) {
    const comp = placedComponents[i];
    if (canOverlapSupport(type, comp)) continue;

    const c = comp.position;
    const s = comp.userData.componentSize || comp.userData.config.size;
    const hs = [s[0] / 2, s[1] / 2, s[2] / 2];

    if (Math.abs(x - c.x) < (halfSize[0] + hs[0]) - 0.01 &&
        Math.abs(y - c.y) < (halfSize[1] + hs[1]) - verticalTolerance &&
        Math.abs(z - c.z) < (halfSize[2] + hs[2]) - 0.01) {
      return true;
    }
  }
  return false;
}

function canOverlapSupport(type, comp) {
  const supportType = comp && comp.userData && comp.userData.type;
  if (type === 'stairs') {
    return supportType === 'floor' || supportType === 'foundation';
  }

  if (isRoofTool(type)) {
    return supportType === 'wall' ||
      supportType === 'wall_window' ||
      supportType === 'wall_door' ||
      supportType === 'floor' ||
      supportType === 'foundation';
  }

  return false;
}

function removeComponent(mesh) {
  saveHistory();
  scene.remove(mesh);
  placedComponents = placedComponents.filter(function(c) { return c !== mesh; });
  if (selectedComponent === mesh) {
    selectedComponent = null;
  }
  updateUI();
  showToast('已删除组件');
}

function selectComponent(mesh) {
  // 取消之前的选中
  if (selectedComponent) {
    const prevSelection = selectedComponent.getObjectByName('selection');
    if (prevSelection) prevSelection.visible = false;
  }

  // 选中新组件
  selectedComponent = mesh;
  editorSnapshot = null;
  const selection = mesh.getObjectByName('selection');
  if (selection) selection.visible = true;

  updateUI();
}

function clearAll() {
  if (placedComponents.length === 0) return;
  
  saveHistory();
  placedComponents.forEach(function(mesh) { scene.remove(mesh); });
  placedComponents = [];
  selectedComponent = null;
  clearPreview();
  updateUI();
  showToast('已清空所有组件');
}

// ==========================================
// 历史记录和撤销
// ==========================================
function saveHistory() {
  history.push(snapshotComponents());
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function undo() {
  if (history.length === 0) {
    showToast('没有可撤销的操作');
    return;
  }

  const prevState = history.pop();
  placedComponents.forEach(function(mesh) { scene.remove(mesh); });
  placedComponents = [];

  prevState.forEach(function(data) {
    const baseConfig = COMPONENT_CONFIG[data.type];
    const config = data.size
      ? {
          ...baseConfig,
          name: data.name || baseConfig.name,
          size: data.size.slice()
        }
      : baseConfig;
    const mesh = createComponentMesh(data.type, config);
    applyComponentMaterial(mesh, data.type, data.material);
    mesh.position.copy(data.position);
    mesh.rotation.y = data.rotation;
    mesh.userData = {
      isComponent: true,
      type: data.type,
      config: config,
      id: Date.now(),
      level: data.level,
      material: data.material,
      componentSize: config.size.slice()
    };
    scene.add(mesh);
    placedComponents.push(mesh);
  });

  selectedComponent = null;
  editorSnapshot = null;
  updateUI();
  showToast('已撤销上一步操作');
}

function beginSelectedComponentEdit() {
  if (!selectedComponent || editorSnapshot) return;
  editorSnapshot = snapshotComponents();
}

function commitSelectedComponentEdit(message) {
  if (!selectedComponent || !editorSnapshot) return;
  history.push(editorSnapshot);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  editorSnapshot = null;
  updateUI();
  if (message) showToast(message);
}

function snapshotComponents() {
  return placedComponents.map(function(mesh) {
    return {
      type: mesh.userData.type,
      position: mesh.position.clone(),
      rotation: mesh.rotation.y,
      material: mesh.userData.material,
      level: mesh.userData.level,
      size: Array.isArray(mesh.userData.componentSize) ? mesh.userData.componentSize.slice() : null,
      name: mesh.userData.config?.name || ''
    };
  });
}

// ==========================================
// 导出模型
// ==========================================
function exportModel() {
  if (placedComponents.length === 0) {
    showToast('请先放置一些组件');
    return;
  }

  // 创建导出组
  const exportGroup = new THREE.Group();
  placedComponents.forEach(function(mesh) {
    const clone = mesh.clone();
    exportGroup.add(clone);
  });

  // 计算包围盒并居中
  const box = new THREE.Box3().setFromObject(exportGroup);
  const center = box.getCenter(new THREE.Vector3());
  exportGroup.position.sub(center);

  // 导出为JSON格式
  const exportData = {
    components: placedComponents.map(function(mesh) {
      return {
        type: mesh.userData.type,
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        rotation: mesh.rotation.y,
        material: mesh.userData.material
      };
    }),
    metrics: {
      totalHeight: box.max.y - box.min.y,
      length: box.max.z - box.min.z,
      width: box.max.x - box.min.x,
      componentCount: placedComponents.length
    }
  };

  // 发送到父窗口或下载
  if (window.opener) {
    window.opener.postMessage({
      type: 'village-house-generator:model-ready',
      payload: {
        sourceCode: targetCode,
        spaceId: targetSpace,
        modelData: exportData,
        modelScale: 10,
        modelHeading: 0,
        modelHeightOffset: 0,
        modelMetrics: exportData.metrics
      }
    }, '*');
    showToast('模型已发送到主平台！');
  } else {
    // 下载JSON文件
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'assembled-house-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('模型数据已下载');
  }
}

// ==========================================
// UI更新
// ==========================================
function updateUI() {
  // 更新组件列表
  const listEl = document.getElementById('componentList');
  if (placedComponents.length === 0) {
    listEl.innerHTML = '<div class="empty-state">暂无组件，请从左侧选择</div>';
  } else {
    let html = '';
    for (let i = 0; i < placedComponents.length; i++) {
      const mesh = placedComponents[i];
      const isSelected = mesh === selectedComponent;
      html += '<div class="component-list-item ' + (isSelected ? 'selected' : '') + '" data-id="' + mesh.userData.id + '">' +
        '<div class="component-info">' +
          '<span class="component-name">' + mesh.userData.config.name + '</span>' +
          '<span class="component-pos">' + mesh.position.x.toFixed(1) + ', ' + mesh.position.y.toFixed(1) + ', ' + mesh.position.z.toFixed(1) + '</span>' +
        '</div>' +
        '<button class="component-delete" data-id="' + mesh.userData.id + '">删除</button>' +
      '</div>';
    }
    listEl.innerHTML = html;

    // 绑定删除按钮事件
    listEl.querySelectorAll('.component-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const id = parseInt(this.dataset.id);
        removeComponentById(id);
      });
    });

    // 绑定选中事件
    listEl.querySelectorAll('.component-list-item').forEach(function(item, index) {
      item.addEventListener('click', function() {
        selectComponent(placedComponents[index]);
      });
    });
  }

  renderComponentEditor();

  // 更新统计
  document.getElementById('componentCount').textContent = placedComponents.length;
  
  let totalVolume = 0;
  let totalCost = 0;
  placedComponents.forEach(function(mesh) {
    const size = mesh.userData.config.size;
    totalVolume += size[0] * size[1] * size[2];
    totalCost += mesh.userData.config.cost;
  });
  
  document.getElementById('totalVolume').textContent = totalVolume.toFixed(2) + ' m³';
  document.getElementById('totalCost').textContent = '¥' + totalCost.toLocaleString();
}

function renderComponentEditor() {
  const editorEl = document.getElementById('componentEditor');
  if (!editorEl) return;

  if (!selectedComponent || !placedComponents.includes(selectedComponent)) {
    editorEl.innerHTML = '<div class="empty-state compact">请选择一个已放置组件</div>';
    return;
  }

  const mesh = selectedComponent;
  const type = mesh.userData.type;
  const config = mesh.userData.config || COMPONENT_CONFIG[type] || {};
  const material = mesh.userData.material || config.material || 'concrete';
  const level = mesh.userData.level || currentLevel;
  const rotationDeg = Math.round(mesh.rotation.y * 180 / Math.PI);
  const materialOptions = Object.keys(MATERIAL_CONFIG).map(function(key) {
    return '<option value="' + key + '"' + (key === material ? ' selected' : '') + '>' + MATERIAL_CONFIG[key].name + '</option>';
  }).join('');

  editorEl.innerHTML =
    '<div class="editor-title">' +
      '<div><strong>' + config.name + '</strong><span>' + type + '</span></div>' +
      '<button id="editorDeleteBtn" class="component-delete" type="button">删除</button>' +
    '</div>' +
    '<div class="editor-grid">' +
      '<div class="editor-field"><label>X 坐标</label><input id="editorPosX" type="number" step="0.5" value="' + mesh.position.x.toFixed(2) + '"></div>' +
      '<div class="editor-field"><label>Z 坐标</label><input id="editorPosZ" type="number" step="0.5" value="' + mesh.position.z.toFixed(2) + '"></div>' +
      '<div class="editor-field"><label>楼层</label><input id="editorLevel" type="number" min="1" step="1" value="' + level + '"></div>' +
      '<div class="editor-field"><label>旋转</label><select id="editorRotation">' +
        '<option value="0"' + (rotationDeg === 0 ? ' selected' : '') + '>0°</option>' +
        '<option value="90"' + (rotationDeg === 90 ? ' selected' : '') + '>90°</option>' +
        '<option value="180"' + (rotationDeg === 180 ? ' selected' : '') + '>180°</option>' +
        '<option value="270"' + (rotationDeg === 270 || rotationDeg === -90 ? ' selected' : '') + '>270°</option>' +
      '</select></div>' +
    '</div>' +
    '<div class="editor-field"><label>材质</label><select id="editorMaterial">' + materialOptions + '</select></div>' +
    '<div class="editor-actions">' +
      '<button id="editorApplyBtn" class="btn btn-primary" type="button">应用修改</button>' +
      '<button id="editorResetBtn" class="btn btn-secondary" type="button">回到网格</button>' +
    '</div>';

  document.getElementById('editorApplyBtn').addEventListener('click', applySelectedComponentEdit);
  document.getElementById('editorResetBtn').addEventListener('click', snapSelectedComponentToGrid);
  document.getElementById('editorDeleteBtn').addEventListener('click', function() {
    if (selectedComponent) removeComponent(selectedComponent);
  });
}

function applySelectedComponentEdit() {
  if (!selectedComponent) return;

  const mesh = selectedComponent;
  const type = mesh.userData.type;
  const config = mesh.userData.config || COMPONENT_CONFIG[type];
  const nextX = Number(document.getElementById('editorPosX')?.value);
  const nextZ = Number(document.getElementById('editorPosZ')?.value);
  const nextLevel = Math.max(1, parseInt(document.getElementById('editorLevel')?.value || '1', 10));
  const nextRotationDeg = Number(document.getElementById('editorRotation')?.value || 0);
  const nextMaterial = document.getElementById('editorMaterial')?.value || mesh.userData.material;

  if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
    showToast('请输入有效坐标');
    return;
  }

  beginSelectedComponentEdit();

  mesh.userData.level = nextLevel;
  mesh.userData.material = nextMaterial;
  mesh.position.x = nextX;
  mesh.position.z = nextZ;
  mesh.position.y = getPlacementBaseYForLevel(type, nextLevel) + config.size[1] / 2;
  mesh.rotation.y = nextRotationDeg * Math.PI / 180;
  applyComponentMaterial(mesh, type, nextMaterial);

  commitSelectedComponentEdit('已修改组件');
}

function snapSelectedComponentToGrid() {
  if (!selectedComponent) return;
  beginSelectedComponentEdit();

  const mesh = selectedComponent;
  const type = mesh.userData.type;
  const level = mesh.userData.level || currentLevel;
  const size = mesh.userData.componentSize || mesh.userData.config.size;
  const halfSizeX = size[0] / 2;
  const halfSizeZ = size[2] / 2;
  mesh.position.x = Math.round((mesh.position.x - halfSizeX) / GRID_SIZE) * GRID_SIZE + halfSizeX;
  mesh.position.z = Math.round((mesh.position.z - halfSizeZ) / GRID_SIZE) * GRID_SIZE + halfSizeZ;
  mesh.position.y = getPlacementBaseYForLevel(type, level) + size[1] / 2;

  commitSelectedComponentEdit('已吸附到网格');
}

// 通过ID删除组件（用于列表按钮）
function removeComponentById(id) {
  const mesh = placedComponents.find(function(c) { return c.userData.id === id; });
  if (mesh) removeComponent(mesh);
}

// 提示信息
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(function() {
    toast.classList.remove('show');
  }, 3000);
}

// ==========================================
// 启动应用
// ==========================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM已经加载完成，直接初始化
  init();
}
