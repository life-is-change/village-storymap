# Orthophoto Transparent NoData Implementation Plan

> **过程文档：** 本文件仅用于记录方案实施过程与验证步骤，不属于平台运行文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2D、3D 共用正射影像外围的黑色 NoData 区透明化，同时保持尺寸和地理配准不变。

**Architecture:** 不改地图加载代码，只原位更新共用资源 `assets/orthophoto.webp`。通过边界连通掩膜区分外围 NoData 与内部深色地物，并用 Alpha 通道表达透明度。

**Tech Stack:** Python、Pillow、WebP Alpha、OpenLayers、Cesium

## Global Constraints

- 只处理与图片外边界连通的黑色区域。
- 输出尺寸必须保持 `8192 × 4038`。
- `assets/orthophoto.pgw` 内容不得变化。
- 2D、3D 继续引用 `assets/orthophoto.webp`。

---

### Task 1: 建立像素级失败检查

**Files:**
- Test: `assets/orthophoto.webp`

**Interfaces:**
- Consumes: Pillow 对 WebP RGBA 像素的读取结果。
- Produces: 对尺寸、透明通道与边界透明度的断言。

- [ ] **Step 1: 运行透明度断言**

```powershell
python -c "from PIL import Image; im=Image.open('assets/orthophoto.webp').convert('RGBA'); assert im.size == (8192,4038); assert im.getchannel('A').getextrema()[0] == 0"
```

- [ ] **Step 2: 确认当前文件因无透明像素而失败**

预期：`AssertionError`。

### Task 2: 透明化外围 NoData 区

**Files:**
- Modify: `assets/orthophoto.webp`
- Preserve: `assets/orthophoto.pgw`

**Interfaces:**
- Consumes: 原始 RGB WebP 与近黑阈值。
- Produces: 尺寸相同、外围透明的 RGBA WebP。

- [ ] **Step 1: 构建近黑候选掩膜**

使用 RGB 最大通道值判定近黑像素，不改动非候选 RGB。

- [ ] **Step 2: 从图片外边界提取连通区域**

仅将与四周相连的候选区域标记为 NoData，避免误删内部深色地物。

- [ ] **Step 3: 写回 Alpha WebP**

保留 `8192 × 4038` 尺寸，以无损 WebP 写回原路径；不写入或修改 `.pgw`。

### Task 3: 验证 2D、3D 显示

**Files:**
- Verify: `app.js`
- Verify: `app-3d.js`
- Verify: `assets/orthophoto.webp`

**Interfaces:**
- Consumes: 处理后的共用影像。
- Produces: 像素检查、语法检查和浏览器实景结果。

- [ ] **Step 1: 运行像素检查**

断言尺寸不变、存在透明像素、四周 NoData 透明且中心有效影像仍不透明。

- [ ] **Step 2: 运行 JavaScript 语法检查**

```powershell
node --check app.js
node --check app-3d.js
```

- [ ] **Step 3: 浏览器检查 2D 和 3D**

确认外围显示下层天地图/地形，内部高精度正射影像仍完整覆盖，且不出现黑色轮廓。
