# Single personal experience and shared access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans inline, then one fresh whole-change review. Original main per user; no worktree.

**Goal:** 一个个人体验入口，图底显式应用/清除预览，共享登录可读、入组才可写、管理员例外。

**Architecture:** 保留内部版本存储、规范个人空间为可见入口；数据库受控关联与原子应用；目录返回用户实际只读权限；已知版本热修复。

**Tech Stack:** JS Node/VM; PostgreSQL CAS/trigger; Python guarded hotfix; disposable native CI.

**Spec:** docs/superpowers/specs/2026-10-24-single-personal-shared-access-design.md

## Global Constraints

- 用户已明确选择单空间和准入规则；原目录main；不触碰源备份Supabase、4090或其他人的服务。
- 不自动覆盖旧成果/手工编辑，不删除旧存储；应用对应生成图层，空层不可回退底稿。
- 所有写入口服务端校验；admin为唯一共享免入组角色；小组与个人隔离不变。
- 新云端工具先固定版本/回执证明和备份，再单事务CAS与web切换；可重复/中断恢复。

## Review Focus

- 同课程成员记录没有真实组、其他课程组、同名用户，不能误授共享写权。
- 应用中错误、未保存草稿、跨账号村庄与重复请求，不能覆盖错误上下文或部分变更。
- 空生成图层、等高线、旧成果，2D/3D和版本状态保持一致。
- 相同原始编号与旧照片模型不应混淆。
- 旧覆盖层真实字节、函数体、权限、恢复中断必须受证明，不靠放宽校验交付。

### Task 1: 数据库与权限
- [ ] RED测试共享可读/入组写/admin例外及内部结果关联/原子应用。
- [ ] 已知函数变更、私有绑定/应用逻辑、目录用户权限、重复保护。
- [ ] 原生隔离测试全部正反路径，未知函数拒绝，业务行迁移保留。

### Task 2: 统一个人入口与应用/清除
- [ ] RED测试唯一入口、旧ID回退、只读控件、应用普通空间/清除不写。
- [ ] 内部初始化不再push独立workspace；导入与旧成果应用后刷新对应个人空间。
- [ ] 2D/3D已应用图层和空结果、等高线读取；失败/草稿/切换保护。

### Task 3: 发布工具与验证
- [ ] 固定历史基准、恢复证明、备份/CAS、新web覆盖层和恢复测试。
- [ ] 全量本地JS/Python、fresh独立审查、原生/浏览器CI。
- [ ] 记录实际部署版本/证据并推送main，给用户一条云端命令；不声称真实用户验收。
