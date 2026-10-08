# Shared Current Survey Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为正式村庄的全班共享现状空间建立对象级几何校核、后续操作门禁、混合进度、并发同步、管理员恢复和不可变冻结版本。

**Architecture:** 新增 `survey_feature_reviews` 作为建筑、道路和水系的校核状态事实表，并通过受控 RPC 与现有 `planning_features`、编辑锁、修改历史和快照表原子协作。学生端由独立的纯状态模型、Supabase 客户端和紧凑进度组件组成，`app.js` 只负责把既有地图编辑与对象详情入口接入这些模块；管理员端复用当前后台标签体系并增加校核总览、历史和冻结控制器。

**Tech Stack:** 原生 JavaScript/DOM、OpenLayers 10.8、Supabase Auth/Postgres/PostGIS/Storage/Realtime/RLS/RPC、Node.js `node:test`、静态 SQL 契约测试。

**Spec:** `docs/superpowers/specs/2026-09-04-shared-current-survey-calibration-design.md`

## Global Constraints

- 全班共同编辑一个正式村庄的 `formal_shared` 空间，不实现线上分配、领取或认领。
- 首版主校核图层严格限定为 `building`、`road`、`water`；等高线、耕地和开放空间不进入校核进度。
- `pending` 对象的属性、照片、对象问题和对象讨论必须由前端与服务端共同禁止。
- 一个对象完成几何校核后，其后续功能立即对全班开放；不等待整村校核完成，也不限定为原操作者。
- V0 主进度分母固定；新增对象单列，当前有效对象数动态计算。
- 学生修改直接进入共享现状，不增加教师逐条审批队列。
- 确认、几何保存、删除和恢复均需要短时对象锁与 `geometry_revision` 校验。
- 冻结产生不可变快照，但共享现状空间继续可编辑；新快照不得自动升级已有小组空间。
- 所有操作者身份必须由 `auth.uid()` 和服务端资料推导，客户端姓名只可用于显示兼容，不可用于授权。
- 数据库迁移必须可重复执行；不得修改已经远程执行的阶段 1 SQL 文件，阶段 2 使用独立增量迁移。
- 不提交原始数据、密钥、照片二进制或任何本机绝对资源路径。
- 每个任务先写失败测试、确认失败原因、再写最小实现并运行相关回归。

---

### Task 1: 校核状态迁移、V0 初始化与安全契约

**Files:**
- Create: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Create: `features/data/shared-survey-calibration-migration.test.js`
- Modify: `supabase_SQL/README.md`

**Interfaces:**
- Consumes: 阶段 1 的 `teaching_projects`、`villages`、`village_datasets`、`planning_spaces`、`planning_features`、`feature_edit_locks`、`feature_change_batches`、`feature_versions`、`feature_snapshots`、`feature_snapshot_items`。
- Produces: `survey_feature_reviews`；`community_task_versions`；`survey_snapshot_photo_refs`；`survey_snapshot_issue_refs`；`planning_spaces.base_snapshot_id`；辅助函数 `assert_survey_review_context(uuid,uuid,text)`、`survey_feature_downstream_ready(uuid,uuid,text,text,text)`；管理员 RPC `initialize_shared_survey_reviews(uuid,uuid,text,uuid,jsonb)`。

- [ ] **Step 1: 写迁移契约测试的 SQL 解析器和表结构断言**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "..", "..", "supabase_SQL", "Shared Survey Calibration and Freeze.sql");
const source = () => fs.readFileSync(sqlPath, "utf8");

test("migration creates contextual review state with immutable identity", () => {
  const sql = source();
  assert.match(sql, /^begin;/i);
  assert.match(sql, /create table if not exists public\.survey_feature_reviews/i);
  assert.match(sql, /unique\s*\(\s*teaching_project_id\s*,\s*village_id\s*,\s*space_id\s*,\s*layer_key\s*,\s*object_code\s*\)/i);
  assert.match(sql, /geometry_status[\s\S]*?'pending'[\s\S]*?'confirmed_unchanged'[\s\S]*?'modified'[\s\S]*?'deleted'[\s\S]*?'added'/i);
  assert.match(sql, /geometry_revision\s+bigint\s+not null\s+default\s+0/i);
  assert.match(sql, /commit;\s*$/i);
});
```

- [ ] **Step 2: 运行测试并确认因迁移文件不存在而失败**

Run: `node --test features/data/shared-survey-calibration-migration.test.js`  
Expected: FAIL，错误包含 `ENOENT` 或缺少 `survey_feature_reviews`。

- [ ] **Step 3: 写最小事务迁移和索引**

```sql
begin;

create table if not exists public.survey_feature_reviews (
  id uuid primary key default gen_random_uuid(),
  teaching_project_id uuid not null references public.teaching_projects(id) on delete restrict,
  village_id uuid not null references public.villages(id) on delete restrict,
  space_id text not null references public.planning_spaces(id) on delete cascade,
  base_dataset_id uuid not null references public.village_datasets(id) on delete restrict,
  layer_key text not null check (layer_key in ('building', 'road', 'water')),
  object_code text not null,
  is_v0_baseline boolean not null,
  baseline_object_code text,
  geometry_status text not null default 'pending'
    check (geometry_status in ('pending', 'confirmed_unchanged', 'modified', 'deleted', 'added')),
  geometry_revision bigint not null default 0 check (geometry_revision >= 0),
  first_reviewed_by uuid references auth.users(id) on delete set null,
  first_reviewed_at timestamptz,
  latest_modified_by uuid references auth.users(id) on delete set null,
  latest_modified_at timestamptz,
  latest_geometry_batch_id uuid references public.feature_change_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teaching_project_id, village_id, space_id, layer_key, object_code),
  check ((is_v0_baseline and baseline_object_code is not null) or (not is_v0_baseline and baseline_object_code is null)),
  check ((is_v0_baseline and geometry_status <> 'added') or (not is_v0_baseline and geometry_status = 'added'))
);

create index if not exists survey_feature_reviews_progress_idx
  on public.survey_feature_reviews(teaching_project_id, village_id, space_id, layer_key, geometry_status);

