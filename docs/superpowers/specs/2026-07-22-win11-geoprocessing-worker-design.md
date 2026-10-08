# Win11 地理处理 Worker 与 Supabase 任务链路设计

日期：2026-07-22

状态：待用户审阅

适用阶段：Windows 11 单机试运行，验证后迁移到团队 Linux RTX 4090 服务器

## 1. 背景与目标

平台当前主要读取预先准备的建筑、道路、水系和等高线 GeoJSON。课程希望让每位学生先独立体验完整的“图底关系”生产流程：从教师提供的高分辨率影像出发，得到建筑轮廓；从 OSM 得到道路和水系；从 DEM 得到等高线；最后把三类结果装载到个人工作空间并继续人工校核、编辑和合成。

本阶段以一台 Windows 11 笔记本作为临时服务器。学生在其他电脑的浏览器中使用网页；浏览器把任务写入 Supabase；Windows Worker 主动访问 Supabase 领取任务，使用本机文件、Conda 环境和 GPU/CPU 完成处理，再把 GeoJSON 结果写回 Supabase。Windows 电脑不向校园网或公网开放端口。

本阶段的成功标准是：另一台电脑上的已登录学生可以提交米埗村任务，并收到建筑、道路、水系和等高线结果；学生电脑不需要安装 Python、GIS 软件或模型环境，也不能接触服务器的本地路径和密钥。

## 2. 已确认的本地资源

统一数据根目录为 `E:\村规平台学生体验版`，当前资源如下：

| 模块 | 文件 | 已核对信息 |
| --- | --- | --- |
| 建筑影像 | `建筑矢量\input_tif\米埗村（洛一洛二洛三）.tif` | GeoTIFF，EPSG:4326，8956×5083，3 波段 Byte；范围约 113.6578225–113.6695615E、23.6739555–23.6806181N；像元约 0.00000131075° |
| 建筑模型 | `建筑矢量\china\mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth` | 约 776.8 MiB，MMDetection 2.x Mask R-CNN / ResNeXt-101，单类别 building |
| 建筑配置 | `建筑矢量\china\mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py` | 推理配置可用；训练数据路径和预训练路径不应参与推理 |
| 建筑脚本 | `建筑矢量\遥感影像农房矢量化正则化.py` | 现有脚本含旧绝对路径，默认 CUDA:0、tile 1536、overlap 384、batch 2；需改造成无硬编码的可测试处理器 |
| OSM | `道路、水系\guangdong-260721.osm.pbf` | 约 161 MiB；保留 OSM 标签、道路、水路和面关系，适合作为服务器源数据 |
| DEM | `等高线\广东省_哥白尼DEM.tif` | EPSG:4326，27498×19067，1 弧秒，Int16，NoData=0，覆盖广东区域 |
| DEM 概览 | `等高线\广东省_哥白尼DEM.tif.ovr` | 7 级外部概览，应与主 TIF 保持同目录、同文件名前缀 |

DEM 的 NoData=0 会同时把真实零米高程视作无数据，因此沿海任务必须进行有效像元比例检查，并在结果元数据中提示这一限制。OSM 文件名包含快照日期，结果必须记录该日期和 OSM 署名。

GitHub 仓库只保存代码、SQL、配置模板、环境清单和文档。TIF、PBF、PTH、处理结果、Supabase service-role key 和本地绝对路径均不提交 GitHub。

## 3. 方案选择

### 3.1 采用的方案：Supabase 队列 + Win11 出站 Worker

数据流如下：

```text
学生浏览器
  -> 使用现有 Supabase Auth 登录
  -> 提交 village_id、AOI、处理步骤和白名单参数
  -> Supabase 数据库中的任务队列
  <- 订阅本人任务状态
  <- 从私有 Storage 获取本人结果

Win11 Worker
  -> 仅通过 HTTPS 主动轮询/领取 Supabase 任务
  -> village_id 映射到 E:\村规平台学生体验版 下的本地资源
  -> 调用建筑 GPU 处理器与 GIS 处理器
  -> 上传 GeoJSON 和处理元数据
  -> 更新任务状态
```

学生浏览器不直接连接 Windows 电脑，不读取共享文件夹，也不调用 `E:\...` 路径。这样校园网、其他网络和 Windows 公用网络配置都不会改变调用方式；只要学生电脑和 Worker 都能访问 Supabase 即可。

