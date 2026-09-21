# 村庄规划互动平台：研究可用性核验与完善清单（供 Codex 对照）

> **用途**：这不是“照着清单直接开发新功能”的需求文档，而是一份 **先核验现有实现，再做最小完善** 的研究准备清单。  
> **仓库**：`life-is-change/village-storymap`  
> **远端核验基线分支**：`2026-0911`  
> **重要补充**：本地正在开发的 **3D 公共空间场景设计/场景工作室** 可能比 GitHub 分支更新。涉及该模块时，必须先检查本地工作区，不能仅以远端分支判断“没有实现”。  
> **论文目标**：支持“教学意图—AI辅助转译—专业校验—课堂使用—过程证据—再设计”的设计研究，而不是为了收集数据而无限增加埋点。

---

## 0. Codex 执行规则：先审计，后修改

请严格按以下顺序处理：

1. **先读取仓库现状**，包括前端、Supabase SQL、Edge Function/Server、测试、`docs/PLATFORM_ITERATION_LOG.md`。
2. 对本清单每一项输出：
   - `已完整实现`
   - `已部分实现`
   - `已有等价字段/功能但命名不同`
   - `仅前端存在，未持久化`
   - `仅数据库存在，前端未调用`
   - `存在但日志/版本无法用于研究`
   - `确实缺失`
3. **不要因为清单给出了候选字段名就直接新增同名字段。**  
   先建立“研究语义 → 现有字段/表/函数/事件”的映射。
4. 若已有等价能力，优先复用；若只差少量上下文或索引，做最小改动。
5. 任何 schema 修改前，先列出：
   - 当前表结构；
   - 现有调用位置；
   - 兼容性影响；
   - 是否需要迁移旧数据；
   - 是否会影响 RLS / RPC / Realtime / 测试。
6. **不要删除、重命名或重构现有成熟模块**，除非有明确证据说明会导致研究数据不可用。
7. 所有新增研究日志都应“低侵入、可关闭、可导出”，避免影响课堂性能。
8. 不记录无研究价值的高频行为，例如每一帧相机变化、鼠标移动、地图拖动轨迹。
9. 对学生数据采用最小化原则；研究导出时优先使用匿名/伪匿名 ID，不导出真实姓名、学号。
10. 完成审计后，先输出审计报告和建议补丁列表，**等待确认后再实际修改代码/数据库**。

---

# 1. 基线与上下文核验

## 1.1 先确认实际入口与版本

请核验：

- [ ] 根目录 `/index.html` 是否仍为唯一整合平台入口。
- [ ] `app.js`、`app-3d.js`、`features/course/*`、`features/survey/*`、`features/3d/*` 的加载关系。
- [ ] 当前本地工作区是否包含未推送的 3D 场景设计文件或数据库迁移。
- [ ] 当前远端 `2026-0911` 与本地 HEAD 的差异。
- [ ] 当前 Supabase 远端 schema 是否与 `supabase_SQL/` 最新迁移一致。
- [ ] 正式教学项目、正式村庄、`formal_shared`、group plan 是否已在真实数据环境中建立。

建议输出一张表：

| 模块 | 远端分支状态 | 本地状态 | 数据库状态 | 是否存在未提交差异 |
|---|---|---|---|---|

---

# 2. 研究上下文 ID：必须能把所有数据串起来

论文后续需要按 **学生/小组/课程/教学项目/村庄/任务/空间/时间** 重建过程。

请先核验现有字段/上下文是否已经能够稳定获得以下“研究语义”：

