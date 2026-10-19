# C2a 三维文件生命周期验收记录

状态：云端C2a候选已部署并通过重启验证；旧快照无课程成员，完整真实账号文件验收待完成。操作见 [部署说明](../../linux/README.scene-files.md)。

新增独立运行目录 `business-api/scene-files`，覆盖限额流式上传、文件结构校验、SHA-256 落盘、幂等会话提交、源权限注册、模型/组件/预览引用、保存/版本/恢复/归档和认证文件读取。新浏览器客户端与素材库钩子仅显式注入时启用，生产 `app.js` 不变。

本地使用显式废弃的 loopback PG17 合成库，执行真实源 Scene SQL；不导入私有备份业务行。测试覆盖他人会话、成员撤销、事务回滚、清理竞争、不同内容重试、共享范围、归档新增放置、缺失旧预览、HTTP Range 和真实前端上传/保存。Python 云端探测协议也通过真实本地 HTTP→PG→文件运行，管理员和上传成员是两个合成身份；本地 restart 回调不重启进程，因此不声明云端持久性已通过。

Task 5 本地记录：Python 部署回归 204 passed / 1 skipped；真实 C2a PG/HTTP/前端/Python 协议联测通过。代表性合成流程含 3 个文件、4 个草稿和 1 个版本，Python 协议约 10.3 秒、Node 进程 RSS 65 MiB；Task 1 合成 50 MiB 流上传观察 RSS 51–59 MiB。均为单流程本机观测，不代表目标容器峰值或教学并发容量。

离线构建沿用已验证 Node 22 linux/amd64 基础归档和锁定纯 JS 依赖。旧 B2 摘要 `bb703c4251520d7f4548120933d29708551f2e5a483f36cd5cd02019ce99d256`、C1 摘要 `5e17959052a4711ec8a3ba2b31295e2f0b7797ee103838f3e4d79074bae2ec7c` 构建前后必须相同。C2a 归档由 [镜像元数据](../../linux/scene-files-image.json) 精确绑定；本机没有 Docker 引擎，Linux 容器 smoke、真实账号和资源快照待用户部署验证。

部署在同一 PG 实例新建候选库和受限角色，仅新增精确 HBA 行、reload，不恢复集群角色。旧验证脚本接受这一条新行，否则精确比较会误报旧服务配置漂移；旧运行代码、镜像集合和原网络规则未扩大。候选 API 仅 loopback18083、256 MiB、最多 2 连接/2 上传，只有自己的私有文件卷可写。

待阿里云回传：`SCENE_FILES_INTERNAL_VALIDATED_NOT_CUT_OVER`、成功聚合计数、API/PG 内存与主机 available。此前不标记 C2a 云端完成。正式网站、Supabase Auth/业务源和 4090 不切换；最新数据交接、其余业务写入与 GPU 桥接仍未实施。

整体验证：平台 `npm test` 修复后 1012/1012，API 单元 `node --test business-api/test/*.test.mjs` 36/36；Python 204 passed / 1 skipped（Windows 不允许创建符号链接，硬链接拒绝已测）。A/B2/C1/C2a 真实 PG 集成逐文件串行通过4/4。C2a Python协议复跑约10秒、Node RSS65MiB。Linux符号链接/UID验证在云端补齐。


## 独立审查及修复

一次独立整体审查发现 1 项 Important、无 Critical/Minor：已提交会话重试跳过正文，等长不同内容可能被误报成功。客户端现在重发正文由服务器比较 SHA；committed 会话仅核验既有 ready 字节，24 小时有效期仍限制未完成上传。丢失提交响应后也重新 POST 同会话 commit 核对元数据，不直接相信 status.result。客户端等长不同 Blob、真实 HTTP→PG 重试（包括超24小时）及业务行数不变的失败测试均 RED→GREEN。修复后平台1012、API单元36、Python204（1项Windows符号链接跳过）和真实PG串行4项全部通过。

代表性完整合成流程以 `process.resourceUsage().maxRSS` 测得整个 Node 测试进程峰值89.02MiB，含API、PG客户端和前端测试；耗时约26.5秒，同流程普通运行约10–29秒。不是独立生产服务/容器容量或教学并发结果。最终离线归档校验了大小、SHA、linux/amd64、入口及运行代码摘要；SHA以Git元数据为准。

## 实施取舍与风险

