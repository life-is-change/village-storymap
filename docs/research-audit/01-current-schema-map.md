# 当前数据库与研究上下文映射

审计日期：2026-09-20  
审计基线：本地 `learning` / `409bdc2`（`Backup 2026-0919`），对照 `origin/2026-0911` / `2c06121`（提交标题为 `Backup 2026-0912`）  
证据范围：仓库代码、SQL 迁移、自动化测试与迭代日志。**本报告未连接远端 Supabase，因此“迁移存在”不等于“线上已部署”。**

## 1. 总体判定

| 领域 | 判定 | 结论 |
|---|---|---|
| 课程、分组、任务进度 | 已完整实现（仓库层面） | 已有课程、小组、成员、任务进度和活动事件表；真实课堂数据仍需线上核验。 |
| 多村庄、教学项目上下文 | 已部分实现 | UUID 型 `teaching_project_id`、`village_id` 已通过后续迁移加入；旧 `courses.village_id` 仍是 text，需通过 teaching project 统一语义。 |
| 用户身份 | 已有等价字段但命名不同 | 权威身份是 `auth.uid()` / `profiles.id`；`student_key` 是业务关联键，不应再造第二套用户 ID。 |
| 共享现状校核 | 已完整实现（迁移层面） | 有事实表、版本批次、完整冻结快照和相应 RPC。真实初始化、并发和部署状态未核验。 |
| 小组方案与基线冲突 | 已完整实现（迁移层面） | 稀疏 override、冲突、恢复点均已存在；关键状态不应复制到 activity log。 |
| 3D 场景工作室 | 已完整实现（本地代码/迁移层面） | 独立 scene document、对象表、版本表、草稿保存和恢复能力均存在；研究日志与导出缺失。 |
| 研究导出 | 存在但无法满足研究 | 只有实名 activity CSV，缺匿名化、多表打包、manifest 与完整性检查。 |

## 2. 研究上下文 ID 映射

| 研究语义 | 当前权威来源 | 当前问题 | 建议 |
|---|---|---|---|
| 用户唯一身份 | `auth.users.id` / `profiles.id` | 业务表仍大量使用 `student_key` | 不新增用户 ID；导出时建立 profile/auth → `S01` 映射。 |
| 学生业务键 | `current_profile_student_key()`；前端 `buildStudentKey()` | 由 `student_id::display_name` 组成，显示名变化会改变键 | 本期冻结姓名可继续使用；长期迁移应以 UUID 为权威，不能仅靠姓名关联。 |
| 角色 | `profiles.role` | 线上 RLS/可读性未验证 | 课堂演练分别验证 student/teacher/admin。 |
| 课程 | `course_id` | scene project 通过 teaching project 间接取得；scene document 无直接字段 | 不必立刻加列；导出查询时 join `teaching_projects.course_id`。 |
| 教学项目 | `teaching_project_id` UUID | 后迁移加入 activity 与业务表，线上列存在性未知 | 开课前执行 schema 自检。 |
| 村庄 | 规范表 `villages.id` UUID | `courses.village_id` 和默认前端值仍是 text（如 `mibu`） | 研究分析以 UUID 为准，旧 text 仅作显示/兼容。 |
| 小组 | `course_groups.id` text / `group_id` | 管理员 scene sandbox 合法为 null | 导出保留 null 语义，不伪造小组。 |
| 任务 | `task_id` text | scene project/document 无直接 task id | P0 在 scene 版本 metadata 或项目 metadata 记录任务上下文。 |
| 空间 | `space_id` text；`planning_spaces.space_type` | 不同模块的空间类型需统一解释 | manifest 输出 space type 字典。 |
| 视图 | `activity_events.view_mode` | 生产代码未记录 2D/3D 切换 | 字段可复用；无需新列。 |
| 时间 | `occurred_at timestamptz`，事实表多用 `now()` | 前端事件使用客户端 ISO 时间，存在时钟偏差 | 导出统一 UTC，并保留导出时间；关键 DB 行以服务端时间为准。 |

身份函数见 `supabase_SQL/Secure Planning Space Visibility.sql:4`；前端业务键见 `features/course/course-model.js`。角色表见 `supabase_SQL/Supabase Auth Profiles and Identity RLS.sql:4`。

