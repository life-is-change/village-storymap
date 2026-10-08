# 3D 公共空间场景工作室专项审计

审计日期：2026-09-20  
判定基线：**以本地工作区为准**。远端 `origin/2026-0911` 不包含当前完整 scene studio。

## 1. 模块位置与本地差异

主目录为 `3D_scenes_edit/`，覆盖 domain、2D adapter、Cesium 3D interaction、persistence、assets、UI、integration、acceptance 与 legacy provenance。根入口通过 `index.html` 加载这些脚本，平台由 `app.js` 打开工作区。

相对远端基线，本地 HEAD 增加 scene studio 与两份 SQL，整体差异约 114 个文件、17k 行新增。当前工作树还包含未提交的交互、图层、素材和 10 个新增 GLB 调整；本报告只读取这些状态，没有覆盖它们。

## 2. Scene document

`3D_scenes_edit/domain/scene-document.js` 定义单一文档：

```text
schemaVersion
projectId / villageId / groupId
baselineRef { spaceId, revision }
revision
selectionBoundary
layers[]
objects[]
groups[]
assetRefs[]
metadata { scopeKind, ownerId, ... }
```

对象包含稳定 `id`、`kind`（surface/line/asset/structure）、category、geometry、transform、props、layer/group 引用。2D 和 3D adapter 都消费同一文档，因此 scene 内部具备单一事实来源。

判定：**已完整实现**。缺口是 document 没有直接 `course_id`/`task_id`；course 可通过 teaching project join，task 需要补充上下文。

## 3. 保存与持久化

### 本地

- `persistence/local-draft-store.js`：以 teaching project、village、space、group/scope 组成草稿键。
- `persistence/autosave-controller.js`：自动保存、dirty 管理与冲突回调。
- localStorage 草稿可在服务不可用时保留编辑状态。

### Supabase

- `scene_edit_projects` 保存项目头、boundary、baseline revision、document 子结构、revision 与 scope。
- `scene_edit_objects` 保存当前对象事实。
- `scene_edit_versions` 保存不可变完整 document、label、description、submission status。
- `scene_edit_save_draft()` 使用 expected revision 防止静默覆盖。
- `scene_edit_restore_version()` 从旧 version 创建新 project，而不是回写历史。

证据：`supabase_SQL/Scene Edit Studio.sql:5-112`、`:360-518`；管理员 sandbox 兼容见 `supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql:4-19`。

判定：**场景可创建、保存、恢复和版本化；仓库层面完整，线上部署待核验。**

## 4. 2D / 3D 工作方式

- scene 的主要编辑入口是 3D Cesium 交互，地面拾取、放置、移动、边界调整由 `interaction_3d/` 实现。
- `map_2d/scene-layer-adapter.js` 将 scene 对象投影到 2D 校核；2D 不是另存一份 scene 数据。
- `preview_3d/scene-preview-adapter.js` 和 `scene-to-cesium.js` 从同一对象模型渲染 3D。
- 这符合“3D 放组件，2D 显示同步俯视结果”的当前设计。

判定：**同源已实现**。但必须区分：平台 planning features 与 scene objects 是两类事实；scene 同源只指 scene 的 2D/3D 表示，不代表自动写回所有规划图层。

## 5. 边界、组件和素材库

- `selectionBoundary` 是项目边界，3D 绘制和调整后写回 document。
- `assets/scene-asset-library.js` 与 `assets/seed/catalog.json` 定义预设素材。
- 本地当前可见 20 个 GLB，包括 bench、table、tree、lamp、pavilion、bin、fitness、play 以及未提交的 round-table、stone-bench、canopy、footbridge 等。
- 上传 GLB 与数据库 asset/component 注册 RPC 已存在。
- legacy 目录保存删除前建筑构建器及“聪0526”来源，`provenance.json` 记录借鉴来源，避免覆盖当前实现。

