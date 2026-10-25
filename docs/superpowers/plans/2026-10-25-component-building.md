# Component Building Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已授权实施；在本会话直接执行。

**Goal:** 在原平台接入本地照片构件建模，与贴图并存，支持现状与改建。

**Architecture:** 扩展 Aliyun 原生 facade 任务输入、Worker 与现有ML服务。迁入固定构件编译器，统一平台模型回传。默认旧任务仍走贴图，无API调用。

**Tech Stack:** JS、Node API/PostgreSQL、Python、DINO/SAM2、Blender、GLB。

**Spec:** docs/superpowers/specs/2026-10-25-component-building-design.md

## Global Constraints

- 原目录 main；保留 experiments/xiaozhaizi-spike/；不操作其他分支。
- 识别和Blender在4090现有Worker执行；无付费API。
- 现状保留完整屋顶和占地/朝向，忽略9m；改建参数继承并可改。
- 不复制数据库/权重，不覆盖现状资产，不额外导出白模。

## Review Focus

- 任务恢复或换图后模式不得串用；旧Worker不能静默按贴图执行构件任务。
- 改建标准图不经清理/矫正；现状完整屋顶不被裁掉。
- 墙高按墙身范围比例缩放，开口和屋顶参数同步缩放。
- 源占地和主体不兼容时明确提示，禁止假称保持占地。
- 任务取消/重试及产物身份仍受现有租约、权限约束。

### Task 1: 任务协议与模式
Files: features/data/business-task-client.js, business-api/unified/contracts.mjs, linux/sql/local-tasks.sql, server/src/village_processing/facade/models.py, local_gateway.py。
- [x] 添加并运行失败测试：submit/confirm传递组件模式、用途、楼层/屋顶数与范围；旧输入保持兼容。
- [x] 实现可选字段、Worker显式分支与任务状态恢复。
- [x] 运行 JS/Python 协议回归测试。

### Task 2: 固定生成器与识别服务
Files: rural_house_generator/backend/component_building/, backend/ml_worker.py, backend/app/facade/model_client.py, job_processor.py, server/src/village_processing/facade/pipeline.py。
- [x] 添加失败测试：完整图输入、比例估高、尺寸约束、改建跳过预处理。
- [x] 迁入有来源记录的本地解析、几何和材质代码，适配Linux路径与共享GPU锁。
- [x] 现有ML运行时增加构件识别和受保护构件掩膜；Worker执行配置的Blender。
- [x] 运行局部回归及真实本地Blender生成检查；不将合成检测当作真实GPU识别通过。

### Task 3: 页面和模型应用
Files: rural_house_generator/index.html, app.js, generation-mode.js, features/data/business-task-client.js。
- [x] 添加失败测试：现状锁定尺度、改建继承可改、完整图不显示裁屋顶、模式随任务恢复。
- [x] 增加两种方式、用途和简要参数控件；调用现有队列/预览/应用。
- [x] 复用资产保存机制，补充生成来源，确认不同模型资产不会覆盖。
- [x] 运行页面/模型持久化回归。

### Task 4: 部署与验收
Files: linux deployment requirements/images, docs deployment notes。
- [x] 核对Linux包资源、材质、ML端点和Blender版本；提供同版本云端/Worker更新步骤。
- [x] 运行相关Node/Python/部署测试并代码复核；记录未验证的远端GPU环节。
- [x] 检查git差异，更新本清单及验收记录。

## 实施与验收记录（2026-10-25）

- 在原目录 main 完成本地接入；旧实验目录未修改。
- 代码复核后修正Docker导入优先级、内院识别、轮询覆盖改建设计参数，以及产物提示与实际约束不一致。
- JS 1122项、API 136项、Python/部署契约153项通过；本机Blender3.6.23完成生成和GLB导出检查。
- 真实阿里云SQL升级、Docker构建、4090识别/生成、浏览器与地图落位验收仍待部署环境执行；PostGIS原生集成未运行。此清单完成代表本地实现和部署准备完成，不代表生产上线。
