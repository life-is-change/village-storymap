# Task-Context Planning Workspace Phase 1 Implementation Plan

> **过程文档｜实施计划**
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“课程任务栏＋原菜单＋共建／规划开关”重组为可运行的统一工作区：六项柔性课程导航、阶段情境侧栏、稳定地图上下文栏、项目设置抽屉和连续的 2D／3D 视图。

**Architecture:** 保留现有 OpenLayers、Cesium、空间数据和 Supabase 服务，只调整前端信息架构。课程模型与情境内容继续由 `features/course` 和 `features/ui/course-workbench.js` 管理；低频图层／空间工具继续复用 `space-panel.js`，但迁入设置抽屉；`app.js` 只负责工作区状态和既有地图能力接线。

**Tech Stack:** 原生 HTML/CSS/JavaScript、OpenLayers、Cesium、Supabase JS、Node.js 内置 `node:test`。

## Global Constraints

- 直接在当前 `master` 分支工作，不新建分支。
- 不修改 React 首页及其三模块内容。
- 本阶段不执行新的 Supabase SQL，不迁移或删除生产数据。
- 保留现有 2D、3D、照片、留言、要素编辑、空间和行为日志能力。
- 课程使用柔性引导；未完成前序任务不隐藏后续阶段。
- 本阶段仅完成“统一工作区外壳与交互”。全班校核版本链、冻结基线、小组私有数据库权限和教师后台进入后续独立计划。

---

### Task 1: 收束课程模型

**Files:**
- Modify: `features/course/course-model.js`
- Modify: `features/course/course-model.test.js`

**Interfaces:**
- Produces: `DEFAULT_COURSE.stages`，顺序为 `group_join → learning → survey → diagnosis → design → submission`，并包含 `kind: "preparation" | "practice"`。
- Produces: 六个兼容任务 ID：`join-group`、`learning-ready`、`survey-collect`、`diagnosis-list`、`design-workspace`、`submit-result`。
- Consumes: `course-service.js` 现有 `completedTaskIds`，不修改存储格式。

- [ ] **Step 1: 写出六阶段失败测试**

```js
test("default course has two preparation statuses and four practice stages", () => {
  assert.deepEqual(DEFAULT_COURSE.stages.map((stage) => stage.key), [
    "group_join", "learning", "survey", "diagnosis", "design", "submission"
  ]);
  assert.deepEqual(DEFAULT_COURSE.stages.map((stage) => stage.kind), [
    "preparation", "preparation", "practice", "practice", "practice", "practice"
  ]);
  assert.equal(DEFAULT_COURSE.tasks.some((task) => task.id === "review-plan"), false);
});
```

- [ ] **Step 2: 运行测试并确认旧七阶段断言失败**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/course/course-model.test.js
```

Expected: FAIL，阶段数组仍包含 `review`。

- [ ] **Step 3: 更新模型**

```js
stages: Object.freeze([
  { key: "group_join", kind: "preparation", title: "加入小组", taskIds: ["join-group"] },
  { key: "learning", kind: "preparation", title: "学习准备", taskIds: ["learning-ready"] },
  { key: "survey", kind: "practice", title: "调研采集与现状校核", taskIds: ["survey-collect"] },
  { key: "diagnosis", kind: "practice", title: "现状诊断与课堂汇报", taskIds: ["diagnosis-list"] },
  { key: "design", kind: "practice", title: "方案设计与迭代", taskIds: ["design-workspace"] },
  { key: "submission", kind: "practice", title: "成果整理与提交", taskIds: ["submit-result"] }
])
```

删除 `review-plan`，更新四个实践任务的标题与说明。旧状态中的 `review-plan` 可保留，但不参与新总数和下一任务计算。

- [ ] **Step 4: 运行测试并提交**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/course/course-model.test.js
git add features/course/course-model.js features/course/course-model.test.js
git commit -m "refactor: align course model with four practice stages"
```

Expected: PASS。

### Task 2: 将课程抽屉改为阶段情境侧栏

**Files:**
- Modify: `features/course/course-model.js`
- Modify: `features/ui/course-workbench.js`
- Modify: `features/ui/course-workbench.test.js`

