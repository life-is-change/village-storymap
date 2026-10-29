# 对象详情空校核记录与实景对照展开入口

- 真实浏览器复现：深井村建筑选择后，控制台报 `normalizeReviewRow` 读取 null 的 `geometry_revision`，来自 `showObjectInfo` 的 downstream gate。照片/留言请求已结束，异常导致占位符未被替换。
- `normalizeReviewRow(null)` 按 pending、revision 0 处理，保留 downstream 禁止状态，不因缺少记录扩大照片上传或编辑权限。
- 所有村庄的实景对照默认收起，在右侧保留“展开实景对照”按钮；窗口内箭头用于收起。已有地图按钮也支持切换，收起后点击建筑不强制展开。
- 无实景模型时仍可展开，显示“当前村庄尚未发布实景模型”；有模型时用户展开才初始化 viewer，避免默认加载额外三维场景。
- 新增 null 校核、跨有无模型的展开/收起入口回归。前端全量 1139 项通过。
- 脚本版本更新为 `20261029-object-details`，包括入口、survey model、实景懒加载脚本和样式，避免已有页面继续加载旧资源。
- 沿用精确上下文前端补丁部署入口 `linux/scripts/repair-shenjing-workspace.py`；本版本只更新 index、app、style、survey model、reality inset 五个文件。
- 私有备份/回执目录：`/home/admin/village-autonomous/files/object-details-reality-20261029-v1`。保留上一轮修复，不覆盖整个站点，无数据库或 4090 变更。

## 线上验收

- d15a089 精确补丁预检、应用成功；五个前端文件更新，无服务重启。
- 刷新后实际加载 `survey-review-model.js?v=20261029-object-details`。选择深井村建筑 `AUTO_BUILDING_000860` 正常显示“暂无照片”和讨论状态，不再残留 loading，占位对象无校核记录时仍提示先校核。
- 深井村三维右栏保留展开按钮，展开显示未发布实景模型说明，收起恢复展开按钮。
- 切换米埗村后仍保留同一入口，点击后显示“米埗村实景模型”和加载进度，控制行为未限定村庄名称或 ID。
