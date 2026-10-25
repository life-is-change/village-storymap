# 平台本地构件生成器

由用户授权的独立 Blender Demo 迁入。`provenance.json` 记录原文件 SHA256，迁入后为包导入、任务目录及平台输入做了适配；不包含 Demo 数据库、用户照片、模型权重或大模型 API。

调用链：工作站 ML 的 DINO/SAM2 → `detection.py` → `adapter.build_spec` → 固定 `modeling/generate_facade.py` → Blender 3.6 → GLB → `assets.optimize_web_glb`。外部入口为 `service.generate_components`，只在工作站 Worker 调用。

本次复用现有 DINO/SAM2 权重及共享 GPU 锁，未启用独立 Demo 的可选 DINOv2 六样例构件检索库与 DepthAnything 相对深度模块；不会自动下载额外模型。颜色、拱窗、栏杆等仍由检测、像素分析和固定构造规则推断，隐藏立面按规则补全。不得把此链路描述为全自动精确重建。

现状模式只支持无内院的近矩形占地。源长度/进深不可改，墙高按矫正图墙身比例计算；朝向及模型中心补偿在平台绑定时应用。改建模式继承可编辑尺寸，直接识别标准正立面。完整屋顶始终送入构件识别，不使用贴图链路的裁屋顶操作。

材质来源与许可见 `data/source/realistic/manifest.json` 和该目录 README。导出含嵌入式 PBR 贴图；灯光、环境和后处理由网页预览器决定，GLB 不保证复刻 Blender 视口。

部署和实际验证范围见仓库 `docs/deployment/2026-10-25-component-building.md`。
