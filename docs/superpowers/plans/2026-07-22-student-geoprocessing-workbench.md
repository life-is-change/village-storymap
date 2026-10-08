# Student Geoprocessing Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有课程网页中加入学生个人“图底生产”任务，让另一台电脑可以提交 AOI、查看处理进度、预览五类结果并复制到个人空间。

**Architecture:** 新模块保持现有 IIFE/CommonJS 双运行风格，浏览器使用现有 `window.VillageSupabaseClient`。任务面板只调用受限 RPC；结果从 private Storage 读取并作为个人 OpenLayers 图层加载，建筑/道路/水面可分批复制到个人编辑空间，水路线和等高线保持参考层。

**Tech Stack:** Vanilla JavaScript、Node `node:test`、Supabase JS v2、OpenLayers 10、现有 course workbench、planning spaces 和 feature DB。

## Global Constraints

- 网页只使用 publishable/anon key，不出现 service-role key。
- `owner_id` 不由浏览器提供；提交 RPC 从 Supabase Auth session 识别用户。
- 一名学生最多保留 2 个未结束任务；默认三模块全选。
- 参数固定为建筑阈值 0.1–0.95、等高距 5/10、平滑 0/1。
- 结果默认只进入个人预览；必须点击“复制到我的个人空间”才进入编辑层。
- 不直接覆盖 `current` 基准空间或小组共享空间。
- 依赖前两份计划的 RPC、Storage 路径和 artifact 契约。

---

### Task 1: 浏览器任务模型与 Supabase Client

**Files:**
- Create: `features/geoprocessing/geoprocessing-client.js`
- Create: `features/geoprocessing/geoprocessing-client.test.js`

**Interfaces:**
- Produces: `createGeoprocessingClient({supabaseClient})`；方法 `getVillage(villageId)`、`submit(payload)`、`getRun(runId)`、`listMine(villageId)`、`subscribe(runId,onChange)`、`cancel(runId)`、`listArtifacts(runId)`、`createArtifactUrl(path)`。

- [ ] **Step 1: 写 RPC payload 与订阅清理测试**

```javascript
test("submit sends only whitelisted fields and never owner_id", async () => {
  const client = createGeoprocessingClient({ supabaseClient: fakeSupabase() });
  await client.submit({ courseId: "mibu-village-planning", villageId: "mibu", aoi: AOI,
    requestedSteps: ["buildings", "roads_water", "contours"], parameters: { contour_interval_m: 5, smoothing_sigma: 1 } });
  assert.equal(fake.lastRpc, "submit_geoprocessing_run");
  assert.equal("owner_id" in fake.lastPayload, false);
});

test("subscribe removes channel on dispose", () => {
  const dispose = client.subscribe(RUN_ID, () => {});
  dispose();
  assert.equal(fake.removedChannels.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/geoprocessing/geoprocessing-client.test.js`

Expected: FAIL，client 尚不存在。

- [ ] **Step 3: 按现有 IIFE 风格实现 Client**

```javascript
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createGeoprocessingClient({ supabaseClient }) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
    return {
      async submit(payload) {
        const args = {
          p_course_id: payload.courseId,
          p_village_id: payload.villageId,
          p_aoi: payload.aoi,
          p_requested_steps: payload.requestedSteps,
          p_parameters: payload.parameters
        };
        const { data, error } = await supabaseClient.rpc("submit_geoprocessing_run", args);
        if (error) throw error;
        return data;
      }
    };
  }
  return { createGeoprocessingClient };
});
```

补齐其余接口；查询必须按 `id`/`village_id` 过滤，依赖 RLS 做 owner 隔离。`getVillage` 从 `geoprocessing_villages` 读取 active、bounds 和 max AOI。订阅过滤器为 `id=eq.<runId>`，dispose 时调用 `removeChannel`；订阅 5 秒内未进入 SUBSCRIBED 或连接中断时，每 10 秒调用 `getRun` 轮询，恢复订阅后停止轮询。

- [ ] **Step 4: 运行测试并提交**

Run: `node --test features/geoprocessing/geoprocessing-client.test.js`

