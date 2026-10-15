# Business API Internal Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution or superpowers:subagent-driven-development if the user selects that method. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first internally testable Aliyun business API, with verified Supabase identities, local read-only business queries, real PostgreSQL permission tests and a guarded manual cloud deployment.

**Architecture:** Keep the live website, Supabase Auth and GPU channels unchanged. A small Node HTTP service validates user tokens with the existing Auth service, then queries a separate PostgreSQL candidate using transaction-local RLS identity. Deploy only to server loopback and test over SSH; no public business cutover occurs in this sub-project.

**Tech Stack:** Node.js 22 or later, native HTTP/fetch and Node test runner, node-postgres (`pg`, exact dependency/version locked when installed), PostgreSQL 17.6, Python standard-library deployment helpers and Docker Compose. Keep the API separate from the Python GPU workers and the root frontend package.

**Spec:** [Approved hybrid migration design](../specs/2026-10-15-hybrid-database-migration-design.md), especially delivery stage A. User approved the written design on 2026-10-15. This plan still awaits review and execution-method selection.

## Global Constraints

- Work in the original repository on `main`; check root, branch and status before edits. Preserve existing changes. Do not create a worktree or switch branches.
- Every code/SQL change follows local tests → GitHub main → user-run Aliyun deployment. Browser Workbench authority is not bypassed.
- “原 Supabase 保留”; “4090 的任务提交、处理状态和结果通道先保留在 Supabase.” No source SQL changes, queue consumer, task submission or source writes in this sub-project.
- “数据库密码和 Supabase service role 不进入静态前端.” Private backup, user tokens, passwords, logs and reports stay outside Git and the static web root; never print them to the terminal.
- “不能向浏览器提供任意 SQL、任意表/函数执行或超级用户连接.” Only the fixed routes below exist; no generic table/RPC gateway.
- “新 API 失败时显示错误，不静默将写入重试到另一数据库.” Stage A accepts no business mutations and changes no live frontend defaults.
- “生产候选采用独立持久化目录/卷，不能用恢复脚本覆盖成功副本”; “2 GB 机器默认仅运行一个数据库实例.” Preserve the successful copy and every failed target.
- Database ports remain unpublished. API accepts external requests only through a future HTTPS Nginx entry; stage A binds `127.0.0.1:18080` for SSH-tunnel tests.
- No frontend public switch until file migration, GPU dependency/authorization bridge, final data synchronization and application acceptance are complete in subsequent plans.

## Review Focus

1. Token has valid JSON claims but an invalid signature, expired/wrong issuer/audience, service-role identity or mismatched online user: reject before checking out a DB connection (Task 2).
2. A pooled connection previously served another student, or a request fails mid-transaction: roll back, clear identity and do not leak either student's rows (Task 3).
3. Restored grants/RLS are more permissive than expected, or a new Auth user has no matching local profile: fail closed; do not silently substitute source data or elevate access (Tasks 3–4).
4. Existing candidate, wrong container/image/mount, changed baseline, insufficient resources or unavailable image: preserve all data and refuse deployment before stopping/recreating anything (Task 5).
5. HTTP error/log output contains a token, connection string, profile value or SQL parameter, or a frontend error falls back to Supabase: redact consistently and fail visibly (Tasks 2, 4 and 6).

## Delivery boundary and later work

This plan implements stage A only. It does not claim that ordinary business writes or Storage files have migrated. Stage B will copy/classify files and implement authorized object access; stage C will adapt complete business modules, collaboration and GPU bridging; stage D will perform current-data handoff and public cutover. Each subsequent stage receives its own executable plan based on the approved overall design and preceding acceptance results.

## File structure and public contract

