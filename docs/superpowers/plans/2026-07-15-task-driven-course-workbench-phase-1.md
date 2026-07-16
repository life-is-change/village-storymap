# Task-Driven Course Workbench Phase 1 Implementation Plan

> **过程文档：** 本文件仅用于记录实施步骤、验证命令与阶段进度，不属于平台运行文件。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重写现有 2D/3D 地图的前提下，为互动平台增加可运行的课程工作台、小组加入、任务导航、共享规划空间上下文和统一操作日志。

**Architecture:** 新增独立的 `features/course` 领域模块负责课程、分组、任务进度和事件记录，新增 `features/ui/course-workbench.js` 负责渲染学生端工作台。`app.js` 只提供当前用户、空间切换和 2D/3D 入口适配；Supabase 不可用时使用 localStorage 保证本地演示可运行。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js built-in test runner、Supabase JS、OpenLayers、Cesium。

## Global Constraints

- 首页 `homepage/` 不在本阶段修改。
- 保留现有 2D、3D、照片、评论、要素编辑和空间数据功能。
- 每名学生使用独立账号；小组成员共享规划空间，不共享账号。
- 学生通过组码自动加入；同一课程只能加入一个小组；锁组后仅管理员可调整。
- 行为日志只记录有教学研究意义的动作，不记录鼠标移动、连续地图拖动或逐次键盘输入。
- 新增界面文案使用简体中文。
- 所有新增过程文档必须在标题后标注“过程文档”。

---

### Task 1: Course domain model

**Files:**
- Create: `features/course/course-model.js`
- Create: `features/course/course-model.test.js`

**Interfaces:**
- Produces: `window.CourseModelModule` in browsers and CommonJS exports in Node tests.
- Produces: `DEFAULT_COURSE`, `normalizeCourseState`, `getOrderedStages`, `getNextTask`, `buildStudentKey`, `canJoinGroup`.

- [ ] **Step 1: Write the failing domain tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_COURSE,
  normalizeCourseState,
  getNextTask,
  buildStudentKey,
  canJoinGroup
} = require("./course-model.js");

test("default course follows the approved seven-stage workflow", () => {
  assert.deepEqual(DEFAULT_COURSE.stages.map((stage) => stage.key), [
    "group_join", "learning", "survey", "diagnosis", "design", "review", "submission"
  ]);
});

test("next task is the first incomplete ordered task", () => {
  const state = normalizeCourseState({ completedTaskIds: ["join-group", "learning-ready"] });
  assert.equal(getNextTask(DEFAULT_COURSE, state).id, "survey-collect");
});

test("student key keeps student id and name attributable", () => {
  assert.equal(buildStudentKey({ student_id: "2026001", name: "张三" }), "2026001::张三");
});

test("locked group rejects a student join", () => {
  assert.equal(canJoinGroup({ locked: true }, null), false);
});
```

- [ ] **Step 2: Run the domain tests and verify failure**

Run:

```powershell
node --test features/course/course-model.test.js
```

Expected: FAIL because `features/course/course-model.js` does not exist.

- [ ] **Step 3: Implement the course model**

Implement a UMD-style module with the approved default course:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseModelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_COURSE = {
    id: "mibu-village-planning",
    title: "米埗村规划实践",
    villageId: "mibu",
    stages: [
      { key: "group_join", title: "加入小组", taskIds: ["join-group"] },
      { key: "learning", title: "学习准备", taskIds: ["learning-ready"] },
      { key: "survey", title: "调研采集", taskIds: ["survey-collect"] },
      { key: "diagnosis", title: "现状诊断", taskIds: ["diagnosis-list"] },
      { key: "design", title: "方案设计", taskIds: ["design-workspace"] },
      { key: "review", title: "协作评审", taskIds: ["review-plan"] },
      { key: "submission", title: "成果提交", taskIds: ["submit-result"] }
    ],
    tasks: [
      { id: "join-group", stageKey: "group_join", title: "加入课程小组", action: "join_group" },
      { id: "learning-ready", stageKey: "learning", title: "完成首页学习准备", action: "confirm_learning" },
      { id: "survey-collect", stageKey: "survey", title: "整理调研照片与备注", action: "open_survey" },
      { id: "diagnosis-list", stageKey: "diagnosis", title: "形成现状问题清单", action: "open_diagnosis" },
      { id: "design-workspace", stageKey: "design", title: "编辑小组规划方案", action: "open_workspace" },
      { id: "review-plan", stageKey: "review", title: "开展小组协作评审", action: "open_review" },
      { id: "submit-result", stageKey: "submission", title: "提交小组成果", action: "open_submission" }
    ]
  };
  function normalizeCourseState(state = {}) {
    return { completedTaskIds: [...new Set(state.completedTaskIds || [])] };
  }
  function getOrderedStages(course = DEFAULT_COURSE) {
    return [...(course.stages || [])];
  }
  function getNextTask(course = DEFAULT_COURSE, state = {}) {
    const completed = new Set(normalizeCourseState(state).completedTaskIds);
    return (course.tasks || []).find((task) => !completed.has(task.id)) || null;
  }
  function buildStudentKey(user = {}) {
    return `${String(user.student_id || "").trim()}::${String(user.name || "").trim()}`;
  }
  function canJoinGroup(group, currentMembership) {
    return Boolean(group && !group.locked && !currentMembership);
  }
  return { DEFAULT_COURSE, normalizeCourseState, getOrderedStages, getNextTask, buildStudentKey, canJoinGroup };
});
```

