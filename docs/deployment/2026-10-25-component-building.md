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

新版交付为 `linux/releases/village-components-20261025-r3.tar.gz`，源码a81cde9be1e1e13065acf0ef86311a151f23d5c6，7,882,138字节、230个源文件，SHA256 `68e5d893c775ebf63925ea5a5e15c0ad18d1bc76a0c0d835422c3be2ce391fe3`。本机实际解包及逐文件摘要校验通过；本地linux/tests 440通过/8跳过；精确源码Platform regression 40178892701及Unified native database tests 40178892707均成功（含原生队列/文件/完整历史部署及自身备份恢复）。下载解包必须在上述central releases中，使用非root用户执行 `python3 -B <解包目录>/linux/scripts/component_rollout.py worker --check`。此命令不更新运行服务，但会建立私有预检文件、临时创建并清理不启动的资源检查容器；远程仍待用户执行。

**r3真实预检随后失败，改用r4：** 用户日志为 `unknown flag: --no-deps`；部署脚本错误地将up选项用于create，不是服务器需要升级Docker。r4只删除create中的该参数，保留单服务临时文档、移除依赖/构建、固定旧镜像及不启动容器的资源检查。正式up更新仍保留合法的--no-deps。r3文件及失败日志保留，不要求用户手动改包内源码或重跑旧安装器。

当前交付 `linux/releases/village-components-20261025-r4.tar.gz`，源码c20cc67aa4560a3cb154e833732697c5b8f51b17，7,882,282字节/230源文件，SHA256 `60237ab86e17e6ad7dd7ed047a4be2b4e22d6a6366bede65bd5a16fa5d100014`。本地441通过/9项环境差异跳过；Linux CI 449通过/1跳过，并额外82项Worker/网关兼容测试通过，实际安装的Compose帮助参数契约已执行。Platform40180131306成功。真实4090修正后的预检仍待用户执行，不能据CI宣称部署完成。

同一源码的Unified native database tests40180131264亦成功，保留原生队列/文件隔离、历史部署修复及完整自身备份恢复验证。

