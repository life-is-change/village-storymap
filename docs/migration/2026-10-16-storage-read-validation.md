# B2 授权文件读取候选交付记录

日期：2026-10-16。本交付在用户确认后执行，原目录 main 开发，阿里云由用户手动操作。

## 范围

仅授权读取 B1 私有副本：GET/HEAD/单段 Range，登录和当前数据库权限先于文件元数据响应。上传/删除、业务写入、协作、GPU 桥接、最新数据刷新和正式网站接入尚未实现。

新候选仅 loopback 18081；使用独立 API 容器，复用已有 A 数据库，新增候选专属最小权限账号。候选数据库仅备份并重载新增账号在同一内网子网的 SCRAM 连接规则；A API/账号、业务记录、Nginx、源 Supabase 和 Worker 不变，数据库容器不重建或重启。Storage RLS 保留，应用层另加五个普通桶各自的明确读取谓词；house-photos 保留既有全体已登录用户可读语义。

## 本地证据

- 新读取器/路由测试先因接口缺失失败，再验证真实临时文件、完整摘要、HEAD/Range、空文件、损坏字节、硬链接拒绝及读取数量限制。
- 可丢弃的独立本地 PostgreSQL 17 集群验证原 A 测试及 Storage 权限隔离：本人/其他用户/组/共享/RLS 额外拒绝、场景与数据集、GPU 排除、组成员撤销及写入拒绝。该合成测试不代表真实用户生产验收。
- 部署与探针测试先因工具/镜像参数缺失失败，再验证 B1 完整性、源归档/对象身份、私有挂载、loopback、镜像/执行身份/环境/资源限制，以及下载摘要/HEAD/Range、无可读覆盖拒绝和过期证明拒绝。
- Windows/Linux Git 文本换行可能改变镜像代码摘要；新增回归先失败再通过，B2 使用 LF 规范化代码身份。保留 A 已交付镜像及其元数据，不要求重建 A。
- 已运行：API Node 单元 19 passed；真实本地 PostgreSQL 集成 3 passed；Python 171 passed / 1 skipped；根前端 1004 passed。Windows 主机无原生符号链接创建权限，链接专项的 Linux 行为不在本机声称通过。

## 一次独立复核与修正

复核提出两项 Important，均完成有失败证据的回归修正：

1. 两 API 共用 4 连接限额会争用。B2 改为专属 `village_storage_read_login`，连接池及角色上限均为 2，A 的 4 连接上限不变；可丢弃真实 PG 测试同时持有 A 的 4 条和 B2 的 2 条连接，额外 B2 请求排队后完成。候选角色由版本化 SQL 创建，不修改业务行，禁止超级用户/BYPASSRLS/角色管理权限。对应 HBA 增加同子网/同数据库/仅 B2 的 SCRAM 行，私有备份并原子替换/重载；专门回归拒绝未知/放宽规则。实际 Linux 部署及 B2 TCP 验证已由下述云端结果确认。
2. 只核对对象 UUID/桶/路径遗漏版本漂移。索引现保留 B1 的更新时间、声明大小、eTag 和版本；部署与每次读取都核对，UTC 微秒精度保留，字段变化返回失败且不发送旧字节。已覆盖相同身份但四种版本字段分别变化的拒绝，以及真实 PG 微秒/版本元数据读取。

没有单列 Minor。复核未判断的上传/删除/业务写入仍归 C；线上源增量归 D；实际 Docker 启动及账号读取已通过；Linux 原生链接拒绝专项和资源容量仍待专门验证。宿主机可信操作者在摘要校验后主动改写同一 inode 不属于只读容器可防御的边界，运维须保持 B1 文件不可原地改写；最终刷新使用新验收副本。

## 阿里云实际验收（2026-10-17）

用户手动导入已交付镜像后，回传以下真实执行结果：

- `Loaded image: village-business-api:stage-b2-read`；Node `v22.23.3`；`STORAGE_RUNTIME_IMPORT_OK`。
- `STORAGE_READ_PREFLIGHT_OK`，随后 `STORAGE_READ_INTERNAL_DEPLOYED_NOT_ACCEPTED`；候选部署成功。
- `STORAGE_READ_RESTART_VERIFIED`；候选 API 重启及实际数据库 TCP/存储查询核对通过。
- 用户以网站管理员账号隐藏输入登录密码，取得 `authenticated_files_probe_passed`：selected=23、readable=23、denied=0、verified_bytes=7271979。
- 可读桶计数：`group-models` 2、`house-photos` 11、`village-datasets` 10。
- 最终标记：`STORAGE_READ_INTERNAL_VALIDATED_NOT_CUT_OVER`。

该脚本在返回成功前检查无令牌/无效令牌拒绝、实际下载的字节数及 SHA-256、HEAD 与 Range，以及当前运行指纹和近期重启证明。因此本次确认的是管理员真实文件读取和这些内部接口检查，不把合成 A/B 用户隔离测试冒充为云端学生账号验收。场景资产和预览桶在 B1 快照中均无文件，本次没有实际文件可读覆盖。

B2 读取候选的部署、重启及管理员文件验收完成；新增 API 资源观察已回传，详见下节；并发/峰值容量和 Linux 原生链接拒绝专项仍未专门验证。上传/删除、完整业务写入、GPU 桥接、最终刷新和正式网站切换尚未实施；网站仍使用原 Supabase 路径。

最终本地修正提交：`e58b451`，交付提交：`ed90f89`。镜像为 `village-business-api:stage-b2-read`，压缩包 79,441,255 字节，SHA-256 为 `1da2b55b35c8692cc809c6825d6f40eedc94eeb3dfffdd44b8d8ba911ed2a13a`。归档、平台和代码身份已于本地核对，Linux 容器运行与上述真实登录读取由用户回传结果确认。

操作入口：[B2 部署与验收说明](../../linux/README.storage-read.md)。不需要为本次成功结果重复部署、重启或下载。

## 服务验收后的资源快照（2026-10-17）

用户回传 `docker stats --no-stream` 和 `free -h`：

| 容器 | 内存指标 / 限额 | CPU | PIDs |
| --- | --- | --- | ---: |
| village-storage-validation-api | 30.40 MiB / 192 MiB | 0.00% | 11 |
| village-api-validation-api | 45.74 MiB / 192 MiB | 0.00% | 11 |
| village-api-validation-postgres | 39.49 MiB / 768 MiB | 0.00% | 6 |

三项容器内存指标算术合计 115.63 MiB，不等同于完整主机内存占用。主机 total=1.6 GiB、used=667 MiB、free=113 MiB、buff/cache=1.0 GiB、available=945 MiB，swap=0。

这份完成探针后的快照未显示当前内存压力，新增文件读取服务约 30 MiB；可继续后续候选实现与验收。`available` 包含可回收部分缓存，不能仅依据 `free=113 MiB` 判定内存不足。当前 CPU 接近空闲，不能据此推断课堂并发、峰值资源或服务栈完整迁移后的容量。

B2 读取候选的功能及本次资源观察已登记。C 的业务读写/协作/文件写入/GPU 桥接和 D 的最终刷新/正式切换仍未完成；本次无需重复部署或重传文件。
