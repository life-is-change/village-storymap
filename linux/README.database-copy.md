# 阿里云数据库副本验证

本阶段先复制数据库备份到阿里云私有目录，再核对隔离恢复的兼容性。网站和 4090 继续访问原 Supabase。2 GB 服务器上的数据库副本验证不等于部署了完整 Supabase。

## 1. 从 GitHub 更新操作脚本

在阿里云 `admin` 的终端分别执行。先查看未提交改动；若有输出，停止并保留改动，不要 reset/clean。

```bash
cd ~/village-deploy/source
git status --short
```

工作目录无改动后：

```bash
git pull --ff-only origin main
bash linux/scripts/install-db-copy-clients.sh
```

安装程序仅添加 PostgreSQL 官方 PGDG 软件源并安装 PostgreSQL 17 **客户端**。不会安装 PostgreSQL 数据库服务，也不拉取 Docker 镜像。Ubuntu 24.04 默认客户端版本不足以备份本项目的 PostgreSQL 17 源。

官方客户端来源：<https://www.postgresql.org/download/linux/ubuntu/>。

## 2. 隐藏输入密码并备份

单独执行以下命令，等待提示后输入 Supabase 数据库密码。输入时屏幕不显示字符，这是正常的。不要把密码、SQL 文件或 dump 文件贴到聊天中。

```bash
python3 linux/scripts/backup-managed-db.py
```

本项目固定源为 `aws-1-ap-northeast-1.pooler.supabase.com:5432`，用户为 `postgres.rzmbmwauomzwiyenafha`，数据库为 `postgres`；这是已核对的 IPv4 Session pooler，不使用 Transaction pooler。连接采用 `verify-full` 与后台下载的 Supabase CA，不能在连接失败时关闭证书验证。

证书文件为 `linux/certs/supabase-prod-ca-2021.crt`，来源是已登录的 Supabase Database Settings → Download certificate：
<https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>。
文件 SHA-256 为 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`。
如项目后台更换了证书，先从可信后台取得新证书，再通过 `--ssl-root-cert <文件路径>` 指定，不关闭校验。

输出保存至 `~/village-db-backups/<UTC时间及随机后缀>/`。Linux 目录权限 0700，最终文件权限 0600；Windows 通过 NTFS ACL 取消继承并授予当前用户和 SYSTEM 访问权限，本机管理员及所有者权限可能保留：

- `database.dump`：一致性快照的 custom 格式数据库备份，包含源数据库可读取的 schema、表数据、序列、RLS、授权与函数定义；任意导出错误都停止。
- `roles.sql`：角色定义和成员关系，**不包含数据库角色密码**。
- `inventory.json`：源版本、扩展、表名及观察时刻的用户/对象数量；这些数量不是 dump 快照的精确校验值。
- `contents.txt`：备份目录清单。
- `manifest.json`：文件大小、SHA-256 和验证范围说明。

程序在导出后离线解码整个归档，验证包含 `auth.users` 的表数据，再写成功 manifest。成功标记是 `DB_BACKUP_ARCHIVE_VERIFIED_NOT_RESTORED`，明确表示**已校验归档、尚未恢复数据库**。失败时 `.partial` 文件保留，临时密码文件清除，不覆盖旧备份。

数据库备份包含认证用户密码哈希等私有内容，必须保留在该私有目录，不能上传 GitHub、放进 `public` 或以 Nginx 提供下载。

## Windows 本机转存路径

当阿里云访问数据库端口在认证前被重置，而本机能连通时，先在本机备份，再用私有传输渠道上传阿里云。HTTPS API 能访问，不代表 PostgreSQL 5432/6543 端口也可用。

Windows 使用同一个 Python 脚本，隐藏输入密码，保留证书与主机名校验。先从 PostgreSQL 官方页面指向的 EDB 二进制包获取 PostgreSQL 17 客户端：
<https://www.postgresql.org/download/windows/>。
只需客户端文件，不安装或启动本地数据库服务。

本机已准备的客户端目录为 `%USERPROFILE%\.codex\tools\village-pg17\pgsql\bin`，脚本会自动选择此目录。其他位置的客户端使用 `--bin-dir <bin目录>` 指定。准备客户端时使用的 EDB 17.11-5 原始压缩包 SHA-256 是 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`；发布方校验值见 <https://github.com/EnterpriseDB/edb-installers/issues/731>。实际客户端 `pg_dump --version` 已核对为 17.11。

在本机项目目录打开 PowerShell：

```powershell
python .\linux\scripts\backup-managed-db.py
```

Windows 输出默认在 `%USERPROFILE%\village-db-backups`，不会进入 Git。临时 pgpass 位于受保护的备份子目录中，退出时清除。PowerShell 的密码提示必须在交互终端中输入，不能把密码写入命令参数或聊天。

2026-10-15 的无密码实测：本机客户端使用上述 CA 已完成 TLS 验证并返回 `fe_sendauth: no password supplied`；阿里云 443 的 HTTPS 返回 404，而连接池 5432/6543 的 PostgreSQL TLS 探测均被重置。这验证了本机路径可进入认证阶段，不证明密码已通过，也尚未导出数据。具体网络重置位置仍未确定。

## 3. 之后的隔离恢复

先审核实际 archive/roles，再使用 Supabase 官方 `supabase/postgres:17.6.1.136` 对应 PostgreSQL 17 环境做恢复验证。源使用 PostGIS 3.3.7、Supabase Vault 0.3.1 等扩展，不可直接假设普通 `postgres:17` 能完整恢复。目标只运行数据库容器、使用内部网络、不发布数据库端口，并限制内存。已有目标数据不得重置或覆盖。

本工具保留原始归档以便检查。**不能直接把 managed 平台的原始内部对象 SQL 覆盖到完整自托管 Supabase 上**；后续须核对预置角色、内部 schema 和服务版本，必要时采用官方 CLI 的过滤备份路径。扩展安装仅复制扩展定义，不能证明 Vault 的解密密钥也迁移成功。

恢复验收需要核对表、约束、索引、RLS、授权、函数、序列、Auth 用户与 Storage 元数据，测试容器重启与内存使用。不得仅看到 `container running` 就宣布迁移完成。

## 范围限制

- 数据库备份不包含 Storage 文件本体、API/JWT 密钥、登录服务设置、SMTP 或 Edge Functions。Storage 文件另行复制。
- Role 登录密码需要在隔离目标重新设置；原平台密码仍然有效，不进行密码轮换。
- 保留的原 Supabase 不会自动同步以后切换到新端点后的写入。
- 完整 Auth/API/Storage/Realtime 切换、4090 Worker 改址与性能比较属于后续验收，本阶段没有自动切换。

参考：<https://supabase.com/docs/guides/self-hosting/restore-from-platform>。
