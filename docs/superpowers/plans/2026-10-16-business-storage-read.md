# B2 授权文件读取实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 B1 已验证文件副本提供候选环境的授权 GET/HEAD/单段 Range 读取，并交付离线镜像、保守部署脚本与真实登录验收工具。

**Architecture:** 新候选 API 使用 `127.0.0.1:18081`，加入已验收数据库的内部网络，复用最小权限数据库账号；不重建数据库、不修改 A API 或网站。启动时加载私有只读文件索引，访问时验证 Supabase 身份，在只读事务中复用 Storage RLS 并应用桶专用可见性约束，随后从只读挂载的 SHA-256 文件读取。

**Tech Stack:** Node >=22 标准 HTTP/fs/crypto/stream，已有 pg；Python 标准库与既有 Docker/复制校验工具。用户继续手动执行云端命令。

**Spec:** [已确认混合迁移设计](../specs/2026-10-15-hybrid-database-migration-design.md)，阶段 B 的访问部分；本交付仅实现读取，上传/删除随 C 的完整业务写入另行实施。用户本轮明确要求执行，保留此前 native 方法。

## Global Constraints

- 原项目 main 本地测试 → GitHub → 用户手动部署；无新工作树、无远控。
- 数据库和文件“保存到仓库和静态网站根目录以外的持久化目录”；不发布 PostgreSQL 端口，不公开目录，不向 API 挂载管理密钥。
- “API 按用户/课程/空间权限授权”；不能信任用户 ID、桶、路径或摘要参数；只接收对象 UUID。
- 仅五个 B1 普通业务桶；GPU 队列、产物、源对象和 Worker 保持原位置；不切换线上前端。
- 新索引目录 0700/文件 0600；原 blobs 只读挂载，无复制、改权限或删除源文件的操作。
- 仍是旧数据库快照/文件副本；D 最终刷新不可省略。正式公网访问需 HTTPS，本交付仅 loopback。

## Review Focus

1. 私有模型/场景跨用户读取：RLS 和明确谓词共同判断；隐藏对象返回 404（Task 1）。
2. 损坏文件、符号/硬链接、已变更元数据：打开同一文件句柄，完整校验后发送；不暴露绝对路径或部分错误正文（Task 1）。
3. Range/HEAD、空文件和中断：授权先于文件查询及响应元数据；正确的 206/416 与流关闭（Task 1）。
4. B1 清单与数据库/验收版本不一致、已有候选：部署在创建服务前拒绝，不覆写 A 或数据库（Task 2）。
5. 云端真实账号下载、容器重启、无授权访问：验收记录实际 SHA/字节匹配，仅输出汇总；本机测试不冒充云端通过（Task 3）。

## Task 1: 授权文件读取 API

**Files:** create `business-api/src/storage.mjs`, `business-api/test/storage.test.mjs`, `business-api/test/storage-http.test.mjs`; modify `http.mjs`, `repository.mjs`, `main.mjs`, `errors.mjs`; create real-PG permission fixture/test.

**Interfaces:** `createStorageReader({root,indexPath}) -> {open(object), ...}` reads index version=1 with archive hash and selected `{id,bucket,name,sha256,size}`. `getStorageObject(client,id)` returns RLS-filtered metadata. HTTP `GET|HEAD /api/v1/files/<uuid>` consumes verified identity and metadata, produces private no-store bytes, supports one byte range. No list/upload/delete or public URL route.

- [ ] Write tests for unauthenticated/invalid/cross-user/GPU denial, exact binary/HEAD/range/empty response, corrupt index/blob, path/link rejection, bounded streaming, safe errors, and original API regression.
- [ ] Run Node unit suite and observe new tests fail because storage interface/routes are absent.
- [ ] Implement index validation, secure same-fd hash+read, route and repository checks. House photos follow existing authenticated read rule; group models/shared/user/group, scene helper functions and village dataset helper follow audited source SQL with RLS retained.
- [ ] Run Node unit suite and disposable real PostgreSQL integration proving user A/B isolation and no writes. Record platform-specific skips.
- [ ] Commit API + tests.

## Task 2: Private deployment and offline image

**Files:** create `linux/scripts/deploy-storage-read-validation.py`, `linux/tests/test_storage_read_deployment.py`; extend `build-business-api-image.py` with explicit image tag/metadata options preserving A defaults; generate `linux/storage-read-image.json` and private local archive.

**Interfaces:** `prepare_index(run,archive_sha)` locks/rechecks B1 and creates normalized index; `compose_document(state,source_state,run,uid,gid,key)` creates only new API service on external A networks, `18081` loopback, 192MiB, read-only/password+index+blobs mounts; `validate_runtime` compares immutable intended Compose/container/network/image/checkpoint identities. CLI `--check`, `--deploy`, `--verify` and explicit private state; no reset/DB restart/source writes.

- [ ] Write behavioral tests for incomplete/changed/tampered copy, wrong archive/DB metadata/image identity/ports/mounts and pre-existing target; run RED.
- [ ] Implement guarded preflight against A accepted runtime and archive, check actual candidate storage identity tuple, create private index/checkpoint and compose, start new API only, validate health and exact runtime.
- [ ] Test builder's named B2 tag/metadata without altering stage A; build private archive from existing verified Node base with npm lockfile installed.
- [ ] Run Python suite; verify archive checksum/image descriptors and code hash; commit metadata, tooling and tests (never archive/index/data/secrets).

## Task 3: Cloud probe and operator handoff

**Files:** create `linux/scripts/probe-storage-read.py`, `linux/tests/test_storage_read_probe.py`, `linux/README.storage-read.md`, `docs/migration/2026-10-16-storage-read-validation.md`.

**Interfaces:** hidden website login password; probe authorized object GET/HEAD/Range vs private index hash, counts 404 without treating denial as missing file; require at least one success and per-bucket summary; no-auth must reject. `--verify` restart only B2 API, revalidate B1 and runtime and leave a fresh fingerprint proof; probe binds exact fresh proof and writes private acceptance only on complete success.

- [ ] Write failing tests for denial/no-readable files, checksum mismatch, failed auth/no hidden input and stale/mismatched runtime proof; implement fixed safe diagnostics with no tokens/paths/private names.
- [ ] Run Node/Python suites and root frontend tests; independent whole-change review and one fix pass for actionable issues.
- [ ] Commit/push original main and give actual upload/checksum/load/check/deploy/verify/probe commands. Stop at user handoff, leave cloud acceptance pending until output arrives.