- `business-api/`: independent private npm package, locked dependencies, `src/` service modules, `test/` unit/integration tests and `test/fixtures/` synthetic data only.
- `features/data/business-api-client.js` and its `.test.js`: explicit read-only frontend adapter; no `app.js` wiring yet.
- `docs/migration/business-dependencies.md`: module/table/RPC/bucket/notification/GPU dependency audit, with source file references and unreviewed items marked as blocking cutover.
- `linux/sql/business-api-validation.sql`: additive candidate-only login role and validation checks. Never run against source Supabase or the successful copy.
- `linux/scripts/restore-db-copy.py`: retain default behaviour; add fixed validation-target selection instead of arbitrary user-provided Docker names.
- `linux/scripts/deploy-business-api-validation.py`, `linux/tests/test_business_api_deployment.py`, `linux/Dockerfile.business-api`, `linux/compose.business-api-validation.yaml`, `linux/README.business-api.md`: preflight, offline-capable image handoff, deployment and operator instructions.

Routes: `GET /healthz` returns only `{status:"ok"}`; `GET /api/v1/me` returns an allowlisted profile; `GET /api/v1/courses` returns visible course summaries; `GET /api/v1/spaces?kind=group|personal&limit=50&offset=0` returns visible spaces, and `GET /api/v1/spaces/{kind}/{id}` returns one visible space or 404. All `/api/v1` routes require authentication. `limit` is 1–100 and `offset` 0–10000; reject invalid/repeated/unknown parameters. Group IDs are bounded text (1–200 characters), personal IDs are UUIDs. Do not normalize case in existing IDs.

Response: `{data: value}` on success; `{error:{code,requestId}}` on failure. Use 400 invalid input, 401 invalid credentials, 404 absent/invisible resource, 405 known route with unsupported method, 409 `PROFILE_NOT_SYNCED`, 503 Auth/DB unavailable. Do not return raw upstream errors. All responses carrying business data use `Cache-Control: no-store`.

### Task 1: Record the dependency inventory and executable API contract

**Files:** Create `docs/migration/business-dependencies.md`, `business-api/package.json`, `business-api/package-lock.json`, `business-api/src/contracts.mjs`, `business-api/test/contracts.test.mjs`; update the spec status to approved.

**Interfaces:** `parseSpaceQuery(URLSearchParams) -> {kind,limit,offset}`; `parseSpaceId(kind:string,id:string) -> string`; `publicError(code:string,requestId:string) -> object`. Subsequent tasks use exactly these names and route/response values.

- [ ] Write `contracts.test.mjs`: defaults are group/50/0; limits 1 and 100 pass, 0/101/NaN/repeated parameters/unknown kind/extra fields fail; UUID and bounded group IDs preserve existing values. Errors expose only code and requestId.
- [ ] Run `node --test business-api/test/contracts.test.mjs`; verify failure for missing contracts.
- [ ] Audit `app.js`, `auth-system.js`, `features/{data,course,survey,models,admin,geoprocessing}/`, `3D_scenes_edit/persistence/scene-edit-client.js` and corresponding `supabase_SQL/` definitions. Record literal and dynamic calls separately, including old permissive course policies; do not claim a source-code scan proves the deployed schema.
- [ ] Implement contracts and initialize the independent package with `pg`; pin the actual resolved version in the lockfile. No framework, ORM, Redis, queue or worker dependency.
- [ ] Run contract tests and `git diff --check`, then commit the dependency contract and audit. No cloud actions.

### Task 2: Verify existing Supabase identities without requesting signing secrets

**Files:** Create `business-api/src/config.mjs`, `auth.mjs`, `errors.mjs`, `business-api/test/auth.test.mjs` and `config.test.mjs`.

**Interfaces:** `loadConfig(env) -> Config`; `createIdentityVerifier({authOrigin,publishableKey,fetchImpl,now}) -> verify(authorization:string) -> Promise<Identity>`. Identity contains verified `userId`, `issuer`, `audience`, `role:"authenticated"` and expiry; no app-level teacher/admin role comes from user metadata.

