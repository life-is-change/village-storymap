# C1 三维方案内部写入：本地交付记录

状态：2026-10-18 用户在阿里云拉取 `063808f` 后，完成真实管理员登录、场景写入及重启持久性验收，取得 `SCENE_WRITE_INTERNAL_VALIDATED_NOT_CUT_OVER`。C1 内部候选通过；正式网站仍使用 Supabase。

## 交付内容

- 独立 scene 入口，固定 9 项操作，2 MiB JSON 上限，无通用 RPC/SQL/表代理；沿用在线 Auth 验证，事务内 RLS 身份、最小登录权限和独立连接预算。
- 保留源乐观 revision 语义；候选锁函数将版本/分支/恢复操作串行到对应方案，固定参数，事务失败回滚。
- 显式注入的前端客户端不自动回退源端；私有文件引用/预览/素材修改明确未接入，内置 seed 引用可保存。
- 独立数据库/角色/回环 API，沿用共享 PG 实例，不覆盖 A/B2。旧 A/B2 构建默认不包含 scene，既有镜像元数据和运行代码摘要保持不变。
- 受保护的归档加载、部署、重启/真实 TCP 校验，以及真实账号“保存→冲突→版本→恢复→重启读回”探测。

## 本地证据（2026-10-17，10-18 修复后复核）

- API 单元测试 24/24；真实 PostgreSQL 集成 4/4，含源场景 SQL 的两个学生/教师/管理员、跨组、沙盒、成员撤销、并发保存、里程碑和恢复，以及实际浏览器客户端 → HTTP → PostgreSQL 链路。
- Linux 部署脚本测试 181 passed / 1 skipped；跳过的是本机 Windows 原生 symlink 条件。
- 平台前端回归 1005/1005。
- 本机 Node 24.18.0 / PostgreSQL 17.11，不能替代阿里云 Linux Node 22 / PostgreSQL 17.6 实际验证。
- 镜像元数据及哈希见 `linux/scene-write-image.json`；镜像文件保留在本机仓库外 `C:\Users\MR\village-image-transfer\`，不提交 Git。

## 独立审查及修复

对 `4753f92..c3bff89` 完成一次只读独立整体审查；发现 2 项 Important，无 Critical/Minor。两项均补失败测试后修复：

1. 无效 groups 条目、重复组 ID、错误 objectIds/悬空引用和不存在的对象 groupId 在持久化前拒绝；真实数据库测试确认拒绝后原文档和 revision 不变。
2. 版本行的私有预览独立于 document JSON，现同时检查 `preview_path`。C1 对带预览的旧版本提交/恢复明确拒绝，避免提交不可读引用或默默丢弃预览；确认拒绝后版本仍为 milestone、项目仍为 draft。

审查边界裁定：沿用源教师规则（不是新授课范围授权）；候选使用旧快照而不做实时身份/权限同步；C2 文件与 GPU 桥接、HTTPS/正式切换归后续；真实云端运行和代表性负载必须由后续实际结果证明。若误将候选用于生产，会有权限陈旧、引用不全、数据交接或容量风险，因此本次没有启用任何正式路由。

## 未完成与边界

C1 仅闭合内置元素的场景方案生命周期；不是完整三维模块/数据库生产切换。C2 文件上传/删除和引用、其他普通业务写入、共享权限/身份同步、4090 桥接、并发容量、最新数据刷新及 HTTPS/正式切换仍未完成。旧库和 GPU 通道均未改动。

人工云端步骤见 [C1 操作说明](../../linux/README.scene-write.md)。最终以实际 `SCENE_WRITE_INTERNAL_VALIDATED_NOT_CUT_OVER` 和后续记录为准。

## 2026-10-18 云端进度与 context 修复

用户实际输出已达到 `SCENE_IMAGE_ARCHIVE_VERIFIED_LOADED`、`SCENE_WRITE_PREFLIGHT_OK`、`SCENE_WRITE_INTERNAL_DEPLOYED_NOT_ACCEPTED` 和 `SCENE_WRITE_RESTART_VERIFIED`，说明该镜像的 Linux Node 22/模块执行、候选部署、重启及实际数据库 TCP 路径已通过。管理员登录后在 `phase=context` 停止；不能把这些标记当作完整写入/版本/持久性验收。

对与候选恢复输入相同、哈希已核对的本地归档做只读聚合检查：`group_plan` 为 0、练习共享空间为 2。根因是探测脚本假定已有正式组方案。修复为读取已有项目/村庄/空间并使用原 RPC 支持的管理员私有沙盒，不变更 API 运行代码、数据库结构、镜像或既有课程/组空间。

已补充 Python 拒绝/诊断测试及实际 PostgreSQL 上“没有正式组方案”的上下文查询测试，并通过真实客户端→HTTP→数据库的管理员沙盒保存、版本与恢复流程。用户只需拉取修复、重新 `--verify` 和 probe；无需重传镜像或重复 `--deploy`。

## 2026-10-18 已保存后的版本探测修复

用户在 `d9c6302` 重新验证重启并登录后，旧 probe 停在 `write_version_restart`；只读提取检查点得到 `LAST_WRITE_PHASE=saved`，证明至少已经保存新方案，完整验收尚未通过。

新增实际 Python probe → HTTP → PostgreSQL 的本地测试，确定复现了版本列表误判：`pg` 的 SELECT bigint 返回 `"1"`，旧 probe 直接与整数 `1` 比较，报“Milestone absent”。修复 probe 的精确版本比较并覆盖重启后检查，不改变 API 返回、运行代码、数据库结构或镜像；原测试方案不删除。该本地跨进程测试的 restart 回调为空，仅证明完整协议/数据比较正确，不能替代云端实际进程重启持久性验收。

错误输出改为具体步骤和经过白名单处理的 HTTP/API 错误信息；响应正文、凭据和私有行不输出。原先仅有大阶段提示不足以定位错误，这是探测工具的问题，不应归咎于用户密码或服务器。

本次按用户请求重新尝试浏览器控制。浏览器扩展能列出标签，但读取 Workbench 原点时，工具返回保存的网站权限/管理策略拒绝页面观察；没有网络超时或阿里云认证失败证据。遵守工具的禁止绕过要求，未改用其他浏览器、CDP 或其他通道规避。继续由用户执行云端命令。

## 2026-10-18 阿里云 C1 最终验收

证据来源：用户手动执行并回传终端输出；不是本机模拟或代理远控结果。执行版本 `063808f`，先运行 `deploy-scene-write-validation.py --verify`，再运行 `probe-scene-write.py`，以管理员学号 `332` 隐藏输入网站密码。

```text
SCENE_WRITE_RESTART_VERIFIED - real login/save/version probe still required.
{"status": "authenticated_scene_write_probe_passed", "created_drafts": 3, "milestones": 1, "revision": 1, "restart_persistence": true}
SCENE_WRITE_INTERNAL_VALIDATED_NOT_CUT_OVER
```

完整探测已走过创建、保存、旧 revision 冲突、里程碑、恢复、分支、提交，以及 API 重启后读回的检查。此结果验证候选内置元素方案生命周期，不包含真实学生账号的云端写入、多用户并发容量或 C2 私有文件生命周期。测试草稿和候选数据保留，不清理源 Supabase。

下一阶段为 C2：私有照片/GLB/素材与版本预览的授权上传、引用、读取和删除；先核对权限与文件/数据库一致性设计，再实施独立候选验证。当前无需重新上传 C1 镜像、重复恢复数据库或开启公网 API。
