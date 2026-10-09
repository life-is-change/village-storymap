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
    size: [3, 0.3, 3],
    snapToGrid: true,
    allowStack: true,
    material: 'concrete',
    cost: 500,
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
    size: [3, 3, 1.5],
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
let placedComponents = [];
let selectedComponent = null;
let currentTool = null;
let currentMaterial = 'concrete';
let currentLevel = 1;
let currentRotation = 0;
let snapToGrid = true;
let isDragging = false;
let dragObject = null;
let dragOffset = new THREE.Vector3();

// 预览相关
let previewMesh = null;
let isDrawingFloor = false;
let floorStartPoint = null;
let floorPreviewMesh = null;

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
  document.getElementById('levelUpBtn').addEventListener('click', function() {
    currentLevel++;
    document.getElementById('currentLevel').textContent = currentLevel;
  });
  document.getElementById('levelDownBtn').addEventListener('click', function() {
    if (currentLevel > 1) {
      currentLevel--;
      document.getElementById('currentLevel').textContent = currentLevel;
    }
  });

  // 3D视图交互
  const container = document.getElementById('canvas-container');
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('click', onClick);
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  container.addEventListener('contextmenu', function(e) { e.preventDefault(); });
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
  isDrawingFloor = false;
  floorStartPoint = null;
}

// 更新预览材质
function updatePreviewMaterial() {
  if (previewMesh && currentTool) {
    const config = COMPONENT_CONFIG[currentTool];
    const materialProps = MATERIAL_CONFIG[currentMaterial] || MATERIAL_CONFIG[config.material];
    previewMesh.material.color.setHex(materialProps.color);
  }
}

function onMouseMove(event) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // 更新预览位置
  if (currentTool && !isDragging && !isDrawingFloor) {
    updatePreviewPosition();
  }

  // 更新地板绘制预览
  if (isDrawingFloor && floorStartPoint) {
    updateFloorPreview();
  }

  // 拖拽移动
  if (isDragging && dragObject) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);
    const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });
    
    if (groundIntersect) {
      let pos = groundIntersect.point.clone().add(dragOffset);
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

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });

  if (groundIntersect) {
    const config = COMPONENT_CONFIG[currentTool];
    let x = groundIntersect.point.x;
    let z = groundIntersect.point.z;
    let y = (currentLevel - 1) * 3;

    if (snapToGrid) {
      // 使用组件中心点对齐网格
      const halfSizeX = config.size[0] / 2;
      const halfSizeZ = config.size[2] / 2;
      x = Math.round((x - halfSizeX) / GRID_SIZE) * GRID_SIZE + halfSizeX;
      z = Math.round((z - halfSizeZ) / GRID_SIZE) * GRID_SIZE + halfSizeZ;
    }

    // 创建或更新预览
    if (!previewMesh) {
      previewMesh = createComponentMesh(currentTool, config);
      previewMesh.material = previewMesh.material.clone();
      previewMesh.material.opacity = 0.5;
      previewMesh.material.transparent = true;
      previewMesh.userData.isPreview = true;
      scene.add(previewMesh);
    }

    previewMesh.position.set(x, y + config.size[1] / 2, z);
    previewMesh.rotation.y = currentRotation;
    previewMesh.visible = true;
  }
}

// 更新地板范围预览
function updateFloorPreview() {
  if (!floorStartPoint || !currentTool) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });

  if (groundIntersect) {
    let endX = groundIntersect.point.x;
    let endZ = groundIntersect.point.z;

    if (snapToGrid) {
      endX = Math.round(endX / GRID_SIZE) * GRID_SIZE;
      endZ = Math.round(endZ / GRID_SIZE) * GRID_SIZE;
    }

    // 计算矩形范围
    const minX = Math.min(floorStartPoint.x, endX);
    const maxX = Math.max(floorStartPoint.x, endX);
    const minZ = Math.min(floorStartPoint.z, endZ);
    const maxZ = Math.max(floorStartPoint.z, endZ);

    const width = maxX - minX;
    const depth = maxZ - minZ;

    // 更新或创建预览
    if (!floorPreviewMesh) {
      const geometry = new THREE.BoxGeometry(1, 0.15, 1);
      const materialProps = MATERIAL_CONFIG[currentMaterial] || MATERIAL_CONFIG.wood;
      const material = new THREE.MeshStandardMaterial({
        color: materialProps.color,
        roughness: materialProps.roughness,
        metalness: materialProps.metalness,
        opacity: 0.5,
        transparent: true
      });
      floorPreviewMesh = new THREE.Mesh(geometry, material);
      floorPreviewMesh.userData.isPreview = true;
      scene.add(floorPreviewMesh);
    }

    floorPreviewMesh.scale.set(width || 0.1, 1, depth || 0.1);
    floorPreviewMesh.position.set(
      (minX + maxX) / 2,
      (currentLevel - 1) * 3 + 0.075,
      (minZ + maxZ) / 2
    );
  }
}

