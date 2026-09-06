# 阶段 2：共享现状校核部署记录

更新日期：2026-09-05  
目标 Supabase 项目：`rzmbmwauomzwiyenafha`

## 当前状态

- 本地代码与增量迁移已完成。
- 全量 380 项 Node 测试以及 `app.js`、`admin.js` 语法检查通过。
- Supabase MCP 已恢复，并确认目标为 `rzmbmwauomzwiyenafha`。
- `shared_survey_calibration_and_freeze` 已于 2026-09-05 作为一个事务整体应用。
- Realtime 采用最小增量，只新增 `survey_feature_reviews`；未重复执行会触及身份与会话表的旧全量脚本。
- `shared_survey_calibration_security_followup` 已撤销内部触发器函数的直接 API 执行权限。
- 当前教学项目尚未绑定正式村庄，因此 V0 初始化与多身份真实协作验收尚未执行。

## 部署前只读盘点

恢复远程连接后记录以下数据，并确认项目、村庄与空间三者一致：

| 项目 | 待填写结果 |
| --- | --- |
| 教学项目 ID | `00000000-0000-4000-8000-000000000003` |
| 正式村庄 ID | 未绑定（`null`） |
| `formal_shared` 空间 ID | 尚未创建 |
| V0 建筑数 | 0（无正式空间，不能作为最终分母） |
| V0 道路数 | 0（无正式空间，不能作为最终分母） |
| V0 水系数 | 0（无正式空间，不能作为最终分母） |
| 活动对象锁数 | 0 |
| 现有快照数 | 0 |
| 孤立 `planning_features` 数 | 待正式村庄绑定后按目标上下文复核 |

## 部署顺序

1. 只读盘点并保存计数。
2. 整体执行 `Shared Survey Calibration and Freeze.sql`。
3. 执行 `Realtime Publication Setup.sql`，确认 `survey_feature_reviews` 已加入 publication。
4. 对正式共享空间初始化 V0 校核索引，并核对固定分母。
5. 使用管理员、两名项目学生、非项目成员和匿名身份完成 RLS/RPC 验收。
6. 在学生端验证校核、共享解锁、旧修订冲突、断线保护和 18% 淡化显示。
7. 在后台验证筛选、历史、恢复、活动锁阻止冻结及成功冻结。

## 必测错误码

- `GEOMETRY_REVISION_CONFLICT`
- `FEATURE_LOCK_REQUIRED`
- `GEOMETRY_REVIEW_REQUIRED`
- `ACTIVE_FEATURE_LOCKS`
- `SNAPSHOT_PHOTO_IMMUTABLE`
- `PROJECT_ACCESS_REQUIRED`

## 回滚原则

该迁移以新增表、字段、函数、触发器和策略为主。发生异常时先停止前端发布并保留事务错误输出，不删除快照、历史版本或证据引用。由于迁移文件以事务包裹，首次执行失败会整体回滚；若执行成功后才发现业务问题，应编写单独的前向修复迁移，不回改或分段重跑已应用脚本。

## 已知部署前提

冻结 RPC 从 `planning_features` 收集服务器端现状事实。正式部署前必须确认目标共享空间已有完整可冻结的现状行；如果该表仅保存相对 V0 的稀疏覆盖项，应先增加 V0 服务端物化步骤，否则不得冻结，以免快照缺少未修改对象。
