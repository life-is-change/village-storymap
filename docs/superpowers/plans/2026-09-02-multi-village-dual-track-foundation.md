# 多村庄双轨空间体系第一阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能够创建、准备并绑定一个新的正式村庄，让学生在当届米埗村练习项目与正式村庄之间安全切换，同时使二维图层、三维白模和独立实景对照按当前村庄动态加载。

**Architecture:** 新增统一村庄注册表、村庄数据版本、教学项目和村庄实景资源，以 `teachingProjectId + villageId + spaceId` 作为运行时上下文。米埗村保留本地静态数据兼容路径，新村庄通过受控数据清单进入地图与地理处理Worker；个人体验链与共享现状正式链严格隔离。

**Tech Stack:** 原生 JavaScript/DOM、OpenLayers 10.8、Cesium 1.118、Supabase Auth/Postgres/PostGIS/Storage/RLS/RPC、Node.js test runner、Python 3.11、GeoPandas/GDAL/Rasterio/Shapely/PyProj、pytest。

**Spec:** `docs/superpowers/specs/2026-09-02-multi-village-dual-track-foundation-design.md`

## Global Constraints

- 根目录 `/index.html` 继续作为唯一主入口。
- 米埗村是公共练习村庄，但每个教学项目拥有独立的 `practice_shared`。
- 一个教学项目最多绑定一个正式村庄，全部小组规划同一个正式村庄。
- 个人空间的生成和编辑永不写入共享现状空间。
- 米埗村不创建 `group_plan`；正式村庄冻结现状后才开放 `group_plan`。
- 白模高度优先读取明确高度，其次使用层数乘以 3 米，最后回退 9 米。
- 村庄级实景模型继续在独立 Cesium Viewer 中加载，不进入主白模 Viewer。
- Cesium ion Token 使用平台安全配置；村庄记录只保存 Asset ID 和展示参数。
- 新建村庄的必填业务字段只包括名称、是否为练习村庄和村庄范围；默认坐标系继承米埗村配置并仅在高级选项中允许调整。
- 初始数据准备支持两条等价入口：优先复用学生地理处理流程，也允许管理员上传本地处理完成的成果；二者发布后形成同一种V0数据版本。
- 管理员发布V0不依赖个人体验空间汇总，也不要求先人工修正要素；共享现状中的后续修改由学生流程承担。
- 未保存编辑存在时禁止切换项目；切换失败必须保留原上下文。
- 新写入的照片、问题、讨论、修改、版本和日志必须带教学项目、村庄和空间标识。
- 本轮不执行 `git commit`；每个任务以测试、`git diff --check` 和人工审阅作为检查点，只有用户另行授权后才提交。

---

## File Structure

### New files

- `supabase_SQL/Multi-Village Dual-Track Foundation.sql`：规范表、索引、RLS、RPC、米埗村迁移和可重复执行保护。
- `features/villages/village-model.js`：村庄、教学项目、空间类型和上下文的纯函数模型。
- `features/villages/village-model.test.js`：领域规则单元测试。
- `features/villages/village-client.js`：学生与管理员共用的 Supabase 查询/RPC 客户端。
- `features/villages/village-client.test.js`：客户端请求契约测试。
- `features/villages/village-boundary.js`：绘制/GeoJSON/Shapefile归一化、边界摘要和错误码映射。
- `features/villages/village-boundary.test.js`：边界输入单元测试。
- `features/villages/project-switcher.js`：项目切换器渲染和切换事务控制器。
- `features/villages/project-switcher.test.js`：项目列表、空间过滤和事务回滚测试。
- `features/data/village-dataset-resolver.js`：把活动村庄数据清单解析成2D/3D可消费资源。
- `features/data/village-dataset-resolver.test.js`：清单白名单、回退和URL解析测试。
- `features/admin/village-admin.js`：村庄库、创建向导、数据准备、V0发布、绑定和实景发布逻辑。
- `features/admin/village-admin.test.js`：管理员状态机和RPC契约测试。
- `features/3d/village-3d-config.js`：动态白模高度、相机范围和实景配置解析。
- `features/3d/village-3d-config.test.js`：高度、边界相机和实景配置测试。
- `server/src/village_processing/remote_catalog.py`：从运行记录的数据清单解析并安全下载新村庄处理输入。
- `server/src/village_processing/boundary.py`：Shapefile ZIP/GeoJSON边界归一化和校验。
- `server/tests/test_remote_catalog.py`：远程数据清单与安全下载测试。
- `server/tests/test_boundary.py`：边界解析、投影和ZIP安全测试。
- `features/integration/multi-village-flow.test.js`：管理员发布、学生切换和数据隔离的前端集成契约。

### Existing files to modify

