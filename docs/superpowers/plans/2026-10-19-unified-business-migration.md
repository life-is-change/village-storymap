# 双站点普通业务统一接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 用户已要求集中交付；内部任务不是逐次人工部署或验收阶段。

**Goal:** 阿里云站点完整访问阿里云普通业务库，GitHub Pages 继续读写原 Supabase，集中交付候选版本及一次自动验收入口。

**Architecture:** 复用已验收场景/文件服务，增加一套固定操作的业务 API、单个共享连接池和显式页面适配器。普通业务按站点独立演进，共用 Auth；4090 保留 Supabase 队列，通过实例隔离的受限桥接访问阿里云任务。镜像同时携带筛选后的静态资源，GitHub Pages 不发布阿里云配置。

**Tech Stack:** Node.js >=22、现有 pg 8.23.1、PostgreSQL17/PostGIS、浏览器 UMD 模块、Python3部署工具、Docker Compose、Nginx。优先使用现有依赖，不引入完整自托管 Supabase。

**Spec:** [已确认并按双站点要求修订的设计](../specs/2026-10-19-unified-business-migration-design.md)。原 [混合设计](../specs/2026-10-15-hybrid-database-migration-design.md) 的历史“关闭源站写入”段落不再执行。

## Global Constraints

- 原项目目录 main；开始/提交前核对根目录、分支和状态，保留已有改动及忽略日志，不创建工作树、不切分支。
- 本地修改和测试 → GitHub main → 用户手动阿里云部署；不再次尝试已被浏览器策略拒绝的 Workbench 远控。
- source=GitHub Pages/Supabase，aliyun=阿里云站/本地业务库；普通业务无自动双向同步。一个页面只写一个业务库；候选故障不能自动写回source。
- Auth共用UUID/密码，全局Auth停用影响两边；本地业务撤销不覆盖源站角色/成员，也不删除共用Auth用户。
- 默认仓库发布配置source；阿里云构建配置只存在于阿里云产物，不能提交成GitHub Pages默认值。
- 私有文件不进静态根目录；密钥不进命令参数/日志/Git/镜像。合成测试库不导入私有业务dump。
- 单PG实例保持768MiB限额；统一API256MiB、总池最多4连接、上传2、读取4，SSE不长期持有DB连接。
- 主机available不足512MiB或磁盘可用不足2GiB时停止；不得删除旧数据卷或停止未知容器。
- HTTP公网IP不承载新API的Bearer令牌；公网启用前须HTTPS。内部候选可先部署，公网未就绪单独报告。
- 既有A/B/C1/C2a真实云端证明保留；修改影响的旧代码自动回归，不要求用户逐个重跑旧命令。

## Review Focus

- 同一UUID、同一照片自增ID在两库指向不同内容：任务必须按实例映射，不能覆盖源站照片/成员（Tasks1/10/11/14）。
- 数据库已经COMMIT但浏览器未收到响应：重试只能复核同一操作，不得再次上传、建版本或提交任务（Tasks4/6/9/10/11）。
- 新注册用户缺少本地auth外键，已停用用户再次登录：仅建立可信身份锚点，墓碑不能被首次初始化覆盖（Task3）。
- SSE连接期间被撤销或令牌到期、跨空间切换返回旧请求：停止旧订阅/缓存写入，不泄露旧空间状态（Tasks7/12/14）。
- 新桥接队列字段、同一学期唯一索引和旧Worker公开照片限制：真实约束及原Worker行解码必须参与回归（Tasks2/10/11/15）。

## 文件边界与公共接口

新增 `business-api/unified/`：`config.mjs` 配置、`contracts.mjs` 固定动作与DTO、`database.mjs` 唯一池、`identity.mjs` 身份/资料初始化、`catalog.mjs` 课程村庄空间、`survey.mjs` 调查评论、`planning.mjs` 锁与版本、`files.mjs` 普通文件、`events.mjs` 通知、`tasks.mjs` 本地任务、`bridge.mjs` 远端协议、`http.mjs` 路由、`main.mjs` 生命周期。避免将全部动作堆进一个handler。

新增 `features/data/deployment-mode.js`、`deployment-config.js`、`features/data/unified-api-client.js`、`features/data/platform-services.js`；对既有业务模块增加显式服务注入，保留source构造路径，不模拟Supabase查询链。

