# 构件建模真实部署接续

> 按 executing-plans 在当前会话内执行。用户已授权部署，由本人在两端终端执行命令，不要求提供SSH密钥。

**Goal:** 为已提交 d595b35 提供符合真实双Compose现场的可校验交付及独立更新入口。

**Spec:** 2026-10-25-component-building-design.md；保持现有阿里云个人空间修复层与4090配置、密钥、权重和其他服务。

**现场:** 云端API73d6c74、网页35b34a1、PG291367a；网页single-personal-20261024-v1。4090 Worker0cac700来自newapply+campus overlay；ML623ffb0来自/opt+compose-mount，两者不能合并假设。

**决策:** 云端在当前镜像上挂载少量已验证API文件并复制当前网页覆盖层，保留原冻结镜像、环境及原文件。SQL仅替换精确已知函数体，未知版本拒绝；保留完整自身备份。4090分别渲染各自原配置，校验与实际容器一致后构建继承镜像的覆盖层，只替换两项服务。

- [x] Task 1：先写失败测试，覆盖双配置、密钥挂载、未知函数体拒绝、参数及资源保留、公开输出不泄密；实现纯部署规划函数。
- [x] Task 2：实现cloud/worker --check/--apply/--verify命令；保存私有配置、回退文件与回执；失败保留现场，不自动重跑不确定变更。
- [x] Task 3：提交并运行本地/原生CI，生成只含已提交代码及素材的摘要固定包；不含env、模型权重、数据库或照片。
- [ ] Task 4：给用户两端预检命令，依据真实输出继续apply和端到端验收。用户执行前不能标记上线完成。

## 本地验证与复核

- Linux测试435通过、7项平台差异跳过；JS1122、API136通过。
- 复核的依赖、sudo环境传递、资源预检和ML冷启动等待四项问题均补失败测试后修正；未派生其他实现任务。
- 真实配置预检使用停止状态候选容器；不启动模型或读取密钥内容。
- 更新包实际解包后229个文件摘要通过；源码ad14814。云端/4090更新尚待用户执行，不标记完成。

- 精确源码ad14814的Platform 40174621374及原生数据库40174621254全部成功；新构件队列迁移/隔离、旧任务死锁回放、完整历史部署修复及自身备份恢复均通过。真实两端执行仍待用户。

## 4090集中目录补充（用户现场核实后）

Ruling: 保留已生效的bind mount与两套历史Compose，不覆盖任一旧checkout、不迁移Docker全局目录。用户已证明repo/data/models/runtime实际位于newapply/village-platform；后续10月8日本地Docker部署及10月23日Aliyun Worker更新引用另一checkout，不能当成废弃副本。

Ruling: 本次新增源码包、私有状态和操作临时文件只允许放在 `/media/gpu332/newapply/village-platform/deploy/components/`。继续取得既有campus操作锁以免与旧管理器并发；该旧锁不迁移，不向Home另建发布或日志目录。Docker镜像层由既有daemon存储，当前在/var；不得宣称改源码路径就能迁移镜像。

- [x] Task 5：先补路径越界/旧目录不动/磁盘余量失败测试；实现集中目录约束及Docker真实落盘位置预检。
- [x] Task 6：本地回归、实际解包校验并更新交付说明。旧r2的Home部署命令撤回；只交付新包预检，真实apply与照片验收仍待两端执行。

现场：canonical repo分支codex/local-basemap-facade-release、8c2719e、干净；另一checkout分支2026-0926、6f4bbcb且有大量本机修改。geo/facade Worker及本地web引用后者；building/ML/LaMa引用/opt兼容入口。/var剩余18G、newapply剩余134G，Docker Images报告95.99GB、Build Cache报告42.49GB（共享层不可直接相加）。其他容器含Open WebUI，禁止全局prune或随意重启Docker。

