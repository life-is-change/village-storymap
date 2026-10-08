# 研究可用性的最小改动计划

审计日期：2026-09-20  
本文件只列建议，不包含代码或数据库修改。实施前必须先完成远端核验并由用户确认。

## 1. 优先级定义

- P0：不开课就可能无法获得可分析、可关联、可复现的数据。
- P1：提高解释力与数据完整性，但可通过课堂流程或人工记录临时弥补。
- P2：体验、美术或长期维护，不阻塞论文课堂研究。

## 2. P0：先验证，不改 schema

### P0-1 远端研究准备自检

**改什么**：新增只读管理员自检/SQL 核验脚本，检查 columns、functions、RLS、Realtime publication、正式 project/village/formal_shared/group plans 和必要数据非空率。  
**为什么**：本地 SQL 不能证明线上已部署。  
**涉及**：`supabase_SQL/` 新增 DIAG 脚本；可选管理端只读面板。  
**兼容风险**：低，只读；避免输出敏感账号。  
**测试**：schema contract test；对缺列/缺函数/缺 publication 给稳定结果。  
**是否迁移旧数据**：否；只报告。  
**RLS/RPC/Realtime 影响**：只读核验，无变更。

### P0-2 研究事件上下文与完整性检查

**改什么**：为本地/远端活动生成汇总：synced、pending、failed、缺 course/project/village/space/student、未知 action、角色分布。  
**为什么**：开课前必须知道关键日志是否可用。  
**涉及**：`features/course/activity-logger.js`、管理员模块、事件字典配置。  
**兼容风险**：低；不改变旧 action。  
**测试**：幂等 flush、刷新后恢复、合法 group null、缺上下文分类、管理员排除。  
**schema**：优先不改；从现有字段和 local status 汇总。

### P0-3 补齐低频跨表征事件

**改什么**：成功完成 2D↔3D 后记录一次 `view_switched`，带 from/to、space/task/group；加载失败保留原 action 或专用关键失败记录，metadata 写 `result/error_code`。  
**为什么**：H2 当前无法用生产数据验证。  
**涉及**：`features/ui/view-switcher.js`、`app.js`、ActivityLogger tests。  
**兼容风险**：中；需防初始化/刷新误记和双击重复。  
**测试**：每次成功切换一条、失败不记成功、相同模式不重复、无相机/鼠标日志。  
**schema**：无需改，复用 `view_mode` + metadata。

### P0-4 补齐 scene 研究上下文与低频事件

**改什么**：scene project/version metadata 带 `taskId/sourceModule/eventSchemaVersion`；在 open、命令 commit、save、create version、restore 后记录一次。  
**为什么**：scene 有事实和版本，但无法重建教学任务中的操作过程。  
**涉及**：`3D_scenes_edit/integration/platform-bridge.js`、`index.js`、scene commands/autosave client、`app.js` logger bridge；可能仅用 project/version metadata。  
**兼容风险**：中；必须避免 pointermove 高频写入、离线重复和失败误报。  
**测试**：拖动一手势只一条 commit；保存失败 error code；版本/恢复 id；管理员 sandbox group null。  
**schema**：先用现有 JSON metadata；除非远端查询证明查询性能不足，不新增列。

### P0-5 里程碑与最终提交

**改什么**：在现有 snapshot/version 上增加轻量 `V1/V2/VFINAL` tag，并建立最小 final submission 记录，引用 2D snapshot 与可选 scene version。  
**为什么**：当前版本丰富但研究阶段不可唯一识别。  
**涉及**：`feature_snapshots` 现有 metadata/最小列、scene version、课程任务 UI；若需新表，仅建引用表而不复制文档。  
**兼容风险**：中；需保证旧 snapshot 无 tag 仍可读。  
**旧数据迁移**：默认 null；人工标记课堂版本，不自动猜测。  
**RLS/RPC**：里程碑创建仅组员/教师，final submit 需权限与不可变规则。  
**测试**：每组每阶段唯一性、旧记录兼容、权限、恢复后来源链、Vfinal 引用完整。

### P0-6 匿名研究导出包

