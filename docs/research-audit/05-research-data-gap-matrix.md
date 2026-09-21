# 研究数据差距矩阵

审计日期：2026-09-20  
状态词严格采用：已完整实现、已部分实现、已有等价字段/功能但命名不同、仅前端存在未持久化、仅数据库存在前端未调用、存在但日志/版本无法用于研究、确实缺失。

## 1. 基线与环境

| 核验项 | 状态 | 证据/解释 | 阻塞级别 |
|---|---|---|---|
| 根 `index.html` 为整合入口 | 已完整实现 | 课程、2D/3D、scene scripts 均由根入口整合。 | 无 |
| 远端基线与本地差异 | 已完整实现（已盘点） | 本地 HEAD 比 `origin/2026-0911` 多 scene studio 等约 114 文件；另有未提交 scene 调整。 | P0 发布管理 |
| 远端 Supabase 与最新 SQL 一致 | 确实缺失（证据） | 本轮未连接远端，迭代日志不是 schema 查询结果。 | P0 |
| 正式 project/village/formal_shared/group plan 真实数据 | 确实缺失（证据） | 仓库无法证明线上实例存在。 | P0 |

## 2. 身份与上下文

| 语义 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 权威用户身份 | 已有等价字段/功能但命名不同 | `auth.uid()/profiles.id` 是权威；不要新造 ID。 | 无 |
| 业务 student key | 已部分实现 | 可用但由 student_id + display_name 组成，不够永久稳定。 | P1 |
| 研究匿名 ID | 确实缺失 | 应在导出阶段生成 S01，不写回业务表。 | P0 |
| 角色 | 已完整实现 | profiles.role 有 student/teacher/admin。 | 线上 RLS 验证 P0 |
| course/project/village/space | 已部分实现 | activity 后迁移均可有；线上列和非空率未知。 | P0 |
| group null 语义 | 已完整实现 | 个人空间/管理员 sandbox 合法为空。 | 无 |
| task context | 已部分实现 | 课程事件有；scene 缺直接 task。 | P0 |
| view mode | 仅数据库存在前端未调用 | 列存在，生产切换未记录。 | P0 |
| 时间 | 已部分实现 | timestamptz 可用；客户端时钟与服务端时间混用。 | P1 |

## 3. 活动日志与完整性

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 本地 pending | 已完整实现 | localStorage 可跨刷新保留。 | 无 |
| 幂等 flush | 已完整实现 | client_event_id unique + upsert。 | 无 |
| 自动断网恢复 | 已部分实现 | 每次记录会 flush；未找到 online/visibility 自动补偿。 | P1 |
| 关闭前损失控制 | 确实缺失 | 无 beforeunload/visibility flush 证据。 | P1 |
| 队列状态自检 | 确实缺失 | 无 synced/pending/failed/context/unknown-action 汇总。 | P0 |
| session id | 确实缺失 | 无法稳定分析跨会话持续性；可先放 metadata。 | P1 |
| module/schema/app version | 确实缺失 | manifest 可覆盖 app/schema，事件需 source module。 | P0/P1 |
| 关键写操作失败 | 确实缺失 | 业务 UI 有错误，但无低噪声研究失败事件。 | P0 |
| 教师/管理员污染排除 | 已部分实现 | 本地按“管理员”姓名清理不可靠；应按 role/export batch。 | P0 |

## 4. 任务与课堂流程

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 7 阶段任务模型 | 已完整实现（前端） | task id/title/stage/outcomes/resources/actions 可用。 | 无 |
| DB JSONB tasks | 已完整实现 | 可加 metadata，无需新表。 | 无 |
| task opened/completed | 已完整实现 | activity + task_progress。 | 无 |
| task start/submit/reopen | 确实缺失 | 先定义语义，不把打开侧栏视为 start。 | P1/P0 final |
| 目标/约束/成果/反思结构 | 已部分实现 | outcomes/resources/actions 可承载部分，缺显式 constraints/reflection/research flag。 | P1 |
| task-specific space/scene | 已部分实现 | workspace context 有，scene task 关联不足。 | P0 |
| 最终成果提交 | 确实缺失 | 文案/scene submitted 不等于完整课程 submission。 | P0 |

## 5. 共享现状

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| geometry status 事实源 | 已完整实现（迁移层面） | 五种状态完整。 | 线上核验 P0 |
| reviewer/modifier/revision/batch | 已完整实现 | 可追踪谁、何时、如何改。 | 无 |
| 对象锁与 Realtime | 已部分实现 | SQL、前端、测试存在；真实并发/掉线演练未知。 | P0 |
| 完整冻结 V0 | 已完整实现（迁移层面） | snapshot items 是完整结果。 | 线上演练 P0 |
| 冻结后建 group plan | 已完整实现（迁移层面） | ensure RPC 已有。 | 线上演练 P0 |
| 属性/照片/问题依赖门禁 | 已部分实现 | SQL/测试有下游 gate；真实 UI 路径需浏览器验证。 | P1 |

