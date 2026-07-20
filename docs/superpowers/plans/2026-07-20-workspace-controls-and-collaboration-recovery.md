# Workspace Controls and Collaboration Recovery Implementation Plan

> **过程文档｜实施计划**
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`. 本任务按用户要求直接在当前 master 工作区实施，不创建分支或 Git 提交。

**Goal:** 修复任务情境栏、顶部栏和右栏的展开联动，并恢复空间管理、对象照片、对象讨论、问题标记与班级讨论的可发现入口。

**Architecture:** 保留现有 OpenLayers、Cesium、Supabase 服务和统一工作区结构。`index.html` 只提供稳定入口，`style.css` 管理面板几何，`space-panel.js` 负责空间/图层设置内容，`app.js` 接线已有功能；对象评论逻辑放入独立模块，避免继续扩大页面渲染函数。

**Tech Stack:** 原生 HTML/CSS/JavaScript、OpenLayers、Cesium、Supabase JS、Node.js `node:test`。

## Global Constraints

- 当前工作区已有未提交修改，必须原位保留并叠加实现。
- 不修改首页内容，不执行 Supabase SQL，不删除生产数据。
- 不创建 Git 分支、提交或标签；完成后只更新平台迭代日志。
- 新行为先写失败测试，再做最小实现。

---

### Task 1: 修复课程栏、顶部栏与右栏几何

**Files:**
- Modify: `style.css`
- Modify: `index.html`
- Test: `features/ui/workspace-shell-regression.test.js`

- [ ] 写测试，要求展开情境栏保持固定宽度和紧凑头部，并要求后置样式显式覆盖 `mode-map-right-collapsed` 的右栏宽度。
- [ ] 运行测试确认因缺少后置右栏覆盖及紧凑头部规则而失败。
- [ ] 合并重复课程栏规则，统一顶部高度；让右栏按钮和顶部栏使用同一个实际 `--right-panel-width`。
- [ ] 运行测试确认通过。

### Task 2: 把空间管理移到顶部并修正权限

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/space-panel-events.js`
- Test: `features/ui/workspace-space-management.test.js`

- [ ] 写测试，要求空间选择器旁存在新增、重命名、删除按钮，设置抽屉不再重复渲染它们，并要求管理员可管理任意非系统空间。
- [ ] 运行测试确认失败。
- [ ] 在顶部渲染三按钮并复用现有创建、重命名、删除流程；系统空间始终禁用重命名/删除。
- [ ] 普通学生只能管理自己创建的空间；管理员可管理全部非系统空间。
- [ ] 运行测试确认通过。

### Task 3: 恢复问题标记与班级讨论的常驻入口

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Test: `features/ui/workspace-collaboration-entry.test.js`

- [ ] 写测试，要求顶部存在“标记问题”和“班级讨论”入口，并分别调用现有点标记流程、打开设置抽屉中的班级留言区。
- [ ] 运行测试确认失败。
- [ ] 接线 `startCommunityTaskReport()`，支持从“标记问题”入口预设必须选择问题类型并随后地图选点。
- [ ] 班级讨论按钮打开抽屉并展开“问题与留言”，保留作者、时间、图片、点赞、回复和定位卡片。
- [ ] 运行测试确认通过。

### Task 4: 恢复跨空间建筑照片与对象讨论

**Files:**
- Create: `features/object-collaboration/object-comments.js`
- Create: `features/object-collaboration/object-comments.test.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Test: `features/ui/object-collaboration-panel.test.js`

- [ ] 写失败测试，要求规划空间中的建筑同样显示共享照片上传区，并要求右侧对象区包含讨论列表和发布入口。
- [ ] 为 `object_comments` 实现列表和新增；用 `object_attribute_edits` 的 `object_comment_interactions` 命名空间保存点赞与回复。
- [ ] 在 `showObjectInfo()` 中渲染属性、照片、讨论和修改历史区块，并记录评论、点赞与回复行为。
- [ ] 运行对象协作测试确认通过。

### Task 5: 回归、视觉验证与迭代日志

**Files:**
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

- [ ] 运行全部 JavaScript 语法检查及 `features/**/*.test.js`。
- [ ] 使用 Edge 验证左右栏展开/收起、顶部空间按钮、对象照片/讨论、问题标记和班级留言入口。
- [ ] 更新平台迭代日志，记录根因、改动、验证与未涉及数据库迁移。
- [ ] 清理浏览器验证临时文件，保持所有代码为未提交状态。
