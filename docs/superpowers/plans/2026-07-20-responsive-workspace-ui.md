# Responsive Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正左右栏任意开合时的顶部布局，并重构紧凑的项目设置与班级留言视觉。

**Architecture:** 继续使用现有固定工作区栏和项目设置抽屉，通过明确的宽度优先级与容器状态进行响应式压缩。问题标记和班级讨论复用现有业务函数，只调整入口与呈现层，不迁移数据表。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js `node:test`。

## Global Constraints

- 直接修改当前 `master` 工作区，不创建分支、提交或备份。
- 不修改首页。
- 不修改 Supabase 表结构。
- 保留现有 2D/3D、照片、留言、点赞、回复与定位功能。

---

### Task 1: 顶部单行自适应

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Test: `features/ui/workspace-responsive-layout.test.js`

- [ ] 写测试，验证顶部移除 `reportProblemBtn`、保留 `classDiscussionBtn`，并存在双侧栏展开时的紧凑样式。
- [ ] 运行测试并确认因现有结构不符而失败。
- [ ] 压缩阶段信息和空间选择器，将设置按钮改为可按宽度隐藏文字的单行控件。
- [ ] 运行测试并确认通过。

### Task 2: 设置抽屉结构与入口拆分

**Files:**
- Modify: `features/ui/space-panel.js`
- Modify: `app.js`
- Modify: `style.css`
- Test: `features/ui/workspace-settings-collaboration.test.js`

- [ ] 写测试，验证空间工具位于问题与留言之前，抽屉具有独立的标记问题和班级讨论按钮。
- [ ] 运行测试并确认因现有混合按钮与模块顺序而失败。
- [ ] 将抽屉缩为 320px，调换模块顺序并绑定两个独立入口。
- [ ] 运行测试并确认通过。

### Task 3: 班级留言卡片视觉

**Files:**
- Modify: `style.css`
- Test: `features/ui/community-message-visual.test.js`

- [ ] 写测试，验证作者、时间、正文、操作按钮和回复区的字体与间距规则。
- [ ] 运行测试并确认缺失目标规则。
- [ ] 增加仅作用于项目设置抽屉留言区的卡片样式。
- [ ] 运行测试并确认通过。

### Task 4: 整体验证与迭代记录

**Files:**
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

- [ ] 运行 `node --check app.js`。
- [ ] 运行全部 `features/**/*.test.js` 与首页地图测试。
- [ ] 在迭代日志中记录顶部响应式、抽屉重组与留言视觉修改。
- [ ] 检查 `git status --short`，确认没有自动提交。

