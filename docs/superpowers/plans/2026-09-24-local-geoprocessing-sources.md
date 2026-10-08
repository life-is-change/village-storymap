# 4090 本地源数据个人底图生产 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生任务始终使用 4090 本地村庄遥感与共用 DEM/OSM，缺源数据时提交前明确拒绝，成果仍经 Supabase 回到个人空间，且不改变管理员共享底图上传。

**Architecture:** 4090 的村庄源数据目录是输入的唯一权威；Worker 定期向 Supabase 发布不含路径的就绪状态。带教学项目上下文的提交 RPC 验证项目资格、状态和 AOI，只把处理参数入队；Worker 绝不因历史 `dataset_id` 下载共享数据集。前端使用同一状态与面积上限呈现即时反馈。

**Tech Stack:** Python 3.10–3.11、pytest、PyYAML、Supabase/PostgreSQL/PostGIS、原生 JavaScript、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-09-24-local-geoprocessing-sources-design.md`

## Global Constraints

- 管理员上传数据包只用于共享现状空间；学生原始输入只来自 `PLATFORM_DATA_ROOT`。
- 新任务的 `dataset_id` 和 `input_manifest` 必须为空；历史记录字段保留，Worker 也不得按其选择远程输入。
- 本地绝对路径、服务密钥和原始影像不能发给浏览器或写入公开状态表。
- 米埗村可处理；红星村缺影像时应即时拒绝，但不能阻断米埗村 Worker 启动。
- 数据库迁移、4090 配置和前端须协调发布；未拿到真实服务访问前不得声称完成线上闭环。

## Review Focus

1. 配置里有红星村但缺遥感文件：米埗村仍可领取任务，红星村显示缺影像。
2. 旧任务含 `dataset_id` / `input_manifest`：Worker 依然只访问本地源数据，不签名或下载旧清单。
3. 就绪状态超时、Worker 离线、文件在排队后消失：提交被拒或任务以明确代码失败，不静默排队。
4. 非项目成员或与课程不匹配的村庄：不能通过 RPC 绕过校验，已发布的实践村应被正确接受。
5. 浏览器显示可绘制但 AOI 超任务上限或影像覆盖：前后端给出一致的上限/边界错误，不能以缩放地图绕过。

---

## File structure

- `server/src/village_processing/catalog.py`：解析本地目录、村庄 ID 别名与单村就绪状态。
- `server/src/village_processing/source_status.py`：把本地检查结果转换成不含路径的状态记录。
- `server/src/village_processing/pipeline.py`：根据村庄 ID 选择本地输入，并记录阶段耗时。
- `server/src/village_processing/queue/gateway.py`、`worker.py`、`__main__.py`：状态发布、领取任务和生命周期接线。
- `supabase_SQL/Geoprocessing Local Source Inputs.sql`：单独可审阅的前向迁移；不重写历史迁移文件。
- `features/geoprocessing/geoprocessing-context.js`、`geoprocessing-client.js`、`geoprocessing-panel.js`、`geoprocessing-aoi.js`、`app.js`：统一村庄标识、状态/面积、提交与提示。
- 相邻 `.test.js`、`server/tests/test_*.py`：单元和契约回归；`server/docs/supabase-worker-operations.md`、`linux/README.md`：发布与验收。

### Task 1: 本地目录支持多村和缺文件隔离

**Files:**
- Modify: `server/src/village_processing/catalog.py`
- Modify: `server/config/villages.yaml`
- Test: `server/tests/test_catalog.py`

**Interfaces:**
- Consumes: `PLATFORM_DATA_ROOT` 与 YAML。
- Produces: `DatasetCatalog.resolve(village_id)`、`DatasetCatalog.status(village_id) -> str`、`DatasetCatalog.village_ids() -> tuple[str, ...]`；状态码为 `ready`、`LOCAL_IMAGERY_MISSING`、`LOCAL_SHARED_SOURCE_MISSING`、`LOCAL_SOURCE_NOT_REGISTERED`。

- [ ] **Step 1: 写失败测试。** 在 `test_catalog.py` 使用 `tmp_path` 创建完整米埗源文件、缺影像的红星条目和共用 DEM/OSM/模型；核心断言：

  ```python
  catalog = load_catalog(manifest, tmp_path)
  assert catalog.resolve(mibu_uuid).imagery.is_file()
  assert catalog.status(hongxing_uuid) == "LOCAL_IMAGERY_MISSING"
  with pytest.raises(FileNotFoundError, match="LOCAL_IMAGERY_MISSING"):
      catalog.resolve(hongxing_uuid)
  ```

  同文件保留路径越界抛 `DATASET_PATH_ESCAPE` 的现有测试。
- [ ] **Step 2: 运行失败测试。** `python -m pytest server/tests/test_catalog.py -q`；预期新 `status`/`village_ids` 测试失败。
- [ ] **Step 3: 最小实现。** YAML 改用 `shared: {dem, osm, model_config, model_checkpoint, osm_snapshot, dem_source}` 与 `villages: {<UUID>: {display_name, imagery, bounds, aliases: [mibu]}}`。解析时先验证结构和路径在根目录内，逐村保存路径；`status()` 用 `Path.is_file()` 和可读检查判定，不在加载时因单村缺文件退出；`resolve()` 仅在就绪时构造原有 `VillageDataset`。保留旧格式兼容过渡，以免 `catalog-check` 和既有脚本立即失效。实际 UUID 必须从数据库/当前代码核对，不凭村名猜测。核心逻辑：

  ```python
  def status(self, village_id: str) -> str:
      item = self._items.get(self._aliases.get(village_id, village_id))
      if item is None:
          return "LOCAL_SOURCE_NOT_REGISTERED"
      if not item.imagery.is_file():
          return "LOCAL_IMAGERY_MISSING"
      if any(not path.is_file() for path in (item.dem, item.osm, item.model_config, item.model_checkpoint)):
          return "LOCAL_SHARED_SOURCE_MISSING"
      return "ready"
  ```

- [ ] **Step 4: 运行通过测试。** `python -m pytest server/tests/test_catalog.py -q`；远程路由断言留待 Task 2 调整。
- [ ] **Step 5: 只提交本任务文件。** `git add server/src/village_processing/catalog.py server/config/villages.yaml server/tests/test_catalog.py` 后提交 `feat: isolate local village source readiness`。

### Task 2: Worker 不再从数据包下载学生任务输入

**Files:**
- Modify: `server/src/village_processing/pipeline.py`
- Modify: `server/src/village_processing/queue/gateway.py`
- Modify: `server/src/village_processing/__main__.py`
- Modify: `server/tests/test_remote_catalog.py`
- Modify: `server/tests/test_supabase_gateway.py`

**Interfaces:**
- Consumes: Task 1 的 `catalog.resolve(village_id)`。
- Produces: `resolve_dataset(request, local_catalog, remote_resolver=None) -> VillageDataset`；任务领取后不签 `input_manifest`。

- [ ] **Step 1: 写失败测试。** 修改旧 `test_formal_village_requires_dataset_id` 为 UUID 村庄有本地配置时即成功；新增旧任务含 `dataset_id`/`input_manifest` 但只解析本地：

  ```python
  class NeverDownload:
      def resolve(self, *_args):
          raise AssertionError("remote input must not be used")

  assert resolve_dataset(request, DatasetCatalog({request.village_id: local_item}), NeverDownload()) is local_item
  ```

  Gateway `claim` 的假 Storage 被调用即失败，确认不再签名清单。
- [ ] **Step 2: 运行失败测试。** `python -m pytest server/tests/test_remote_catalog.py server/tests/test_supabase_gateway.py -q`；预期旧远程分流导致失败。
- [ ] **Step 3: 最小实现。** `SupabaseGateway.claim` 不调用 `_sign_input_manifest`；Worker 启动不构造 `RemoteDatasetResolver`。保留远程模块和历史字段供读取/回滚，但新链路不可调用下载。`run_pipeline` 在输入解析异常时也写入失败 manifest 或让 Worker 记录明确代码，不留下无解释的失败。替换路由为：

  ```python
  def resolve_dataset(request: ProcessingRequest, local_catalog, remote_resolver=None):
      return local_catalog.resolve(request.village_id)
  ```
- [ ] **Step 4: 运行通过测试。** `python -m pytest server/tests/test_remote_catalog.py server/tests/test_supabase_gateway.py server/tests/test_pipeline.py server/tests/test_worker.py -q`；确认全通过且无远程下载调用。
- [ ] **Step 5: 只提交本任务文件。** 提交 `fix: use local source for all personal geoprocessing runs`。

### Task 3: Supabase 就绪状态与安全的提交契约

**Files:**
- Create: `supabase_SQL/Geoprocessing Local Source Inputs.sql`
- Create: `features/data/geoprocessing-local-source-migration.test.js`
- Read only: `supabase_SQL/Geoprocessing Worker Queue.sql`、`supabase_SQL/Geoprocessing Practice Village Catalog Fix.sql`

**Interfaces:**
- Produces: `public.geoprocessing_source_status(village_id, ready, error_code, worker_id, checked_at)`、`public.upsert_geoprocessing_source_status(p_village_id text,p_ready boolean,p_error_code text,p_worker_id text)`（仅 `service_role`）、`public.get_geoprocessing_source_status(p_village_id text)`（authenticated），及现有七参数 `submit_geoprocessing_run(..., p_teaching_project_id uuid, p_dataset_id uuid)` 的新语义：`p_dataset_id` 兼容但不使用。

- [ ] **Step 1: 写失败契约测试。** Node 测试读取新 SQL，断言状态表启用 RLS、写 RPC 仅授予 `service_role`、读取函数对过期状态返回未就绪、提交函数不要求 `DATASET_REQUIRED`/`WORKER_MANIFEST_REQUIRED`、入队 `dataset_id`/`input_manifest` 为 `null`、课程/项目/成员校验存在、五参数绕行入口不再授权 `authenticated`。至少包括：

  ```js
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /revoke all on function public\.submit_geoprocessing_run\(text,text,text\[\],jsonb,jsonb\) from public, anon, authenticated/i);
  assert.match(sql, /dataset_id\s*,\s*input_manifest[\s\S]*?null\s*,\s*null/i);
  assert.doesNotMatch(sql, /raise exception 'WORKER_MANIFEST_REQUIRED'/i);
  ```
- [ ] **Step 2: 运行失败测试。** `node --test features/data/geoprocessing-local-source-migration.test.js`；预期新迁移缺失导致失败。
- [ ] **Step 3: 最小实现。** 新表以 `village_id` 为键，限制 `error_code` 为固定非敏感值；状态读取须同时检查 `checked_at >= now()-interval '2 minutes'` 与对应 Worker 新鲜 heartbeat。七参数 RPC 保留签名以兼容旧浏览器，但忽略 `p_dataset_id`；按现有已发布实践村/开放正式村规则和 `group_memberships` 授权；从 `villages.boundary` 导出村界与明确的单任务面积上限；以 `st_coveredby` 验证 AOI，检查新鲜状态后插入 `dataset_id = null, input_manifest = null`。收紧五参数 RPC 的 `authenticated` 执行权；发布须在维护窗口协调前端。影像范围使用经纬度 bbox，不发布本地路径。SQL 核心：

  ```sql
  create table if not exists public.geoprocessing_source_status (
    village_id text primary key,
    ready boolean not null,
    error_code text,
    worker_id text not null,
    checked_at timestamptz not null default now()
  );
  alter table public.geoprocessing_source_status enable row level security;
  revoke all on public.geoprocessing_source_status from public, anon, authenticated;
  revoke all on function public.submit_geoprocessing_run(text,text,text[],jsonb,jsonb) from public, anon, authenticated;
  ```

  实际迁移还必须完整定义上文两个状态 RPC、七参数提交 RPC 及权限，并以数据库集成测试验证，不能仅使用此片段。
- [ ] **Step 4: 运行通过测试。** `node --test features/data/geoprocessing-local-source-migration.test.js features/data/geoprocessing-practice-catalog-migration.test.js features/data/geoprocessing-queue-security.test.js`；再在一次性测试库以迁移前的 schema 执行 SQL，分别用学生、非成员、service role 调用 RPC，确认权限和过期状态行为。
- [ ] **Step 5: 只提交本任务文件。** 提交 `feat: gate personal processing on local source readiness`。

### Task 4: Worker 发布村庄状态并记录处理耗时

**Files:**
- Create: `server/src/village_processing/source_status.py`
- Modify: `server/src/village_processing/queue/gateway.py`
- Modify: `server/src/village_processing/worker.py`
- Modify: `server/src/village_processing/__main__.py`
- Modify: `server/src/village_processing/pipeline.py`
- Create: `server/tests/test_source_status.py`
- Modify: `server/tests/test_worker.py`

**Interfaces:**
- Consumes: Task 1 的 `DatasetCatalog.status()`/`village_ids()`；Task 3 的 `upsert_geoprocessing_source_status` RPC。
- Produces: `publish_source_statuses(catalog, gateway, worker_id) -> None` 和各阶段耗时日志；状态只含村庄 ID、布尔值、固定错误码、Worker ID。

- [ ] **Step 1: 写失败测试。** 假 Catalog 返回一个 ready、一个 `LOCAL_IMAGERY_MISSING`，假 Gateway 收集 RPC 参数；断言两村均发布且不含本地路径：

  ```python
  publish_source_statuses(catalog, gateway, "worker-1")
  assert gateway.published == [
      (mibu_uuid, True, None, "worker-1"),
      (hongxing_uuid, False, "LOCAL_IMAGERY_MISSING", "worker-1"),
  ]
  ```

  模拟发布失败后 Worker 继续重试；模拟文件在领取后消失，断言任务失败码明确且不返回绝对路径。
- [ ] **Step 2: 运行失败测试。** `python -m pytest server/tests/test_source_status.py server/tests/test_worker.py -q`；预期发布函数缺失。
- [ ] **Step 3: 最小实现。** `source_status.py` 遍历 `catalog.village_ids()`，调用 Gateway 的新 `publish_source_status(...)`；在 Worker 启动和周期性心跳时重新检查，任务领取前也刷新一次。使用 `time.perf_counter()` 记录排队/裁切/建筑/OSM/等高线/上传阶段的耗时和 run ID；日志不能输出密钥或本地绝对路径。单村缺失不影响其他村的循环。发布函数：

  ```python
  def publish_source_statuses(catalog, gateway, worker_id: str) -> None:
      for village_id in catalog.village_ids():
          code = catalog.status(village_id)
          gateway.publish_source_status(village_id, code == "ready", None if code == "ready" else code, worker_id)
  ```
- [ ] **Step 4: 运行通过测试。** `python -m pytest server/tests/test_source_status.py server/tests/test_worker.py server/tests/test_pipeline.py -q`。
- [ ] **Step 5: 只提交本任务文件。** 提交 `feat: publish local source readiness and stage timings`。

### Task 5: 前端只提交个人任务上下文并解释缺源数据

**Files:**
- Modify: `features/geoprocessing/geoprocessing-context.js`
- Modify: `features/geoprocessing/geoprocessing-client.js`
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/geoprocessing/geoprocessing-aoi.js`
- Modify: `app.js`
- Modify: 对应的四个 `.test.js`

