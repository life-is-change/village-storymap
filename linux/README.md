# Linux RTX 4090 Worker Deployment

本目录把现有 Windows 试运行 Worker 部署为 Ubuntu 22.04 上的两个容器，适用于
RTX 4090 服务器。它不会迁移网页或 Supabase；浏览器仍然向原 Supabase 项目提交
任务，Linux Worker 主动领取任务并上传结果。

本目录可以提交到 GitHub。Do not commit 真实 `.env`、service-role key、模型权重、
TIF、PBF、运行结果或服务器私有路径。Do not publish port `8021`；建筑服务只能由
Compose 内部的 `geo-worker` 访问。

## Architecture

```text
Browser -> Supabase queue/private Storage <- HTTPS -> geo-worker
                                                     |
                                                     | backend Docker network
                                                     v
                                              building:8021 -> RTX 4090

/srv/village-platform/data    -> /data  (read-only in both containers)
/var/lib/village-platform/runtime -> /work (same path in both containers)
```

- `geo-worker`：Python 3.11、GDAL、Rasterio、GeoPandas、Supabase SDK；拥有出站网络。
- `building`：Python 3.10、CUDA 11.8、PyTorch、MMCV、MMDetection；只有内部网络。
- `building` 不接收 Supabase 密钥，也不声明 Compose `ports`。
- `/health` 仅检查进程；`/ready` 真正加载模型并确认 GPU 推理环境可用。
- Worker 只处理一个完整任务；原有 Supabase 租约负责崩溃恢复。

## Prerequisites

推荐配置：Ubuntu 22.04 LTS x86_64、RTX 4090、32 GB 以上内存、100 GB 以上
NVMe 空间。服务器需要访问 GitHub、Docker/NVIDIA/Python 包仓库和 Supabase HTTPS。

1. 使用发行版包管理器安装 NVIDIA 驱动并重启：
   <https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/ubuntu.html>
2. 安装 Docker Engine 与 Compose 插件：
   <https://docs.docker.com/engine/install/ubuntu/>
3. 安装 NVIDIA Container Toolkit：
   <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html>

完成 Toolkit 安装后配置 Docker：

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
nvidia-smi
sudo docker run --rm --gpus all \
  nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

两个 `nvidia-smi` 都必须显示 RTX 4090。Docker 用户组等同于 root 权限，不要把
不受信任的学生账号加入该组；本文命令默认使用 `sudo docker`。

安装基础工具并取得仓库：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git rsync
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /opt/village-storymap
git clone YOUR_GITHUB_REPOSITORY_URL /opt/village-storymap
cd /opt/village-storymap
git rev-parse HEAD
```

将实际仓库 URL 替换 `YOUR_GITHUB_REPOSITORY_URL`。记录输出的完整 commit ID，
后续镜像和回滚都必须对应这个版本。

## Create Host Directories

两个容器固定使用 UID/GID `10001`。创建目录并限制权限：

```bash
sudo install -d -m 0750 /srv/village-platform/data
sudo install -d -m 0750 -o 10001 -g 10001 \
  /var/lib/village-platform/runtime
sudo install -d -m 0700 /etc/village-platform
```

数据目录可以在上传阶段临时授予部署账号写权限；上传完成后应恢复为只读数据：

```bash
sudo chown -R root:root /srv/village-platform/data
sudo find /srv/village-platform/data -type d -exec chmod 0755 {} +
sudo find /srv/village-platform/data -type f -exec chmod 0644 {} +
```

不要对 `/var/lib/village-platform/runtime` 执行递归清理；其中可能包含正在处理的任务。

## Transfer and Verify Data

保持 `server/config/villages.yaml` 登记的相对目录结构。当前米埗村至少需要：

```text
建筑矢量/input_tif/米埗村（洛一洛二洛三）.tif
建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py
建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth
等高线/广东省_哥白尼DEM.tif
等高线/广东省_哥白尼DEM.tif.ovr
道路、水系/guangdong-260721.osm.pbf
```

推荐从 Windows 的 WSL 使用可断点续传的 `rsync`：

```bash
rsync -avhP --protect-args \
  "/mnt/e/村规平台学生体验版/" \
  DEPLOY_USER@LINUX_SERVER:/srv/village-platform/data/
```

也可以使用 WinSCP/SFTP。不要通过 GitHub 传输这些文件。复制前后分别生成 SHA-256：

```powershell
Get-FileHash -Algorithm SHA256 "待核对文件"
```

```bash
sha256sum "/srv/village-platform/data/待核对文件"
```

至少核对影像、DEM、DEM `.ovr`、PBF、模型配置和模型权重。六个文件都一致后再继续。

## Configure Secrets

把模板复制到 Git 仓库以外的固定位置：

```bash
sudo install -m 0600 linux/.env.example \
  /etc/village-platform/worker.env
