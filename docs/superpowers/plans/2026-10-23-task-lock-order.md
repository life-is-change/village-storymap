# 任务锁顺序修复 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, followed by one whole-change review. Keep the user's original main checkout.

**Goal:** 消除Worker进度更新与网站状态轮询的死锁，修复切换空间的旧接口误调用。

**Architecture:** 对task_requests父记录先加锁，再锁local_gpu_runs子记录；领取/回收先跳过被锁父记录。通过独立云端修复工具原子安装，并保留既有修复与回退材料。

**Tech Stack:** PostgreSQL17/PostGIS、Node原生集成、浏览器JS/VM测试、Python运维脚本。

**Spec:** docs/migration/2026-10-23-task-lock-order.md

## Global Constraints

- 原目录main，不创建worktree，不覆盖校园目录或私钥。
- 保留身份、权限、租约、任务终态与输出完整性规则。
- 无真实CA/提供商/GPU调用；原生Postgres仅在隔离GitHub CI运行。
- 云端先备份；未知函数体/覆盖层拒绝；不reset或自动重放失败任务。

## Review Focus

- 进度与status同时执行不能形成父子行锁环。
- 父任务被锁时claim应跳过，不能占住子run等待。
- 过期租约、撤销身份、取消任务与两种Worker仍正确隔离。
- Aliyun跳过旧全空间锁不等于跳过planning对象租约。
- 新覆盖层保留上次图底/3D和旧照片/H001修复，重复执行不覆盖数据。

## Task 1: 原生队列锁

Files: business-api/test/local-queue.integration.mjs; linux/sql/local-tasks.sql; linux/sql/local-task-files.sql.

- [ ] 写并发测试：事务A持有父任务锁；Worker progress进入等待；A同时调用真实status，随后提交；两边都必须成功。
- [ ] 写claim测试：首个任务父记录被锁，Worker应在释放前领取第二个任务。
- [ ] 在旧函数体上复现失败，再统一parent-before-child顺序，包括claim与reaping及上传函数。
- [ ] 原生回归覆盖权限、撤销、过期租约、五输出导入和并发进度。

## Task 2: 网页切换

Files: features/data/data-service.js; features/integration/deployment-survey.test.js; app.js.

- [ ] 先复现Aliyun releaseSpaceEditLock触发SOURCE_BUSINESS_DISABLED，再仅对Aliyun禁用legacy space_lock；source行为保留。
- [ ] 移除不存在的water.csv配置，水体几何/属性继续由GeoJSON或原生表提供。
- [ ] 完整网页回归，保留CONTEXT_CHANGED保护。

## Task 3: 可重复云端修复

Files: linux/scripts/repair-autonomous-task-locks.py; linux/scripts/test-autonomous-deployment-ci.py; linux/tests/test_autonomous_task_lock_repair.py; migration record.

- [ ] 固定函数体转换，校验原release/current geo overlay，预检只读。
- [ ] 自身备份、原子函数更新、新网页覆盖层、仅web更新、HTTPS字节/其他ID核对。
- [ ] 真实旧函数回放、拒绝未知函数体的整体回滚、两次执行、原网页/旧图底函数保留测试。
- [ ] 全套CI成功后记录证据，交付一条阿里云命令及真实任务复测步骤。