新增 `linux/sql/unified/{identity,catalog,survey,planning,files,events,tasks}.sql`（只用于新本地候选）、`supabase_SQL/Aliyun Task Bridge.sql`（源端受限扩展）、`linux/scripts/{build-unified-release,deploy-unified-business,probe-unified-business,prepare-unified-cutover}.py`、`linux/unified-release.json`、`linux/nginx.unified.conf`、`linux/README.unified-business.md`。发布清单由构建产生，不能手填未验证摘要。

统一服务类型：`Identity={userId,expiry,issuer}`；`Context={teachingProjectId,villageId,spaceId}`；`Result={ok:true,data}|{ok:false,code,remoteRevision?}`。服务器内部固定动作 `execute(identity, action, input)` 仅查常量registry，不能接受SQL/RPC名；成功HTTP `{data}`，错误 `{error:{code,phase,remoteRevision?}}`，不回传数据库原文。

## Task 1: 固定操作清单与双站点发布配置

**Files:** Create `docs/migration/unified-business-operations.md`, `business-api/unified/contracts.mjs`, `features/data/deployment-mode.js`, `deployment-config.js`; Test `features/data/deployment-mode.test.js`, `business-api/test/unified-contracts.test.mjs`。

**Interfaces:** `resolveDeployment(config, origin)->{mode,stage,instanceId,apiBase,releaseId}`；mode仅`source|aliyun`，stage仅`candidate|live`；阿里云apiBase固定同源`/api/v1`。`parseOperation(action,input)`返回白名单DTO；每个动作登记源入口、固定SQL/RPC、返回字段、文件/订阅和对应测试。

- [ ] 写失败测试：仓库默认source；阿里云配置不改变source实例；query/localStorage不能改mode；HTTP公网、未知字段/动作/函数名拒绝；两环境同一UUID产生不同缓存键。
- [ ] `node --test features/data/deployment-mode.test.js business-api/test/unified-contracts.test.mjs`，确认缺模块/行为断言失败。
- [ ] 展开业务依赖清单中的动态table/rpc包装器，逐方法登记真实读写与通知；实现配置和DTO常量。JSON普通变更请求上限2MiB，批量编辑最多500项；大型文件使用独立流式路由。清单必须覆盖source资料、进度、消息互动和云端立面provider入口。
- [ ] 同一命令通过；对每个清单动作检查至少一个成功/拒绝测试标识，未映射调用保持显式未实现，不能报告整体可用。
- [ ] 提交 `feat: define unified operations and independent deployment modes`。

## Task 2: 唯一连接池及本地权限迁移基线

**Files:** Create `business-api/unified/database.mjs`, `linux/sql/unified/identity.sql`; Test `business-api/test/unified-database.test.mjs`, `business-api/test/unified-database.integration.mjs`, `business-api/test/fixtures/unified.mjs`。

**Interfaces:** `createUnifiedDatabase(config)->{withIdentity(identity,fn),withMaintenance(fn),close()}`；只由此处创建max4池，场景/文件服务共享该池。`withMaintenance`只可执行受限维护函数，不向HTTP暴露。恢复/DDL是独立部署凭据。

- [ ] 写失败测试：4连接总预算、异常回滚/身份清除、未知profile拒绝、跨库HBA限制；合成schema包括源当前教学项目部分唯一索引、现有design项目、PostGIS和源权限函数。
- [ ] `node --test business-api/test/unified-database.test.mjs`；集成命令设置专用loopback合成PG的`VILLAGE_TEST_PG_URL`再运行`unified-database.integration.mjs`，确认失败。沿用合成用户`village_test_admin`与现有owned实例；全局角色测试串行，禁止连接普通私有备份库。CI使用已核验的Supabase PostgreSQL17.6/PostGIS镜像构造合成库，不装载私有dump。
- [ ] 实现短事务与statement/lock超时；本地迁移撤销新候选内历史宽松策略/任意函数执行权，增加窄包装函数和必要grants，不改变其他候选或源库的权限。定义新的schema版本检查，不能靠表名存在认定兼容。
- [ ] 单元与真实PG集成通过；连接并发/争用、1个当前项目约束、用户A无法读取用户B数据均有断言。缺少原生PostGIS环境时明确阻塞该证明，不用文本domain冒充原生测试。
- [ ] 提交 `feat: add shared bounded pool and candidate permission baseline`。

