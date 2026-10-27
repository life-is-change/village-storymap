# Hybrid balcony implementation plan

**Goal:** 自动凹阳台净深1.5m、内凹1m、其余外挑，楼板与两侧栏杆连续。
**Architecture:** 在现有阳台关系上标记版本；纯坐标函数计算玻璃外表面与栏杆内侧距离；固定Blender生成器调用并输出尺寸清单。
**Tech Stack:** Python、现有DINO/SAM结果、Blender3.6.23、GLB。
**Spec:** docs/superpowers/specs/2026-10-27-hybrid-balcony-design.md

- [x] 测试先验证1m凹进关系以及金属/石材/实体栏杆净深、旧JSON兼容。
- [x] 实现关系、连续楼板/侧栏杆及manifest尺寸；不改底层白模与模型权重。
- [x] 原照片缓存与合成配置通过真实Blender生成、尺寸检查及渲染比较。
- [x] 制作基于已完成quality镜像的独立小覆盖层；真实Blender smoke通过，独立代码复核无遗留重要问题。
- [ ] 现场部署并使用远程新检测结果重新生成验收。
