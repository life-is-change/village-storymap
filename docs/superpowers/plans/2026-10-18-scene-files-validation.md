# C2a 三维文件生命周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development only if the user selects delegation. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在独立候选验证三维模型/贴图/组件/预览的上传、登记、方案引用、版本恢复、归档和重启后授权读取。

**Architecture:** 服务器私有目录存不可变文件；PostgreSQL 管上传会话与业务引用；文件持久化后再用同一事务提交素材/预览和映射。沿用在线 Supabase Auth、原场景权限和前端标准化算法，通过新候选入口显式启用，不修改生产网站。

**Tech Stack:** Node >=22 / 锁定 pg 8.23.1 / PostgreSQL 17 / Python 3 / Docker Compose；运行代码使用现有依赖和 Node 内置模块。

**Spec:** `docs/superpowers/specs/2026-10-18-scene-files-validation-design.md`（用户 2026-10-18 已确认）。用户已确认，主代理在原 main 顺序执行。

## Global Constraints

- 原目录 main → GitHub → 用户手动阿里云；不创建分支或工作树。保留已有改动。
- 一个 PostgreSQL 实例；独立库 `village_scene_files_validation`、角色 `village_scene_files_login`、连接池最多 2。
- 容器 `village-scene-files-validation-api`、端口 `127.0.0.1:18083`、内存预算 256 MiB、最多 2 个并发文件上传。
- 状态 `~/village-scene-files-validation`；文件在网站/Git 之外。A/B2/C1 数据、镜像和生产路由不改动；验证脚本仅兼容精确新增 HBA 行。
- 每个模型文件 50 MiB、纹理 10 MiB、PNG 符号 5 MiB、版本/组件预览 10 MiB；二进制流式处理，JSON 控制请求最多 2 MiB。
- 支持 GLB/PNG/JPEG/WebP；SVG 明确返回 `FILE_TYPE_UNSUPPORTED`。禁止外部 GLB 资源依赖、任意路径/URL、通用 RPC/SQL/表代理。
- Supabase Auth 与 4090 通道保留；调查照片、旧 group-models 库和村庄数据集的写入不在本次范围。
- 新物理文件只在本候选私有目录；旧 B2 scene 文件清单只读，不用源 `storage.objects` 承接新文件登记。
- “删除素材”为归档；有业务引用的物理文件不能清理。中断时保留现场，不自动重建/清空/重试跨库写入。
- 本地真实数据库测试只能使用显式废弃的 loopback 集群；不连接线上备份源、不在测试中恢复私有业务行。

## Review Focus

1. 提交已成功但响应丢失：同请求 ID 的重试返回原业务结果，参数或内容不同则拒绝；不能重复创建素材。（Task 2）
2. 归档与新增引用/物理清理并发：历史引用可读，归档阻止新增放置；提交与清理使用同一锁协议。（Task 2/3）
3. GLB 通过文件名伪装或含外部贴图/缓冲 URI：服务端独立结构校验且不发外部请求。（Task 1）
4. 管理员有读取权限但没有源注册所需课程成员关系：上下文预检明确失败，不能绕权限、改源数据或把授权失败误报密码错误。（Task 5）
5. 旧 B2 文件和新 C2 文件同时出现：分别检查可信映射，复制/发布共用文件不误删，不把缺失旧文件当作已迁移。（Task 2/3）

## 文件与接口地图

