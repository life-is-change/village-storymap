> 已由[阿里云独立平台一次实施清单](2026-10-21-autonomous-handoff.md)替代。用户尚未实施本旧流程；请使用新清单，认证/队列/文件全部在阿里云。

# 统一迁移最终交付：2026-10-20

> **2026-10-20 后续目标变更：本交付为旧Supabase任务桥接方案，用户尚未执行。暂停按本文部署/安装源桥接。新目标是认证、业务、文件与任务队列全部在阿里云，校园4090主动HTTPS取任务，并先以公网IP验证全流程；见[新设计](../superpowers/specs/2026-10-20-aliyun-local-task-system-design.md)。旧镜像保留，不代表新方案已实现。公网IP可使用受信任IP证书，购买域名不再作为本次技术验证的前置条件。**

**代码、测试和离线镜像已交付；阿里云候选部署与正式切换尚未执行。** 原网站仍按当前方式运行。本次没有修改 Supabase 或4090服务。

## 本次已完成

- 阿里云普通业务、照片/GLB、场景与任务桥接统一接入；GitHub Pages 保留 Supabase 普通业务连接与独立写入。
- 一次最终审查发现的五项部署/重试缺陷已修复，并观察对应回归先失败再通过。
- 前端1067、API单元89、Python部署工具241通过/1跳过；真实页面装配与锁定的Edge类型检查通过Platform CI。
- 真实 PostgreSQL17/PostGIS 原生集成、任务权限隔离、失败立面重试后完成与本地文件读取通过；未启动本地数据库。
- 最终运行代码提交：`2f98c0f4b52b0bcdd285f537a8de59b5ae52611a`。
- [原生数据库检查39421071825](https://github.com/life-is-change/village-storymap/actions/runs/39421071825)、[平台回归39421071886](https://github.com/life-is-change/village-storymap/actions/runs/39421071886)、[Pages39421072230](https://github.com/life-is-change/village-storymap/actions/runs/39421072230)均成功。
- 修复过程中用于复现新回归的失败通知是历史运行记录；以上最后运行已通过，没有关闭或弱化测试。

## 最终镜像

```text
C:\Users\MR\village-image-transfer\village-unified-2f98c0f-amd64.tar.gz
```

- 发布：`unified-2f98c0f4b52b`；Linux/amd64；103133882字节。
- SHA256：`f517935a0869d8ecdb084d3d48159709121a6729166a88c0771c91120276c77a`。
- 696个追加层文件离线审计通过，代码/SQL/网页摘要匹配；无密钥、备份或测试文件；第一方模块路径正确。
- `runtime_execution=pending_linux_container_smoke_test`：打包成功不等于真实Linux容器已运行。
- 不再使用旧 `689de9d` 中间包；不需要上传旧阶段镜像。

## 下一步：生成一份私有上传包

先准备好计划用于公开站点的域名与有效HTTPS证书。公开切换要求快照不超过24小时；若当前没有域名，可以保留本次镜像，等准备好后再生成最终快照包，避免复制后很快过期。

在**Windows PowerShell**执行（不要粘到阿里云终端）：

```powershell
cd 'E:\研究生工作\332工作\3D村庄规划网页\village-storymap-GIT'
git pull --ff-only origin main
& 'E:\anaconda3\python.exe' -X utf8 linux/scripts/prepare-unified-cutover.py --package-handoff `
  --archive 'C:\Users\MR\village-image-transfer\village-unified-2f98c0f-amd64.tar.gz' `
  --source-output 'C:\Users\MR\village-unified-handoff-2f98c0f'
```

提示时输入 **Supabase数据库密码**，不是Secret key/Publishable key/网站密码。密码隐藏输入，不要发送给聊天。已检查本机 PostgreSQL17 客户端存在。

成功后只上传下面这一个文件到阿里云 `/home/admin/`，不用解压：

```text
C:\Users\MR\village-unified-handoff-2f98c0f\village-handoff-unified-2f98c0f4b52b.tar.gz
```

`source-private`目录包含一次性源端安装SQL和机密环境文件，留在Windows私有目录；不要上传到网站目录或GitHub。

## 阿里云：一次候选部署与集中验收

```bash
cd ~/village-deploy/source &&
git pull --ff-only origin main &&
python3 linux/scripts/deploy-unified-business.py --deploy \
  --handoff "$HOME/village-handoff-unified-2f98c0f4b52b.tar.gz"
```

按提示隐藏输入服务端Secret key以及网站管理员/成员登录密码（例如管理员332、成员25213040）。它会复制普通文件并统一验证，成功标记：

```text
UNIFIED_INTERNAL_VALIDATED_NOT_CUT_OVER
```

中断时保留文件、数据库和日志，使用同一命令将 `--deploy` 改为 `--resume`；不要删除状态目录或重置数据库。仅发送安全的 `STOP` 行。

此命令不会切换正式网址。原公共Nginx、旧数据库候选和Supabase继续保留；新候选API/预览仅绑定本机端口。

## 正式切换仍需实际完成

详见[一次性交接与切换清单](unified-cutover-checklist.md)：应用生成的源端安装SQL、部署两个私有Edge入口、更新并重启原4090 Worker、验证域名/DNS/HTTPS、最后执行受检查保护的 `--check`/`--apply`，然后真实浏览器和GPU验收。

当前没有域名/证书；源SQL/Edge/Worker更新、真实快照与云端容器启动、真实GPU/提供商任务均没有执行。工具不会把这些缺项记为完成，也不会自动把阿里云新数据回退覆盖到Supabase。两个站点初始化后的普通业务写入独立，不自动双向同步。

## 最终审查处置

1. Important：历史候选校验误连新库且用新源码校验旧镜像 → 旧数据库适配器与固定镜像元数据校验。
2. Important：TEST小组空间无规划基线 → 与探测语义相符的共享TEST空间，实际原生读写及重复创建验证。
3. Important：丢响应后重复上传/任务 → 身份、上下文、输入与文件内容摘要绑定的持久收据；查询已提交上传，确认后才分配新编号。
4. Important：任务重放多套一层result → 首次/重放DTO一致。
5. Important：立面失败重试后停止轮询 → 源状态复核及本地轮询恢复，原生读回完成文件。

无已核实Critical；无延期Minor。审查未执行的云端/真实账号/源安装/GPU/TLS事项仍为外部验收门槛。审查没有把批准的独立写入或保留不确定状态视为同步/回滚缺陷。

## Rulings I made（按记录顺序完整保留）

以下是本轮计划执行中形成的全部决策记录，包括依据、已知取舍和未执行门槛。工作记录与原始验证日志按用户要求保留，不作工作树清理。

- Ruling: use original main and retain this ignored ledger — explicit user AGENTS overrides worktree/cleanup advice — no isolated branch safety, preserve existing changes.

- Ruling: keep original verified standalone modules immutable where feasible — old image-code digest checks must stay meaningful — shared wrappers/new code are preferable to changing historical runtime definitions.

- Task 2: Ruling: local native PostGIS unpack/start command rejected by automatic policy (only reason: blocked by policy); no installation was performed. Move native integration to isolated GitHub CI early, keep unit tests local; do not substitute a geometry text domain. Cost: CI startup/network latency; preserves genuine PostGIS proof.

- Task 3: Ruling: local-only Auth UUID anchors require removing the restored on_auth_user_created trigger; managed passwords are unchanged. Live membership/progress keys follow a profile rename atomically; historical aliases remain private. Bootstrap aggregation will be assembled with catalog in Task 4, avoiding a second pool path.

- Task 4 native proof: b8fcbf0 GitHub run39214263893 success. Native PostGIS tests cover concurrent receipt replay, staff-only group creation, locked joining, nonenumerable student group codes, unforgeable membership identity, constrained table ACLs, actual create_village_draft and delete_unused_village source functions, geometry validity and referenced-village delete refusal. Frontend source regression1025/1025 and Platform regression CI passed. Ruling: raw source lifecycle RPCs are called only behind fixed private wrappers under local role checks; no generic RPC/table endpoint is exposed. Broader real-page assembly remains Task12.

- Task 5 native proof: 6d7d1e7 run39216778549 success. Covers course-member shared access, genuine restored confirm_survey_feature_geometry lock/revision transaction, downstream gate, UUID comment ownership, foreign edits refusal, cross-space collision, replay/history, old replies/likes, inherited points and server-only reward commit. Run39216218728 first reproduced dropped legacy likes; run39216621775 exposed ambiguous PL/pgSQL delta; both fixed and full native suite green. Source regression1030/1030. Ruling: community-tasks.js also requires injection because ordinary replies/likes/lifecycle live there, and numeric legacy IDs replace provisional UUID DTOs. Legacy anonymous replies stay read-only snapshots; new actors use UUID. File-byte registration/read/delete dependencies remain Task8/11 as planned; full freeze/baseline/editor proof is combined in Task6/14, no cloud acceptance claim yet.

- Task 6 native RED: run39218208515 reproduced legacy-personal privacy gap (same-group reader wrongly allowed). Ruling: delegate the two context predicates to the restored, audited final source functions behind the active-local-profile guard, instead of duplicating an earlier version. This preserves owner-only legacy recovery rules; cost if source definitions change: schema preflight must reject unknown definitions before activation.

- Task 6 native proof: 03655c1 run39246835514 success, Platform regression39246835556 success; local full frontend1034/1034. Native lock contention/expiry, replay, actual PostGIS before-state, stale revision, personal ownership/current selection, genuine shared freeze, baseline conflict/keep-group/restore persistence all pass. Ruling: raw unused Aliyun feature upsert/delete helpers reject EDIT_SESSION_REQUIRED and force atomic edit sessions; no offline success. DTOs follow actual source RPC afterGeom/afterProps/geometry revision/lease fields; all contour writes stay read-only.

- Task 7 native proof: 833df32 run39248762756 success; Platform regression39248762777 success. Unit8/8 and source regression1036/1036. Native commit visibility/rollback, unauthorized group filtering, expired cursor refresh, private reaction event and membership revocation pass. Ruling: a serialized transaction-local cursor plus retained prune watermark distinguishes rollback sequence gaps from lost history; add private collaboration triggers too. All ordinary-source channel branches are bypassed when services.events is assembled in Task12; no DB connection is held while waiting/SSE streaming. HTTP drain termination remains Task13/14.

- Task 8 native proof: 823eba4 run39251811361 success; Platform regression39251811314 success. Native tests cover 23 synthetic legacy Storage mappings with actual reader hashing, photo backfill, owner-only personal SSE, private upload/read/replay, model binding/white restoration/archival with 4 history records, interrupted cleanup and a real ten-file V0 upload/publication. The actual server files will be rechecked by unified deployment acceptance (Task15), not claimed tested here. Full frontend1041/1041. Ruling: modern course-personal contexts supplement the restored planning predicate with exact owner/project/course/village matching, without widening legacy recovery. Ruling: local model/village removal retains referenced immutable bytes and history; pending/aborted uploads alone are physically cleaned. Dataset GeoJSON is token streamed with geometry/coordinate/count validation; manifest/validation documents are bounded to2MiB to protect256MiB API memory. C2a bytes will use the same store/budget through Task9/13 adapters; Range HTTP headers and aggregate reader limits are verified in Task13/14.

- Task 9 proof: actual app buildSceneStudioOpenOptions injects the local service; actual studio create/place/save/milestone/reload/restore/conflict flow passes. Real GLB processing produces original/display/low/top bundle accepted by existing C2a metadata parser; no Storage fallback. C2a server protocol unit tests and source frontend1047/1047 pass. Ruling: public seed GLB paths alone remain direct static URLs; private variants use assetId plus variant, never an arbitrary path. Milestone stops on failed/unsettled autosave or preview capture; local drafts include instance/user/project/village/space. Logout/dispose cancels pending requests and revokes all owned blobs. Underlying C2a role/member rules are preserved; runtime SQL/grants/shared-budget adaptation is Task13/14, not a permission relaxation here.

- Task 10 native proof: 9703ace run39355077904 success; Platform39355077789 and Pages39355076987 success. Source RPC submit/cancel stays compatible; same-UUID/admin cannot read/cancel/crop/import Aliyun origin; private Storage restrictive policy wins over permissive legacy policy; instance replay/tombstones/Worker claim and local profile/photo revocation pass. Worker52/52 incl actual hash/MIME/host/path/query/redirect refusal. Ruling: add explicit entry guards to all reviewed source user task RPCs as well as triggers, covering no-op/read paths; bridge role alone bypasses them, existing Worker service RPCs unchanged. Real source SQL has not been applied.

- Task 11 partial proof: fe047e1 native39356290844 green (rollback/outbox/lost response/restart/revocation); aabb318 native39357200930, Platform39357200943 and Pages39357200146 green incl isolated cloud claims and lease receipts. Unit81/81 after streamed task files additions. Ruling: source PostgreSQL ports are unreachable from Aliyun, so add a fixed HTTPS Edge transport using a dedicated bridge-only database login and TLS CA; never grant bridge RPCs to service_role or expose database credentials to browsers. Production role/login/Edge deployment stays Task16. Ruling: an uncertain billable provider submission is retained as submission_unknown and never automatically resubmitted. Task11 remains incomplete until actual private file/import and frontend adapter proofs pass.

- Task 11 proof: 5f9a9ed native39359623000 and Platform39359622988 pass, including cancel-before-submit tombstones, global Auth removal, actual private PNG reading, native photo reference protection, immutable hashed artifacts and streamed atomic/repeated import. Frontend1049/1049; API81/81; Worker52/52. Ruling: cancellation creates a source receipt even before enqueue and uses the same advisory lock, closing the late-delivery race. Ruling: local result versions use nullable legacy source FK plus local_task_id and explicit instance/run/digest/space receipts; no fake source queue row. Large files stream, with2MiB individual feature cap to protect256MiB API; unusual larger geometries explicitly fail. Deno/real transport and shared budgets are Task13/14; source deployment/Worker/real provider acceptance remains Task16. Whole page injection is Task12, so no production cutover claim.

- Task 12 in progress: real same-origin API/registry, map/admin/3D/task-generator injection, Auth/space late-response rejection and source business guard added; source retains its original adapters. RED->GREEN routing/community/3D/MC tests observed. Ruling: allow catalog facade's existing admin.* aliases, but backend still dispatches fixed admin actions; source registry exposes no local domains. Ruling: legacy localStorage feature helpers are forbidden in Aliyun, preventing old-device rows contaminating server geometry. Remaining Task12: native MC/admin/activity proof, safe seed/rename/preference routing, homepage inheritance, full regression and operation inventory update; not complete and not cut over.

- Task12 native checkpoint 2e31b84: Platform39368505631 success; native39368505659 failed precisely on rename revision, while MC/read/admin/activity cases before it passed. Ruling: expose survey review geometry_revision on scoped planning DTOs instead of guessing zero from planning_features; preserve old/new review history created by the versioning RPC instead of renaming the old review into a duplicate new key. Re-run native CI before marking Task12 done.

- Task12 proof: fe48afe native39368752350, Platform39368752406 and Pages39368751713 all success. Local frontend1061/1061 and API83/83; homepage TypeScript/Vite build passes. Real MC current-geometry export/replay/cross-space refusal, rename dual leases/review revision/history/replay, admin photo/message permission and survey activity pass native tests. Ruling: the audited shared-survey add generates an immutable fresh code; atomic rename binds just that new transaction's row/review/version/activity to the already leased target, preserving the old deleted review and history. Source browser adapters remain; generator foreign opener rejected; Aliyun homepage avoids prior-user cached catalogs. Unified HTTP/runtime/artifact remains Task13, so no production activation is claimed.

- Task13 in progress: unified fixed-route HTTP and shared lifecycle RED->GREEN; config forbids inline secrets and owner PG login, source bridge disabled until explicit readiness; one shared4-connection database facade for ordinary/C2a/tasks; aggregate private file read4/write1 budget (deliberately one upload at a time on256MiB API, within approved maximum2). Same-hash private models use reauthorized HEAD/ETag instead of repeated downloads. Offline image preserves repo-relative first-party modules under /opt/village/{business-api,features}, static separate /opt/village-web; manifest runtime remains pending until actual Linux proof. Existing C2a schema is adapted from audited body without another login/pool. Ruling: normalize building_3d namespaces in the server survey gate, closing a possible review bypass found during assembly; added native negative case. Build and full shared HTTP/native proof remain incomplete.

- Task13 checkpoint5ada2b8: Python214 passed/1 skipped, frontend1062 and API87 pass. Native39370373750 failed on unauthorized C2a read, revealing the generic legacy query needs unrelated source table/function permissions. Ruling: inject fixed scene-only legacy readers and private SQL helpers instead of granting broad source-table SELECT; preserve original C2a default adapters. Native upload/commit itself passed before this negative case. Offline initial image5ada2b8 assembled (103166049bytes, runtime pending) but layer audit found dependency test files; builder now filters those, and a RED->GREEN layer test proves exclusion. Rebuild from the next committed code; old archive retained, not approved for deployment.

- Task14 checkpoint: actual Chromium real index/admin assembly passes in source and Aliyun modes; Aliyun ordinary source SDK calls0, no page exceptions. Deno2.5.4 locked typecheck passes after correcting unknown-error and ArrayBuffer body types. Frontend1064, API88, Python219 passed/1 skipped, Worker56 pass. Native consolidated load/restart test added but awaits CI. Request metrics use AsyncLocalStorage isolation and no identities/tokens; cloud probe binds release/instance, reuses TEST receipts and refuses real GPU submission. Ruling: native CI proves a service/pool restart; actual final image Docker startup/restart proof remains Task15 cloud acceptance, explicitly not inferred from synthetic tests. Cost if cloud fails: no cutover; retain candidate/logs. Task14 incomplete pending native CI; Tasks15/16 not started.

- Task15 in progress: fixed private DB/role/ports, archive load/extraction, transactional restore and schema install, actual archive counts/structure/extensions, strict runtime commands/env/mounts/networks, HBA reload without PG restart, immutable state nonce/OID/schema fingerprint and nonrepeating resume engine implemented. Docker replacement executes full candidate flow and second resume without repeating CREATE/restore/start; ambiguous partial steps retain state and require exact proof. Worker versions now advertise loaded private bridge protocol, native private availability rejects mixed old claimant heartbeats; original source availability/RPCs unchanged. Ruling: an uncertain interrupted extraction/schema may need inspection rather than destructive automatic repair; receipt recovery only marks externally proven completion. Real Linux image and cloud restart remain final manual acceptance.

- Task16 in progress: fresh24h snapshot gate, immutable source-file HEAD consistency checks, explicit HTTPS hostname/chain/SNI loopback staging, private source SQL/env package with captured original RPC definitions, dedicated transport role, independent-site difference report, no automatic fallback/merge, exact Worker village mapping and Aliyun-only TLS routing implemented. Added private handoff bundler plus safe allowlisted/hash-checked extraction so user uploads one bundle; source transport credentials stay outside it. Build now requires successful native+Platform CI for exact commit and embeds matching hashes. Ruling: formal completion remains false until actual browser and GPU/provider exercises; tooling must never invent this evidence. Ruling: valid HTTPS domain/cert/DNS is operator-supplied, not purchased or assumed by code. Public rollback stops only new route and retains local writes; active private jobs require drain before bridge shutdown. Original writable Pages stays source.

- Final: Ruling: unexecuted Linux/source/Worker/TLS/browser/GPU/provider gates remain explicit operator gates, not simulated completion — no credentials/domain or authorized live execution environment available — cost if wrong: real deployment can still reveal operational issues and must not be called complete.

- Final: Ruling: independent source/local writes and uncertain-step stop/no fallback remain approved behavior, not replication/automatic rollback — preserves newer data and private job isolation — cost if wrong: operator must resolve divergences manually.

- Final: Ruling: historical baseline validates frozen release metadata plus actual container/schema/checkpoint identity, instead of rehashing new source against old images — source intentionally changed — cost if wrong: altered frozen metadata must still be rejected by image/checkpoint/fingerprint checks.

## Deferred minors

无。
