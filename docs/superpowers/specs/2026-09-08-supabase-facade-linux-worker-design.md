# Supabase 两阶段立面生成与 Linux RTX 4090 Worker 设计

**日期：** 2026-09-08  
**状态：** 已确认，待实施计划

## 目标

把现有“Grounding DINO Base → SAM 2.1 Large → LaMa → 全局 H0 → 结构保持网格 → 墙身裁切 → Blender 白模贴图 → GLB”的本地照片建模流程迁移到 Ubuntu RTX 4090。学生继续通过平台使用历史建筑照片，在正立面预处理完成后手动拖动屋顶下沿，再提交第二阶段生成 GLB。

Supabase 只承担身份、任务队列、状态、私有文件存储和 Realtime 通知；所有模型推理、图像处理和 Blender 建模都在 Linux Worker 执行。Linux 服务只主动访问 Supabase，不向公网暴露模型端口。

## 已确认的产品规则

- 学生从所选建筑的历史照片中选择输入，默认选择最新照片。
- 旧照片优先通过 `object_photos.photo_path` 从 `house-photos` 下载；仅有可信 `photo_url` 的历史记录走兼容读取。
- 历史照片失效时，提示重新选择或上传，不进入含糊的模型失败状态。
- 正立面预处理完成后，任务暂停为 `awaiting_crop`，等待学生手动确认 `crop_top`。
- 学生可重新调整屋顶线并再次生成；不重复执行 DINO、SAM、LaMa、H0 和网格纠正。
- 同一任务的最新成功 GLB 是正式结果。重新生成失败时保留上一个成功 GLB。
- 首版继续使用 Linux 上已有的 Blender 3.0.1，不把升级 Blender 作为部署前置条件。

## 方案选择

采用独立的立面任务表和立面 Worker，复用现有图底关系队列的领取、租约、心跳、错误清洗、私有 Storage 和 RLS 设计，但不把人工暂停状态塞进 `geoprocessing_runs`。

不采用以下方案：

- 直接扩展 `geoprocessing_runs`：立面任务具有人工暂停和再次生成语义，会污染已稳定的 GIS 队列状态机。
- 浏览器直接请求 4090 FastAPI：需要公开端口，且缺少可靠排队、断线恢复和学生任务隔离。

## 目标架构

```text
学生浏览器
  ├─ object_photos：选择历史照片
  ├─ RPC：提交/确认屋顶线/取消
  ├─ Realtime：订阅任务状态
  └─ 私有签名 URL：读取预览与 GLB
             │
             ▼
Supabase
  ├─ facade_generation_runs
  ├─ facade_generation_artifacts
  ├─ house-photos（历史输入）
  └─ facade-generation（任务产物）
             ▲
             │ 出站 HTTPS
Linux RTX 4090
  ├─ facade-worker：队列、文件、H0/网格、裁切、Blender、上传
  ├─ facade-ml：Grounding DINO + SAM2.1
  └─ facade-lama：LaMa
```

三个 Linux 服务共享 `/work`，因为现有内部模型接口传递绝对文件路径。`facade-ml` 和 `facade-lama` 仅加入 Docker 内部网络，不映射宿主机或公网端口。Supabase `service_role` 只注入 `facade-worker`。

## 数据模型与状态机

新增：

- `facade_generation_runs`：所有者、课程、空间、建筑、照片、参数、状态、进度、租约、错误和生成修订号。
- `facade_generation_artifacts`：任务产物类型、Storage 路径、SHA-256、MIME、大小、修订号和安全诊断摘要。

状态流：

```text
queued_rectification
→ claimed_rectification
→ rectifying
→ awaiting_crop
→ queued_generation
→ claimed_generation
→ generating
→ completed
```

异常状态为 `failed`、`cancel_requested` 和 `canceled`。`completed` 可在学生再次确认屋顶线后回到 `queued_generation`，同时 `generation_revision + 1`。

领取 RPC 使用 `FOR UPDATE SKIP LOCKED`；运行中每 30 秒续租，租约约 90 秒。崩溃后可重新领取，每个阶段最多自动尝试三次。`awaiting_crop` 不持有租约、不占 GPU，也不保持长进程任务。

## RPC 与权限

新增安全 RPC：

- `submit_facade_run`
- `claim_next_facade_run`
- `renew_facade_run_lease`
- `publish_facade_rectification`
- `confirm_facade_crop`
- `record_facade_artifact`
- `set_facade_run_state`
- `request_facade_cancel`

学生只能读取自己的任务和产物，并调用提交、确认屋顶线和取消 RPC。学生不能直接写 Worker、状态、租约、错误或产物路径。提交 RPC 只接受 `photo_id`，在数据库侧验证照片对应所选建筑；浏览器不能提交任意下载 URL。Worker 专用 RPC 仅授权 `service_role`。教师和管理员可查看全部任务。

## Storage 布局

原始照片不重复上传，继续保存在 `house-photos`。新增私有 Bucket `facade-generation`：

```text
{owner_id}/{run_id}/rectification/source.png
{owner_id}/{run_id}/rectification/preview.jpg
{owner_id}/{run_id}/rectification/building-mask.png
{owner_id}/{run_id}/rectification/diagnostics.json
{owner_id}/{run_id}/generation/facade-texture.png
{owner_id}/{run_id}/generation/building.glb
{owner_id}/{run_id}/generation/model-manifest.json
```

数据库记录 Storage 对象路径，不长期保存签名 URL。浏览器读取时生成短期签名 URL。产物采用确定性路径和 upsert，保证租约恢复和重复执行不产生重复文件。

重新生成时先上传修订版临时对象并校验，然后更新正式 artifact 记录；只有新 GLB 成功后才取代旧版。失败修订不会使上一版 GLB 失效。

## 两阶段执行

