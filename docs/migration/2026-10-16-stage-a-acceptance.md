# 阶段 A：阿里云业务 API 内部功能验收记录

日期：2026-10-16。依据用户回传的阿里云终端输出记录；阿里云操作由用户执行。

## 已通过的云端检查

部署代码版本为 `314fada`（GitHub main），API 镜像为 `village-business-api:stage-a1`，导入 ID 为 `sha256:0dd84bcfc962a3ef5f49a5babe6a6a52ec78dc4ac64b9f276f0577ccb1458f3e`。API 归档 SHA-256 为 `0153551cb65e374b8a94bf3473e00fa391955f07e659a93017aeca5ccfa12c92`；监听修复未改动该镜像。

用户已完成：归档校验、Linux Node/pg 导入、独立候选恢复、数据库监听修复、实际 API 容器 TCP 连接、候选权限/重启/数据核对及真实管理员账号的登录读取。

最后一次命令依次输出：

```text
CANDIDATE_DB_LISTENER_REPAIRED_NOT_ACCEPTED
CANDIDATE_PERMISSIONS_RESTART_VERIFIED
BUSINESS_API_INTERNAL_VALIDATED_NOT_CUT_OVER
```

真实账号读取返回 1 门课程、50 个小组空间、2 个该账号的个人空间。小组空间接口默认分页上限为 50，此数值不是全库空间总数。

一次登录耗时 871 ms；四个读取接口合计 4869 ms。读取耗时包含各请求的 Supabase 在线身份验证、HTTP 和本地数据库访问，不能当作纯数据库耗时、P50/P95 或迁移提速证据。

## 用户补充的空闲资源快照

| 项目 | 观察值 |
| --- | --- |
| API 容器 | CPU 0.00%；28.43 MiB / 192 MiB；11 PIDs |
| PostgreSQL 容器 | CPU 0.00%；29.22 MiB / 768 MiB；6 PIDs |
| 两个容器内存指标合计 | 57.65 MiB，不能等同于数据库所有缓存或整机占用 |
| 主机 | 总内存 1.6 GiB；used 619 MiB；available 993 MiB；free 113 MiB |
| 主机缓存和交换 | buff/cache 1.1 GiB；Swap 0 B |

当前空闲资源观察已补齐；`available` 包含可回收缓存，不能仅用 `free` 判断余量。上述是一时点快照，不是教学并发负载、峰值内存或吞吐量测试。

## 部署边界和待办

- API 仅发布到服务器 `127.0.0.1:18080`；数据库无宿主机端口，仅在 Docker 内部网络监听，使用受限账号与 SCRAM 验证。
- 旧恢复基线保留且停止；候选沿用自己的持久化数据目录。修复前的配置与验收报告保留为私有历史文件。
- 阶段 A 的云端权限/重启、账号读取和空闲资源观察已完成。教学并发容量与负载延迟未验收。
- 正式网站仍使用原 Supabase，未切换业务读写；候选是旧备份的独立副本，不自动同步源库后续数据。
- Supabase Auth 与 4090 通道保持原状。Storage 文件本体复制、业务写入/协作适配、GPU 依赖桥接、HTTPS 与最终数据交接仍属于后续阶段。
- 本记录不包含密码、令牌、用户 UUID、私有业务行或 SQL 归档。服务器私有报告保存在 `~/village-api-validation/`，不提交 Git 或网站目录。