判定：**对象类别与稳定 ID 已实现，素材库已从占位体扩展为简化模型；视觉质量仍属于教学原型级，不应在研究报告中描述为专业模型库。**

## 6. Undo、恢复与版本

| 能力 | 当前实现 | 判定 |
|---|---|---|
| 命令级撤销/重做 | `domain/scene-commands.js` 与控制器状态 | 已实现。 |
| 自动草稿 | autosave controller + local store/remote client | 已实现。 |
| 乐观并发 | expected revision | 已实现。 |
| 里程碑版本 | `scene_edit_create_version()` | 已实现。 |
| 提交版本 | `scene_edit_submit_version()` | 已实现。 |
| 恢复版本 | 从历史 document 新建 project | 已实现。 |
| 导出各 revision | 无管理员研究导出 | 确实缺失。 |

## 7. 研究事件

在 `3D_scenes_edit/` 和 scene SQL 中未找到 ActivityLogger 或 `activity_events` 写入。因此：

- scene 项目、草稿、对象和版本**事实可保存**；
- 但无法仅靠 activity timeline 判断 open/add/move/rotate/delete/save/restore；
- 高频拖拽不应每帧写库；适合在 pointer-up/命令 commit 时记录一次。

最小事件：`scene_opened`、`scene_operation_committed`、`scene_saved`、`scene_version_created`、`scene_restored`。metadata 只保存 operation、object id/category、project/version/revision id、result/error code，不复制 document 或模型。

## 8. 自动化测试

仓库共约 130 个 JS test 文件，其中 scene studio 约 25 个，覆盖：

- document schema/commands/geometry rules；
- local draft/autosave/remote client/schema；
- 2D layer adapter 与 OpenLayers interaction；
- Cesium ground picker、3D interaction、transform/preview；
- platform bridge、entrypoint、focus mode；
- acceptance workflow 与 performance budget；
- asset library、panel、toolbar、startup。

这说明模块不是纯 UI 草图，但自动化测试不能替代三账号、真实 Cesium terrain、远端 RLS/RPC 的浏览器验收。

## 9. 研究可用性逐项判定

| 条件 | 判定 | 说明 |
|---|---|---|
| 场景可创建/保存/恢复 | 已完整实现（仓库层面） | 线上需执行迁移并演练。 |
| 可关联课程/村庄/小组/空间 | 已部分实现 | course 间接 join，task 缺失。 |
| 对象稳定 ID/类别 | 已完整实现 | document/object table 均支持。 |
| 关键操作低频日志 | 确实缺失 | 仅有事实和版本。 |
| scene revision 标识 | 已完整实现 | project revision + version id。 |
| revision 可研究导出 | 确实缺失 | 没有匿名多表导出。 |
| 2D/3D 单一 scene source | 已完整实现 | 不等于 planning features 同表。 |
| 与 V1/V2/Vfinal 关联 | 已部分实现 | scene label/status 有，跨 2D milestone link 缺。 |

## 10. 风险与边界

1. 当前未提交 GLB/交互修改不能被远端部署复现，开课前需形成明确发布版本。
2. scene SQL 是否在线执行、RLS 是否符合管理员无组/学生组内访问，必须查询真实数据库。
3. task id 缺失会削弱“场景任务促成迭代”的分析。
4. 自动保存成功不等于研究事件已同步；二者要分别报告。
5. scene objects 不应被误称为基础 planning features；只有显式同步规则才能写回。

## 11. 最小完善顺序

1. P0：远端 schema/RPC/RLS 自检，确认项目可保存和恢复。
2. P0：scene project/version 带 task context（优先 metadata），并加入低频 committed/save/version/restore 事件。
3. P0：研究导出加入 scene versions JSONL 与 project/version 关联。
4. P0：将 scene version 与 V1/V2/Vfinal milestone 建立引用。
5. P1：关键保存失败记录稳定 error code；离线 pending 进入完整性报告。
6. P2：继续丰富美术素材；这不是论文研究可用性的阻塞项。