**Interfaces:**
- Consumes: Task 3 的 `get_geoprocessing_source_status(p_village_id)` 和七参数提交 RPC。
- Produces: `client.getSourceStatus(villageId)`；`client.submit()` 总是传教学项目 ID、`p_dataset_id: null`，不再根据共享数据集决定路由。

- [ ] **Step 1: 写失败测试。** 对米埗 UUID/红星 UUID 都断言使用七参数 RPC 且 `p_dataset_id === null`：

  ```js
  await client.submit({ courseId: "course-1", teachingProjectId: "project-1", villageId: MIBU_ID, requestedSteps: ["buildings"], aoi });
  assert.equal(fake.calls[0][1].p_dataset_id, null);
  assert.equal(fake.calls[0][1].p_teaching_project_id, "project-1");
  ```

  另测缺影像/状态过期/Worker 离线时按钮禁用、AOI 超统一任务上限、个人空间选择失败时不绘制不提交。
- [ ] **Step 2: 运行失败测试。** `node --test features/geoprocessing/geoprocessing-context.test.js features/geoprocessing/geoprocessing-client.test.js features/geoprocessing/geoprocessing-panel.test.js features/geoprocessing/geoprocessing-aoi.test.js`；预期旧分流/状态展示测试失败。
- [ ] **Step 3: 最小实现。** context 不再把 legacy 米埗映射为字符串 `mibu` 用于新任务；旧历史预览兼容单独保留。`client.submit` 始终带 `p_teaching_project_id`，若缺上下文则明确报 `TEACHING_PROJECT_REQUIRED`，`p_dataset_id` 固定 `null`。页面加载源状态和服务端任务面积上限，提交前重新检查；错误映射分别说明 `LOCAL_IMAGERY_MISSING`、`LOCAL_SHARED_SOURCE_MISSING`、`SOURCE_STATUS_STALE`、`PROJECT_VILLAGE_MISMATCH`、`AOI_TOO_LARGE`。不要把 Supabase 控制台其他 403 噪声误映射为本任务失败。提交参数固定为：

  ```js
  if (!payload.teachingProjectId) throw new Error("TEACHING_PROJECT_REQUIRED");
  const args = {
    p_course_id: String(payload.courseId),
    p_village_id: String(payload.villageId),
    p_requested_steps: [...payload.requestedSteps],
    p_aoi: payload.aoi,
    p_parameters: normalizeParameters(payload.parameters),
    p_teaching_project_id: String(payload.teachingProjectId),
    p_dataset_id: null
  };
  ```