## Task 3: 共用认证、本地资料与停用隔离

**Files:** Create `business-api/unified/identity.mjs`; Modify `linux/sql/unified/identity.sql`, `auth-system.js`; Test `business-api/test/unified-identity.test.mjs`, `business-api/test/unified-identity.integration.mjs`, `features/auth/deployment-auth.test.js`。

**Interfaces:** `createIdentityService({verifyIdentity,sourceProfileReader,database})->{me(identity),ensureProfile(identity),updateProfile(identity,input),disableLocalProfile(identity,userId)}`；`sourceProfileReader`仅读经认证的本人来源资料；不接受客户端角色声明。新身份锚点由受限函数建立，支持profiles到本地auth.users的外键，不复制认证密码。

- [ ] 写失败测试：首次登录并发只建一个默认student、源teacher不能自授本地teacher、已有role不被metadata改写、停用/删除墓碑不被ensure覆盖、修改本地资料不写source；source配置仍使用原Auth资料流程。
- [ ] 跑对应Node单元/PG集成，确认失败。
- [ ] 复用现有在线Auth验证契约；增加有界`/bootstrap`聚合本人、课程与空间初始化，减少页面N+1。将阿里云loadProfile/updateProfile接到API，source分支保持原SDK。业务删除不全局删除Auth用户。
- [ ] 单元/集成通过，Auth源端失败与本地资料未就绪分别报告；禁止仅解析未验证JWT通过。
- [ ] 提交 `feat: preserve shared auth with site-local profile authority`。

## Task 4: 课程、村庄、空间及管理员完整操作

**Files:** Create `business-api/unified/catalog.mjs`, `linux/sql/unified/catalog.sql`; Modify `features/course/course-service.js`, `features/course/activity-logger.js`, `features/villages/village-client.js`, `features/admin/{course-admin,village-admin,group-plan-admin}.js`; Test `business-api/test/unified-catalog{.test,.integration}.mjs`, `features/integration/deployment-catalog.test.js`。

**Interfaces:** `createCatalogService({database})->{execute(identity,action,input)}`；固定动作对应现有建组/入组/锁组/进度、当前上下文/个人空间、村庄draft/dataset/reality发布/归档/恢复/删除、教学项目、管理员dashboard和活动记录。客户端以`services.catalog`注入，保留现有返回对象形状。

- [ ] 写失败测试：不接受浏览器student_key/角色、教师/成员隔离、组码受限、锁组不能加入、当前项目唯一约束保留、删除有引用村庄拒绝、响应丢失幂等重试不重复建组；source记录保持不变。
- [ ] 跑catalog单元/PG与`deployment-catalog.test.js`，确认失败。
- [ ] 使用真实源SQL逻辑建立窄事务接口；新增操作收据以实例/用户/requestId唯一。候选移除原“本地先成功再镜像Supabase”的写路径；村庄/成员变更发本地提交后事件，不同步覆盖源业务表。
- [ ] 同组/跨组/个人/共享/管理员沙盒测试通过；全部登记动作可到达，source原有课程测试通过。
- [ ] 提交 `feat: route catalog and administration through local business services`。

## Task 5: 调查、评论、互动和照片记录

**Files:** Create `business-api/unified/survey.mjs`, `business-api/unified/community.mjs`, `linux/sql/unified/survey.sql`; Modify `features/data/data-service.js`, `features/object-collaboration/object-comments.js`, `features/survey/survey-review-client.js`, `features/admin/survey-admin.js`; Test `business-api/test/unified-survey{.test,.integration}.mjs`, `business-api/test/unified-community.test.mjs`, `features/integration/deployment-survey.test.js`。

**Interfaces:** `createSurveyService({database,files,taskReferences})->{execute(identity,action,input)}`；`createCommunityService({database})->{execute(identity,action,input)}`，固定communityTasks/messages/reactions及其CRUD/版本动作。属性/评论/互动/照片登记/审核/历史/冻结动作逐项固定，服务端补用户身份。照片真正字节操作消费Task8的files接口；活跃GPU引用查询由Task11注入；先使用协议相同的合成替身测试，不在这些依赖未接齐前报告整体验收通过。