- `business-api/scene-files/contracts.mjs`：上传用途、角色、大小、操作参数及安全错误契约。
- `business-api/scene-files/file-store.mjs` / `formats.mjs`：私有路径、流式落盘、摘要、结构验证、读取和清理候选检查。
- `business-api/scene-files/database.mjs` / `uploads.mjs`：事务身份、会话、幂等提交、业务登记和文件读取授权。
- `business-api/scene-files/scene.mjs` / `references.mjs`：固定场景/素材/组件操作及跨方案文件引用检查；不移除 C1 的 seed-only 限制。
- `business-api/scene-files/http.mjs` / `config.mjs` / `main.mjs`：独立运行入口、固定路由及资源限制。
- `business-api/scene-files/maintenance.mjs`：过期会话/孤儿清理服务；默认统计，明确执行才删除，输出数量/字节。
- `linux/sql/scene-files-candidate.sql`：仅候选库的角色、私有元数据、锁和必要包装函数。
- `3D_scenes_edit/persistence/scene-files-api-client.js`：JSON 操作、上传会话及认证文件读取、Blob URL 管理。
- `3D_scenes_edit/assets/scene-asset-library.js`：可选批量上传依赖注入；原 Supabase 上传路径保持默认行为。
- 测试：`business-api/test/scene-files*.test.mjs`、`business-api/test/scene-files.integration.mjs`、相邻前端测试及 `linux/tests/test_scene_files_*.py`。
- 交付：`linux/scripts/deploy-scene-files-validation.py`、`probe-scene-files.py`、`linux/scene-files-image.json`、`linux/README.scene-files.md`、迁移验收记录。

### Task 1: 可限额验证的私有文件存储

**Files:** 创建 `contracts.mjs`、`file-store.mjs`、`formats.mjs` 和 `business-api/test/scene-files-store.test.mjs`。

**Interfaces:**
- `parseUploadRequest(input)` → `{requestId,purpose,context,files}`；purpose 仅 `asset|version-preview|component-preview`。文件角色枚举 `original|display|low|low-original|top|preview`，role 不重复。
- 模型 display 必需，original 可选；low-original 必须伴随 low；top 只允许 PNG。最多 5 个模型文件：original/display/low/low-original 各 50 MiB、top 10 MiB，总上限 210 MiB。纹理/符号仅 display；预览仅 preview。
- `createFileStore({root,maxUploads=2})` → `{stage({fileId,role,size,mime,extension,stream}),persist(fileId),open(fileId),discard(fileId)}`；物理键为服务器 UUID，`stage` 返回 `{fileId,size,sha256,mime,extension}`。
- `validateFile({handle,size,mime,extension})` 不信任客户端，读取受限结构；GLB JSON 块最多 2 MiB、总大小与块边界完全匹配，不完整数据报错。C2a GLB URI 仅允许内嵌 data URI，禁止外部协议和相对文件。

- [x] 写失败测试：`bounded_stream_and_limit`（50 MiB 可流式写，超过 1 字节拒绝，第三并发上传 busy）；`formats_reject_mismatch_external_uri`；`paths_reject_symlink_hardlink`；`aborted_upload_is_not_readable`。包含畸形分块、截断、重复 role、伪装 SVG、超长 JSON；断线后句柄/并发槽释放。
- [x] 运行 `node --test business-api/test/scene-files-store.test.mjs`，确认缺失实现的 RED。
- [x] 实现上述接口。目录 0700、文件 0600；Linux 验证 UID/链接；临时文件独占创建，持久化文件名不可被覆盖；fsync 文件和必要目录。PNG/JPEG/WebP 除魔数外校验有界容器结构与声明长度，不解码整张图。读取核对记录字节数和摘要；失败统一安全错误。
- [x] 同命令 GREEN。用合成 50 MiB 流验证服务端不调用全文件 `readFile`/`Buffer.concat`，并记录峰值内存，不把这个断言当容量测试。
- [x] 提交 `feat: add bounded private scene file store`。

### Task 2: 会话、授权和事务提交

**Files:** 创建 `database.mjs`、`uploads.mjs`、`maintenance.mjs`、`linux/sql/scene-files-candidate.sql`、`business-api/test/scene-files-upload.test.mjs`；创建真实 PG 集成测试及其合成 fixtures。

**Consumes:** Task 1 文件接口和 `parseUploadRequest`；现有在线身份验证结果 `{userId}`、源场景 RPC。

**Produces:** `createSceneFilesDatabase(config).withIdentity(identity,fn)`；`createUploadService({database,store,legacyReader})` → `{create(identity,input),status(identity,sessionId),upload(identity,sessionId,role,stream),commit(identity,sessionId,input),read(identity,fileId),cleanup({execute,now})}`。

私有 schema 记录 session、session_file、业务文件映射、清理租约；`(user_id,request_id)` 唯一，参数摘要不可变。状态为 `pending|ready|committed|aborted`。应用角色不具备超级用户/BYPASSRLS，不能从 HTTP 指定身份；所有包装函数固定 search_path 且撤销 PUBLIC/anon 执行权限。

