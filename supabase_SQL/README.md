# Supabase SQL 清单

这里保存的是数据库结构变更、修复脚本和运维查询的源码。Supabase SQL Editor 中的“已保存查询”只是这些 SQL 的编辑器副本；删除编辑器副本不会撤销已经执行的数据库变更。

## 当前多村庄主线（按顺序）

1. `Multi-Village Dual-Track Foundation.sql`：建立村庄、教学项目、数据集和双轨空间基础结构。
2. `Multi-Village Dual-Track Repair.sql`：初始化米埗村、迁移旧上下文、重建 RPC/RLS/索引/触发器。
3. `Multi-Village Dual-Track Repair Follow-up.sql`：修补迁移后的兼容性和访问边界。
4. `Village Dataset Package Storage.sql`：建立私有 V0 数据包存储桶及访问策略。
5. `Teaching Project Practice Catalog and Village Lifecycle.sql`：一个教学项目对应一个学期，开放全部练习村庄目录，并提供村庄归档/删除生命周期。

以上脚本应按迁移历史保留，不要因为“已经执行”就删除。

## 当前功能迁移

- `Geoprocessing Worker Queue.sql`：地理处理任务队列。
- `Group Model Library.sql`：小组 3D 模型资源库。
- `Enable Personal Contour Delete.sql`：个人空间等高线删除权限。
- `Secure Planning Space Visibility.sql`：空间可见性收紧。
- `Personal Figure Ground Spaces and Layer Versions.sql`：个人图底关系和图层版本。
- `Task-driven Course Workbench Schema.sql`：课程任务工作台。
- `Object Photos.sql`、`Object Photos Indexes.sql`、`Row-Level Policies for object_photos.sql`：当前仍在使用的对象照片链路。

## 运维/诊断脚本

- `Normalize Legacy Village Dataset Layer Types.sql`：把历史数据集清单中的 `buildings/roads` 一次性规范为 `building/road`；已规范的记录不会重复改动。
- SQL Editor 中的队列暂停、恢复、心跳和计数查询属于运维片段，不是迁移；名称应以 `OPS -` 或 `DIAG -` 开头。
- 带 `ROLLBACK` 的模型注册查询只用于手工测试，不应作为生产迁移执行。

## 已被主线整合或仅供历史参考

较早的账号、会话、规划空间、公共访问、对象协作等脚本可能已被后续主线迁移扩展。保留它们用于追溯，但新环境部署前必须先核对依赖，不能不分顺序地全量重放。

`Remove photo tables and associated RLS policies.sql` 是破坏性历史脚本，与当前仍在使用的 `object_photos` 功能冲突。不得执行；建议在 SQL Editor 中删除其保存副本，仓库源码暂留作历史审计。

## SQL Editor 命名规则

- `MIGRATION - 功能名`：幂等结构迁移。
- `REPAIR - 功能名`：一次性数据修复，执行前需要备份和明确批准。
- `OPS - 操作名`：可重复的运维动作。
- `DIAG - 检查名`：只读诊断。
- `TEST - 用途 (ROLLBACK)`：事务回滚测试。

禁止继续保存 `Untitled query`；同一迁移只保留一个编辑器副本，权威版本始终以仓库文件为准。
## 阶段 2 增量迁移

- `Shared Survey Calibration and Freeze.sql`：正式共享现状空间的对象校核、后续操作门禁、历史恢复与冻结底图。应在 `Multi-Village Dual-Track Repair.sql` 之后执行。
- `Shared Survey Calibration Security Followup.sql`：撤销阶段 2 内部触发器函数的直接 RPC 执行权限。应紧接阶段 2 主迁移执行。