- [ ] Write failing tests for missing/oversized/ambiguous Bearer headers; invalid/missing expiry, subject UUID, issuer, authenticated audience/role; remote 401; timeout; online user ID mismatch; disabled user; injected role metadata; no token/URL/SQL value leakage in error or log output.
- [ ] Run `node --test business-api/test/auth.test.mjs business-api/test/config.test.mjs`; confirm missing implementation failures.
- [ ] Implement explicit online verification via the fixed project's HTTPS `GET /auth/v1/user`, using the public project key and the supplied user access token. Timeout 5 seconds, no redirects, no success cache and no automatic alternative verifier. Validate claims against the online authenticated result; decoding a JWT alone never establishes trust. Keep the URL fixed in configuration, not derived from token claims or request headers. Config uses `SUPABASE_AUTH_ORIGIN`, `SUPABASE_PUBLISHABLE_KEY`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD_FILE` and `PORT`; required secret files must be private and cannot be default/example credentials.
- [ ] Reject expired/wrong-project/wrong-audience/non-user tokens and locally missing profiles. Honor upstream revoked/disabled-user rejection and explicit suspension fields; do not claim immediate token revocation based solely on signature/expiry. No local suspension column is invented in `profiles`. Before production, stage C must define and test the application's revocation contract. Remote auth failure rejects the request; upstream outage returns 503, not a misleading password error. Stage A deliberately retains an Auth network request; record it separately in timing data and make no latency-improvement claim.
- [ ] Run auth/config tests, verify a forged token never reaches the repository stub, then commit. Do not change source signing keys or ask the user to send keys/passwords in chat.

### Task 3: Query the candidate database with transaction-local RLS identity

**Files:** Create `business-api/src/database.mjs`, `repository.mjs`, `business-api/test/database.test.mjs`, `repository.test.mjs`, `integration.test.mjs`, `test/fixtures/identity.sql`; create `linux/sql/business-api-validation.sql`.

**Interfaces:** `createDatabase(config) -> {withIdentity(identity,fn),close()}`; `withIdentity` passes one checked-out pg client to `fn` and always finalizes/releases it. Repository methods: `getMe(client,userId)`, `listCourses(client)`, `listSpaces(client,query,userId)`, `getSpace(client,kind,id,userId)`.

- [ ] Write failing tests: same connection reused by students A/B; rollback after a failing query; no queries after rollback failure/release; parameterized IDs; only SELECT statements; explicit identity filter on personal ownership and profile ID; no selection of group join codes or auth data; missing profile returns `PROFILE_NOT_SYNCED`.
- [ ] Run the database/repository unit tests and verify they fail for missing implementation.
- [ ] Implement pool size 4, connection timeout 3 seconds, transaction-local statement timeout 5 seconds and `BEGIN READ ONLY`. Set the verified claims using `set_config(...,true)` on the same client, and `SET LOCAL ROLE authenticated`; fixed SQL only. Rollback on every failure, and discard the connection if rollback fails.
- [ ] Add candidate-only role `village_api_login` with LOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB and NOCREATEROLE; membership permitting only `SET ROLE authenticated`. Set its random password privately during deployment, never in committed SQL. Assert role safety, source table RLS, required grants and `auth.uid()`/role helpers; fail on incompatible actual policies rather than granting ALL or changing source SQL.
- [ ] Use explicit column lists: me = id/student_id/display_name/role/gender/class_name/grade; courses = id/title/village_id; group spaces = id/title/course_id/group_id/space_type/teaching_project_id/village_id; personal spaces = id/title/owner_id/course_id/village_id/space_type. Verify actual restored column names before serving; never use SELECT * as a compatibility fallback. Preserve authorization through RLS plus explicit personal-owner predicates.
- [ ] Implement synthetic real-PG tests for A/B private spaces, nonmember group access, member access, teacher/admin scope, metadata role spoofing, missing profile, and privilege reset after failure. Run `npm --prefix business-api run test:integration` only against an explicitly named disposable test database; never default to source/production. Candidate checks use the existing deployed policy definitions; synthetic fixture policies alone do not establish compatibility.
- [ ] Run all API unit tests and the real-PG suite; unavailable real PG is recorded as pending, never silently passed. Commit the transaction/repository implementation and permission evidence.

### Task 4: Expose only fixed read routes and an opt-in frontend adapter

**Files:** Create `business-api/src/http.mjs`, `main.mjs`, `business-api/test/http.test.mjs`, `features/data/business-api-client.js` and `business-api-client.test.js`.