### 3.2 暂不采用的方案

- 不让浏览器直接请求 Windows IP：会引入端口开放、校园网隔离、动态 IP、HTTPS 和安全问题。
- 不把模型、影像、DEM、OSM 上传 GitHub：体积、授权、隐私和版本管理均不合适。
- 不在本阶段安装 Docker/WSL：Docker 是后续统一部署和迁移工具，不是浏览器调用服务器的必要条件。
- 不允许学生提交任意服务器文件路径、任意命令或任意 TIF：试运行只处理教师登记的村庄数据集。

## 4. 组件设计

### 4.1 网页客户端

在现有静态网页和 Supabase 客户端基础上新增“底图生产”任务界面：

1. 从课程当前村庄取得 `village_id`，试运行固定为 `mibu`。
2. 学生在影像覆盖范围内绘制或使用教师预置 AOI。
3. 选择处理步骤：建筑、道路与水系、等高线，默认三项全选。
4. 选择少量教学参数：建筑置信度；等高距 5 米或 10 米；等高线平滑级别“无/轻度”。
5. 提交后显示排队、处理中、各阶段进度、完成或失败。
6. 完成后分别预览建筑、道路、水系、等高线；学生主动点击“复制到我的个人图层”，AI/源数据结果不得直接覆盖共享图层。
7. 任务状态优先用 Supabase Realtime 订阅，断线时降级为低频轮询。

网页只使用 Supabase publishable/anon key。service-role key 绝不进入 HTML、JavaScript、本地存储、GitHub 或浏览器网络响应。

### 4.2 Supabase 数据库与 Storage

新增下列表和数据库函数；具体 DDL 在实施计划中逐项落地。

#### `geoprocessing_runs`

每次学生提交对应一行，核心字段为：

- `id uuid`：任务 ID。
- `owner_id uuid`：强制取 `auth.uid()`，不可由浏览器冒充。
- `course_id text`、`village_id text`。
- `requested_steps text[]`：只允许 `buildings`、`roads_water`、`contours`。
- `aoi jsonb`：WGS84 Polygon/MultiPolygon GeoJSON。
- `parameters jsonb`：仅接受服务端白名单字段和范围。
- `status text`：`queued`、`claimed`、`running`、`completed`、`failed`、`cancel_requested`、`canceled`。
- `current_stage text`、`progress smallint`。
- `warnings jsonb`：记录不阻断任务的提示，例如某个 OSM 图层为空。
- `worker_id text`、`lease_expires_at timestamptz`、`attempt_count integer`。
- `error_code text`、`error_message text`；面向学生的信息不得含本地路径、堆栈或密钥。
- `created_at`、`started_at`、`completed_at`、`updated_at`。

#### `geoprocessing_artifacts`

每个输出文件对应一行，包含 `run_id`、`owner_id`、`artifact_type`、私有 Storage 路径、要素数、边界框、CRS、字节数、SHA-256、数据来源/快照日期、模型版本和生成参数。

#### `worker_heartbeats`

记录 `worker_id`、最后心跳、版本、能力（GPU building / GIS）、当前任务和健康状态，供教师判断“服务器离线/忙碌”。学生不能直接查询该表，只能通过受限函数得到 `available`、`busy` 或 `offline` 及概括时间；不能看到机器名、IP、路径、版本或当前任务 ID。

#### 数据库函数

- `submit_geoprocessing_run(...)`：已登录用户提交任务；数据库端验证村庄、步骤、AOI 顶点数、AOI 面积和参数范围。
- `claim_next_geoprocessing_run(...)`：Worker 原子领取一项任务，使用 `FOR UPDATE SKIP LOCKED` 和租约防止重复执行。
- `request_geoprocessing_cancel(run_id)`：任务所有者申请取消。

行级安全规则：学生只能提交、查看和取消自己的任务，只能查看自己的 artifact；教师/管理员可查看课程任务；浏览器不能写 Worker 字段或伪造完成状态。Worker 通过仅保存在本机 `.env` 的 service-role key 执行领取、状态更新和上传。

新增私有 bucket `geoprocessing-results`，路径约定为：

```text
<owner_uuid>/<run_uuid>/buildings.geojson
<owner_uuid>/<run_uuid>/roads.geojson
<owner_uuid>/<run_uuid>/waterways.geojson
<owner_uuid>/<run_uuid>/water_areas.geojson
<owner_uuid>/<run_uuid>/contours.geojson
<owner_uuid>/<run_uuid>/manifest.json
```