Expected: 全部通过。

```bash
git add features/geoprocessing/geoprocessing-client.js features/geoprocessing/geoprocessing-client.test.js
git commit -m "feat: add browser geoprocessing client"
```

### Task 2: AOI 绘制与提交参数模型

**Files:**
- Create: `features/geoprocessing/geoprocessing-aoi.js`
- Create: `features/geoprocessing/geoprocessing-aoi.test.js`

**Interfaces:**
- Produces: `createAoiController({map, ol, villageBounds})`；`start()`、`clear()`、`getGeoJSON()`、`validate()`。

- [ ] **Step 1: 写边界、面积和顶点测试**

```javascript
test("AOI outside registered imagery is rejected", () => {
  const result = validateAoi(OUTSIDE_POLYGON, MIBU_BOUNDS);
  assert.deepEqual(result, { ok: false, code: "AOI_OUT_OF_BOUNDS" });
});

test("valid AOI returns normalized polygon", () => {
  const result = validateAoi(INSIDE_POLYGON, MIBU_BOUNDS);
  assert.equal(result.ok, true);
  assert.equal(result.geometry.type, "Polygon");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/geoprocessing/geoprocessing-aoi.test.js`

Expected: FAIL，AOI 模块尚不存在。

- [ ] **Step 3: 实现单多边形绘制控制器**

控制器使用 OpenLayers `Draw(type='Polygon')`；每次只保留一个 AOI；输出 EPSG:4326 GeoJSON；客户端限制 500 顶点和影像 bounds，但数据库仍重复验证。`clear()` 移除 interaction 和临时 feature，切换 3D 或关闭面板时自动调用。

```javascript
function createAoiController({ map, ol, villageBounds }) {
  const source = new ol.VectorSource();
  let draw = null;
  return {
    start() {
      source.clear();
      draw = new ol.Draw({ source, type: "Polygon" });
      map.addInteraction(draw);
    },
    clear() {
      if (draw) map.removeInteraction(draw);
      draw = null;
      source.clear();
    },
    getGeoJSON() {
      const feature = source.getFeatures()[0];
      return feature ? new ol.GeoJSON().writeGeometryObject(feature.getGeometry()) : null;
    }
  };
}
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test features/geoprocessing/geoprocessing-aoi.test.js`

Expected: 全部通过。

```bash
git add features/geoprocessing/geoprocessing-aoi.js features/geoprocessing/geoprocessing-aoi.test.js
git commit -m "feat: add bounded processing AOI tool"
```

### Task 3: “图底生产”课程阶段和任务面板

**Files:**
- Modify: `features/course/course-model.js`
- Modify: `features/ui/course-workbench.js`
- Modify: `features/ui/course-workbench.test.js`
- Modify: `supabase_SQL/Task-driven Course Workbench Schema.sql`
- Create: `features/geoprocessing/geoprocessing-panel.js`
- Create: `features/geoprocessing/geoprocessing-panel.test.js`
- Modify: `index.html`
- Modify: `style.css`

**Interfaces:**
- Produces: 新任务 `figure-ground-compose` / stage `figure_ground`；`createGeoprocessingPanel(deps)`。

- [ ] **Step 1: 写课程阶段和面板红灯测试**

```javascript
test("course includes individual figure-ground stage before survey", () => {
  const ids = DEFAULT_COURSE.tasks.map((item) => item.id);
  assert.ok(ids.indexOf("figure-ground-compose") < ids.indexOf("survey-collect"));
});

test("panel defaults to all processors and safe parameters", () => {
  const html = renderGeoprocessingForm({ availability: "available" });
  assert.match(html, /value="buildings"[^>]*checked/);
  assert.match(html, /value="roads_water"[^>]*checked/);
  assert.match(html, /value="contours"[^>]*checked/);
  assert.match(html, /value="5"[^>]*selected/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/course/course-model.test.js features/ui/course-workbench.test.js features/geoprocessing/geoprocessing-panel.test.js`

Expected: FAIL，新阶段和面板尚不存在。

