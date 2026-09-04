# 本地 V0 数据处理工具、后台改版与 SQL 治理设计

日期：2026-09-03

状态：待用户最终审阅

## 1. 目标

在不新建 Conda 环境的前提下，为管理员提供一套可在
`E:\村规平台数据处理工具` 启动的本地一键式数据处理工具。工具统一完成建筑、道路/水系、等高线与平台影像的生产，输出可由管理员后台手动导入的标准 V0 数据包。

同时重做后台“村庄与项目”页面，治理 Supabase SQL Editor 中的未命名、重复和危险历史查询，并完整保留学期中期发布 Cesium 实景模型的能力。

## 2. 已确认的现状

- 建筑推理环境为 `E:\anaconda3\envs\platform_building_worker`。
- 通用 GIS 环境为 `E:\anaconda3\envs\platform_geo_worker`。
- 建筑权重、配置和示例影像位于 `E:\村规平台数据处理工具\建筑矢量`。
- 广东 OSM PBF 位于 `E:\村规平台数据处理工具\道路、水系`。
- 广东哥白尼 DEM 位于 `E:\村规平台数据处理工具\等高线`。
- 道路、水系和等高线处理器已经存在于仓库 `server/src/village_processing`。
- 建筑服务曾在 2026-07-23 成功启动并完成推理；当前环境冷启动导入超过 90 秒没有输出，需要用分段健康检查定位具体卡点，禁止无上限等待。
- 平台当前只读取 `village-datasets` 私有存储中的资源路径；现有后台只能读取一份已经写好存储路径的 JSON，不能上传本地成果文件。
- Supabase SQL Editor 有 33 条私人查询，其中 16 条未命名；已确认 4 条是重复副本。

## 3. 总体架构

### 3.1 用户看到的一套工具

在 `E:\村规平台数据处理工具` 中提供一个可双击的启动入口。启动器负责：

1. 检查两个既有 Conda 环境、模型、OSM 和 DEM。
2. 启动仅监听 `127.0.0.1` 的本地数据处理向导。
3. 启动建筑推理服务，并设置明确的启动超时与可读错误信息。
4. 在浏览器中打开本地向导。

管理员只操作一套界面；内部仍保持两个环境隔离，避免 CUDA/MMDetection 与 GDAL、SciPy、GeoPandas 依赖互相破坏。

### 3.2 代码与数据边界

- 可测试、可维护的核心处理代码继续保存在当前平台仓库的 `server` 目录。
- `E:\村规平台数据处理工具` 保存大体积源数据、处理任务、输出数据包、日志和启动入口。
- 启动器通过明确的仓库路径加载处理代码；路径集中写入一个本地配置文件，禁止散落硬编码。
- 原始影像、DEM、PBF、模型权重、处理结果和密钥不提交 Git。

## 4. 本地处理向导

### 4.1 输入

管理员填写或选择：

- 村庄名称；
- 村庄边界 GeoJSON，或含 `.shp/.shx/.dbf/.prj` 的 Shapefile ZIP；
- 卫星影像 GeoTIFF；
- 建筑识别阈值，默认 `0.35`；
- 等高距 `5m` 或 `10m`，默认 `10m`；
- 等高线平滑“无”或“轻度”，默认“轻度”。

边界统一转换为 EPSG:4326，并作为三类处理的共同 AOI。OSM、DEM、模型配置和权重由工具自动发现，不要求管理员重复选择。

### 4.2 处理步骤

1. 校验边界、影像 CRS、波段、源数据覆盖范围和可用磁盘空间。
2. 按 AOI 裁剪卫星影像，调用建筑环境识别并规则化建筑轮廓。
3. 按 AOI 从广东 PBF 提取道路、水路线和水面。
4. 按 AOI 加缓冲裁剪广东 DEM，生成并裁剪等高线。
5. 从卫星影像生成浏览器和 Cesium 可显示的 WebP 影像。
6. 校验所有 GeoJSON、坐标范围、几何、要素数、文件大小和 SHA-256。
7. 生成数据包目录及 ZIP 备份。

每一步显示 `等待、运行、成功、警告、失败` 状态。建筑服务启动、模型加载和单次推理都设置独立超时；失败时保留日志，但界面不无限等待。

### 4.3 输出数据包

数据包目录格式：

```text
<村庄名称>_V0_<时间>/
  manifest.json
  boundary.geojson
  imagery.webp
  buildings.geojson
  roads.geojson
  waterways.geojson
  water_areas.geojson
  contours.geojson
  validation.json
```

`manifest.json` 使用平台图层类型：

- `building`
- `road`
- `water`
- `contours`
- `imagery`

水路线和水面可作为独立文件保留，但在平台清单中统一归入水系资源，加载端按清单声明组合。清单不包含本机绝对路径，只包含包内相对路径、要素数、范围、来源、参数和哈希。

工具同时生成 ZIP 作为归档。后台导入使用数据包文件夹，避免浏览器在内存中解压大 ZIP。

## 5. 管理员后台页面

“村庄与项目”改成一条清晰的 V0 主流程，并保留独立的中期 3D 模块。

### 5.1 步骤一：创建村庄

- 村庄名称；
- 是否为练习村庄；
- 大致边界文件；
- 默认坐标系放入高级选项，默认 EPSG:4326；
- 创建成功后自动选中该村庄并进入第二步。

### 5.2 步骤二：导入本地 V0 数据包

