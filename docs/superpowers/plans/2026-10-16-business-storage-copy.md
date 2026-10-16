# 普通业务对象文件私有复制实施计划（B1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the user's preserved native method. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已有候选快照引用的普通业务对象复制到阿里云私有持久化目录，逐文件核对字节数和 SHA-256，并提供可恢复的复制清单。

**Architecture:** 从已验收候选数据库只读盘点 Storage 元数据，在固定 Supabase HTTPS 源端只读下载；不更改源对象、网页 URL、数据库业务记录或 GPU 通道。复制文件保存为私有内容寻址对象，与原桶/路径的映射保存在私有清单；此交付不提供公网文件服务。

**Tech Stack:** Python 标准库、现有受限 Docker 管理封装、PostgreSQL 17.6、Supabase Storage HTTPS。下载单进程、1 MiB 分块，不在内存加载完整 GLB。

**Spec:** [已确认的混合迁移设计](../specs/2026-10-15-hybrid-database-migration-design.md)，阶段 B 的文件盘点和复制部分。阶段 A 的 [云端验收和空闲资源记录](../../migration/2026-10-16-stage-a-acceptance.md) 已完成。B2 的授权访问服务、C 的业务写入/桥接和 D 的最新数据交接另行计划。

## Global Constraints

- 在原项目 main 工作；本地检查/测试 → GitHub → 用户手动操作阿里云。保留既有数据、源端文件和所有其他任务的改动。
- “文件保存到仓库和静态网站根目录以外的持久化目录”；目录 0700、文件 0600。拒绝链接或越界路径，输出对象名不控制本地路径。
- “源 Storage 连接需要服务端授权”；密钥只由 getpass 隐藏输入或读取已私有保存的凭据文件。密钥不进入 CLI 参数、Git、静态前端、镜像、输出或异常正文。
- 允许的普通业务桶为 `house-photos`、`scene-assets`、`scene-version-previews`、`group-models`、`village-datasets`。照片可能也供 GPU 使用：这里只复制，不删除源对象或改变 Worker 引用。其余桶仅统计，`geoprocessing-results` 不搬迁。
- 源库仍在线变化。本次是文件副本，不宣称与旧数据库快照在同一时刻一致；源更新/缺失必须记录，阶段 D 冻结写入后还需最终刷新。
- 仅固定源 `https://rzmbmwauomzwiyenafha.supabase.co`；默认验证 TLS，拒绝重定向，不接受用户指定外域下载地址。原文件均保持私有。
- 主机需要保留至少 4 GiB 磁盘余量；下载前按已知对象大小估算，未知大小先核实。逐文件重新检查余量。没有空间时保留清单和已验证对象，停止下载。

## Review Focus

1. 一个源对象返回登录错误或源文件已变更：不能把错误正文或变化后的文件标作快照一致（Task 2）。
2. 对象名含中文、空格、`%`、路径分隔符或越界形式：URL 正确编码，本地只用内容摘要路径，危险源路径拒绝（Task 1/2）。
3. 上传者/源端仍在修改对象或同路径替换内容：记录源身份/ETag、传输状态及最终刷新需求，不静默覆盖旧副本（Task 2）。
4. 磁盘不足、连接中断或进程终止：完成对象只有重算哈希后可跳过，部分文件不能成为完成记录（Task 2）。
5. 一个私有照片复制成功：它不会因复制而进入 Nginx public、获得公开 URL，或被标记为 GPU 通道迁移完成（Task 3）。

## Files and interfaces

- Create `linux/scripts/inventory-business-storage.py`: 服务器只读导出；调用现有候选 runtime/checkpoint 验证及 Docker SQL，从 `storage.buckets`/`storage.objects` 获取所需元数据。
- Create `linux/scripts/business_storage_copy.py`: 私有清单契约、路径与凭据验证、固定源下载、SHA-256、原子完成状态与恢复逻辑。
- Create `linux/scripts/copy-business-storage.py`: 隐藏输入 CLI，仅统计和状态码输出。
- Create `linux/tests/test_business_storage_copy.py`: 受控本地测试夹具，不调用真实项目；模拟网络边界，不模拟被测试的文件写入/校验逻辑。
- Create `linux/README.storage-copy.md`: 用户执行位置、输入类型、实际文件布局、复制/验收命令与源端保留边界。

`inventory.json` 为 version=1 的私有 JSON，包含固定项目 ref、候选归档摘要、生成时间、桶分类及 objects；对象最少含 id、bucket、name、snapshot_updated_at、declared_size（可为空）。导出汇总只包含桶名、数量、已知总字节及未知大小数。

复制清单逐对象增加状态（pending/copied/source_changed/missing/failed）、received_bytes、sha256、source_etag、checked_at、needs_final_refresh；不保存请求头、密钥或响应正文。文件放在 `~/village-storage-copy/<run-id>/blobs/<sha256>`，临时下载放同一私有运行目录。跨 Windows/Ubuntu 的 inventory 传输可用原来的私有上传流程，但不能公开上传。