function onClick(event) {
  if (isDragging) return;

  // 如果是地板/地基，使用画范围模式
  if (currentTool === 'floor' || currentTool === 'foundation') {
    handleFloorDrawing(event);
    return;
  }

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);

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

  // 放置新组件
  if (!currentTool) {
    showToast('请先从左侧选择一个组件');
    return;
  }

  const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });
  if (groundIntersect) {
    placeComponent(groundIntersect.point);
  }
}

// 处理地板绘制
function handleFloorDrawing(event) {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });

  if (!groundIntersect) return;

  if (!isDrawingFloor) {
    // 开始绘制
    isDrawingFloor = true;
    let x = groundIntersect.point.x;
    let z = groundIntersect.point.z;
    
    if (snapToGrid) {
      x = Math.round(x / GRID_SIZE) * GRID_SIZE;
      z = Math.round(z / GRID_SIZE) * GRID_SIZE;
    }
    
    floorStartPoint = { x: x, z: z };
    showToast('按住拖拽绘制地板范围，松开完成');
  } else {
    // 完成绘制
    finishFloorDrawing(groundIntersect.point);
  }
}

// 完成地板绘制
function finishFloorDrawing(endPoint) {
  if (!floorStartPoint) return;

  let endX = endPoint.x;
  let endZ = endPoint.z;

  if (snapToGrid) {
    endX = Math.round(endX / GRID_SIZE) * GRID_SIZE;
    endZ = Math.round(endZ / GRID_SIZE) * GRID_SIZE;
  }

  // 计算矩形范围
  const minX = Math.min(floorStartPoint.x, endX);
  const maxX = Math.max(floorStartPoint.x, endX);
  const minZ = Math.min(floorStartPoint.z, endZ);
  const maxZ = Math.max(floorStartPoint.z, endZ);

  const width = maxX - minX;
  const depth = maxZ - minZ;

  // 如果范围太小，使用默认大小
  if (width < 0.5 || depth < 0.5) {
    // 放置单个地板
    placeComponent(endPoint);
  } else {
    // 创建大范围地板
    saveHistory();
    
    const config = COMPONENT_CONFIG[currentTool];
    const materialProps = MATERIAL_CONFIG[currentMaterial] || MATERIAL_CONFIG[config.material];
    const geometry = new THREE.BoxGeometry(width, 0.15, depth);
    const material = new THREE.MeshStandardMaterial({
      color: materialProps.color,
      roughness: materialProps.roughness,
      metalness: materialProps.metalness
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      (minX + maxX) / 2,
      (currentLevel - 1) * 3 + 0.075,
      (minZ + maxZ) / 2
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      isComponent: true,
      type: currentTool,
      config: {
        name: config.name + '(大范围)',
        size: [width, 0.15, depth],
        cost: Math.round(width * depth * 30)
      },
      id: Date.now(),
      level: currentLevel,
      material: currentMaterial
    };
    
    // 选中框
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe94560, visible: false }));
    line.name = 'selection';
    mesh.add(line);
    
    scene.add(mesh);
    placedComponents.push(mesh);
    updateUI();
    showToast('已放置大范围' + config.name);
  }

  // 重置绘制状态
  isDrawingFloor = false;
  floorStartPoint = null;
  if (floorPreviewMesh) {
    scene.remove(floorPreviewMesh);
    floorPreviewMesh = null;
  }
}

