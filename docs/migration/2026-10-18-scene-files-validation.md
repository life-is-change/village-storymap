# C2a 三维文件生命周期验收记录

状态：本地实现交付与独立审查进行中；尚无阿里云最终成功回传。操作见 [部署说明](../../linux/README.scene-files.md)。

新增独立运行目录 `business-api/scene-files`，覆盖限额流式上传、文件结构校验、SHA-256 落盘、幂等会话提交、源权限注册、模型/组件/预览引用、保存/版本/恢复/归档和认证文件读取。新浏览器客户端与素材库钩子仅显式注入时启用，生产 `app.js` 不变。

本地使用显式废弃的 loopback PG17 合成库，执行真实源 Scene SQL；不导入私有备份业务行。测试覆盖他人会话、成员撤销、事务回滚、清理竞争、不同内容重试、共享范围、归档新增放置、缺失旧预览、HTTP Range 和真实前端上传/保存。Python 云端探测协议也通过真实本地 HTTP→PG→文件运行，管理员和上传成员是两个合成身份；本地 restart 回调不重启进程，因此不声明云端持久性已通过。

Task 5 本地记录：Python 部署回归 204 passed / 1 skipped；真实 C2a PG/HTTP/前端/Python 协议联测通过。代表性合成流程含 3 个文件、4 个草稿和 1 个版本，Python 协议约 10.3 秒、Node 进程 RSS 65 MiB；Task 1 合成 50 MiB 流上传观察 RSS 51–59 MiB。均为单流程本机观测，不代表目标容器峰值或教学并发容量。

离线构建沿用已验证 Node 22 linux/amd64 基础归档和锁定纯 JS 依赖。旧 B2 摘要 `bb703c4251520d7f4548120933d29708551f2e5a483f36cd5cd02019ce99d256`、C1 摘要 `5e17959052a4711ec8a3ba2b31295e2f0b7797ee103838f3e4d79074bae2ec7c` 构建前后必须相同。C2a 归档由 [镜像元数据](../../linux/scene-files-image.json) 精确绑定；本机没有 Docker 引擎，Linux 容器 smoke、真实账号和资源快照待用户部署验证。

部署在同一 PG 实例新建候选库和受限角色，仅新增精确 HBA 行、reload，不恢复集群角色。旧验证脚本接受这一条新行，否则精确比较会误报旧服务配置漂移；旧运行代码、镜像集合和原网络规则未扩大。候选 API 仅 loopback18083、256 MiB、最多 2 连接/2 上传，只有自己的私有文件卷可写。

待阿里云回传：`SCENE_FILES_INTERNAL_VALIDATED_NOT_CUT_OVER`、成功聚合计数、API/PG 内存与主机 available。此前不标记 C2a 云端完成。正式网站、Supabase Auth/业务源和 4090 不切换；最新数据交接、其余业务写入与 GPU 桥接仍未实施。