1. 按用户要求保留原目录main，按已授权流程推送，不创建工作树、不清理私有执行证据；误判代价为后续整理成本。
2. 将文件读取接口补充预期大小/SHA参数，使记录与物理字节绑定；误判可能拒绝文件而不会悄然换文件。
3. Windows fsync使用读写句柄而非跳过持久化；合成PNG原CRC错误经独立zlib核对后修正fixture，保留服务端校验。Linux UID/符号链接待云端；误判风险为平台差异导致启动或读取失败。
4. 上传时先持久化不可变字节，登记时事务核验并提交业务行+会话；失败留下不可见孤儿，24小时后只经服务端维护回收。私有表仅RLS SELECT和固定definer函数，不提供HTTP维护接口。误判风险为残留占盘，预检与配额会停止新增。
5. 对旧/新/版本引用取并集排序锁，归档按对象/组原用法识别；local-m组件使用验证副本而不改变原坐标，缺失预览测试插入合成行而不改不可变历史行。误判风险为误拒合法方案或锁争用，真实源SQL测试覆盖主要流程。
6. 旧B2/C1校验器只接受一条精确新增数据库/角色HBA行；C2先严格检查256MiB及唯一自身可写卷，再规范化副本复用旧通用容器检查。误判风险是隔离校验遗漏或阻断旧证明，漂移测试覆盖内存/挂载/端口/环境。
7. 管理员没有课程成员关系时，隐藏登录已有成员上传、管理员在同课程源授权私人沙盒保存；不创建组或授予权限。误判会在预检/源RPC停止，不生成验收。
8. 本机协议测试使用合成身份与无操作restart回调，Linux Docker启动、UID/符号链接、真实账号关系/快照和主机资源均留云端实际验收；误判风险为部署失败或负载不足，因此不声明云端完成、不提前公开路由。
9. 保留源teacher/admin读取权限，不重设计既有授权；其广泛读取能力属于源策略。HTTPS/正式切换/最新数据同步、调查照片与GPU桥接按设计另做；当前网站仍依赖Supabase，尚无对应流畅度改善承诺。

无延期Minor。云端成功回传前，本地任务交付不等同于数据主写入点切换。

## 2026-10-19 云端部署和空成员快照

用户回传：镜像完整校验/加载、预检、部署及重启验证通过，分别取得 `SCENE_FILES_IMAGE_ARCHIVE_VERIFIED_LOADED`、`SCENE_FILES_PREFLIGHT_OK`、`SCENE_FILES_INTERNAL_DEPLOYED_NOT_ACCEPTED`、`SCENE_FILES_RESTART_VERIFIED`。管理员和成员登录进入 context 阶段，成员 `25213040` 因 `CONTEXT_MEMBERSHIP_REQUIRED` 停止，尚未开始文件上传。

本机只解码原归档中的 profiles/group_memberships，不恢复私有业务行到测试库、不接触线上：聚合结果为 4 个 profile、0 条 group_memberships，目标账号 profile 存在，因此更换账号不能使旧快照通过课程成员检查。

用户明确批准专用合成上下文后，新增 `prepare-scene-files-test-context.py --check|--create`。限定原 C2a 候选和账号332/25213040，在单事务追加六类 TEST 记录；重复一致只复核、冲突停止，不 UPDATE/DELETE/GRANT、不重建库、不更改源权限。旧证明归档后需重新验证/探测。

本机新增6项Python测试，全部部署回归210 passed / 1 symlink skip。专用loopback PG测试验证空成员起点、失败事务回滚、幂等、保留原课程、冲突拒绝、原成员权限RPC，并以两个合成身份通过真正C2 HTTP→PG→文件→Python完整探测。没有导入私有业务行；本机用文本domain代替PostGIS geometry，仅测试固定EWKT的传递与事务，原生PostGIS转换仍待云端实际运行。API源码/镜像摘要未变，无需重传镜像。

### 当前教学项目唯一约束修复

用户回传创建失败的私有日志主错误：`duplicate key value violates unique constraint "teaching_projects_one_current_idx"`。源索引按全局常量 `(true)` 唯一，条件为 stage 不属于 completed/archived；原候选已有当前项目，而初版 TEST 项目也用了 design 状态。本地最小集成 schema 未包含这条部分唯一索引，是测试覆盖遗漏。

新增真实源索引及已有 design 项目的回归场景后，旧实现复现相同23505错误（RED）。修复只将新 TEST 项目创建为 completed，并在重复运行检查中核对此状态；不删除/重建索引，不更新或归档原当前项目。GREEN验证新增成功、重复无额外记录、原项目字段完全不变、当前项目计数仍1，原权限RPC及完整C2 HTTP/Python文件保存版本流程通过。Python回归210 passed / 1 skip。该次云端失败发生在显式事务中，连接退出会回滚，不需要人工删表或清空库；重新运行先经只读冲突检查。
