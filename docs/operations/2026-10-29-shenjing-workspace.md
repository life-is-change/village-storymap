# 深井村工作区首次加载与绘制优化

## 问题及修改

- 首页入口将课程小组传给旧的 `openCoursePlanningWorkspace`。332 有组资格却没有旧式 `spaceId`，触发报错并提前返回，跳过二维 overlay 的首次刷新。
- 首页现在明确打开已准备村庄的共享现状空间；小组方案继续使用明确入口，未改变学期、小组或成果权限。
- 没有已发布实景模型的村庄不显示空的实景窗口；点击白模也不再将其打开。已有实景模型的窗口关闭后，后续点击建筑保持关闭，可用原有实景按钮重新打开。
- 建筑样式按 feature 弱引用缓存，几何/属性 revision、分辨率、选中/悬停、图底模式、现状校核视觉状态或 OL 实例变化时失效。减少相同建筑重复绘制时的 Style/Fill/Stroke 创建，保留编辑和校核反馈。
- 深井村本地 V0 的 buildings.geojson 为 592177 bytes，imagery.webp 为 1333896 bytes。文件体积不大；此次没有采集真实 FPS 或 CPU profile，不据单纯缓存测试宣称全部卡顿消除。Canvas readback 提示不是矢量读取失败的证据。

## 测试与部署

- 新回归先复现：332 无旧式 spaceId 的入口误路由、无实景模型的窗口初始可见、相同建筑重复分配样式。
- 前端全量 1137 项通过。缓存测试覆盖重复读取、选中、revision、图底模式和视觉透明度变化。
- 提交 d06c7d0；线上三个脚本精确上下文预检、备份、替换完成。浏览器仍使用旧脚本 URL 后，增加 f7e82eb 的入口及懒加载脚本版本更新，前端全量仍通过。
- 部署入口：`sudo -n python3 -B linux/scripts/repair-shenjing-workspace.py` 预检，加 `--apply` 应用。
- 只对实际 Web 挂载内 index.html、app.js、map-style.js、reality-inset.js 应用已审核片段，保留原站其他更新。不重启服务，不更新数据库或 GPU。
- 原脚本及回执：`/home/admin/village-autonomous/files/shenjing-workspace-20261029/` 和 `shenjing-workspace-20261029-v2/`。v2 回退点保留第一阶段的功能修复；如需完整回退须同时核对两阶段备份，不能将旧整个网站覆盖回来。
- 线上实际目录仍为 `/home/admin/village-autonomous/files/semester-groups-20261028-v1/web`。本次文件更新会使之前发布的全树哈希回执过期，后续维护应以当前文件与此次备份/回执为准，不以旧回执覆盖最新内容。

## 浏览器实际验收

- 管理员刷新，首页选深井村后首次进入共享现状空间，建筑、道路、水系直接显示，无小组规划空间提示；没有先切换个人空间。
- 切到三维后 `reality3dPanel` 为 `is-hidden`、没有可见布局区域。点击建筑 `AUTO_BUILDING_000158` 后仍隐藏，白模和模型编辑栏正常显示。
- 新脚本版本为 `20261029-workspace-entry`；用户已打开的页面需刷新后生效。
- 仅检查与选择对象，未提交学生数据或修改共享现状。