路径修正本地验证：linux/tests 440通过、8项平台差异跳过（含新增POSIX symlink约束）。四项新增测试先因缺少路径规划/磁盘预检而失败，再通过。最终复核发现sudo默认清理TMP环境；追加实际Docker.run子进程边界失败测试后，Docker可选temporary参数通过sudo后的env命令显式传递三个临时路径，其他旧操作默认命令不变。未执行任何远程变更。

r3发布：精确源码a81cde9，Platform40178892701与Native40178892707成功；实际解包230个文件摘要及CLI帮助通过。制品SHA68e5d893c775ebf63925ea5a5e15c0ad18d1bc76a0c0d835422c3be2ce391fe3，7,882,138字节。Task4真实两端预检/apply及真实照片验收继续待用户返回，不以本地路径修正替代远程部署。

## 真实r3预检失败：Compose create选项

用户返回唯一非空日志 `unknown flag: --no-deps`。原因是预检create命令错误使用up的选项；非用户服务器故障，不要求升级Docker。只删除create中的该选项：临时文档原本就只保留一个服务、移除depends_on/build、固定现有image并复用外部网络，依然不启动或重建业务服务。新增回归先复现同一报错；另在有Docker CLI的环境读取真实create --help验证生成命令的选项，CI必须执行，Windows无CLI可跳过。

r4本地441通过/9跳过，Linux CI449通过/1跳过（真实Compose CLI契约未跳过），Worker兼容82项通过，Platform40180131306成功。源码c20cc67，包实际解压230源文件摘要及CLI帮助通过；7,882,282字节，SHA60237ab86e17e6ad7dd7ed047a4be2b4e22d6a6366bede65bd5a16fa5d100014。没有远程替换现有容器。

同一源码Native40180131264的数据库与proxy两项亦成功，更新材料仅增加新的r4包，不覆盖r3或其真实失败状态。

## r4真实资源差异：只修正已证明的等价表示

用户诊断返回仅两处：HostConfig.Mounts三项完全相同但顺序不同；OomKillDisable为null/false。Moby v28.5.1 daemon/daemon_unix.go的adaptContainerSettings明确将未指定OomKillDisable设置为false。比较快照仅排序完整Mounts条目（保留权限、传播选项和重复项），将这个特定字段的null/缺省归一为false，不修改原配置或运行容器。

新增真实预检入口回归先复现资源差异拒绝，再验证等价通过；源路径、只读权限、传播选项、重复挂载、GPU数量、内存、OOM=true、其他默认字段变更依然拒绝。差异拒绝时自动公开输出资源字段名，不输出字段值/命令/env，减少再次手动注入诊断的需要；未知字段的缺省/缺失差异仍严格保留。

r5源码ed75686，本地451通过/9跳过，Platform40181622446成功；实际解包230个源文件、逐文件摘要与CLI帮助校验通过。7,882,641字节，SHAfaac921650ce9c3495ea2edec2986038f6a274e59a96951952bfb3f6d1fa79ca；真实两端更新继续待执行，不改写r4预检失败的历史记录。

Native40181622517的数据库及proxy两项亦成功，包含完整历史部署/自身备份恢复；r5只修正比较表示并补诊断，没有部署到真实4090或阿里云。

## r5真实权限失败：普通用户stat了root保护配置

用户Permission诊断定位compose_config第219行，路径 `/etc/village-platform/compose-mount.yaml`、errno13。此前普通用户Path.is_file()过早检查了受保护路径；后续sudo Docker Compose尚未获得执行机会。修正仅校验实际容器标签提供的路径为非空绝对路径，存在性/读取交由原有sudo Compose config命令校验。不复制配置、不修改原权限、不让整个Python部署器以root运行。

回归先复现PermissionError；另覆盖缺失/相对路径拒绝。新增仅限一次性Linux CI的真实权限用例：临时目录下构造root:root/0700的合成配置目录，证明普通用户stat被拒绝，实际sudo Compose可读取并渲染，且受保护目录权限保持不变；只恢复该临时夹具的所有者以便CI清理。该权限操作不会在真实4090运行。

