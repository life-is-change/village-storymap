# 现有事件清单与研究语义映射

审计日期：2026-09-20  
范围：生产调用、SQL 内直接写入、logger 本地队列及测试中的候选 action。

## 1. Logger 行为

`features/course/activity-logger.js` 使用 `village_activity_events_v1` 保存本地事件；`client_event_id` 唯一，`flush()` 逐条 upsert，重复 flush 不会生成重复远端行（实现见 `:10`, `:92-141`）。页面刷新后 pending 仍在 localStorage，满足基本重试；但未找到 `online`、`visibilitychange` 或 `beforeunload` 自动补同步生命周期，也没有终态 `failed`。

当前 `recordCourseActivity()` 每次记录后立即异步 flush（`app.js:2299-2302`）。这不会记录鼠标移动或相机帧，噪声控制合理。

## 2. 生产环境真实 action

| 当前 action | 触发位置 | 研究语义 | 上下文/问题 | 判定 |
|---|---|---|---|---|
| `course_entered` | `app.js:8035` | 进入课程 | target=course；其余来自 logger context | 已完整实现。 |
| `task_opened` | `features/ui/course-workbench.js:263-266` | task_open | 与 task progress 可关联 | 已完整实现。 |
| `task_completed` | `features/ui/course-workbench.js:302-306` | task_complete | 同时更新 task progress | 已完整实现。 |
| `group_joined` | `features/ui/course-workbench.js:274-280` | 加入小组 | 包含 group id/name | 已完整实现。 |
| `theory_lesson_completed` | `app.js:1528-1533` | 理论学习完成 | lessonId/title | 已完整实现。 |
| `theory_practice_entered` | `app.js:1615-1620` | 进入理论实践 | 可关联 map task | 已完整实现。 |
| `feature_geometry_saved` | `app.js:6028-6035` | feature_save_batch | 带 layer/batch，不区分 add/move/delete；细节在版本表 | 等价实现。 |
| `object_attributes_updated` | `app.js:7018-7023`, `:7390-7394` | feature_attribute_update | 只记字段名，符合最小化 | 已完整实现。 |
| `diagnosis_created` | `app.js:7138-7142` | issue_create/diagnosis | 带 category/location flag | 已完整实现。 |
| `comment_created` | 同一条件分支 | 通用评论 | 当前 category 常有默认值，可能难以实际触发 | 仅前端存在/触发路径待验证。 |
| `photo_uploaded` | `app.js:7168-7174` | photo_upload | 带对象、文件名/大小 | 已完整实现；研究导出不要带照片本体。 |
| `object_comment_created` | `app.js:7897-7902` | comment_create | 对象可定位 | 已完整实现。 |
| `object_comment_liked` | `app.js:7910-7914` | 社交互动 | 研究价值较低但可保留 | 已完整实现。 |
| `object_comment_replied` | `app.js:7921-7925` | comment_reply | 对象可定位 | 已完整实现。 |
| `survey_geometry_confirmed` | `Shared Survey Calibration and Freeze.sql:393-403` | survey_confirm | DB 端记录，事实在 review 表 | 已完整实现（迁移层面）。 |
| `survey_geometry_add` | 同文件 `:646-656` 动态 action | survey_modify/feature_add | 批次/对象上下文由 SQL 生成 | 已完整实现（迁移层面）。 |
| `survey_geometry_update` | 同上 | survey_modify | 具体 before/after 在 feature_versions | 已完整实现。 |
| `survey_geometry_delete` | 同上 | feature_delete | 最终状态也在 review 表 | 已完整实现。 |
| `survey_snapshot_frozen` | 同文件 `:926-934` | baseline_freeze | target snapshot id | 已完整实现。 |
| `group_plan_edited` | `Group Plan Baseline Update.sql:687-702` | feature_save_batch | metadata 有 batch/saved count | 已完整实现。 |

## 3. 测试中出现、生产未接入的 action

| action | 证据 | 判定 |
|---|---|---|
| `view_switched` | `features/course/activity-logger.test.js:49-50,102` | logger 支持，但生产切换器未调用；**确实缺失**。 |
| `task_started` | `features/course/activity-logger.test.js:87,101` | 仅 logger 测试；真实任务只有 opened/completed。若研究确需“开始”，应先定义语义。 |

测试 action 不是生产事件，不能写进论文数据字典为“已采集”。

## 4. 按研究语义盘点

### 4.1 任务

- task_open：由 `task_opened` 覆盖。
- task_complete：由 `task_completed` + `task_progress` 覆盖。
- task_start：缺失，且“打开侧栏”不应自动等于开始。可在进入明确工作区/首次写操作时低频记录。
- task_submit / reopen：缺失。最终成果提交流程本身也不完整。

