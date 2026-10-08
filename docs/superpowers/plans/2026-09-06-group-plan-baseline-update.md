# Group Plan Baseline Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为正式村庄建立唯一的小组方案空间，以冻结现状为基线保存稀疏方案覆盖，并支持安全的基线更新、三方合并、冲突和恢复。

**Architecture:** `planning_spaces.base_snapshot_id` 保存当前不可变基线，`planning_features` 只保存小组新增、更新和删除墓碑；一个服务端解析 RPC 向 2D、3D 和统计返回统一有效方案。基线更新由空间级事务完成，使用旧基线、小组覆盖和新基线进行三方合并，并把冲突、恢复点和操作历史保存在独立结构中。

**Tech Stack:** PostgreSQL/Supabase、RLS、Security Definer RPC、Supabase Realtime、原生 JavaScript UMD 模块、Node.js `node:test`、现有 2D 地图与 Cesium 3D 运行时。

**Spec:** `docs/superpowers/specs/2026-09-06-group-plan-baseline-update-design.md`

## Global Constraints

- 每个 `(teaching_project_id, village_id, group_id)` 最多一个活动 `group_plan`。
- 米埗村和其他练习村庄不得创建 `group_plan`。
- 新冻结版本不得自动更新已有小组空间的 `base_snapshot_id`。
- 学生只能访问本小组方案；管理员通过后台临时管理上下文访问，不把所有小组空间放入普通空间选择器。
- 建筑、道路、水体可增删改；影像、村界和等高线只读。
- 基线更新默认保留小组覆盖，冲突不阻塞整个更新。
- 所有授权从 `auth.uid()`、项目成员关系和 RLS 推导，不信任客户端提交的用户身份或管理员标志。
- 不创建新的 npm 或 Python 依赖，不伪造正式村庄、学生或小组业务数据。
- 计划与设计文档按用户要求保留在工作区但不提交 Git；代码与迁移可以正常提交。

---

## File Structure

- Create `supabase_SQL/Group Plan Baseline Update.sql`: 阶段 3 表、索引、RLS、空间生命周期、解析、更新、冲突解决与恢复 RPC。
- Create `features/data/group-plan-baseline-migration.test.js`: SQL 结构、授权、事务和幂等契约测试。
- Create `features/data/group-plan-resolver.js`: 规范化服务端解析结果、只读图层策略和本地纯函数合并模型。
- Create `features/data/group-plan-resolver.test.js`: 稀疏覆盖、墓碑和图层权限测试。
- Create `features/data/group-baseline-client.js`: 小组空间、差异、更新、冲突、恢复点 RPC 客户端。
- Create `features/data/group-baseline-client.test.js`: RPC 参数、上下文和错误传播测试。
- Create `features/ui/group-baseline-panel.js`: 学生端方案基线面板状态与交互。
- Create `features/ui/group-baseline-panel.test.js`: 空状态、差异、确认、冲突和重连渲染测试。
- Create `features/admin/group-plan-admin.js`: 管理员小组方案列表、临时管理入口、代更新和恢复控制器。
- Create `features/admin/group-plan-admin.test.js`: 管理员页面与权限边界测试。
- Create `features/integration/group-plan-flow.test.js`: 生命周期、编辑、基线更新及 2D/3D 一致性的跨模块测试。
- Modify `supabase_SQL/Shared Survey Calibration and Freeze.sql`: 冻结成功后调用幂等的小组空间确保流程。
- Modify `features/data/feature-edit-session.js`: 小组方案保存携带预期修订并复用既有保存入口。
- Modify `features/data/feature-edit-session.test.js`: 小组覆盖写入和只读图层门禁测试。
- Modify `features/villages/village-model.js`: 管理员普通工作区也只显示本人相关逻辑空间。
- Modify `features/villages/village-model.test.js`: 管理员不自动看见全部小组空间。
- Modify `features/course/course-workspace-adapter.js`: 统一遗留 `course_group` 与正式 `group_plan` 映射。
- Modify `features/course/course-workspace-adapter.test.js`: 唯一空间和基线可用性测试。
- Modify `features/ui/space-panel.js`: 三个逻辑空间的稳定标签和基线徽标。
- Modify `features/ui/workspace-space-management.test.js`: 空间选择器回归。
- Modify `admin.html`, `admin.js`, `admin.css`: 管理员“小组方案”后台入口及布局。
- Modify `index.html`, `app.js`, `style.css`: 学生端基线面板、统一方案加载和更新刷新。
- Modify `app-3d.js`: 3D 使用已解析的小组方案，并在 GLB 失败时保留白模。
- Modify `features/3d/3d-runtime-integration.test.js`: 3D 方案上下文与回退测试。
- Modify `supabase_SQL/Realtime Publication Setup.sql`: 阶段 3 更新与冲突表的幂等 Realtime 登记。

---

### Task 1: 阶段 3 数据结构、约束与 RLS

**Files:**
- Create: `supabase_SQL/Group Plan Baseline Update.sql`
- Create: `features/data/group-plan-baseline-migration.test.js`

**Interfaces:**
- Consumes: `planning_spaces`, `planning_features`, `feature_snapshots`, `feature_snapshot_items`, `course_groups`, `group_memberships`, `activity_events`, `current_profile_role()`, `current_profile_student_key()`。
- Produces: `group_baseline_updates`, `group_baseline_conflicts`, `group_plan_restore_points`；规范化的 `planning_features.operation_kind/base_object_code/base_snapshot_id/feature_revision` 字段。