- `index.html`：增加项目切换挂载点及新模块脚本，移除固定实景配置的业务职责。
- `style.css`：项目切换器、上下文标识和切换状态样式。
- `app.js`：引入活动上下文，协调空间加载、2D资源、课程、照片、问题和日志。
- `app-3d.js`：按活动村庄加载建筑/道路/影像/相机配置，并重建实景控制器。
- `admin.html`：增加“村庄与项目”菜单和挂载区域。
- `admin.js`：初始化村庄管理模块，不把新逻辑继续堆入该大文件。
- `features/course/course-model.js`：课程模型引用活动教学项目，不再把米埗村当作唯一正式村庄。
- `features/course/course-service.js`：小组和进度查询增加教学项目上下文。
- `features/course/course-workspace-adapter.js`：构建带项目、村庄和空间类型的空间。
- `features/data/personal-space-client.js`：个人空间按教学项目和村庄创建与查询。
- `features/data/feature-edit-session.js`：共享现状锁、保存和快照携带完整上下文。
- `features/geoprocessing/geoprocessing-client.js`：提交动态村庄数据清单版本。
- `features/geoprocessing/geoprocessing-panel.js`：管理员准备空间和学生个人体验空间复用同一处理面板。
- `features/geoprocessing/village-preview.js`：从动态村庄清单获取预览图和边界。
- `features/ui/space-panel.js`：只显示当前项目/村庄允许访问的空间。
- `features/ui/space-panel-events.js`：空间操作携带活动上下文并触发切换保护。
- `features/3d/reality-inset.js`：去除米埗村固定文案和默认业务配置，支持销毁后按村庄重建。
- `server/src/village_processing/contracts.py`：处理请求增加数据版本和受控输入清单引用。
- `server/src/village_processing/catalog.py`：保留米埗村本地目录兼容，同时允许远程数据清单解析器。
- `server/src/village_processing/pipeline.py`：按处理请求解析本地或远程输入。
- `server/config/villages.yaml`：仅保留米埗村本地兼容/回退配置。

---

### Task 1: 建立村庄与教学项目领域模型

**Files:**
- Create: `features/villages/village-model.js`
- Create: `features/villages/village-model.test.js`

**Interfaces:**
- Produces: `SPACE_TYPES`, `VILLAGE_STATUSES`, `normalizeVillage(raw)`, `normalizeTeachingProject(raw)`, `buildProjectEntries({ project, villages })`, `filterSpacesForContext({ spaces, context, actor })`, `buildContextKey(context)`, `canBindFormalVillage({ project, village, hasStudentData })`。
- Consumes: 无外部状态；所有函数保持纯函数，供管理员、学生切换器和 `app.js` 使用。

- [x] **Step 1: 写入领域规则失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SPACE_TYPES,
  buildProjectEntries,
  filterSpacesForContext,
  canBindFormalVillage
} = require('./village-model.js');

test('米埗村练习条目不暴露小组空间', () => {
  const entries = buildProjectEntries({
    project: { id: 'p1', practiceVillageId: 'mibu', formalVillageId: 'v2', formalProjectOpen: true },
    villages: [
      { id: 'mibu', name: '米埗村', isPractice: true, status: 'published' },
      { id: 'v2', name: '正式村庄', isPractice: false, status: 'published' }
    ]
  });
  assert.deepEqual(entries.map((item) => item.role), ['formal', 'practice']);
  const visible = filterSpacesForContext({
    spaces: [
      { id: 'a', teachingProjectId: 'p1', villageId: 'mibu', spaceType: SPACE_TYPES.PRACTICE_PERSONAL, ownerId: 'u1' },
      { id: 'b', teachingProjectId: 'p1', villageId: 'mibu', spaceType: SPACE_TYPES.PRACTICE_SHARED },
      { id: 'c', teachingProjectId: 'p1', villageId: 'mibu', spaceType: SPACE_TYPES.GROUP_PLAN, groupId: 'g1' }
    ],
    context: { teachingProjectId: 'p1', villageId: 'mibu', villageRole: 'practice' },
    actor: { userId: 'u1', groupId: 'g1', isStaff: false }
  });
  assert.deepEqual(visible.map((space) => space.id), ['a', 'b']);
});