| 研究语义 | 候选现有字段 | Codex 要做的事 |
|---|---|---|
| 用户唯一身份 | `student_key` / `auth.uid()` / profile id | 找出真实权威ID；不要新造第二套用户ID |
| 研究匿名ID | 可能暂无 | 优先在导出阶段映射，不一定写入业务表 |
| 角色 | `profiles.role` | 确认 student/teacher/admin 是否可读 |
| 课程 | `course_id` | 确认所有研究日志都能拿到 |
| 教学项目 | `teaching_project_id` | 核验 `activity_events` 远端实际列 |
| 村庄 | `village_id` | 核验 UUID/text 类型与跨模块一致性 |
| 小组 | `group_id` | 核验个人空间/共享空间无小组时的 null 逻辑 |
| 任务 | `task_id` | 核验场景任务/课程阶段是否都可关联 |
| 空间 | `space_id` | 区分 personal / formal_shared / group_plan |
| 视图 | `view_mode` | 统一 2d/3d 等语义 |
| 时间 | `occurred_at` | 检查客户端/服务器时间、时区、一致性 |

### 验收条件

- [ ] 任意一条关键事件都可以回答：**谁、什么时候、在什么课程/村庄/小组/任务/空间、做了什么**。
- [ ] 不依赖 `student_name` 才能关联学生。
- [ ] 研究导出时可以稳定把真实账号映射为 `S01/S02...`，小组映射为 `G01/G02...`。

---

# 3. `activity_events` 与 ActivityLogger 全面审计

已知入口请优先检查：

- `features/course/activity-logger.js`
- `supabase_SQL/Task-driven Course Workbench Schema.sql`
- 其他迁移中对 `activity_events` 的 ALTER
- `app.js`
- `app-3d.js`
- `features/course/*`
- `features/survey/*`
- `features/3d/*`

## 3.1 先输出“真实字段表”

请不要照抄下面字段直接建表。先查询实际远端 schema 和迁移，输出：

| 实际字段 | 类型 | nullable | 写入位置 | 研究用途 | 是否有问题 |
|---|---|---|---|---|---|

重点确认是否已有或等价于：

- `event_id`
- `client_event_id`
- `occurred_at`
- 用户唯一ID/`student_key`
- `student_name`（业务可保留，但研究导出应去标识）
- `course_id`
- `teaching_project_id`
- `village_id`
- `group_id`
- `task_id`
- `space_id`
- `action`
- `target_type`
- `target_id`
- `view_mode`
- `metadata`

## 3.2 候选补充语义：先判断是否必要

以下不是强制字段，Codex 应先判断现有 `metadata` 或其他表能否满足：

- `session_id`：一次连续使用会话，用于判断跨会话持续使用。
- `module` / `source_module`：如 course / survey / map2d / map3d / scene。
- `event_schema_version`：以后 action 语义变化时便于兼容。
- `app_version` / git commit：若课堂期间持续部署更新，可帮助解释行为差异。
- `result`：`success / cancelled / failed`，仅对关键写操作有意义。
- `error_code`：关键保存失败、同步失败时记录；不要把完整错误堆栈和敏感信息塞进事件。
- `related_snapshot_id` / `revision_id`：若版本表已有外键或 metadata 能关联，不要重复造字段。

请给出结论：
- 哪些已有；
- 哪些可放 `metadata`；
- 哪些确实值得新增列；
- 哪些不建议采集。

---

# 4. 行为事件字典：先盘点现有 action，再映射

**目标不是把所有现有 action 强行重命名。**

请扫描仓库中所有：
- `.record(...)`
- `activityLogger.record(...)`
- `action:`
- 与 `activity_events` 写入相关的调用

输出完整 action 清单，并按以下研究语义映射。

## 4.1 任务类

候选研究语义：

- `task_open`
- `task_start`
- `task_submit`
- `task_reopen`
- `task_complete`

核验：
- [ ] 课程阶段点击是否有日志。
- [ ] “打开任务”与“完成任务”是否能区分。
- [ ] 仅切换侧栏是否不被误当作任务开始。
- [ ] task progress 与 activity event 是否可对应。

## 4.2 视图类

候选研究语义：

- `view_2d_enter`
- `view_3d_enter`

核验：
- [ ] 2D→3D、3D→2D 切换是否记录。
- [ ] 是否带当前 task/space/group。
- [ ] 是否能够连续重建视图切换序列。
- [ ] 不记录 Cesium 每次相机旋转/缩放。

