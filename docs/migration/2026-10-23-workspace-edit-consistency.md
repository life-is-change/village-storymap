# 工作区权限、空间列表和编辑草稿一致性

真实证据：非管理员共享空间planning读取403；personal.ensure503的PG分类是PERSONAL_SPACE_CONTEXT_MISMATCH/ensure_course_personal_space/planning_write；管理员空间有体验/图底/共享三类但事件刷新后图底消失；数字静态建筑编号196个均为int，与API字符串契约冲突；普通个人绘制不取锁，却把lockToken:null传入不接受空UUID的saveBatch。事件onInvalidate在草稿检查前syncSpaces，重建空间列表并插入虚假BASE，且不检查正在绘制/异步分配编号或保存中。首次SSE refresh、自己锁记录事件也被称为其他成员修改。

要求：保持共享空间现有成员权限，不通过放宽ACL修复白屏；非成员只显示服务器授权的个人空间，入口不强选假BASE。刷新保留当前村庄/账号下已认证图底版本空间和选择；过期响应不切换当前工作区。API建筑编号统一字符串，非版本个人空间不发送无意义的空lockToken，真实共享/小组锁仍保留且服务端验证。事件刷新在所有状态变更前检查当前上下文、绘制、待新增/删除、修改和保存中；不覆盖草稿，不把缺少actor的信息说成其他人。失败保存保持草稿。

个人图底compat函数沿用旧单练习村/旧geoprocessing_villages绑定，与现有支持多练习村的目录不一致。仅校准5参数ensure_course_personal_space：当前项目/课程、未归档状态、发布村庄及practice/formal角色匹配，formal仍需项目开放且绑定一致；仅auth.uid所有者可ensure，项目冲突不重绑定，不改历史行或ACL。私有修复单事务精确比对旧compat函数体，新函数只供显式ensure创建自己的新行。原有3参数旧接口不修改。

新云端补丁从已应用account-entry覆盖层继续：所有历史manifest/树、冻结release/control、固定基准摘要必须通过；自身备份；只替换明确函数和网页文件；未知函数拒绝整笔事务，不reset业务行、不改4090。中断恢复及重复执行需隔离原生CI验证。实际用户浏览器仍待验收。

## 改动与部署范围

- `app.js`：授权目录没有共享空间时不创建虚假共享入口；保留当前账号/村庄的图底空间；目录更新后先校正选择再渲染。建筑编号包括0在API边界转换为字符串。
- `app.js`：事件先检查上下文/编辑状态；普通与小组后台图层响应在替换source前再次检查草稿，账号/村庄切换后丢弃旧响应。缺少actor的事件不再声称其他成员保存。
- `geometry-editor.js`：省略空可选UUID，保留真实锁；保存中禁止重复提交、阻挡后台覆盖；失败保留草稿；已提交但视图刷新失败与提交失败分别提示。
- `workspace-personal-context.sql`：只更新旧5参compat函数体；支持当前发布目录中的练习村，正式村仍校验开放及绑定。所有者/不同项目冲突检查保留，不扩大共享ACL。
- `repair-autonomous-workspace.py`：核对已应用account-entry及全部祖先、冻结release/control、89ab797的6个固定摘要，保留旧层，新建workspace-edit覆盖层。先自有备份，再单事务CAS一个函数，再只切换web；API/Auth/Postgres容器ID必须保持一致。支持重复执行及web停止/移除后续跑；不改4090。
- `workspace-legacy-web.json`仅用于隔离CI，重建真实历史网页字节并核对基准；不用于生产回退或覆盖历史层。

三种空间分别为个人体验（planning_features）、个人图底（personal_layer_versions）、全班共享。图底空间不是重复体验空间。非成员只显示有权访问的个人空间，加入课程小组后再显示有权访问的共享空间。

## 验证记录

本地13项新增JS回归先复现失败再修复，覆盖普通/小组await期间绘制竞态、错误保存保留、已保存后刷新失败、数值编号、空UUID、假共享入口、图底列表保留。独立审查3项意见均已修正并复测，最终无阻塞意见。完整本地及原生CI证据在发布前补充；实际阿里云浏览器待用户验收。

## 阿里云执行（发布验证通过后）

```bash
cd ~/village-deploy/source && git pull --ff-only origin main && python3 -B linux/scripts/repair-autonomous-workspace.py && python3 -B linux/scripts/repair-autonomous-workspace.py --apply
```

预检标记：`workspace_edit_consistency_preflight_passed_no_changes`。
完成标记：`workspace_edit_consistency_repaired_browser_check_required`。

见STOP则保留备份/日志及当前业务数据，不reset、不要重跑初始安装。浏览器强制刷新后验证：未入组账号首次进入米埗村；图底/体验切换后列表保持；体验空间新增、删除建筑并刷新确认；绘制过程中等待事件刷新不丢草稿。共享空间仍按原成员权限控制。此前已成功的account-entry修复不用重跑。
