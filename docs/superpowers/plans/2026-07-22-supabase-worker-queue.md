# Supabase Worker Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Win11 Worker 通过出站 HTTPS 从 Supabase 安全领取任务、运行本地处理器、上传私有结果并支持租约恢复。

**Architecture:** 浏览器只调用受限 RPC 创建任务；Worker 使用本机 service-role key 原子领取任务并续租。结果进入私有 Storage，状态和 artifact 元数据进入受 RLS 保护的表；浏览器永远不能写 Worker 状态字段。

**Tech Stack:** Supabase Postgres/Auth/Storage/Realtime、PL/pgSQL、supabase-py、Python asyncio/HTTPX、pytest、Node `node:test` 静态安全测试。

## Global Constraints

- service-role key 只存放于 `server/.env`，不写入网页、日志、提交或 artifact。
- Win11 Worker 只发起出站 HTTPS，不开放公网/校园网入站端口。
- 任务领取使用 `FOR UPDATE SKIP LOCKED`、租约和最大重试次数。
- 学生只能创建、查看、取消自己的 run，并读取自己的 artifact。
- GPU run 并发固定为 1；Worker 一次只运行一个完整 run。
- Storage bucket 名固定为 `geoprocessing-results` 且为 private。
- SQL 文件必须可重复执行；每次创建 policy 前先按名称 drop，函数使用 `create or replace`。
- 依赖前置计划 `2026-07-22-native-geoprocessing-runtime.md` 的 `run_pipeline()` 契约。

---

### Task 1: 队列表、RLS 与 RPC migration

**Files:**
- Create: `supabase_SQL/Geoprocessing Worker Queue.sql`
- Create: `features/data/geoprocessing-queue-security.test.js`

**Interfaces:**
- Produces: `submit_geoprocessing_run`、`claim_next_geoprocessing_run`、`renew_geoprocessing_lease`、`request_geoprocessing_cancel`、`teacher_cancel_geoprocessing_run`、`set_geoprocessing_queue_paused`、`get_worker_availability` RPC；村庄登记表、三张核心任务表和私有 bucket 策略。

- [ ] **Step 1: 写 SQL 静态安全失败测试**

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sql = fs.readFileSync("supabase_SQL/Geoprocessing Worker Queue.sql", "utf8");

test("claim and lease RPCs are service-role only", () => {
  assert.match(sql, /FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
  assert.match(sql, /grant\s+execute[\s\S]+claim_next_geoprocessing_run[\s\S]+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]+claim_next_geoprocessing_run[\s\S]+to\s+authenticated/i);
});