浏览器依据 Storage RLS 读取本人路径或申请短时签名 URL。原始 TIF、DEM、PBF、权重和完整 Worker 日志不上传该 bucket。

### 4.3 Windows Worker

仓库新增独立的 `server/` 代码区，Windows 启动入口使用 `platform_geo_worker` 环境。Worker 循环执行：

1. 启动自检：Supabase 连接、本地数据清单、GDAL/PROJ、磁盘空间、建筑服务健康状态。
2. 向 Supabase 写心跳并原子领取一项任务。
3. 在本地工作目录创建 `<run_uuid>` 子目录并写入不可变任务清单。
4. 校验 AOI 位于村庄登记范围内，并按任务步骤依次运行处理器。
5. 每个阶段产出标准 GeoJSON 和元数据，先本地验证再上传。
6. 更新 artifact 和任务状态；失败时记录稳定错误码与安全摘要。
7. 保留近期本地日志；中间大文件按保留策略清理，已上传结果可按课程策略保留。

试运行并发策略为：一个 Worker、一次只处理一个 run、GPU 建筑推理同时最多一个。多个学生提交时进入 Supabase 队列，不让任务并行抢占 8GB 显存。后续 Linux 4090 Worker 使用相同任务协议即可替换 Windows Worker。

### 4.4 两个 Conda 环境

环境明确建立在以下前缀：

- `E:\anaconda3\envs\platform_building_worker`
- `E:\anaconda3\envs\platform_geo_worker`

`platform_building_worker` 专门承载现有 MMDetection 2.x 建筑模型、CUDA PyTorch、MMCV、OpenCV 和建筑矢量化依赖。优先从现有 `building_clip` 环境的已验证版本形成新环境，但不修改原环境；修复 NumPy ABI、`pkg_resources` 和 GDAL/PROJ 变量后，必须验证 CUDA、MMCV 编译算子、模型装载和小 AOI 推理。初始参数使用 `batch=1`，必要时缩小 tile，避免 RTX 4060 Laptop 8GB 显存溢出。

`platform_geo_worker` 承载队列主管和通用 GIS：Python、Supabase 客户端、GDAL、Rasterio、GeoPandas、Shapely、PyProj、OSM PBF 驱动、日志和测试工具。它不加载 CUDA 模型。

两个环境之间通过本机回环地址上的建筑推理服务通信；建筑服务只绑定 `127.0.0.1`，不绑定 `0.0.0.0`，不对学生网络开放。这样模型在服务启动时只加载一次，队列主管可持续处理多个学生任务。若回环服务在实测中与旧 MMDetection 依赖冲突，允许降级为 `platform_geo_worker` 调用 `platform_building_worker` 的 CLI 子进程，但 Supabase 协议和输出格式不变。

明确禁止安装 Microsoft C++ Build Tools（用户所称的 micro building tool）。依赖只使用 Conda 二进制包或已发布 wheel；若关键包只能源码编译，停止并报告具体包和替代方案，不静默安装编译工具。

环境验证后导出精确环境清单到仓库；清单不包含本地路径、密钥和原始数据。

### 4.5 村庄数据目录清单

版本库保存相对路径的数据集清单，例如 `server/config/villages.yaml`；数据根目录由本机 `.env` 中的 `PLATFORM_DATA_ROOT=E:\村规平台学生体验版` 提供。试运行条目为 `mibu`，包含影像、共享 DEM、共享 OSM、允许 AOI 范围、来源日期和模型版本。

Worker 只接受清单内的 `village_id`，把相对路径拼接到已解析的数据根目录，并再次验证最终路径仍在该根目录内。任务请求中的路径字段一律拒绝。

## 5. 三类处理流程

### 5.1 建筑轮廓

1. 依据村庄清单找到教师提供的高分辨率 GeoTIFF。
2. 校验 CRS、波段、有效范围，并按 AOI 裁剪或只读取相交窗口。
3. 分块推理，首轮采用 tile 1536、overlap 384、batch 1；根据显存实测调整。
4. 合并重叠检测，保留置信度字段；执行现有建筑轮廓正则化。
5. 修复无效几何、删除极小碎片、裁剪到 AOI，输出 WGS84 Polygon/MultiPolygon GeoJSON。
6. 记录模型权重哈希、配置版本、阈值、tile 参数、推理耗时和要素数。