**Interfaces:**
- Produces: `renderTaskNavigation()` 渲染六个可访问入口，分别标记准备状态与实践阶段。
- Produces: `renderDashboard()` 只呈现当前阶段的“阶段成果、相关资料、建议操作”和柔性进度。
- Produces: `createCourseWorkbench(deps)` 在阶段变化时调用 `deps.onTaskChanged({ task, stage })`。

- [ ] **Step 1: 写出情境内容失败测试**

```js
test("survey context focuses on outcomes, resources and recommended actions", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: "survey-collect"
  });
  assert.match(html, /阶段成果/);
  assert.match(html, /相关资料/);
  assert.match(html, /建议操作/);
  assert.doesNotMatch(html, /进入原有 2D|进入原有 3D|最近操作/);
});
```

另加断言：导航中 `data-stage-kind="preparation"` 出现 2 次，`data-stage-kind="practice"` 出现 4 次。

- [ ] **Step 2: 运行工作台测试并确认失败**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/course-workbench.test.js
```

Expected: FAIL，旧侧栏只有步骤清单。

- [ ] **Step 3: 添加稳定情境数据并渲染**

任务情境使用统一结构：

```js
context: Object.freeze({
  outcomes: ["校核后的现状要素", "已定位的调研照片与说明"],
  resources: ["现状建筑与道路", "现场照片", "调研备注"],
  actions: ["选择现状对象", "上传照片", "新增点状问题标记"]
})
```

`renderTaskGuidance()` 输出三个 `.course-context-section`。加入小组继续显示组码表单；任何阶段都可查看。

- [ ] **Step 4: 增加阶段变更通知**

```js
function notifyTaskChanged() {
  const task = (course.tasks || []).find((item) => item.id === activeTaskId) || null;
  const stage = (course.stages || []).find((item) => item.key === task?.stageKey) || null;
  deps.onTaskChanged?.({ task, stage });
}
```

首次渲染和 `showTask()` 后调用该函数。

- [ ] **Step 5: 运行测试并提交**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/course-workbench.test.js
git add features/course/course-model.js features/ui/course-workbench.js features/ui/course-workbench.test.js
git commit -m "feat: render stage-aware course context"
```

Expected: PASS。

### Task 3: 重组工作区 DOM 和布局骨架

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `features/ui/course-task-layout.test.js`

**Interfaces:**
- Produces DOM: `#courseTaskSidebar` 只承载最左侧图标轨道。
- Produces DOM: `#courseContextPanel` 承载 `#courseWorkbenchContent`，替代旧菜单列。
- Produces DOM: `#workspaceContextBar`，包含 `#workspaceVillageLabel`、`#workspaceStageLabel`、`#spaceHeaderSelect`、`#workspaceViewModeSwitch` 和 `#projectSettingsBtn`。
- Produces DOM: `#projectSettingsDrawer` 和原 `#spaceList`。

- [ ] **Step 1: 写出结构失败测试**

```js
test("workspace uses rail, contextual sidebar and stable context bar", () => {
  assert.match(indexSource, /id="courseTaskSidebar"/);
  assert.match(indexSource, /id="courseContextPanel"/);
  assert.match(indexSource, /id="workspaceContextBar"/);
  assert.match(indexSource, /id="projectSettingsDrawer"/);
  assert.ok(indexSource.indexOf('id="courseTaskSidebar"') < indexSource.indexOf('id="courseContextPanel"'));
});

test("abstract collaboration and planning switches are absent", () => {
  assert.doesNotMatch(indexSource, /data-mode="collab"|data-mode="planning"/);
  assert.doesNotMatch(indexSource, />共建模式<|>规划模式</);
});
```

- [ ] **Step 2: 运行布局测试并确认失败**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/course-task-layout.test.js
```

Expected: FAIL。

- [ ] **Step 3: 调整 HTML 层级**

`#courseTaskSidebar` 只保留轨道与展开按钮。紧邻的 `#courseContextPanel` 包含返回首页、课程标题和 `#courseWorkbenchContent`。在中央地图顶部添加 `#workspaceContextBar`。将 `#spaceList` 移入 `#projectSettingsDrawer`，删除旧 `data-mode-switch` 和两个重复视图挂载点。