**Interfaces:** `createHandler({verifyIdentity,database,repository,requestId}) -> HTTP handler`; `createBusinessApiClient({baseUrl,getAccessToken,fetchImpl}) -> {getMe,listCourses,listSpaces,getSpace}`. The client only sends user access tokens to its configured same-origin endpoint or explicit loopback test endpoint; forbid arbitrary remote destinations.

- [ ] Write failing HTTP tests for every fixed route, missing auth, cross-user lookups returning 404, invalid query parameters, all mutation methods returning 405, unknown table/RPC/admin/queue paths returning 404, upstream failure redaction, request IDs and no-store headers.
- [ ] Write adapter tests proving it reads the current token for each request, handles 401/409/503 explicitly, never writes tokens to storage/logs and never falls back to Supabase. Leave `app.js`, its global client and all live default routes unchanged.
- [ ] Run the HTTP and frontend adapter tests and verify missing implementation failures.
- [ ] Implement HTTP routing, shutdown/pool cleanup, bounded headers/URLs, 30-second request timeout and aggregate stage timings without tokens or row values. Listen on configured container port 8080; deployment controls loopback exposure. No wildcard CORS, arbitrary SQL endpoint or request-body logging.
- [ ] Run API unit tests and `npm test` at repository root; compare unrelated failures with baseline before attributing them to the migration. Commit the internal API and opt-in client.

### Task 5: Build and deploy a separate candidate without resetting the verified copy

**Files:** Modify `linux/scripts/restore-db-copy.py` and `linux/tests/test_database_restore.py`; create `linux/scripts/deploy-business-api-validation.py`, `linux/tests/test_business_api_deployment.py`, `linux/Dockerfile.business-api`, `linux/compose.business-api-validation.yaml` and `linux/README.business-api.md`.

**Interfaces:** Restore CLI adds only `--target-profile copy|api-validation`, default `copy`; fixed presets retain current copy names and define candidate project `village-api-validation`, DB container `village-api-validation-postgres`, API container `village-api-validation-api` and private state `~/village-api-validation`. Deploy helper has `--check`, `--deploy`, `--stop`; `--check` is the default and does not stop/create containers or download images. No arbitrary Docker host/container selector.

- [ ] Write failing tests for default copy compatibility, existing candidate refusal, state/backup/web overlap, wrong baseline report/container/mount/image, symlinks, private file permissions, low memory/disk, unavailable local image, and failed preflight leaving the baseline running. Inspect generated Compose: no DB ports, internal DB network, API-only egress for Auth, loopback API binding, no Docker socket/root credentials in API, persistent separate data directory and API memory cap 192 MiB.
- [ ] Run new deployment tests and existing restore tests; confirm missing functionality fails without weakening the 58-test Linux baseline.
- [ ] Introduce immutable fixed restore-target configuration and pass it through existing restore/validation operations; maintain all existing hash, rollback, log and overwrite guards. Candidate restores the verified private archive into its own state initially with network none. Never rerun restoration over a completed copy/candidate.
- [ ] Build the API image reproducibly using `npm ci --omit=dev`, a pinned Node runtime image digest and a non-root user. Inspect image architecture as linux/amd64, smoke-test it and record transfer SHA-256. If server registries remain unreachable, produce a Docker save archive on a reachable authorized machine; use the already proven private upload/load workflow, not third-party mirrors or unverified tarballs. Do not make an actual target image an untested assumption in the README.
- [ ] Implement preflight to check baseline success report, identity and resources before mutation; require 4 GiB free disk and 900 MiB available memory before running the candidate restore. When the only reason for low available memory is the running validation DB, verify and stop that exact DB, set its restart policy to no, then recheck memory. Preserve its data/Compose/report and record original restart policy. Do not stop web/GPU containers or use `down -v`. A failed deployment retains the candidate and reports whether the baseline is stopped; operator recovery refuses to start both DBs and documents safe candidate-stop/baseline-start order.
- [ ] After isolated restore succeeds, recreate only the candidate DB with the same candidate data and an internal network. Restrict pg_hba to SCRAM for `village_api_login` on its candidate network; other host logins are rejected, Unix management remains private. Install candidate SQL in one transaction via local Docker exec. Mount only API login credentials into the API, not bootstrap credentials or the database backup. Keep the database without an external network and give only API its separate Auth egress network.
- [ ] Validate Compose and candidate preflight, run Linux tests and a disposable local compose smoke test when Docker is available. Record cloud execution as pending until the user runs it; commit and push the reviewed implementation to GitHub main. Supply exact server commands and image/file handoff paths in README only after they exist.