- [ ] 写失败测试：未确认几何禁止正式共享空间下游写入、跨空间object_code碰撞、伪造上传者/点赞者拒绝、旧revision冲突、照片被活跃任务引用不能物理删除、源照片同ID不被查询或修改。
- [ ] 单元/PG与对应前端测试确认失败。
- [ ] 保留源审核/历史事务规则；替换阿里云的`.from()`写入为显式API，评论编辑/删除和互动绑定UUID，新增逻辑删除及历史引用保护；照片记录返回本地受限fileId而非任意下载URL。
- [ ] 通过完整属性→审核→评论→照片登记/读取/删除及管理员恢复测试；source原测试通过。
- [ ] 提交 `feat: migrate survey collaboration and photo records`。

## Task 6: 规划锁、个人版本与小组基线

**Files:** Create `business-api/unified/planning.mjs`, `linux/sql/unified/planning.sql`; Modify `features/data/{feature-db,feature-edit-session,personal-space-client,personal-edit-version,group-baseline-client}.js`; Test `business-api/test/unified-planning{.test,.integration}.mjs`, `features/integration/deployment-planning.test.js`。

**Interfaces:** `createPlanningService({database})->{execute(identity,action,input)}`；包括lock acquire/heartbeat/release、各空间batchSave、versions/selections、冻结/更新基线/解决冲突/restorePoint。锁租约90秒、客户端心跳30秒；批量不超过500项/2MiB。

- [ ] 写失败测试：两个学生抢同一锁只有一个成功、到期后可重获、非持有者不能续期、并发版本冲突、不允许编辑contours、基线冲突恢复保留历史、重复batch收据返回同一revision。
- [ ] 单元/真实PG并发测试确认失败。
- [ ] 复用并审核源RPC的锁和版本事务；不保留先查再upsert的竞争锁。阿里云断网保留环境隔离草稿但不虚报保存/锁成功；源模式现有离线行为保持。
- [ ] 测试通过；真实多连接执行锁竞争、序列和幂等断言，连接池仍不超过4。
- [ ] 提交 `feat: migrate atomic editing locks and planning versions`。

## Task 7: 本地提交事件和权限受限SSE

**Files:** Create `business-api/unified/events.mjs`, `linux/sql/unified/events.sql`, `features/sync/business-event-client.js`; Modify `features/survey/survey-realtime-controller.js`, `app.js`; Test `business-api/test/unified-events{.test,.integration}.mjs`, `features/sync/business-event-client.test.js`。

**Interfaces:** `createEventService({database,now})->{appendInTransaction(client,event),open(identity,contexts,cursor),close()}`；`createBusinessEventClient({getAccessToken,onInvalidate,onConnectionChange})->{start(context),stop()}`。固定失效事件只含授权Context、kind和cursor，不返回业务整行。

- [ ] 写失败测试：rollback不发事件、重连游标过期要求全量刷新、跨组事件不可见、15秒权限复核撤销连接、token到期结束、切换空间丢弃晚到旧事件；SSE不占常驻DB连接。
- [ ] 服务端/前端测试确认失败。
- [ ] 事件写入同一业务事务；有界batch100、游标保留24小时，心跳/权限复核15秒、每用户最多4连接/总32。短借连接读取；背压超限终止并要求刷新。普通业务channel全部接入，本地通知不取代数据库锁。
- [ ] source原Realtime不变；连接中撤销/断线/重连测试通过，峰值连接预算受控。
- [ ] 提交 `feat: add authorized local invalidation events`。

## Task 8: 普通文件及原建筑模型库

**Files:** Create `business-api/unified/files.mjs`, `linux/sql/unified/files.sql`; Modify `features/models/group-model-library.js`, `features/admin/village-admin.js`, `features/data/village-dataset-resolver.js`; Test `business-api/test/unified-files{.test,.integration}.mjs`, `features/models/deployment-model-library.test.js`。

**Interfaces:** `createBusinessFilesService({database,store,legacyReader})->{begin(identity,spec),put(identity,sessionId,role,stream),commit(identity,sessionId,record),read(identity,fileId),archive(identity,fileId)}`；按photo/group-model/dataset分别定义白名单，复用C2a摘要/不可变协议，不把类型标记当授权。