- [ ] **Step 4: 调整栅格和响应式样式**

```css
.main-layout {
  --course-rail-width: 68px;
  --context-panel-width: 300px;
  --right-panel-width: 300px;
  grid-template-columns: var(--course-rail-width) var(--context-panel-width) minmax(0, 1fr) var(--right-panel-width);
}
.main-layout.mode-map-left-collapsed { --context-panel-width: 0px; }
.course-task-sidebar { width: var(--course-rail-width); }
.course-context-panel { width: var(--context-panel-width); }
```

地图保持全屏底层，轨道、情境侧栏、上下文栏、设置抽屉和右侧面板覆盖其上。首页模式继续隐藏工作区侧栏。

- [ ] **Step 5: 运行测试并提交**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/course-task-layout.test.js
git add index.html style.css features/ui/course-task-layout.test.js
git commit -m "refactor: establish unified task-context workspace shell"
```

Expected: PASS。

### Task 4: 迁移空间、图层和工具到项目设置抽屉

**Files:**
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/space-panel-events.js`
- Create: `features/ui/workspace-settings-layout.test.js`

**Interfaces:**
- Consumes DOM: `#spaceHeaderSelect`、`#workspaceViewModeSwitch`、`#spaceList`。
- Produces: 顶部空间下拉、单一 2D／3D 开关，以及抽屉中的“图层控制、问题与留言、空间工具、导出”。

- [ ] **Step 1: 写出设置布局失败测试**

```js
test("space panel targets stable context mounts", () => {
  assert.match(spacePanelSource, /workspaceViewModeSwitch/);
  assert.match(spacePanelSource, /spaceHeaderSelect/);
  assert.doesNotMatch(spacePanelSource, /querySelector\("\[data-mode-switch\]"\)/);
});

test("settings expose layers, issues, tools and export together", () => {
  for (const label of ["图层控制", "问题与留言", "空间工具", "导出"]) {
    assert.match(spacePanelSource, new RegExp(label));
  }
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/workspace-settings-layout.test.js
```

Expected: FAIL。

- [ ] **Step 3: 统一 `space-panel.js` 输出**

```js
const headerSelectMount = document.getElementById("spaceHeaderSelect");
if (headerSelectMount) {
  headerSelectMount.innerHTML = `<select class="space-select-dropdown" data-space-dropdown>${dropdownOptionsHtml}</select>`;
}
const viewSwitchMount = document.getElementById("workspaceViewModeSwitch");
if (viewSwitchMount) viewSwitchMount.innerHTML = viewModeSwitchHtml;
```

`#spaceList` 固定输出图层控制、问题与留言、空间工具、导出。问题区保留 `#communityBuildMount`，并提供 `#communityMessageBoard`／`#communityMessageList`，复用既有留言功能。3D 中保留设置抽屉，仅对 2D 专属编辑控件显示说明。

- [ ] **Step 4: 删除模式开关事件**

从 `space-panel-events.js` 删除 `[data-mode-switch]` 绑定；保留 `[data-space-view]`、空间下拉、图层、工具、留言和导出事件。

- [ ] **Step 5: 运行测试并提交**

```powershell
$node='C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; & $node --test features/ui/workspace-settings-layout.test.js features/course/course-workspace-adapter.test.js
git add features/ui/space-panel.js features/ui/space-panel-events.js features/ui/workspace-settings-layout.test.js
git commit -m "refactor: move global controls into project settings"
```

Expected: PASS。

### Task 5: 接线上下文栏、设置抽屉和连续视图

**Files:**
- Modify: `app.js`
- Modify: `features/ui/view-switcher.js`
- Modify: `features/ui/course-task-layout.test.js`

**Interfaces:**
- Consumes: `onTaskChanged({ task, stage })`。
- Produces: `setProjectSettingsOpen(open)`、`updateWorkspaceContextBar()`。
- Preserves: `currentSpaceId`、`currentSelectedObject`、活动阶段和侧栏状态在 2D／3D 切换时不被重置。

- [ ] **Step 1: 写出接线失败测试**

