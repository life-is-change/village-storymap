# 阿里云业务 API：内部验证阶段

本阶段提供只读业务 API，尚未切换网站读写或搬迁 Storage 文件。登录仍由原 Supabase 验证，4090 配置不变。代码由本地 main 经 GitHub 更新；下述阿里云命令由用户手动执行。

## 当前验收范围

- 本地已测试固定路由、令牌拒绝、连接回滚、跨用户隔离和原平台前端回归。
- 本机 PostgreSQL 17.11 的合成数据库测试不等于阿里云 PostgreSQL 17.6 验收。
- 当前电脑没有 Docker；离线镜像按固定官方 Node 基础配置/层摘要与 `npm ci --omit=dev` 的纯 JS 依赖组装，原始及解压层摘要均校验。2026-10-16 用户在阿里云完成了 Node 版本和 `pg` 导入 smoke test；完整 API 启动、数据库权限与登录验收仍待后续步骤。
- `linux/business-api-image.json` 记录镜像、运行代码摘要、可接受的导入 ID、传输文件名/大小/哈希。镜像只包含业务 API，不包含数据备份或数据库密码。

## 1. 更新脚本并上传镜像

先在阿里云检查 main 干净，不要 reset/clean：

```bash
cd ~/village-deploy/source
git status --short --branch
```

工作目录干净后执行 `git pull --ff-only origin main`。从本机 `C:\Users\MR\village-image-transfer\` 上传 `linux/business-api-image.json` 指定的 `archive_filename`，目标仍是私有备份目录：

```text
/home/admin/village-db-backups/20261015T034526Z-_bfzxy5z/
```

不是网站 `public`，也不是 Git 仓库。上传文件后在阿里云校验、导入和测试：

```bash
cd ~/village-deploy/source
python3 - <<'PY'
from pathlib import Path
import hashlib, json
m = json.loads(Path('linux/business-api-image.json').read_text())
p = Path.home() / 'village-db-backups/20261015T034526Z-_bfzxy5z' / m['archive_filename']
assert p.is_file() and not p.is_symlink()
assert p.stat().st_size == m['archive_bytes']
with p.open('rb') as f:
    h = hashlib.sha256()
    for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
assert h.hexdigest() == m['archive_sha256']
print('API_IMAGE_ARCHIVE_CHECKSUM_OK')
PY
```

校验通过后（当前传输文件名见下方；如元数据更新，以其中的文件名为准）：

```bash
sudo docker load -i "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z/village-business-api-stage-a1-amd64.tar.gz" &&
sudo docker run --rm --pull=never --network none --entrypoint node village-business-api:stage-a1 --version &&
sudo docker run --rm --pull=never --network none --entrypoint node village-business-api:stage-a1 -e "import('pg').then(()=>console.log('API_RUNTIME_IMPORT_OK')).catch(()=>process.exit(1))"
```

加载归档自带 `village-business-api:stage-a1` 标签，不需要手动猜镜像 ID。任何一步失败就停止并保留输出；不要因此修改 daemon 镜像源或覆盖已有数据库。

Docker 的 containerd 镜像存储可能用压缩层清单摘要作为导入 ID，而非配置摘要。构建脚本从归档原始字节计算压缩/解压层的 Docker、OCI 清单摘要，使用注册表描述符的 `mediaType,digest,size` 序列化顺序；不会直接信任服务器报告的未知 ID。当前归档对应的 Docker 压缩清单 ID 为 `sha256:0dd84bcfc962a3ef5f49a5babe6a6a52ec78dc4ac64b9f276f0577ccb1458f3e`。旧脚本拒绝此 ID 时，保持镜像不动，拉取修复后的 main 再运行 `--check`；无需重新上传镜像。

## 2. 检查再部署候选环境

先运行只读检查：

```bash
python3 linux/scripts/deploy-business-api-validation.py \
  --backup-dir "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z" \
  --check
```

应看到 `BUSINESS_API_PREFLIGHT_OK`。检查匹配的备份/已验收副本、Docker 镜像身份、目录、端口及至少 900 MiB 可用内存、4 GiB 磁盘余量；检查失败不会停止容器。

通过后再运行：

```bash
python3 linux/scripts/deploy-business-api-validation.py \
  --backup-dir "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z" \
  --deploy
```

部署会停止且关闭原验证数据库的自动重启，保留其数据、Compose、密码和报告；将备份恢复到独立 `~/village-api-validation/db`。候选 DB 改为内部 Docker 网络，API 只监听宿主机 `127.0.0.1:18080`，数据库不发布端口。API 密码由脚本本地生成并私有保存，不需要原数据库密码或 service-role key。

`BUSINESS_API_INTERNAL_DEPLOYED_NOT_ACCEPTED` 仅表示部署和健康检查通过，尚未完成用户/权限验收。目录或容器已存在时默认拒绝，不能靠删除重跑。中途失败可能留下已停止的原副本和部分候选，全部保留并检查私有日志。

`linux/compose.business-api-validation.yaml` 是 admin UID/GID=1000 的配置示例；实际脚本按操作者 UID/GID 生成私有 runtime-compose.json。不要直接把示例作为线上 Compose 覆盖原部署。

## 3. 真实候选和登录验收

`verify-business-api-candidate.py` 与 `probe-business-api.py` 分别检查实际候选权限/重启和现有用户的端到端访问。部署通过后执行：

```bash
python3 linux/scripts/verify-business-api-candidate.py \
  --backup-dir "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z"
python3 linux/scripts/probe-business-api.py
```

probe 会提示输入**网站学号和网站登录密码**，密码隐藏输入；不是数据库密码。只打印状态、数量和阶段耗时，不打印令牌、个人资料或 SQL。Auth 服务不可用时不会换库重试。

只有真实候选权限/重启检查和登录 probe 都通过，才能看到 `BUSINESS_API_INTERNAL_VALIDATED_NOT_CUT_OVER`。出现此标记仍然没有切换线上业务。请在权限/重启检查通过后一小时内完成登录 probe；超时或其间重启/重建了候选容器，需要重新执行权限/重启检查。每次检查先归档原报告并使其失效，失败的检查不能继续借用旧成功报告。报告还会绑定当前容器的镜像、ID 和启动时间。

可选的本机访问方式：在本机 PowerShell 运行 `ssh -N -L 18080:127.0.0.1:18080 admin@8.148.248.237`，然后访问本机 `http://127.0.0.1:18080/healthz`。仅内部测试，无需开放服务器 18080/5432 防火墙端口。公网业务接入前需完成 HTTPS 入口和后续阶段。

## 停止候选与保留数据

```bash
python3 linux/scripts/deploy-business-api-validation.py \
  --backup-dir "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z" \
  --stop
```

它核对目标后关闭候选 API/DB 的自动重启并停止容器，不删除卷。不会自动重新启动旧数据库，避免两个数据库争用内存。需要恢复原副本时，先确认候选两个容器已停止、原副本的镜像/挂载/验收报告匹配，再恢复记录在 `~/village-api-validation/deployment-checkpoint.json` 的原副本重启策略并启动；失败现场须先检查，不提供自动 reset 或 `down -v`。

## 后续仍未迁移

Storage 文件本体及其访问服务、调查/规划/三维写入、协作通知、任务依赖同步/撤销、GPU 输入桥接和最终数据交接属于后续交付。不能把原全局 Supabase URL 改为 PostgreSQL 地址；阶段 A 的前端适配器默认未接入线上。