test('已有学生数据时不能替换正式村庄', () => {
  assert.equal(canBindFormalVillage({
    project: { formalVillageId: 'v1', formalProjectOpen: true },
    village: { id: 'v2', status: 'published' },
    hasStudentData: true
  }).code, 'FORMAL_VILLAGE_LOCKED');
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node --test features/villages/village-model.test.js`  
Expected: FAIL，原因是 `village-model.js` 尚不存在。

- [x] **Step 3: 实现纯函数模型**

```js
const SPACE_TYPES = Object.freeze({
  PRACTICE_PERSONAL: 'practice_personal',
  PRACTICE_SHARED: 'practice_shared',
  FORMAL_PERSONAL: 'formal_personal',
  FORMAL_SHARED: 'formal_shared',
  GROUP_PLAN: 'group_plan'
});

function buildContextKey({ teachingProjectId, villageId, spaceId = '' }) {
  return [teachingProjectId, villageId, spaceId].map((value) => String(value || '').trim()).join('::');
}
```

实现正式条目优先、未开放正式项目不可进入、练习村庄排除 `group_plan`、个人/小组权限过滤和正式村庄绑定状态码。

- [x] **Step 4: 运行领域测试**

Run: `node --test features/villages/village-model.test.js`  
Expected: PASS。

- [x] **Step 5: 无提交检查点**

Run: `git diff --check -- features/villages/village-model.js features/villages/village-model.test.js`  
Expected: 无输出；保留未提交改动供用户审阅。

---

### Task 2: 建立Supabase规范表、RPC与RLS

**Files:**
- Create: `supabase_SQL/Multi-Village Dual-Track Foundation.sql`
- Create: `features/data/multi-village-security.test.js`

**Interfaces:**
- Produces tables: `villages`, `village_datasets`, `teaching_projects`, `village_reality_models`。
- Produces RPCs: `create_village_draft`, `publish_village_dataset`, `bind_formal_village`, `ensure_context_space`, `publish_village_reality_model`, `get_active_project_context`。
- Extends: `planning_spaces`, `planning_features`, `object_photos`, `community_tasks`, `object_comments`, `object_attribute_edits`, `feature_change_batches`, `feature_versions`, `feature_snapshots`, `activity_events` with context columns and indexes。

- [x] **Step 1: 写入SQL安全契约测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase_SQL/Multi-Village Dual-Track Foundation.sql', 'utf8');

test('规范表和上下文列完整', () => {
  for (const table of ['villages', 'village_datasets', 'teaching_projects', 'village_reality_models']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  }
  for (const column of ['teaching_project_id', 'village_id', 'space_id']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, 'i'));
  }
});

test('正式村庄绑定由数据库强制唯一和锁定', () => {
  assert.match(sql, /FORMAL_VILLAGE_LOCKED/);
  assert.match(sql, /bind_formal_village/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /profiles[\s\S]*role[\s\S]*(admin|teacher)/i);
});

test('学生不能把个人空间写入共享空间', () => {
  assert.match(sql, /PERSONAL_SPACE_CONTEXT_MISMATCH/);
  assert.match(sql, /SHARED_SPACE_RPC_REQUIRED/);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test features/data/multi-village-security.test.js`  
Expected: FAIL，迁移脚本尚不存在。

- [x] **Step 3: 写入可重复执行迁移**

迁移必须：

```sql
create table if not exists public.villages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  is_practice boolean not null default false,
  boundary geometry(MultiPolygon, 4326) not null,
  default_crs text not null default 'EPSG:4326',
  status text not null check (status in ('draft','data_preparing','data_ready','published','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

为所有新增表启用RLS；读取策略只允许活动项目成员及教师/管理员；创建、发布、绑定和实景配置RPC在函数内部重新检查 `profiles.role`。发布V0和正式村庄绑定使用事务锁与状态检查。空间唯一索引使用项目、村庄、类型以及规范化后的owner/group组合，防止重复创建。

- [x] **Step 4: 运行SQL契约测试**

Run: `node --test features/data/multi-village-security.test.js`  
Expected: PASS。

- [x] **Step 5: 在本地静态检查迁移**

Run: `rg -n "security definer|set search_path|enable row level security|FORMAL_VILLAGE_LOCKED|PERSONAL_SPACE_CONTEXT_MISMATCH" "supabase_SQL/Multi-Village Dual-Track Foundation.sql"`  
Expected: 每个特权RPC均设置固定 `search_path` 并包含角色或归属校验。

- [x] **Step 6: 无提交检查点**

Run: `git diff --check -- "supabase_SQL/Multi-Village Dual-Track Foundation.sql" features/data/multi-village-security.test.js`  
Expected: 无输出。

---

### Task 3: 实现村庄客户端与活动上下文加载

**Files:**
- Create: `features/villages/village-client.js`
- Create: `features/villages/village-client.test.js`
- Modify: `index.html`
- Modify: `admin.html`

**Interfaces:**
- Consumes RPCs from Task 2。
- Produces: `createVillageClient({ supabaseClient })` with `getActiveContext()`, `listVillages()`, `listSpaces(context)`, `ensurePersonalSpace(context)`, `createDraft(input)`, `publishDataset(input)`, `bindFormalVillage(input)`, `saveRealityDraft(input)`, `publishRealityModel(input)`。

- [x] **Step 1: 写入客户端契约测试**

```js
test('ensurePersonalSpace携带项目和村庄且不接受缺失上下文', async () => {
  const calls = [];
  const client = createVillageClient({
    supabaseClient: { rpc: async (name, args) => (calls.push([name, args]), { data: { id: 's1' }, error: null }) }
  });
  await assert.rejects(() => client.ensurePersonalSpace({ villageId: 'v1' }), /PROJECT_REQUIRED/);
  await client.ensurePersonalSpace({ teachingProjectId: 'p1', villageId: 'v1', villageRole: 'formal' });
  assert.deepEqual(calls[0], ['ensure_context_space', {
    p_teaching_project_id: 'p1', p_village_id: 'v1', p_space_type: 'formal_personal'
  }]);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test features/villages/village-client.test.js`  
Expected: FAIL，客户端尚不存在。

- [x] **Step 3: 实现统一错误处理和RPC封装**

客户端将Supabase错误转换为稳定错误码，不在UI层拼接表查询。`getActiveContext()`返回：

```js
{
  project: { id, name, practiceVillageId, formalVillageId, formalProjectOpen, stage },
  villages: [{ id, name, isPractice, boundary, status, publishedDatasetId, realityModel }],
  actor: { userId, groupId, isStaff },
  spaces: [{ id, teachingProjectId, villageId, spaceType, ownerId, groupId, readonly }]
}
```

- [x] **Step 4: 注册脚本依赖顺序**

在 `index.html` 和 `admin.html` 中先加载 `village-model.js`、再加载 `village-client.js`，最后加载各自UI模块。保持 `app.js` 和 `admin.js` 为最后的入口协调器。

- [x] **Step 5: 运行客户端及脚本顺序测试**

Run: `node --test features/villages/village-client.test.js features/auth/supabase-auth-integration.test.js`  
Expected: PASS。

- [x] **Step 6: 无提交检查点**

Run: `git diff --check -- index.html admin.html features/villages/village-client.js features/villages/village-client.test.js`  
Expected: 无输出。

---

### Task 4: 实现村庄边界绘制与上传归一化

**Files:**
- Create: `features/villages/village-boundary.js`
- Create: `features/villages/village-boundary.test.js`
- Create: `server/src/village_processing/boundary.py`
- Create: `server/tests/test_boundary.py`
- Modify: `server/environment/platform_geo_worker.yml`

**Interfaces:**
- Produces browser functions: `normalizeGeoJsonBoundary(value)`, `summarizeBoundary(geometry)`, `createBoundaryController({ map, ol, uploadShapefile })`。
- Produces Python functions: `extract_boundary_archive(zip_path, work_dir)`, `normalize_boundary_file(path, default_crs='EPSG:4326') -> dict`, `validate_archive_members(names)`。
- Shapefile ZIP先上传到受控临时存储，由地理处理Worker转换为EPSG:4326 GeoJSON；浏览器绘制和GeoJSON上传直接调用同一几何校验规则。

- [x] **Step 1: 写入浏览器边界测试**

```js
test('多面GeoJSON归一化为MultiPolygon并返回范围', () => {
  const result = normalizeGeoJsonBoundary({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[113,23],[114,23],[114,24],[113,23]]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[114,23],[115,23],[115,24],[114,23]]] } }
    ]
  });
  assert.equal(result.geometry.type, 'MultiPolygon');
  assert.deepEqual(result.bounds, [113, 23, 115, 24]);
});
```

- [x] **Step 2: 写入Python ZIP与投影测试**

```python
def test_archive_rejects_path_escape():
    with pytest.raises(ValueError, match="BOUNDARY_ARCHIVE_PATH_ESCAPE"):
        validate_archive_members(["../outside.shp", "village.dbf"])