## 3. 核心表与研究用途

### 3.1 课程与行为

| 表 | 关键字段 | 研究用途 | 状态/风险 |
|---|---|---|---|
| `courses` | `id`, `title`, `village_id`, `stages`, `tasks` | 任务定义和课程上下文 | tasks 是 JSONB，足以扩展任务元数据；无需第二套研究任务表。 |
| `course_groups` | `id`, `course_id`, `name`, `join_code`, `space_id` | 小组与正式方案空间 | 可映射匿名组号。 |
| `group_memberships` | `course_id`, `group_id`, `student_key`, `role` | 学生—小组关系 | 依赖可变 student_key。 |
| `task_progress` | `student_key`, `group_id`, `task_id`, `completed_at` | 任务完成事实 | 有完成，无独立“开始”事实。 |
| `activity_events` | 见第 4 节 | 低噪声过程时间线 | 缺 session、模块、结果语义和部分关键事件。 |

定义证据：`supabase_SQL/Task-driven Course Workbench Schema.sql:4-66`。

### 3.2 项目与村庄

| 表 | 关键字段 | 研究用途 | 状态/风险 |
|---|---|---|---|
| `villages` | UUID `id`, `name`, `is_practice`, `status`, boundary | 正式/练习村庄身份 | 线上数据是否建立未知。 |
| `village_datasets` | village UUID, `version_number`, manifest/config, status | 数据集版本与复现实验环境 | 可写入 export manifest。 |
| `teaching_projects` | UUID `id`, `course_id`, practice/formal village, `stage` | 串联课程与正式村庄 | 是跨模块的规范项目键。 |
| `village_reality_models` | village/dataset/scene/source metadata | 3D 实景参考来源 | 属于背景参考，不等同可编辑方案对象。 |

定义证据：`supabase_SQL/Multi-Village Dual-Track Foundation.sql:7-74`。

### 3.3 共享现状、版本与证据

| 表 | 关键字段 | 研究用途 | 判定 |
|---|---|---|---|
| `survey_feature_reviews` | object、`geometry_status`、reviewer/modifier、revision、batch | 对象最终校核事实 | 已完整实现（迁移层面）。 |
| `feature_change_batches` | editor、summary、note、context | 关键修改批次 | 已完整实现。 |
| `feature_versions` | action、before/after geom/props、batch | 可重建对象变化 | 已完整实现；activity 不应重复存几何。 |
| `feature_snapshots` | type、label/description、version、published/recommended | V0 和完整版本 | 已完整实现；缺统一 milestone tag。 |
| `feature_snapshot_items` | snapshot + 对象完整状态 | 冻结结果 | 已完整实现。 |
| `object_photos` / `object_comments` / `community_tasks` | object/context/reference fields | 调研证据、诊断与讨论 | 已部分实现；缺通用“方案说明引用证据”关系。 |

证据：`supabase_SQL/Shared Current Survey Versioning and Feature Locks.sql:18-68`、`supabase_SQL/Shared Survey Calibration and Freeze.sql:6`。

### 3.4 小组方案

| 表/字段 | 语义 | 研究用途 | 判定 |
|---|---|---|---|
| `planning_features.operation_kind` | `added/updated/deleted` | 区分小组对基线的操作 | 已完整实现。 |
| `base_object_code`, `base_snapshot_id`, `feature_revision` | override 的来源与修订 | 追踪小组修改 | 已完整实现。 |
| `group_baseline_updates` | 一次基线更新 | V0 后续更新事实 | 已完整实现。 |
| `group_baseline_conflicts` | 冲突类型、决议和时间 | 分析协作/冲突 | 已完整实现。 |
| `group_plan_restore_points` | 更新前恢复点 | 意外恢复与版本证据 | 已完整实现。 |

定义证据：`supabase_SQL/Group Plan Baseline Update.sql:45-100`。RPC 写入口见同文件 `:892`、`:1012`。

### 3.5 3D 场景