r6源码af39f04，本地454通过/10跳过；Linux CI463通过/1跳过（真实root保护权限回归已执行），Worker兼容82项通过，Platform40191092459成功。实际解包230源文件摘要/CLI帮助校验通过，7,882,865字节，SHA2626407916abe450a62a210797553cd6bac342a6a664c89364b065efcda6e3ff。生产预检/apply仍待用户，不把临时CI夹具的成功当成远程服务更新。

Native40191092471的数据库与proxy两项亦成功，包含完整历史部署及自身备份恢复兼容验证。r6制品仍先交付真实worker --check，不执行远程apply。

## r6真实ML预检DNS空值表示差异

用户确认仅facade-ml的HostConfig.Dns/DnsOptions/DnsSearch为当前[]、候选null。Moby v28.5.1 daemon/container_operations.go buildSandboxOptions对三项均用len>0判断，否则沿用daemon默认配置。快照比较仅把这三项的null/缺省归一为空列表；不排序、不抹去任何非空DNS覆盖值，不泛化到其他字段。原运行配置和容器不修改。

新增回归先完整复现三项拒绝，再覆盖默认等价通过、DNS地址/选项/搜索域更改及其列表顺序更改仍拒绝、其他字段null/空列表差异仍拒绝，确保不把实际解析配置变化静默放行。

r7源码2a466a5，本地462通过/10跳过；Linux CI471通过/1跳过、Worker兼容82项通过，Platform40193066883成功。实际解包230源文件摘要/CLI帮助验证通过；7,882,934字节，SHAe1cbb62d5c8d94410bca31b608cf9674b9d0024177251ac03fcbe71d6f732b96。额外核对旧2670bc1 Worker的LocalTaskHTTP构造/身份方法签名与共享GPU锁路径，未改变这些调用。真实预检/apply继续待用户，不以CI通过代替生产部署。

同一源码Native40193066880的数据库/proxy两项亦成功，包含完整历史部署及自身备份恢复兼容验证。保留r6及其失败日志，r7仍先进行实际4090预检。

## 4090真实预检已通过，阿里云仍待检查

用户在4090使用已校验r6（af39f04）及进程内DNS空值归一化后，返回component_worker_preflight_passed、separate_compose_configs=true。原Worker0cac700及ML623ffb0均running，原配置/鉴权/共享GPU锁检查通过；没有实际构建或替换服务。集中目录可用141143511040字节；现有DockerRootDir=/var/lib/docker、可用19396202496字节，仍在集中目录之外；没有迁移Docker全局目录。

r7源码2a466a5及CI已公开，但完整制品发布提交621dec1尚未推送成功：HTTPS POST在7887522字节请求上被连接重置；分块/非分块的有限重试均失败。不能给用户不可下载的r7制品URL。下一步继续复用已公开校验的r6包及同一进程内DNS等价比较进行cloud --check；这是预检，不执行SQL更新、备份停机或4090构建。正式更新前需要完成阿里云预检并处理4090镜像仍落在/var这一存储边界。

阿里云操作身份约束再次确认：用户admin未设置密码；不要在阿里云命令前加sudo -v，也不要建议设置密码、放宽sudoers或以root运行整个Python。2026-10-24-single-personal-shared-access.md已明确不需要sudo -v，既有Docker操作器内部沿用非交互sudo -n docker。此前手工额外添加的sudo -v导致密码提示，须取消并直接以admin运行原Python预检；若sudo -n docker权限本身不足，会立即停止，再基于具体输出诊断，不能预先扩大权限。

## 阿里云真实KeyError与小操作器交付

用户定位validate_rendered第71行缺少name。原cloud()把未经Compose展开的原始compose.json直接送入已展开配置的校验器；autonomous_compose.compose_document本来就只保存网络逻辑名和internal属性，不写实际name。修正先通过原sudo Docker compose config生成单独的rendered副本用于两个检查容器；原始document仍用于备份及后续API/Web挂载更新，不把Auth的env_file展开内容写回原配置。