- [x] RED 测试：`commit_replay_returns_original_asset`、`lost_response_never_duplicates`、`foreign_session_denied`、`revocation_between_upload_commit_denied`、`metadata_cannot_reference_foreign_file`、`commit_failure_leaves_invisible_orphan`、`cleanup_cannot_race_commit`；断言失败不增加业务行。
- [x] 单元 RED：`node --test business-api/test/scene-files-upload.test.mjs`。PG RED：在专用废弃集群设置 `VILLAGE_TEST_PG_URL` 后运行 `node --test business-api/test/scene-files.integration.mjs`；沿用 C1 的 loopback/专用管理员 guard，并与原集成测试串行运行。
- [x] 实现 session UUID 与源兼容逻辑路径映射；上传会话有 24 小时有效期，临时/孤儿只有超过 24 小时且再次无引用才可清理。每用户至多 4 个未完成会话、全候选至多 32 个；在持有配额锁时为声明字节预留空间，上传不得侵占 2 GiB 磁盘余量。新文件用 UUID 物理键，不按客户端摘要直接跨用户查找/去重。
- [x] `commit` 在持久化后以一次事务锁会话、复核成员关系并调用固定注册/版本/组件 RPC；原始、低模、俯视图等 metadata 文件字段由服务端生成。源 RPC 所要求的成员关系原样保留，不以 staff 读取权限代替注册权。
- [x] 逻辑映射允许发布/复制共用物理文件；read 通过业务所有权/课程/组/项目权限重新授权。旧 B2 文件按原快照与摘要只读解析，只允许两个 scene 桶。
- [x] cleanup 使用与提交相同的 session/file 行锁和租约；先标记不可再提交，复核无业务引用后才删除，已提交/共享/历史引用永不在本命令回收。默认 `execute=false` 只返回聚合统计。
- [x] 运行上述单元和真实集成命令 GREEN；验证直接应用登录无法读其他会话/越过包装函数写映射。提交 `feat: commit scene uploads with scoped idempotent references`。

### Task 3: 带文件的方案、素材与组件生命周期

**Files:** 创建 `scene.mjs`、`references.mjs`、`business-api/test/scene-files-scene.test.mjs`；扩展 Task 2 集成测试。

**Interfaces:** `runSceneFilesOperation(identity,operation,input)`；operation 保留 C1 9 项并新增 `assets|publishAsset|copyAsset|archiveAsset|updateAssetMetadata|components|saveComponent|publishComponent|copyComponent|archiveComponent`。业务注册只由上传 commit 触发，不提供任意路径的 register 入口。

`validateReferences(client,{document,scope,previousDocument,sourceVersionId})` 返回可信引用集合；权限检查和新增引用登记与场景 RPC 同事务、同项目锁。UUID 素材引用与 seed 分开；不能由浏览器提交物理文件 ID 代替素材授权。

- [x] RED：`group_scene_rejects_personal_only_asset`、`revoked_member_cannot_reuse_resolver`、`archive_preserves_versions_but_blocks_new_placement`、`restore_keeps_legacy_preview_or_fails_explicitly`、`publish_copy_share_without_unlink`；测试相同 revision 并发只有一次成功，校验失败不更新 revision。
- [x] 运行单元与串行 PG 集成 RED；使用真实源 Scene SQL，不以模拟权限函数替代实际规则。
- [x] 实现固定 SQL/RPC 路由和新文档验证。尽量复用 C1 纯几何/结构验证；若以替换引用的临时副本验证结构，副本绝不持久化，原 UUID 与元数据仍逐项验证。C1 运行源文件不修改。
- [x] 组场景只能新增同课程 course 或同组 group 素材；沙盒仅在其源授权范围引用。归档素材只保留当前文档已有引用或恢复源版本中的原引用，不能借恢复把个人引用升级共享。
- [x] 组件 fragment、preview、metadata 中引用独立验证；预览提交和对应版本/组件行在同事务登记。load/list 也解析文件状态，不等保存时才发现缺失文件。
- [x] 按 asset UUID 排序锁定相关记录，归档/发布/保存/清理遵守同一锁顺序；文件缺失报 `FILE_UNAVAILABLE`，不丢弃路径或返回伪成功。
- [x] 单元+真实集成 GREEN，复跑原 C1 集成与 `node --test business-api/test/scene.test.mjs`。提交 `feat: validate private scene assets across saves and versions`。