alter table public.planning_spaces
  add column if not exists base_snapshot_id uuid references public.feature_snapshots(id) on delete restrict;

commit;
```

- [ ] **Step 4: 增加 V0 幂等初始化、安全函数、快照关联和 RLS 契约断言**

```js
test("migration exposes staff-only V0 index initialization and secures writes", () => {
  const sql = source();
  assert.match(sql, /create or replace function public\.initialize_shared_survey_reviews/i);
  assert.match(sql, /space_type\s*=\s*'formal_shared'/i);
  assert.match(sql, /status\s*=\s*'published'/i);
  assert.match(sql, /SURVEY_REVIEW_INDEX_ALREADY_INITIALIZED/i);
  assert.match(sql, /alter table public\.survey_feature_reviews enable row level security/i);
  assert.match(sql, /revoke all on table public\.survey_feature_reviews[\s\S]*?from public\s*,\s*anon/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)[\s\S]*?survey_feature_reviews[\s\S]*?to authenticated/i);
  assert.match(sql, /create table if not exists public\.community_task_versions/i);
  assert.match(sql, /create table if not exists public\.survey_snapshot_photo_refs/i);
  assert.match(sql, /create table if not exists public\.survey_snapshot_issue_refs/i);
});
```

- [ ] **Step 5: 完成管理员 V0 索引初始化、上下文检查、快照关联和 RLS**

实现要求：

```sql
initialize_shared_survey_reviews(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_dataset_id uuid,
  p_items jsonb
) returns jsonb
```

RPC 只接受 staff 身份，校验目标是 `formal_shared`、`p_dataset_id` 是该空间绑定村庄的已发布 V0，且每项只含 `building/road/water + objectCode`。它只登记不可变对象索引，不重复保存 GeoJSON 几何；首次调用用唯一约束去重，已经存在索引时只允许同一数据集和完全相同的对象集合，否则返回 `SURVEY_REVIEW_INDEX_ALREADY_INITIALIZED`。管理员后台在 V0 发布并绑定后从已校验的数据包提取对象索引并调用该 RPC。

同时创建不可变 `community_task_versions`，每次对象问题新增或更新时记录 `issue_id + revision + frozen_payload`；创建两张快照引用表，其主键分别为 `(snapshot_id, photo_id)` 和 `(snapshot_id, issue_version_id)`。三表启用 RLS，只允许可访问对应项目上下文的已登录用户读取。`survey_feature_reviews` 仅授予 `authenticated` 的 `select`，写入全部经 RPC。

- [ ] **Step 6: 更新 SQL 索引文档并运行迁移测试**

在 `supabase_SQL/README.md` 的当前增量迁移顺序末尾加入：

```text
Shared Survey Calibration and Freeze.sql — 阶段 2：正式共享现状的对象校核、门禁、恢复与冻结。
```

Run: `node --test features/data/shared-survey-calibration-migration.test.js features/data/multi-village-repair-migration.test.js features/data/supabase-migration-security.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交数据库骨架**

```bash
git add "supabase_SQL/Shared Survey Calibration and Freeze.sql" supabase_SQL/README.md features/data/shared-survey-calibration-migration.test.js
git commit -m "feat: add shared survey review schema"
```

### Task 2: 纯校核模型、混合进度和显示状态

**Files:**
- Create: `features/survey/survey-review-model.js`
- Create: `features/survey/survey-review-model.test.js`

**Interfaces:**
- Consumes: 从数据库读取的 `survey_feature_reviews` 行。
- Produces: `SURVEY_LAYERS`、`normalizeReviewRow(row)`、`isGeometryReviewed(row)`、`canUseDownstreamActions(row)`、`buildSurveyProgress(rows)`、`getSurveyFeatureStyle(row, options)`。

- [ ] **Step 1: 写混合进度和门禁失败测试**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("./survey-review-model.js");

test("keeps V0 denominator fixed while reporting additions separately", () => {
  const rows = [
    { layer_key: "building", object_code: "B1", is_v0_baseline: true, geometry_status: "confirmed_unchanged" },
    { layer_key: "building", object_code: "B2", is_v0_baseline: true, geometry_status: "deleted" },
    { layer_key: "road", object_code: "R1", is_v0_baseline: true, geometry_status: "pending" },
    { layer_key: "water", object_code: "W9", is_v0_baseline: false, geometry_status: "added" }
  ];
  assert.deepEqual(model.buildSurveyProgress(rows), {
    baselineTotal: 3,
    reviewedBaseline: 2,
    confirmedUnchanged: 1,
    modified: 0,
    deleted: 1,
    added: 1,
    currentActive: 3,
    byLayer: {
      building: { baselineTotal: 2, reviewedBaseline: 2 },
      road: { baselineTotal: 1, reviewedBaseline: 0 },
      water: { baselineTotal: 0, reviewedBaseline: 0 }
    }
  });
});

test("unlocks downstream work only for active reviewed objects", () => {
  assert.equal(model.canUseDownstreamActions({ geometry_status: "pending" }), false);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "confirmed_unchanged" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "modified" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "added" }), true);
  assert.equal(model.canUseDownstreamActions({ geometry_status: "deleted" }), false);
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node --test features/survey/survey-review-model.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现状态规范化和混合统计**

```js
const SURVEY_LAYERS = Object.freeze(["building", "road", "water"]);
const REVIEWED_V0_STATUSES = new Set(["confirmed_unchanged", "modified", "deleted"]);

function canUseDownstreamActions(row) {
  return ["confirmed_unchanged", "modified", "added"].includes(String(row?.geometry_status || row?.geometryStatus || ""));
}

function buildSurveyProgress(rows = []) {
  const normalized = rows.map(normalizeReviewRow).filter((row) => SURVEY_LAYERS.includes(row.layerKey));
  const baseline = normalized.filter((row) => row.isV0Baseline);
  const deleted = baseline.filter((row) => row.geometryStatus === "deleted").length;
  const added = normalized.filter((row) => !row.isV0Baseline && row.geometryStatus === "added").length;
  return {
    baselineTotal: baseline.length,
    reviewedBaseline: baseline.filter((row) => REVIEWED_V0_STATUSES.has(row.geometryStatus)).length,
    confirmedUnchanged: baseline.filter((row) => row.geometryStatus === "confirmed_unchanged").length,
    modified: baseline.filter((row) => row.geometryStatus === "modified").length,
    deleted,
    added,
    currentActive: baseline.length - deleted + added,
    byLayer: Object.fromEntries(SURVEY_LAYERS.map((layerKey) => {
      const layerRows = baseline.filter((row) => row.layerKey === layerKey);
      return [layerKey, {
        baselineTotal: layerRows.length,
        reviewedBaseline: layerRows.filter((row) => REVIEWED_V0_STATUSES.has(row.geometryStatus)).length
      }];
    }))
  };
}
```