**r4真实资源比较随后停在等价表示差异，改用r5：** 用户诊断只返回HostConfig.Mounts（三项相同但顺序不同）和OomKillDisable（null/false）。[Moby默认适配逻辑](https://github.com/moby/moby/blob/v28.5.1/daemon/daemon_unix.go#L351-L354)将未指定的OOM禁用开关设为false。r5只归一这两项，保留完整挂载内容、重复项、读写权限和传播选项，依然拒绝GPU、内存、OOM=true及其他未确认的差异。不更改真实容器参数；若还有差异，预检直接输出字段名（不含命令、环境变量或字段值），然后停止。

当前交付为 `linux/releases/village-components-20261025-r5.tar.gz`，源码ed7568626df79acb4593e03506c5bb0558ee00c1，7,882,641字节、230源文件，SHA256 `faac921650ce9c3495ea2edec2986038f6a274e59a96951952bfb3f6d1fa79ca`。本地451通过/9项环境差异跳过，Platform40181622446成功；实际解包、逐文件摘要与CLI帮助已校验。仍要求用户在4090先运行worker --check，不把此项修正当作真实部署或照片建模成功。

同一源码Native40181622517的数据库/proxy两项亦成功，原生历史部署及完整自身备份恢复兼容检查通过。

**r5真实预检随后发现root保护配置访问失败，改用r6：** 用户诊断精确定位 `/etc/village-platform/compose-mount.yaml`、compose_config第219行、errno13。Python普通用户的Path.is_file预检查早于原有sudo Compose执行。r6仅对实际容器标签提供的路径检查非空/绝对路径，存在性和读取由同一sudo Docker Compose config命令校验；不复制原配置、不改变其权限，也不将整个Python部署器改为root运行。

当前交付 `linux/releases/village-components-20261025-r6.tar.gz`，源码af39f0411ac638d360d10e2c4d57e5d8c56ed929，7,882,865字节、230源文件，SHA256 `2626407916abe450a62a210797553cd6bac342a6a664c89364b065efcda6e3ff`。本地454通过/10项环境差异跳过；Linux CI463通过/1跳过、Worker兼容82项通过，Platform40191092459成功。真实Linux sudo权限回归已执行：只在一次性CI临时目录构造root:root/0700合成配置，普通用户stat报PermissionError，实际sudo Compose正常解析且权限不变；测试代码不进入交付包，不会在4090创建或修改这类夹具。实际解包/逐文件摘要/CLI帮助校验通过；真实4090修正后的worker --check仍待用户执行。

同一源码Native40191092471的数据库/proxy两项亦成功，完整历史部署及自身备份恢复兼容检查通过。

**r6真实ML预检只剩DNS空值表示差异，改用r7：** 用户确认facade-ml的Dns/DnsOptions/DnsSearch当前均为[]、候选均为null。[Moby DNS默认处理](https://github.com/moby/moby/blob/v28.5.1/daemon/container_operations.go#L63-L76)对这三项均按列表长度判断，无显式值时沿用daemon默认。r7只归一这三项的空值，不排序非空列表、不忽略配置值，也不泛化到其他字段。既有配置/容器不修改。

当前交付 `linux/releases/village-components-20261025-r7.tar.gz`，源码2a466a5f2801c24af23f6aac8ef6ead095853c4f，7,882,934字节、230源文件，SHA256 `e1cbb62d5c8d94410bca31b608cf9674b9d0024177251ac03fcbe71d6f732b96`。本地462通过/10项环境差异跳过；Linux CI471通过/1跳过、Worker兼容82项通过，Platform40193066883成功，包含真实Compose参数及root保护配置sudo读取测试。实际解包/全部文件摘要/CLI帮助校验通过。仍先交付真实worker --check，未执行阿里云或4090更新。

同一源码Native40193066880的数据库/proxy两项亦成功，完整历史部署及自身备份恢复兼容检查通过。

交付状态更正：完整r7制品未能推送（8MB HTTP POST被连接重置），不能把本地打包/CI通过当作已公开下载。原生成包保留在本机忽略目录，后续交付改为校验单独的小部署脚本，并通过--source-root复用已校验的r6完整素材/业务源码包；不修改原包。操作器指纹另写入回执，并保留用于恢复的脚本副本。

## 当前交付：小操作器 + 已校验r6原包

真实阿里云KeyError=name发生在网络校验：原compose.json未由Compose展开，网络没有显式name。源码bd09e6c先用sudo Docker Compose config生成rendered副本，仅用于环境/资源及停止候选容器检查；后续备份和API/Web挂载更新仍使用原document，保留Auth的env_file与其他配置，不把展开的Auth环境写回。阿里云admin没有密码，直接运行Python；内部沿用sudo -n docker，不加sudo -v、不放宽权限、不以root运行整个脚本。

操作器仅29,823字节，公开blob为e93c76892ce1a781ae5adfb681b04a6bfea708fc，SHA256 `77bc373ee99d62c54a91354dc5552302ed42b31bb7c186aab43abc0c5782d6ea`，可由GitHub官方API raw媒体类型下载，实际响应字节/摘要/语法已核验。使用 `python3 -B <操作器文件> cloud --source-root <原r6解包目录绝对路径> --check`，不再下载大包、不修改原r6文件，不需要手工注入DNS或其他内存补丁。

--source-root先验证原包完整文件集合及全部摘要，再导入原包辅助模块。输出区分payload_commit与operator_sha256；apply保存操作器副本与指纹，verify要求指纹一致，避免换脚本后误认历史回执。4090操作器必须放在集中根目录deploy/components/operators，state仍在集中目录；镜像仍由既有DockerRootDir管理，未迁移Docker全局存储。

本地465通过/11项环境差异跳过；独立静态复核无重要阻塞，真实r6的230源文件验证及独立操作器/辅助模块导入验证通过。Platform40199208118成功，包含原始网络缺name的复现和修复、真正sudo Compose展开配置且原Auth文件不改的用例。小脚本已经公开，完整r7 archive依然未发布；真实阿里云预检及两端apply仍待执行。

精确源码bd09e6c的Linux CI为475通过/1项条件跳过，Worker兼容82通过；Native40199208178数据库/proxy两项亦成功，包括完整历史部署及自身备份恢复验证。用户仍先在阿里云运行cloud --check，不以此确认生产部署完成。

### 等待裁剪的旧贴图任务保留（当前操作器）

真实阿里云审计确认唯一未结束任务为facade/rectification/awaiting_crop，约54小时未更新、无有效租约、Worker idle。部署器先前将它与运行中任务一起拦截。现在仅对旧texture流程的这种人工确认检查点允许保留；不取消任务、不修改照片/矫正产物。其他非终态及带有效租约的任务仍阻止部署。停止API后再用同一查询检查一次，中途确认裁剪使任务进入排队时会恢复旧API并中止更新。

当前操作器源码`3dda6afb2870c73843cecb9155f322fcb1464b67`，文件`component-rollout-3dda6afb2870.py`，blob `dce6aeb4e62fca698492de7e5cf80e4a13e974bf`；30,745字节、SHA256 `702096d70a39d9129bc496a8e14e6137536ac252d79e0863a8b315f70ad97fe3`。已实际从官方GitHub API下载并核验摘要/语法。继续复用完整r6源包，不改变其230文件和清单，也不重下大制品。

Platform40203360731成功（Linux484通过/1项条件跳过、Worker82通过）；Native40203360729数据库/proxy成功。真实一次性PostGIS测试使用精确旧八函数创建等待裁剪任务，迁移两次后记录及产物完全不变，v2 Worker能在确认裁剪后继续旧贴图流程并读取测试GLB；实际部署查询也覆盖状态/种类/阶段/租约/组件模式的拦截矩阵。整套历史部署/自身备份恢复亦通过。这些测试不等于生产已升级，更不等于4090真实照片效果验收。

在阿里云以原admin身份直接运行（不用`sudo -v`）：`python3 -B "$HOME/village-component-releases/operators/component-rollout-3dda6afb2870.py" cloud --source-root "$HOME/village-component-releases/village-components-af39f0411ac6" --check`。无其他变化时预期`component_cloud_preflight_passed`、`preserved_awaiting_crop: 1`。两端apply及真实照片验收仍待执行；4090镜像仍由原DockerRootDir管理，其存储边界需在构建前明确。

2026-10-26实际进度：用户返回上述云端预检成功，随后同一脚本及r6源包cloud --apply与--verify均成功，API/Web更新及数据库保留状态已通过回执检查。4090仍未apply，真实照片/旧贴图回归尚未验收。其新代码/日志/临时文件继续集中在newapply/village-platform；镜像库仍在/var/lib/docker，按用户集中存储要求先只读审计迁移体量与其他容器影响，不能默许新镜像继续写系统盘或未经批准全局迁移Docker。

### 4090下载403后的Worker专用操作器

现场进一步确认：Docker实际目录du -x约92G，runtime仅1.3G且在newapply；本轮沿用现有Docker目录不迁移，保留约18G系统盘余量的开始前检查。宿主机与旧Worker都为Blender3.0.1，构件代码仅验证3.6且使用3.0缺少的材质节点，所以新版镜像增加3.6.23而不改宿主机版本。

首次实际Worker构建在Blender官方下载返回HTTP403时停止，Pillow安装已成功，无receipt，两个服务仍为旧镜像running。新的Worker操作器`component-worker-rollout-d1d347a04700.py`（源码d1d347a0470054064393d3b761790fd75b203b74、blob dcfbd6581bf0db01a39b06e4485285a8bc351788）为36,842字节，SHA256 `ad76f5c899a8bbd3e76dbbc02e8b9642dc0be0fb61faa782b3c8c447e99ebdf7`，已实际由GitHub API下载核验。

它继续读取原r6的230文件及清单，不修改原包或helpers。在集中state/downloads下载固定3.6.23归档，官方源403/断流时使用Aliyun/NJU固定HTTPS备用源；要求长度272819000且匹配原官方SHA，错误内容和未完成文件绝不进入构建。校验后生成state/worker-build-context，只复制两个已验证代码子树和归档；把已知旧Dockerfile的三条网络下载语句替换成本地ADD，自动解压到原预定/opt/blender-runtime。完整包可复用，失败只清理本次临时.part；损坏的既有缓存拒绝保留以供核查。

精确源码Platform40262234399成功：Linux491通过/1项条件跳过、Worker82通过，包括真实Docker无网络本地ADD解压及可执行权限验证；Native40262234382数据库/proxy及完整部署/自身备份恢复成功。本地480通过/12跳过、JS1122通过；真实官方完整归档原固定SHA通过，真实r6离线上下文为100文件且原清单不变。独立静态复核无重要阻塞。真实4090尚需用新Worker脚本重新check/apply/verify，不能据这些检查宣称新服务已上线。

**回执分离：**已完成的阿里云继续使用`component-rollout-3dda6afb2870.py`及原指纹；新脚本只用于`worker`。其源码路径仍为linux/scripts/component_rollout.py，但不能用新指纹去验证旧云端回执。metadata的`operator`保留云端旧版本，`worker_operator`单列本次补丁；无需重新下载8MB源包或重新执行云端apply。

### 当前Worker操作器：非root权限与包路径修复

用户运行上述d1版本后，完整包下载及候选Worker镜像构建已成功（4e926e635ca5aeec207ba2a5ca6ec3363da1dba5702202ba8a6a704272465e81），但adapter导入检查失败，尚无receipt，旧服务未变。私有上下文0700目录经普通COPY会归root，且namespace rural根可输给继承regular package，必须补足非root导入验收。

当前Worker脚本为`component-worker-rollout-1f139ed48fa2.py`，源码1f139ed48fa297237686c40493b3a1a846534599，blob a70877891603582ac946c32e7e78a2004082d42b；38,693字节、SHA256 `37e4eacec6b44eefe0a001cb3bea124169ce3a6680ca2be27a648655058ff47d`，已实际从GitHub API下载校验。继续复用原r6和已验证的完整Blender下载缓存，不重新下载；生成worker-build-context-v2（101文件）保留原失败v1。Worker和ML共享只含已验证backend/服务代码、固定包及生成marker的上下文，numeric COPY --chown10001:10001保证运行用户可读，显式rural根包防止旧包优先加载；不放宽宿主机私有目录、不修改原r6或云端。

导入smoke使用原容器User，并断言adapter/ML模块__file__来自/opt/village-components，仍在receipt和替换服务之前。Platform40265443871成功（Linux494通过/1项条件跳过，Worker82通过），包含真实Docker以UID10001、只读rootfs、无网络导入固定Worker/ML，以及分别撤销owner/根marker/两者组合复现导入失败的回归。Native40265443944数据库/proxy、完整部署及自身备份恢复成功。独立复核无重要阻塞，真实r6原230文件再次通过清单。真实4090仍需用当前脚本重新check/apply/verify及照片验收，不能把候选镜像构建成功或CI通过当作生产已替换。

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