```js
test("app wires project settings and stage context", () => {
  assert.match(appSource, /function setProjectSettingsOpen/);
  assert.match(appSource, /function updateWorkspaceContextBar/);
});

test("2D overview does not replace the inspector with the global message board", () => {
  const source = appSource.match(/function showPlan2DOverview\(\)[\s\S]*?(?=\nfunction getEditNamespaceObjectType)/)?.[0] || "";
  assert.doesNotMatch(source, /refreshCommunityMessageBoard/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test features/ui/course-task-layout.test.js
```

Expected: FAIL。

- [ ] **Step 3: 增加工作区状态接线**

```js
function updateWorkspaceContextBar({ task, stage } = {}) {
  if (workspaceStageLabel) workspaceStageLabel.textContent = stage?.title || task?.title || "课程实践";
  if (workspaceVillageLabel) workspaceVillageLabel.textContent = "米埗村";
  projectSettingsBtn?.setAttribute("aria-expanded", String(isProjectSettingsOpen));
  projectSettingsDrawer?.classList.toggle("is-open", isProjectSettingsOpen);
}

function setProjectSettingsOpen(open) {
  isProjectSettingsOpen = Boolean(open);
  updateWorkspaceContextBar();
  if (isProjectSettingsOpen) renderSpaceList();
}
```

把 `onTaskChanged` 传给课程工作台；轨道展开按钮只控制情境侧栏。设置按钮、关闭按钮和 `Escape` 控制抽屉。

- [ ] **Step 4: 统一右侧默认状态和视图连续性**

`showPlan2DOverview()` 未选中对象时显示“选择地图对象后查看属性、照片、讨论与历史”，不再把全局留言板放入右侧。

`view-switcher.js` 进入 3D 时只在 `getCurrentSelectedObject()` 为空时写入 3D 提示；已有对象时保留右侧内容。3D 加载失败仍显示错误并允许切回 2D。

- [ ] **Step 5: 运行测试并提交**

```powershell
$node='C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; & $node --test features/course/course-model.test.js features/ui/course-workbench.test.js features/ui/course-task-layout.test.js features/ui/workspace-settings-layout.test.js
git add app.js features/ui/view-switcher.js features/ui/course-task-layout.test.js
git commit -m "feat: keep task context continuous across map views"
```

Expected: PASS。

### Task 6: 完整验证、浏览器检查与迭代记录

**Files:**
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Produces: `2026-07-17｜任务—情境工作区第一版` 迭代记录。
- Verifies: 课程服务、权限、行为日志、空间和首页桥接没有回归。

- [ ] **Step 1: 运行全部 Node 测试**

```powershell
$node='C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; $tests=Get-ChildItem -Recurse -File -Filter '*.test.js' features | Select-Object -ExpandProperty FullName; & $node --test $tests
```

Expected: 所有测试 PASS，fail 为 0。

- [ ] **Step 2: 执行 JavaScript 语法检查**

```powershell
$node='C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; & $node --check app.js; & $node --check features/course/course-model.js; & $node --check features/ui/course-workbench.js; & $node --check features/ui/space-panel.js; & $node --check features/ui/space-panel-events.js; & $node --check features/ui/view-switcher.js
```

Expected: 六个命令均退出 0。

- [ ] **Step 3: 启动本地静态服务并浏览器验收**

```powershell
& 'C:\Users\MR\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 5501 --bind 127.0.0.1
```

检查：首页不变；最左侧为六项课程轨道；情境侧栏紧邻轨道；无共建／规划开关；顶部显示村庄、空间、阶段和 2D／3D；设置抽屉可开关且原功能可见；2D／3D 切换不离开工作区；右侧不被全局留言板占用。

- [ ] **Step 4: 更新迭代日志**

在 `docs/PLATFORM_ITERATION_LOG.md` 顶部增加本轮目标、主要修改、影响文件、测试结果、未执行数据库迁移和后续阶段。

- [ ] **Step 5: 检查并提交**

```powershell
git diff --check
git status --short
git add docs/PLATFORM_ITERATION_LOG.md
git commit -m "docs: record task-context workspace phase one"
```

Expected: 差异检查无输出，状态只包含本计划列出的文件。