| 表 | 关键字段 | 研究用途 | 判定 |
|---|---|---|---|
| `scene_edit_projects` | project/village/space/group/scope/baseline/boundary/revision | 场景归属与草稿头 | 已完整实现；缺直接 task id。 |
| `scene_edit_objects` | stable object id、kind/category、geometry/transform/props | 可编辑对象当前事实 | 已完整实现。 |
| `scene_edit_versions` | project/revision/label/document/submission status/time/user | scene revision | 已完整实现；缺 research export。 |
| `scene_edit_assets` / `scene_edit_components` | 资产、组件、来源和共享范围 | 素材来源与复用 | 已完整实现。 |

定义证据：`supabase_SQL/Scene Edit Studio.sql:5-112`。管理员无组沙盒兼容见 `supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql:4-19`。

## 4. `activity_events` 实际迁移字段

| 字段 | 类型/空值 | 写入来源 | 研究评价 |
|---|---|---|---|
| `event_id` | text PK, not null | 前端/SQL | 可用。 |
| `client_event_id` | text unique, not null | 前端/SQL | 幂等键，可用。 |
| `occurred_at` | timestamptz, not null | 客户端 ISO 或 SQL `now()` | 可用，需注意客户端时钟。 |
| `student_key` | text, not null | ActivityLogger/SQL 身份函数 | 可用但不是永久权威 ID。 |
| `student_name` | text, nullable | 前端/SQL | 业务可保留，研究导出必须排除。 |
| `course_id` | text, nullable | 当前课程上下文 | 关键事件应有值。 |
| `teaching_project_id` | UUID, 后迁移加入 | 活动上下文/SQL | 仓库存在，线上未知。 |
| `village_id` | UUID, 后迁移加入 | 活动上下文/SQL | 仓库存在，线上未知。 |
| `group_id` | text, nullable | 小组上下文 | 个人/管理员场景允许 null。 |
| `task_id` | text, nullable | 当前任务 | scene 与部分 app 操作可能为空。 |
| `space_id` | text, nullable | 当前空间 | ActivityLogger 本地上下文要求非空。 |
| `action` | text, not null | 前端/SQL | 需要事件字典，不要强改旧 action。 |
| `target_type`, `target_id` | text, nullable | 调用点 | 多数对象事件可定位。 |
| `view_mode` | text, nullable | metadata/context | 字段存在，但生产切换事件缺失。 |
| `metadata` | JSONB | 调用点 | 可承载 module/schema/app/result/revision，避免立即加列。 |

基础定义见 `supabase_SQL/Task-driven Course Workbench Schema.sql:50`，项目/村庄列见 `supabase_SQL/Multi-Village Dual-Track Foundation.sql:116-118`。

## 5. RLS、RPC 与 Realtime

- 课程初始迁移里的公开策略不是最终可信状态；后续 auth、secure visibility、repair 迁移会收紧权限。由于未查询线上 `pg_policies`，**最终 RLS 状态为“待远端核验”**。
- 共享现状和小组方案采用受控 RPC，而不是浏览器直接改版本表；这是适合研究的数据完整性设计。
- scene 草稿采用 revision 乐观锁，version 行有不可变保护。主要入口见 `supabase_SQL/Scene Edit Studio.sql:270-506`。
- Realtime 配置脚本与前端订阅均存在；前端对 planning features、spaces、community tasks、调查状态、group baseline 状态订阅见 `app.js:8331-8539`。
- 迭代日志声称相关迁移和 Realtime 已执行（`docs/PLATFORM_ITERATION_LOG.md:93-130`），但它不是当前远端数据库的直接证据。

## 6. 必须在线核验的项目

1. 查询 `information_schema.columns`：确认 activity 的 project/village 列、scene 表、group baseline 表真实存在。
2. 查询 `pg_policies` 与函数权限：确认 anon 不可写、authenticated 只在授权范围操作。
3. 查询 `pg_publication_tables`：确认 survey、version、group baseline 等表已加入 Realtime。
4. 确认正式 teaching project、formal village、`formal_shared`、两个 group plan 有真实记录。
5. 确认 V0 初始化与冻结不是仅测试数据。

## 7. 本轮禁止的推断

- 不把 SQL 文件存在表述为已上线。
- 不把测试通过表述为三学生真实并发已验证。
- 不把 `student_name` 当成研究身份。
- 不新建第二套 activity、snapshot、scene revision 或研究任务表。
