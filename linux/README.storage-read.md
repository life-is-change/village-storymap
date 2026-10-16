# B2 候选文件读取服务

本交付提供已复制普通业务文件的授权 GET/HEAD/单段 Range 读取，不提供上传、删除或正式网站切换。源 Supabase、4090、A API 和数据库保持原配置。文件仍来自已验证旧快照；最终切换前必须刷新。

## 部署位置与权限

- 新 API：`village-storage-validation-api`，仅 `127.0.0.1:18081`，上限 192 MiB；复用 A 的内部数据库网络，不启动第二个数据库。
- 新私有状态：`/home/admin/village-storage-api-validation/`（0700），索引/检查点/报告为 0600。
- B1 blobs 目录只读挂载；索引和现有最小权限 API 数据库口令只读挂载。不挂载源 Secret、bootstrap 口令、备份归档或 Docker socket。
- 接口：`GET|HEAD /api/v1/files/<对象 UUID>`。验证现有 Supabase 登录身份，再以 authenticated 角色做只读 SQL；Storage RLS 和明确桶谓词共同过滤。索引和文件摘要不会替代权限校验。
- `group-models` 遵循共享/本人/所属组/管理员规则；场景和村庄文件调用已有权限函数。`house-photos` 原有读取规则允许所有已登录用户；本次没有把它改为课程私有，也不提供匿名读取。
- 每次响应前从同一文件句柄重算摘要，再流式发送；单文件最多 50 MiB，同时最多 4 个读取，1 MiB 哈希缓冲、64 KiB 流缓冲。不提供目录列表或令牌 URL，响应 `no-store`、`nosniff`、attachment。

## 1. 在本机找到并上传镜像

仅上传这一个文件（无需重新上传 PostgreSQL 镜像或数据库备份）：

```text
C:\Users\MR\village-image-transfer\village-business-api-stage-b2-read-amd64.tar.gz
```

在阿里云 Workbench 文件管理中进入以下目录，再点击上传文件：

```text
/home/admin/village-db-backups/20261015T034526Z-_bfzxy5z/
```

镜像压缩包不含业务数据、密码、令牌或 B1 索引；镜像身份由已提交的 `linux/storage-read-image.json` 校验。API 旧镜像 `stage-a1` 保留。

## 2. 阿里云更新代码并校验上传文件

以原来的非 root `admin` 用户执行。先运行 `git status --short --branch`；有本地改动时保留现场，不强行覆盖。

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 - <<'PY'
from pathlib import Path
import hashlib, json
m = json.loads(Path('linux/storage-read-image.json').read_text())
p = Path.home() / 'village-db-backups/20261015T034526Z-_bfzxy5z' / m['archive_filename']
assert p.is_file() and not p.is_symlink()
assert p.stat().st_size == m['archive_bytes']
with p.open('rb') as f:
    assert hashlib.file_digest(f, 'sha256').hexdigest() == m['archive_sha256']
print('STORAGE_READ_IMAGE_ARCHIVE_OK')
PY
```

## 3. 导入并核对 Linux 运行时

只有上一步成功后执行：

```bash
sudo docker load -i "$HOME/village-db-backups/20261015T034526Z-_bfzxy5z/village-business-api-stage-b2-read-amd64.tar.gz" &&
sudo docker run --rm --pull=never --network none --entrypoint node village-business-api:stage-b2-read --version &&
sudo docker run --rm --pull=never --network none --entrypoint node village-business-api:stage-b2-read -e "import('./src/storage.mjs').then(()=>console.log('STORAGE_RUNTIME_IMPORT_OK')).catch(()=>process.exit(1))"
```

预期 Node 22.23.3 和 `STORAGE_RUNTIME_IMPORT_OK`。不要凭其他镜像 ID 手动重打标签；后续检查会核对归档推导的真实 ID、平台和代码摘要。

## 4. 检查并创建独立候选

```bash
python3 linux/scripts/deploy-storage-read-validation.py --check &&
python3 linux/scripts/deploy-storage-read-validation.py --deploy
```

检查会确认 A 的已验收运行身份未变化、B1 文件全部校验、数据库对象与索引匹配、实际存储 RLS/账号权限存在、镜像正确、256 MiB 可用内存及 4 GiB 磁盘余量。检查不启动容器或修改数据库数据。部署只创建新 API，不重启数据库、A API 或 Nginx。

成功标记：`STORAGE_READ_INTERNAL_DEPLOYED_NOT_ACCEPTED`。不要把它当作文件访问验收完成。

## 5. 重启持久性与真实账号读取验收

```bash
python3 linux/scripts/deploy-storage-read-validation.py --verify &&
python3 linux/scripts/probe-storage-read.py
```

`--verify` 只重启 B2 API，重新核对文件、网络、容器身份，并通过真实 API 账号/TCP 验证存储查询。之后探针提示网站学号和网站登录密码，密码隐藏输入；不是数据库密码，也不需要 Secret key。可使用已有管理员学号 `332`。不要将密码、令牌、完整私有索引或对象路径发到聊天。

探针检查无令牌/无效令牌的拒绝；逐个下载可访问对象并核对字节和 SHA-256，再检查 HEAD 与 Range。学生访问被拒的对象计入 `denied`；至少一项可读才通过，管理员存在被拒对象则不能作完整管理员验收。输出仅包含计数/字节/桶汇总。

最终成功标记：

```text
STORAGE_READ_INTERNAL_VALIDATED_NOT_CUT_OVER
```

将最后的汇总和标记发到聊天。随后可观察新增 API 及主机资源：

```bash
sudo docker stats --no-stream village-storage-validation-api village-api-validation-api village-api-validation-postgres
free -h
```

这是实际文件读取验收，仍不表示正式网页已改用本地文件；完整业务写入/桥接和最终数据交接属于 C/D。

## 停止与恢复边界

已有 B2 状态时 `--deploy` 明确拒绝覆盖；不要删除数据或重复部署。成功部署后可重复 `--verify`，随后在一小时内运行登录探针。失败的尝试不会保留旧报告作为新的成功依据。

A API/数据库如果被重建或重启，B2 会拒绝旧运行指纹；先保留状态并核对原环境，再按明确修复步骤处理，禁止手动改验收 JSON。B1 文件损坏/变化、权限缺失或错误挂载也需要保留现场，不能降级为公开目录、跳过 RLS 或删除重跑。

需要暂停 B2 时，在核对候选身份后只停这个新容器（保留配置、索引、文件和数据库）：

```bash
sudo docker stop village-storage-validation-api
```

不执行 `down -v`、不清理 B1 文件、不删除原 Supabase 对象。