def test_geojson_boundary_is_reprojected_to_4326(tmp_path):
    source = tmp_path / "boundary.geojson"
    gpd.GeoDataFrame(geometry=[box(12600000, 2600000, 12601000, 2601000)], crs="EPSG:3857").to_file(source, driver="GeoJSON")
    result = normalize_boundary_file(source)
    assert result["type"] == "MultiPolygon"
    assert -180 <= result["coordinates"][0][0][0][0] <= 180
```

- [x] **Step 3: 运行两组测试确认失败**

Run: `node --test features/villages/village-boundary.test.js`  
Expected: FAIL。  
Run: `conda run -n platform_geo_worker python -m pytest server/tests/test_boundary.py -q`  
Expected: FAIL。

- [x] **Step 4: 实现边界校验**

浏览器端拒绝空几何、非Polygon/MultiPolygon、经纬度越界和少于四个环坐标；Python端拒绝绝对路径、`..`、符号链接、超过100个成员、解压后超过50MB、缺失 `.shp/.shx/.dbf`，并通过 `.prj` 或默认CRS归一化到EPSG:4326。

- [x] **Step 5: 运行边界测试**

Run: `node --test features/villages/village-boundary.test.js`  
Expected: PASS。  
Run: `conda run -n platform_geo_worker python -m pytest server/tests/test_boundary.py -q`  
Expected: PASS。

- [x] **Step 6: 无提交检查点**

Run: `git diff --check -- features/villages/village-boundary.js features/villages/village-boundary.test.js server/src/village_processing/boundary.py server/tests/test_boundary.py server/environment/platform_geo_worker.yml`  
Expected: 无输出。

---

### Task 5: 让地理处理Worker消费动态村庄数据清单

**Files:**
- Create: `server/src/village_processing/remote_catalog.py`
- Create: `server/tests/test_remote_catalog.py`
- Modify: `server/src/village_processing/contracts.py`
- Modify: `server/src/village_processing/catalog.py`
- Modify: `server/src/village_processing/pipeline.py`
- Modify: `server/config/villages.yaml`
- Modify: `supabase_SQL/Geoprocessing Worker Queue.sql`
- Modify: `features/geoprocessing/geoprocessing-client.js`
- Modify: `features/geoprocessing/geoprocessing-client.test.js`

**Interfaces:**
- Extends `ProcessingRequest` with `dataset_id: str | None` and `input_manifest: dict | None`。
- Produces `RemoteDatasetResolver.resolve(request, work_root) -> VillageDataset`。
- Keeps `DatasetCatalog.resolve('mibu')` as an offline compatibility fallback only。

- [ ] **Step 1: 写入远程清单失败测试**

```python
def test_remote_manifest_rejects_unlisted_host(tmp_path):
    resolver = RemoteDatasetResolver(
        download=lambda url, target: None,
        allowed_hosts={"rzmbmwauomzwiyenafha.supabase.co"},
    )
    request = make_request(input_manifest={"imagery_url": "https://example.com/a.tif"})
    with pytest.raises(ValueError, match="DATASET_URL_NOT_ALLOWED"):
        resolver.resolve(request, tmp_path)

def test_mibu_without_dataset_id_uses_local_catalog(local_catalog, request):
    assert resolve_dataset(request.replace(village_id="mibu", dataset_id=None), local_catalog, None).village_id == "mibu"
```

- [ ] **Step 2: 运行Worker测试确认失败**

Run: `conda run -n platform_geo_worker python -m pytest server/tests/test_remote_catalog.py server/tests/test_catalog.py server/tests/test_contracts.py -q`  
Expected: FAIL，新接口尚不存在。

- [ ] **Step 3: 扩展队列契约和客户端**

`submit_geoprocessing_run` 接收 `p_dataset_id`；数据库仅从已授权数据版本生成短时签名清单，浏览器不能提交任意URL。Worker领取任务时获得清单、预期SHA-256和允许的文件大小。

```js
await client.submit({
  teachingProjectId: 'p1',
  villageId: 'v1',
  datasetId: 'dataset-draft-1',
  aoi,
  requestedSteps,
  parameters
});
```

- [ ] **Step 4: 实现安全下载与本地回退**

远程解析器只接受Supabase项目存储域名和HTTPS签名URL，限制单文件2GB，流式下载，校验SHA-256，并把文件写入当前run的独立目录。米埗村旧任务没有 `dataset_id` 时继续读取 `server/config/villages.yaml`。

- [ ] **Step 5: 运行Worker、契约和客户端测试**

Run: `conda run -n platform_geo_worker python -m pytest server/tests/test_remote_catalog.py server/tests/test_catalog.py server/tests/test_contracts.py server/tests/test_pipeline.py -q`  
Expected: PASS。  
Run: `node --test features/geoprocessing/geoprocessing-client.test.js`  
Expected: PASS。

- [ ] **Step 6: 无提交检查点**

Run: `git diff --check -- server features/geoprocessing/geoprocessing-client.js features/geoprocessing/geoprocessing-client.test.js "supabase_SQL/Geoprocessing Worker Queue.sql"`  
Expected: 无输出。

---

### Task 6: 实现管理员“村庄与项目”工作流

**Files:**
- Create: `features/admin/village-admin.js`
- Create: `features/admin/village-admin.test.js`
- Modify: `admin.html`
- Modify: `admin.js`
- Modify: `features/admin/course-admin.js`

**Interfaces:**
- Consumes `createVillageClient`, `createBoundaryController` and geoprocessing client。
- Produces `createVillageAdminController({ root, client, boundary, geoprocessing, notify, confirm })` with `mount()`, `refresh()`, `destroy()`。

- [ ] **Step 1: 写入管理员状态机测试**

```js
test('没有建筑成果时不能发布V0', async () => {
  const calls = [];
  const controller = createVillageAdminController(makeDeps({
    dataset: { id: 'd1', status: 'ready', layers: [{ type: 'roads', featureCount: 3 }] },
    calls
  }));
  await assert.rejects(() => controller.publishDataset('d1'), /BUILDINGS_REQUIRED/);
  assert.equal(calls.some((call) => call.name === 'publishDataset'), false);
});

