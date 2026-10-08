# Personal Figure-Ground Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生从村庄影像绘制范围、恢复并预览地理处理成果、主动导入个人空间、管理图层版本，最终动态合成可继续编辑的图底关系。

**Architecture:** 保持 GitHub Pages 静态前端、Supabase 队列与私有 Storage、Win11 出站 Worker 的现有边界。新增一个严格 RLS 的个人空间版本数据模型和安全 RPC；前端把“任务成果临时预览”与“个人空间正式版本”分开，并由现有地图渲染管线读取当前版本。村庄原始 TIF 仅留服务器，生成可提交 Git 的 WebP 预览和 WGS84 目录。

**Tech Stack:** 原生 JavaScript、OpenLayers、Supabase JS/PostgreSQL/PostGIS/Storage、Node `node:test`、Python 3.10/3.11、Rasterio、Pillow、Pytest。

## Global Constraints

- 每个 `(owner_id, course_id, village_id, space_type='course_personal')` 只有一个个人空间。
- 完成任务先预览，只有明确点击“保存到我的个人空间”才导入。
- 重复导入创建新版本，不覆盖或自动删除旧版本。
- 建筑、道路、水系可编辑；等高线当前只读。
- 图底关系动态引用当前版本，不复制几何。
- owner 可编辑，teacher/admin 只读，其他学生和 anon 不可读。
- 不把原始 TIF、DEM、OSM、模型权重或服务器绝对路径提交到 Git。
- 移除当前教学入口中的农田和公共空间矢量，但保留数据库历史行与“公共空间需求”调查类别。
- 继续兼容既有系统现状空间和小组空间。
- 实施期间不创建一串中间提交；完成并验证后统一整理为一个代码提交。

---

### Task 1: 固化 AOI 闭合后可见行为

**Files:**
- Modify: `features/geoprocessing/geoprocessing-aoi.js`
- Modify: `features/geoprocessing/geoprocessing-aoi.test.js`
- Modify: `features/ui/course-workbench.js`
- Modify: `features/ui/course-workbench.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: OpenLayers `Map`, `VectorSource`, `VectorLayer`, `Draw`, `GeoJSON`。
- Produces: `createAoiController(...).start()/clear()/validate()/destroy()`；闭合后移除一次性 Draw，但保留 zIndex 1000 的 AOI 图层。

- [ ] **Step 1: 保留当前失败回归测试**

```js
assert.equal(createdLayer.options.zIndex > 2, true);
draw.handlers.drawend();
assert.equal(map.removedInteractions.includes(draw), true);
assert.deepEqual(controller.getGeoJSON(), completedGeometry);
```

- [ ] **Step 2: 运行测试确认修复前失败或当前补丁通过**

Run: `node --test features/geoprocessing/geoprocessing-aoi.test.js features/ui/course-workbench.test.js`
Expected: 当前工作树补丁为 `PASS`；若回退 `zIndex` 或 `drawend` 清理则测试失败。

- [ ] **Step 3: 固化最小实现并统一缓存版本**

```js
const layer = new VectorLayer({ source, zIndex: 1000 });
draw.on("drawend", () => {
  const completedDraw = draw;
  draw = null;
  map.removeInteraction(completedDraw);
});
```

- [ ] **Step 4: 运行测试**

Run: `node --test features/geoprocessing/geoprocessing-aoi.test.js features/ui/course-workbench.test.js`
Expected: `11 tests`, `11 pass`。

### Task 2: 生成并加载村庄 TIF 网页预览

**Files:**
- Create: `server/src/village_processing/preview.py`
- Create: `server/tests/test_preview.py`
- Create: `assets/villages/catalog.json`
- Create: `assets/villages/mibu/preview.webp`
- Modify: `server/src/village_processing/__main__.py`
- Modify: `features/geoprocessing/geoprocessing-aoi.js`
- Modify: `features/geoprocessing/geoprocessing-aoi.test.js`
- Modify: `server/docs/native-runtime-operations.md`

**Interfaces:**
- Consumes: `villages.yaml` 中 `imagery` 与 `bounds`，本地 `DATA_ROOT`。
- Produces: `python -m village_processing preview --village mibu --assets-root <repo>/assets/villages`；`loadVillagePreview({map, ol, villageId, catalogUrl})`。

- [ ] **Step 1: 写预览生成失败测试**

```python
def test_generate_preview_writes_rgb_webp_and_catalog(tmp_path, raster_fixture):
    result = generate_preview(raster_fixture, tmp_path, "mibu", "米埗村", max_edge=1600)
    assert result["preview_path"] == "villages/mibu/preview.webp"
    assert len(result["bounds"]) == 4
    with Image.open(tmp_path / "villages/mibu/preview.webp") as image:
        assert image.mode == "RGB"
        assert max(image.size) <= 1600
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_preview.py -q`
Expected: `ModuleNotFoundError` 或 `generate_preview` 未定义。

- [ ] **Step 3: 实现确定性预览生成**

```python
def generate_preview(source_path, assets_root, village_id, display_name, max_edge=2000):
    with rasterio.open(source_path) as src:
        rgb = read_display_rgb(src, max_edge=max_edge)
        bounds = transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
    output = Path(assets_root) / "villages" / village_id / "preview.webp"
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgb).save(output, "WEBP", quality=86, method=6)
    return {"id": village_id, "name": display_name,
            "preview_path": f"villages/{village_id}/preview.webp",
            "bounds": list(bounds)}
