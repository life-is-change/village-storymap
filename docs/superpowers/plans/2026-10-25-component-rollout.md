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
- [ ] Task 6：本地回归、实际解包校验并更新交付说明。旧r2的Home部署命令撤回；只交付新包预检，真实apply与照片验收仍待两端执行。

现场：canonical repo分支codex/local-basemap-facade-release、8c2719e、干净；另一checkout分支2026-0926、6f4bbcb且有大量本机修改。geo/facade Worker及本地web引用后者；building/ML/LaMa引用/opt兼容入口。/var剩余18G、newapply剩余134G，Docker Images报告95.99GB、Build Cache报告42.49GB（共享层不可直接相加）。其他容器含Open WebUI，禁止全局prune或随意重启Docker。

路径修正本地验证：linux/tests 440通过、8项平台差异跳过（含新增POSIX symlink约束）。四项新增测试先因缺少路径规划/磁盘预检而失败，再通过。最终复核发现sudo默认清理TMP环境；追加实际Docker.run子进程边界失败测试后，Docker可选temporary参数通过sudo后的env命令显式传递三个临时路径，其他旧操作默认命令不变。未执行任何远程变更。