## 4.3 空间编辑类

候选研究语义：

- `feature_add`
- `feature_geometry_update`
- `feature_attribute_update`
- `feature_delete`
- `feature_restore`
- `feature_save_batch`

核验：
- [ ] 新增、移动、旋转、顶点修改是否已有可区分的业务历史/日志。
- [ ] 如果数据库版本表已经完整记录“前后状态”，activity event 不要重复存整段 geometry。
- [ ] `target_type + target_id` 能否定位对象。
- [ ] 批量保存时能否知道本批修改对象数量和类型。

## 4.4 调研与证据类

候选研究语义：

- `survey_confirm`
- `survey_modify`
- `photo_upload`
- `issue_create`
- `comment_create`
- `evidence_link`

核验：
- [ ] 现状校核状态本身是否已有事实表，日志只记录行为即可。
- [ ] 照片、问题、评论是否能关联到 object code / revision / task。
- [ ] 当前是否存在真正的“证据引用到诊断/方案说明”功能；若没有，不要为了论文强行做复杂链条。
- [ ] 如果学生实际上很少使用评论/问题，不要强制提高使用率。

## 4.5 版本与方案类

候选研究语义：

- `plan_snapshot_create`
- `baseline_freeze`
- `baseline_update`
- `conflict_detect`
- `conflict_resolve`
- `plan_restore`
- `plan_compare`

核验现有：
- `feature_snapshots`
- `group_baseline_updates`
- `group_baseline_conflicts`
- `group_plan_restore_points`
- 其他 snapshot/version 表

优先复用事实表，不要把所有状态都复制进日志。

## 4.6 3D 场景设计类（重点核验本地未推送代码）

候选研究语义：

- `scene_open`
- `scene_object_add`
- `scene_object_move`
- `scene_object_rotate`
- `scene_object_scale`（只有确实允许且有教学意义时）
- `scene_object_delete`
- `scene_save`
- `scene_restore`
- `scene_snapshot_create`

要求：
- [ ] 先找到本地真实模块、数据表/JSON schema 和保存机制。
- [ ] 若已有统一 scene document，不要为每个对象另建碎片表。
- [ ] 高频拖拽过程中不要每个 mousemove 都写库；建议在“操作结束/保存”时记录一次。
- [ ] 事件 metadata 可记录对象类别、操作前后关键参数或 scene revision ID，但避免重复存大体量模型数据。

---

# 5. 正式课堂版本链：V0 / V1 / V2 / Vfinal

论文希望分析方案演化，但不要先假设平台没有版本能力。请先审计：

- `feature_snapshots`
- 共享现状冻结
- group plan baseline
- group override/revision
- restore point
- 当前成果提交机制

## 5.1 研究语义

- `V0`：全班校核后冻结的正式共享现状 / 小组共同基线。
- `V1`：小组第一版相对完整的初步方案。
- `V2`：经过课堂讨论、3D/场景任务等后的主要修改版。
- `Vfinal`：最终课程成果。

### Codex 任务

先判断：
1. 现有 snapshot 是否已经可以人为创建并命名/标记；
2. 是否已有 `version_number`、`label`、`stage`、`recommended_for_groups` 等字段；
3. group plan 的里程碑版本是否能完整重建；
4. 3D scene 是否与2D方案版本同步或有自己的 revision；
5. 是否需要新增**轻量的“milestone tag”**，而不是另建一套版本系统。

建议目标语义（字段名不强制）：

```text
snapshot_id
space_id
group_id
baseline_snapshot_id
milestone_type = V0 | V1 | V2 | VFINAL | null
label
created_at
created_by
task_id / stage_key (如已有上下文)
note (可选)
```

**必须先确认现有 snapshot 体系能否承载。**

---

# 6. 共享现状校核链路核验

重点入口：

- `supabase_SQL/Shared Survey Calibration and Freeze.sql`
- `features/survey/*`
- 后台现状校核模块
- Realtime 与对象锁