```

- [ ] **Step 4: 前端加载预览并缩放到村庄范围**

```js
async function loadVillagePreview({ map, ol, villageId, catalogUrl = "assets/villages/catalog.json" }) {
  const catalog = await fetch(catalogUrl, { cache: "no-cache" }).then((response) => response.json());
  const village = catalog.villages.find((item) => item.id === villageId);
  if (!village) throw new Error("VILLAGE_PREVIEW_NOT_FOUND");
  // 使用 ImageStatic + transformExtent，把预览置于矢量底图之上、AOI 之下。
  return village;
}
```

- [ ] **Step 5: 生成米埗村公开预览并验证**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing preview --village mibu --assets-root assets`
Expected: 生成 `assets/villages/mibu/preview.webp` 和更新后的 `assets/villages/catalog.json`，目录不含 E 盘绝对路径。

- [ ] **Step 6: 运行前后端测试**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_preview.py server/tests/test_catalog.py -q`
Expected: 全部通过。

Run: `node --test features/geoprocessing/geoprocessing-aoi.test.js`
Expected: 全部通过。

### Task 3: 新建安全的个人空间与图层版本数据库模型

**Files:**
- Create: `supabase_SQL/Personal Figure Ground Spaces and Layer Versions.sql`
- Create: `features/data/personal-space-security.test.js`

**Interfaces:**
- Consumes: `auth.uid()`, `profiles.role`, `geoprocessing_runs`, `geoprocessing_artifacts`。
- Produces: 表 `course_personal_spaces`, `personal_result_bundles`, `personal_layer_versions`, `personal_layer_features`, `personal_layer_selections`；RPC `ensure_course_personal_space`, `import_geoprocessing_result`, `set_personal_layer_version`, `delete_personal_layer_version`。

- [ ] **Step 1: 写 SQL 安全契约失败测试**

```js
assert.match(sql, /unique\s*\(owner_id,\s*course_id,\s*village_id,\s*space_type\)/i);
assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/i);
assert.match(sql, /current_profile_role\(\)\s+in\s*\('teacher','admin'\)/i);
assert.match(sql, /create or replace function public\.import_geoprocessing_result/i);
assert.doesNotMatch(sql, /grant execute[^;]+import_geoprocessing_result[^;]+to anon/i);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/data/personal-space-security.test.js`
Expected: SQL 文件不存在而失败。

- [ ] **Step 3: 创建表、约束和 RLS**

```sql
create table public.course_personal_spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  village_id text not null,
  space_type text not null default 'course_personal' check (space_type='course_personal'),
  title text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, course_id, village_id, space_type)
);