Ruling: 分离小部署操作器与已验证r6业务/素材包，新增显式--source-root参数，先验证完整原包再加载其辅助模块。操作器独立SHA256进入输出、回执及可恢复脚本副本，verify拒绝不同操作器；不再重下8MB素材。当前唯一未推送的621dec1仅为本任务生成制品的提交，远端main已核实仍为2a466a5；保留本地tar与其SHA，只修订此未公开提交移除大二进制，不重写任何已推送历史、不强推、不切分支，也不改其他任务文件。

本地验证465通过/11项环境差异跳过；新增集成测试先重现原始网络缺name的相同KeyError，修正后两个校验容器均使用展开配置，原compose与Auth引用不改；原包篡改/相对路径/操作器篡改均拒绝。真实已解包r6的230源文件验证、单文件操作器及r6辅助模块导入亦通过。独立复核未发现重要阻塞，确认r6与当前的辅助模块、Worker Dockerfile及component-baseline无差异；没有远程apply。

小操作器源码bd09e6c、blob e93c76892ce1a781ae5adfb681b04a6bfea708fc，29,823字节、SHA77bc373ee99d62c54a91354dc5552302ed42b31bb7c186aab43abc0c5782d6ea。已从官方API实际下载、核验SHA并编译语法。Platform40199208118成功（Linux475通过/1跳过、Worker82通过），Native40199208178数据库/proxy成功。元数据v2明确区分操作器与r6业务/素材源包，不再宣称未发布的完整r7 archive可下载。

## 阿里云旧任务停在等待裁剪：保留并验证续跑

小操作器真实预检已通过配置/资源与八函数只读基线检查，停在任务排空保护，尚未检查六个API文件摘要，也未执行备份、SQL更新或容器替换。用户只读审计返回唯一facade/rectification/awaiting_crop任务，约3216分钟未更新、无有效租约、Worker idle。不能自动取消或修改业务状态来通过部署。

范围细化：仅允许旧texture流程、facade、rectification、awaiting_crop且无有效租约的人工确认检查点保留；其余非终态一律阻止。初始检查与停止API后的二次检查复用同一只读SQL；若用户中途确认裁剪而进入排队，恢复旧API并停止升级。预检公开保留数量，任务记录/照片/产物保持原样。没有修改r6业务源包或扩大4090部署范围。

新增回归先复现等待裁剪仍阻止预检、无法覆盖停API后二次竞态，再修正通过。本地linux/tests 474通过/11项环境差异跳过，平台JS1122通过、业务API136通过。另新增一次性原生PostGIS测试：从精确旧八函数创建贴图任务，上传原矫正产物并等待裁剪，使用部署器实际SQL覆盖状态/种类/阶段/有效租约/组件模式的拦截矩阵，然后应用迁移两次，断言任务及产物未变，使用v2 Worker确认裁剪并继续贴图至可下载GLB；原生CI结果待验证，不将Windows语法检查或模拟测试当作数据库实测。

精确源码3dda6af的Platform40203360731成功，Linux484通过/1项条件跳过、Worker82通过；Native40203360729数据库/proxy两项成功，日志明确包含legacy awaiting-crop migration/resume测试及完整历史部署/自身备份恢复成功。新操作器blob dce6aeb4e62fca698492de7e5cf80e4a13e974bf，30,745字节、SHA702096d70a39d9129bc496a8e14e6137536ac252d79e0863a8b315f70ad97fe3，已由官方API实际下载、校验摘要及语法。仍复用r6源包；真实阿里云需重新预检，尚无任何远端apply或任务变更。

## 2026-10-26 阿里云真实更新及回执核验通过