test('正式村庄绑定前必须已发布V0', async () => {
  const controller = createVillageAdminController(makeDeps({ village: { id: 'v1', status: 'draft' } }));
  await assert.rejects(() => controller.bindFormalVillage('v1'), /PUBLISHED_DATASET_REQUIRED/);
});

test('创建向导只提交最小字段并从米埗村继承默认坐标系', async () => {
  const input = buildVillageDraftInput({
    name: '新村庄', isPractice: false, boundary, mibuDefaultCrs: 'EPSG:4326'
  });
  assert.deepEqual(Object.keys(input).sort(), ['boundary', 'defaultCrs', 'isPractice', 'name']);
  assert.equal(input.defaultCrs, 'EPSG:4326');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/admin/village-admin.test.js`  
Expected: FAIL。

- [ ] **Step 3: 在后台增加挂载结构**

增加 `data-admin-tab="villages"`，内容包含当前教学项目卡、村庄列表、新建村庄向导、边界预览、数据准备选择、处理进度、V0预览和实景资源表单。创建向导默认只显示村庄名称、是否为练习村庄和范围输入；坐标系从米埗村配置继承，只在“高级选项”中显示。编码、简介、行政区不进入第一阶段。所有动态逻辑位于 `village-admin.js`；`admin.js`只负责认证后初始化和标签切换。

- [ ] **Step 4: 实现创建、准备、发布和绑定状态机**

数据准备提供两个入口：“在平台中处理”复用学生地理处理面板与Worker；“上传已处理成果”接收管理员本地完成的标准化影像和矢量清单。两条路径都必须经过相同的资源校验、V0预览和发布RPC，不生成两套运行时格式，也不读取或汇总学生个人体验结果。管理员可直接发布校验通过的成果，不把人工要素修正设为前置条件。

允许状态转换：

```text
draft -> data_preparing -> data_ready -> published -> archived
```

非法跨级操作返回稳定错误；网络失败后重新读取服务端状态，不依赖按钮本地状态判断成功。

- [ ] **Step 5: 实现实景Asset ID预览与发布**

输入只接受正整数Asset ID；预览使用独立实景控制器，保存草稿不影响学生，发布成功后刷新村庄资源版本。高度偏移限制在 `-1000..1000` 米。

- [ ] **Step 6: 运行管理员测试与语法检查**

Run: `node --test features/admin/village-admin.test.js features/admin/course-admin.test.js`  
Expected: PASS。  
Run: `node --check features/admin/village-admin.js`  
Expected: 无输出。

- [ ] **Step 7: 无提交检查点**

Run: `git diff --check -- admin.html admin.js features/admin/village-admin.js features/admin/village-admin.test.js features/admin/course-admin.js`  
Expected: 无输出。

---

### Task 7: 创建当届米埗村实例并迁移旧数据

**Files:**
- Modify: `supabase_SQL/Multi-Village Dual-Track Foundation.sql`
- Create: `features/data/multi-village-migration.test.js`
- Modify: `features/course/course-model.js`
- Modify: `features/course/course-service.js`
- Modify: `features/course/course-service.test.js`
- Modify: `features/course/course-workspace-adapter.js`
- Modify: `features/course/course-workspace-adapter.test.js`
- Modify: `features/data/personal-space-client.js`
- Modify: `features/data/personal-space-client.test.js`

**Interfaces:**
- Produces one seeded active teaching project and one registered Mibu village/dataset。
- Course context obtains `teachingProjectId`; workspace builders require `villageId` and explicit `spaceType`。

- [ ] **Step 1: 写入迁移幂等测试**

```js
test('迁移脚本固定创建一个米埗村和一个活动项目且使用冲突保护', () => {
  assert.match(sql, /米埗村/);
  assert.match(sql, /is_practice[\s\S]*true/i);
  assert.match(sql, /on conflict/i);
  assert.match(sql, /practice_shared/i);
  assert.doesNotMatch(sql, /mibu[\s\S]*group_plan/i);
});

test('每个新教学项目都会创建自己的米埗村共享现状空间', () => {
  assert.match(sql, /ensure_project_practice_space/i);
  assert.match(sql, /teaching_project_id[\s\S]*practice_shared/i);
});
```

- [ ] **Step 2: 运行迁移和课程测试确认失败**

Run: `node --test features/data/multi-village-migration.test.js features/course/course-service.test.js features/course/course-workspace-adapter.test.js features/data/personal-space-client.test.js`  
Expected: FAIL，新上下文尚未接入。

- [ ] **Step 3: 实现米埗村与旧空间迁移**

脚本使用稳定的米埗村UUID或唯一slug迁移一次；将当前全局现状归属为活动项目的 `practice_shared`，现有个人图底空间归属为 `practice_personal`。新增 `ensure_project_practice_space(project_id)`，在每个教学项目创建/启用时从米埗村基准版本生成该项目独立的 `practice_shared`，不得复用上一学期的共享空间。使用更新前后计数断言和 `where ... is null` 限制，防止重复覆盖已经迁移的数据。

- [ ] **Step 4: 调整课程与个人空间接口**

课程服务的本地缓存键改为 `courseId:teachingProjectId`。`buildPersonalPlanningSpace`接收 `spaceType`，米埗村生成 `practice_personal`，正式村庄生成 `formal_personal`。小组空间构建器拒绝练习村庄。

- [ ] **Step 5: 运行迁移与课程测试**

Run: `node --test features/data/multi-village-migration.test.js features/course/course-service.test.js features/course/course-workspace-adapter.test.js features/data/personal-space-client.test.js`  
Expected: PASS。

- [ ] **Step 6: 无提交检查点**

Run: `git diff --check -- "supabase_SQL/Multi-Village Dual-Track Foundation.sql" features/course features/data/personal-space-client.js features/data/personal-space-client.test.js features/data/multi-village-migration.test.js`  
Expected: 无输出。

---

### Task 8: 实现学生项目切换器与原子切换事务

**Files:**
- Create: `features/villages/project-switcher.js`
- Create: `features/villages/project-switcher.test.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/space-panel-events.js`
- Modify: `features/ui/workspace-context-behavior.test.js`
- Modify: `features/ui/workspace-space-management.test.js`

**Interfaces:**
- Consumes Task 1 model and Task 3 client。
- Produces `createProjectSwitcher({ mount, loadTarget, unloadTarget, hasUnsavedChanges, resolveUnsaved, commitContext, rollbackContext })` with `mount(context)`, `switchTo(entry)`, `refresh()`。
- `app.js` exposes `window.__activeVillageContext` only as a compatibility bridge; new modules receive context explicitly。

- [ ] **Step 1: 写入切换失败回滚测试**

```js
test('目标村庄加载失败时保持原上下文', async () => {
  let active = { teachingProjectId: 'p1', villageId: 'mibu', spaceId: 's1' };
  const switcher = createProjectSwitcher({
    hasUnsavedChanges: () => false,
    loadTarget: async () => { throw new Error('LOAD_FAILED'); },
    commitContext: (next) => { active = next; },
    rollbackContext: () => {},
    getContext: () => active
  });
  await assert.rejects(() => switcher.switchTo({ teachingProjectId: 'p1', villageId: 'v2' }), /LOAD_FAILED/);
  assert.equal(active.villageId, 'mibu');
});

test('未保存编辑会阻止项目切换', async () => {
  const switcher = createProjectSwitcher({
    hasUnsavedChanges: () => true,
    resolveUnsaved: async () => 'cancel'
  });
  assert.equal(await switcher.switchTo({ villageId: 'v2' }), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/villages/project-switcher.test.js`  
Expected: FAIL。

- [ ] **Step 3: 实现项目切换器UI**

顶部空间选择器左侧增加项目选择器。正式项目、练习项目分组显示；正式项目未开放时禁用。项目标签与空间可见性由模型纯函数生成，不在HTML中写死米埗村。

- [ ] **Step 4: 实现两阶段切换**

`prepare`阶段加载边界、数据清单和空间列表但不改变全局上下文；全部成功后进入`commit`，卸载旧资源并应用新上下文。失败调用`rollback`并显示错误。切换成功后按账号和上下文保存最后空间与视图。

- [ ] **Step 5: 接入空间过滤**

米埗村只显示 `practice_personal/practice_shared`。正式村庄显示 `formal_personal/formal_shared`，只有冻结基线存在且actor属于对应小组时显示 `group_plan`。

- [ ] **Step 6: 运行切换和工作区测试**

Run: `node --test features/villages/project-switcher.test.js features/ui/workspace-context-behavior.test.js features/ui/workspace-space-management.test.js features/ui/workspace-shell-regression.test.js`  
Expected: PASS。

- [ ] **Step 7: 无提交检查点**

Run: `git diff --check -- index.html style.css app.js features/villages/project-switcher.js features/villages/project-switcher.test.js features/ui`  
Expected: 无输出。

---

### Task 9: 让二维地图、协作数据和图底预览按村庄动态加载

**Files:**
- Create: `features/data/village-dataset-resolver.js`
- Create: `features/data/village-dataset-resolver.test.js`
- Modify: `app.js`
- Modify: `features/data/data-service.js`
- Modify: `features/data/feature-db.js`
- Modify: `features/data/feature-edit-session.js`
- Modify: `features/geoprocessing/village-preview.js`
- Modify: `features/geoprocessing/village-preview.test.js`
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/object-collaboration/object-comments.js`
- Modify: `features/course/activity-logger.js`

**Interfaces:**
- Produces `resolveDatasetResources({ village, dataset, signedUrls }) -> { boundary, initialExtent, imagery, layers, realityModel }`。
- All write APIs consume `context: { teachingProjectId, villageId, spaceId }`。

- [x] **Step 1: 写入清单解析与隔离测试**

```js
test('资源解析器拒绝未知图层和任意外域URL', () => {
  assert.throws(() => resolveDatasetResources({
    village: { boundary: polygon },
    dataset: { layerManifest: [{ type: 'script', url: 'https://evil.example/a.js' }] },
    signedUrls: {}
  }), /UNSUPPORTED_LAYER_TYPE/);
});

test('写入上下文缺失村庄时失败', async () => {
  await assert.rejects(() => featureDb.upsert({
    context: { teachingProjectId: 'p1', spaceId: 's1' },
    layerKey: 'building', objectCode: 'B1'
  }), /VILLAGE_CONTEXT_REQUIRED/);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test features/data/village-dataset-resolver.test.js features/geoprocessing/village-preview.test.js`  
Expected: FAIL。

- [x] **Step 3: 实现受控资源解析**

只接受 `building/road/water/contours/elevationBands/imagery`；资源URL必须来自服务端签名结果。米埗村静态路径由迁移后的V0清单返回，不在解析器内另写一套业务分支。

- [x] **Step 4: 改造2D加载和初始视角**

`app.js`使用当前村庄边界设置OpenLayers初始extent和重置视角；图层加载从活动数据清单获取URL。项目切换时清空按 `contextKey` 分区的缓存，不清除其他项目缓存。

- [x] **Step 5: 为所有协作写入增加上下文**

照片、问题、留言、对象讨论、要素保存、编辑锁、版本批次和活动日志均显式传递context；旧函数若缺少context立即报错，不允许静默回退到米埗村。

- [x] **Step 6: 运行二维与协作回归**

Run: `node --test features/data/village-dataset-resolver.test.js features/data/feature-edit-session.test.js features/geoprocessing/village-preview.test.js features/object-collaboration/object-comments.test.js features/course/activity-logger.test.js features/ui/2d-cold-start.test.js`  
Expected: PASS。

- [x] **Step 7: 无提交检查点**

Run: `git diff --check -- app.js features/data features/geoprocessing features/object-collaboration features/course/activity-logger.js`  
Expected: 无输出。

---

### Task 10: 让主三维白模按当前村庄动态生成

**Files:**
- Create: `features/3d/village-3d-config.js`
- Create: `features/3d/village-3d-config.test.js`
- Modify: `app-3d.js`
- Modify: `features/3d/3d-runtime-integration.test.js`
- Modify: `features/data/effective-building-features.js`
- Modify: `features/data/effective-building-features.test.js`

**Interfaces:**
- Produces `resolveBuildingHeight(props, fallback=9)`, `resolveVillageCamera(boundary, options)`, `buildMain3dResources(datasetResources)`。
- Consumes Task 9 resource object and current space effective building collection。

- [ ] **Step 1: 写入高度和相机测试**

```js
test('白模高度优先高度字段、其次层数、最后9米', () => {
  assert.equal(resolveBuildingHeight({ 建筑高度: 12, 层数: 2 }), 12);
  assert.equal(resolveBuildingHeight({ 层数: 2 }), 6);
  assert.equal(resolveBuildingHeight({}), 9);
});

test('相机中心来自当前村庄边界而非米埗村常量', () => {
  const camera = resolveVillageCamera({ type: 'Polygon', coordinates: [[[110,20],[112,20],[112,22],[110,20]]] });
  assert.equal(camera.centerLongitude, 111);
  assert.equal(camera.centerLatitude, 21);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/3d/village-3d-config.test.js features/3d/3d-runtime-integration.test.js`  
Expected: FAIL。

- [ ] **Step 3: 提取现有9米规则为纯函数**

保持字段顺序与现有 `HEIGHT_FIELDS` 一致，层数字段乘以3，非法或小于1米的值回退到9米。`app-3d.js`不再复制高度解析逻辑。

- [ ] **Step 4: 动态加载建筑、道路、影像和相机**

移除业务运行时对 `data/buildings.geojson`、`data/roads.geojson`、米埗村固定影像范围和固定overview range的依赖；从当前资源对象读取。切换村庄时递增加载token，旧异步请求返回后不得覆盖新场景。

- [ ] **Step 5: 保持空间有效建筑语义**

共享现状白模读取V0加共享覆盖；个人体验空间读取个人版本；小组空间读取冻结基线加组内规划覆盖。单栋GLB绑定继续按当前space ID读取。

- [ ] **Step 6: 运行三维测试和语法检查**

Run: `node --test features/3d/village-3d-config.test.js features/3d/3d-runtime-integration.test.js features/data/effective-building-features.test.js`  
Expected: PASS。  
Run: `node --check app-3d.js`  
Expected: 无输出。

- [ ] **Step 7: 无提交检查点**

Run: `git diff --check -- app-3d.js features/3d features/data/effective-building-features.js features/data/effective-building-features.test.js`  
Expected: 无输出。

---

### Task 11: 让独立实景Viewer按村庄动态配置并支持中期发布

**Files:**
- Modify: `features/3d/village-3d-config.js`
- Modify: `features/3d/village-3d-config.test.js`
- Modify: `features/3d/reality-inset.js`
- Modify: `features/3d/reality-inset.test.js`
- Modify: `app-3d.js`
- Modify: `index.html`

**Interfaces:**
- Produces `normalizeRealityConfig(resource) -> { enabled, ionAssetId, title, terrainEnabled, heightOffset, revision }`。
- Extends reality controller with `getConfig()` and keeps `destroy()` idempotent。
- `app-3d.js` provides `rebuildRealityInsetForVillage(context)`。

- [ ] **Step 1: 写入动态实景测试**

```js
test('无实景资源时禁用入口但不影响主场景', () => {
  assert.deepEqual(normalizeRealityConfig(null), {
    enabled: false, ionAssetId: 0, title: '', terrainEnabled: true, heightOffset: 0, revision: ''
  });
});

test('项目切换会销毁旧控制器并使用新Asset ID', async () => {
  const events = [];
  await rebuildHarness.switchVillage({ id: 'v2', realityModel: { ionAssetId: 7654321, revision: 'r1' } }, events);
  assert.deepEqual(events, ['destroy:5133927', 'create:7654321']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/3d/village-3d-config.test.js features/3d/reality-inset.test.js`  
Expected: FAIL。

- [ ] **Step 3: 移除固定米埗村业务配置**

`index.html`不再定义固定 `window.VILLAGE_REALITY_MODEL`；米埗村Asset ID `5133927`由迁移后的村庄资源记录返回。`reality-inset.js`的加载文案使用配置标题，不保留米埗村默认业务语义。

- [ ] **Step 4: 实现按revision重建**

进入3D或收到实景资源Realtime更新时，比较 `villageId + revision`。未变化时复用控制器；变化时先销毁旧Viewer、清理代理和事件，再创建新Viewer。Asset加载失败时显示实景错误并保持主Viewer可操作。

- [ ] **Step 5: 运行实景及3D集成测试**

Run: `node --test features/3d/village-3d-config.test.js features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js`  
Expected: PASS。

- [ ] **Step 6: 无提交检查点**

Run: `git diff --check -- index.html app-3d.js features/3d`  
Expected: 无输出。

---

### Task 12: 完成端到端数据隔离与发布流程验证

**Files:**
- Create: `features/integration/multi-village-flow.test.js`
- Modify: `features/ui/workspace-shell-regression.test.js`
- Modify: `features/auth/supabase-auth-integration.test.js`
- Modify: `docs/PLATFORM_ITERATION_LOG.md`

**Interfaces:**
- Consumes all prior tasks。
- Produces no new runtime API；提供端到端验收证据和运维说明。

- [ ] **Step 1: 写入完整流程集成测试**

```js
test('管理员发布正式村庄后学生获得隔离的正式上下文', async () => {
  const env = createMultiVillageHarness();
  await env.admin.createVillage({ name: '2026-1村庄', isPractice: false, boundary });
  await env.admin.publishDataset({ villageId: 'formal-1', buildings: buildingCollection });
  await env.admin.bindFormalVillage({ projectId: 'p1', villageId: 'formal-1' });
  const student = await env.asStudent('u1', 'g1');
  assert.deepEqual(student.projectEntries.map((item) => item.villageId), ['formal-1', 'mibu']);
  await student.editPersonalBuilding('formal-1', 'B1', { 建筑高度: 15 });
  assert.equal(await student.readSharedBuilding('formal-1', 'B1', '建筑高度'), 9);
  await student.editSharedBuilding('formal-1', 'B1', { 建筑高度: 12 });
  assert.equal(await student.readSharedBuilding('formal-1', 'B1', '建筑高度'), 12);
  assert.equal(await student.readSharedBuilding('mibu', 'B1', '建筑高度'), 9);
});
```

- [ ] **Step 2: 运行集成测试确认初始结果**

Run: `node --test features/integration/multi-village-flow.test.js`  
Expected: PASS；如果失败，只修复失败所揭示的跨模块契约，不新增范围外功能。

- [ ] **Step 3: 运行全部前端测试**

Run: `Get-ChildItem features -Recurse -Filter *.test.js | ForEach-Object { node --test $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`  
Expected: 所有测试文件PASS。

- [ ] **Step 4: 运行地理处理Worker测试**

Run: `conda run -n platform_geo_worker python -m pytest server/tests -q`  
Expected: PASS。

- [ ] **Step 5: 运行首页测试和构建**

Run: `npm test --prefix homepage`  
Expected: PASS。  
Run: `npm run build --prefix homepage`  
Expected: PASS；若仍出现仓库已知的 `kimi-plugin-inspect-react`/decorators依赖阻断，记录完整错误并确认与本功能无关，不擅自修改依赖范围。

- [ ] **Step 6: 运行语法与差异检查**

Run: `node --check app.js`  
Run: `node --check app-3d.js`  
Run: `node --check admin.js`  
Run: `git diff --check`  
Expected: JavaScript检查和差异检查均无错误。

- [ ] **Step 7: 人工浏览器验收**

使用本地服务依次验证：

1. 首页登录、注册、退出和进入平台。
2. 管理员新建村庄、绘制/上传边界、生成或上传数据、预览白模、发布V0并绑定。
3. 新建另一个教学项目后，系统自动生成新的米埗村共享现状实例，且不继承上一项目的学生修改。
4. 学生在米埗村和正式村庄之间切换，未保存编辑能阻止切换。
5. 米埗村只显示个人体验和当届共享现状。
6. 正式村庄显示个人体验和共享现状，冻结前不显示小组方案。
7. 个人空间修改不影响共享现状；正式村庄数据不出现在米埗村。
8. 正式村庄2D建筑在主3D场景中按高度/层数/9米规则生成白模。
9. 无实景资源时主3D正常；发布Asset ID后独立实景窗口出现且不干涉白模。
10. 2D/3D视图切换、对象选择、照片、问题、讨论、版本管理和建筑GLB替换继续工作。

- [ ] **Step 8: 更新迭代日志**

在 `docs/PLATFORM_ITERATION_LOG.md` 新增一条，明确实际完成范围、数据库迁移是否已远程执行、测试数量、浏览器验收结果及仍未执行的部署事项。不得把仅有代码但未部署的远程能力写成已上线。

- [ ] **Step 9: 最终无提交检查点**

Run: `git status --short`  
Expected: 仅显示本计划范围内改动和用户原有改动；不执行提交。向用户报告文件、数据库部署状态、测试证据、已知限制和建议的下一步。