请核验：

- [ ] `geometry_status` 等状态是否为事实来源。
- [ ] `pending / confirmed_unchanged / modified / deleted / added` 是否完整。
- [ ] 首次校核者、最后修改者、时间是否存在。
- [ ] 属性、照片、问题、评论与几何校核的依赖逻辑是否实际生效。
- [ ] V0 初始化是否针对正式村庄完成。
- [ ] `formal_shared` 是否真实存在并能多人并发。
- [ ] 断线重连、锁过期、保存失败是否经过真实浏览器联调。
- [ ] 冻结快照是否是“完整合并结果”，而不是稀疏 override。
- [ ] 冻结后 group plan 是否从正确的 snapshot 创建。

研究上至少需要导出：
- 每个对象的最终校核状态；
- 谁在何时确认/修改；
- 关键修改批次；
- 冻结版本ID。

---

# 7. 小组方案、基线更新与冲突核验

重点入口：

- `supabase_SQL/Group Plan Baseline Update.sql`
- planning space / planning feature 相关 migration
- group plan 前端/后台模块

请先画出当前真实数据模型：

```text
正式共享现状 snapshot
        ↓
group plan space
        ↓
baseline object + group override
        ↓
revision / conflict / restore
```

核验：

- [ ] 每个小组是否只有一个正式 group plan space。
- [ ] `operation_kind` / `base_object_code` / `base_snapshot_id` / `feature_revision` 的实际语义。
- [ ] 新增、删除、修改是否能区分。
- [ ] baseline 更新时哪些对象被判定冲突。
- [ ] 冲突解决结果是否可追踪。
- [ ] restore point 是否可用于课堂意外恢复。
- [ ] 每次关键方案保存是否能形成可分析版本，而不只是当前状态覆盖。

---

# 8. 2D / 3D 同源与跨表征使用核验

研究不需要证明“3D优于2D”，而需要知道学生如何组合使用。

请检查：

- [ ] 2D/3D 切换是否保持当前 `space_id`。
- [ ] 是否保持当前选中对象/对象上下文。
- [ ] 3D中对象是否对应2D同一 `object_code` / feature id。
- [ ] 3D修改如果改变2D事实，是否有统一持久化来源。
- [ ] 进入3D前后的关键方案修改能否在时间线上关联。
- [ ] view switch event 是否会被重复触发/刷新误记。
- [ ] 3D加载失败是否会导致事件序列误判。

如果存在多个3D来源（白模、GLB替换、Reality inset、3D Tiles/倾斜模型），请说明：
- 哪些属于“可编辑方案对象”；
- 哪些只是背景/参考；
- 研究日志只记录与教学任务相关的可操作对象。

---

# 9. 3D公共空间场景工作室专项核验

> 这一模块可能在本地代码中，远端 `2026-0911` 不一定完整。

Codex 先输出：

1. 实际文件路径；
2. 当前 scene 数据结构；
3. 保存位置（localStorage / Supabase table / planning feature / 独立 scene document）；
4. 2D校核逻辑；
5. 对象模型库；
6. undo/restore/version能力；
7. 已有日志；
8. 当前自动化测试。

建议的研究可用最小能力：

- [ ] 场景可创建/保存/恢复。
- [ ] 能知道一个场景属于哪门课、村庄、小组、任务、空间。
- [ ] 每个可操作对象有稳定 ID。
- [ ] 对象类别明确（tree / bench / planter / building component...）。
- [ ] 关键操作在“完成操作”时记录一次。
- [ ] 保存时产生 `scene_revision_id` 或等价版本标识。
- [ ] 能导出某组某任务各个 revision 的 scene document。
- [ ] 2D/3D如共用场景文档，明确其单一事实来源。
- [ ] 不要求实现复杂评分系统。
- [ ] 不要求现在实现宏观“江南百景图”村庄营造。

---

# 10. 标准化课堂任务的数据支持