用户先返回component_cloud_preflight_passed（6个API文件、8个函数、active_tasks=0、preserved_awaiting_crop=1），再按同一操作器执行apply/verify，返回component_cloud_updated_worker_and_real_photo_test_pending、api_and_web_updated=true、auth_database_retained=true及component_cloud_rollout_receipt_verified_real_photo_test_pending。两次输出的payload_commit=af39f0411ac638d360d10e2c4d57e5d8c56ed929、operator_sha256=702096d70a39d9129bc496a8e14e6137536ac252d79e0863a8b315f70ad97fe3一致。可以确认云端更新/回执核验完成；不能据此标记4090或真实照片验收完成。

4090尚未apply。此前明确要求Docker部署也集中，而当前镜像库仍是系统盘/var/lib/docker。下一步仅更新集中目录内小操作器，重新worker --check，并只读获取当前Docker存储驱动、磁盘余量、镜像库实际目录占用及运行容器清单；在掌握迁移影响前不构建镜像、不更改daemon或重启其他服务。沿用原r6业务源包，不动两套历史checkout、bind mount、权重及密钥。

## 2026-10-26 4090真实构建下载403：固定包改为主机缓存后本地ADD

用户只读审计：overlay2驱动、DockerRootDir=/var/lib/docker；du -x后真实Docker目录约92G（此前du未跨文件系统限制的118G不能当作独立物理占用），运行数据1.3G在newapply/runtime，镜像95.99GB/构建缓存42.49GB有共享不可相加。用户询问暂不迁移是否可行，本轮有限更新继续沿用原daemon目录，集中代码/缓存/状态仍在newapply，不做全局prune或迁移。主机与旧Worker的/usr/bin/blender实际均为3.0.1，并有色彩管理fallback提示；当前构件代码含3.0没有的Separate Color且仅验证3.6，保留旧版本并增加3.6.23。

用户新Worker预检通过，随后apply失败。附件私有日志确认Pillow11.1.0安装成功，官方Blender URL的urllib下载返回HTTP403，尚未生成receipt；两个服务仍为原0cac700/623ffb0镜像running。不是已知端口/资源差异，也没有证据证明Python User-Agent是唯一原因。本机两种UA的HEAD均200，故不以单改UA冒充已解决远端下载问题。

修正仅在新Worker操作器：主机使用固定HTTPS源（官方、Aliyun、NJU）顺次下载，按官方清单的272819000字节及原SHA256 0e9a18af4d0060b825e9617e24a775f759e0f9f67271c062f3d53a539030af00校验；完整缓存复用，损坏缓存拒绝保留，失败只删除本次随机.part。state/downloads保留校验包，state/worker-build-context只复制r6两个代码子树与安装包，生成Dockerfile把已知旧三条网络下载语句改为本地ADD（自动解压），不在镜像中另留压缩包层、不改原r6的230文件、旧helpers或云端。现有云端已完成回执继续使用3dda6af操作器，不用新Worker指纹去验证旧云端回执。

验证：新增403→备用源→缓存复用、坏缓存保留拒绝、HTML/超长/断流不得晋升缓存、上下文额外文件/源码变更拒绝等测试先失败后通过。本地linux/tests 480通过/12项环境差异跳过，平台JS1122通过。真实官方归档已在E盘测试目录下载，长度/原固定SHA及归档内可执行文件均通过；真实解包r6生成100文件离线上下文，原230文件清单再次通过。独立静态复核未发现重要阻塞。真实Docker本地ADD解压/可执行权限用例待Linux CI，不将本地Windows或静态复核当作真实镜像构建验收。

源码d1d347a的Platform40262234399成功，Linux491通过/1项条件跳过、Worker82通过；真实Docker无网络ADD解压与可执行权限用例已执行通过。Native40262234382数据库/proxy及完整历史部署/自身备份恢复成功。新Worker专用操作器blob dcfbd6581bf0db01a39b06e4485285a8bc351788，36,842字节、SHAad76f5c899a8bbd3e76dbbc02e8b9642dc0be0fb61faa782b3c8c447e99ebdf7，官方GitHub API实际下载校验及语法通过。cloud已完成回执仍绑定旧3dda6af操作器；新Worker操作器不改云端，不重发完整业务包。真实4090需重新check/apply/verify及真实照片/旧贴图验收，Task4不标记完成。