- [ ] 写失败测试：相同文件名/照片ID不能跨实例覆盖、恶意路径/链接/外部GLB URI拒绝、未提交文件不可见、活跃/历史引用保护、50MiB GLB和10MiB照片限制、已有23个文件映射可读。
- [ ] 单元/PG/文件集成确认失败。
- [ ] 共享文件卷配额与上传2/读取4限制，复用C2a每种文件上限；村庄数据包逐文件解析既有package contract，不解压任意路径。建筑原/低模、绑定、放置、白模恢复、删除走本地服务；私有Range下载不缓存。
- [ ] 二进制重放、半文件、中断清理、旧模型绑定与规范化测试通过；源group-models路径不改。
- [ ] 提交 `feat: unify business file storage and model bindings`。

## Task 9: 真实三维工作室接入与预览原子提交

**Files:** Modify `3D_scenes_edit/persistence/scene-files-api-client.js`, `3D_scenes_edit/index.js`, `3D_scenes_edit/assets/scene-asset-library.js`, `app.js`; Create `features/data/scene-services.js`; Test `features/integration/deployment-scene-studio.test.js`, `3D_scenes_edit/persistence/scene-files-api-client.test.js`。

**Interfaces:** `createSceneServices({api,getAccessToken,contextProvider})->{client,uploadAsset,createMilestone,resolveAssetUrl,dispose}`；upload/milestone直接消费C2a会话原子提交，不能先上传preview再把任意路径传入旧createVersion。

- [ ] 写失败测试：真实buildSceneStudioOpenOptions注入正确client，上传→放置→autosave→milestone→reload/restore使用同一库；预览失败无半版本；取消不报成功；退出/登出释放Blob；候选不请求source Storage。
- [ ] 跑scene客户端和新平台接入测试，确认失败。
- [ ] high/low/top/preview解析绑定fileId/assetId，修正只传storagePath的旧回调；静态内置素材仍直接加载，私有素材统一鉴权读。保存冲突保留本地副本且不自动覆盖新revision。
- [ ] 页面入口回归及C2a自动协议测试通过；source入口继续使用原默认services。
- [ ] 提交 `feat: wire real scene editor to unified local services`。

## Task 10: 双来源任务协议、源端隔离及兼容Worker

**Files:** Create `supabase_SQL/Aliyun Task Bridge.sql`, `business-api/unified/bridge.mjs`; Modify `server/src/village_processing/facade/{models,gateway}.py`; Test `business-api/test/unified-bridge{.test,.integration}.mjs`, `server/tests/test_facade_worker.py`, `server/tests/test_worker.py`。

**Interfaces:** 源私有schema `aliyun_bridge`存`contexts/requests/run_origins`；固定入口`bridge_v1_apply_context`、`bridge_v1_enqueue`、`bridge_v1_status`、`bridge_v1_cancel`、`bridge_v1_confirm_crop`、`bridge_v1_retry`、`bridge_v1_artifacts`，只grant专用服务端身份。队列兼容字段`origin_instance_id`默认`supabase`，立面`source_photo_bucket`默认`house-photos`，桥接时只允许`aliyun-task-inputs`；旧行缺字段按source解释。请求键`(instance_id,owner_id,request_id)`唯一；`createTaskBridge({remote,instanceId})->{applyContext,submit,status,cancel,confirmCrop,retry,artifacts}`。

- [ ] 写失败测试：source任务/角色/文件权限维持原结果，阿里云任务即使同Auth UUID也不能从旧浏览器RPC/表/Storage绕过读取或取消；同本地ID不同实例不碰撞，旧消息不能撤销新墓碑。旧Worker行字段、claim/lease/record接口保持兼容。
- [ ] 单元/合成PG源端迁移与Worker测试确认失败；不向真实Supabase应用SQL。
- [ ] 兼容扩展队列来源字段默认source，桥接本地项目/照片引用放私有映射，普通source行和教学项目唯一索引不改；地理任务沿已就绪Worker村庄配置。私有`aliyun-task-inputs`只由服务端写；立面桥接任务photo_id=null且来源/路径/哈希由受控enqueue产生。所有authenticated队列/产物/签名策略及SECURITY DEFINER用户RPC加来源检查，不撤销source正常操作。
- [ ] 为桥接立面任务添加固定私有桶短期签名流式读取，校验host/path、无重定向、JPEG/PNG、10MiB及记录哈希；旧source任务沿原公开house-photos路径。执行旧任务回归、桥接输入拒绝与原生PG来源隔离，确认仅改变专用命名空间和必要队列兼容字段。
- [ ] 提交 `feat: isolate Aliyun task origin with backward compatible worker inputs`。

