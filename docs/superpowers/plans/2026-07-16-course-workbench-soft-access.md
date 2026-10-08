# Course Workbench Soft Access Implementation Plan

> **过程文档：** 本文件仅用于记录实施步骤、验证命令与数据库执行过程，不属于平台运行文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 放宽课程任务浏览与非共享进度操作，同时将管理员权限收紧到 `管理员 + 332`，并在指定 Supabase 项目执行课程工作台迁移。

**Architecture:** 在课程工作台渲染层区分“内容/进度操作”和“共享小组空间操作”；在独立权限模块统一判断管理员完整凭据，供主应用和后台复用。数据库沿用现有幂等 SQL，通过已登录的 Supabase SQL Editor 执行并查询验证。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js built-in test runner、Supabase SQL Editor。

## Global Constraints

- 所有课程阶段始终可查看，不按前置完成状态隐藏。
- 未加入小组不能进入共享小组 2D/3D 空间。
- 管理员凭据必须同时满足姓名 `管理员` 与第二凭据 `332`。
- 不删除或覆盖现有 Supabase 表和数据。
- 本计划和设计文件均标注为“过程文档”。

---

### Task 1: 课程任务软访问

**Files:**
- Modify: `features/ui/course-workbench.js`
- Test: `features/ui/course-workbench.test.js`

- [ ] 编写失败测试：无小组用户查看后续任务时仍出现完整说明与完成按钮，但不出现共享空间入口。
- [ ] 运行测试并确认因现有总开关而失败。
- [ ] 调整 `renderTaskActions`，仅对 `workspace` 与 `map_task` 的共享入口保留组限制，普通进度操作始终可用。
- [ ] 运行课程工作台测试并确认通过。

### Task 2: 管理员完整凭据

**Files:**
- Create: `features/auth/access-control.js`
- Create: `features/auth/access-control.test.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `auth-system.js`

- [ ] 编写失败测试：仅 `{name: "管理员", studentId: "332"}` 为管理员，同名不同凭据及普通账号均为普通用户。
- [ ] 实现 `AccessControlModule.isAdminUser(user)` 与 `isAdminCredential(name, credential)`。
- [ ] 将主应用、后台和默认管理员保护逻辑改为调用统一模块。
- [ ] 保留普通用户“学号”含义，并在登录界面提示管理员第二凭据为 `332`。
- [ ] 运行权限测试及 JavaScript 语法检查。

### Task 3: Supabase 迁移

**Files:**
- Use: `supabase_SQL/Task-driven Course Workbench Schema.sql`

- [ ] 在已登录控制台核对项目引用 `rzmbmwauomzwiyenafha`。
- [ ] 将完整幂等 SQL 放入 SQL Editor 并执行一次。
- [ ] 执行结构查询，验证五张课程表、课程种子数据及 `planning_spaces` 三个关联字段。
- [ ] 若浏览器控制不可用，保留代码改动并给出最短的手动执行步骤，不尝试其他项目。

### Task 4: 完整验证

- [ ] 运行全部 `features/course`、`features/ui`、`features/auth`、`features/admin` 测试。
- [ ] 对 `app.js`、`admin.js`、`auth-system.js` 及新增模块执行 `node --check`。
- [ ] 运行 `git diff --check` 并确认过程文档均包含“过程文档”标记。
