# 三维方案写入候选 C1：内部验收，尚未切换

C1 提供固定操作的方案创建、读取、保存、里程碑、提交、分支和恢复。内置 `seed:` 引用可以保存；私有照片、GLB、素材管理、预览上传/路径暂返回 `FILES_NOT_READY`，留待 C2 完整处理。C1 客户端可显式注入编辑器服务，但本次未接入正式 `app.js`，不要用它替换全局 Supabase 客户端。

旧快照里的里程碑若带非空 `preview_path`，C1 同样拒绝提交和恢复；不会因恢复新草稿而悄悄舍弃预览。待 C2 文件生命周期接入后再开放这些版本。

沿用同一 Supabase Auth 用户 UUID 和源场景 RPC 权限规则。源规则中的 teacher/admin 可访问组方案，管理员沙盒仅创建者可访问；不能据此宣称已经实现“教师仅可访问自己授课课程”的新规则。新账号资料同步、共享权限撤销/GPU 镜像、完整素材工作流、并发容量、最终数据交接和公网 HTTPS 仍是正式切换前的条件。

## 部署范围

- 仍只运行一个 PostgreSQL 实例 `village-api-validation-postgres`，不重启该实例。
- 从原已校验归档恢复新数据库 `village_scene_validation`，不会向 `village_copy` 恢复或写入。
- 新 API `village-scene-validation-api` 只发布 `127.0.0.1:18082`，192 MiB、非 root、只读根文件系统、只挂载自己的私有密码文件。
- 新角色 `village_scene_login` 限 2 连接，NOINHERIT、非超级用户/非 BYPASSRLS；事务设置验证过的身份并切换 authenticated，API 仅调用固定 SQL。
- HBA 保留 A/B2 原行，仅增加相同内部网段、指定新数据库/新角色的 SCRAM 行，然后 reload；不开放 5432/18082 公网端口。
- 私有状态 `~/village-scene-validation`；备份和既有 A/B2 状态保留。中断后保留目录、数据库、日志，不删除重跑，也不执行 `down -v`。
- C1 写入只发生在测试库，Supabase 仍是正式网站主库。该副本是 2026-10-15 的快照，不自动同步后续线上变化。

## 1. 只上传这个新镜像

本机文件：

```text
C:\Users\MR\village-image-transfer\village-business-api-stage-c1-scene-amd64.tar.gz
```

在阿里云 Workbench 文件管理上传到：

```text
/home/admin/village-db-backups/20261015T034526Z-_bfzxy5z/
```

不是源码/网站 public 目录。无需重新上传 PostgreSQL、A 或 B2 镜像。归档不含密码或业务数据；大小、哈希、平台和可接受镜像 ID 由 Git 中 `linux/scene-write-image.json` 指定。

## 2. 更新并加载

先检查；如果出现未提交改动，保留并反馈，不 reset/clean：

```bash
cd ~/village-deploy/source
git status --short --branch
```

目录干净后：

```bash
git pull --ff-only origin main &&
python3 linux/scripts/deploy-scene-write-validation.py --load-image &&
python3 linux/scripts/deploy-scene-write-validation.py --check
```

`--load-image` 先验证既有 A/B2 验收身份、私有备份及上传镜像的完整 SHA-256，再导入镜像，并执行无网络 Node 22/场景模块 smoke test。应依次看到：

```text
SCENE_IMAGE_ARCHIVE_VERIFIED_LOADED
SCENE_WRITE_PREFLIGHT_OK
```

如果 C1 容器已存在，加载器拒绝替换其镜像。预检查要求至少 384 MiB available 和 4 GiB 空闲磁盘，并确认新数据库/角色/状态/端口不存在。检查失败不会创建数据库或停止已有容器。

## 3. 部署和真实保存验收

```bash
python3 linux/scripts/deploy-scene-write-validation.py --deploy &&
python3 linux/scripts/deploy-scene-write-validation.py --verify &&
python3 linux/scripts/probe-scene-write.py
```