test("students can read only owned runs and cannot write worker fields", () => {
  assert.match(sql, /owner_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /revoke\s+update[\s\S]+geoprocessing_runs[\s\S]+from\s+authenticated/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test features/data/geoprocessing-queue-security.test.js`

Expected: FAIL，SQL 文件尚不存在。

- [ ] **Step 3: 创建表与状态约束**

Migration 必须创建：

```sql
create extension if not exists postgis with schema extensions;

create table public.geoprocessing_villages (
  village_id text primary key,
  display_name text not null,
  bounds jsonb not null,
  max_aoi_sq_km numeric not null,
  active boolean not null default false
);

create table public.geoprocessing_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  village_id text not null,
  requested_steps text[] not null,
  aoi jsonb not null,
  parameters jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in
    ('queued','claimed','running','completed','failed','cancel_requested','canceled')),
  current_stage text,
  progress smallint not null default 0 check (progress between 0 and 100),
  warnings jsonb not null default '[]'::jsonb,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
```

`geoprocessing_villages` 幂等 upsert 米埗村：bounds `[113.6578225,23.6739555,113.6695615,23.6806181]`、`max_aoi_sq_km=2`、`active=true`。同时创建 `geoprocessing_artifacts`、`worker_heartbeats` 和单行 `geoprocessing_queue_control`；artifact 唯一键为 `(run_id, artifact_type)`。所有表启用 RLS，学生 select 条件为 `owner_id=auth.uid()`；教师/管理员通过 `current_profile_role()` 查看课程任务；Worker 写权限只授予 service_role。queue control 的 `paused` 只能由教师/管理员 RPC 修改，claim 在 paused 时直接返回空集。

- [ ] **Step 4: 实现提交、原子领取和租约函数**

`submit_geoprocessing_run` 必须从 `auth.uid()` 取 owner，确认 `geoprocessing_villages.active=true`，限制步骤、AOI 类型、最多 500 顶点、位于登记 bounds 内，并用 PostGIS geography 面积确认不超过 `max_aoi_sq_km=2`；参数使用白名单且每人最多 2 个未结束任务。`claim_next_geoprocessing_run` 先读取 queue control；未暂停时才在单事务中选择最早 queued 或租约过期且可重试的行：

```sql
select id into v_id
from public.geoprocessing_runs
where (status = 'queued' or (status in ('claimed','running') and lease_expires_at < now()))
  and attempt_count < 3
order by created_at
for update skip locked
limit 1;
```

随后写 `claimed`、worker ID、`now()+interval '90 seconds'`、attempt+1 并返回完整任务。领取/续租/Worker 状态 RPC 撤销 public/anon/authenticated，只 grant service_role。`teacher_cancel_geoprocessing_run` 和 `set_geoprocessing_queue_paused` 在函数内部要求 `current_profile_role() in ('teacher','admin')`，只 grant authenticated。

- [ ] **Step 5: 创建 private Storage 策略与安全可用性 RPC**

Bucket 为 private。对象路径第一段必须等于 `auth.uid()::text`；学生只允许 select 本人目录。`get_worker_availability()` 仅返回 `available/busy/offline` 和分钟级时间，不返回机器名、版本、IP、路径或 run ID。

```sql
create policy geoprocessing_results_read_own on storage.objects
for select to authenticated
using (bucket_id = 'geoprocessing-results' and (storage.foldername(name))[1] = auth.uid()::text);

revoke all on function public.get_worker_availability() from public, anon;
grant execute on function public.get_worker_availability() to authenticated;
```

- [ ] **Step 6: 运行静态测试**

Run: `node --test features/data/geoprocessing-queue-security.test.js`

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add "supabase_SQL/Geoprocessing Worker Queue.sql" features/data/geoprocessing-queue-security.test.js
git commit -m "feat: add secure geoprocessing queue schema"
```

### Task 2: Supabase Gateway

**Files:**
- Create: `server/src/village_processing/queue/gateway.py`
- Create: `server/src/village_processing/queue/models.py`
- Create: `server/tests/test_supabase_gateway.py`

**Interfaces:**
- Produces: `SupabaseGateway.claim(worker_id)`、`renew(run_id, worker_id)`、`is_cancel_requested(run_id)`、`set_running`、`set_stage`、`complete`、`fail`、`cancel`、`upload_artifact`、`heartbeat`。

- [ ] **Step 1: 写 RPC 映射和脱敏测试**

```python
def test_claim_maps_rpc_payload_to_processing_request(fake_supabase):
    fake_supabase.rpc_result = [{"id": RUN_ID, "village_id": "mibu", "requested_steps": ["contours"], "aoi": AOI, "parameters": {"contour_interval_m": 5}}]
    run = SupabaseGateway(fake_supabase).claim("win11-pilot")
    assert run.run_id == RUN_ID
    assert run.village_id == "mibu"

def test_fail_redacts_local_paths(fake_supabase):
    SupabaseGateway(fake_supabase).fail(RUN_ID, "SOURCE_RASTER_INVALID", r"E:\secret\dem.tif")
    payload = fake_supabase.last_update
    assert "E:\\" not in payload["error_message"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_supabase_gateway.py -v`

Expected: FAIL，gateway 尚不存在。

- [ ] **Step 3: 实现唯一的 Supabase 访问边界**

```python
class SupabaseGateway:
    def claim(self, worker_id):
        rows = self.client.rpc("claim_next_geoprocessing_run", {"p_worker_id": worker_id}).execute().data or []
        return QueuedRun.from_row(rows[0]) if rows else None

    def renew(self, run_id, worker_id):
        self.client.rpc("renew_geoprocessing_lease", {"p_run_id": run_id, "p_worker_id": worker_id}).execute()

    def upload_artifact(self, owner_id, run_id, summary):
        path = f"{owner_id}/{run_id}/{summary.path.name}"
        self.client.storage.from_("geoprocessing-results").upload(
            path, summary.path.read_bytes(), {"content-type": "application/geo+json", "upsert": "true"}
        )
        return path
```

所有异常先映射到稳定错误码；学生消息只包含文件类别和建议，不包含绝对路径、traceback、URL query 或 key。

- [ ] **Step 4: 运行测试并提交**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_supabase_gateway.py -v`

Expected: 全部通过。

```bash
git add server/src/village_processing/queue server/tests/test_supabase_gateway.py
git commit -m "feat: add Supabase worker gateway"
```

### Task 3: 单并发 Worker、续租与恢复

**Files:**
- Create: `server/src/village_processing/worker.py`
- Create: `server/tests/test_worker.py`

**Interfaces:**
- Consumes: `SupabaseGateway`、`run_pipeline()`、`DatasetCatalog`。
- Produces: `Worker.run_once() -> bool`、`Worker.run_forever()`。

- [ ] **Step 1: 写成功、失败和租约红灯测试**

```python
async def test_worker_claims_runs_pipeline_uploads_then_completes(fake_gateway, fake_pipeline):
    worker = Worker(fake_gateway, fake_pipeline, worker_id="win11-pilot")
    assert await worker.run_once() is True
    assert fake_gateway.events == ["claim", "running", "upload", "complete"]

async def test_worker_renews_lease_during_long_stage(fake_gateway, slow_pipeline):
    worker = Worker(fake_gateway, slow_pipeline, worker_id="win11-pilot", lease_renew_seconds=30)
    await worker.run_once()
    assert fake_gateway.renew_count >= 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_worker.py -v`

Expected: FAIL，Worker 尚不存在。

- [ ] **Step 3: 实现单任务状态机**

```python
async def run_once(self):
    run = self.gateway.claim(self.worker_id)
    if run is None:
        return False
    renew_task = asyncio.create_task(self._renew_until_done(run.run_id))
    try:
        self.gateway.set_running(run.run_id, self.worker_id)
        manifest = await asyncio.to_thread(self.pipeline, run)
        artifacts = [self.gateway.upload_artifact(run.owner_id, run.run_id, item) for item in manifest.artifacts]
        self.gateway.complete(run.run_id, artifacts, manifest.warnings)
    except CancelRequested:
        self.gateway.cancel(run.run_id)
    except Exception as exc:
        self.gateway.fail(run.run_id, error_code(exc), safe_message(exc))
    finally:
        renew_task.cancel()
    return True
```

`run_forever()` 无任务时指数退避 2–15 秒并持续心跳；每个阶段开始前及阶段完成后调用 `is_cancel_requested()`，收到取消请求时不再启动下一阶段。收到 Ctrl+C 时当前阶段安全结束或写 `WORKER_SHUTDOWN`。同一进程没有任务并行；建筑服务调用也只有一个。

- [ ] **Step 4: 运行 Worker 测试**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_worker.py -v`

Expected: 全部通过，未出现未回收 asyncio task。

- [ ] **Step 5: 提交**

```bash
git add server/src/village_processing/worker.py server/tests/test_worker.py
git commit -m "feat: add leased outbound geoprocessing worker"
```

### Task 4: 本机配置、健康检查和启动停止脚本

**Files:**
- Create: `server/src/village_processing/health.py`
- Create: `server/scripts/start_platform_worker.ps1`
- Create: `server/scripts/stop_platform_worker.ps1`
- Create: `server/tests/test_health.py`
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `python -m village_processing health`；隐藏窗口启动的 building service 与 queue worker。

- [ ] **Step 1: 写缺失密钥和数据时的健康测试**

```python
def test_health_never_echoes_secret(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "very-secret")
    code = run_health_checks()
    assert "very-secret" not in capsys.readouterr().out

def test_missing_data_root_is_unhealthy(monkeypatch):
    monkeypatch.setenv("PLATFORM_DATA_ROOT", r"E:\missing")
    assert run_health_checks() != 0
```

- [ ] **Step 2: 实现健康检查和安全配置模板**

```dotenv
SUPABASE_URL=https://rzmbmwauomzwiyenafha.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-locally
PLATFORM_DATA_ROOT=E:\村规平台学生体验版
PLATFORM_WORK_ROOT=E:\村规平台学生体验版\runtime
PLATFORM_CATALOG=server\config\villages.yaml
BUILDING_SERVICE_URL=http://127.0.0.1:8021
WORKER_ID=win11-pilot
```

健康检查验证 Supabase URL、key 仅存在性、catalog、TIF/PBF/PTH、可写 work root、GDAL/PROJ、Storage 连接和建筑 `/health`；输出只显示 OK/FAIL 与稳定错误码。

- [ ] **Step 3: 实现隐藏窗口启动**

`start_platform_worker.ps1` 先运行 health，再用 `Start-Process -WindowStyle Hidden` 启动建筑服务，确认 `127.0.0.1:8021/health`，然后启动 `python -m village_processing worker`；PID 写入 `server/runtime/pids/`。停止脚本只终止 PID 文件中且可执行路径位于两个 `platform_*` 前缀的进程。

```powershell
$Building = Start-Process -FilePath 'E:\anaconda3\envs\platform_building_worker\python.exe' `
  -ArgumentList '-m','uvicorn','village_processing.building.service:app','--host','127.0.0.1','--port','8021' `
  -WindowStyle Hidden -PassThru
$Worker = Start-Process -FilePath 'E:\anaconda3\envs\platform_geo_worker\python.exe' `
  -ArgumentList '-m','village_processing','worker' -WindowStyle Hidden -PassThru
```

- [ ] **Step 4: 运行测试和本机启动验证**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_health.py -v
powershell -ExecutionPolicy Bypass -File server\scripts\start_platform_worker.ps1
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8021/health
```

Expected: 测试通过；health 返回 200；未创建 Windows 防火墙入站规则。

- [ ] **Step 5: 提交**

```bash
git add server/src/village_processing/health.py server/scripts server/tests/test_health.py server/.env.example
git commit -m "ops: add secure Win11 worker startup"
```

### Task 5: 应用 Supabase migration 并做真实队列集成

**Files:**
- Create: `server/tests/integration/test_live_queue.py`
- Create: `server/docs/supabase-worker-operations.md`

**Interfaces:**
- Produces: 已部署的表/RPC/bucket；测试用户和 Win11 Worker 间的真实任务往返。

- [ ] **Step 1: 在 Supabase SQL Editor 执行 migration**

执行 `supabase_SQL/Geoprocessing Worker Queue.sql`，随后在 Storage 确认 `geoprocessing-results` 为 private。若当前会话无项目管理权限，停止在此步骤并请用户在已登录的 Supabase Dashboard 执行，不通过聊天传 service-role key。

- [ ] **Step 2: 本机创建未跟踪的 `.env`**

从 Dashboard 的项目设置把 service-role key 直接粘贴到 `server/.env`；确认 `git check-ignore server/.env` 输出该文件。不得把 key 传入命令行历史或写入测试快照。

- [ ] **Step 3: 写 live 集成测试**

测试创建两个真实 Auth 测试用户，各自调用 `submit_geoprocessing_run`；验证 A 不能 select B；service-role 能 claim；第二次 claim 不返回同一 run；租约过期后可重领；artifact 路径只有 owner 可签名读取。测试数据最终由 service-role 按 run ID 清理。

```python
@pytest.mark.live_supabase
def test_two_users_are_isolated(live_clients):
    run_a = submit(live_clients.user_a)
    run_b = submit(live_clients.user_b)
    assert ids_visible_to(live_clients.user_a) == {run_a}
    assert ids_visible_to(live_clients.user_b) == {run_b}
    claimed = claim(live_clients.service, "integration-worker")
    assert claimed in {run_a, run_b}
    assert claim(live_clients.service, "integration-worker-2") != claimed
```

- [ ] **Step 4: 运行集成测试**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/integration/test_live_queue.py -v -m live_supabase`

Expected: 全部通过；0 个跨用户可见记录；同一任务只领取一次。

- [ ] **Step 5: 启动 Worker 并提交一项 contours-only 真实任务**

Run: `powershell -ExecutionPolicy Bypass -File server\scripts\start_platform_worker.ps1`

Expected: run 从 queued → claimed → running → completed；Storage 出现 `owner/run/contours.geojson`；网页 publishable key 无法更新 status/worker_id。

- [ ] **Step 6: 提交测试和运维文档**

```bash
git add server/tests/integration/test_live_queue.py server/docs/supabase-worker-operations.md
git commit -m "test: verify live Supabase worker queue"
```