## 6. Group plan 与版本

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 每组唯一正式空间 | 已完整实现（迁移层面） | 唯一约束/ensure。 | 线上核验 P0 |
| added/updated/deleted | 已完整实现 | sparse override 语义明确。 | 无 |
| baseline update/preview | 已完整实现 | RPC 和 UI client/panel 均有。 | 无 |
| conflict detect/resolve | 已完整实现 | 事实表和 RPC 可追踪。 | 无 |
| restore point | 已完整实现 | 事故恢复可用。 | 无 |
| V1/V2/Vfinal 唯一标识 | 确实缺失 | 现有 snapshot 可承载，缺轻量 tag。 | P0 |
| final submission | 确实缺失 | 需引用既有版本而非复制数据。 | P0 |

## 7. 2D / 3D 跨表征

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 切换保持 space | 已完整实现 | view switcher 保持上下文。 | 无 |
| 保持选中对象 | 已部分实现 | 通过 source/object code 同步，仍需浏览器演练。 | P1 |
| 相同 object code | 已部分实现 | planning 2D/3D 可对应；scene object 是独立 ID。 | P1 文档化 |
| 切换事件 | 确实缺失 | 只有 logger 单测，没有生产调用。 | P0 |
| 3D 加载失败可识别 | 存在但日志无法用于研究 | UI 可报错，timeline 不知道失败。 | P0 |
| 不采集相机帧 | 已完整实现 | 当前没有高频 telemetry。 | 无 |

## 8. 3D Scene studio

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| 创建/草稿/恢复 | 已完整实现（本地/迁移） | local + Supabase + version restore。 | 线上核验 P0 |
| project/village/group/space | 已完整实现 | scope 关系明确。 | 无 |
| course/task | 已部分实现 | course 可 join，task 缺。 | P0 |
| stable object id/category | 已完整实现 | 单一 document。 | 无 |
| 2D/3D scene 同源 | 已完整实现 | 两个 adapter 共享 document。 | 无 |
| scene action 日志 | 确实缺失 | 无 ActivityLogger 集成。 | P0 |
| scene revisions | 已完整实现 | immutable versions。 | 无 |
| scene revision export | 确实缺失 | 管理端未导出。 | P0 |
| 预设模型库 | 已部分实现 | 20 个本地简化 GLB，当前部分未提交。 | P2 |

## 9. 证据关联与隐私

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| photo/comment/issue/diagnosis | 已完整实现 | 可关联 object/context。 | 无 |
| evidence link 到方案说明 | 确实缺失 | 只有 object code 弱关联。 | P1 |
| 默认匿名导出 | 确实缺失 | 现有 CSV 导出 studentName。 | P0 |
| 评论文本脱敏 | 确实缺失（流程） | 应另行人工/伦理处理。 | P0 流程 |
| 照片默认排除 | 确实缺失（导出规则） | 研究包不应自动含照片。 | P0 |

## 10. 研究导出

| 能力 | 状态 | 结论 | 阻塞级别 |
|---|---|---|---|
| activity CSV | 已部分实现 | 管理端可导出，但实名且单表。 | P0 |
| participants/groups/tasks/progress | 确实缺失 | 未组成研究包。 | P0 |
| survey/version/snapshot/baseline/conflict | 确实缺失 | 事实存在但无统一导出。 | P0 |
| scene revisions JSONL | 确实缺失 | scene 数据存在。 | P0 |
| manifest | 确实缺失 | 缺 app/schema/version/row count/integrity。 | P0 |
| pending/failed/context summary | 确实缺失 | 无开课前自检。 | P0 |

## 11. 四个设计假设

| 假设 | 判定 | 缺口 |
|---|---|---|
| H1 共享校核与冻结提供共同起点 | 部分可验证 | 仓库能力足够；缺真实 V0/group 演练与访谈。 |
| H2 2D/3D 共享上下文支持跨表征判断 | 部分可验证 | 上下文能力有；缺 view switch 生产事件与失败区分。 |
| H3 场景任务促成空间迭代与解释 | 缺关键日志/关联 | scene versions 有；缺 task、scene actions、里程碑与解释关联。 |
| H4 日志与版本呈现方案形成过程 | 部分可验证 | 事实链较强；缺 milestone/final/export/integrity check。 |

## 12. 当前总体判定

平台已经具备论文课堂研究所需的大部分业务事实与版本基础，但**尚不能判定为“研究基本可用”**。阻塞项集中在：

1. 远端 schema/RLS/Realtime/正式数据未实证；
2. 2D/3D 与 scene 关键事件不完整；
3. V1/V2/Vfinal/final submission 未唯一标识；
4. 匿名多表导出与完整性自检缺失；
5. 三学生两组全链路演练尚未完成。

这些是边界清楚的最小缺口，不需要另造研究系统。