function onMouseDown(event) {
  if (event.button !== 0) return;
  if (isDrawingFloor) return; // 地板绘制模式下不处理拖拽

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  const componentIntersect = intersects.find(function(i) { return i.object.userData.isComponent; });

  if (componentIntersect) {
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
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);
    const groundIntersect = intersects.find(function(i) { return i.object.name === 'ground'; });
    if (groundIntersect) {
      finishFloorDrawing(groundIntersect.point);
    }
  }

  if (isDragging) {
    isDragging = false;
    dragObject = null;
    controls.enabled = true;
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
  let y = (currentLevel - 1) * 3;

  if (snapToGrid) {
    // 使用组件中心点对齐网格
    const halfSizeX = config.size[0] / 2;
    const halfSizeZ = config.size[2] / 2;
    x = Math.round((x - halfSizeX) / GRID_SIZE) * GRID_SIZE + halfSizeX;
    z = Math.round((z - halfSizeZ) / GRID_SIZE) * GRID_SIZE + halfSizeZ;
  }

  // 检查重叠
  if (checkOverlap(x, y, z, config.size)) {
    showToast('该位置已有组件，无法放置');
    return;
  }

  // 创建组件
  const mesh = createComponentMesh(currentTool, config);
  mesh.position.set(x, y + config.size[1] / 2, z);
  mesh.rotation.y = currentRotation;
  mesh.userData = {
    isComponent: true,
    type: currentTool,
    config: config,
    id: Date.now(),
    level: currentLevel,
    material: currentMaterial
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
  let geometry;

  switch (type) {
    case 'stairs':
      geometry = createStairsGeometry(config.size);
      break;
    case 'roof_gable':
      geometry = createGableRoofGeometry(config.size);
      break;
    case 'roof_pyramid':
      geometry = createPyramidRoofGeometry(config.size);
      break;
    case 'wall_window':
      geometry = createWindowWallGeometry(config.size);
      break;
    case 'wall_door':
      geometry = createDoorWallGeometry(config.size);
      break;
    default:
      geometry = new THREE.BoxGeometry(config.size[0], config.size[1], config.size[2]);
  }

  const materialProps = MATERIAL_CONFIG[config.material] || MATERIAL_CONFIG.concrete;
  const material = new THREE.MeshStandardMaterial({
    color: materialProps.color,
    roughness: materialProps.roughness,
    metalness: materialProps.metalness
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // 选中框
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe94560, visible: false }));
  line.name = 'selection';
  mesh.add(line);

  return mesh;
}

// 特殊几何体创建函数
function createStairsGeometry(size) {
  const shape = new THREE.Shape();
  const steps = 6;
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
  geometry.translate(size[0] / 2, 0, -size[2] / 2);
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
  geometry.translate(0, 0, -size[2] / 2);
  return geometry;
}

function createPyramidRoofGeometry(size) {
  const geometry = new THREE.ConeGeometry(size[0] / 1.4, size[1], 4);
  geometry.rotateY(Math.PI / 4);
  geometry.translate(0, size[1] / 2, 0);
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
  geometry.translate(0, 0, -wallThickness / 2);
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
  geometry.translate(0, 0, -wallThickness / 2);
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

function checkOverlap(x, y, z, size) {
  const halfSize = [size[0] / 2, size[1] / 2, size[2] / 2];

  for (let i = 0; i < placedComponents.length; i++) {
    const comp = placedComponents[i];
    const c = comp.position;
    const s = comp.userData.config.size;
    const hs = [s[0] / 2, s[1] / 2, s[2] / 2];

    if (Math.abs(x - c.x) < (halfSize[0] + hs[0]) - 0.01 &&
        Math.abs(y - c.y) < (halfSize[1] + hs[1]) - 0.01 &&
        Math.abs(z - c.z) < (halfSize[2] + hs[2]) - 0.01) {
      return true;
    }
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
  const state = placedComponents.map(function(mesh) {
    return {
      type: mesh.userData.type,
      position: mesh.position.clone(),
      rotation: mesh.rotation.y,
      material: mesh.userData.material,
      level: mesh.userData.level
    };
  });

  history.push(state);
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
    const config = COMPONENT_CONFIG[data.type];
    const mesh = createComponentMesh(data.type, config);
    mesh.position.copy(data.position);
    mesh.rotation.y = data.rotation;
    mesh.userData = {
      isComponent: true,
      type: data.type,
      config: config,
      id: Date.now(),
      level: data.level,
      material: data.material
    };
    scene.add(mesh);
    placedComponents.push(mesh);
  });

  selectedComponent = null;
  updateUI();
  showToast('已撤销上一步操作');
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