- [ ] **Step 4: 写聚焦样式测试并实现显示状态**

```js
test("focus mode dims reviewed objects without hiding them", () => {
  assert.deepEqual(model.getSurveyFeatureStyle({ geometry_status: "pending" }, { focusPending: true }), {
    opacity: 1, emphasis: "pending"
  });
  assert.deepEqual(model.getSurveyFeatureStyle({ geometry_status: "modified" }, { focusPending: true }), {
    opacity: 0.18, emphasis: "none"
  });
});
```

`getSurveyFeatureStyle` 只返回可测试的语义样式；OpenLayers 样式对象由地图集成层创建。未开启聚焦时所有对象返回 `opacity: 1`。锁定提示和问题提示不在该函数内相互覆盖。

- [ ] **Step 5: 运行模型测试并提交**

Run: `node --test features/survey/survey-review-model.test.js`  
Expected: PASS。

```bash
git add features/survey/survey-review-model.js features/survey/survey-review-model.test.js
git commit -m "feat: model shared survey progress"
```

### Task 3: 校核客户端、确认 RPC 与几何事务接入

**Files:**
- Create: `features/survey/survey-review-client.js`
- Create: `features/survey/survey-review-client.test.js`
- Modify: `features/data/feature-edit-session.js`
- Modify: `features/data/feature-edit-session.test.js`
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Modify: `features/data/shared-survey-calibration-migration.test.js`

**Interfaces:**
- Consumes: `createSurveyReviewClient({ supabaseClient, getContext })` 的项目上下文；现有锁 RPC；Task 1 的校核表。
- Produces: `listReviews()`、`getReview(layerKey,objectCode)`、`confirmGeometry({layerKey,objectCode,expectedRevision,lockToken})`、扩展后的 `saveFeatureEditBatch(deps,payload)`。

- [ ] **Step 1: 写客户端上下文与确认参数测试**

```js
test("confirmGeometry sends immutable context revision and lock token", async () => {
  const calls = [];
  const client = createSurveyReviewClient({
    supabaseClient: { rpc: async (name, args) => (calls.push({ name, args }), { data: { geometry_revision: 4 }, error: null }) },
    getContext: () => ({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "formal_shared" })
  });
  await client.confirmGeometry({ layerKey: "building", objectCode: "B1", expectedRevision: 3, lockToken: "lock-1" });
  assert.deepEqual(calls[0], {
    name: "confirm_survey_feature_geometry",
    args: {
      p_teaching_project_id: "p1", p_village_id: "v1", p_space_id: "s1",
      p_layer_key: "building", p_object_code: "B1",
      p_expected_revision: 3, p_lock_token: "lock-1"
    }
  });
});
```

- [ ] **Step 2: 运行客户端测试并确认失败**

Run: `node --test features/survey/survey-review-client.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现客户端并拒绝非正式共享上下文**

```js
function requireFormalSharedContext(getContext) {
  const context = getContext?.() || {};
  if (!context.teachingProjectId || !context.villageId || !context.spaceId) throw new Error("SURVEY_CONTEXT_REQUIRED");
  if (context.spaceType !== "formal_shared") throw new Error("FORMAL_SHARED_SPACE_REQUIRED");
  return context;
}