论文准备至少使用 2—3 个带有：
- 背景；
- 服务对象；
- 目标；
- 约束；
- 成果要求；
- 反思问题

的规划任务。

请核验现有 `courses.tasks` / task model 是否支持：

- [ ] `task_id`
- [ ] 标题
- [ ] 所属 stage
- [ ] instruction / description
- [ ] 推荐操作
- [ ] 是否有开始/完成状态
- [ ] 是否可配置成果要求
- [ ] 是否可关联特定 space / scene / object set
- [ ] 是否可以配置 task-specific metadata（建议JSON，不要频繁改schema）
- [ ] 是否能标记“这是研究课堂任务”而不改变普通平台功能

若现有任务结构足够，不要新建第二套“研究任务表”。

---

# 11. 证据关联：先核验，避免过度开发

论文希望观察“调研—判断—方案”是否发生联系，但不要求每个设计动作都强制写证据。

请核验当前是否已有：

- object photo
- object comment
- issue / community task
- survey note
- diagnosis note
- plan description
- object reference

然后判断是否可以用轻量方式支持：

```text
某诊断/方案说明
  references:
    - photo_id
    - issue_id
    - object_code
    - survey_note_id
```

原则：

- [ ] 如果已有通用 `references` / metadata，复用。
- [ ] 不要求每次移动建筑都填写理由。
- [ ] 允许学生完全不用该功能；研究上记录真实使用率即可。
- [ ] AI生成文本不得被标记为“真实村民意见”。

---

# 12. 会话、离线与数据完整性

现有 `activity-logger.js` 已有本地 pending → remote flush 逻辑，请核验：

- [ ] 页面刷新后 pending event 是否仍可同步。
- [ ] `client_event_id` 是否确保幂等。
- [ ] 同一事件多次 flush 不会重复。
- [ ] 断网恢复后是否自动/可手动补同步。
- [ ] 浏览器关闭前未同步事件的损失风险。
- [ ] 是否需要轻量 `session_id`。
- [ ] 系统时区是否统一。
- [ ] 管理员/教师测试行为是否会混入学生研究数据。
- [ ] 现有 `ADMIN_HISTORY_CLEANUP_MARKER` 等逻辑是否会影响正式课堂数据。

建议增加一个研究前自检：

```text
总本地事件数
已同步
pending
failed
缺 course/project/village/space 上下文
缺 student identity
未知 action
```

---

# 13. 错误与失败日志：只记录关键写操作

不建议做通用前端遥测平台。

仅核验关键课堂数据操作是否可判断成功/失败：

- 保存共享现状
- 冻结版本
- 建立 group plan
- 更新 baseline
- 解决冲突
- 保存 2D 方案
- 保存 3D scene
- 创建 snapshot
- 上传照片
- 成果提交

若现有业务表/HTTP返回已经能判断，activity event 只需简要记录：

```json
{
  "result": "failed",
  "error_code": "SCENE_SAVE_FAILED"
}
```

不要写：
- access token
- Supabase key
- 完整 SQL
- 真实敏感个人信息
- 大段 stack trace

---

# 14. 研究数据导出：P0 功能

请先检查管理员端是否已有 activity 查询/导出。

目标不是做漂亮 dashboard，而是能稳定导出。

## 14.1 最低导出包

建议一键导出为 ZIP 或一组 CSV/JSON：

```text
research_export/
  manifest.json
  participants.csv
  groups.csv
  tasks.csv
  activity_events.csv
  task_progress.csv
  survey_reviews.csv
  feature_change_batches.csv
  feature_versions.csv
  snapshots.csv
  group_baseline_updates.csv
  group_conflicts.csv
  scene_revisions.jsonl      # 如果有3D场景
  final_submissions.csv      # 如果有成果提交
```

### 导出要求