- [ ] **Step 1: 写数据结构和唯一约束失败测试**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "../../supabase_SQL/Group Plan Baseline Update.sql"), "utf8");

test("group plan schema stores sparse overrides and baseline history", () => {
  assert.match(sql, /create table if not exists public\.group_baseline_updates/i);
  assert.match(sql, /create table if not exists public\.group_baseline_conflicts/i);
  assert.match(sql, /create table if not exists public\.group_plan_restore_points/i);
  assert.match(sql, /operation_kind[\s\S]*?check[\s\S]*?'added'[\s\S]*?'updated'[\s\S]*?'deleted'/i);
  assert.match(sql, /base_object_code/i);
  assert.match(sql, /feature_revision/i);
});

test("one project village and group has one active group plan", () => {
  assert.match(sql, /create unique index[\s\S]*?planning_spaces[\s\S]*?teaching_project_id[\s\S]*?village_id[\s\S]*?group_id[\s\S]*?space_type\s*=\s*'group_plan'/i);
});
```

- [ ] **Step 2: 运行测试并确认因 SQL 文件或结构缺失而失败**

Run: `node --test features/data/group-plan-baseline-migration.test.js`  
Expected: FAIL，缺少阶段 3 SQL 文件或表结构。

- [ ] **Step 3: 创建幂等表、列、约束和索引**

SQL 必须使用 `create table if not exists`、`add column if not exists` 和带名称检查的约束创建。核心字段固定为：

```sql
alter table public.planning_features
  add column if not exists operation_kind text,
  add column if not exists base_object_code text,
  add column if not exists base_snapshot_id uuid references public.feature_snapshots(id) on delete restrict,
  add column if not exists feature_revision bigint not null default 0;