## Task 11: 本地任务outbox、照片保护和幂等结果导入

**Files:** Create `business-api/unified/tasks.mjs`, `linux/sql/unified/tasks.sql`, `supabase/functions/aliyun-facade-cloud/{index.ts,core.mjs}`, `supabase/config.toml`（存在时仅追加本函数配置）; Modify `features/geoprocessing/geoprocessing-client.js`, `rural_house_generator/{facade-queue-client,facade-cloud-client}.js`; Test `business-api/test/unified-tasks{.test,.integration}.mjs`, `business-api/test/unified-cloud-facade.test.mjs`, `features/geoprocessing/deployment-tasks.test.js`。

**Interfaces:** `createTaskService({database,bridge,files,now})->{execute(identity,action,input),tick(),close()}`；提交返回`{requestId,state,sourceRunId?}`，pending/failed明确显示，源runId不当本地请求ID；本地import唯一键包含instance/sourceRunId/artifact摘要。

- [ ] 写失败测试：事务回滚无outbox，响应丢失/重启不重复入队，同照片数字ID不引用source照片，本地撤销后status/cancel/import拒绝，旧重试不恢复权限；重复导入只建同一版本。
- [ ] 单元/PG与假远端协议测试确认失败。
- [ ] 单个低并发outbox循环（并发1、指数退避1/2/4/8/16/30秒），先同步确认上下文和私有输入再submit；取消/裁切/重试都查本地最新权限。源准备/桥接版本缺失明确返回未就绪。可信产物限主机/类型/大小并验摘要，导入本地单事务。cloud facade使用新增服务端函数，固定capability/submit/poll，只从桥接收据取得owner/照片，任务记录在私有桥接schema，不复用source照片ID。函数仅接受独立私有`ALIYUN_BRIDGE_TOKEN`常量时间鉴别（自定义鉴别配置不能影响旧facade-cloud），凭据由部署产生且不记录；provider配置沿原源端环境，测试仅用假provider不产生费用。未完成隔离适配则总体不通过，不静默走旧photoId。
- [ ] 状态/产物/输入删除保护、重复/乱序/断网、source/aliyun任务并行、地理与立面完整链通过；不触发真实GPU任务。
- [ ] 提交 `feat: bridge local tasks and import results idempotently`。

## Task 12: 全页面服务装配、社区消息和MC

**Files:** Create `features/data/{unified-api-client,platform-services}.js`, `business-api/unified/mc.mjs`; Modify `app.js`, `app-3d.js`, `index.html`, `homepage/dist/index.html`, `features/mc/mc-bridge.js`, `features/sync/supabase-sync-manager.js`, `linux/sql/unified/catalog.sql`; Test `features/integration/{deployment-routing,deployment-community,deployment-mc}.test.js`, `business-api/test/unified-mc.test.mjs`。

**Interfaces:** `createPlatformServices({deployment,authClient,fetchImpl,storage})->{identity,catalog,survey,planning,files,scene,tasks,events,community,mc,dispose}`；`createMcService({database})->{getConfig(identity,context),exportBuildings(identity,context)}`，固定响应不含密钥。source返回原适配器，aliyun使用同源API，配置按站点静态产物加载。实例/用户/空间缓存键统一从Task1取得。

- [ ] 写失败测试：相同代码source仍访问Supabase，aliyun所有普通业务只访问API；白名单仅允许Auth和显式任务通道请求source。切换空间/用户晚响应不污染新状态；iframe/新立面窗口继承正确配置但不接受任意opener URL。
- [ ] 跑上述三组测试确认失败。
- [ ] 装配所有普通调用、订阅、消息/任务互动和活动日志；MC读取本地当前几何与配置并保持原导出格式，不接受服务器任意目的URL。候选服务不可用时标明失败，不回落source。
- [ ] `npm test`及候选网络路由断言通过；页面配置source下原主页/认证/三维/任务测试仍通过。
- [ ] 提交 `feat: assemble independent source and Aliyun page services`。