### Task 4: HTTP 与原素材库的显式注入客户端

**Files:** 创建新目录 `http.mjs`、`config.mjs`、`main.mjs`、HTTP 单元测试；创建 `3D_scenes_edit/persistence/scene-files-api-client.js` 和测试；修改 `scene-asset-library.js` 及相邻测试。

**Consumes:** Task 2 上传服务、Task 3 `runSceneFilesOperation`、现有认证 `verifyIdentity`。

**Produces:** `createSceneFilesHandler({verifyIdentity,database,uploads})`；`createSceneFilesClient({baseUrl,getAccessToken,fetchImpl,createObjectURL,revokeObjectURL})` → `{dataClient,uploadBundle,uploadPreview,resolveAsset,dispose}`。

固定路由：`POST /api/v1/scene-files/sessions`；`GET .../sessions/:uuid`；`PUT .../sessions/:uuid/files/:role`；`POST .../sessions/:uuid/commit`；`GET|HEAD .../files/:uuid`；`POST .../scene/:operation`。二进制 PUT 的 Content-Length 与会话声明一致；拒绝压缩正文/重复授权头/未知角色与路由，不支持任意网络代理。

- [x] RED：`http_auth_before_body`、`range_partial_and_invalid`、`no_redirect_token_leak`、`client_lost_commit_queries_same_session`、`dispose_revokes_blobs`、`injected_bundle_preserves_low_anchor`、`legacy_upload_default_unchanged`。检查文件路由无公开 URL、控制 JSON 超过 2 MiB 拒绝。
- [x] 运行 `node --test business-api/test/scene-files-http.test.mjs 3D_scenes_edit/persistence/scene-files-api-client.test.js 3D_scenes_edit/assets/scene-asset-library.test.js` RED。
- [x] API 将安全 code/phase/requestId 返回客户端，不输出原 SQL/错误正文/令牌；有界 GET/HEAD/Range，`private,no-store`、准确类型、nosniff。最多 4 个并发文件读取，超出忙错误。
- [x] 客户端仅允许 loopback 测试或同源 HTTPS，credentials omit、redirect error。上传保留请求 ID 并仅查询/恢复同会话，不自动跨库重试；不可用返回明确错误。
- [x] 素材库新增可选 `uploadBundle` 注入，沿用现有模型标准化/低模锚点和 UI 输入；未注入时保留现有默认实现。C2 dataClient 覆盖现有素材/组件方法；预览以 `uploadPreview` 会话提交，不接受任意 previewPath。
- [x] `resolveAsset(assetId,variant)` 每次认证请求取得 Blob，active URL 生命周期受控；替换/退出/失败时 revoke。原始模型作为下载附件，不直接当 display。不得改生产 `app.js` 的路由或全局客户端。
- [x] 同命令 GREEN；真实 HTTP→PG→文件系统集成走 `uploadBundle → place → save → preview version → load/resolve`，并运行 `npm test` 平台前端回归。提交 `feat: add opt-in scene file HTTP client and upload flow`。

### Task 5: 独立部署、离线镜像与真实账号探测

**Files:** 创建 `linux/scripts/deploy-scene-files-validation.py`、`probe-scene-files.py`、`linux/README.scene-files.md`、`linux/scene-files-image.json`、`docs/migration/2026-10-18-scene-files-validation.md` 及 Python 测试；扩展现有镜像 builder，仅新增新 tag 的入口和摘要选项。

**Interfaces:** 部署 `--check|--load-image|--deploy|--verify|--cleanup-report`；默认清理统计无删除。镜像 tag `village-business-api:stage-c2a-scene-files`，归档 `village-business-api-stage-c2a-scene-files-amd64.tar.gz`，Node 入口 `scene-files/main.mjs`。旧 tag 的文件集合与摘要算法不变。