create table public.personal_layer_versions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.course_personal_spaces(id) on delete cascade,
  bundle_id uuid not null references public.personal_result_bundles(id) on delete cascade,
  layer_key text not null check (layer_key in ('building','road','water','contours')),
  version_number integer not null check (version_number > 0),
  source_run_id uuid not null references public.geoprocessing_runs(id),
  created_at timestamptz not null default now(),
  unique(space_id, layer_key, version_number),
  unique(space_id, layer_key, source_run_id)
);
```

- [ ] **Step 4: 实现安全且幂等的 RPC**

```sql
create or replace function public.ensure_course_personal_space(
  p_course_id text, p_village_id text, p_title text default null
) returns public.course_personal_spaces
language plpgsql security definer set search_path=public as $$
declare v_space public.course_personal_spaces;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.course_personal_spaces(owner_id,course_id,village_id,title)
  values(auth.uid(),p_course_id,p_village_id,coalesce(nullif(trim(p_title),''),'我的个人图底空间'))
  on conflict(owner_id,course_id,village_id,space_type) do update set title=course_personal_spaces.title
  returning * into v_space;
  return v_space;
end; $$;
```

`import_geoprocessing_result` 在单一事务内验证 run owner/status/course/village，按 artifact 映射插入 bundle、version、feature 与 current selection；`unique(space_id, source_run_id)` 使重复点击返回同一 bundle。

- [ ] **Step 5: 限定授权并运行安全测试**

Run: `node --test features/data/personal-space-security.test.js features/data/geoprocessing-queue-security.test.js features/data/supabase-migration-security.test.js`
Expected: 全部通过，且 worker RPC 仍只授权 `service_role`。

### Task 4: 前端个人空间客户端与任务恢复

**Files:**
- Create: `features/data/personal-space-client.js`
- Create: `features/data/personal-space-client.test.js`
- Modify: `features/geoprocessing/geoprocessing-client.js`
- Modify: `features/geoprocessing/geoprocessing-client.test.js`
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/geoprocessing/geoprocessing-panel.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 3 RPC 与表；`listMine(villageId)`、`listArtifacts(runId)`、签名 Storage URL。
- Produces: `createPersonalSpaceClient`; 面板 `mount()` 自动恢复最近任务；`previewArtifacts(runId)`；`saveRun(runId)`。

- [ ] **Step 1: 写客户端与恢复失败测试**

```js
await client.ensure({ courseId: "course-1", villageId: "mibu", title: "张三 · 个人图底空间" });
assert.deepEqual(fake.calls[0], ["ensure_course_personal_space", {
  p_course_id: "course-1", p_village_id: "mibu", p_title: "张三 · 个人图底空间"
}]);