- [ ] **Step 3: 插入个人图底生产阶段**

`course-model.js` 在 learning 和 survey 之间加入：

```javascript
{ key: "figure_ground", title: "图底生产", kind: "practice", taskIds: ["figure-ground-compose"] }
```

任务包含“绘制 AOI → 运行建筑识别 → 获取道路水系 → 生成等高线 → 预览与复制个人空间”的 outcomes/actions。`course-workbench.js` 对该 task 返回 `{type:'geoprocessing'}` 并渲染面板挂载点，不要求小组空间。

同步更新 `Task-driven Course Workbench Schema.sql` 中 `mibu-village-planning` 的 stages/tasks JSON，保持 migration 可重复执行，避免远端课程种子覆盖本地新阶段。

- [ ] **Step 4: 实现表单和状态卡**

表单字段固定：三步骤 checkbox、建筑阈值默认 0.35、等高距 5/10、平滑无/轻度；提交前要求登录、有效 AOI、至少一个步骤。状态卡显示 queued/claimed/running/completed/failed/canceled，阶段进度和安全错误信息；worker offline 时允许排队但明确提示。

```javascript
const DEFAULT_PARAMETERS = Object.freeze({
  building_score_threshold: 0.35,
  contour_interval_m: 5,
  smoothing_sigma: 1
});
const DEFAULT_STEPS = Object.freeze(["buildings", "roads_water", "contours"]);
```

queued/claimed/running 状态卡提供“取消任务”按钮，调用 `request_geoprocessing_cancel`；completed 才显示预览和复制按钮；failed/canceled 只显示重新提交入口。教师控制暂不放入学生面板，由教师 Runbook 使用受角色保护的 RPC。

- [ ] **Step 5: 加载脚本与样式**

`index.html` 在 `course-workbench.js` 前加载 client、AOI、panel；`app.js` 仍最后加载。CSS 使用现有 course panel 变量，窄屏下单列，不新增外部 UI 依赖。

```html
<script defer src="features/geoprocessing/geoprocessing-client.js"></script>
<script defer src="features/geoprocessing/geoprocessing-aoi.js"></script>
<script defer src="features/geoprocessing/geoprocessing-panel.js"></script>
<script defer src="features/ui/course-workbench.js"></script>
```

- [ ] **Step 6: 运行测试并提交**

Run: `node --test features/course/course-model.test.js features/ui/course-workbench.test.js features/geoprocessing/geoprocessing-panel.test.js`

Expected: 全部通过。

```bash
git add features/course/course-model.js features/ui/course-workbench.js features/ui/course-workbench.test.js features/geoprocessing "supabase_SQL/Task-driven Course Workbench Schema.sql" index.html style.css
git commit -m "feat: add individual figure-ground task panel"
```

### Task 4: 结果预览图层与 artifact 下载

**Files:**
- Create: `features/geoprocessing/geoprocessing-layers.js`
- Create: `features/geoprocessing/geoprocessing-layers.test.js`
- Modify: `app.js`

**Interfaces:**
- Produces: `createResultLayerManager({map, ol})`；`loadArtifacts(artifacts, fetchGeoJSON)`、`setVisible(type,visible)`、`clearRun()`。

- [ ] **Step 1: 写 artifact 映射和清理测试**

```javascript
test("five artifact types map to stable personal layer keys", () => {
  assert.deepEqual(mapArtifactType("buildings"), { layerKey: "generatedBuildings", geometry: "polygon" });
  assert.equal(mapArtifactType("contours").layerKey, "generatedContours");
});

test("switching run clears old vector sources", () => {
  manager.loadArtifacts(RUN_A, artifactsA);
  manager.clearRun();
  assert.equal(fakeMap.layers.length, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/geoprocessing/geoprocessing-layers.test.js`

Expected: FAIL，图层管理器尚不存在。

- [ ] **Step 3: 实现个人结果图层**

分别创建 buildings、roads、waterways、water_areas、contours VectorLayer；feature 添加 `processingRunId`、`artifactType`、`source`。样式与现有正式图层区分为半透明虚线/强调色，避免学生误认为已写入共享空间。下载通过 `createSignedUrl(path, 300)`，失败时重新签名一次，不缓存超过 5 分钟。

