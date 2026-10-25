# 本地构件建模接入与部署验收

本次在原项目 main 接入，保留原照片贴图方式。独立 `E:/Blender生成模型Demo` 未修改，模型权重、照片和 SQLite 数据库未复制。新增链路没有大模型 API 调用。

## 平台内使用

从地图选中建筑，打开原来的“乡村建筑3D生成器”，选择“本地构件建模”。

- 还原村庄现状：读取并锁定源白模正面长度/进深；上传或选用实拍图，工作站清理遮挡并矫正透视，保留屋顶。核对层数和屋顶数量后生成。
- 新建/改建：上传完整标准正立面；跳过清理及透视校正。长度/进深默认继承白模，可以修改。
- 墙高 = 源正面长度 × 墙身像素高度 / 墙身像素宽度（相同矫正图坐标系），不采用原默认9m。屋顶作为独立几何保留。
- 预览后应用，仍走原有模型库上传、轻量版本、绑定与保存确认；新资产不覆盖或删除原模型文件，原资产可从模型库重新选择。白模仅保留源矢量和属性，不另导出一份白模GLB。
- 同一任务轮询不重置正在编辑的改建尺寸；不同任务/生成版本会恢复各自参数。可取消当前任务再换图/换方式。

主体采用当前矩形连续体块生成器。现状模式不接受明显不规则占地（矩形程度<0.98）或内院孔洞，不能把它们静默填成矩形。朝向按源占地轴线对齐，模型库归一化引起的中心偏移会补偿。对门廊、隐藏立面、屋顶组合等仍保留原本本地路线的质量边界，任务完成不代表照片还原验收通过。

## 实际运行分工

阿里云 API/数据库：认证、任务、不可变照片与GLB文件、模型资产/绑定。4090工作站：已有 facade-ml 的 DINO/SAM2 和遮挡清理、已有 facade-worker 调用 Blender。没有浏览器直连工作站或Windows本地端口。

新增 `/components` 为工作站内部ML接口，复用已加载权重和原共享GPU锁。清理遮挡掩膜扣除识别出的空调/栏杆/檐口/柱掩膜；保护依然依赖检测结果，不保证所有遮挡均能正确修复。改建标准图完全不调用该清理链路。

本次迁入 DINO/SAM2、像素分析、固定构件与材质生成；未启用独立 Demo 的可选 DINOv2 六样例检索库和 DepthAnything 相对深度模块。GLB 携带 PBR 贴图，网页沿用平台预览灯光；Blender 的环境和后处理不会自动随 GLB 导出。

构件生成要求 Blender **3.6.x**，部署镜像固定 **3.6.23**。旧镜像固定3.0.1不能直接运行此生成器。新Worker只有在本地Blender版本与ML端点版本检查通过时才发送 `facade-aliyun-local-v2` 心跳；旧v1Worker只能领取旧贴图任务。网页检测不到新版能力时明确提示，避免误走旧流程。

## 更新顺序（尚未在真实服务器执行）

### 用户返回现场后的接续

2026-10-25 用户已确认云端API `73d6c74`、网页 `35b34a1`、PG `291367a`，网页当前挂载 `single-personal-20261024-v1/web`。4090的Worker `0cac700` 来自newapply目录与campus overlay；ML `623ffb0` 来自 `/opt/village-storymap` 与 `/etc/village-platform/compose-mount.yaml`。两套配置分别渲染、校验，禁止直接用上文同一个Compose命令覆盖二者。

补充的 `component_rollout.py` 使用摘要固定代码包，提供 cloud/worker `--check`、`--apply`、`--verify`。cloud复制当前网页覆盖层，在现有API镜像上只读挂载六个更新文件；SQL要求八个函数精确匹配已知旧/新版本，更新前做自身备份。所有新云端代码、网页和回执留在runtime的files目录，后续原备份会覆盖。worker分别保留原始完整渲染配置，并构建继承实际镜像的覆盖镜像；只额外安装固定Pillow及Blender3.6.23，不重装视觉模型。

`--check` 不替换运行服务或更改业务数据，但会临时创建**不启动**的配置检查容器，并清理这些检查容器；用Docker实际生成的配置检查GPU、内存、PID、健康检查等资源没有漂移。配置包含私密环境变量，只保存在本机0700目录/0600文件，不输出内容。摘要包不包含这些文件。apply中途失败保留回执与日志，需要检查后处理，不把不完整状态当作成功或盲目重做。

这两端脚本仍需用户实际执行并返回结果。下文旧通用步骤作为实现背景保留，不应替代上述现场更新入口。

### 4090目录审计与本次路径约束

用户2026-10-25实际检查确认：`/opt/village-storymap` 是newapply/village-platform/repo的bind mount；`/srv/village-platform/{data,models}` 与 `/var/lib/village-platform/runtime` 也是同一集中根目录的bind mount。原有集中存储已成功，无需重复迁移。

后续部署出现另一份独立代码 `/media/gpu332/newapply/village-storymap`：分支2026-0926、HEAD6f4bbcb，包含大量未提交Docker部署变更；原repo为codex/local-basemap-facade-release、HEAD8c2719e且干净。当前geo/facade Worker（10月23日）与本地web（10月8日）引用另一份代码的Compose，building/ML/LaMa（10月10日）引用原repo兼容路径的Compose。这是同一个Compose项目的混合历史部署，不是两套重复的数据或权重。任一checkout均不直接pull/reset/覆盖/删除。