部署先验证新库恢复后的 106 张含数据表/14 个序列与原归档计数一致，再创建 C1 角色和锁函数；不重放集群角色，不更改旧库数据。`--verify` 核对镜像/执行身份、隔离参数、网络、挂载、schema、角色和 HBA，重启 **C1 API** 并通过真实 TCP 验证数据库路径。它不重启 A、B2 或数据库。

probe 输入管理员网站学号（例如 `332`）及**网站登录密码**，隐藏输入；不是数据库密码或 Secret key。请在 `--verify` 后一小时内运行。probe 会：

1. 拒绝无令牌访问，验证原 Supabase 登录。
2. 从独立测试库选择已有教学项目/村庄/空间上下文，优先练习共享空间，以 `admin_sandbox` 和 `C1 validation` 标题创建仅管理员本人可访问的新测试方案；不要求快照中已存在正式 `group_plan` 空间。
3. 保存一张测试长椅并读回，确认旧 revision 再保存得到 409。
4. 创建里程碑、恢复新草稿、创建分支、提交里程碑。
5. 再重启 C1 API，重新读取原方案、里程碑、恢复和分支，确认持久性。

测试保留 3 个新草稿/方案与 1 个里程碑；不修改旧方案，不删测试数据，失败现场记录在私有 `probe-state.json`。不会向 Supabase 写入这些方案，也不会提交 GPU 任务。网络失败不自动重试写入；再次执行属于用户发起的新测试，会保留之前的测试记录。

只有最后看到以下标记才表示 **C1 云端内部验收通过**：

```text
SCENE_WRITE_INTERNAL_VALIDATED_NOT_CUT_OVER
```

失败时只发送终端最后的固定错误阶段；不要发送密码、token、SQL、私有 JSON 报告或业务行。不要靠改前端 URL 绕过测试。

### 已部署后出现 `phase=context`

旧探测脚本仅选择 `group_plan`，而这份已校验快照只有练习/历史空间，正式组方案空间数为 0，因此会在登录成功后停止。修复后的探测使用源场景 RPC 已支持的管理员沙盒；只读选择已有上下文，不创建组空间或修改课程数据，也不需要新镜像或重部署。

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 linux/scripts/deploy-scene-write-validation.py --verify &&
python3 linux/scripts/probe-scene-write.py
```

仍输入管理员学号与网站登录密码。新的安全诊断 `ADMIN_PROFILE_REQUIRED` 表示候选资料中该身份不是管理员，`NO_VALID_SCENE_CONTEXT` 表示没有可关联的项目/村庄/空间，`CONTEXT_QUERY_FAILED` 表示查询失败；不会打印私有行或令牌。不要再次运行 `--deploy` 覆盖已经存在的测试库。

## 验收范围及后续

本机使用 PostgreSQL 17.11 和源 Scene Edit SQL 的合成场景，验证跨组、教师/管理员、沙盒、成员撤销、并发保存、回滚、版本恢复；阿里云是 PostgreSQL 17.6，必须再执行上述实际候选和登录探测。云端管理员探测不等同于云端多学生并发/跨账号验收。

本次没有本机 Docker，离线镜像按固定官方 Node 基础配置/层哈希及已锁定纯 JS 依赖组装，镜像内 Linux/Node 22 执行仍由 `--load-image` 在阿里云完成。Windows 无原生 symlink 权限的测试仍有跳过，不冒充 Linux 文件攻防验收。

通过后记录 C1 实际输出和资源观察，再接 C2 上传/删除、调查和规划写入、通知、权限/GPU 输入桥接。最终 D 阶段仍需冻结旧写入、刷新最新数据及文件、配置 HTTPS，再逐模块切换。阿里云正式接收新业务写入后的回退需要回补新数据，不能仅把地址改回 Supabase。

暂停 C1 API 可在确认对象名称后执行 `sudo docker update --restart=no village-scene-validation-api` 和 `sudo docker stop village-scene-validation-api`；数据库和数据保留，A/B2 不停止。恢复使用私有 Compose 的 `up -d --pull never --no-build api` 并重新 `--verify`/probe；不通过重新 `--deploy` 覆盖旧测试库。