```javascript
const ARTIFACT_LAYER_KEYS = Object.freeze({
  buildings: "generatedBuildings",
  roads: "generatedRoads",
  waterways: "generatedWaterways",
  water_areas: "generatedWaterAreas",
  contours: "generatedContours"
});
```

- [ ] **Step 4: 在 `app.js` 注入依赖并绑定生命周期**

`ensureCourseWorkbench()` 创建 panel 时注入 `planMap`、`window.OL`、`supabaseClient`、`showToast`、当前 Auth user 和 `getCurrentSpaceId`。切换 run、退出图底任务、登出或刷新图层时清理订阅和临时图层。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test features/geoprocessing/geoprocessing-layers.test.js features/ui/course-workbench.test.js`

Expected: 全部通过。

```bash
git add features/geoprocessing/geoprocessing-layers.js features/geoprocessing/geoprocessing-layers.test.js app.js
git commit -m "feat: preview private processing result layers"
```

### Task 5: 复制到个人空间并保持共享图层不变

**Files:**
- Modify: `supabase_SQL/Geoprocessing Worker Queue.sql`
- Modify: `features/data/geoprocessing-queue-security.test.js`
- Create: `features/geoprocessing/geoprocessing-importer.js`
- Create: `features/geoprocessing/geoprocessing-importer.test.js`
- Modify: `app.js`

**Interfaces:**
- Produces: `ensure_individual_processing_space(run_id)` RPC；`upsert_individual_processing_features(run_id, layer_key, features)` RPC；`importRunToPersonalSpace(run, artifacts, deps)`。

- [ ] **Step 1: 写个人空间 RLS 和分批导入红灯测试**

```javascript
test("import chunks editable features without touching current space", async () => {
  await importRunToPersonalSpace(run, artifacts, deps);
  assert.equal(fake.directPlanningFeatureWrites, 0);
  assert.ok(fake.rpcCalls.every((call) => call.payload.p_run_id === run.id));
  assert.ok(fake.rpcCalls.filter((call) => call.name === "upsert_individual_processing_features")
    .every((call) => call.payload.p_features.length <= 200));
});
```

SQL 静态测试要求 anonymous/authenticated 不能读取其他 owner 的 individual space；`current` 和既有小组空间行为保持不变。

- [ ] **Step 2: 扩展 migration**

新增 `individual_processing_spaces(space_id text primary key, owner_id uuid, run_id uuid unique)`。`ensure_individual_processing_space` 只接受 owner 本人的 completed run，创建 `individual-<owner短ID>-<run短ID>` planning space。显式 drop planning_spaces 的 `Allow all` policy 和 planning_features 现有四个公开 policy，再建立条件策略：匹配 individual mapping 时必须 `owner_id=auth.uid()`；不匹配时保留既有空间行为。

```sql
create table if not exists public.individual_processing_spaces (
  space_id text primary key references public.planning_spaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null unique references public.geoprocessing_runs(id) on delete cascade
);
drop policy if exists "Allow all" on public.planning_spaces;
drop policy if exists planning_features_read on public.planning_features;
drop policy if exists planning_features_insert on public.planning_features;
drop policy if exists planning_features_update on public.planning_features;
drop policy if exists planning_features_delete on public.planning_features;
```

- [ ] **Step 3: 实现严格分层导入**

```javascript
const EDITABLE_MAPPING = {
  buildings: "building",
  roads: "road",
  water_areas: "water"
};