**旧r2的Home下载与状态目录命令撤回。** 新版worker入口只接受位于 `/media/gpu332/newapply/village-platform/deploy/components/releases/` 内的摘要固定包；私有状态、配置、回退材料、日志与操作临时目录位于 `deploy/components/state/<源码commit前12位>/`。不改两个旧checkout和既有bind mount。原 `~/village-campus-autonomous/.operator-operation.lock` 继续参与互斥，避免与旧管理工具同时更新；它是已存在的兼容入口，不另在Home创建代码或日志目录。

Docker daemon的 `DockerRootDir` 仍为 `/var/lib/docker`，实际位于NVMe的/var分区（用户检查剩余18G），不随源码下载位置改变；newapply剩余134G。预检输出真实daemon目录及可用字节数，Docker不足8GiB或集中目录所在盘不足1GiB时拒绝继续。这是最低余量检查，不是构建峰值保证。新增镜像层仍由既有daemon管理；没有把Docker整体迁移到newapply，不做全局prune、重启或影响Open WebUI等其他服务。Images95.99GB和Build Cache42.49GB含共享层，不可直接相加推算迁移空间。

目录整改只完成本次新增材料的集中化；历史 `village-storymap` 与Home overlay尚在使用，后续归并需保存其独有修改并验证配置等价，不能声称已经全部清理完成。

本机没有当前服务器SSH连接配置，也没有在本轮取得远端身份/容器检查结果。以下为同一审阅版本的部署步骤，不代表已上线。不要运行旧的迁移/恢复数据库程序，不要重建已有表。

1. 将本次审阅代码通过项目既有发布途径交付到阿里云和4090；核对两端commit。阿里云按现有发布方式构建包含新版 `business-api`、`features/data` 和 `rural_house_generator` 前端的发布产物。保留现有deployment-config的阿里云覆盖配置。
2. 在已有阿里云业务数据库事务中执行 `linux/sql/component-building.sql`，只替换既有函数，不恢复数据、不删除表。先核实数据库、备份和函数版本与本次main一致；不要把本机测试结果当成生产数据库验收。
3. 4090从运行中的容器取得现有精确镜像ID：

   ```bash
   export COMPONENT_WORKER_BASE=$(docker inspect --format '{{.Image}}' village-platform-facade-worker-1)
   export COMPONENT_ML_BASE=$(docker inspect --format '{{.Image}}' village-platform-facade-ml-1)
   export COMPONENT_RELEASE=$(git rev-parse HEAD)
   ```

   容器名必须先用 `docker compose ps` 核实，不能按示例误操作其他服务。目录以实际运行位置为准；仓库旧说明记录 `/media/gpu332/newapply/village-storymap`。

4. 在**原来完整的Compose调用**中最后追加 `-f linux/compose.components.yaml`，构建 `facade-worker facade-ml`，再仅更新这两个服务。保留原环境文件、阿里云Worker密钥挂载、网络、模型缓存、runtime路径和共享GPU锁；不重启building/geo-worker/数据库/LaMa。不要只用该overlay单独启动新项目。

   构件Worker构建时从Blender官方下载3.6.23并校验SHA256；约数百MB，不下载新的DINO/SAM权重。ML镜像复用当前CUDA/PyTorch环境，无新依赖安装。两个overlay显式使用 `/opt/village-components` 工作目录，避免继承 `/app` 时优先导入旧后端。

5. 核实Worker内 `BLENDER_EXECUTABLE --version` 为3.6.23、ML内部 `/health` 含 `components_version:1`，阿里云页面显示新版构件能力可用。若未更新好，原照片贴图仍可用。
6. 使用一栋已知建筑跑实拍现状和标准图改建各一次：检查完整屋顶、保护构件、长宽/高度、模型落位、任务取消/恢复、GLB下载、应用后刷新恢复、原模型资产仍保留。再复测原贴图方式。

SQL升级兼容v1贴图Worker；上线前暂停新增构件任务并排空当前任务。回退时同样先停止新增构件任务，保留所有产物和数据库记录；不能让旧Worker领取构件任务。

## 本机验证与限制

- 2026-10-25 最终本机验证：`node scripts/test.mjs` 1122项、`node --test business-api/test/*.test.mjs` 136项、相关Python/部署契约测试153项全部通过。Python覆盖backend全部测试、facade models/worker/cli/gateway、local gateways以及deployment contract/local worker overlay/component deployment。
- 真实本机Blender3.6.23运行：迁入的固定生成器及完整Worker生成服务能导出带材质的Draco GLB。
- 使用旧Demo已保存的结构参数验证编译器：13,500三角面、2个拱窗、屋顶闭合、承托检查无遗漏；原导出3,810,296字节，512像素纹理预算后405,332字节。此项**没有重新识图**，不证明4090上的真实照片识别或整体还原质量。
- 纹理压缩保留几何/UV/材质引用；小于预算且重新编码反而变大的贴图保留原字节。复杂模型不能保证全部小于1MB。
- PostgreSQL/PostGIS原生集成用例已补充，但本机便携PostgreSQL缺少PostGIS，尚未执行该用例。没有生产迁移、Docker构建、真实4090端到端或真实网页操作验收，不能宣称线上可用。
