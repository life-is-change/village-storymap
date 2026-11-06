# 缩放时替换模型短暂消失

## 已确认的代码原因

1. model-residency 在 LOD 改变时先 release 旧资源，再加载新资源。
2. addOrUpdateReplacementModel 也会先删除当前 primitive。
3. Cesium.Model.fromGltfAsync 返回后即将 primitive 放入 replacementModelMap 并隐藏白模，没有等待 GPU readyEvent。

这些路径使加载期间只剩白模，或新 primitive 未就绪时白模也被隐藏，产生可见空窗。

## 修复

- LOD 切换保留旧资源，新资源可渲染后再替换；失败保留旧资源。
- 首次替换时保留白模，直到 GPU ready。
- 过期的 LOD 请求在就绪后检查 token、目标空间及当前需求，禁止错误提交。
- GPU 错误或 30 秒超时清理候选资源，不覆盖原资源。
- 稳态保留原模型数量预算；切换时每个建筑可暂存旧、新两个模型，总并发仍最多两个，避免无上限预加载。

## 验证与部署

- 98 项 features/models 测试通过；新增 30 帧等待、反向缩放、失败保留、GPU 就绪门禁及首次白模保留测试。
- app-3d.js 与 app.js 语法检查通过；变更 diff-check 通过。
- 阿里云四文件部署（app-3d.js、app.js、index.html、features/models/model-residency.js），先 SHA 校验和备份，后逐字节 HTTPS 验证。
- 线上浏览器已确认加载 `20261106-ready-swap` 版本；三维正常进入。
- 服务端备份：~/generation-repair-20261105/model-swap-backup/；回执 model-swap-receipt.json。
- 当前登录账号米埗村个人体验空间 52 号为白模，没有可用替换模型；已向用户询问原复现位置，尚未宣称原位置逐帧验收通过。
- 进入三维的轻微卡顿本轮没有额外调整，避免把未经测量的性能变更混入视觉修复。


## 用户补充位置后的现场验收

用户重新应用“改建构件建筑-52-photo-625c33b1-662a-4ce3-903e-61961fba4534”后报告正常。数据库确认它已绑定米埗村当前个人体验空间 eec20936-9850-400a-86db-a522cc165ab4 的 52 号，资产未归档；旧模型另存在旧个人空间 5fa58379-03cf-4982-8aa3-b04934a15945，未作跨空间迁移。

现场已确认目标 primitive ready=true、show=true，白模隐藏。用当前实际模型做三轮沿镜头方向往返 100 米的受控缩放，逐帧采样 360 帧：替换模型可见 360 帧，白模回退 0 帧、两者同时不可见 0 帧、最长空窗 0 帧。测试结束恢复验收前相机位置与方向，没有修改模型参数或绑定。

截图：tmp/model-swap-release/building-52-verified.png。此结果覆盖本次视角和缩放范围，不替代所有设备、所有建筑的检查。