- [ ] **Step 4: Run domain tests**

Run: `node --test features/course/course-model.test.js`

Expected: all tests PASS.

---

### Task 2: Course storage and group membership service

**Files:**
- Create: `features/course/course-service.js`
- Create: `features/course/course-service.test.js`
- Create: `supabase_SQL/Task-driven Course Workbench Schema.sql`

**Interfaces:**
- Consumes: `CourseModelModule.buildStudentKey(user)`.
- Produces: `window.CourseServiceModule.createCourseService(deps)`.
- Service methods: `loadContext(user)`, `listGroups()`, `createGroup(name)`, `joinGroup(code, user)`, `setGroupLocked(groupId, locked)`, `setTaskComplete(taskId, complete)`, `getProgress()`.

- [ ] **Step 1: Write failing service tests with an in-memory storage adapter**

```js
test("student joins a pre-created group by code", async () => {
  const service = createCourseService({ storage: createMemoryStorage(), now: () => "2026-07-15T00:00:00Z" });
  const group = await service.createGroup("第1小组", "ABC123");
  const context = await service.joinGroup("abc123", { name: "张三", student_id: "2026001" });
  assert.equal(context.group.id, group.id);
});

test("student cannot join a second group in the same course", async () => {
  const service = createCourseService({ storage: createMemoryStorage() });
  await service.createGroup("第1小组", "ABC123");
  await service.createGroup("第2小组", "DEF456");
  const user = { name: "张三", student_id: "2026001" };
  await service.joinGroup("ABC123", user);
  await assert.rejects(() => service.joinGroup("DEF456", user), { code: "COURSE_GROUP_CONFLICT" });
});

test("locked group rejects a new member", async () => {
  const service = createCourseService({ storage: createMemoryStorage() });
  const group = await service.createGroup("第1小组", "ABC123");
  await service.setGroupLocked(group.id, true);
  await assert.rejects(
    () => service.joinGroup("ABC123", { name: "李四", student_id: "2026002" }),
    { code: "GROUP_LOCKED" }
  );
});
```

- [ ] **Step 2: Run service tests and verify failure**

Run: `node --test features/course/course-service.test.js`

Expected: FAIL because the service is not implemented.

- [ ] **Step 3: Implement local-first course service**

Use localStorage keys scoped by course ID:

```js
const KEYS = {
  groups: (courseId) => `village_course_groups_v1:${courseId}`,
  memberships: (courseId) => `village_group_memberships_v1:${courseId}`,
  progress: (courseId) => `village_task_progress_v1:${courseId}`
};
```

Normalize group codes to uppercase, generate six-character codes without ambiguous characters, and keep the current user's membership attributable by `studentKey`. If `deps.supabaseClient` is available, mirror writes to Supabase; a remote failure must not erase the local state and must return `syncPending: true`.

- [ ] **Step 4: Add Supabase schema**

Create idempotent SQL with the following exact columns:

```sql
create table if not exists public.courses (
  id text primary key, title text not null, village_id text not null,
  stages jsonb not null default '[]'::jsonb, tasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.course_groups (
  id text primary key, course_id text not null references public.courses(id) on delete cascade,
  name text not null, join_code text not null unique, locked boolean not null default false,
  space_id text, created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.group_memberships (
  id bigint generated by default as identity primary key,
  course_id text not null references public.courses(id) on delete cascade,
  group_id text not null references public.course_groups(id) on delete cascade,
  student_key text not null, student_name text not null, student_id text,
  role text not null default 'member', joined_at timestamptz not null default now(),
  unique(course_id, student_key)
);
create table if not exists public.task_progress (
  id bigint generated by default as identity primary key,
  course_id text not null references public.courses(id) on delete cascade,
  student_key text not null, group_id text, task_id text not null,
  completed boolean not null default false, completed_at timestamptz,
  updated_at timestamptz not null default now(), unique(course_id, student_key, task_id)
);
create table if not exists public.activity_events (
  event_id text primary key, client_event_id text not null unique,
  occurred_at timestamptz not null default now(), student_key text,
  student_name text, course_id text, group_id text, task_id text, space_id text,
  action text not null, target_type text, target_id text, view_mode text,
  metadata jsonb not null default '{}'::jsonb
);
```