### 4.2 2D/3D 跨表征

- `view_mode` 列和 logger 能力已存在。
- `features/ui/view-switcher.js` 保持空间与选中对象，但未找到生产 `view_switched` 记录。
- 建议只在成功完成视图切换后记录一次 `view_switched`，metadata `{from,to}`；3D 加载失败记录 `result=failed`，避免把失败误当成进入 3D。
- 不采集相机旋转、缩放、拖动轨迹。

### 4.3 地图编辑

- 共享现状的 add/update/delete/confirm 已可区分。
- 普通/小组方案前端只记录 `feature_geometry_saved` 或 SQL `group_plan_edited`；对象级事实由 `feature_versions`、planning overrides 负责。
- restore、baseline update、conflict resolution 有事实表，但没有对应低频事件。这并不妨碍状态分析；只有需要统一时间线时才补轻量事件。

### 4.4 调研与证据

- photo、diagnosis、comment 已有动作；最终事实在业务表。
- 没有明确的 `evidence_link` / 通用 references。当前可通过 object code 进行弱关联，但不能证明学生把某照片主动引用为方案依据。
- 不建议为了论文强制每次编辑填写理由；P1 可给诊断/方案说明增加可选 references JSON。

### 4.5 版本与方案

- `survey_snapshot_frozen` 已记录。
- `feature_snapshots`、`group_baseline_updates`、`group_baseline_conflicts`、`group_plan_restore_points` 是更可靠的事实来源。
- `baseline_update`、`conflict_detect/resolve`、`plan_restore` 没有统一 activity action。研究导出应先导出这些事实表，而不是复制状态到日志。
- 人工里程碑 V1/V2/Vfinal 尚无稳定语义。

### 4.6 Scene 工作室

未找到以下生产事件：

- `scene_open`
- `scene_object_add/move/rotate/scale/delete`
- `scene_save`
- `scene_restore`
- `scene_snapshot_create`

scene 的草稿和版本事实已持久化，缺的是统一研究时间线。建议只在操作结束、保存、建版本、恢复时记录，不在 pointermove 写库。

## 5. 当前事件上下文完整性

ActivityLogger 本地创建事件时要求 project/village/space，上下文缺失会抛错；course/group/task 允许空。优点是关键地理上下文较严格，缺点是：

1. 管理员 sandbox 的 group null 是合法状态，导出不能判为错误。
2. scene 没有 task id，难以直接回答“哪个教学任务”。
3. `student_key` 可关联当前业务，但不能代替 immutable auth id。
4. `module/source_module`、`event_schema_version`、`app_version`、`result/error_code` 尚未标准化。

## 6. 候选补充语义的处置

| 语义 | 建议存放 | 优先级 | 理由 |
|---|---|---|---|
| `session_id` | 初期 metadata；稳定后再评估列 | P1 | 目前无法可靠计算跨会话持续性，但不必先 ALTER TABLE。 |
| `source_module` | metadata | P0 | course/survey/map2d/map3d/scene 足以解释来源。 |
| `event_schema_version` | metadata | P0 | action 语义变化时可兼容。 |
| `app_version` / commit | manifest 为主，事件 metadata 可选 | P1 | 每条重复写入价值有限。 |
| `result`, `error_code` | 关键写操作 metadata | P0 | 只记录保存/冻结/更新/上传/提交的成功失败。 |
| snapshot/revision ID | metadata | P0 | 已有事实表主键，不新增重复列。 |
| 高频相机/鼠标 | 不采集 | 禁止 | 高噪声、影响性能且研究价值低。 |

## 7. 管理员数据污染与离线风险

- logger 初始化会清理本地姓名为“管理员”的旧事件，但这不是可靠的研究排除规则，也不会证明远端已清理。
- 研究导出应按 `profiles.role`、账号白名单或演练批次排除教师/管理员，而不是按姓名。
- pending 在刷新后可留存；缺自动恢复触发、关闭前保障、队列上限和导出前完整性报告。

## 8. 最小事件字典建议

保留全部旧 action，不做破坏性重命名。新增时仅需要：

1. `view_switched`：成功切换一次记录一次。
2. `scene_opened`：成功装载项目后一次。
3. `scene_operation_committed`：add/move/rotate/scale/delete 在手势结束后一次，metadata 写 operation/category/object id/revision。
4. `scene_saved`、`scene_version_created`、`scene_restored`：与版本 ID 关联。
5. `critical_write_failed` 或沿用原 action + `result=failed/error_code`：仅关键写操作。

其余版本/冲突/恢复状态优先从事实表导出。