**改什么**：管理员一键导出 ZIP/目录，至少含 manifest、participants、groups、tasks、activity、progress、survey reviews、feature batches/versions/snapshots、baseline updates/conflicts、scene revisions、submissions。  
**为什么**：现有实名 activity CSV 无法直接用于论文分析。  
**涉及**：`features/admin/course-admin.js`、新 research export module、必要只读 RPC/Edge Function（数据量大时）。  
**兼容风险**：高于其他项；跨表、权限、内存和隐私必须处理。  
**匿名策略**：稳定映射 `S01/G01`；默认排除 name/student_id/email/auth uid/photos；评论文本单独标记人工脱敏。  
**manifest**：UTC 导出时间、course/project/village、git/app/schema 版本、每表行数、pending/failed/缺上下文、筛选范围。  
**测试**：稳定匿名映射、真实身份不泄漏、row count 一致、JSONL 可解析、照片不打包、pending/failed 标记。

## 3. P1：提高解释力与恢复性

### P1-1 轻量 session

先在事件 metadata 写浏览器会话 UUID（新页面会话新 ID），不要立即 ALTER TABLE。验证研究查询和索引需求后再决定是否物化列。测试跨刷新/新标签页语义并明确限制。

### P1-2 自动补同步

在 `online`、页面重新可见、用户主动导出/退出前触发 best-effort flush；不要声称 beforeunload 网络请求一定成功。增加队列上限和同步错误分类，保留未同步事件供导出自检。

### P1-3 可选 evidence references

在诊断/方案说明现有 metadata 增加可选 references（photo/issue/object/survey note id），不强制每次编辑填写，不把 AI 文本标为村民意见。

### P1-4 统一任务结构

扩展现有 tasks JSON：constraints、deliverables、reflectionQuestions、workspace/scene context、`researchTask` flag。保持旧 tasks 兼容，不建第二套任务表。

### P1-5 失败事件

只对保存共享现状、冻结、建 group plan、baseline 更新、冲突决议、2D/scene 保存、snapshot、照片、final submit 记录 `result/error_code`。不存 token、SQL、stack trace 或敏感输入。

## 4. P2：非阻塞项

- 继续改善 scene 模型质量和素材数量；不作为研究数据链阻塞。
- 优化研究 dashboard 可视化；先保证导出正确。
- 长期把 student_key 关联迁移到 immutable profile UUID；需独立迁移设计，不能在临近课堂时冒险替换。
- 如课堂持续多次部署，再把 app commit 从 manifest 下沉到每事件；否则 manifest 足够。

## 5. 建议实施批次

### 批次 A：不变更业务数据

1. 远端只读自检。
2. 固化 event dictionary 与 research export contract。
3. 建三学生/两组演练数据方案。

### 批次 B：最小前端日志

1. view switch。
2. scene committed/save/version/restore。
3. critical failure metadata。
4. logger 完整性汇总与补同步。

### 批次 C：版本与提交

1. milestone tag。
2. final submission 引用。
3. scene↔2D milestone link。

### 批次 D：匿名导出与验收

1. 多表导出。
2. manifest/匿名化/完整性报告。
3. 三学生两组全链路模拟。
4. 从导出重建 timeline，与 UI 最终状态抽样比对。

## 6. 全链路验收门槛

以下全部通过后，才可称“论文课堂研究基本可用”：

1. 1 管理员 + 3 学生 + 2 小组，正式村庄/formal_shared/2 group plans 均真实存在。
2. 双人编辑不同对象和同一对象的锁/冲突行为符合预期。
3. V0、V1、V2、Vfinal 均有唯一 ID，恢复不覆盖历史。
4. 2D/3D 切换、scene revision 与后续方案修改可按 task/space/time 串联。
5. 导出默认匿名，Python/R 可读取，无姓名、学号、邮箱、token、照片泄漏。
6. pending/failed/缺上下文/未知 action 在 manifest 中显式报告。
7. 管理员/教师演练可从研究样本排除。
8. 自动化测试通过，且完成真实浏览器、真实 Supabase 的人工验收。

## 7. 实施前必须由用户确认的决策

1. V1/V2/Vfinal 是写入 `feature_snapshots.metadata`，还是新增最小可索引列。
2. final submission 是只引用一个 2D snapshot，还是允许同时引用 scene version。
3. scene task context 放 project metadata 还是新增显式列。
4. 研究导出是否在浏览器生成，或为大数据量使用受控后端/Edge Function。
5. 评论文本和照片的伦理/脱敏范围。

在这些决策确认前，不应执行 schema 修改。
