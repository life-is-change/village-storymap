# Workspace edit consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline then one fresh whole-change review. Work in original main per user.

**Goal:** 修复授权空间选择、事件刷新丢草稿、数字编号400及个人图底上下文503。

**Architecture:** 只显示授权工作区；事件刷新有上下文/编辑状态栅栏；API边界使用字符串编号/省略空可选锁；精确更新旧个人空间compat函数；新独立覆盖层。

**Tech Stack:** JS Node/VM, Python operator, PostgreSQL native CI, Docker Compose.

**Spec:** docs/migration/2026-10-23-workspace-edit-consistency.md

## Global Constraints

- 原目录main，保留已有修改，不建worktree。
- 不扩大共享/其他人个人/小组权限，不将403吞成静态成功。
- 保存失败保持草稿；事件不能改绘制中/保存中数据，不臆测操作者。
- 不重置数据、不改4090；先备份再单事务已知函数CAS及网页更新。

## Review Focus

- 无课程成员权限账号不能被送进假共享空间。
- 图底版本空间不能因目录刷新消失或变成普通体验空间。
- 用户在await期间开始绘制/切换账号村庄时旧响应不能覆盖状态。
- 数字0编号、空可选UUID与真实锁token应正确处理。
- 未授权/关闭正式村及不同项目冲突仍拒绝ensure。
- 中断恢复、精确历史覆盖层和函数比对不能漏检查。

### Task 1: 空间与事件

Files: app.js; features/ui/workspace-consistency.test.js; geometry-editor.js; related regression.

- [x] 新测试复现非成员假BASE、图底丢失、事件绘制/保存覆盖与虚假他人提示。
- [x] 先RED再修复授权选择/保留版本空间与上下文栅栏，事件先检查编辑再做刷新。
- [x] 数字建筑编号字符串化、空lockToken省略、保存忙碌栅栏，测试失败后保留草稿。
- [x] 全JS测试通过。

### Task 2: 个人上下文与云端修复

Files: linux/sql/workspace-personal-context.sql; linux/scripts/repair-autonomous-workspace.py; linux/workspace-repair-baseline.json; linux/tests/test_autonomous_workspace_repair.py; native coordinator fixture.

- [ ] 精确兼容旧5参数ensure函数，发布村类型/项目绑定校验，保留所有者和冲突保护；原生RED/GREEN。
- [ ] 校验旧覆盖层与固定基准摘要、自身备份、单事务函数替换、只更新网页并核对其他ID。
- [ ] 隔离原生测试成员/非成员、第二练习村、正式村拒绝、原生个人增删保存、历史函数/网页兼容与重复修复。
- [ ] 全Python/CI/独立审查完成后记录证据，推送并交付一条云端命令。