for (const artifact of artifacts) {
  const layerKey = EDITABLE_MAPPING[artifact.artifact_type];
  if (!layerKey) continue;
  const features = await deps.fetchFeatures(artifact);
  for (let index = 0; index < features.length; index += 200) {
    await deps.client.rpc("upsert_individual_processing_features", {
      p_run_id: run.id,
      p_layer_key: layerKey,
      p_features: features.slice(index, index + 200)
    });
  }
}
```

建筑、道路、水面按每批最多 200 feature 调 RPC，object code 使用 `AI_B_000001`、`OSM_R_000001`、`OSM_W_000001`；props 保留 run ID、source、score/OSM ID。waterways 和 contours 不写 planning_features，继续作为个人参考图层从 private artifact 加载。

- [ ] **Step 4: 刷新空间并切换到个人空间**

RPC 成功后 `app.js` 重新 `loadSpacesFromSupabase()`、切换到返回 space ID、失效三个 editable layer cache 并重新加载。任何批次失败都显示“导入未完成”，不切换空间；RPC 以 `(space_id,layer_key,object_code)` upsert 保证重试幂等。

在运行该步骤的浏览器/live 测试前，重新执行扩展后的 `Geoprocessing Worker Queue.sql`；验证重复执行不报 policy/table/function 已存在错误。

- [ ] **Step 5: 运行安全和导入测试**

Run:

```powershell
node --test features/data/geoprocessing-queue-security.test.js features/geoprocessing/geoprocessing-importer.test.js
```

Expected: 全部通过；没有对 `current` 的写入；每批不超过 200。

- [ ] **Step 6: 提交**

```bash
git add "supabase_SQL/Geoprocessing Worker Queue.sql" features/data/geoprocessing-queue-security.test.js features/geoprocessing/geoprocessing-importer.js features/geoprocessing/geoprocessing-importer.test.js app.js
git commit -m "feat: import generated features into private spaces"
```

### Task 6: 全量回归与跨电脑端到端验收

**Files:**
- Create: `features/geoprocessing/geoprocessing-integration.test.js`
- Create: `docs/GEOPROCESSING_STUDENT_GUIDE.md`
- Create: `docs/GEOPROCESSING_TEACHER_RUNBOOK.md`

**Interfaces:**
- Produces: 可重复的另一台电脑验收清单和课堂启停流程。

- [ ] **Step 1: 写浏览器集成契约测试**

测试 index 脚本顺序、Auth session 缺失时禁用提交、任务订阅释放、完成后五个图层可切换、复制时只导入三类 editable feature、登出清理个人图层。

- [ ] **Step 2: 运行全部 Node 回归**

Run: `$tests = rg --files features | Where-Object { $_ -like '*.test.js' }; node --test $tests`

Expected: 全部通过，0 failed。

- [ ] **Step 3: 运行全部 Python 回归**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests -v`

Expected: 单元测试全部通过；live 测试仅在显式 marker 下运行。

- [ ] **Step 4: 本机浏览器验收**

启动现有静态站点与 Worker，用学生测试账号完成 AOI 提交，确认 queued/running/completed、五层预览、个人空间导入和现有图层编辑。浏览器开发者工具中不得出现 service-role key、E 盘路径或 Worker IP。

- [ ] **Step 5: 另一台电脑验收**

在同校园网或其他可访问网页与 Supabase 的网络打开平台：不连接 Win11 IP、不挂载共享盘、不装 Python；提交完整任务并收到结果。停止 Worker 后提交一项任务，应保持 queued 并显示 offline/等待；恢复 Worker 后自动完成。

- [ ] **Step 6: 恢复和隔离验收**

并行使用两个学生账号：各自只能看自己的 run、artifact 和 individual space。处理时重启 Worker，租约过期后任务只能被重新领取一次且 artifact 不重复。将建筑 batch 保持 1，确认无 GPU 并发。

- [ ] **Step 7: 编写学生指南和教师 Runbook**

学生指南只描述 AOI、参数、结果理解、OSM 补画和 30m DEM 精度限制；教师 Runbook 包含启动/健康检查/暂停/停止、队列观察、错误码、数据更新和 Linux 4090 迁移前置条件，不包含真实 key。

- [ ] **Step 8: 最终提交**

```bash
git add features/geoprocessing/geoprocessing-integration.test.js docs/GEOPROCESSING_STUDENT_GUIDE.md docs/GEOPROCESSING_TEACHER_RUNBOOK.md
git commit -m "test: verify student geoprocessing workflow"
```