sudoedit /etc/village-platform/worker.env
```

只修改：

```dotenv
SUPABASE_URL=https://实际项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=从Supabase后台取得的真实密钥
WORKER_ID=linux-rtx4090-01
IMAGE_TAG=上一步git-rev-parse-HEAD输出的完整40位commit
```

其余路径必须保留容器路径 `/data`、`/work` 和 `/app/server/config/villages.yaml`。
`IMAGE_TAG` 必须是当前已审核代码的完整 40 位小写 Git commit；Compose 用它给两个镜像
生成不可变标签，升级时不得复用旧标签。可再次用 `git rev-parse HEAD` 核对。
不要复制 Windows Worker 的本地环境文件。确认权限：

```bash
sudo stat -c '%a %U:%G %n' /etc/village-platform/worker.env
```

预期权限为 `600 root:root`。不要执行会把该文件内容打印到终端或 CI 日志的命令。

## Build and Start

先执行不会领取任务的主机预检：

```bash
cd /opt/village-storymap
sudo bash linux/scripts/check-host.sh
```

预期最后出现 `PRECHECK_OK`。首次构建需要下载 CUDA/PyTorch/Conda 包，耗时较长。
此阶段只启动 `building`，不得启动常驻 `geo-worker`，因此不会从真实队列领取任务：

```bash
cd /opt/village-storymap/linux
sudo docker compose --env-file /etc/village-platform/worker.env build --pull
sudo docker compose --env-file /etc/village-platform/worker.env up -d building
sudo docker compose --env-file /etc/village-platform/worker.env ps building
```

`/ready` 会完成真实模型加载。不要因为 Uvicorn 已经启动就判断模型可用。
验证脚本通过一次性 `geo-worker` 容器运行 GIS/OSM/建筑测试，测试容器不会执行队列轮询。

先安装 systemd unit，但此时不要 `enable` 或 `start`；否则 Linux 会在 Windows 停机前
开始领取任务：

```bash
sudo install -m 0644 systemd/village-platform.service \
  /etc/systemd/system/village-platform.service