### 第一阶段：正立面预处理

1. Worker 领取 `queued_rectification`。
2. 根据 `photo_id` 查询受信任的历史照片记录。
3. 从 `house-photos` 下载到 `/work/{run_id}/input`。
4. 调用 `facade-ml` 完成 DINO 和 SAM2.1；需要时由其调用 `facade-lama`。
5. `facade-worker` 复用 `FullLocalFacadeRectifier` 完成全局 H0 和结构保持网格。
6. 上传正立面原图、预览、建筑掩膜和安全诊断。
7. 原子发布产物记录并把状态设置为 `awaiting_crop`，随后释放租约。

### 第二阶段：裁切和 GLB

1. 学生调用 `confirm_facade_crop` 提交 `crop_top`、屋顶类型和建筑尺寸。
2. RPC 验证数值并将任务推进到 `queued_generation`。
3. Worker 再次领取；优先复用 `/work/{run_id}`，缺失时从私有 Storage 恢复第一阶段产物。
4. 复用 `crop_facade_body` 生成墙身贴图。
5. 复用 `BlenderService` 和 `generate_building.py`，后台调用 Blender 3.0.1 生成 GLB。
6. 校验返回码、GLB 文件头、文件大小和 manifest，再上传并设置为 `completed`。

## Docker、Blender 与 GPU 串行

立面部署沿用原图底关系的 Docker Compose 思路，但新增 `facade-worker`、`facade-ml` 和 `facade-lama`。宿主机 Blender 不会自动出现在容器，因此 `facade-worker` 镜像内安装并固定 Blender 3.0.1，设置：

```text
BLENDER_EXECUTABLE=/usr/bin/blender
```

Grounding DINO、SAM2.1 和 LaMa 权重挂载到容器只读目录，不进入镜像或 Git。所有容器以非 root 用户运行；唯一持久可写目录是 `/work`。

图底关系模型与立面模型共用 RTX 4090。两套 Worker 在进入 GPU 推理前获取共享的 `/work/.locks/gpu-0.lock`，推理结束立即释放。H0、网格和 Blender 的 CPU 阶段不持有 GPU 锁。使用操作系统文件锁，进程异常退出时锁自动释放。

## 学生端交互

现有照片建模页面保留视觉流程，只替换后端边界：

```text
选择建筑 → 选择历史照片 → 提交正立面任务
→ 排队/处理中 → 显示正立面 → 拖动屋顶线
→ 确认生成 → 排队/生成中 → GLB 预览 → 替换主 3D 建筑
```

页面使用 Supabase RPC、Realtime 和 Storage 签名 URL，不再访问 `127.0.0.1:8011`。关闭页面后重新打开时，根据自己的最近任务恢复到排队、处理、等待屋顶线、生成或完成状态。最终仍通过现有 `postMessage` 合约把 GLB 返回主 3D 页面。

## 错误与恢复

- 历史照片记录或 Storage 对象失效：回到照片选择并提示重新上传。
- DINO/SAM/LaMa/H0 失败：记录真实阶段，允许重试，并保留现有“使用原图继续”的显式入口。
- Worker 离线：任务保持排队，页面根据心跳显示服务器离线。
- Worker 中断：租约过期后恢复领取。
- 第一阶段成功但 Blender 失败：保留正立面，允许只重试第二阶段。
- 重新生成失败：保留上一个成功 GLB。
- Storage 上传失败：不发布成功状态，按相同确定性路径重试。
- 三次自动失败：停止自动领取，学生看到简化错误，教师可查看脱敏诊断。

## GitHub 到 Linux 的交付方式

代码通过 GitHub 分支交付，但以下内容不进入 Git：模型权重、Hugging Face 缓存、Supabase 密钥、历史照片、任务产物、运行日志和服务器 `.env`。

当前 `learning` 与已有 `codex/linux-4090-deployment` 从较早提交分叉，且当前工作区存在大量未提交改动。实施时不得直接在脏工作区整体合并旧 Linux 分支，也不得把所有改动一起推送。安全策略是：

1. 先明确并保存当前平台改动的基线提交。
2. 从该基线创建 `codex/facade-linux-worker`。
3. 从 `codex/linux-4090-deployment` 选择性恢复 `linux/` 部署骨架。
4. 对当前 `server/` 手工移植旧部署所需的少量兼容变更，不整分支回合，避免带回旧代码或删除新功能。
5. 在新分支实现立面 SQL、队列适配器、Docker 服务和学生端连接，测试后推送 GitHub。
6. Linux 首次部署使用 `git clone`；已有仓库使用 `git fetch` 后切换到明确分支或提交，不在生产机直接开发。
7. 模型和秘密通过服务器运维路径单独配置，然后构建并启动 Compose。

生产部署必须固定 Git commit 或不可变镜像标签，不长期追踪会变化的 `latest`。

## 测试与上线验收

- SQL/RLS：学生只能访问自己的任务；Worker 字段和产物路径不可由学生修改。
- Worker：领取、续租、两阶段暂停、崩溃恢复、取消、三次失败和重新生成。
- 核心：现有 DINO/SAM/LaMa/H0/网格/裁切/Blender 回归测试保持通过。
- 前端：历史照片选择、默认最新、Realtime 恢复、屋顶线确认、重新生成和 GLB 返回。
- Docker：模型服务无公网端口、共享 `/work`、权重只读、密钥只进入 Worker、GPU 锁共享。
- 正式 Linux 部署后的第一个真实历史照片任务作为上线验收，不单独设置部署前 Blender 冒烟门槛。

## 实施边界

本次不升级 Blender，不重训模型，不重写现有算法，不公开 FastAPI，不引入 Kubernetes，不长期保存签名 URL，也不为每次重新生成保留完整 GLB 版本历史。