- [ ] 默认匿名化学生：`S01`、`S02`……
- [ ] 默认匿名化小组：`G01`、`G02`……
- [ ] 不导出密码、邮箱、auth token。
- [ ] 学号/姓名只在管理员明确选择“业务备份模式”时出现，研究导出默认不出现。
- [ ] 所有表有统一时区。
- [ ] manifest 写明：
  - 导出时间
  - course/project/village
  - app version / git commit（如可得）
  - schema version
  - 数据表行数
  - 是否存在 pending/failed events

---

# 15. 研究匿名化与隐私

请检查现有数据中：

- `student_name`
- `student_id`
- `display_name`
- `auth.uid()`
- 评论文本
- 照片

研究导出策略：

1. 业务数据库保留正常身份逻辑；
2. 导出时生成稳定 pseudonym；
3. 姓名、学号不进入分析文件；
4. `auth.uid()` 如无必要也映射为匿名ID；
5. 评论/访谈文本另行人工脱敏；
6. 照片涉及村民时不要自动打包到研究导出，除非课程与伦理流程允许。

---

# 16. “规划任务投入”指标所需数据核验

不要计算一个粗暴总分。请判断平台能否支持以下多维描述。

## 16.1 持续性

需要：
- timestamp
- session/day
- task/stage

可计算：
- 活跃天数
- 跨阶段回访
- 首次/最后活动时间

## 16.2 操作深度

需要：
- view only / survey / edit / snapshot / scene 等 action 类型

只描述行为层级，不把“操作多”直接解释成“学得好”。

## 16.3 迭代性

需要：
- V1/V2/Vfinal
- feature revisions
- scene revisions
- snapshot diff

## 16.4 跨表征使用

需要：
- 2D/3D enter events
- 同一 task/space 内的后续修改

不要把“切换次数越多”作为正向得分。

## 16.5 证据关联

需要：
- photo / issue / survey / object reference
- diagnosis / plan explanation

## 16.6 协作参与

需要：
- 稳定匿名 member ID
- group ID
- 写操作归属

可看：
- 是否一人包办
- 是否多成员分别贡献
- 不做简单成员排名

---

# 17. 设计假设所需数据映射

请用现有平台能力判断下面假设是否“可验证”。

| 设计假设 | 最低证据 |
|---|---|
| H1 共享现状校核与冻结为小组提供共同起点 | V0 + group baseline + 学生/小组访谈 |
| H2 2D/3D共享上下文支持跨表征判断 | view switch + 同任务修改 + 访谈 |
| H3 情境化场景任务促使学生进行空间迭代与解释 | scene revision + V1/V2 + 成果说明/访谈 |
| H4 日志与版本能呈现最终图纸看不到的方案形成过程 | event timeline + revisions + final output |

Codex输出：
- 已可验证
- 部分可验证
- 缺关键字段
- 缺关键持久化
- 缺课堂任务设计（不是技术问题）

---

# 18. 正式课堂前的全链路模拟验收

必须建立至少：

- 1 个教师/管理员账号
- 3 个模拟学生账号
- 2 个小组
- 1 个正式村庄
- 1 个 formal_shared
- 2 个 group plan

模拟完整流程：

1. 学生登录；
2. 进入课程任务；
3. 进入个人图底；
4. 共享现状校核；
5. 两人并发编辑不同对象；
6. 两人尝试编辑同一对象，确认锁/冲突逻辑；
7. 冻结 V0；
8. 建立两个 group plan；
9. 2D编辑；
10. 2D→3D；
11. 3D场景设计（本地模块稳定后）；
12. 保存 V1；
13. baseline 更新/冲突；
14. 保存 V2；
15. 恢复一次；
16. 保存 Vfinal；
17. 导出研究数据；
18. 用导出结果重建完整时间线。

### 验收目标

- [ ] 无关键数据丢失。
- [ ] 所有事件上下文完整。
- [ ] 不会因管理员测试污染学生数据。
- [ ] 研究导出可以直接用 Python/R 读取。
- [ ] V0/V1/V2/Vfinal 可被唯一识别。
- [ ] 场景 revision 与小组/任务关联清楚。

