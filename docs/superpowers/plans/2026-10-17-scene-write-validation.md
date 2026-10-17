# 三维方案写入候选实施计划（C1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立候选数据库验证三维方案创建、保存、冲突、里程碑、分支及恢复，不提前切换网站。

**Architecture:** 沿用已批准的混合迁移设计。新增独立 scene 运行入口，复用已验证 Auth，固定操作调用源场景 RPC；同一 PostgreSQL 实例内恢复独立数据库，不写 A/B2 的 village_copy。前端适配器显式注入，不回退 Supabase。C1 不接收文件上传、外部素材引用或预览路径，文件写入归后续 C2；不把 C1 当作完整三维模块切换。

**Tech Stack:** Node 22、原锁定 pg、PostgreSQL 17、Python 3、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-10-15-hybrid-database-migration-design.md`（用户已确认总体设计及推荐执行方式；本次批准继续 C 阶段）。

## Global Constraints

- 原目录 main → GitHub → 用户手动阿里云；不创建工作树，不远控服务器。
- Supabase Auth、线上业务、4090、A/B2 数据和镜像元数据保持现状。
- 新数据库 village_scene_validation；API village-scene-validation-api；回环 18082；独立登录角色限 2 连接，非超级用户。
- 仅固定操作，禁止通用 RPC、表代理；JSON 最大 2 MiB，无自动写入重试，未知错误隐藏详情。
- 草稿有 revision 乐观锁；源权限函数和 RLS 在真实 PostgreSQL 测试，不只模拟数据库。
- 源快照陈旧；候选写入为试验数据，最终正式切换前重新刷新，不向源库同步。

## Review Focus

1. 同一 revision 并发保存只能有一个提交，断线失败不能隐式改写另一数据库。
2. 已撤销组成员权限、跨组及管理员沙盒越权必须拒绝；匿名及伪造上下文不能写。
3. 缺失 baseline、错误 projectId、超大正文、重复对象和未知字段不能造成清空或越界写入。
4. 文件路径/素材未迁完时明确拒绝，避免候选成功保存却留下不可读引用。
5. 部署中断保留独立数据库与日志，不覆盖既有验证数据，不重启共享数据库。

### Task 1: 固定场景 API、前端客户端和真实数据库测试

**Files:** `business-api/scene/*.mjs`、`business-api/test/scene*.mjs`、`3D_scenes_edit/persistence/scene-api-client.js` 及测试。

**Interfaces:** `createSceneHandler({verifyIdentity,database})`；`createSceneDatabase(config).run(identity, operation, input)`；`createSceneApiClient({baseUrl,getAccessToken,fetchImpl})` 返回原编辑器项目生命周期方法，文件/素材方法显式未迁移。

- [ ] 先写失败测试：方法/令牌/正文限制、固定参数、错误脱敏、前端不回退；真实 PG 使用源 Scene Edit SQL 验证两个用户、教师、管理员、成员撤销、竞争保存、版本恢复和回滚。
- [ ] 运行 RED，确认缺失实现。
- [ ] 实现入口、事务、固定 SQL、参数与文档检查；复用源权限与版本 RPC，不编辑线上 SQL。
- [ ] GREEN：`node --test business-api/test/scene*.test.mjs 3D_scenes_edit/persistence/scene-api-client.test.js`；显式本地废弃集群运行 `scene.integration.mjs`。
- [ ] 提交实现与测试。

### Task 2: 独立候选部署、离线镜像与真实登录探测

**Files:** `linux/scripts/build-business-api-image.py`、新 scene 部署/probe、`linux/scene-write-image.json`、Python 测试、`linux/README.scene-write.md`。

**Interfaces:** 新镜像 `village-business-api:stage-c1-scene` 包含 scene 入口但 A/B2 构建默认不包含；部署 `--check/--deploy/--verify`，探测用隐藏网站密码，不输入数据库密码。

- [ ] RED：镜像隔离、数据库名/HBA/角色/端口/挂载、拒绝覆盖或未知状态；探测必须实际保存并读取且验证冲突/重启持久性，不能凭 health 通过。
- [ ] 实现新数据库从已校验归档恢复；不重复导入集群角色；保留失败现场；两连接池、192 MiB API，限制内部网络。
- [ ] GREEN：对应 Python 测试、旧 A/B2 回归；构建有摘要的离线镜像。
- [ ] 提交并写明人工上传/部署步骤和剩余 C2、GPU 桥接、D 刷新/HTTPS 边界。

### Task 3: 整体验证和交付

- [ ] 全部相关 Node/Python 与平台前端回归；记录真实输出。
- [ ] 一次独立整体代码审查；重要问题用 RED→GREEN 修复。
- [ ] 推送 main；只给用户当前可执行命令，云端验收前不声明 C1 完成。