Seed the `mibu-village-planning` course and its seven stages/tasks. Add indexes for `course_id`, `group_id`, `student_key`, `occurred_at`, and `action`. Do not delete or rewrite existing project tables.

- [ ] **Step 5: Run service tests**

Run: `node --test features/course/course-service.test.js`

Expected: all tests PASS.

---

### Task 3: Append-only activity logger

**Files:**
- Create: `features/course/activity-logger.js`
- Create: `features/course/activity-logger.test.js`

**Interfaces:**
- Produces: `window.ActivityLoggerModule.createActivityLogger(deps)`.
- Logger methods: `record(action, target, metadata)`, `flush()`, `listLocalEvents(filters)`.
- Event shape: `{ eventId, clientEventId, occurredAt, actor, courseId, groupId, taskId, spaceId, action, targetType, targetId, viewMode, metadata, syncStatus }`.

- [ ] **Step 1: Write failing logger tests**

```js
test("record appends two actions instead of overwriting", async () => {
  const logger = createActivityLogger({ storage: createMemoryStorage(), uuid: sequentialUuid() });
  await logger.record("view_switched", { type: "workspace", id: "space-1" }, { viewMode: "2d" });
  await logger.record("view_switched", { type: "workspace", id: "space-1" }, { viewMode: "3d" });
  assert.equal(logger.listLocalEvents().length, 2);
});

test("flush keeps failed events pending and de-duplicates successful retries", async () => {
  let attempts = 0;
  const remote = {
    async insert(event) {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return event.clientEventId;
    }
  };
  const logger = createActivityLogger({ storage: createMemoryStorage(), remote, uuid: () => "event-1" });
  await logger.record("task_started", { type: "task", id: "survey-collect" }, {});
  await logger.flush();
  assert.equal(logger.listLocalEvents()[0].syncStatus, "pending");
  await logger.flush();
  assert.equal(logger.listLocalEvents().length, 1);
  assert.equal(logger.listLocalEvents()[0].syncStatus, "synced");
});
```

- [ ] **Step 2: Run logger tests and verify failure**

Run: `node --test features/course/activity-logger.test.js`

Expected: FAIL because the logger is not implemented.

- [ ] **Step 3: Implement append-only local queue and Supabase flush**

Use `village_activity_events_v1` for the queue. Record only explicit calls. Supabase inserts must use `client_event_id` as the conflict key. Never mutate a previously successful event except to set local `syncStatus: "synced"`.

- [ ] **Step 4: Run logger tests**

Run: `node --test features/course/activity-logger.test.js`

Expected: all tests PASS.

---

### Task 4: Student course workbench UI

**Files:**
- Create: `features/ui/course-workbench.js`
- Create: `features/ui/course-workbench.test.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: `CourseModelModule`, `CourseServiceModule`, `ActivityLoggerModule`.
- Produces: `window.CourseWorkbenchModule.createCourseWorkbench(deps)`.
- Workbench methods: `init()`, `showDashboard()`, `showTask(taskId)`, `refresh()`, `destroy()`.
- `deps.openPlanningWorkspace(viewMode)` adapts to existing `handleSpaceSelect`, `switchTo2DView`, and `switchTo3DView` without importing map internals.

- [ ] **Step 1: Write failing renderer tests**

Test pure HTML helpers:

```js
test("dashboard emphasizes exactly one next action", () => {
  const html = renderDashboard({ course, context, nextTask });
  assert.match(html, /data-course-primary-action/);
  assert.equal((html.match(/data-course-primary-action/g) || []).length, 1);
});

test("student without a group sees the join form before map tools", () => {
  const html = renderDashboard({ course, context: { group: null }, nextTask });
  assert.match(html, /data-group-join-form/);
  assert.doesNotMatch(html, /data-open-workspace/);
});
```

- [ ] **Step 2: Run workbench tests and verify failure**

Run: `node --test features/ui/course-workbench.test.js`

Expected: FAIL because the workbench module is not implemented.

- [ ] **Step 3: Add the workbench view to `index.html`**

Add `#courseWorkbenchView` before `#plan2dView`. Add focused script tags before `app.js` in this order:

