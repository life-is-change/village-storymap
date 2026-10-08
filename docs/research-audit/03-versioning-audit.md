# 版本链、共享冻结与小组方案审计

审计日期：2026-09-20

## 1. 结论摘要

平台已经有三套**职责不同且应保留**的版本机制：

1. 共享现状：`feature_change_batches` + `feature_versions` + 完整 `feature_snapshots`。
2. 小组方案：冻结 snapshot 作为 baseline，`planning_features` 保存稀疏 override，另有 baseline update/conflict/restore point。
3. 3D 场景：project revision 保存草稿并做乐观锁，`scene_edit_versions` 保存不可变 scene document。

缺口不是“没有版本”，而是：缺 V1/V2/Vfinal 的统一里程碑标签、缺最终成果提交事实、缺 2D snapshot 与 scene version 的明确关联、缺研究导出。

## 2. 当前真实数据模型

```text
共享现状对象 + survey_feature_reviews
        │ 批量保存
        ▼
feature_change_batches ──< feature_versions
        │ 管理员冻结完整结果
        ▼
feature_snapshots(V0, published/recommended) ──< feature_snapshot_items
        │ ensure_group_planning_spaces
        ▼
每组唯一 group plan space
        │
        ├─ baseline snapshot + baseline objects
        └─ planning_features 稀疏 override
              ├─ added
              ├─ updated
              └─ deleted
        │ baseline 更新
        ├─ group_baseline_updates
        ├─ group_baseline_conflicts
        └─ group_plan_restore_points
```

3D scene 是同一教学项目/村庄/space 上的独立 scene document 版本链，不是 planning feature snapshot 的复制品。

## 3. 共享现状 V0

### 已实现

- `survey_feature_reviews.geometry_status` 支持 `pending / confirmed_unchanged / modified / deleted / added`，并保存首次校核、最后修改和 revision。
- 共享编辑批次和对象 before/after 版本可追踪。
- `freeze_shared_survey_snapshot()` 创建完整合并结果而非仅稀疏变更，写入冻结事件，并确保 group spaces。
- snapshot 具有 `version_number`、`is_published`、`recommended_for_groups` 等语义。

证据：`supabase_SQL/Shared Survey Calibration and Freeze.sql:6`、`:841-934`；版本表定义见 `supabase_SQL/Shared Current Survey Versioning and Feature Locks.sql:18-68`。

### 待真实环境核验

- 正式村庄 V0 是否已初始化。
- `formal_shared` 是否真实存在并关联正确 dataset。
- 多人同时编辑、对象锁、断线重连、锁过期是否通过真实浏览器联调。
- 当前 published/recommended snapshot 是否是课堂实际版本。

## 4. 小组方案与 baseline

### 已实现

- 每个教学项目/村庄/group 仅允许一个正式 group plan（SQL 唯一约束/ensure RPC）。
- 小组只保存相对 baseline 的稀疏 override：`operation_kind` 区分新增、修改、删除。
- `base_object_code`、`base_snapshot_id`、`feature_revision` 保留来源。
- baseline 更新可 preview，再原子 apply；冲突类型包括双方修改、基线删除、编码碰撞。
- 冲突决议支持保留小组版、采用新基线、人工合并。
- 更新前建立 restore point，教师/管理员可恢复。

证据：`supabase_SQL/Group Plan Baseline Update.sql:45-100`、`:783-1010`、`:1012` 及相应 migration tests。

### 研究上的含义

- `group_baseline_updates`、`group_baseline_conflicts`、`group_plan_restore_points` 本身就是最可靠的事实记录，无需再把完整状态复制到 activity_events。
- `group_plan_edited` 只给时间线提供“发生过保存”的摘要，详细差异应从版本/override 表重建。

### 缺口

- 普通关键保存并不会自然形成一份“完整 V1/V2/Vfinal snapshot”。当前状态可以重建，但课堂里程碑不可唯一识别。
- conflict resolve、restore 事实存在，却没有统一事件字典；研究导出必须包含这些事实表。
- 未找到正式 final submission 数据表或完整提交工作流。

## 5. V0 / V1 / V2 / Vfinal 映射

| 研究版本 | 当前承载 | 当前判定 | 最小完善 |
|---|---|---|---|
| V0 | published + recommended `feature_snapshot` | 已完整实现（迁移层面） | 在线确认当前正式 snapshot。 |
| V1 | 可人为创建/命名 snapshot，但缺标准 tag | 已部分实现 | 给现有 snapshot 增加轻量 milestone metadata/tag，或复用现有 metadata，不建新版本表。 |
| V2 | 同 V1；scene 有独立 version | 已部分实现 | milestone 创建时允许关联 scene version id。 |
| Vfinal | scene version 可 submitted；2D 最终提交缺统一事实 | 确实缺失 | 建最小 submission 记录，引用现有 snapshot/scene version，而非复制文档。 |

推荐里程碑语义：`milestone_type`（V1/V2/VFINAL）、`task_id/stage_key`、`note`、可选 `scene_version_id`。优先放入现有 snapshot metadata 或最小新增列；必须先查询远端真实字段后决定。

## 6. 2D 与 scene 版本关系

- 2D 方案对象与 scene object 并非同一存储表。
- scene document 内有 `baselineRef.spaceId/revision`，能说明它基于哪个空间/修订打开。
- 2D 与 3D scene 的交互预览共用 scene document，但不意味着每个 scene object 都自动变成 planning feature。
- 目前缺“某个 2D milestone 对应哪个 scene version”的显式关系。

因此不应宣称“2D 和 scene 已形成统一版本”；准确说法是“共享上下文、各自版本，尚缺里程碑级交叉引用”。

## 7. 恢复能力

| 场景 | 当前机制 | 判定 |
|---|---|---|
| 共享对象误改 | feature version / restore RPC | 已实现。 |
| group baseline 更新前恢复 | `group_plan_restore_points` | 已实现。 |
| group conflict 决议 | conflict resolution RPC | 已实现。 |
| scene 草稿冲突 | revision 乐观锁 | 已实现。 |
| scene 历史恢复 | 从 immutable version 创建新 project | 已实现，避免覆盖历史。 |

## 8. 当前可支持的研究分析

- H1（V0 作为共同起点）：**技术上可验证，真实数据待演练**。
- 方案对象的新增/修改/删除：**可验证**。
- baseline 更新与冲突：**可验证**。
- V1→V2→Vfinal 的阶段演化：**部分可验证**，缺 milestone tag/final submission。
- scene 迭代：**可保存但研究导出缺失**。
- 2D/3D 版本间对应关系：**缺关键关联**。

## 9. 不建议的改法

- 不新建第二套 `research_snapshots`。
- 不为每次拖动创建完整 snapshot。
- 不用 activity log 代替 feature/scene 事实表。
- 不覆盖恢复旧版本；恢复应产生新 revision/project，保留来源链。

## 10. 开课前验收

1. 冻结一次正式 V0，并核对 snapshot item 数量与有效对象总数。
2. 两组各创建唯一 group plan，验证 baseline snapshot id。
3. 做一次双方同时修改导致的 conflict，完成决议并导出事实行。
4. 创建 V1、V2、Vfinal 标记，保证主键唯一可引用。
5. 恢复一次 group plan 和一次 scene version，确认历史未被覆盖。
6. 用导出结果从 V0 重建至 final，并与界面最终结果抽样比对。