---

# 19. 自动化测试建议：先找现有测试，再补缺口

现有仓库已经有大量测试。请不要另起一套测试框架。

优先检查：

- `features/course/*.test.js`
- `features/survey/*.test.js`
- `features/3d/*.test.js`
- map editing / integration tests
- server tests

研究相关建议补充：

- [ ] activity event 必要上下文缺失时的处理。
- [ ] 幂等 flush。
- [ ] 2D/3D 切换事件只记录一次。
- [ ] group plan milestone tag。
- [ ] scene 操作不高频刷日志。
- [ ] research export 匿名化。
- [ ] export manifest 行数与表内容一致。
- [ ] pending/failed events 会在导出前被标记。
- [ ] 正式课堂“教师/管理员/学生”身份不会互相串数据。

---

# 20. Codex 第一轮只需要提交的成果

**第一轮请不要直接改代码。**

请输出以下 6 个文件/报告（可放 `docs/research-audit/`）：

1. `01-current-schema-map.md`  
   当前数据库表、关键字段、RLS/RPC、研究用途映射。

2. `02-event-inventory.md`  
   所有现有 action / logger 调用 / 触发位置清单，及研究语义映射。

3. `03-versioning-audit.md`  
   V0/共享冻结/group plan/snapshot/conflict/restore 的现状与缺口。

4. `04-3d-scene-audit.md`  
   **以本地工作区为准**核验3D场景工作室的数据结构、保存、日志与版本。

5. `05-research-data-gap-matrix.md`  
   按“已有完整/部分/等价/缺失”列出差距，不写空泛建议。

6. `06-minimal-change-plan.md`  
   只列最小改动：
   - 改什么；
   - 为什么；
   - 涉及文件/表；
   - 兼容风险；
   - 需要新增测试；
   - 是否P0/P1/P2。

---

# 21. 不要做的事情

- 不要看到 `session_id` 就立刻 ALTER TABLE；先判断现有数据能否推断。
- 不要重复建立第二套 `activity_events`。
- 不要重复建立第二套 snapshot/version 系统。
- 不要为了论文把每个按钮都埋点。
- 不要记录每次地图拖动、缩放、Cesium相机帧。
- 不要把点击次数变成“学习效果分数”。
- 不要实现排行榜、积分等与当前论文无关的游戏化功能。
- 不要在本轮优先开发“江南百景图式”宏观村庄模拟。
- 不要把AI生成意见写成真实村民意见。
- 不要重构根入口、认证、权限体系，除非审计发现真实阻塞问题。
- 不要在未确认远端数据库状态前仅根据 SQL 文件判断“功能已部署”。

---

# 22. 最终判定标准

当且仅当以下条件成立，平台才算“论文课堂研究基本可用”：

- [ ] 正式项目全链路可跑通；
- [ ] 核心行为日志完整且低噪声；
- [ ] 共享现状 V0 可冻结；
- [ ] 小组方案可形成至少 V1/V2/Vfinal；
- [ ] 2D/3D关键使用可以被重建；
- [ ] 若3D场景工作室用于课堂，其 scene revision 可保存与导出；
- [ ] 关键空间修改有版本/事实表可追踪；
- [ ] 日志、版本、成果能按匿名学生/小组/任务/时间关联；
- [ ] 研究导出一键完成且默认去标识化；
- [ ] pending/failed/缺上下文数据可在开课前被发现；
- [ ] 3个模拟学生的完整演练通过；
- [ ] 所有新增改动有回归测试；
- [ ] 不影响现有正常教学操作。

---

## 给 Codex 的一句话任务定义

> **不要按这份清单另造一个“研究系统”。请把它当成研究语义规范，对现有 `2026-0911` 分支和本地最新3D代码逐项审计：优先找到已经存在的表、字段、事件、版本和导出能力，建立映射并相互验证；只对真正阻碍课堂研究的数据缺口提出最小修改方案，第一轮先报告、不改代码。**