```html
<script src="features/course/course-model.js"></script>
<script src="features/course/course-service.js"></script>
<script src="features/course/activity-logger.js"></script>
<script src="features/ui/course-workbench.js"></script>
```

The left panel becomes task navigation when the workbench is active, while the existing space panel remains available inside the “小组空间” task.

- [ ] **Step 4: Implement course workbench rendering and actions**

Render:

- current course, village, student and group;
- seven-stage progress rail;
- one primary “下一项任务” card;
- group code form when no membership exists;
- task description and completion action;
- “进入 2D / 进入 3D” actions only for the design task;
- recent local activity list limited to meaningful actions.

Every primary action calls `logger.record(action, target, metadata)`. Display local-first success and a non-blocking “等待同步” marker when Supabase is unavailable.

- [ ] **Step 5: Integrate into `app.js`**

Change the homepage “进入互动平台” action to:

```js
await courseWorkbench.refresh();
courseWorkbench.showDashboard();
switchMainView("courseWorkbench");
```

Extend `switchMainView` to activate `courseWorkbenchView`. Preserve `showVillageOverview()`, `plan2dView`, and `model3dView`. Adapt the design task to select the current group workspace before entering 2D/3D.

- [ ] **Step 6: Add responsive styles**

Add `.course-workbench-*` styles using the existing green/white visual language. At desktop width show stage navigation and task content side-by-side; under 900px stack them. Do not change homepage styles.

- [ ] **Step 7: Run unit tests and syntax checks**

Run:

```powershell
node --test features/course/*.test.js features/ui/course-workbench.test.js
node --check features/course/course-model.js
node --check features/course/course-service.js
node --check features/course/activity-logger.js
node --check features/ui/course-workbench.js
node --check app.js
```

Expected: all tests pass and all syntax checks exit 0.

---

### Task 5: Admin group and activity panels

**Files:**
- Create: `features/admin/course-admin.js`
- Create: `features/admin/course-admin.test.js`
- Modify: `admin.html`
- Modify: `admin.js`

**Interfaces:**
- Consumes: the same course/group/event records created by Tasks 2 and 3.
- Produces: `window.CourseAdminModule.renderGroups`, `renderActivityRows`, `filterActivityEvents`, `exportEventsCsv`.

- [ ] **Step 1: Write failing admin helper tests**

```js
test("activity export contains actor, group, task, action and time", () => {
  const csv = exportEventsCsv([sampleEvent]);
  assert.match(csv, /student_key,group_id,task_id,action,occurred_at/);
});

test("group filter returns only selected group events", () => {
  assert.deepEqual(filterActivityEvents(events, { groupId: "group-1" }).map((e) => e.groupId), ["group-1"]);
});
```

- [ ] **Step 2: Run admin tests and verify failure**

Run: `node --test features/admin/course-admin.test.js`

Expected: FAIL because the module is not implemented.

- [ ] **Step 3: Add admin tabs**

Add “课程小组”和“操作记录” to the existing admin sidebar. The group panel supports create group, copy group code, lock/unlock, and member list. The activity panel supports filters for student, group, task, action and date, plus CSV export.

- [ ] **Step 4: Implement local/Supabase reads and actions**

Reuse `CourseServiceModule` and `ActivityLoggerModule` rather than duplicating storage keys. Admin operations must record `group_created`, `group_locked`, `group_unlocked`, and `member_moved` events when an actor is available.

- [ ] **Step 5: Run admin and complete test suite**

Run:

```powershell
node --test features/course/*.test.js features/ui/course-workbench.test.js features/admin/course-admin.test.js
node --check admin.js
```

Expected: all tests pass and syntax checks exit 0.

---

### Task 6: Integrated verification

**Files:**
- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Verify clean boot without Supabase**

Open the platform with Supabase unavailable. Confirm login still works locally, group creation/joining persists in localStorage, the workbench opens, and pending events are visible without uncaught errors.

- [ ] **Step 2: Verify the approved student path**

Use two student accounts:

1. Admin creates “第1小组”.
2. Both students join with the same code using separate accounts.
3. Each sees the same group workspace.
4. Student A completes learning preparation and opens the 2D design view.
5. Student B opens the 3D view.
6. Personal activity lists remain attributable to the correct account.

- [ ] **Step 3: Verify existing capabilities did not regress**

Confirm 2D layers, 3D terrain/orthophoto, element selection/editing, photo upload, comments, panel collapse and return-to-home remain usable.

- [ ] **Step 4: Verify admin research view**

Confirm groups can be locked/unlocked, events can be filtered, and CSV export opens with UTF-8 Chinese content and one row per meaningful action.

- [ ] **Step 5: Review the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended course workbench, admin, SQL, tests, styles, process-document labels and implementation files are changed.
