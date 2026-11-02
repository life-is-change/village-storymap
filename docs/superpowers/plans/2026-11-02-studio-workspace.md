# 场景工作室实施计划

> **For agentic workers:** Use superpowers:executing-plans inline, one final whole-change review.

**Goal:** 落实已确认的右侧工作区、组件归属和一摊一主。
**Architecture:** UI沿用panel与dispatcher；controller保存显式siteId并校验范围；Life共享时钟中的独立摊主分配。
**Tech Stack:** 原生JS、node:test、Cesium/OpenLayers。
**Spec:** docs/superpowers/specs/2026-11-02-studio-workspace-design.md

## Global Constraints
原目录main；保留无关内容和旧方案；不引入依赖；不复制居民。
## Review Focus
- 锁定/只读状态下命名、归属、放置均不可写。
- 连续放置、取消、二维三维切换仍保留正确归属。
- 旧几何推断与显式独立区分；超界有提示。
- 名称保存、撤销及模拟重新编译一致。
- 每摊人员唯一、跨天不重复、普通岗位和接送不被占用。

### Task 1: 归属与名称
- [ ] 添加归属、独立、越界、重命名撤销失败测试；实现controller与tree、compiler消费。
- [ ] 运行controller/panel/adapter测试。
### Task 2: 右侧工作区
- [ ] 添加左右布局、页签、版本、折叠及市场分类失败测试。
- [ ] 修改panel/style/dispatcher，顶部版本弹层、明确归属，保留上传与两个模式放置。
- [ ] 运行UI与入口回归。
### Task 3: 一摊一主
- [ ] 根据用户答复落实不足人员策略；先验证12摊12独立老板及多天复用。
- [ ] 实现调度和统计，跑完整回归。
### Task 4: 复核与发布
- [ ] 一次独立代码复核，重要问题回归修复。
- [ ] 本机浏览器验证布局与归属；固定提交可回滚发布并核验正式站点。