学生得到的是“待校核的机器识别结果”，不是最终正确答案。平台保留原始识别分数，学生在个人图层中增删和修正轮廓。

### 5.2 道路与水系

使用本地 `guangdong-260721.osm.pbf`，不在每次任务时调用公共 Overpass API，从而避免免费接口限流和课堂期间网络不稳定。

1. 用 AOI 加适当缓冲裁剪广东 PBF。
2. 道路中心线筛选 `highway=*`，保留主要分类、名称、surface、bridge、tunnel 等教学需要字段；默认排除纯室内/施工等不适用对象，具体白名单写入版本化配置。
3. 水路线筛选 `waterway=river|stream|canal|ditch|drain` 等。
4. 水面筛选 `natural=water`、`water=*`、`landuse=reservoir` 及相关 multipolygon。
5. 修复几何、裁剪到 AOI，分别输出 roads、waterways 和 water_areas GeoJSON。
6. 记录 OSM 快照日期和 `© OpenStreetMap contributors` 署名。

某一 OSM 图层没有要素时，仍输出有效的空 FeatureCollection，并在 run 的 `warnings` 中提示，不让整条任务失败。OSM 不完整处由学生手绘补充；平台应让学生区分“OSM 来源对象”和“个人新增对象”。

### 5.3 等高线

等高线是本项目重点。处理链在服务器自动完成，学生不需要下载整省 DEM 或操作 ArcGIS。

1. 用 AOI 加缓冲窗口从广东 DEM 读取最小必要范围，避免整省重投影。
2. 检查 AOI 是否落在 DEM 覆盖内、有效像元比例是否达标；NoData 过多时直接失败并给出明确提示。
3. 把裁剪 DEM 重投影到适合 AOI 中心的本地 UTM 分区；米埗村采用 WGS 84 / UTM zone 49N（EPSG:32649）。
4. “轻度”模式在等高线生成前对 DEM 做 `sigma=1` 像元的掩膜感知高斯平滑：对数值和有效像元掩膜分别卷积后归一化，再恢复 NoData 掩膜，避免零值/海面向有效区域渗透。“无”模式跳过该步骤，供教学比较。
5. 用 5 米默认等高距生成线；可选 10 米。等高线值字段统一为 `elevation_m`。
6. 生成后只做几何修复和最多 2 米容差的拓扑保持简化，不再叠加会任意移动端点的曲线算法；先保留 raw 结果用于调试，再生成 classroom 结果。
7. 转回 EPSG:4326，裁剪到原 AOI，输出 GeoJSON。
8. 记录 DEM 来源、分辨率、NoData 规则、投影、等高距、平滑参数、有效像元比例和处理时间。

平台必须提示：30m DEM 适合村域总体地形理解，不等于测绘级地形数据；5m 等高线是插值表达，不能承诺 5m 垂直精度。

## 6. 状态、租约和失败恢复

一个 run 的正常状态路径为：

```text
queued -> claimed -> running -> completed
                          \-> failed
queued/running -> cancel_requested -> canceled
```

Worker 领取任务时写入租约，并在运行中续租。Worker 意外退出后，租约过期的任务可以重新入队；每个阶段输出使用 run ID 和确定文件名，上传使用 upsert/校验哈希，保证重试幂等。达到最大重试次数后进入 `failed`，不无限循环。

稳定错误码至少包括：

- `DATASET_NOT_REGISTERED`
- `AOI_OUT_OF_BOUNDS`
- `AOI_TOO_LARGE`
- `SOURCE_RASTER_INVALID`
- `DEM_INSUFFICIENT_VALID_DATA`
- `BUILDING_MODEL_UNAVAILABLE`
- `GPU_OUT_OF_MEMORY`
- `PROCESSING_TIMEOUT`
- `ARTIFACT_VALIDATION_FAILED`
- `UPLOAD_FAILED`
- `WORKER_SHUTDOWN`

某一阶段失败时，不把 run 标记为 completed。已成功的阶段可以保留为诊断 artifact，但网页必须明确显示“任务未完整完成”，且不能自动导入个人图层。

## 7. 安全与资源限制

