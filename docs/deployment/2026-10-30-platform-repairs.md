# 2026-10-30 平台修复部署

本次合并“优化平台”和“排查优化平台未解决问题”两次聊天的修复，工作位置为原项目 main。

## 发布范围

9 个前端运行文件：app.js、app-3d.js、index.html、style.css、3D_scenes_edit/index.js、features/survey/survey-realtime-controller.js、features/sync/business-event-client.js、village_game/integration/loader.js、village_game/integration/workspace.css。

包括模拟顶栏与配置栏布局、按真实边缘定位的右栏按钮、共享订阅竞争/重连/失败清理，以及首次三维地形与相机初始化修复。权限规则保持原设计，未修改数据库或 API；不更新 4090。

## 验证与发布包

- Node 完整测试 1398 项通过，0 失败；独立复核和实际浏览器验收见 docs/plans/2026-10-30-platform-repairs.md。
- 发布包：linux/releases/platform-repairs-cloud-20261030.py。只接受已读取的线上九文件摘要或本次目标摘要，按代码差异更新，保留阿里云特有的既有配置。
- 本地部署演练：只读预检、九文件更新/备份、重复应用、未知线上修改拒绝、HTTPS 读回不一致时九文件回滚，均通过。
- 实际容器为 village-autonomous-web，挂载 /home/admin/village-autonomous/files/semester-groups-20261028-v1/web 到 /srv/village-web，容器内只读。
- 云端备份/回执位置：/home/admin/village-autonomous/files/platform-repairs-20261030-v1/。
- 发布不重启服务、不写数据库；index.html 最后更新，完成后逐文件通过容器挂载和真实 HTTPS 读取比对。

## 实际结果

用户已明确要求提交并部署。当前已完成本地预检与服务器挂载确认；实际提交、云端应用及线上验收结果待发布后追加。

### 已发布结果

- 修复提交：2233445dc12b540c4318acb0012a955a17fad027，已推送 origin/main。
- 在阿里云以 admin 从固定提交下载发布包，校验 SHA256：9cf9b6e90b58b1d2e21284bfa15c69bd2b710459a9e5206829a0a240dba7f261。
- 只读预检真实返回 frontend_preflight_passed；随后 --apply 返回 frontend_deployed，files=9、service_restarts=0。
- 9 个文件均通过容器挂载读回和服务器 HTTPS 读回；客户端另行对 9 个 URL 计算 SHA256，全部等于目标摘要。
- 刷新后的真实线上页面加载 app.js?v=20261030-startup-surface1 与 app-3d.js?v=20261030-startup-surface1；style.css 为 20261030-panel-anchor。
- 已验证首次 3D 显示加载提示，随后正常显示米埗村白模与影像；右栏按钮与面板边缘 1px 搭接；共享订阅 DOM 状态 connected；当前验收页控制台 error 列表为空。
- 云端完成回执及九个旧文件备份已保留在上述备份目录。未操作数据库、API 或 4090，不重启容器。
- 线上模拟入口验收未通过：米埗村管理员试用方案 R0 打开“村庄模拟”时提示“源对象编号重复：baseline:building:2:0”。因此本次不能声称真实基线数据的模拟入口已验收通过；布局的跨尺寸结果仍以此前本地组件验收为准。未删除或合并现状要素、未保存方案或运行模拟，已退出未修改的试用方案。此问题留待单独定位。
- 部署回执截图：C:/Users/MR/.codex/visualizations/2026/10/30/01a18bd4-5e60-7a62-b935-0c5eaff21452/platform-deployment-receipt.png。
