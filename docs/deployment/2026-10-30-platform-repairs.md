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
