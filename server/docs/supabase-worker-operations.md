# Supabase worker deployment

The browser uses the existing publishable key. The service-role key must exist
only in `server/.env` on the Worker computer; never paste it into source code,
browser storage, screenshots, issues, or chat.

## One-time cloud setup

1. In the signed-in Supabase SQL Editor, apply the existing auth/profile
   migration if it has not already been applied.
2. Apply `supabase_SQL/Geoprocessing Worker Queue.sql`.
3. Apply the updated course workbench seed if the remote course was previously
   created.
4. Confirm Storage bucket `geoprocessing-results` exists and is **private**.
5. Confirm the API exposes the queue RPCs and Realtime includes
   `public.geoprocessing_runs`.

The migration is idempotent. Do not run it from the browser with the
publishable key.

## Win11 Worker configuration

Copy `server/.env.example` to the ignored `server/.env` and replace only the
local values. Verify before adding credentials:

```powershell
git check-ignore server/.env
```

Then run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing health --local
server\scripts\start_platform_worker.ps1
server\scripts\stop_platform_worker.ps1
```

The Worker initiates outbound HTTPS to Supabase. Do not add an inbound Windows
Firewall rule. The model service remains on `127.0.0.1:8021`.

## Live contract verification

After migration and local `.env` are ready, explicitly opt in:

```powershell
$env:RUN_LIVE_SUPABASE='1'
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest `
  server\tests\integration\test_live_queue.py -m live_supabase -v
```

If a Worker is busy, pause new claims with the teacher/admin RPC rather than
terminating a GPU process mid-stage. Lease expiry allows another Worker to
recover a task after a crash, up to three attempts.

## Linux 4090 facade queue

立面任务使用独立的 `codex/facade-linux-worker` 分支和
`supabase_SQL/Facade Generation Worker Queue.sql`。SQL 必须先经审核后执行；确认：

- `facade-generation` 与 `house-photos` 可访问，生成结果桶保持 private；
- 浏览器只能执行 `submit_facade_run`、`confirm_facade_crop` 和取消 RPC；
- 领取、续租、状态发布和 artifact 写入仅允许 `service_role`；
- `facade_generation_runs` 已加入 Realtime。

服务器私有内容固定在：

```text
/srv/village-platform/models
/var/lib/village-platform/runtime
/etc/village-platform/worker.env
```

首次启动或升级：

```bash
cd /opt/village-storymap
git fetch origin
git switch codex/facade-linux-worker
git pull --ff-only
./linux/scripts/check-host.sh
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml build
sudo docker compose --env-file /etc/village-platform/worker.env -f linux/compose.yaml up -d
./linux/scripts/verify-deployment.sh
```

验证脚本必须确认 RTX 4090、Blender 3.0.1、三个 facade 容器、两个内部健康端点、
Supabase Storage 和最新 Worker heartbeat。业务验收选择明确配置的历史 `photo_id`，等待
`awaiting_crop`，由学生拖动屋顶线后确认，再等待 `completed` 并验证签名 GLB。

需要 rollback 时，停止 facade Worker（不要停止 GIS 队列），保存失败 run ID 与有限日志，
检出上一个记录的 commit，把 `IMAGE_TAG` 恢复为对应不可变镜像标签，然后重新启动并验证。
不要删除失败任务或覆盖最后一次成功的 GLB。