async function confirmGeometry(input) {
  const context = requireFormalSharedContext(getContext);
  const { data, error } = await supabaseClient.rpc("confirm_survey_feature_geometry", {
    p_teaching_project_id: context.teachingProjectId,
    p_village_id: context.villageId,
    p_space_id: context.spaceId,
    p_layer_key: input.layerKey,
    p_object_code: input.objectCode,
    p_expected_revision: input.expectedRevision,
    p_lock_token: input.lockToken
  });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: 写确认 RPC 的锁、身份、修订和活动记录契约测试**

```js
test("confirm RPC is authenticated lock and revision guarded", () => {
  const sql = source();
  assert.match(sql, /create or replace function public\.confirm_survey_feature_geometry/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /FORMAL_SHARED_SPACE_REQUIRED/i);
  assert.match(sql, /FEATURE_LOCK_REQUIRED/i);
  assert.match(sql, /GEOMETRY_REVISION_CONFLICT/i);
  assert.match(sql, /geometry_status\s*=\s*'confirmed_unchanged'/i);
  assert.match(sql, /insert into public\.activity_events/i);
  assert.match(sql, /grant execute on function public\.confirm_survey_feature_geometry[\s\S]*?to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.confirm_survey_feature_geometry[\s\S]*?to anon/i);
});
```

- [ ] **Step 5: 实现 `confirm_survey_feature_geometry`**

RPC 固定 `search_path = public, pg_temp`，执行顺序必须为：验证 `auth.uid()`、验证 `formal_shared` 上下文和项目成员、锁定校核行 `for update`、验证当前用户持有未过期锁、比较 `p_expected_revision`、写入首次/最近操作者、把状态改为 `confirmed_unchanged`、`geometry_revision + 1`、写活动记录并返回更新后的行。

- [ ] **Step 6: 扩展批量保存的请求契约测试**

```js
test("saveFeatureEditBatch passes per-change revision and lock evidence unchanged", async () => {
  const changes = [{ layerKey: "road", objectCode: "R1", action: "update", expectedGeometryRevision: 2, lockToken: "lock-2" }];
  // 使用现有 Supabase mock，断言 p_changes 与 changes 深度相等。
  await session.saveFeatureEditBatch(deps, { context, editorName: "仅显示", summary: "修改道路", changes });
  assert.deepEqual(rpcArgs.p_changes, changes);
});
```

- [ ] **Step 7: 扩展 `save_feature_edit_batch` 的原子状态更新**

在上下文版 RPC 内逐条验证：

```text
update -> V0 对象设为 modified，新增对象保持 added
delete -> V0 对象设为 deleted；新增对象软删除但不进入 V0 统计
add    -> 服务端生成不可变 object_code，创建 is_v0_baseline=false/status=added 的校核行
```

每条变更必须验证锁令牌和期望修订号；几何、`feature_versions`、校核状态和活动记录使用同一事务。删除继续使用软删除，客户端提供的新增对象编码不得直接成为最终技术编码。

- [ ] **Step 8: 运行相关测试并提交**

Run: `node --test features/survey/survey-review-client.test.js features/data/feature-edit-session.test.js features/data/shared-survey-calibration-migration.test.js`  
Expected: PASS。

```bash
git add features/survey/survey-review-client.js features/survey/survey-review-client.test.js features/data/feature-edit-session.js features/data/feature-edit-session.test.js "supabase_SQL/Shared Survey Calibration and Freeze.sql" features/data/shared-survey-calibration-migration.test.js
git commit -m "feat: add geometry review transactions"
```

### Task 4: 属性、照片、对象问题与讨论的硬门禁

**Files:**
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Modify: `features/data/shared-survey-calibration-migration.test.js`
- Modify: `features/data/data-service.js`
- Create: `features/data/survey-downstream-gate.test.js`
- Modify: `features/object-collaboration/object-comments.js`
- Modify: `features/object-collaboration/object-comments.test.js`
- Modify: `community-tasks.js`
- Modify: `app.js`

**Interfaces:**
- Consumes: `survey_feature_downstream_ready(...)`；Task 2 的 `canUseDownstreamActions(row)`；Task 3 的 `getReview`。
- Produces: `assertSurveyDownstreamReady(deps,{objectCode,layerKey})`；前三类协作表明确的 `survey_layer_key`；带 `target_layer_key`、`target_object_code` 的对象问题记录；统一错误码 `GEOMETRY_REVIEW_REQUIRED`。

- [ ] **Step 1: 写数据库门禁契约测试**

```js
test("database gates downstream survey writes and ignores non-survey contexts", () => {
  const sql = source();
  assert.match(sql, /create or replace function public\.enforce_survey_downstream_gate/i);
  for (const table of ["object_attribute_edits", "object_photos", "object_comments", "community_tasks"]) {
    assert.match(sql, new RegExp(`create trigger \\w+ before (insert|update) on public\\.${table}[\\s\\S]*?enforce_survey_downstream_gate`, "i"));
  }
  assert.match(sql, /GEOMETRY_REVIEW_REQUIRED/i);
  assert.match(sql, /space_type\s*<>\s*'formal_shared'/i);
});
```

- [ ] **Step 2: 运行测试并确认缺少触发器**

Run: `node --test features/data/shared-survey-calibration-migration.test.js`  
Expected: FAIL，缺少 `enforce_survey_downstream_gate`。

- [ ] **Step 3: 增加规范化图层、对象问题字段和触发器**

```sql
alter table public.object_attribute_edits
  add column if not exists survey_layer_key text check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.object_photos
  add column if not exists survey_layer_key text check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.object_comments
  add column if not exists survey_layer_key text check (survey_layer_key is null or survey_layer_key in ('building', 'road', 'water'));
alter table public.community_tasks
  add column if not exists target_layer_key text check (target_layer_key is null or target_layer_key in ('building', 'road', 'water')),
  add column if not exists target_object_code text;
```

新的前端写入必须显式传递规范化图层键，不能再从 `building__<spaceId>` 等历史 `object_type` 字符串猜测。触发器只在目标空间是 `formal_shared` 且 `survey_layer_key` 或 `target_layer_key` 属于三类校核图层时强制检查；个人空间、练习空间、后台非对象问题和评论互动元数据不能被误拦截。`deleted` 与 `pending` 均抛出 `GEOMETRY_REVIEW_REQUIRED`。

- [ ] **Step 4: 写前端统一门禁测试**

```js
test("blocks downstream calls before any upload or table mutation", async () => {
  const calls = [];
  const deps = {
    getSurveyReview: async () => ({ geometry_status: "pending" }),
    getSupabaseClient: () => ({ storage: { from: () => ({ upload: async () => calls.push("upload") }) } })
  };
  await assert.rejects(
    () => service.uploadObjectPhoto(deps, file, "B1", "building", "学生甲"),
    /GEOMETRY_REVIEW_REQUIRED/
  );
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 5: 把门禁接入四类写入入口**

在 `data-service.js` 的 `saveObjectEdits` 和 `uploadObjectPhoto`、`object-comments.js` 的 `create`、以及 `community-tasks.js` 的对象问题创建前调用：

```js
await deps.assertSurveyDownstreamReady?.({
  objectCode: sourceCode,
  layerKey: deps.getActiveSurveyLayerKey()
});
```

`app.js` 从当前选中图层传入 `survey_layer_key`，并在渲染对象详情时禁用按钮、显示“请先完成几何校核”。前端检查失败不能发起照片 Storage 上传；如果文件上传成功而数据库关联失败，立即删除本次新上传的路径并显示失败。

- [ ] **Step 6: 运行门禁与协作回归并提交**

Run: `node --test features/data/survey-downstream-gate.test.js features/object-collaboration/object-comments.test.js features/data/shared-survey-calibration-migration.test.js features/auth/supabase-auth-integration.test.js`  
Expected: PASS。

```bash
git add "supabase_SQL/Shared Survey Calibration and Freeze.sql" features/data/shared-survey-calibration-migration.test.js features/data/data-service.js features/data/survey-downstream-gate.test.js features/object-collaboration/object-comments.js features/object-collaboration/object-comments.test.js community-tasks.js app.js
git commit -m "feat: gate survey details behind geometry review"
```

### Task 5: 学生端进度条、对象动作与聚焦未校核

**Files:**
- Create: `features/survey/survey-review-panel.js`
- Create: `features/survey/survey-review-panel.test.js`
- Create: `features/map-editing/survey-review-overlay.js`
- Create: `features/map-editing/survey-review-overlay.test.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`

**Interfaces:**
- Consumes: Task 2 的纯模型；Task 3 的客户端；当前 OpenLayers feature 的 `layerKey/objectCode`。
- Produces: `createSurveyReviewPanel({root,onConfirm,onToggleFocus})`；`applySurveyReviewVisuals({layers,reviews,locks,issues,focusPending})`。

- [ ] **Step 1: 写紧凑进度组件失败测试**

```js
test("renders only compact progress and one focus action", () => {
  const html = renderSurveyProgress({ baselineTotal: 380, reviewedBaseline: 126 }, false);
  assert.match(html, /几何校核/);
  assert.match(html, /126\s*\/\s*380/);
  assert.match(html, /聚焦未校核/);
  assert.doesNotMatch(html, /仅看几何未校核|已确认无误|正在被编辑/);
});
```

- [ ] **Step 2: 运行组件测试并确认模块不存在**

Run: `node --test features/survey/survey-review-panel.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现组件语义和确认按钮状态**

```js
function renderSurveyProgress(progress, focusPending) {
  return `<div class="survey-review-progress" role="status">
    <span>几何校核 <strong>${progress.reviewedBaseline} / ${progress.baselineTotal}</strong></span>
    <button type="button" data-survey-focus aria-pressed="${focusPending}">${focusPending ? "退出聚焦" : "聚焦未校核"}</button>
  </div>`;
}
```

对象详情的校核区显示状态、最近处理者、修订号和“确认几何无误”。`pending` 才显示主要确认动作；已处理对象仍允许重新进入几何编辑。

- [ ] **Step 4: 写地图弱化、锁轮廓和问题标记测试**

```js
test("review overlay keeps reviewed features visible and preserves alerts", () => {
  const state = buildSurveyOverlayState({
    review: { geometryStatus: "modified" },
    lock: { editorName: "学生甲" },
    hasUnresolvedIssue: true,
    focusPending: true
  });
  assert.equal(state.opacity, 0.18);
  assert.equal(state.lockOutline, "blue");
  assert.equal(state.issueMarker, "red");
  assert.equal(state.hidden, false);
});
```

- [ ] **Step 5: 实现 OpenLayers 语义覆盖层并接入页面**

在 `index.html` 的 `feature-edit-session.js` 之后、`app.js` 之前加载四个新模块。`app.js` 只在活动空间类型为 `formal_shared` 时挂载进度组件，订阅选择对象变化，并把 `surveyReviewByKey` 传给覆盖层。`style.css` 保证进度入口保持单行紧凑布局；窄屏允许文本与按钮换行，但不得展开为状态长列表。

- [ ] **Step 6: 接入确认动作的完整锁流程**

```js
const lock = await acquireFeatureEditLock(layerKey, objectCode);
try {
  await surveyReviewClient.confirmGeometry({
    layerKey,
    objectCode,
    expectedRevision: review.geometryRevision,
    lockToken: lock.lockToken
  });
} finally {
  await releaseFeatureEditLockByRecord(lock);
}
```

冲突错误显示“对象已被其他同学更新，已刷新到最新版”，并重新加载该对象和总进度。

- [ ] **Step 7: 运行学生端相关测试并提交**

Run: `node --test features/survey/*.test.js features/map-editing/survey-review-overlay.test.js features/ui/workspace-responsive-layout.test.js features/ui/workspace-shell-regression.test.js features/data/feature-edit-session.test.js`  
Expected: PASS。

```bash
git add features/survey features/map-editing/survey-review-overlay.js features/map-editing/survey-review-overlay.test.js index.html style.css app.js
git commit -m "feat: add shared survey review workspace"
```

### Task 6: 实时校核状态、编辑者和断线保护

**Files:**
- Modify: `supabase_SQL/Realtime Publication Setup.sql`
- Modify: `features/survey/survey-review-client.js`
- Modify: `features/survey/survey-review-client.test.js`
- Create: `features/survey/survey-realtime-controller.js`
- Create: `features/survey/survey-realtime-controller.test.js`
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Consumes: Supabase `postgres_changes`；Task 3 客户端的 `listReviews()`；现有 `feature_edit_locks`。
- Produces: `createSurveyRealtimeController({client,loadLatest,onConnectionChange})`，方法 `start(context)`、`stop()`、`refreshAfterReconnect()`。

- [ ] **Step 1: 写实时频道过滤和重连测试**

```js
function fakeRealtimeClient({ onStatus }) {
  return {
    channel() {
      const channel = {
        on() { return channel; },
        subscribe(callback) { onStatus(callback); return channel; }
      };
      return channel;
    },
    async removeChannel() {}
  };
}

test("realtime refreshes from source after reconnect instead of trusting missed events", async () => {
  const calls = [];
  const controller = createSurveyRealtimeController({
    client: fakeRealtimeClient({ onStatus: (emit) => emit("SUBSCRIBED") }),
    loadLatest: async () => calls.push("reload"),
    onConnectionChange: (state) => calls.push(state)
  });
  await controller.start({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  assert.deepEqual(calls, ["connected", "reload"]);
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node --test features/survey/survey-realtime-controller.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现两条上下文频道与去抖刷新**

订阅 `survey_feature_reviews` 和 `feature_edit_locks`，使用 `space_id=eq.<spaceId>` 服务端过滤，并在回调中再次核对项目和村庄。事件只触发 100～250ms 去抖后的事实重载，不直接把 payload 当完整状态。

```js
channel
  .on("postgres_changes", { event: "*", schema: "public", table: "survey_feature_reviews", filter: `space_id=eq.${context.spaceId}` }, scheduleReload)
  .on("postgres_changes", { event: "*", schema: "public", table: "feature_edit_locks", filter: `space_id=eq.${context.spaceId}` }, scheduleReload);
```

- [ ] **Step 4: 增加 Realtime publication 幂等登记测试和 SQL**

在迁移契约测试中断言 `Realtime Publication Setup.sql` 包含 `survey_feature_reviews`，并沿用已有的 `pg_publication_tables` 检查避免重复添加。

- [ ] **Step 5: 接入断线写保护**

`app.js` 维护 `surveyRealtimeState = "connecting" | "connected" | "disconnected"`。正式共享空间断线时：显示“共享数据暂时不同步”、禁用确认/几何保存/属性/照片/问题/讨论写入；恢复 `SUBSCRIBED` 后先全量重载，再恢复按钮。个人体验空间不受该门禁影响。

- [ ] **Step 6: 运行实时与工作区回归并提交**

Run: `node --test features/survey/*.test.js features/data/feature-edit-session.test.js features/ui/workspace-context-behavior.test.js`  
Expected: PASS。

```bash
git add "supabase_SQL/Realtime Publication Setup.sql" features/survey/survey-review-client.js features/survey/survey-review-client.test.js features/survey/survey-realtime-controller.js features/survey/survey-realtime-controller.test.js index.html app.js
git commit -m "feat: synchronize shared survey review state"
```

### Task 7: 管理员校核总览、对象列表与历史恢复

**Files:**
- Create: `features/admin/survey-admin.js`
- Create: `features/admin/survey-admin.test.js`
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Modify: `features/data/shared-survey-calibration-migration.test.js`

**Interfaces:**
- Consumes: `get_shared_survey_dashboard(uuid,uuid,text)`；`list_shared_survey_features(uuid,uuid,text,text,text,uuid)`；现有 `feature_versions`。
- Produces: `createSurveyAdminController({root,supabaseClient,notify,confirm})`；RPC `restore_survey_feature_version(...)`。

- [ ] **Step 1: 写管理员统计格式和筛选模型测试**

```js
test("normalizes dashboard and preserves mixed progress", () => {
  assert.deepEqual(normalizeSurveyDashboard({
    baseline_total: 380, reviewed_baseline: 126, added: 8, deleted: 3, current_active: 385
  }), {
    baselineTotal: 380, reviewedBaseline: 126, added: 8, deleted: 3, currentActive: 385
  });
});

test("feature filters never create assignment semantics", () => {
  assert.deepEqual(buildSurveyFeatureFilters({ layer: "building", status: "pending", actorId: "u1" }), {
    layerKey: "building", geometryStatus: "pending", actorId: "u1"
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node --test features/admin/survey-admin.test.js`  
Expected: FAIL with `MODULE_NOT_FOUND`。

- [ ] **Step 3: 实现管理员控制器和页面标签**

在 `admin.html` 菜单增加“现状校核”，面板持续显示教学项目、正式村庄和共享空间。总览卡片显示 V0 进度、分层进度、确认/修改/删除/新增、当前对象、照片、未解决问题和活动编辑者。对象列表筛选仅含图层、状态、最近操作者，并提供“地图定位”“查看历史”；不得出现分配或认领控件。

- [ ] **Step 4: 写统计和恢复 RPC 安全测试**

```js
test("admin dashboard aggregates existing evidence and restore appends history", () => {
  const sql = source();
  assert.match(sql, /create or replace function public\.get_shared_survey_dashboard/i);
  assert.match(sql, /count\([\s\S]*?object_photos/i);
  assert.match(sql, /count\([\s\S]*?community_tasks/i);
  assert.match(sql, /create or replace function public\.restore_survey_feature_version/i);
  assert.match(sql, /current_profile_role\(\)[\s\S]*?'teacher'[\s\S]*?'admin'/i);
  assert.match(sql, /insert into public\.feature_change_batches/i);
  assert.doesNotMatch(sql, /update public\.feature_versions/i);
});
```

- [ ] **Step 5: 实现只读统计和追加式恢复 RPC**

统计 RPC 返回一个 JSON 对象，服务端完成上下文校验和聚合。恢复 RPC 参数固定为：

```sql
restore_survey_feature_version(
  p_teaching_project_id uuid,
  p_village_id uuid,
  p_space_id text,
  p_layer_key text,
  p_object_code text,
  p_feature_version_id uuid,
  p_expected_revision bigint
) returns jsonb
```

恢复需要 staff 身份、无他人活动锁、修订号一致；写入新的 change batch/version/review revision，不能更新或删除旧历史和快照。

- [ ] **Step 6: 在 `admin.js` 初始化新控制器并运行测试**

将 `surveyAdminController` 与现有 `villageAdminController` 并列初始化；标签切换映射增加 `surveyReview: $("adminTabSurveyReview")`。项目未绑定正式村庄时显示空状态而不是默认米埗村。

Run: `node --test features/admin/survey-admin.test.js features/admin/village-admin-runtime.test.js features/data/shared-survey-calibration-migration.test.js`  
Expected: PASS。

- [ ] **Step 7: 提交管理员校核模块**

```bash
git add features/admin/survey-admin.js features/admin/survey-admin.test.js admin.html admin.js "supabase_SQL/Shared Survey Calibration and Freeze.sql" features/data/shared-survey-calibration-migration.test.js
git commit -m "feat: add shared survey admin dashboard"
```

### Task 8: 原子冻结、证据引用和小组底图来源

**Files:**
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- Modify: `features/data/shared-survey-calibration-migration.test.js`
- Modify: `features/data/feature-edit-session.js`
- Modify: `features/data/feature-edit-session.test.js`
- Modify: `features/admin/survey-admin.js`
- Modify: `features/admin/survey-admin.test.js`
- Modify: `admin.js`

**Interfaces:**
- Consumes: 当前共享空间有效对象、照片、对象问题、活动锁；Task 1 的快照引用表。
- Produces: `freeze_shared_survey_snapshot(...) returns jsonb`；客户端 `freezeSurveySnapshot(input)`；`feature_snapshots.version_number/recommended_for_groups/stats`。

- [ ] **Step 1: 写冻结事务、安全与不可变引用契约测试**

```js
test("freeze is staff only lock guarded and captures immutable evidence refs", () => {
  const sql = source();
  assert.match(sql, /create or replace function public\.freeze_shared_survey_snapshot/i);
  assert.match(sql, /ACTIVE_FEATURE_LOCKS/i);
  assert.match(sql, /insert into public\.feature_snapshots/i);
  assert.match(sql, /insert into public\.feature_snapshot_items/i);
  assert.match(sql, /insert into public\.survey_snapshot_photo_refs/i);
  assert.match(sql, /insert into public\.survey_snapshot_issue_refs/i);
  assert.match(sql, /recommended_for_groups/i);
  assert.doesNotMatch(sql, /update public\.planning_spaces[\s\S]*?readonly\s*=\s*true/i);
});
```

- [ ] **Step 2: 运行测试并确认缺少新冻结 RPC**

Run: `node --test features/data/shared-survey-calibration-migration.test.js`  
Expected: FAIL，缺少 `freeze_shared_survey_snapshot`。

- [ ] **Step 3: 扩展快照元数据并实现原子冻结**

```sql
alter table public.feature_snapshots
  add column if not exists version_number integer,
  add column if not exists recommended_for_groups boolean not null default false,
  add column if not exists stats jsonb not null default '{}'::jsonb;

create unique index if not exists feature_snapshots_context_version_uidx
  on public.feature_snapshots(teaching_project_id, village_id, space_id, version_number)
  where version_number is not null;
```

RPC 内使用事务天然原子性：锁定空间记录，拒绝任何未过期对象锁，计算 `max(version_number)+1`，插入快照、全部对象明细、照片引用、问题及其冻结修订引用和统计摘要。将新版本设为推荐时，在同一上下文内取消旧版本推荐标识。不得接收客户端拼装的完整 `p_items` 作为事实来源。

- [ ] **Step 4: 增加照片存储与问题修订保护**

数据库删除照片元数据或后台删除 Storage 文件前，检查 `survey_snapshot_photo_refs`；仍被快照引用时返回 `SNAPSHOT_PHOTO_IMMUTABLE`。`admin.js` 必须先调用删除资格检查 RPC，再删除 Storage 文件，避免先删文件后才发现快照引用。对象问题的新增和每次更新都向 `community_task_versions` 追加不可变 `frozen_payload`，快照只引用冻结时的具体 `issue_version_id`；不得直接引用可继续变化的 `community_tasks` 当前行。

- [ ] **Step 5: 更新客户端冻结接口测试与实现**

```js
test("freeze asks the server to collect current facts", async () => {
  await session.freezeSurveySnapshot(deps, {
    versionName: "V1 第一次现场校核",
    description: "课堂冻结",
    recommendedForGroups: true
  });
  assert.equal(rpcCall.name, "freeze_shared_survey_snapshot");
  assert.equal("p_items" in rpcCall.args, false);
});
```

旧 `freezeSnapshot` 保留为兼容入口但管理员阶段 2 页面只调用 `freezeSurveySnapshot`。冻结按钮先调用只读预检，显示活动锁列表；首版不提供“强制冻结”。

- [ ] **Step 6: 写 V2 不自动升级小组空间的契约测试**

```js
function extractFunction(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\([\\s\\S]*?\\$\\$\\s*;`,
    "i"
  ));
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("publishing a later snapshot never rewrites group base snapshots", () => {
  const sql = source();
  const freezeBody = extractFunction(sql, "freeze_shared_survey_snapshot");
  assert.doesNotMatch(freezeBody, /update\s+public\.planning_spaces[\s\S]*?base_snapshot_id/i);
});
```

小组空间创建时由阶段 3 显式写入 `base_snapshot_id`；阶段 2 只提供列、外键和推荐版本，不自动创建小组空间。

- [ ] **Step 7: 运行冻结与后台测试并提交**

Run: `node --test features/data/shared-survey-calibration-migration.test.js features/data/feature-edit-session.test.js features/admin/survey-admin.test.js features/ui/workspace-edit-history.test.js`  
Expected: PASS。

```bash
git add "supabase_SQL/Shared Survey Calibration and Freeze.sql" features/data/shared-survey-calibration-migration.test.js features/data/feature-edit-session.js features/data/feature-edit-session.test.js features/admin/survey-admin.js features/admin/survey-admin.test.js admin.js
git commit -m "feat: freeze immutable survey baselines"
```

### Task 9: 迁移部署、真实协作验收与全量回归

**Files:**
- Create: `docs/operations/shared-survey-calibration-rollout.md`
- Create: `features/integration/shared-survey-flow.test.js`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`
- Modify: `supabase_SQL/Shared Survey Calibration and Freeze.sql` only if verification exposes a defect
- Modify: affected source/test files only if the corresponding focused test reproduces a defect

**Interfaces:**
- Consumes: Tasks 1–8 的完整阶段 2 功能；Supabase 项目 `rzmbmwauomzwiyenafha`。
- Produces: 可回滚的部署记录、远程对象计数、RPC/RLS 实测证据和完整端到端验收结果。

- [ ] **Step 1: 写跨模块端到端状态测试**

```js
const {
  buildSurveyProgress,
  canUseDownstreamActions
} = require("../survey/survey-review-model.js");
const {
  createSurveyReviewClient
} = require("../survey/survey-review-client.js");

function createSharedSurveyHarness() {
  const rows = new Map([
    ["building:B1", { layer_key: "building", object_code: "B1", is_v0_baseline: true, geometry_status: "pending", geometry_revision: 0 }],
    ["building:B2", { layer_key: "building", object_code: "B2", is_v0_baseline: true, geometry_status: "pending", geometry_revision: 0 }]
  ]);
  const context = { teachingProjectId: "p1", villageId: "v1", spaceId: "s1", spaceType: "formal_shared" };
  let actor = "student-a";
  const supabaseClient = {
    async rpc(name, args) {
      assert.equal(name, "confirm_survey_feature_geometry");
      const key = `${args.p_layer_key}:${args.p_object_code}`;
      const row = rows.get(key);
      assert.equal(args.p_expected_revision, row.geometry_revision);
      Object.assign(row, {
        geometry_status: "confirmed_unchanged",
        geometry_revision: row.geometry_revision + 1,
        latest_actor: actor
      });
      return { data: row, error: null };
    }
  };
  const client = createSurveyReviewClient({ supabaseClient, getContext: () => context });
  return {
    as(userId) {
      actor = userId;
      return {
        confirm: (layerKey, objectCode) => {
          const row = rows.get(`${layerKey}:${objectCode}`);
          return client.confirmGeometry({ layerKey, objectCode, expectedRevision: row.geometry_revision, lockToken: "test-lock" });
        },
        canUploadPhoto: (layerKey, objectCode) => canUseDownstreamActions(rows.get(`${layerKey}:${objectCode}`))
      };
    },
    progress: () => buildSurveyProgress([...rows.values()])
  };
}

test("one student's geometry confirmation unlocks the same object for the whole class", async () => {
  const harness = createSharedSurveyHarness();
  await harness.as("student-a").confirm("building", "B1");
  assert.equal(harness.progress().reviewedBaseline, 1);
  assert.equal(harness.as("student-b").canUploadPhoto("building", "B1"), true);
  assert.equal(harness.as("student-b").canUploadPhoto("building", "B2"), false);
});
```

同文件覆盖：锁冲突、旧修订拒绝、增加/删除混合统计、断线写保护、冻结后共享继续编辑、V2 不升级 V1 小组底图引用。

- [ ] **Step 2: 运行阶段 2 聚焦测试**

Run:

```powershell
$tests = @(
  'features/data/shared-survey-calibration-migration.test.js',
  'features/data/feature-edit-session.test.js',
  'features/data/survey-downstream-gate.test.js',
  'features/survey/survey-review-model.test.js',
  'features/survey/survey-review-client.test.js',
  'features/survey/survey-review-panel.test.js',
  'features/survey/survey-realtime-controller.test.js',
  'features/map-editing/survey-review-overlay.test.js',
  'features/admin/survey-admin.test.js',
  'features/integration/shared-survey-flow.test.js'
)
node --test --test-isolation=none $tests
```

Expected: 全部 PASS，无跳过。

- [ ] **Step 3: 对远程应用迁移前执行只读盘点**

在 Supabase 上记录：目标项目和正式共享空间 ID、V0 三类图层对象数、活动锁数、现有快照数、孤立 `planning_features` 数。将结果写入 `docs/operations/shared-survey-calibration-rollout.md`，并确认迁移将初始化的固定分母与 V0 数量一致。

- [ ] **Step 4: 将阶段 2 迁移应用到指定项目**

通过可用的 Supabase MCP 将 `Shared Survey Calibration and Freeze.sql` 整体应用到项目 `rzmbmwauomzwiyenafha`。如果 MCP 不可用，停止在“本地迁移已验证、远程未执行”状态并报告，不通过拆分粘贴或重复运行未知片段绕过。

- [ ] **Step 5: 执行真实 RLS/RPC 验收矩阵**

至少使用管理员、学生甲、学生乙和无项目成员四种身份验证：

```text
管理员：读取统计、查看历史、无锁时冻结、恢复历史 -> 允许
学生甲：在所属 formal_shared 获取锁、确认、修改 -> 允许
学生乙：甲持锁时保存 -> 拒绝；甲确认后补充同对象信息 -> 允许
无项目成员：读取或写入该项目校核状态 -> 拒绝
匿名用户：读取/调用校核、恢复、冻结 -> 拒绝
```

再验证旧修订返回 `GEOMETRY_REVISION_CONFLICT`、未校核后续写入返回 `GEOMETRY_REVIEW_REQUIRED`、有活动锁冻结返回 `ACTIVE_FEATURE_LOCKS`。

- [ ] **Step 6: 浏览器人工验收学生端和管理员端**

学生端检查：`126 / 380` 类固定口径、聚焦后已校核对象仍以 18% 不透明度可见、蓝色锁提示、红色问题标记、断线提示、窄屏工具栏不变形。管理员端检查：项目上下文、分层统计、筛选定位、历史恢复、锁阻止冻结、冻结成功后共享空间仍可编辑。

- [ ] **Step 7: 运行全量回归**

Run:

```powershell
$tests = rg --files features | Where-Object { $_ -like '*.test.js' }
node --test --test-isolation=none $tests
node --check app.js
node --check admin.js
git diff --check
```

Expected: 所有测试 PASS；两个语法检查退出码为 0；`git diff --check` 无输出。忽略既有不可访问 pytest 临时目录的枚举警告，但不能忽略测试失败。

- [ ] **Step 8: 更新迭代日志并提交验收结果**

在 `docs/PLATFORM_ITERATION_LOG.md` 记录远程迁移时间、正式项目/村庄/空间、V0 固定分母、快照版本和验收结果；不得写入密钥或访问令牌。

```bash
git add docs/operations/shared-survey-calibration-rollout.md docs/PLATFORM_ITERATION_LOG.md features/integration/shared-survey-flow.test.js
git add "supabase_SQL/Shared Survey Calibration and Freeze.sql" features app.js admin.js admin.html index.html style.css
git commit -m "test: verify shared survey calibration rollout"
```

## Final Completion Gate

- [ ] V0 建筑、道路、水系全部具有唯一校核行，固定分母与发布数据一致。
- [ ] 学生端对象级门禁、共享解锁、锁冲突和旧修订拒绝均在真实项目通过。
- [ ] 属性、照片、对象问题、讨论不存在可绕过的旧写入路径。
- [ ] 固定进度、动态对象数和分层统计一致。
- [ ] 管理员恢复只追加历史，冻结不修改共享空间或旧快照。
- [ ] 照片和问题证据在冻结版本中稳定可读，对象讨论未复制。
- [ ] V2 不自动修改引用 V1 的小组空间。
- [ ] 全量 Node 测试、语法检查、SQL 契约检查和真实 Supabase 验收全部通过。
- [ ] 未提交密钥、原始数据、照片二进制或本机绝对资源路径。