- 选择目标村庄；
- 通过文件夹选择器导入完整数据包；
- 在上传前显示建筑、道路、水系、等高线、影像的文件状态、要素数和校验结果；
- 校验通过后，将文件逐项上传到私有 `village-datasets` bucket；
- 上传路径使用不可冲突的批次前缀，不允许覆盖已发布版本。

### 5.3 步骤三：校验、发布和绑定

- 显示 V0 版本、来源、上传时间、文件数和验证摘要；
- 建筑图层必须非空；
- 管理员发布 V0 后才能绑定为本学期正式村庄；
- 正式村庄绑定并开放后自动出现在首页和工作区；
- 发布操作保留二次确认。

### 5.4 学期中期：Cesium 实景模型

该模块不并入 V0 发布条件，也不替换二维建筑白模。保留并优化以下字段：

- 所属村庄；
- Cesium ion Asset ID；
- 模型标题；
- 高度偏移；
- 是否保存后立即发布。

界面显示草稿/已发布状态和当前 revision。新 revision 发布后，进入对应村庄 3D 页面时独立加载；失败时继续显示白模，不影响二维数据。

### 5.5 视觉结构

- 顶部显示当前教学项目和正式村庄绑定状态。
- V0 三步使用步骤导航和紧凑表单，不再把所有控件挤在同一横向工具栏。
- 每张卡片采用明确的标题、状态标签、输入区和操作区。
- 数据准备用五行资源检查表展示影像、建筑、道路、水系和等高线。
- Cesium 实景模型作为页面底部独立卡片，并标注“可在学期中期补充”。
- 桌面端控制主内容宽度，移动端改为单列；说明文字不再悬在卡片边缘。

## 6. Supabase 存储与数据库

新增或确认私有 bucket `village-datasets`：

- 只有管理员可上传、更新未发布批次和删除失败批次；
- 已登录且具备项目访问权的用户通过短时签名 URL 读取当前已发布数据集；
- 存储路径形如 `<village_uuid>/<upload_uuid>/<filename>`；
- 数据库 `layer_manifest` 只保存 bucket 内相对路径，不保存任意 URL；
- 上传中断时不创建 ready 数据集；文件齐全且校验通过后才调用 `save_village_dataset_draft`。

本次不允许浏览器覆盖已发布 V0 文件，也不允许删除历史已发布版本。

## 7. SQL Editor 治理

### 7.1 未命名查询

将有用查询按用途重命名：

- `MIGRATION - Group Model Library`
- `MIGRATION - Enable Personal Contour Delete`
- `MIGRATION - Secure Planning Space Visibility`
- `MIGRATION - Personal Figure Ground Spaces`
- `MIGRATION - Task-driven Course Workbench`
- `MIGRATION - Geoprocessing Worker Queue`
- `STORAGE - Allow GLB MIME for group-models`
- `TEST - Register personal GLB model (ROLLBACK)`
- `DIAG - Group model asset counts`
- `OPS - Resume geoprocessing queue`
- `OPS - Worker heartbeat status`
- `OPS - Pause and inspect geoprocessing queue`

删除 4 条重复副本：Group Model Library 1 条、Personal Contour Delete 2 条、Secure Planning Space Visibility 1 条。删除保存的查询不会回滚数据库对象。

### 7.2 历史危险查询

`Remove photo tables and associated RLS policies` 与当前仍在使用的 `object_photos` 冲突，不得再次执行。优先删除该保存查询；如果用户要求保留，则改名为 `ARCHIVED - DO NOT RUN - Remove legacy photo tables`。

其余早期零散 SQL 保留但按 `LEGACY`、`MIGRATION`、`OPS`、`DIAG` 分类。仓库新增 SQL 索引文档，说明当前基线、增量迁移、运维查询和废弃脚本的用途与顺序。

任何 Supabase 查询删除都在执行前列出准确目标并再次取得用户确认。

## 8. 错误处理

- 环境或数据缺失：启动页直接列出缺失项和准确路径。
- 建筑服务冷启动：分阶段报告 Python、Torch、MMCV、MMDetection、模型加载状态；达到超时即停止并保留日志。
- AOI 超出影像、OSM 或 DEM：在处理前阻止运行。
- 单个 OSM 图层为空：输出合法空 GeoJSON 并显示警告，不让整个数据包失败。
- 建筑为空：数据包可留作诊断，但后台不得标为 ready 或发布。
- 上传中断：记录失败批次，允许重试缺失文件，不覆盖成功文件。
- 数据包哈希不符、文件缺失或含绝对路径：后台拒绝导入。

## 9. 测试与验收

- 两个既有环境的限时健康检查。
- 边界 GeoJSON 与 Shapefile ZIP 的安全校验。
- 道路、水系、等高线处理器单元测试和小 AOI 集成测试。
- 建筑服务分阶段启动诊断及小影像推理测试。
- 数据包生成、哈希、相对路径和缺失文件测试。
- 后台数据包验证、上传失败恢复、清单生成和发布门禁测试。
- Storage RLS：普通学生不能上传，管理员能上传，获准用户只能读取已发布项目资源。
- 后台桌面端和移动端视觉检查。
- Cesium 中期模型发布后加载，白模仍可独立显示。
- 全量前端、Node 和 Python 回归测试。

## 10. 非目标

- 不创建新的 Conda 环境。
- 不把整省 DEM、OSM、模型权重或原始 GeoTIFF 上传 Supabase。
- 不让在线网页直接执行任意本地命令或访问任意本地路径。
- 不自动发布数据集或自动绑定正式村庄。
- 不让中期实景模型成为 V0 发布前置条件。
- 不提交 Git。