panel.mount();
await mounted;
assert.equal(fake.listMineCalls, 1);
assert.match(container.innerHTML, /任务状态：completed/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/data/personal-space-client.test.js features/geoprocessing/geoprocessing-panel.test.js`
Expected: 新模块不存在，且面板未调用 `listMine`。

- [ ] **Step 3: 实现 personal-space-client**

```js
async ensure({ courseId, villageId, title }) {
  return assertNoError(await supabaseClient.rpc("ensure_course_personal_space", {
    p_course_id: String(courseId), p_village_id: String(villageId), p_title: title || null
  }));
},
async importRun(runId) {
  return assertNoError(await supabaseClient.rpc("import_geoprocessing_result", { p_run_id: runId }));
},
async listVersions(spaceId) {
  return assertNoError(await supabaseClient.from("personal_layer_versions")
    .select("*,personal_layer_selections!left(*)").eq("space_id", spaceId)
    .order("created_at", { ascending: false }));
}
```

- [ ] **Step 4: 面板 mount 恢复最近任务**

```js
async function restoreRuns() {
  const runs = await client.listMine(villageId);
  const latest = Array.isArray(runs) ? runs[0] : null;
  if (!latest) return;
  updateRun(latest);
  if (["queued", "claimed", "running", "cancel_requested"].includes(latest.status)) {
    unsubscribe = client.subscribe(latest.id, updateRun);
  }
}
```

- [ ] **Step 5: 运行测试**

Run: `node --test features/data/personal-space-client.test.js features/geoprocessing/geoprocessing-client.test.js features/geoprocessing/geoprocessing-panel.test.js`
Expected: 全部通过。

### Task 5: 成果临时预览与显式保存

**Files:**
- Create: `features/geoprocessing/geoprocessing-result-layers.js`
- Create: `features/geoprocessing/geoprocessing-result-layers.test.js`
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/geoprocessing/geoprocessing-panel.test.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- Consumes: 五类 GeoJSON artifact signed URL。
- Produces: `createResultLayerPreview({map, ol}).show(artifacts)/clear()/setVisible()`；面板按钮“在地图中预览”“保存到我的个人空间”。

- [ ] **Step 1: 写 artifact 映射和水系合并失败测试**

```js
assert.equal(mapArtifactType("buildings"), "building");
assert.equal(mapArtifactType("roads"), "road");
assert.equal(mapArtifactType("waterways"), "water");
assert.equal(mapArtifactType("water_areas"), "water");
assert.equal(mapArtifactType("contours"), "contours");
assert.equal(groupArtifacts(artifacts).water.length, 2);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/geoprocessing/geoprocessing-result-layers.test.js features/geoprocessing/geoprocessing-panel.test.js`
Expected: 模块/按钮不存在而失败。

- [ ] **Step 3: 实现临时地图预览**

```js
const ARTIFACT_LAYER_MAP = Object.freeze({
  buildings: "building", roads: "road", waterways: "water",
  water_areas: "water", contours: "contours"
});

async function fetchGeoJson(artifact, createUrl) {
  const signed = await createUrl(artifact.storage_path);
  const url = signed.signedUrl || signed.signedURL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ARTIFACT_DOWNLOAD_${response.status}`);
  return response.json();
}
```

- [ ] **Step 4: 面板接入预览、保存与反馈**

```html
<button type="button" data-preview-run>在地图中预览</button>
<button type="button" data-save-run>保存到我的个人空间</button>
```

保存成功后显示“已保存为第 N 批个人图层版本”，触发 `onImported(bundle)` 刷新空间；预览下载失败时保留既有个人空间数据并允许重试。

- [ ] **Step 5: 运行测试**

Run: `node --test features/geoprocessing/geoprocessing-result-layers.test.js features/geoprocessing/geoprocessing-panel.test.js`
Expected: 全部通过。

### Task 6: 个人图层版本选择、比较、删除与动态图底关系

**Files:**
- Create: `features/ui/personal-layer-versions.js`
- Create: `features/ui/personal-layer-versions.test.js`
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/space-panel-events.js`
- Modify: `features/ui/map-style.js`
- Modify: `features/map-editing/overlay-renderer.js`
- Modify: `features/map-editing/geometry-editor.js`
- Modify: `features/data/feature-db.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`

**Interfaces:**
- Consumes: 当前个人空间、版本列表、`personal_layer_features` 当前版本行。
- Produces: 每类图层的当前版本、一个可选比较版本、删除操作；`figureGround` 读取四类当前版本；等高线编辑禁用。

- [ ] **Step 1: 写版本选择与动态组合失败测试**

```js
assert.deepEqual(resolveCurrentVersions(selections), {
  building: "b-v2", road: "r-v1", water: "w-v1", contours: "c-v1"
});
assert.deepEqual(resolveFigureGroundLayerKeys(), ["building", "road", "water", "contours"]);
assert.equal(canEditPersonalLayer("contours"), false);
assert.equal(canEditPersonalLayer("water"), true);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/ui/personal-layer-versions.test.js`
Expected: 模块不存在而失败。

- [ ] **Step 3: 实现无副本的版本状态模型**

```js
function resolveFigureGroundLayerKeys() {
  return ["building", "road", "water", "contours"];
}
function canEditPersonalLayer(layerKey) {
  return ["building", "road", "water"].includes(layerKey);
}
```

版本切换调用 `set_personal_layer_version`；删除调用 `delete_personal_layer_version`；比较版本只在前端以半透明样式加载，不改变 current selection。

- [ ] **Step 4: 把当前版本接入现有地图读取与编辑**

```js
const effectiveLayerKeys = selectedLayers.includes("figureGround")
  ? ["building", "road", "water", "contours"]
  : selectedLayers;
```

个人空间查询增加 `layer_version_id` 条件；编辑保存继续写入当前版本，等高线不进入几何编辑工具。版本变化后失效相应缓存并重绘。

- [ ] **Step 5: 运行地图与空间回归测试**

Run: `node --test features/ui/personal-layer-versions.test.js features/ui/workspace-space-management.test.js features/ui/unified-workspace-interactions.test.js features/data/feature-edit-session.test.js`
Expected: 全部通过。

### Task 7: 移除农田和公共空间当前教学图层

**Files:**
- Delete: `data/croplands.csv`
- Delete: `data/croplands.geojson`
- Delete: `data/open_spaces.csv`
- Delete: `data/open_spaces.geojson`
- Modify: `app.js`
- Modify: `features/course/course-workspace-adapter.js`
- Modify: `features/course/course-workspace-adapter.test.js`
- Modify: `features/data/copy-space-seed.js`
- Modify: `features/data/feature-db.js`
- Modify: `features/data/feature-edit-session.js`
- Modify: `features/data/feature-edit-session.test.js`
- Modify: `features/map-editing/geometry-editor.js`
- Modify: `features/map-editing/overlay-renderer.js`
- Modify: `features/ui/map-style.js`
- Modify: `features/ui/space-panel.js`

**Interfaces:**
- Consumes: 当前允许图层集合。
- Produces: `figureGround/building/road/water/contours`；不加载或展示 `cropland/openSpace`。

- [ ] **Step 1: 写当前图层集合失败测试**

```js
assert.deepEqual(space.selectedLayers, ["building", "road", "water"]);
assert.doesNotMatch(readFileSync("app.js", "utf8"), /data\/croplands\.geojson/);
assert.doesNotMatch(readFileSync("app.js", "utf8"), /data\/open_spaces\.geojson/);
```

- [ ] **Step 2: 运行测试确认旧默认值失败**

Run: `node --test features/course/course-workspace-adapter.test.js features/data/feature-edit-session.test.js`
Expected: 旧断言仍含 `cropland/openSpace`。

- [ ] **Step 3: 删除静态文件和专用分支**

只删除已授权的四个静态文件及仅服务于两类图层的配置、缓存、按钮和初始化分支；不执行数据库 `DELETE`，不移除社区问题类别“公共空间需求”。

- [ ] **Step 4: 运行静态入口扫描和相关测试**

Run: `rg -n "croplands\.geojson|open_spaces\.geojson|btnTargetCropland|btnTargetOpenSpace" app.js features data`
Expected: 无匹配。

Run: `node --test features/course/course-workspace-adapter.test.js features/data/feature-edit-session.test.js features/ui/workspace-space-management.test.js`
Expected: 全部通过。

### Task 8: 全量验证、运行手册与一次提交整理

**Files:**
- Modify: `server/docs/native-runtime-operations.md`
- Modify: `server/docs/supabase-worker-operations.md`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Consumes: Tasks 1-7 全部成果。
- Produces: Win11 教师启动、换村预览、Supabase SQL 应用、学生完整流程的可复现说明。

- [ ] **Step 1: 更新操作文档**

```powershell
.\server\scripts\start_platform_worker.ps1
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing preview --village mibu --assets-root assets
```

文档明确：先在 Supabase SQL Editor 执行新迁移；GitHub 只提交 WebP/目录而不是 TIF；学生浏览器不直连 E 盘和 Python，而是经 Supabase 队列调用 Worker。

- [ ] **Step 2: 运行全部 Node 测试**

Run: `node --test features/**/*.test.js`
Expected: 0 failed。

- [ ] **Step 3: 运行全部 Python 测试**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests -q -m "not live_supabase"`
Expected: 0 failed，live Supabase 测试被排除。

- [ ] **Step 4: 运行语法、差异和敏感路径检查**

Run: `node --check app.js`
Expected: exit 0。

Run: `git diff --check`
Expected: 无错误。

Run: `rg -n "E:\\\\|service_role|SUPABASE_SERVICE" assets features index.html app.js`
Expected: 公共网页资源中无服务器绝对路径或 service-role 密钥。

- [ ] **Step 5: 本机端到端验收**

用普通学生账号完成：打开个人空间 → 加载米埗村预览 → 绘制并闭合 AOI → 提交任务 → 刷新后仍可见 → 预览五类 artifact → 保存 → 四类正式图层出现 → 修改建筑/道路/水系 → 再次运行并形成第二版 → 比较、切换、删除非当前旧版。再用另一学生账号验证不可读，用 teacher/admin 验证只读。

- [ ] **Step 6: 整理为一次最终代码提交**

```powershell
git add app.js index.html styles.css features server supabase_SQL assets docs
git commit -m "feat: add personal figure-ground production workflow"
```

Expected: 不产生多个中间功能提交；如需与先前设计提交合并，只在用户明确要求后执行历史改写。
