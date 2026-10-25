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
