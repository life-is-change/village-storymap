# Curated Scene Assets Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User authorized direct implementation in the original main workspace.

**Goal:** 接入100个校准后的独立模型及24套可编辑场景组合。
**Architecture:** 静态资源导入工具生成可复现目录；组合索引沿用素材加载入口，控制器通过原子命令生成子对象与组合关系。现有2D、3D和持久化共用场景文档。
**Tech Stack:** Node.js、UMD JavaScript、GLB、OpenLayers、Cesium、node:test。
**Spec:** ../specs/2026-11-05-curated-scene-assets-design.md

## Global Constraints
- 原目录main增量修改；保留全部已有未提交改动。
- 不修改E:/GLB_model原始库；资源本地可部署，无运行时外部CDN依赖。
- 保留许可署名；米制、底部中心锚点；组合子对象可编辑。
- 首版不自动部署、不修改4090服务。

## Review Focus
- 组合中途越界必须整体失败，无半组残留。
- 单个子组件可选；整组操作不得修改其他组合。
- 锁定范围、边缘占地、复制后的groupId、撤销恢复均需测试。
- 外部GLB坐标Y-up与平台平面坐标对应准确。
- 市集装饰不误算摊位；真实摊位归属延续模拟。

### Task 1: 可部署模型目录
- [x] 新增导入工具与校准映射、100个中文单体和24套组合索引，保留署名。
- [x] 测试文件存在、GLB锚点尺寸、无外部纹理依赖、组合引用完整与占地校准。
- [x] 运行导入并记录校验报告。

### Task 2: 组合控制器与原子历史
- [x] 先编写失败测试：createComponent、整组移动/旋转/复制、单次撤销、越界/锁定不修改文档。
- [x] scene-commands.js增加批量原子命令；scene-editor-controller.js扩展放置和整组操作。
- [x] 两种视图放置路径共享组合实例化，保持独立子对象及siteId/marketId。

### Task 3: 素材和对象树入口
- [x] 组件库增加场景组合分类、中文名称、尺寸/数量与署名链接。
- [x] 对象树按所属范围显示可展开组合；组合选择和解组可达。
- [x] 更新静态资源版本；运行相关UI、控制器、渲染及集成测试。

### Task 4: 验证与交付
- [x] 运行npm test，区分本次和已有失败。
- [x] 浏览器检查单体/组合放置、整组操作、保存恢复，记录截图；如环境阻碍，如实说明。
- [x] 更新执行记录和模型导入报告，不提交已有混合改动。