sudo systemctl daemon-reload
sudo systemctl status village-platform.service || true
```

## Verify the Deployment

运行只处理本地固定小 AOI 的验证脚本：

```bash
cd /opt/village-storymap
sudo bash linux/scripts/verify-deployment.sh
```

它依次验证：

1. `building` 容器状态；
2. `/ready` 已加载真实模型；
3. `torch.cuda.is_available()` 和 `mmcv.ops.nms`；
4. GIS、GDAL OSM 驱动、catalog、建筑服务和 Supabase private Storage；
5. 固定小 AOI 影像裁剪；
6. 使用 Linux PATH 中的 `ogr2ogr` 提取道路、水路线和水面；
7. batch 1 建筑推理；
8. OSM 与建筑输出是有效 GeoJSON FeatureCollection，且建筑结果非空。

成功时最后输出 `VERIFY_OK`。结果保存在
`/var/lib/village-platform/runtime/linux-smoke/`，用于和 Windows 同 AOI 输出比较。

至少比较要素数量、几何合法性、边界范围和 source 元数据。GPU/操作系统导致的微小
浮点差异可以接受；空结果、明显数量异常、越界或无效几何不可接受。

## Supabase Canary

本地验证通过后，canary 必须作为下面 zero-loss 切换的一部分执行，不能提前启动
常驻 Linux Worker。先停止学生继续提交，然后立即在 Supabase SQL Editor 暂停领取并确认：

```sql
select public.set_geoprocessing_queue_paused(true);
select paused from public.geoprocessing_queue_control where singleton;
```

第二条查询必须返回 `true`。暂停只阻止领取，不会中断 Windows 当前任务。保持 Windows
运行，等待它完成已经 claimed/running 的任务：

```sql
select status, count(*)
from public.geoprocessing_runs
where status in ('claimed', 'running', 'cancel_requested')
group by status;
```

查询返回零行后才可以停止 Windows。另行记录暂停前已排队、尚未领取的任务数量：

```sql
select count(*) as queued_for_linux
from public.geoprocessing_runs
where status = 'queued';
```

这些 queued 任务不得删除；恢复队列后由 Linux 继续处理。保持暂停，直到 Windows Worker
已停止、Linux Worker 已启动且心跳正常。不要在这一步执行恢复命令。

## Zero-Loss Cutover

严格按顺序执行，任何一步失败都不要继续：

1. 停止学生提交，完成上一节的 drain 和 pause；确认控制表 `paused=true`。
2. 停止 Windows Worker，确认当前任务已经上传且 Windows 不再更新 heartbeat。
3. 在 Linux 启动并启用完整服务：

   ```bash
   sudo systemctl enable --now village-platform.service
   cd /opt/village-storymap/linux
   sudo docker compose --env-file /etc/village-platform/worker.env ps
   sudo docker compose --env-file /etc/village-platform/worker.env logs --tail 100 geo-worker
   ```

4. 在 Supabase SQL Editor 确认 `linux-rtx4090-01` 心跳更新时间持续前进：

   ```sql
   select worker_id, state, last_seen_at
   from public.worker_heartbeats
   order by last_seen_at desc;
   ```

5. 只在 `/ready`、日志和心跳都正常后恢复领取：

   ```sql
   select public.set_geoprocessing_queue_paused(false);
   select paused from public.geoprocessing_queue_control where singleton;
   ```

   第二条查询必须返回 `false`。
6. 如果暂停前已有 queued 任务，先观察 Linux 将这些保留任务全部完成；任一失败就立即
   再次 pause 并回滚。随后只让一个测试学生提交固定小 AOI 的三模块 canary，观察
   `queued -> claimed -> running -> completed`。
7. 确认 private bucket `geoprocessing-results` 出现该用户/run 目录，并在网页核对建筑、
   道路、水路线、水面、等高线五个逻辑图层。
8. 用另一个学生账号确认不能读取该 run 或 artifact。Canary 通过后才重新开放班级提交。
9. 保留 Windows 环境至少一至两天作为回滚入口。

现有 queued 任务不绑定机器，Linux 可以继续领取。若旧 Worker 意外中断，租约到期后
任务可重新领取，但会增加 attempt count，因此优先正常 drain。

## Routine Operations

```bash
cd /opt/village-storymap/linux
sudo docker compose --env-file /etc/village-platform/worker.env ps
sudo docker compose --env-file /etc/village-platform/worker.env logs --tail 200 building
sudo docker compose --env-file /etc/village-platform/worker.env logs --tail 200 geo-worker
nvidia-smi
df -h /var/lib/village-platform/runtime
sudo systemctl status village-platform.service
```

停止领取前先 pause 队列并等待当前任务结束：

```bash
sudo systemctl stop village-platform.service
```

Compose 日志已限制为每个服务 5 个、每个最多 20 MiB。不要用脚本定期删除整个 runtime；
如需制定保留策略，应只清理确认已上传且不再处于运行状态的旧 run 目录。

## Upgrade

每次升级使用 Git commit，不直接依赖不明确的工作区状态。先停止学生提交，按 Canary
章节执行 pause，并 drain 当前任务。确认队列暂停后记录旧版本：

```bash
cd /opt/village-storymap
git rev-parse HEAD
cd linux
sudo docker compose --env-file /etc/village-platform/worker.env images
```

然后检出已审核版本：

```bash
cd /opt/village-storymap
git fetch --tags
git checkout APPROVED_COMMIT_OR_TAG
git rev-parse HEAD
sudoedit /etc/village-platform/worker.env
sudo bash linux/scripts/check-host.sh
cd linux
sudo docker compose --env-file /etc/village-platform/worker.env build --pull
sudo docker compose --env-file /etc/village-platform/worker.env up -d --remove-orphans
sudo bash /opt/village-storymap/linux/scripts/verify-deployment.sh
```

在 `sudoedit` 中把 `IMAGE_TAG` 改为刚输出的完整 40 位 commit。每个 commit 对应独立
镜像标签，旧镜像不会被覆盖。验证通过后按 Zero-Loss Cutover 的恢复和 canary 步骤开放队列。

## Roll Back to Windows

Linux canary 或上线后任务失败时：

1. pause 队列。
2. 等待可安全结束的 Linux 当前阶段；不要同时运行两台机器处理同一已领取任务。
3. `sudo systemctl stop village-platform.service`。
4. 启动保留的 Windows Worker。
5. 确认 Windows heartbeat 恢复。
6. 恢复队列，提交一个 Windows canary。

网页、Supabase 表、RPC 和 artifact 路径没有改变，因此不需要数据库回滚。若只需回滚
Linux 镜像，也可以 checkout 记录的旧 commit、重建旧标签、验证后重新启动。

## Troubleshooting

### 宿主机能看到 GPU，容器看不到

重新检查 NVIDIA Container Toolkit，并执行：

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sudo docker run --rm --gpus all \
  nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### building 一直 unhealthy

```bash
sudo docker compose --env-file /etc/village-platform/worker.env logs --tail 300 building
sudo docker compose --env-file /etc/village-platform/worker.env exec building python3 -c \
  "import torch; print(torch.cuda.is_available())"
```

重点检查模型配置/权重路径、文件权限、CUDA 显存和 MMCV ABI。出现 `undefined symbol`
时不要随机升级 PyTorch；重新使用本目录固定的 PyTorch 2.0.1、CUDA 11.8、
MMCV 1.7.2 组合构建。

### DATASET_FILE_MISSING

确认数据目录结构与 `server/config/villages.yaml` 完全一致，并重新运行：

```bash
sudo bash /opt/village-storymap/linux/scripts/check-host.sh
```

### runtime Permission denied

```bash
sudo chown -R 10001:10001 /var/lib/village-platform/runtime
sudo chmod 0750 /var/lib/village-platform/runtime
```

不要改变源数据为容器可写。

### Supabase Storage 或队列失败

检查服务器是否能访问 Supabase HTTPS、密钥是否为 service-role、bucket 是否仍为 private，
再运行：

```bash
sudo docker compose --env-file /etc/village-platform/worker.env exec geo-worker \
  python -m village_processing health
sudo docker compose --env-file /etc/village-platform/worker.env logs --tail 300 geo-worker
```

不要把命令输出和密钥一起粘贴到 issue、聊天或截图中。
