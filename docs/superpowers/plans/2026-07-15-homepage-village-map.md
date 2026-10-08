# 首页村庄现状地图 Implementation Plan

> **过程文档：** 本文件仅用于记录方案实施过程与验证步骤，不属于平台运行文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页村庄现状区域提供可扩展的村庄选择、米埗村简介和带完整控制项的天地图影像地图。

**Architecture:** 以独立的村庄数据模块保存坐标和文案；地图组件在客户端动态加载天地图 SDK 并只维护一个地图实例；`App.tsx` 仅负责在既有区块中渲染新组件。地图 SDK 失败时在组件内部降级为可读提示。

**Tech Stack:** React 19、TypeScript、Vite、Tailwind CSS、Lucide React、天地图 JavaScript API、Vitest。

## Global Constraints

- 不改变根目录 `/index.html` 的入口关系；修改首页源码后必须重建 `homepage/dist`。
- 复用 `app.js` 内既有的天地图密钥 `a2a034ff8616a35957abf8951339fedb`。
- 返回主区域固定至广州校区东校园附近；选村动作定位至所选村庄。
- 地图控件必须具有中文 `aria-label` 和 `title`。
- 新增村庄只能通过向 `VILLAGES` 增加配置对象完成。

---

### Task 1: 创建村庄配置及其测试

**Files:**
- Create: `homepage/src/features/village-map/village-data.ts`
- Create: `homepage/src/features/village-map/village-data.test.ts`
- Modify: `homepage/package.json`

**Interfaces:**
- Produces: `VillageProfile`、`VILLAGES`、`DEFAULT_VILLAGE_ID`、`HOME_REGION`、`getVillageById(id: string): VillageProfile`。
- Consumes: 无。

- [ ] **Step 1: 添加 Vitest 并写出失败测试**

在 `homepage/package.json` 添加脚本和开发依赖：

```json
"test": "vitest run"
```

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_VILLAGE_ID, HOME_REGION, VILLAGES, getVillageById } from './village-data';

describe('village map configuration', () => {
  it('uses 米埗村 as the default village', () => {
    expect(getVillageById(DEFAULT_VILLAGE_ID).name).toBe('米埗村');
  });

  it('keeps the homepage return location separate from village locations', () => {
    expect(HOME_REGION.name).toContain('中山大学');
    expect(HOME_REGION.longitude).not.toBe(VILLAGES[0].longitude);
  });
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在失败**

Run: `npm test -- village-data.test.ts`

Expected: FAIL with a module-resolution error for `./village-data`.

- [ ] **Step 3: 以最小实现添加配置**

```ts
export type VillageProfile = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  longitude: number;
  latitude: number;
  zoom: number;
};

export const VILLAGES: VillageProfile[] = [/* 米埗村配置 */];
export const DEFAULT_VILLAGE_ID = 'mibu-village';
export const HOME_REGION = { name: '中山大学广州校区东校园', longitude: 113.399, latitude: 23.055, zoom: 15 };
export const getVillageById = (id: string) => VILLAGES.find((village) => village.id === id) ?? VILLAGES[0];
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test -- village-data.test.ts`

Expected: PASS with two tests.

### Task 2: 实现可复用天地图村庄模块

**Files:**
- Create: `homepage/src/features/village-map/VillageMapSection.tsx`
- Create: `homepage/src/features/village-map/VillageMapSection.test.tsx`

**Interfaces:**
- Consumes: `VILLAGES`、`DEFAULT_VILLAGE_ID`、`HOME_REGION`、`getVillageById`。
- Produces: `VillageMapSection` React 组件。

- [ ] **Step 1: 写出失败的组件行为测试**

测试应渲染组件后确认“米埗村”选项、介绍标题、四个带中文 `aria-label` 的按钮与初始加载提示均存在。

```tsx
expect(screen.getByRole('combobox', { name: '选择村庄' })).toHaveValue('mibu-village');
expect(screen.getByRole('heading', { name: '米埗村' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '全屏地图' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '放大地图' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '缩小地图' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: '返回主区域' })).toBeInTheDocument();
```

- [ ] **Step 2: 运行测试，确认因组件不存在失败**

Run: `npm test -- VillageMapSection.test.tsx`

Expected: FAIL with module-resolution error for `./VillageMapSection`.

- [ ] **Step 3: 最小实现组件**

组件使用 `useEffect` 注入一次 `https://api.tianditu.gov.cn/api?v=4.0&tk=...`，在成功后创建 `T.Map`、`T.TileLayer` 影像与注记图层。通过 `useRef` 保存实例，在卸载时移除全屏监听；在村庄选择变化时调用 `centerAndZoom`。按钮分别调用 Fullscreen API、`zoomIn`、`zoomOut` 与 `centerAndZoom(HOME_REGION)`。SDK 加载失败时展示“地图暂时无法加载，请稍后重试。”。

- [ ] **Step 4: 运行组件测试，确认通过**

Run: `npm test -- VillageMapSection.test.tsx`

Expected: PASS.

### Task 3: 集成并构建首页产物

**Files:**
- Modify: `homepage/src/App.tsx:951-1001`
- Modify: `homepage/package.json`
- Modify: `homepage/vite.config.ts`（如 Vitest 环境需显式配置）
- Generate: `homepage/dist/**`

**Interfaces:**
- Consumes: `VillageMapSection`。
- Produces: 首页“村庄现状”区的实际地图和介绍内容。

- [ ] **Step 1: 写出失败的集成断言**

通过组件测试或源码级断言确认 `App` 渲染 `VillageMapSection`，且旧的“村庄现状内容区域”占位文案不存在。

- [ ] **Step 2: 运行断言，确认在集成前失败**

Run: `npm test -- App.test.tsx`

Expected: FAIL because `VillageMapSection` 尚未被 `App` 使用。

- [ ] **Step 3: 集成组件并移除旧虚线占位框**

在 `App.tsx` 顶部导入 `VillageMapSection`，并以 `<VillageMapSection />` 替换占位块。保持原有三张概况卡片和区块标题不变。

- [ ] **Step 4: 运行全部测试、代码检查及生产构建**

Run: `npm test && npm run lint && npm run build`

Expected: all Vitest tests pass, ESLint reports zero errors, and Vite emits `dist/index.html` and hashed assets.

- [ ] **Step 5: 浏览器手动验证**

打开首页并检查：影像与注记出现；米埗村简介完整显示；点击放大/缩小改变级别；返回主区域切换至东校园；全屏进入和退出正常；将视窗缩至 768px 以下后两栏垂直排列。