create table if not exists public.group_baseline_updates (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete cascade,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  group_id text not null,
  from_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  to_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  status text not null check (status in ('running','completed','failed','restored')),
  stats jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
```

`group_baseline_conflicts` 固定引用 `update_id`、`layer_key`、`object_code`、`conflict_type`、`baseline_change`、`group_change`、`resolution_status`、`resolution_payload`、`resolved_by`、`resolved_at`。`group_plan_restore_points` 固定保存 `space_id`、`baseline_snapshot_id`、`overrides jsonb`、`source_update_id`、`created_by`、`created_at`。

- [ ] **Step 4: 写 RLS 和授权失败测试**

```js
test("phase three tables are private to group members and staff", () => {
  for (const table of ["group_baseline_updates", "group_baseline_conflicts", "group_plan_restore_points"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /group_memberships/i);
  assert.match(sql, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(sql, /revoke all on table public\.group_baseline_conflicts from anon/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
});
```

- [ ] **Step 5: 实现 RLS、触发器保护和安全索引**

三张新表开启 RLS。读取策略允许目标小组有效成员和 staff；直接写入只允许受控 RPC 的 owner 路径。为 `(space_id, created_at desc)`、`(update_id, resolution_status)`、`(space_id, layer_key, object_code)` 建索引。匿名角色撤销全部权限，`authenticated` 只获得设计需要的 `select`，不授予直接修改基线和冲突的权限。

- [ ] **Step 6: 运行 SQL 契约测试和现有安全回归**

Run: `node --test features/data/group-plan-baseline-migration.test.js features/data/planning-space-security.test.js features/data/multi-village-security.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交数据结构**

```powershell
git add "supabase_SQL/Group Plan Baseline Update.sql" features/data/group-plan-baseline-migration.test.js
git commit -m "feat: add group plan baseline schema"
```

---

### Task 2: 唯一小组空间生命周期

**Files:**
- Modify: `supabase_SQL/Group Plan Baseline Update.sql`
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Modify: `features/data/group-plan-baseline-migration.test.js`
- Modify: `features/course/course-workspace-adapter.js`
- Modify: `features/course/course-workspace-adapter.test.js`

**Interfaces:**
- Consumes: 推荐冻结快照、正式村庄项目、小组成员和既有 `ensure_project_space(...)`。
- Produces: `ensure_group_plan_space(p_teaching_project_id uuid,p_village_id uuid,p_group_id text,p_snapshot_id uuid default null) returns jsonb`；`ensure_group_plan_spaces_for_snapshot(p_snapshot_id uuid) returns jsonb`。

- [ ] **Step 1: 写空间生命周期失败测试**

```js
test("group space lifecycle is idempotent and rejects practice villages", () => {
  assert.match(sql, /create or replace function public\.ensure_group_plan_space/i);
  assert.match(sql, /PRACTICE_GROUP_SPACE_FORBIDDEN/i);
  assert.match(sql, /recommended_for_groups/i);
  assert.match(sql, /on conflict[\s\S]*?do nothing/i);
});

test("later freezes never rewrite existing group baselines", () => {
  const freezeSql = fs.readFileSync(path.join(__dirname, "../../supabase_SQL/Shared Survey Calibration and Freeze.sql"), "utf8");
  assert.match(freezeSql, /ensure_group_plan_spaces_for_snapshot/i);
  assert.doesNotMatch(freezeSql, /update\s+public\.planning_spaces[\s\S]*?base_snapshot_id\s*=\s*v_snapshot/i);
});
```

- [ ] **Step 2: 运行测试并确认生命周期 RPC 缺失**

Run: `node --test features/data/group-plan-baseline-migration.test.js`  
Expected: FAIL，缺少 `ensure_group_plan_space`。

- [ ] **Step 3: 实现单小组幂等确保 RPC**

RPC 必须：验证项目正式村庄；验证目标小组属于该课程；目标快照属于相同项目、村庄和 `formal_shared`；未指定快照时选择最新推荐快照；使用 advisory lock 和唯一索引避免重复；已有空间时返回 `created:false` 且不改基线。

返回结构固定为：

```json
{"space_id":"...","group_id":"...","base_snapshot_id":"...","created":true,"status":"created"}
```

没有可用快照返回 `status:'waiting_for_snapshot'`，不创建空基线空间。

- [ ] **Step 4: 实现冻结后的批量确保和失败摘要**

`ensure_group_plan_spaces_for_snapshot` 遍历项目现有小组，逐项调用内部确保逻辑，返回：

```json
{"created":3,"existing":2,"failed":[],"snapshot_id":"..."}
```

批量过程允许对失败小组再次重试，但任何成功行都受唯一约束保护。`freeze_shared_survey_snapshot` 在快照提交前后采用同一数据库调用链触发该流程，并把摘要写入冻结结果；不得更新已有空间基线。

- [ ] **Step 5: 统一浏览器本地映射为 `group_plan`**

在 `course-workspace-adapter.js` 中把服务端 `group_plan` 作为正式值；读取遗留 `course_group` 时只做兼容归一化：

```js
function normalizeGroupSpaceType(value) {
  return value === "course_group" ? "group_plan" : value;
}
```

`buildGroupPlanningSpace` 必须接收 `baseSnapshotId` 并在没有基线时抛出 `GROUP_BASELINE_REQUIRED`，不再在浏览器中凭 `group.spaceId` 自行造出无基线空间。

- [ ] **Step 6: 运行生命周期与工作区测试**

Run: `node --test features/data/group-plan-baseline-migration.test.js features/course/course-workspace-adapter.test.js features/course/course-service.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交空间生命周期**

```powershell
git add "supabase_SQL/Group Plan Baseline Update.sql" "supabase_SQL/Shared Survey Calibration and Freeze.sql" features/data/group-plan-baseline-migration.test.js features/course/course-workspace-adapter.js features/course/course-workspace-adapter.test.js
git commit -m "feat: create group spaces from frozen surveys"
```

---

### Task 3: 稀疏覆盖解析与图层能力

**Files:**
- Create: `features/data/group-plan-resolver.js`
- Create: `features/data/group-plan-resolver.test.js`
- Modify: `supabase_SQL/Group Plan Baseline Update.sql`
- Modify: `features/data/group-plan-baseline-migration.test.js`

**Interfaces:**
- Consumes: `feature_snapshot_items` 基线与 `planning_features` 最新覆盖。
- Produces: `resolve_group_plan_features(p_teaching_project_id uuid,p_village_id uuid,p_space_id text,p_layer_key text default null) returns setof jsonb`；JS `resolveSparsePlan({baselineItems,overrides})`、`canEditGroupLayer(layerKey)`。

- [ ] **Step 1: 写纯函数解析失败测试**

```js
const { resolveSparsePlan, canEditGroupLayer } = require("./group-plan-resolver.js");

test("sparse group overrides replace hide and append baseline objects", () => {
  const result = resolveSparsePlan({
    baselineItems: [
      { layer_key: "building", object_code: "B1", props: { height: 9 } },
      { layer_key: "road", object_code: "R1", props: {} }
    ],
    overrides: [
      { operation_kind: "updated", layer_key: "building", base_object_code: "B1", object_code: "B1", props: { height: 12 }, feature_revision: 1 },
      { operation_kind: "deleted", layer_key: "road", base_object_code: "R1", object_code: "R1", feature_revision: 1 },
      { operation_kind: "added", layer_key: "water", object_code: "GW1", props: {}, feature_revision: 1 }
    ]
  });
  assert.deepEqual(result.map((row) => [row.layer_key, row.object_code]), [["building", "B1"], ["water", "GW1"]]);
  assert.equal(result[0].props.height, 12);
});

test("only building road and water are editable in group plan", () => {
  assert.equal(canEditGroupLayer("building"), true);
  assert.equal(canEditGroupLayer("road"), true);
  assert.equal(canEditGroupLayer("water"), true);
  assert.equal(canEditGroupLayer("contours"), false);
  assert.equal(canEditGroupLayer("imagery"), false);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node --test features/data/group-plan-resolver.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现确定性的 JS 解析器**

按 `feature_revision` 和 `updated_at` 选择同一对象最新覆盖。`updated` 替换基线，`deleted` 隐藏，`added` 追加。返回按 `layer_key/object_code` 排序，便于测试和缓存比较；任何未知 `operation_kind` 抛出 `GROUP_OVERRIDE_OPERATION_INVALID`。

- [ ] **Step 4: 写服务端解析和安全失败测试**

```js
test("resolved group plan comes from server facts and validates membership", () => {
  assert.match(sql, /create or replace function public\.resolve_group_plan_features/i);
  assert.match(sql, /feature_snapshot_items/i);
  assert.match(sql, /planning_features/i);
  assert.match(sql, /group_memberships/i);
  assert.match(sql, /base_snapshot_id/i);
  assert.doesNotMatch(sql, /p_user_id/i);
});
```

- [ ] **Step 5: 实现服务端解析 RPC**

RPC 锁定上下文为 `group_plan`，验证当前组员或 staff，读取空间 `base_snapshot_id`，对三类可编辑层合并覆盖，对只读参照层返回基线或村庄数据集引用。结果每行包含：

```json
{"layer_key":"building","object_code":"B1","geom":{},"props":{},"source":"baseline|group_override","operation_kind":"updated|null","feature_revision":1}
```

- [ ] **Step 6: 运行解析与迁移测试**

Run: `node --test features/data/group-plan-resolver.test.js features/data/group-plan-baseline-migration.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交解析器**

```powershell
git add features/data/group-plan-resolver.js features/data/group-plan-resolver.test.js "supabase_SQL/Group Plan Baseline Update.sql" features/data/group-plan-baseline-migration.test.js
git commit -m "feat: resolve sparse group plan features"
```

---

### Task 4: 小组方案编辑写入与并发控制

**Files:**
- Modify: `supabase_SQL/Group Plan Baseline Update.sql`
- Modify: `features/data/group-plan-baseline-migration.test.js`
- Modify: `features/data/feature-edit-session.js`
- Modify: `features/data/feature-edit-session.test.js`

**Interfaces:**
- Consumes: `save_feature_edit_batch`、`feature_edit_locks`、小组解析结果的 `feature_revision`。
- Produces: `save_group_plan_edit_batch(...) returns jsonb`；JS `saveGroupPlanEditBatch(deps,payload)`。

- [ ] **Step 1: 写客户端写入失败测试**

```js
test("group plan save sends context and expected revisions to dedicated RPC", async () => {
  const calls = [];
  const deps = {
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "group_plan" }),
    getSupabaseClient: () => ({ rpc: async (name, args) => (calls.push({ name, args }), { data: { saved: 1 }, error: null }) })
  };
  await saveGroupPlanEditBatch(deps, {
    editorName: "张三",
    changes: [{ layerKey: "building", action: "update", objectCode: "B1", expectedRevision: 2, geom: {}, props: { height: 12 } }]
  });
  assert.equal(calls[0].name, "save_group_plan_edit_batch");
  assert.equal(calls[0].args.p_changes[0].expectedRevision, 2);
});
```

- [ ] **Step 2: 运行测试并确认新保存接口缺失**

Run: `node --test features/data/feature-edit-session.test.js`  
Expected: FAIL，`saveGroupPlanEditBatch` 未定义。

- [ ] **Step 3: 实现客户端上下文和图层门禁**

`saveGroupPlanEditBatch` 只接受 `spaceType:'group_plan'`，并在调用 RPC 前通过 `canEditGroupLayer` 拒绝 `contours/imagery/boundary`。每项变化必须包含 `action`、`layerKey`、`objectCode` 和 `expectedRevision`；修改基线对象必须带 `baseObjectCode`。

- [ ] **Step 4: 写数据库并发和授权失败测试**

```js
test("group edit rpc checks group membership locks revisions and allowed layers", () => {
  assert.match(sql, /create or replace function public\.save_group_plan_edit_batch/i);
  assert.match(sql, /GROUP_LAYER_READ_ONLY/i);
  assert.match(sql, /FEATURE_REVISION_CONFLICT/i);
  assert.match(sql, /feature_edit_locks/i);
  assert.match(sql, /group_memberships/i);
  assert.match(sql, /auth\.uid\(\)/i);
});
```

- [ ] **Step 5: 实现原子稀疏覆盖写入 RPC**

RPC 校验小组成员、正式村庄、空间类型、允许图层、对象锁令牌与预期修订。新增生成服务端对象编码；更新写入或推进 `updated` 覆盖；删除基线对象写 `deleted` 墓碑；删除小组新增对象也保留删除历史。批次、版本、活动日志和覆盖必须同一事务提交。

- [ ] **Step 6: 运行编辑、锁和历史回归**

Run: `node --test features/data/feature-edit-session.test.js features/data/group-plan-baseline-migration.test.js features/ui/workspace-edit-history.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交小组编辑**

```powershell
git add "supabase_SQL/Group Plan Baseline Update.sql" features/data/group-plan-baseline-migration.test.js features/data/feature-edit-session.js features/data/feature-edit-session.test.js
git commit -m "feat: save collaborative group plan overrides"
```

---

### Task 5: 基线差异、三方合并、冲突和恢复点

**Files:**
- Create: `features/data/group-baseline-client.js`
- Create: `features/data/group-baseline-client.test.js`
- Modify: `supabase_SQL/Group Plan Baseline Update.sql`
- Modify: `features/data/group-plan-baseline-migration.test.js`

**Interfaces:**
- Produces RPC: `preview_group_baseline_update(...) returns jsonb`、`apply_group_baseline_update(...) returns jsonb`、`resolve_group_baseline_conflict(...) returns jsonb`、`restore_group_plan_restore_point(...) returns jsonb`。
- Produces JS: `createGroupBaselineClient({supabaseClient,getContext})` with `previewUpdate`, `applyUpdate`, `listConflicts`, `resolveConflict`, `listRestorePoints`, `restorePoint`。

- [ ] **Step 1: 写三方合并 SQL 契约失败测试**

```js
test("baseline update is atomic lock guarded and preserves group changes", () => {
  const body = extractFunction(sql, "apply_group_baseline_update");
  assert.match(body, /for update/i);
  assert.match(body, /BASELINE_VERSION_CONFLICT/i);
  assert.match(body, /GROUP_SPACE_BUSY/i);
  assert.match(body, /group_plan_restore_points/i);
  assert.match(body, /group_baseline_conflicts/i);
  assert.match(body, /base_snapshot_id/i);
  assert.doesNotMatch(body, /delete\s+from\s+public\.planning_features/i);
});
```

`extractFunction` 在测试文件内使用与阶段 2 相同的 `create or replace function ... $$;` 提取方式，缺少函数时明确失败。

- [ ] **Step 2: 运行测试并确认更新 RPC 缺失**

Run: `node --test features/data/group-plan-baseline-migration.test.js`  
Expected: FAIL，缺少 `apply_group_baseline_update`。

- [ ] **Step 3: 实现只读差异预览**

`preview_group_baseline_update` 验证组员或 staff，并比较当前基线与目标快照，返回固定结构：

```json
{
  "from_snapshot_id":"v1",
  "to_snapshot_id":"v2",
  "baseline":{"added":4,"updated":12,"deleted":2},
  "group":{"added":8,"updated":20,"deleted":3},
  "potential_conflicts":5
}
```

目标快照必须属于相同正式村庄，且版本号高于当前版本；预览不写数据库。

- [ ] **Step 4: 实现空间级原子更新和三方合并**

`apply_group_baseline_update` 参数固定包含项目、村庄、空间、目标快照和 `p_expected_base_snapshot_id`。函数从 `auth.uid()` 验证权限，锁定空间行，拒绝有效对象锁，先写恢复点，再按对象编码比较 B0/G/B1：小组未改对象跟随 B1；小组已改对象保留；双方变化写冲突；最后更新 `base_snapshot_id` 并完成更新批次。

- [ ] **Step 5: 实现冲突解决和管理员恢复**

冲突解决支持 `keep_group`、`use_new_baseline`、`manual_merge`。`manual_merge` 必须提交允许图层的 `geom/props` 并形成新覆盖版本。整空间恢复只允许 staff，恢复恢复点中的 `baseline_snapshot_id` 和覆盖状态引用，追加一条 `restored` 更新历史，不修改旧更新或旧冲突。

- [ ] **Step 6: 写客户端 RPC 参数和错误测试**

```js
test("client applies an explicitly previewed baseline", async () => {
  const { client, calls } = harness({ spaceType: "group_plan" });
  await client.applyUpdate({ targetSnapshotId: "v2", expectedBaseSnapshotId: "v1" });
  assert.deepEqual(calls[0], {
    name: "apply_group_baseline_update",
    args: {
      p_teaching_project_id: "p1", p_village_id: "v1", p_space_id: "s1",
      p_target_snapshot_id: "v2", p_expected_base_snapshot_id: "v1"
    }
  });
});
```

- [ ] **Step 7: 实现 `group-baseline-client.js` 并运行测试**

客户端只从 `getContext()` 获取项目、村庄和空间，不接受调用者覆盖上下文。把 `GROUP_SPACE_BUSY`、`BASELINE_VERSION_CONFLICT` 和无权限错误保留为稳定 `error.code`，供 UI 生成明确提示。

Run: `node --test features/data/group-baseline-client.test.js features/data/group-plan-baseline-migration.test.js`  
Expected: PASS。

- [ ] **Step 8: 提交基线更新核心**

```powershell
git add features/data/group-baseline-client.js features/data/group-baseline-client.test.js "supabase_SQL/Group Plan Baseline Update.sql" features/data/group-plan-baseline-migration.test.js
git commit -m "feat: merge and restore group plan baselines"
```

---

### Task 6: 学生端唯一小组空间与方案基线面板

**Files:**
- Create: `features/ui/group-baseline-panel.js`
- Create: `features/ui/group-baseline-panel.test.js`
- Modify: `features/villages/village-model.js`
- Modify: `features/villages/village-model.test.js`
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/workspace-space-management.test.js`
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: Task 5 `createGroupBaselineClient` 和当前项目/村庄/小组空间上下文。
- Produces: `createGroupBaselinePanel({root,client,confirm,notify,onReload})`；空间选择器稳定标签与 `baseSnapshotLabel`。

- [ ] **Step 1: 写管理员和学生空间可见性失败测试**

```js
test("staff normal workspace does not expose every group plan", () => {
  const visible = filterSpacesForContext({
    context: { teachingProjectId: "p1", villageId: "v1", villageRole: "formal" },
    actor: { userId: "admin", isStaff: true, groupId: "" },
    spaces: [
      { id: "shared", teachingProjectId: "p1", villageId: "v1", spaceType: "formal_shared" },
      { id: "g1", teachingProjectId: "p1", villageId: "v1", spaceType: "group_plan", groupId: "g1" }
    ]
  });
  assert.deepEqual(visible.map((row) => row.id), ["shared"]);
});
```

- [ ] **Step 2: 修正普通空间过滤并运行测试**

staff 在普通工作区可访问共享空间和自己的个人空间；只有明确存在当前 `actor.groupId` 时才显示对应 `group_plan`。管理员后台临时进入小组使用独立管理上下文，不放宽此函数。

Run: `node --test features/villages/village-model.test.js features/ui/workspace-space-management.test.js`  
Expected: PASS。

- [ ] **Step 3: 写基线面板状态和交互失败测试**

```js
test("panel renders current baseline update summary and unresolved conflicts", async () => {
  const panel = createGroupBaselinePanel(harness({
    current: { version_name: "V1.0" }, latest: { version_name: "V2.0" },
    preview: { baseline: { added: 2, updated: 5, deleted: 1 }, potential_conflicts: 2 }
  }));
  await panel.refresh();
  assert.match(panel.html(), /当前基线[\s\S]*?V1\.0/);
  assert.match(panel.html(), /可更新至[\s\S]*?V2\.0/);
  assert.match(panel.html(), /预计冲突[\s\S]*?2/);
});

test("baseline update requires confirmation and reloads server facts", async () => {
  const events = [];
  const panel = createGroupBaselinePanel(harness({ confirm: async () => true, events }));
  await panel.applyLatest();
  assert.deepEqual(events, ["confirm", "apply", "reload", "refresh"]);
});
```

- [ ] **Step 4: 实现面板渲染、确认、错误和冲突定位**

无小组显示“请先加入小组”；无冻结快照显示“等待管理员冻结现状版本”；存在更新时显示当前版本、目标版本、差异数量和二次确认按钮。`GROUP_SPACE_BUSY` 提示正在编辑，`BASELINE_VERSION_CONFLICT` 自动刷新。冲突列表提供 `data-locate-layer/object`，复用现有地图定位事件。

- [ ] **Step 5: 接入项目设置和空间选择器**

`index.html` 加载新模块；`app.js` 仅在当前空间为 `group_plan` 时初始化和刷新面板。空间标签固定为“我的个人体验空间”“全班共享现状空间”“本小组方案空间”，小组空间附加“组内共享 · 基线 Vx”徽标，不建立版本级选项。

- [ ] **Step 6: 运行学生端与响应式测试**

Run: `node --test features/ui/group-baseline-panel.test.js features/villages/village-model.test.js features/ui/workspace-space-management.test.js features/ui/workspace-responsive-layout.test.js features/ui/2d-cold-start.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交学生端**

```powershell
git add features/ui/group-baseline-panel.js features/ui/group-baseline-panel.test.js features/villages/village-model.js features/villages/village-model.test.js features/ui/space-panel.js features/ui/workspace-space-management.test.js index.html app.js style.css
git commit -m "feat: add group plan baseline workspace"
```

---

### Task 7: 管理员“小组方案”后台与临时管理视图

**Files:**
- Create: `features/admin/group-plan-admin.js`
- Create: `features/admin/group-plan-admin.test.js`
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `admin.css`
- Modify: `supabase_SQL/Group Plan Baseline Update.sql`
- Modify: `features/data/group-plan-baseline-migration.test.js`

**Interfaces:**
- Consumes: 小组、成员、唯一方案空间、更新/冲突/恢复 RPC。
- Produces: `get_group_plan_admin_dashboard(p_teaching_project_id uuid,p_village_id uuid) returns setof jsonb`；`createGroupPlanAdminController({root,supabaseClient,notify,confirm,navigate})`。

- [ ] **Step 1: 写后台列表和临时入口失败测试**

```js
test("admin dashboard shows lifecycle baseline activity and conflicts", () => {
  const html = renderGroupRows([{
    group_id: "g1", group_name: "第一组", member_count: 6, space_id: "s1",
    base_version_name: "V1.0", latest_version_name: "V2.0", unresolved_conflicts: 2
  }]);
  assert.match(html, /第一组/);
  assert.match(html, /V1\.0/);
  assert.match(html, /V2\.0/);
  assert.match(html, /2 个冲突/);
  assert.match(html, /data-enter-group-plan="s1"/);
});

test("enter action creates an explicit temporary admin context", () => {
  assert.deepEqual(buildAdminGroupPlanUrl({ projectId: "p1", villageId: "v1", groupId: "g1", spaceId: "s1" }),
    "./index.html?adminGroupPlan=1&project=p1&village=v1&group=g1&space=s1");
});
```

- [ ] **Step 2: 运行测试并确认管理员模块缺失**

Run: `node --test features/admin/group-plan-admin.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现管理员只读统计 RPC**

RPC 只允许 teacher/admin，按项目和正式村庄返回所有小组，包括尚未生成空间的小组。每行包含成员数、空间状态、当前基线、最新推荐基线、最近编辑时间、未解决冲突数和最近失败状态；不得依赖前端跨表拼接授权数据。

- [ ] **Step 4: 实现后台控制器和页面区域**

在现有“现状校核”之后增加“小组方案”菜单与 `adminTabGroupPlans`。使用紧凑卡片头、项目/村庄上下文条、摘要卡和响应式表格。行操作固定为“补建空间”“进入方案”“代更新”“查看冲突”“恢复版本”，无在线分配或认领控件。

- [ ] **Step 5: 实现临时管理员管理上下文**

`app.js` 只有在 URL 同时包含 `adminGroupPlan=1` 且当前用户服务端角色为 staff 时，才按项目、村庄、小组和空间重新向 RPC 验证并进入管理视图。退出按钮返回 `admin.html#group-plans`。该上下文不写入普通空间缓存，也不改变管理员空间选择器。

- [ ] **Step 6: 接入代更新与恢复确认**

代更新复用 Task 5 客户端，但传入从服务器确认的管理员上下文；恢复按钮展示恢复点时间、旧基线和覆盖数量，二次确认后调用恢复 RPC。所有结果刷新后台事实并使用现有通知组件。

- [ ] **Step 7: 运行管理员及权限回归**

Run: `node --test features/admin/group-plan-admin.test.js features/admin/village-admin-runtime.test.js features/admin/survey-admin.test.js features/data/group-plan-baseline-migration.test.js features/villages/village-model.test.js`  
Expected: PASS。

- [ ] **Step 8: 提交管理员后台**

```powershell
git add features/admin/group-plan-admin.js features/admin/group-plan-admin.test.js admin.html admin.js admin.css app.js "supabase_SQL/Group Plan Baseline Update.sql" features/data/group-plan-baseline-migration.test.js
git commit -m "feat: manage group plans from admin dashboard"
```

---

### Task 8: 2D/3D 统一读取、实时刷新和模型回退

**Files:**
- Modify: `app.js`
- Modify: `app-3d.js`
- Modify: `index.html`
- Modify: `supabase_SQL/Realtime Publication Setup.sql`
- Modify: `features/3d/3d-runtime-integration.test.js`
- Modify: `features/models/group-model-library-integration.test.js`
- Create: `features/integration/group-plan-flow.test.js`

**Interfaces:**
- Consumes: `resolve_group_plan_features`、小组覆盖保存、基线更新事件和既有小组模型库。
- Produces: `loadResolvedGroupPlan(context)` 供 2D/3D 共用；按 `space_id` 过滤的更新、冲突与覆盖刷新信号。

- [ ] **Step 1: 写 2D/3D 同源失败测试**

```js
test("2d and 3d request the same resolved group plan context", async () => {
  const calls = [];
  const load = (context) => (calls.push(context), Promise.resolve([{ layer_key: "building", object_code: "B1" }]));
  await loadFor2d(load, { teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  await loadFor3d(load, { teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  assert.deepEqual(calls[0], calls[1]);
});
```

- [ ] **Step 2: 写 GLB 失败保留白模测试**

```js
test("failed group model URL keeps generated white model visible", async () => {
  const building = { objectCode: "B1", whiteModelVisible: true };
  await applyOptionalGroupModel(building, async () => { throw new Error("signed url failed"); });
  assert.equal(building.whiteModelVisible, true);
});
```

- [ ] **Step 3: 运行集成测试并确认统一加载尚未接入**

Run: `node --test features/3d/3d-runtime-integration.test.js features/models/group-model-library-integration.test.js features/integration/group-plan-flow.test.js`  
Expected: FAIL，缺少统一加载或白模回退行为。

- [ ] **Step 4: 实现 2D/3D 共用方案加载**

`app.js` 在 `group_plan` 上不再把共享现状全量复制到本地空间，而是调用解析 RPC，按图层分发到现有地图源。`app-3d.js` 使用相同上下文和对象编码创建白模；建筑高度优先读取方案 `props.height`，否则沿用现有层数 × 3m、默认 9m 规则。

- [ ] **Step 5: 实现 GLB 可选覆盖和白模回退**

只有成功取得当前小组、当前空间、当前对象的有效模型绑定与签名 URL 后才隐藏对应白模。加载或解析失败时恢复白模并记录非阻塞通知，道路和水体继续正常显示。

- [ ] **Step 6: 增加 Realtime 幂等登记和事实重载**

把 `planning_features`、`group_baseline_updates` 和 `group_baseline_conflicts` 幂等加入 `supabase_realtime`。客户端按 `space_id` 过滤，事件仅触发 100～250ms 去抖后的解析 RPC 重载；断线时暂停小组共享写入，重新 `SUBSCRIBED` 后先重载再解锁。

- [ ] **Step 7: 完成跨模块流程测试**

`group-plan-flow.test.js` 覆盖：冻结确保空间、组员读取唯一空间、稀疏更新后 2D/3D 同源、V2 预览、保留组内修改、生成冲突、冲突不阻塞编辑、管理员临时进入不污染普通空间列表。

- [ ] **Step 8: 运行 2D/3D 与工作区回归**

Run: `node --test features/integration/group-plan-flow.test.js features/3d/3d-runtime-integration.test.js features/models/group-model-library-integration.test.js features/ui/2d-cold-start.test.js features/ui/workspace-context-behavior.test.js`  
Expected: PASS。

- [ ] **Step 9: 提交统一运行时**

```powershell
git add app.js app-3d.js index.html "supabase_SQL/Realtime Publication Setup.sql" features/3d/3d-runtime-integration.test.js features/models/group-model-library-integration.test.js features/integration/group-plan-flow.test.js
git commit -m "feat: synchronize group plans across 2d and 3d"
```

---

### Task 9: 远程迁移、安全核验与全量回归

**Files:**
- Create: `docs/operations/group-plan-baseline-rollout.md`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`
- Modify: `supabase_SQL/Group Plan Baseline Update.sql` only if focused verification reproduces a defect
- Modify: affected source/test files only when the corresponding focused test reproduces a defect

**Interfaces:**
- Consumes: Tasks 1–8 完整代码和 Supabase 项目 `rzmbmwauomzwiyenafha`。
- Produces: 可追踪的远程迁移记录、RLS/RPC/advisor 核验结果和阶段 3 自动化完成状态。

- [ ] **Step 1: 运行阶段 3 聚焦测试**

```powershell
$tests = @(
  'features/data/group-plan-baseline-migration.test.js',
  'features/data/group-plan-resolver.test.js',
  'features/data/group-baseline-client.test.js',
  'features/data/feature-edit-session.test.js',
  'features/course/course-workspace-adapter.test.js',
  'features/villages/village-model.test.js',
  'features/ui/group-baseline-panel.test.js',
  'features/admin/group-plan-admin.test.js',
  'features/integration/group-plan-flow.test.js',
  'features/3d/3d-runtime-integration.test.js',
  'features/models/group-model-library-integration.test.js'
)
node --test --test-isolation=none $tests
```

Expected: 全部 PASS，无跳过。

- [ ] **Step 2: 对远程执行只读盘点**

确认项目 `rzmbmwauomzwiyenafha` 中阶段 2 表和 RPC 存在，记录正式村庄绑定数、推荐快照数、课程小组数、现有 `group_plan` 数和 `planning_features` 孤立上下文数。把结果写入 `docs/operations/group-plan-baseline-rollout.md`，不记录密钥或访问令牌。

- [ ] **Step 3: 应用阶段 3 迁移**

通过已认证的 Supabase MCP 将 `Group Plan Baseline Update.sql` 作为一个命名迁移应用到 `rzmbmwauomzwiyenafha`，再应用修改后的 Realtime 登记。若 MCP 不可用，停止在“本地完成、远程未部署”状态并准确报告，不通过浏览器重复粘贴未知 SQL 片段。

- [ ] **Step 4: 核验远程结构和幂等性**

查询三张新表、唯一索引、RLS、策略、RPC 执行权限和 publication；再次执行安全的幂等检查，确认没有重复策略、索引或小组空间。运行 Supabase advisor，新增安全警告必须修复或写明与阶段 3 无关的既有项。

- [ ] **Step 5: 执行不依赖伪造业务数据的权限核验**

使用现有管理员身份验证管理员统计 RPC 可调用；匿名身份验证解析、更新、冲突、恢复 RPC 均拒绝；检查 `authenticated` 没有直接修改基线历史表的权限。真实学生甲/乙和正式村庄数据矩阵延后到全部阶段完成后的总体验收。

- [ ] **Step 6: 运行全量回归和语法检查**

```powershell
$tests = rg --files features | Where-Object { $_ -like '*.test.js' }
node --test --test-isolation=none $tests
node --check app.js
node --check app-3d.js
node --check admin.js
node --check features/data/group-plan-resolver.js
node --check features/data/group-baseline-client.js
node --check features/ui/group-baseline-panel.js
node --check features/admin/group-plan-admin.js
git diff --check
```

Expected: 所有测试 PASS；所有语法检查退出码为 0；`git diff --check` 无输出。

- [ ] **Step 7: 更新迭代日志**

记录迁移名称、执行时间、远程对象数量、安全核验、自动化测试数量，以及“功能与数据库部署完成；真实教学数据总体验收待后续统一执行”。不提交设计和计划文档。

- [ ] **Step 8: 提交部署与验收代码**

```powershell
git add docs/operations/group-plan-baseline-rollout.md docs/PLATFORM_ITERATION_LOG.md
git add "supabase_SQL/Group Plan Baseline Update.sql" "supabase_SQL/Shared Survey Calibration and Freeze.sql" "supabase_SQL/Realtime Publication Setup.sql"
git add features admin.html admin.js admin.css index.html app.js app-3d.js style.css
git commit -m "test: verify group plan baseline rollout"
```

## Final Completion Gate

- [ ] 正式村庄每个小组最多一个有基线的 `group_plan`，练习村庄没有小组方案。
- [ ] 冻结可幂等补建小组空间，后续冻结不改变已有空间基线。
- [ ] 建筑、道路、水体的稀疏新增、更新、删除解析正确，参照层只读。
- [ ] 对象锁和修订号阻止小组成员相互覆盖。
- [ ] 基线更新保留小组修改，冲突可定位、可解决且不阻塞编辑。
- [ ] 更新失败完整回滚，管理员可从后台恢复更新前状态。
- [ ] 学生普通空间列表只有本人可用的逻辑空间；管理员普通列表不包含全部小组。
- [ ] 管理员后台可补建、进入、代更新、查看冲突和恢复，并留下操作记录。
- [ ] 2D 与 3D 使用同一解析结果，GLB 加载失败时白模仍可用。
- [ ] RLS、RPC 权限、Realtime、全量 Node 测试和语法检查全部通过。
- [ ] 未伪造正式教学数据，真实多账号总体验收明确留到全部阶段完成后。
- [ ] 阶段 3 代码已提交到 `learning`；本设计和计划文档仍保持未跟踪或未提交。
