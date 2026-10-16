# B1 私有文件复制工具交付记录

日期：2026-10-16。用户已找到本项目 Secret key；密钥由用户保管，本机未读取真实密钥或调用真实对象下载。正式网站、源 Supabase 和 4090 保持原配置。

## 本地实现与核对

- 候选运行时/验收身份核对后，通过只读 SQL 导出 Storage 元数据；仅五个指定普通业务桶进入复制范围。
- 新 Secret 使用 `apikey`，旧 service_role 支持原 JWT 请求头；固定项目 HTTPS、验证证书、拒绝重定向，HEAD/条件 GET 单进程分块下载。
- 私有清单绑定 inventory 摘要，文件以 SHA-256 寻址；下载后和独立验收均核对实际落盘字节。失败/变化/缺失不会产生完整复制成功标记。
- 读清单、复制和独立验收均持同一互斥锁；已观察到的源变化在本运行中保持，不能通过反复续跑清除旧 SHA/ETag 映射。
- CLI 限制在 Linux 非 root 操作者终端，目录/文件按 0700/0600 校验；不承诺 Windows 下载目录 ACL。无法隐藏输入时，在读取密钥前停止。密钥默认仅存本次进程内存，不进入清单、命令参数、Git 或业务 API 容器。

本地最终 Python 测试结果：148 passed，1 skipped。跳过项为 Windows 无创建原生符号链接权限；实际 Linux 链接拒绝行为仍属云端待核对项。先前已通过根前端 1004 项和 API 单元 12 项测试；本阶段没有修改前端或 API 运行代码。

## 一次独立复核

发现并修复两项 Important：连续续跑覆盖已观察的源变化记录；获取互斥锁晚于清单读取造成旧状态覆盖。对应四项回归先失败再通过，完整 Python 套件通过。另补充不支持平台和无法隐藏输入的拒绝路径。

非阻塞待办：强制终止进程可能留下互斥锁，当前只提供进程/开始时间证据并要求人工核对，没有自动清除失效锁命令。不能通过删除整个私有运行目录重试。

## 取舍及验收边界

- B1 只证明已接收并持久化的字节与私有清单一致，不证明源数据库旧快照与当前源文件处在同一时间点。所有对象保持最终刷新需求；正式切换前需另做冻结和刷新。
- 生产下载只支持 Linux。若阿里云 HTTPS 源下载不可用，不把带密钥的复制悄悄转到缺少 ACL 实现的 Windows 路径；需另行设计受控回退。
- 真实候选 SQL、源授权、下载及落盘摘要已由下述云端结果验证。Linux 原生链接拒绝的专门测试和云主机峰值资源验收仍未执行；不把普通文件复制成功视为这些场景通过。

## 阿里云实际验收

2026-10-16，用户将服务器源码从 `314fada` 更新至 `29cab53`，依次执行 `inventory-business-storage.py` 和 `copy-business-storage.py`；服务器端 Secret key 由用户在终端隐藏输入，未发送到聊天。

| 桶 | 本次处理 | 对象数 |
| --- | --- | ---: |
| `group-models` | 复制并校验 | 2 |
| `house-photos` | 复制并校验 | 11 |
| `village-datasets` | 复制并校验 | 10 |
| `scene-assets` | 盘点，无对象 | 0 |
| `scene-version-previews` | 盘点，无对象 | 0 |
| `facade-generation` | 排除，保留源端 | 39 |
| `geoprocessing-results` | 排除，保留源端 | 75 |

实际输出：`copied=23`、`verified_bytes=7271979`，`pending=0`、`source_changed=0`、`missing=0`、`failed=0`、`unknown_sizes=0`；状态为 `private_copy_verified_not_cut_over`，最终标记为 `STORAGE_PRIVATE_COPY_VERIFIED_NOT_CUT_OVER`。

私有文件与清单位于服务器 `/home/admin/village-storage-copy/stage-b1/`，包含 `inventory.json`、`copy-manifest.json` 和 `blobs/<sha256>`；本记录只保存汇总，不包含对象路径、私有数据或密钥。23 个选定对象已完成下载及落盘校验，另有 114 个 GPU 产物按计划排除，源对象保留。

B1 私有副本交付完成。B2 授权访问服务、C 业务读写/协作与 GPU 桥接、D 最新数据刷新及正式切换仍待实施；正式网站仍访问 Supabase。此次完成标记不代表文件已被网站使用，也不代表副本与当前线上数据持续同步。

操作入口：[私有复制使用说明](../../linux/README.storage-copy.md)。