## 2026-10-26 构建成功后adapter不可见：私有上下文权限及包优先级

用户再次执行d1d347a操作器，主站完整下载达到100%，后续日志证实离线ADD、两次代码COPY及镜像导出均成功，新候选Worker为sha256:4e926e635ca5aeec207ba2a5ca6ec3363da1dba5702202ba8a6a704272465e81。紧接着Python smoke报ModuleNotFoundError: rural_house_generator.backend.component_building.adapter。无receipt，两服务仍为原镜像running，故并非服务已替换。旧Worker模块检查numpy/cv2/pydantic/httpx存在，PIL不存在（候选镜像构建已成功安装Pillow）。

代码中发现私有上下文的0700目录经普通COPY默认归root，UID10001不能正常遍历；同时rural根是namespace目录，可被继承镜像中同名regular package抢占。这是原Docker解压测试没有覆盖的非root导入问题。本轮仅Worker操作器修正：生成有明确根marker的完整staged rural包；Worker/ML使用数值COPY --chown=10001:10001及同一最小上下文；host私有目录不放宽。使用worker-build-context-v2保留失败v1现场及完整下载缓存，不重写旧原包或云端回执；Smoke显式使用原容器User并断言模块__file__位于/opt/village-components，避免导入旧包误通过。

新增回归先红后本地通过：rural根marker、Worker及ML COPY权限和路径、导入位置校验。Linux真实Docker回归待CI：构造带旧regular package的Python3.10.18基础镜像，以0700目录重现缺owner/缺marker/两者组合的导入失败，再验证固定Worker和ML用UID10001、只读rootfs、无网络导入正确overlay模块。真实旧r6配合已缓存完整归档生成101文件v2上下文且原230文件清单不变。独立静态复核无重要阻塞；本地linux/tests 482通过/13跳过、JS1122通过。原生非root Docker测试未在Windows执行，尚不宣称真实服务器修复完成。

精确源码1f139ed的Platform40265443871成功，Linux494通过/1项条件跳过、Worker82通过；真实Docker独立缺owner/缺根marker/组合缺陷的失败及固定Worker/ML的UID10001导入/位置断言均已执行通过。Native40265443944数据库/proxy及完整部署/自身备份恢复成功。当前Worker操作器blob a70877891603582ac946c32e7e78a2004082d42b，38,693字节、SHA37e4eacec6b44eefe0a001cb3bea124169ce3a6680ca2be27a648655058ff47d，官方API实际下载/语法/大小/摘要验证通过。cloud继续原3dda6af，不更换已完成回执指纹；真实4090及照片验收仍待用户，不标记Task4完成。

## 2026-10-26 实际Blender缺libSM：完整官方二进制的系统库与真实渲染验收

用户新日志确认1f修复后候选Worker798ff1f29783da762564a6c61bd9392b16d5fe4c5696b8ae107e360a6bd7af9e的模块以UID10001从/opt/village-components导入成功。下一步官方Blender启动退出127，缺libSM.so.6；无receipt，旧Worker/ML仍原镜像running，ML候选尚未构建。不能把模块导入或归档解压通过当成Blender运行通过。

从已下载并固定SHA的真实Linux Blender可执行ELF读取DT_NEEDED，核对X11/Xrender/Xxf86vm/Xfixes/Xi/xkbcommon及bundled依赖。v3 staging在已缓存ADD之后补安装libsm6/libice6等Ubuntu运行库，--no-upgrade且--no-install-recommends，不安装新CUDA、GPU驱动或模型，不改宿主机。下载缓存仍复用，v1/v2现场和r6原230文件保留。