## Task 13: 统一HTTP生命周期与发布构建

**Files:** Create `business-api/unified/{config,http,main}.mjs`, `linux/scripts/build-unified-release.py`, `linux/Dockerfile.unified-business`, `linux/unified-release.json`; Modify `linux/scripts/stage-web.py`; Test `business-api/test/unified-http.test.mjs`, `linux/tests/test_unified_release.py`。

**Interfaces:** `createUnifiedHandler({services,verifyIdentity,release})->http.Handler`；`build_release(root,baseArchive,output)->manifest`，清单含git/schema/代码/静态/镜像/归档摘要和平台linux/amd64，镜像启动`node unified/main.mjs`，静态产物独立`/opt/village-web`。

- [ ] 写失败测试：所有域固定路由可达、匿名/未知动作/超限拒绝、鉴权错误与DB错误可区分、日志无令牌，优雅退出停止SSE/outbox/唯一pool；构建不含私有文件且source配置未改。
- [ ] 服务端/发布Python测试确认失败。
- [ ] 内建HTTP聚合Task3-12服务，所有连接共用Task2池；构建从已验证Node22基镜像生成一个归档，静态经stage-web筛选后写阿里云配置，不修改工作区source配置。已有文件拒绝覆盖，生成sha256清单，运行证明未取得时保持pending。
- [ ] API协议、本地Node22兼容性及构建检查通过；没有Linux引擎时只标记待云端运行，不伪造Docker证明。
- [ ] 提交 `feat: package unified API and matching Aliyun web release`。

## Task 14: 单次自动验收与双站点负载回归

**Files:** Create `linux/scripts/probe-unified-business.py`, `business-api/test/unified-acceptance.integration.mjs`, `features/integration/unified-page-flow.test.js`, `linux/tests/test_unified_probe.py`; Modify `.github/workflows/ci.yml`; Create `docs/migration/unified-acceptance-matrix.md`。

**Interfaces:** `run_probe(api,adminCredentials,memberCredentials,state)->AcceptanceReport`；仅内存使用密码，测试收据可持久化，无令牌；报告每个动作的phase/code、实例/release、文件/版本摘要、实际restart证明和资源摘要。

- [ ] 写失败测试：一次输入覆盖普通读写/文件/三维/任务模拟，重跑复用专用TEST上下文，意外真实任务提交拒绝，partial不写总体通过；精确失败阶段不再只报context。source与aliyun同时操作同UUID/同本地ID仍隔离。
- [ ] Node与Python测试确认失败。
- [ ] 整理一个内部自动入口：既有回归→原生PG串行集成→浏览器页面装配/网络→兼容Worker与桥接→1/5/10/20并发。真实密码只在云端最终probe提示，完整场景之后重启实际统一API并读回。缺少teacher真实Auth时用合成PG身份验证教师授权，不声称真实教师登录通过。
- [ ] 执行 `npm test`、`node --test business-api/test/*.test.mjs`、`python -m pytest linux/tests -q`，专用PG集成串行运行；CI补同样的Node22、Python、原生PostGIS合成集成，source/aliyun模式都跑。记录Auth/SQL/文件分段和P50/P95，未实测项明确列出。
- [ ] 提交 `test: consolidate migration acceptance and dual site regression`。

## Task 15: 一次候选部署、精确恢复及Worker就绪检查

**Files:** Create `linux/scripts/deploy-unified-business.py`, `linux/compose.unified-business.yaml`, `linux/nginx.unified.conf`, `linux/README.unified-business.md`; Test `linux/tests/{test_unified_deployment,test_unified_resume,test_unified_worker_readiness}.py`。

**Interfaces:** `--check|--deploy|--verify|--resume|--rollback-code`；用户入口`python3 linux/scripts/deploy-unified-business.py --deploy --archive <path> --backup-dir <path>`完成预检、加载、隔离恢复/文件核对、API和静态部署及Task14探测。已有状态按receipt恢复，不重复restore。

