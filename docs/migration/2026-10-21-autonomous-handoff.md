# 阿里云独立平台：一次实施清单

本清单替代 `2026-10-20-unified-final-handoff.md` 的旧任务桥接流程。先不要执行旧 `prepare-unified-cutover.py`、源端 Edge SQL 或旧 Worker 桥接更新。

目标是 `https://8.148.248.237` 使用自己的认证、数据库、照片/模型文件、任务队列与结果；4090仍在校园内计算，主动向该 HTTPS 地址取任务。GitHub Pages 与原 Supabase 保留原连接和切换时的基线，两边后续写入独立，不会自动同步。切换后请在阿里云站点开展新业务；阿里云自己的定时备份负责保存新增数据。

## 当前边界

发布镜像与整套隔离验收已就绪，运行提交 `44d05dddb594`；[发布证明](2026-10-21-autonomous-release-proof.md)记录了精确摘要与成功 CI。实际阿里云 CA 申请、原账号密码验证、真实浏览器及4090输出质量尚未验收。当前运行网站及原 Supabase 均未由本次本地开发切换。

## 1. 在 Windows 生成一个私有上传包

先暂停在原网站新增/修改数据，等待旧图底/立面任务结束。保留 Supabase 和现有 GitHub Pages，不执行删除、清库或源端安装 SQL。最终快照需在24小时内用于候选部署。

在本机 PowerShell 执行：

```powershell
cd 'E:\研究生工作\332工作\3D村庄规划网页\village-storymap-GIT'
git pull --ff-only origin main
& 'E:\anaconda3\python.exe' -X utf8 linux/scripts/prepare-autonomous-handoff.py --prepare `
  --output "$env:USERPROFILE\village-autonomous-handoff\village-autonomous-private.tar"
```

依次隐藏输入两个不同的值：Supabase **数据库密码**，以及 `sb_secret_...` **服务端 Secret key**。这里不输入网站登录密码、Publishable key。工具生成新一致性数据库快照，兼容检查原用户 UUID/密码哈希，复制所有存储桶的真实文件（包括旧阶段排除的 GPU 输入/结果），验证源库存及每份文件摘要，再与固定镜像打成一个包。它不写入 Supabase，也不会打包这两个输入的原始密钥。

成功标记：`AUTONOMOUS_FRESH_PRIVATE_HANDOFF_PACKED_NOT_DEPLOYED`。记录它打印的整个包 SHA256。只上传这一份 `.tar` 到阿里云 `/home/admin/`，不用自行解压。包内包含数据库密码哈希和私有文件，不能放 GitHub、网站目录或公开网盘。

如之前生成的同名包已存在，换一个新文件名；工具不会覆盖旧包。网络中断时保留旧快照/部分文件，不删除数据来重试。

## 2. 在阿里云完成候选验证和切换

阿里云防火墙允许 TCP80和443；数据库5432不开放公网。以现有 `admin` 登录 Workbench，执行：

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
chmod 600 ~/village-autonomous-private.tar &&
sha256sum ~/village-autonomous-private.tar
```

确认这一行摘要与本机生成的完全一致，然后执行：

```bash
cd ~/village-deploy/source &&
python3 linux/scripts/prepare-autonomous-handoff.py \
  --unpack "$HOME/village-autonomous-private.tar" \
  --output "$HOME/village-autonomous-handoff-received" &&
python3 linux/scripts/install-autonomous-handoff.py \
  --received "$HOME/village-autonomous-handoff-received"
```

接收目录必须是尚不存在的新目录。整个流程会加载已验证镜像、保留旧HTTP网站并先验证ACME路径、测试并申请受信任的IP证书、停止5个指定旧候选容器以释放内存、创建新的独立数据库/Auth/API、恢复完整数据和文件、进行重启验证，然后请求网站账号进行整套验收。

提示时输入管理员学号 `332` 和它的**网站登录密码**，再输入现有学生账号（如 `25213040`）及对应网站密码，均为终端隐藏输入。脚本只在新库创建标有 Autonomous TEST 的验收上下文，不改变原 Supabase 成员关系。它检验本地登录/刷新/退出、普通业务、照片/模型/场景与版本、1/5/10/20并发以及重启后的持久化。

这些门槛通过后，工具先制作阿里云自己的私有备份，再将网页的80/443监听切换到新服务，测试证书续期并安装证书续期/每日备份计时器。无需购买域名来完成本次IP技术验证。

最终核心成功标记：`AUTONOMOUS_PUBLIC_CORE_INSTALLED_BROWSER_AND_REAL_GPU_ACCEPTANCE_PENDING`。它明确还不代表真实4090任务已验收。