- [ ] **Step 4: 运行通过测试。** 同 Step 2，再执行 `node --test --test-isolation=none`，记录实际通过数和失败项。
- [ ] **Step 5: 只提交本任务文件。** 提交 `feat: show village source readiness in personal processing`。

### Task 6: 部署说明、端到端验收与性能对比

**Files:**
- Modify: `server/docs/supabase-worker-operations.md`
- Modify: `linux/README.md`
- Modify: `linux/scripts/verify-deployment.sh`
- Test: `server/tests/integration/test_live_queue.py`（仅显式 opt-in）

**Interfaces:**
- Consumes: Tasks 1–5 的迁移、Worker 配置和页面契约。
- Produces: 可重复执行的部署顺序、回退步骤和验收记录。

- [ ] **Step 1: 写失败验证。** 增加本地检查：米埗 UUID 的源文件可读、红星缺影像时 Worker 仍启动、就绪状态过期会降级；live 测试仅在 `RUN_LIVE_SUPABASE=1` 且具备测试账号/4090 权限时运行，不向生产课程提交假任务。
- [ ] **Step 2: 运行失败验证。** `python -m pytest server/tests/test_catalog.py server/tests/test_source_status.py -q`；运行部署脚本的只读检查部分，记录缺少的真实文件/凭据，不打印机密。
- [ ] **Step 3: 更新文档与脚本。** 写明 4090 `PLATFORM_DATA_ROOT` 中每村影像、共用 DEM/OSM/模型的相对路径，先备份并执行新 SQL，再部署 Worker 和前端；说明迁移期短暂维护窗口、仅回退代码不应删除历史任务、就绪状态过期即停止新任务。脚本按 UUID 验证米埗，不因未配置红星影像而误报整体服务失败。
- [ ] **Step 4: 分层验收。** 本地执行 `python -m pytest server/tests -q` 和 `node --test --test-isolation=none`；有权限后在测试 Supabase + 4090 跑米埗提交→领取→处理→上传→个人空间导入，红星缺影像时确认提交前拒绝，再补影像验收；收集排队、处理、上传分段时间，和此前约 10 秒体验比较，未测量时不承诺恢复到 10 秒。
- [ ] **Step 5: 只提交文档、脚本与测试。** 提交 `docs: document local-source geoprocessing rollout`。

## Self-review

- 规格中的双流程、缺影像、资格校验、AOI、历史任务、路径保密、阶段耗时和部署限制分别由 Tasks 1–6 覆盖。
- 任务间接口仅依赖上文明确命名的 Catalog、状态 RPC 和前端 Client；没有依赖尚未定义的共享上传改动。
- 发布前必须核对实际米埗/红星 UUID、4090 文件路径和 Supabase 当前 schema；这些是部署输入，不应靠猜测写入代码。
