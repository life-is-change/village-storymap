# 普通业务文件私有复制（B1）

阶段 A 的候选数据库/只读 API 已在阿里云验收。本阶段只下载文件副本；不改网站、原 Supabase 数据/文件、4090 配置或公开存储权限。

## 1. 更新并盘点（无需密钥）

在阿里云终端，以原来的 `admin` 用户执行。先确认 `git status --short --branch` 没有本地改动，再运行：

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 linux/scripts/inventory-business-storage.py
```

预期输出桶数量/字节汇总和 `STORAGE_INVENTORY_EXPORTED_NOT_COPIED`。私有清单保存在：

```text
/home/admin/village-storage-copy/stage-b1/inventory.json
```

清单来自候选旧快照；五个普通业务桶可复制，其余桶只统计。完整数据库曾有 137 条对象元数据，不代表本次选择的文件数量，也不代表文件本体已存在。盘点不需要数据库密码或新镜像。

已有此运行目录时盘点会拒绝覆盖。不要删除重跑；已有清单可继续下一步。若候选在验收后被重建或重启，导出会拒绝失配的验收报告，需先重新做阶段 A 验收。

## 2. 隐藏输入密钥并复制

仅当盘点成功后执行：

```bash
python3 linux/scripts/copy-business-storage.py
```

看到 `Supabase SERVER Secret key (hidden; NOT database password):` 后，复制 Supabase **Secret keys** 页面 `default` 的密钥，在终端粘贴并按回车。看不见字符是正常现象。无需把密钥发给聊天，也不放在命令、Git、镜像或网页中；默认只在本次进程内使用。旧版 service_role key 同样支持，Publishable/anon key 和数据库密码不适用。

脚本仅向固定项目的已验证 HTTPS 源发送密钥。先用 HEAD 获取大小和 ETag，再用条件 GET 分块下载；每个文件落盘后重算 SHA-256、复查源 ETag。预留至少 4 GiB 空间，CPU/内存按单进程 1 MiB 分块控制。复制期间可能数分钟没有新的输出。

已验证文件保存在 `stage-b1/blobs/<sha256>`，桶/原对象名映射在私有 `copy-manifest.json`。目录 0700、文件 0600，不放 Nginx public 目录；私有文件不会因复制变成公开下载地址。

## 3. 独立本地校验

复制命令会自动做一次校验。也可随时重新运行以下命令，**不需要密钥**：

```bash
python3 linux/scripts/copy-business-storage.py --verify-only
```

所有选定对象都已完成且重新核对字节数/摘要后，输出 `STORAGE_PRIVATE_COPY_VERIFIED_NOT_CUT_OVER`。有缺失、源变化、失败或未完成项时输出 `STORAGE_PRIVATE_COPY_INCOMPLETE`，不会报告全量成功。只把汇总和最终标记发到聊天，不上传私有清单、对象路径或密钥。

源库仍在线，文件元数据可能与旧快照不同。同长度文件如果没有快照 ETag，也不能证明它是历史快照时点的相同内容。本标记证明收取并落盘的字节与清单摘要匹配，不证明数据库与文件的原子时间点一致；所有对象都保留最终刷新需求，正式切换前另做冻结和刷新。

## 中断与失败

在确认上一进程已结束后续跑：

```bash
python3 linux/scripts/copy-business-storage.py --resume
```

续跑重新核对完成文件，部分文件保留为私有 `.partial`，从头重取失败对象，不覆盖已有内容副本。相同内容的重复临时副本也保留；可在整个迁移结束后核对清理，不在复制过程中删除证据。

- `STORAGE_SOURCE_HTTP_401/403`：源端未接受服务端密钥/访问权限，停止复制；重新核对密钥类型及项目，勿发送密钥内容。
- `missing`：源对象缺失；`source_changed`：源大小/ETag 与快照或传输前后不一致。保留现场，最终刷新阶段处理，不绕过核对硬标完成。
- `STORAGE_DISK_RESERVE_REQUIRED`：可用磁盘不足以维持预留量；先检查磁盘和对象总量，不降低限制盲目继续。
- `STORAGE_SOURCE_CONNECTION_FAILED`：源 HTTPS/TLS/连接故障；不会改用 HTTP、关闭证书验证或跟随外站重定向。
- 活跃复制使用私有 `.transfer.lock`，正常退出释放它；进程被强制终止时可能残留。存在锁时不要同时启动另一复制，也不要直接删除目录/锁；先核对原进程是否仍运行。

文件读写/续跑均在现有私有目录进行；不安装服务、不启动第二个数据库、不执行源 SQL、上传或删除。可选 `--key-file` 只读取操作者已私有保存的凭据文件；不负责创建凭据文件。默认隐藏输入即可。

## 仍未交付的后续阶段

B2 按用户/课程/空间授权提供文件读取/上传/删除服务；C 适配完整业务模块、协作和 GPU 依赖桥接；D 刷新最新数据并正式切换。不能把本次私有文件复制当作网站已改用阿里云数据库或文件服务。

官方核对：[API key 类型和请求头](https://supabase.com/docs/guides/getting-started/api-keys)、[Storage 对象 GET](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts)、[Storage HEAD](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObjectInfo.ts)。新版 Secret key 通过 `apikey`，不当用户 JWT；旧版 service_role 使用其原 JWT 请求头。