- 所有任务必须来自已登录用户，`owner_id` 由数据库取 `auth.uid()`。
- AOI 只接受 Polygon/MultiPolygon，限制坐标范围、顶点数、面积和请求体大小。
- `village_id`、步骤和参数使用白名单；拒绝路径、URL、命令和任意 Python 参数。
- Windows Worker 只做出站 HTTPS；建筑服务仅绑定 127.0.0.1。
- service-role key 只存在本机 `.env`，日志统一脱敏。
- 本地工作目录必须位于固定根目录，所有解析路径执行根目录逃逸检查。
- GPU 并发为 1；每用户限制排队任务数；教师可暂停队列或取消异常任务。
- Storage 为私有 bucket；学生只能访问本人 run；教师/管理员按课程角色访问。
- 原始数据和权重不通过浏览器下发。公开教学前另行确认 BIGEMAP/在线影像来源的授权范围。

## 8. 测试与验收

### 8.1 环境级

- 两个 `platform_*` 环境可从导出的清单复建。
- 建筑环境通过 CUDA、MMCV ops、模型装载和小窗口推理测试。
- GIS 环境通过 GeoTIFF/OVR、OSM PBF、重投影、等高线和 GeoJSON 验证测试。
- 安装日志确认未安装 Microsoft C++ Build Tools，且没有源码编译依赖。

### 8.2 处理器级

- 米埗村同一 AOI 可分别通过 CLI 生成建筑、道路、水系和等高线。
- 每个 GeoJSON 为有效 FeatureCollection、EPSG:4326 坐标语义、几何有效且位于 AOI。
- 等高线 `elevation_m` 为等高距整数倍；无跨 NoData 的明显伪线；5m/10m 与 `sigma=0/1` 选项可复现。
- OSM 某类为空时生成空 FeatureCollection 和 warning，不导致整个 run 失败。
- OSM 道路和水系带来源字段与快照日期。
- 建筑输出带分数和模型版本；8GB 显存下 batch 1 不 OOM，若仍 OOM 则能安全失败。

### 8.3 队列与安全级

- 两名测试用户只能查看自己的 run 和 artifact。
- 浏览器不能修改 `status`、`worker_id`、artifact 路径或其他用户任务。
- 两个 Worker 竞争时，同一任务只被领取一次。
- Worker 中断并超过租约后可恢复；重复执行不产生重复 artifact。
- 错误信息不含 service-role key、本地绝对路径或 Python 堆栈。

### 8.4 端到端验收

1. 在另一台电脑打开已部署网页并登录学生账号。
2. 选择米埗村 AOI，提交三类处理。
3. Win11 无需开放入站端口即可领取任务。
4. 网页能看到排队与阶段进度，并最终预览五个逻辑图层：建筑、道路、水路线、水面、等高线。
5. 学生可把结果复制到个人图层，修改后不会影响其他学生或共享基准图层。
6. Win11 Worker 停止时网页显示“服务器离线/等待中”，恢复后队列继续处理。

## 9. 实施边界与迁移

本次试运行包含：两个 Conda 环境、三个处理器、Win11 Worker、Supabase 队列表/RLS/Storage、网页提交和结果加载、测试与操作文档。

本次不包含：Docker/WSL 安装、公开入站 API、学生任意影像上传、多 GPU 调度、自动下载最新 OSM/DEM、全省批处理、生产级高可用和模型重新训练。

Win11 端到端验证成功后，再把 `platform_building_worker` 和 `platform_geo_worker` 固化为 Docker 镜像并部署到 Linux RTX 4090。迁移时保持 Supabase 表、任务状态、artifact 格式和网页接口不变，仅替换 Worker 的运行主机和本地数据根目录。

## 10. 实施顺序

1. 建立两个新 Conda 环境并完成独立 smoke test，不改动现有 `building_clip`。
2. 把三类脚本改造成统一输入/输出契约的 CLI 处理器，并对米埗村 AOI 本地跑通。
3. 建立村庄数据清单、本地配置和工作目录规范。
4. 新增 Supabase DDL、RLS、领取/取消函数、私有 Storage 策略，并用测试账号验证隔离。
5. 实现 Win11 Worker、租约、心跳、状态和上传。
6. 在网页新增提交、状态和结果预览/复制功能。
7. 用另一台电脑完成端到端、断线恢复和安全验收。
8. 导出环境清单和运维文档，为后续 Linux/Docker 迁移准备。