**任何 STOP 都保留现场。** 不执行 `docker compose down -v`、删除数据目录、旧桥接切换或盲目重跑公开切换。只返回阶段/类别/成功标记；不贴私有日志、数据库行、令牌、密码或整个环境文件。公开监听一旦尝试切换，工具不会自动把写入退回 Supabase，以免新增数据分叉后被覆盖。

## 3. 检查阿里云站点

打开 `https://8.148.248.237`，确认证书受信任。原账号重新登录，查看原照片、模型、个人/小组空间；保存一次2D编辑和3D场景，建一个版本，刷新后再打开。浏览器 Network 中认证/业务/文件应请求该 IP 的同源路径，不应向 Supabase 发出新的认证/业务请求。旧标签页请退出并关闭，避免继续向原基线写入。

以服务器 `admin` 执行以下只读检查：

```bash
sudo docker stats --no-stream village-autonomous-api village-autonomous-auth village-autonomous-postgres village-autonomous-web
free -h
systemctl list-timers village-autonomous-tls.timer village-autonomous-backup.timer
```

2GB实例只承载网站/API/Auth/数据库，深度学习仍在4090运行。空闲内存不等于并发能力，整套验证会记录资源与失败；实际超限时保留数据并按测量结果扩容，不用放宽内存限制来掩盖问题。

## 4. 只切换4090上的两个 Worker

从阿里云下载这份**私有**文件到校园4090的用户家目录，保持文件名，不能公开或贴聊天：

```text
/home/admin/village-autonomous/worker-credentials.tar.gz
```

在校园 Linux 的项目目录执行（保留原 `linux/gpu.env`、`/etc/village-platform/worker.env` 权限）：

```bash
cd /media/gpu332/newapply/village-storymap &&
git status --short --branch &&
git pull --ff-only origin main &&
chmod 600 ~/worker-credentials.tar.gz &&
python3 linux/scripts/install-autonomous-workers.py --check
```

如果项目有未提交改动、镜像/用户/挂载/网络与现有配置不匹配，先停在检查阶段，不切分支、不覆盖原文件。检查通过并确认原网站任务已全部结束后执行：

```bash
python3 linux/scripts/install-autonomous-workers.py \
  --apply --source-workers-idle \
  --credentials "$HOME/worker-credentials.tar.gz"
```

安装器从当前实际本地 Worker 镜像构建无网络代码覆盖层，不安装/下载模型；仅通过 `--no-deps` 更新 geo-worker、facade-worker。新密钥另存，按容器实际要求的10001用户保持0600；不更改原worker.env权限。模型目录、GPU锁、推理服务、其他4个项目容器和师姐8081等服务保留。验证从**实际容器内**使用有效TLS和私有密钥连接阿里云，并核对其他容器未被更换/停止。

成功标记：`two_workers_https_verified_real_gpu_jobs_pending`。如当前Worker缺少 egress 网络，检查会明确停止；不要仅凭宿主机curl成功就认定容器能够联网。

源数据集 UUID 一致时自动建立映射；其他别名必须经核对后在阿里云使用 `~/village-autonomous/control/provision-local-workers.py --map-village 本地村庄UUID 现有数据集ID` 明确登记。不会猜测或替换已有映射。

## 5. 一次真实全流程验收

全部在阿里云网址操作：

1. 新注册一个测试账号，退出、重新登录、刷新会话，确认原账号权限和数据归属。
2. 从2D界面上传照片，运行白模贴图的矫正/裁剪/生成，显示本地状态与结果，导入3D并保存版本。
3. 发起图底关系任务，由校园4090完成，查看结果并导入目标空间；刷新/重新打开后仍可读取。
4. 在安全的测试任务验证取消/重试，确认结果不串账号或空间。
5. 查看两个Worker与云端资源，确认其他服务正常；必要时重复使用验证命令，不重做迁移或清库。

真实GPU/提供商验收与合成CI分开记录。可选付费云立面默认关闭；本轮不会自动调用或计费，也不能将它标为已实测。

## 备份和恢复边界

每日04:15上海时间备份，繁忙任务时跳过并以15分钟间隔有限重试；证书每6小时检查续期。旧备份保留，空间不足停止并报告，不会自动删除。备份包含自己的数据库、文件、认证/Worker私钥、配置和证书，位于 `/home/admin/village-autonomous-backups/`；应另存受保护的离机副本。

可手动运行一次：`python3 ~/village-autonomous/control/backup-autonomous.py`。常规备份标记只证明完整归档和离线解码，不能替代实际恢复演练；发布CI另在全新临时数据库验证了合成快照的恢复路径后才会记录证明。禁止把阿里云新数据自动回灌旧Supabase，或以旧Supabase基线覆盖已经产生新数据的阿里云。
