# Semester Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. User explicitly authorized direct execution on the original main checkout.

**Goal:** 学生组按学期和正式村庄隔离，332 为跨学期普通协作组，练习村庄无小组方案。

**Architecture:** 添加显式归属和数据库辅助谓词，受控更新现有函数；前端传当前教学项目，成员统计走业务 API。迁移保留历史记录，拒绝模糊归属。

**Tech Stack:** PostgreSQL/PostGIS, Node.js API, browser JavaScript, Python guarded operator.

**Spec:** docs/superpowers/specs/2026-10-28-semester-groups-design.md

## Global Constraints

- 原目录 main；保留已有未提交文件，不创建工作树。
- 不授予 332 成员管理员角色；不为练习村庄建立 group_plan。
- 不修改 4090 数据目录、运行配置或权重。
- 用户已要求直接修改；原地连续执行，不重复请求设计或计划批准。

## Review Focus

- 同课程、同正式村庄的两个学期不得共享成员、进度或方案编号。
- 锁组、归档、禁用账号、伪造项目字段、响应丢失重试必须安全。
- 无唯一证据的历史组不自动分给当前学期，332 仅按精确身份识别。
- 332 多学期方案不能覆盖；练习村庄从服务端拒绝方案创建。
- 旧个人成果唯一键及成员统计数据通道也要按学期正确处理。

## Task 1: 数据库归属与权限

**Files:** linux/sql/semester-groups.sql; linux/scripts/semester_group_policy.py; linux/tests/test_semester_group_policy.py; business-api/test/semester-groups.integration.mjs

- [ ] 编写失败的迁移、权限、历史保护测试并运行确认失败。
- [ ] 添加组、成员和进度归属，保留旧数据；按确切源函数体更新 catalog、共享权限、方案创建/批量创建/统计及个人成果唯一键。
- [ ] 原生验证双学期入组、旧组码、同村两届、332 独立空间、无基线、练习村拒绝及直接角色权限。

## Task 2: 前后端上下文和统计

**Files:** business-api/unified/contracts.mjs; features/course/course-service.js; admin.js; features/admin/group-plan-admin.js; features/villages/village-client.js; app.js; corresponding tests.

- [ ] 先写服务参数、动态学期、成员统计及等待状态测试，确认失败。
- [ ] 使用当前项目传递组操作；新增受权限保护的成员/进度汇总；固定组码输入正常生效但保留 332。
- [ ] 管理后台显示当前归属；学生与管理员工作台正确选择本组空间；无快照不显示成功。
- [ ] 跑受影响前端与 API 契约测试，再跑全量回归。

## Task 3: 升级与交付

**Files:** linux/scripts/repair-autonomous-semester-groups.py; linux/tests/test_semester_group_rollout.py; docs/operations/2026-10-28-semester-groups.md; .github/workflows/unified-native-tests.yml.

- [ ] 编写拒绝未知函数、只读预检、备份及幂等恢复测试，确认失败。
- [ ] 实现精确校验、原有备份流程、新覆盖层和 API 契约更新；保留历史发布与其他服务。
- [ ] 独立原生数据库验证通过后准备线上升级；检查实际项目、村庄和 332 成员，验证页面与正反权限。
- [ ] 按 executing-plans 技能安排一次独立最终审查，处理问题并记录实际完成状态。

## Execution ledger

- 2026-10-28：检查确认原目录 main，已有 332 配置记录和独立实验目录不改动。当前开始只读依赖梳理。
- Ruling: 改学期成员唯一键并保留历史关系，不能仅给 group 添加字段；个人图底结果唯一键同时加入学期，否则新届同村练习会触发历史冲突。
- Ruling: 保持每个账号在当前学期一个有效小组（学生组或 332）。历史学生组不阻止新届入组；332 成员不同时加入本届学生组，以匹配现有单组工作台和“只看到本组内容”的要求。不新增未请求的多组切换入口。