- [ ] 写失败测试：资源阈值、摘要/版本不匹配、未知旧容器/HBA变化停止，恢复失败不覆盖卷；重跑不建第二个库/角色；source网页/共享PG不重启；兼容Worker版本证明缺失禁止真实桥接，提示一个精确待办。
- [ ] Python测试确认失败。
- [ ] 新DB`village_unified_candidate`、角色`village_unified_login`、API`village-unified-api`、私有目录`~/village-unified-deploy`、API loopback18084；只向共享PG添加精确新库/角色HBA规则并reload。静态提取到版本目录，用已验证的现有Nginx镜像启动独立preview容器，只绑定loopback18085，将`/api/v1`代理到该API，页面/API同源；验证链接/权限/敏感文件不可访问。预览不修改现有公网80入口或真实源SQL；没有HTTPS时不宣称公网页面已验收。保留检查点、错误码和已完成项，逐步骤重入。
- [ ] Docker替身测试和文件系统测试通过；真实Linux验证由集中部署入口产生。README列一个归档上传及一个候选命令，若需4090更新则给同Git提交的兼容Worker更新/回退动作，不暗示阿里云能直接操作校园4090。
- [ ] 提交 `feat: deploy unified candidate with resumable acceptance`。

## Task 16: 初始化新快照、HTTPS和仅阿里云站启用

**Files:** Create `linux/scripts/prepare-unified-cutover.py`, `linux/tests/test_unified_cutover.py`, `docs/migration/unified-cutover-checklist.md`; Modify `linux/README.unified-business.md`。

**Interfaces:** `--plan|--check|--apply|--rollback-code`；交接收据含source快照时间、文件清单、目标DB/实例、schema/release、HTTPS证据、桥接/Worker版本以及source站保持可写证明。工具不自动为用户购买域名或修改共用Auth。

- [ ] 写失败测试：拒绝2026-10-15旧快照冒充最新；源文件变化/缺失阻塞一致性证明；不暂停GitHub Pages写入、不撤销source权限、不覆盖原教学项目；无HTTPS不发送公网Bearer令牌。阿里云已有新写入时禁止重复初始化/覆盖。
- [ ] Python测试确认失败。
- [ ] 新一致数据库快照恢复到全新目标，按该快照引用复制/复核文件，changed对象不能默认为正确；源站之后的更新不自动追赶。生成隔离桥接SQL、新provider函数及其私有凭据部署/回滚清单，源扩展应用属于明确正式操作。仅在已验收且HTTPS/Worker就绪后切阿里云路由；source配置维持原状。回退源扩展不能删除已存在桥接任务/文件；先禁止新桥接提交，待运行任务结束或受控取消，保留记录并恢复原权限定义。
- [ ] 合成双站点同时新增数据证明互不覆盖；优先代码回退保持本地库。改回Supabase时有冲突报告和手动合并步骤，不自动覆盖任一站新增数据；新快照、TLS、真实GPU与云端负载未完成时不能输出正式完成。
- [ ] 提交 `feat: activate only the Aliyun site with independent source retention`。

## 执行与审阅约定

自审覆盖：设计§1-3→Tasks1/2/12/13；§4业务表→Tasks3-12；§5身份权限→Tasks1-6/10；§6文件/通知→Tasks7-9；§7双站点任务→Tasks10/11/14/15；§8资源→Tasks2/13-15；§9集中操作→Tasks13-15；§10初始化/HTTPS/回退→Task16；§11整体证明→Tasks14-16。上述Review Focus五项已落入相应任务的失败断言，不以只检查文件存在替代行为测试。

这是一个统一交付计划，Task1-16是实现依赖顺序。沿用本会话本地main开发方式，建议由当前代理直接执行以保持跨模块接口上下文；计划审阅通过后，使用executing-plans，内部持续测试/提交，最终一次完整复核。用户不逐任务上传镜像或输入密码。

完成标准：代码、镜像、候选部署和实际云端证明分别记状态；总体成功不能隐藏普通业务未接入、源端扩展未应用、Worker未兼容、HTTPS缺失或旧快照。正式站点操作由用户按最终集中清单执行；当前只提交计划，不改变云端、4090或GitHub Pages的数据连接。
