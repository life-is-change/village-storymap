# C2a 三维文件内部验证

本阶段验证新 GLB/贴图、组件和预览的上传、登记、引用、归档及重启读回。正式网站仍访问 Supabase，4090 通道保持原状。本候选仍从 2026-10-15 归档恢复，不能直接当作最新线上主库。

使用既有 PostgreSQL 实例中的独立库 `village_scene_files_validation`、角色 `village_scene_files_login`；API 容器 `village-scene-files-validation-api` 仅绑定 `127.0.0.1:18083`。主机 available 至少 512 MiB、空闲磁盘至少 2 GiB 才部署；容器限额 256 MiB、连接池最多 2、并发上传最多 2。这些是保护限额，教学并发容量仍需实测。

## 1. 上传新镜像

本机文件（开启资源管理器的“文件扩展名”后查看完整名称）：

```text
C:\Users\MR\village-image-transfer\village-business-api-stage-c2a-scene-files-amd64.tar.gz
```

Workbench 文件管理上传到服务器已有目录：

```text
/home/admin/village-db-backups/20261015T034526Z-_bfzxy5z/
```

无需解压；不要选择 `.sha256`、`.pre-review` 或旧 C1/B2 归档。镜像不含密码和业务数据。Git 中 `linux/scene-files-image.json` 记录归档大小、SHA-256、代码摘要及镜像 ID；部署脚本先校验再加载。

## 2. 更新、预检和部署

先确认源码没有未提交修改；若有，保留并反馈，不 reset/clean：

```bash
cd ~/village-deploy/source
git status --short --branch
```

目录干净后：

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 linux/scripts/deploy-scene-files-validation.py --load-image &&
python3 linux/scripts/deploy-scene-files-validation.py --check &&
python3 linux/scripts/deploy-scene-files-validation.py --deploy &&
python3 linux/scripts/deploy-scene-files-validation.py --verify &&
python3 linux/scripts/probe-scene-files.py
```

依次应看到 `SCENE_FILES_IMAGE_ARCHIVE_VERIFIED_LOADED`、`SCENE_FILES_PREFLIGHT_OK`、`SCENE_FILES_INTERNAL_DEPLOYED_NOT_ACCEPTED`、`SCENE_FILES_RESTART_VERIFIED`。只有最后的真实登录流程成功后才会输出：

```text
SCENE_FILES_INTERNAL_VALIDATED_NOT_CUT_OVER
```

第一次输入管理员**网站学号**（例如 `332`）及隐藏的**网站登录密码**。不是数据库密码、Publishable key 或 Secret key。如果管理员没有原课程成员关系，脚本会明确提示，再输入一个已有课程成员的网站学号和密码；用该用户上传个人素材，并依源权限发布/复制，管理员在同课程的私人测试沙盒保存方案。没有匹配成员/上下文会安全停止，不修改成员关系，不创建虚假权限。

探测只上传仓库内合成 GLB/PNG，创建带 `C2a TEST` 标识的候选素材、组件、草稿及版本。验证重复提交、读回摘要、旧 revision 冲突、发布/复制/归档、恢复/分支/提交，再重启**此 C2a API**并重新读回。测试数据保留在候选库；不会写线上 Supabase。

## 隔离与故障反馈

- 私有状态 `/home/admin/village-scene-files-validation`，新文件在其 `files` 子目录；只有这个文件卷可写。旧 B2 文件和索引只读，密码只读挂载，容器非 root、根 FS 只读。
- 新库只恢复业务归档，不重放集群角色，不覆盖 A/B2/C1 数据或镜像。PostgreSQL HBA 仅增同一内部网段、指定新库/新角色的 SCRAM 行并 reload；A/B2/C1 校验器兼容这一条精确扩展，其余规则与拒绝兜底保留。
- `--verify` 校验隔离、角色、schema、源证明和真实 API→DB TCP，重启时逐个校验已提交文件摘要；不重启共享 PG 或其他 API。探测需要一小时内的新验证证明。
- 失败后保留数据库、文件、检查点和私有日志。不要删除状态重跑 `--deploy`，不要 `down -v`。仅反馈 `STOP: SCENE_FILES_... phase=... category=...` 和公开容器状态，不发送密码、令牌、业务行、dump 或完整私有日志。
- 尚无自动断点重放：失败上传不可见，部分测试记录保留，不能把中断当作已验收。重跑前根据阶段确定动作；已部署时不再加载/部署，可重新执行 `--verify` 和探测。

资源观察：

```bash
sudo docker stats --no-stream village-scene-files-validation-api village-api-validation-postgres
free -h
df -h /
```

过期未提交文件只统计、不删除：

```bash
python3 linux/scripts/deploy-scene-files-validation.py --cleanup-report
```

文件维护没有 HTTP 删除入口；有业务/历史引用的文件不会作为孤儿清理。GLB 单文件 50 MiB、贴图 10 MiB、PNG 符号 5 MiB、预览/俯视图 10 MiB；SVG 与外部资源 GLB 拒绝。调查照片、旧 group-models 库和村庄数据集的写入、任务桥接、最新数据同步、HTTPS 与正式切换不在本次交付范围。

## 本地验证边界

代码和镜像可在本机完成测试与归档校验；本机没有 Linux Docker 引擎，元数据保留 `pending_linux_container_smoke_test`。云端 `--load-image` 才实际执行 Node 22 和模块导入；真实账号/权限、Linux 文件 UID/符号链接及目标机资源需云端验收。不能把本机 Python 协议联测的无操作 restart 回调当作容器重启证明。