### Task 6: Perform actual cloud acceptance and retain the cutover boundary

**Files:** Create `linux/scripts/verify-business-api-candidate.py`, `linux/scripts/probe-business-api.py`, `linux/tests/test_business_api_probe.py` and `linux/tests/test_business_api_candidate.py`; update `linux/README.business-api.md`, this plan and the migration ledger with actual results.

**Interfaces:** `verify-business-api-candidate.py` checks candidate identity/schema/roles, then executes a single synthetic SQL test transaction via local Docker exec/psql and rolls it back; bootstrap credentials and Docker access are never given to the API container. Python probe accepts a loopback API URL only, asks for student ID and website password via terminal/getpass, obtains an access token directly over fixed-project verified HTTPS, calls read routes and prints counts/status/timings only. No plaintext credential file, shell credential argument, website mutation or token output.

- [ ] Write failing tests for probe URL restrictions, hidden credential input, upstream TLS failures, timeout, secret/profile redaction and no final success marker after any failed acceptance step. Probe must distinguish website password from database password.
- [ ] Run probe/candidate unit tests; implement the probe and candidate verification script. Candidate synthetic fixtures use explicit test IDs without advancing application sequences, stay transaction-bound and are rolled back on success or failure. Source Auth accounts are not created or modified. Do not assume Node is installed on the Ubuntu host; management helpers use Python and the database container's own psql.
- [ ] Prepare exact user handoff: inspect clean main, pull the known commit, load the verified API image if required, run deployment `--check`, then `--deploy`. User runs cloud commands manually. Do not provide a destructive replacement command if state checks fail.
- [ ] User runs actual candidate checks, SSH tunnel and hidden-input probe. Verify real-PG authorization, Auth identity, fixed read endpoints, unavailable-service behaviour, restart persistence, container memory/CPU and route timing. Capture counts/status and private report paths, not tokens/private rows. Do not claim speedup from local DB timings while online Auth remains in the path.
- [ ] Emit `BUSINESS_API_INTERNAL_VALIDATED_NOT_CUT_OVER` only after actual cloud checks pass. Update records with commit/image IDs and observed resources. Public website, storage URLs, GPU workers and source DB still retain their current endpoints.
- [ ] Stop at stage A acceptance. Stage B file migration and stage C business writes/bridge remain explicitly pending and receive separate plans; no global Supabase URL replacement or source cleanup.

## Verification and self-review

- Spec stage A maps to Tasks 1–6; stages B/C/D remain in the approved design and are deliberately not claimed by this plan.
- Five Review Focus items each map to named failing-test steps; no tests connect to source DB or mutate source Auth/Storage.
- Root frontend test discovery already covers `features/data/*.test.js`; API tests stay in the independent package. Add dedicated npm `test:unit`/`test:integration` commands without weakening existing `npm test`.
- Review implementation dependencies and exact image digests against official sources at implementation time; package installation and image build are not performed while this plan awaits review.
- Self-review corrected the candidate resource ordering: initial restore needs 900 MiB after the baseline is safely stopped, and a failed preflight must not stop the baseline. A later failure reports the retained stopped/running state instead of auto-starting a second DB.
- Cloud acceptance, any source write-freeze and public HTTPS configuration are later user-run actions, not local unit-test results.

## References checked for the plan

- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts): JWT decoding is not verification; JWKS can be empty for symmetric signing. Public JWKS inspection was unavailable through the web tool, so no project signing algorithm is assumed.
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser): online Auth verification is an explicit stage A compatibility choice; it uses the original service rather than transferring signing secrets.
- [node-postgres transactions](https://node-postgres.com/features/transactions): all statements in one transaction use the same checked-out client, never independent pool queries.