## Task 1: 候选文件盘点与私有清单

**Interfaces:** `validate_inventory(document) -> normalized_document`；`export_inventory(docker, state, output) -> aggregate_summary`。输出目录新建且独立于备份/网站/源代码目录，已有目录不覆盖。

- [x] 先写测试：五个候选桶分类正确、GPU 产物排除、空桶、未知大小、中文名称、坏路径/重复对象/错误项目、目录重叠/符号链接均有明确处理，输出不含私有对象路径。
- [x] Run `python -m pytest linux/tests/test_business_storage_copy.py -q`。Expected: 新接口不存在而失败。
- [x] 实现清单契约和只读候选 SQL；使用现有 runtime/checkpoint 身份校验。目录和清单权限在创建时设定，不通过修改源 DB 元数据来简化清单。
- [x] Run `python -m pytest linux/tests -q`。Expected: 全部通过；代码中无源写入和源密钥。
- [x] Commit 清单/盘点工具及其测试，记录尚待用户执行的真实桶数量和大小。

## Task 2: 只读下载、完整性与中断恢复

**Interfaces:** 消费 Task 1 的 version=1 inventory。`copy_inventory(inventory_path, output_root, credential, transport) -> aggregate_summary`；`verify_copy(run_directory) -> aggregate_summary`。`transport` 只负责固定源 HTTP 边界，真实文件操作由生产逻辑执行。

- [x] 先写测试：Publishable/anon/数据库密码被拒绝；新的 `sb_secret_...` 与旧 service_role JWT 的头部模式按官方接口核对；任何错误文本中的测试密钥不进入输出。
- [x] 先写测试：401/403 立即停止，404 标记缺失，429/临时服务错误有有界重试；重定向、TLS 错误、截断、元数据/字节不匹配、源变化均不能产出虚假的完成标记。
- [x] 先写测试：大文件分块、空文件、内容哈希和落盘再校验、同内容对象去重、现有坏文件拒绝、部分文件不被跳过、复制恢复、磁盘余量不足与路径链接处理。
- [x] Run 目标测试。Expected: 缺少下载/验收行为而失败。
- [x] 实现固定 HTTPS 源的下载客户端，先核对官方 Storage 与新旧 API key 的调用方式；不将 Secret key 当用户 JWT。源授权仅用于源下载，不挂载到业务 API。
- [x] 以 `.partial` 下载并流式计算哈希；成功后落到摘要命名对象并原子更新清单。恢复必须重算已完成文件的摘要；不删除既有成功或失败现场。
- [x] 独立验收只重读本地文件、核对字节/摘要/对象映射；有 missing/failed/source_changed 时输出准确的未完成计数，不发出全量迁移完成标记。
- [x] Run `python -m pytest linux/tests -q`。Expected: 全部通过。Commit 复制/验收 CLI 和测试。

## Task 3: 用户手动执行与阶段边界

**Interfaces:** 使用前两项的实际 CLI，README 中只提供已经实现和测试的命令。

- [x] 编写 README：首先导出盘点并检查实际对象数量/大小/余量，再由用户隐藏输入服务器端密钥下载。没有服务端密钥时，盘点和本地逻辑测试仍可独立完成，不要求在聊天发送秘密。
- [x] 代码/脚本审查：没有源对象删除、数据库写入、URL 替换、Nginx public 目录挂载或 Worker 变更；没有 API 容器获得管理凭据。
- [x] Run 完整 Linux 测试及受控下载/恢复验收。Expected: 通过且任何失败场景都不产生虚假成功标记。Commit/push main，再提供阿里云命令。
- [ ] 用户执行盘点、复制和逐文件验收；记录已验证对象数量、字节总量、失败/变化数和私有清单位置。真实复制和验收在用户回传结果之前保持待执行。
- [ ] 停在私有文件副本交付，不将其等同于 B2 授权访问、C 普通业务写入或 D 正式切换完成。

## References to check at implementation

- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)：Secret key 与 service_role 为服务器端权限，Publishable 与数据库密码不是此用途。
- [Supabase Storage download](https://supabase.com/docs/reference/javascript/storage-from-download)：核对私有对象读取和服务端身份用法；原始 HTTP 细节须在写客户端前核实。

本地盘点、复制、完整性/续跑测试与用户操作说明已实现；原生执行方式保持不变。云端真实盘点、源授权、下载和验收仍待用户手动执行，未发生网站切换。

2026-10-16 本地交付验证：Python 148 passed / 1 skipped（Windows 原生链接权限），根前端 1004/1004、API 单元 12/12；一次独立复核的两项 Important 均已有 RED→GREEN 回归。真实云端盘点/下载/文件验收待用户执行。详见 [B1 交付记录](../../migration/2026-10-16-storage-copy-validation.md)。
