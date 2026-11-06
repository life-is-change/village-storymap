# 场景模型与可编辑组合接入记录

日期：2026-11-05。工作位置：原项目 main。未提交、未部署，保留工作区原有改动。

## 交付内容

- 从 E:/GLB_model 导入 100 个独立模型、24 套可编辑组合，原始库不修改。
- 中文分类、尺寸提示、真实模型缩略图、二维俯视图、底部中心锚点及本地纹理；资源约 5.35 MiB。
- 各组合展开为独立子对象，可选择整组、移动、旋转、复制、拆组或单独编辑子对象；组合操作可一次撤销。
- 放置和变换均检查完整占地、边界及锁定状态，失败时不留下半组对象。
- 已定义市场范围内放置的真实摊位沿用 siteId、marketId 和市场角色；装饰不计作摊位。本次不新增市场模拟规则。
- 素材许可见 3D_scenes_edit/assets/curated/ATTRIBUTION.md；补充纹理的来源与摘要见 source-textures/sources.json。

尺寸是教学设计默认值，使用统一比例校准，未声称为实测产品尺寸。详细原始尺寸、缩放比例及校准结果见 calibration-report.json。

## 验证

专项测试：103 项通过，0 项失败。覆盖素材完整性、纹理内嵌、真实后端文档合同、组合历史、锁定和边界、市场归属、二维旋转方向、对象树及素材入口。

全量 npm test：1494 项，1479 项通过，15 项失败。失败主要涉及本次未修改的 app.js、app-3d.js、SQL 与既有路由清单。因为没有本轮开始时的完整脏工作区测试基线，不能断言全部是历史失败。失败项为：

1. scene studio schema defines the five scoped data responsibilities
2. cold building load overlaps CSV, geometry and scoped edit reads; stale result is discarded
3. camera uses current village extent before any building or terrain await
4. building click exposes loading panel and starts all reads before remote data returns
5. applied generated buildings do not reappear alongside the old 3D baseline
6. 3D reads ordinary practice_personal as planning features without calling the result version API
7. 3D reads ordinary formal_personal as planning features without calling the result version API
8. 3D reads explicitly versioned produced from the personal result API
9. 3D reads explicitly versioned legacy-produced from the personal result API
10. 3D does not swallow a genuine forbidden result-space read or fall back to baseline data
11. later reloads only focus the current data source in the active view
12. the map application requests the authenticated 3D client release
13. 三维运行时切村时重建当前村庄影像并使用最新地理范围
14. machine probe route inventory exactly matches frontend fixed routes
15. object selection renders feedback before optional remote details finish

日志：tmp/curated-targeted-suite.txt、tmp/curated-full-suite-final.txt。

独立代码复核发现并修正两项问题：GLB 的 Y 轴旋转与 Cesium heading 符号相反；单独编辑子对象时也必须检查完整占地。均增加回归测试。

实际 Edge 浏览器验证了市集、儿童活动角、亭下茶叙组合的模型和纹理；二维放置、三维整组拖动、旋转、复制、撤销、拆组与刷新恢复。校验页控制台未出现 warning/error。

截图：tmp/curated-market-browser.png、tmp/curated-playground-browser.png、tmp/curated-pavilion-browser.png。

## 本地校验

运行 `node tools/create-curated-preview.cjs`，再运行 `node tools/serve-curated-preview.cjs 5512`，打开 http://127.0.0.1:5512/tmp/curated-preview.html 。

这是使用真实编辑器、OpenLayers 和 Cesium 的离线模型校验页，保存到独立 localStorage，不连接阿里云数据库。主平台的素材入口也已接入同一目录；本轮没有进行登录生产平台的保存测试。

重新生成资源顺序：`node tools/import-curated-scene-assets.cjs E:/GLB_model`，然后 `node tools/render-curated-thumbnails.cjs`。导入器会重建目录索引，因此缩略图生成步骤必须最后执行。

## 明确边界

未修改 4090、开机服务或数据库。没有部署阿里云，也没有将包含其他历史改动的工作区整体提交。