验收升级：以原User、无网络、只读rootfs和/tmp tmpfs先运行ldd明确列缺库，再启动真实3.6.23创建材质节点，验证Non-Color/Filmic色彩配置，导出并校验GLB头，Cycles CPU渲染32x32 PNG并验签；摘要绑定候选image保存私有report及回执，仍在替换服务前完成。Docker操作额外公开安全阶段及日志basename，遇到失败不用再猜哪一步，不输出原始私密日志。

测试先红后绿，本地linux/tests 484通过/14项平台差异跳过、JS1122通过，真实r6+完整cache生成v3且原清单不变。静态独立复核无重要阻塞。新增一次性Ubuntu22.04+真实官方3.6.23 Docker回归：无库image先复现启动失败，再使用生产APT宏与真实导出/CPU渲染验收验证修复；该完整Linux运行测试待CI，不能以Windows编译或synthetic包测试代替。

源码ab908db的Platform40283154692成功（Linux497通过/1项条件跳过、Worker82通过），完整官方Blender+真实Ubuntu运行库/GLB/CPU渲染回归已执行通过；Native40283154729数据库/proxy及完整部署/自身备份恢复成功。公开操作器blob cc732162c35f2076b1200c102dfb0d3d518602c5，43,507字节、SHA274927ea7c2d96ea7c12559c756a959836a89de99a15389c0992a713218e925d，已通过精确提交raw源实际下载/大小/摘要/语法校验。本地匿名GitHub REST遇限额，改读公开Actions嵌入运行列表确定精确commit的run IDs，使用已连接GitHub工具核对jobs/logs；不把无法访问的API误当作CI失败或索要新凭据。云端继续旧3dda6af，真实4090和照片验收仍未完成。

## 2026-10-26 Worker已更新但内部网络丢失：限定原回执的在线恢复

用户实际执行ab908db：Blender共享库、真实GLB/PNG、两镜像构建/导入均通过，ML及Worker的up均成功，随后UPDATED_WORKER_RESOURCES_CHANGED。原receipt已写入phase=prepared，不能删除或重跑原apply。只读对照确认两容器均使用receipt中构建镜像：Worker3d8f777714d5b611f2312a29f3a606e9c234b4a92b3181c87133cd1307657ef3运行，MLa38a7be2a34018802047f88d9692256f4f6d21801559c211ba64c692ccb3a123健康。唯一resource_snapshot差异是Worker原有egress+facade-internal，现只有egress。进一步确认saved Compose仍声明两个网络，原内部bridge网络ID未变、internal=true、原alias为容器名及facade-worker，无静态IP/DriverOpts。不能把它当作等价序列化差异忽略；具体Compose/Engine为何未附加第二端点尚未证实。

新增独立component_worker_network_recovery.py，仅接受上述精确payload、原操作器指纹和两新镜像。保留ab操作器及r6源包，复用原home操作锁、sudo-n本地Docker与私有日志。检查完整原资源、环境、保存Compose、现有网络ID、其他容器不变；仅以容器ID/网络ID补连缺失的原内部端点及原alias，不重建、不重启、不创建网络、不重写Compose。原prepared receipt单独备份；恢复尝试绑定现有容器ID，执行中断后允许继续验证，拒绝容器被换后重置基线。模块实际导入、Worker阿里云身份、Worker到ML健康端点、Blender版本及原绑定镜像的导出/渲染报告全部通过，才写complete并调用原ab操作器verify。不能据此自动标记真实照片验收完成。

本地先红后绿覆盖差异拒绝、实际文件备份、恢复失败/重试、并发换容器拒绝及原别名。独立复核指出原write_public保存operator.py为0644，不能用凭据0600要求阻断加载；已改为原字节SHA、无链接、单硬链、Linux同owner且组/其他不可写，保留state0700，并加入真实producer启动回归。Linux CI另有一次性双bridge实测：Worker仅egress时无法解析ML，调用生产补连函数后可按facade-ml访问HTTP，容器ID不变、RestartCount=0。真实4090恢复及照片端到端验收仍待执行。