- [x] RED Python：`image_excludes_new_runtime_from_old_tags`、`deployment_protects_all_previous_states`、`preflight_refuses_low_resources`、`probe_reports_missing_membership_before_upload`、`probe_phase_has_no_private_output`。PowerShell 运行 `& 'E:/anaconda3/python.exe' -m pytest linux/tests -q -k scene_files`；全量回归使用相同命令去掉 `-k scene_files`。
- [x] 部署只依赖最近且匹配运行指纹的 C1/B2 验收证明；校验备份和原文件清单。预检主机 MemAvailable 至少 512 MiB、目标卷可用至少 2 GiB，否则停止并报告，不自动删旧候选或加 swap。
- [x] 独立恢复新数据库与私有目录，新增精准数据库/角色 HBA 行只 reload；容器非 root、只读根 FS，仅指定文件卷可写、密码文件只读；网络不公开数据库和 API。备份/镜像上传目录不作为可写文件卷。
- [x] 文件只读完整性检查与 API 实际 TCP 校验写入独立 proof；`--verify` 仅重启 C2a API，不重启共享 PG/A/B2/C1。
- [x] 探测先隐藏输入网站账号密码，检查现有课程/成员、方案上下文及档案。管理员没有成员关系时以 `CONTEXT_MEMBERSHIP_REQUIRED` 停止；不得为了通过而构造源权限或盲目写文件。可由用户选择已有课程成员账号再隐藏登录；如果其快照缺少可写组空间，同样报告上下文缺失，另行安排候选测试上下文，不把此缺失当作验收成功。
- [x] 探测使用仓库合成 GLB/PNG：真实上传/登记、读回 SHA、放置/保存、预览版本/恢复、发布/复制/归档，以及重启后再次读取。按阶段落私有检查点，不输出业务行；成功才产生 `SCENE_FILES_INTERNAL_VALIDATED_NOT_CUT_OVER`。
- [x] Python GREEN；原全部 linux/tests 回归。构建前记录当前 C1/B2 运行摘要，构建后仍须相同；校验归档字节/sha256/平台/入口及纯 JS依赖。在可运行 Linux 容器环境做实际 smoke；没有则明确保留云端验证待办，不伪造 runtime 已验证状态。
- [x] 将本地实现与元数据提交推送 GitHub；给用户确切归档文件名、上传绝对目录、同提交部署命令及失败时应反馈的脱敏输出。未生成镜像前不要求用户上传。

### Task 6: 整体验证、审查与用户手动云端验收

**Files:** 更新本阶段迁移记录、README、总体设计状态；保留私有执行 ledger 和失败证据。

- [x] 执行全部相关 API 单元、前端回归、Python 部署测试，以及在专用废弃集群上串行执行旧 A/B2/C1 和新 C2a 真实数据库集成；记录完整命令、通过/跳过原因。
- [x] 实测一组代表性文件上传/下载/版本恢复的内存峰值和耗时；不以“容器限额”或“空闲占用”宣称并发容量达标。
- [x] 做一次独立整体代码审查；重要问题先补失败测试再修复，不因文档记载通过而跳过真实权限与一致性检查。审查须专门核对 5 项 Review Focus。
- [x] 推送最终 main 和镜像摘要后交给用户手动部署；云端回传最终标记前只声明本地交付，不声明 C2a 云端完成。
- [x] 2026-10-19 用户回传真实账号成功标记、4草稿/1里程碑/3合成文件540字节和重启持久性；已记录到迁移文档。正式网站、Supabase和4090未切换。
- [ ] 补充云端确切Git版本和验收后资源快照；教学并发容量尚未验证。下一阶段另列调查照片/其余业务写入与桥接。

## 自检与执行交接

已逐项对应设计的上传、类型/限额、旧/新文件读取、权限、组共享范围、组件/预览、归档保留、孤儿清理、客户端注入、资源约束和云端验收。新增目录使旧候选运行代码摘要保持不变；不把本阶段扩大为全部照片/GPU 迁移。

建议当前会话由主代理顺序实施以上任务，最后一次整体独立审查。接口和文件/数据库提交次序依赖紧密，顺序执行可减少并行接口返工。用户审阅本计划并确认执行方式后开始代码实现。
