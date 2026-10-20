# Autonomous Aliyun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver one independently authenticated Aliyun platform, including local files and GPU task control, while preserving the original Pages/Supabase environment.

**Architecture:** Keep the existing fixed-operation API, private file store and four-connection business pool. Add standalone pinned Supabase Auth, a separate executable local queue, and explicitly configured outbound Worker gateways. Serve Auth/API/site through the same HTTPS IP origin; deliver one coordinated release rather than asking the operator to deploy each feature separately.

**Tech Stack:** Node 22, PostgreSQL 17/PostGIS, Supabase Auth (GoTrue), Python 3.10/3.11 Workers, Nginx, Certbot 5.4+, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-20-aliyun-local-task-system-design.md`

## Global Constraints

- Work in the original project directory on `main`; preserve existing changes and old ledgers; no worktree creation.
- Source Auth, business data, Storage and queues remain unchanged. Source frontend configuration remains the default for Pages.
- Preserve UUID, password hashes, student synthetic-email mapping and ownership; reject old source tokens and sessions in autonomous mode.
- No custom password hashing or token issuer; use a pinned mature Auth service. Never output passwords, hashes, tokens or private rows.
- Target public origin is exactly `https://8.148.248.237`; HTTP credentials and disabled TLS validation are forbidden.
- Initial local executable queue is empty. Restored source jobs are history, not runnable inputs.
- Reuse four business DB connections; Auth has its own bounded pool. Measure actual whole-host capacity before acceptance.
- No local PostgreSQL startup/install: native database/Auth runtime integration runs only in disposable GitHub CI containers.
- No Workbench remote-control retry; the user manually operates Aliyun and the campus Linux Worker.
- No real paid provider jobs or GPU jobs from automated tests. Keep model/data mounts, GPU locking, sister's 8081 and unrelated services intact.
- New release replaces the old bridge handoff, not its immutable archives. Completion requires actual operator evidence, not just test markers.

## Review Focus

1. A valid original-site JWT with the same user UUID must fail locally before any source request; test Task 1.
2. Replayed signup/profile initialization must never synthesize an incomplete Auth user or grant metadata roles; test Task 3.
3. A lost claim/upload/complete response followed by lease expiry must not duplicate work or overwrite another attempt; test Tasks 5–6.
4. A 2D photo replaced/deleted during facade processing must not change the immutable task input; test Task 6.
5. Failed ACME renewal, interrupted deployment or an exhausted 2GB host must retain a working old site and private data; test Tasks 9–10.

## File and interface map

- `business-api/auth/policy.mjs`: immutable source/local issuer and internal endpoint policy, consumed by verifier/config/database/identity.
- `business-api/auth/local-identity.mjs`: local profile projection and session-revocation check; no source REST client.
- `features/auth/deployment-auth-client.js`: deployment-scoped SDK construction; consumed by auth-system/app/admin after deployment-mode.
- `linux/auth-runtime.json`, `linux/sql/local-auth.sql`, `linux/scripts/prepare-local-auth.py`: pinned service/schema compatibility and private configuration; refuse unknown migrations/OAuth/MFA until explicitly supported.
- `business-api/auth/recovery.mjs`, `linux/scripts/reset-local-password.py`: administrator reauthentication, bounded recovery, audit and session revocation.
- `business-api/local-tasks/{contracts,database,http,service,worker-auth}.mjs`, `linux/sql/local-tasks.sql`: separate queue, identity-bound receipts, lease and Worker protocol.
- `business-api/local-tasks/files.mjs`: immutable inputs, streamed results, fixed file-ID authorization.
- `server/src/village_processing/queue/local_gateway.py`, `facade/local_gateway.py`: pipeline-compatible gateways; explicit backend selection in entrypoint/settings.
- `business-api/local-tasks/cloud-facade.mjs`: provider control with durable submission receipt; never retry ambiguous billing.
- `linux/scripts/prepare-ip-tls.py`, `linux/nginx.autonomous.conf`: IP ACME and same-origin proxy; Certbot deployment/renewal hooks.
- `linux/scripts/deploy-autonomous.py`, `linux/compose.autonomous.yaml`, `linux/autonomous-release.json`: coordinated candidate deployment and immutable release proof.
- `docs/migration/2026-10-20-autonomous-handoff.md`: final operator package and one whole-flow acceptance checklist.

### Task 1: Explicit local authentication trust policy

**Files:** Create `business-api/auth/policy.mjs`, `business-api/test/local-auth.test.mjs`; modify `business-api/src/auth.mjs`, `business-api/unified/{config,database,identity,services}.mjs`.

**Interfaces:** `resolveAuthPolicy(config) -> {mode,issuer,userEndpoint,profileMode}`; source compatibility defaults unchanged. Local public origin fixed to approved IP, internal GoTrue endpoint fixed to `http://auth:9999`, public issuer `/auth/v1`. `createUnifiedDatabase(config, {authPolicy})` and `createIdentityService({... ,authPolicy})` enforce the same policy. Verified identity contains only user ID, issuer, audience, expiry and an opaque session ID where applicable.

- [x] Write `local_auth_rejects_source_issuer_before_fetch`, `local_auth_only_calls_internal_user_endpoint`, `local_config_forbids_source_bridge_and_inline_secrets`, `database_rejects_cross_site_identity`; assert no source fetch, redirects or bearer leakage.
- [x] Run `node --test business-api/test/local-auth.test.mjs`; observe missing-policy/unsupported-local-mode failures.
- [x] Implement explicit policy; preserve old source mode. Enforce online local Auth proof plus local session/user status rather than decode-only trust.
- [x] Run API unit suite and local-auth tests; all pass, including original source tests.
- [x] Commit `feat: isolate autonomous Aliyun authentication trust`.

### Task 2: Deployment-scoped frontend Auth clients

**Files:** Create `features/auth/deployment-auth-client.js` and its test; modify deployment-mode, auth-system, app/admin and their HTML script order; extend stage-web and browser tests.

**Interfaces:** `resolveAuthClientOptions(deployment,origin) -> {url,key,options}`; `createDeploymentAuthClient({sdk,config,origin}) -> SDK client`. Local config includes versioned Auth mode, public anon key, `/auth/v1` and session namespace bound to instance. Synthetic student email stays identical to preserve login mapping; domain is an identifier, not a network destination.

- [x] Test source SDK URL/options unchanged, local same-origin requests/storage isolation, local malformed/missing settings fail closed, and homepage/iframe/app/admin share one local namespace.
- [x] Run frontend tests to observe failure before wiring new module.
- [x] Implement centralized factory and immutable config validation; no URL/localStorage origin override or source fallback.
- [x] Run frontend suite plus actual staged index/admin browser smoke; block original Supabase in local-mode smoke.
- [x] Commit `feat: bind frontend sessions to the deployed Auth service`.

### Task 3: Pinned GoTrue compatibility and real local account provisioning

**Files:** Create Auth runtime manifest, compatibility script, local-auth SQL, `business-api/auth/local-identity.mjs`, native Auth integration test and CI Auth service step; modify identity gateway/service.

**Interfaces:** `inspect_auth_snapshot(backup_dir) -> compatibility_report` contains only schema versions/counts/feature flags, never hashes or user rows. Fixed GoTrue digest has migrations checked against snapshot. `readLocalProfile(identity)` uses authenticated local Auth proof metadata only after verifying real user/email and synthetic student mapping. `api_private.ensure_local_profile(uuid,jsonb)` requires a real Auth row and forces `student`; never inserts Auth anchors.

- [x] Test real GoTrue fixture: bcrypt password from imported user works; signup creates real identity/user/profile, duplicate/parallel initialization stays one account; untrusted metadata role ignored; logout/session deletion and source token fail. Unsupported schema/MFA/OAuth aborts with safe diagnostics.
- [x] Run unit checks locally and native test in disposable CI; capture initial failure without starting local Postgres.
- [x] Pin verified image/version, separate migration owner from runtime role, bound Auth pool; strip copied sessions/tokens only in the new isolated candidate. Preserve UUID/hashes and source snapshot.
- [x] Verify real GoTrue against generated/imported schema in CI; user-password compatibility remains a cloud acceptance gate until actual hidden-input login.
- [x] Commit `feat: provision independent local accounts with pinned Auth`.

### Task 4: Controlled password recovery and account disable

**Files:** Create `business-api/auth/recovery.mjs`, `recovery-cli.mjs`, `linux/sql/local-auth-recovery.sql` and tests; extend admin disable path to revoke local sessions. The host wrapper `linux/scripts/reset-local-password.py` consumes Task 9's verified deployment metadata and is delivered with that task.

**Interfaces:** Hidden-input private CLI authenticates admin against local GoTrue, then requests a one-use recovery reservation for a non-admin target UUID/student ID. There is no public recovery HTTP endpoint; the ephemeral command rechecks active admin/password, fixed internal Auth endpoint, three new actions/hour, 30-second spacing and audit. Provider admin credentials remain server-only and are not mounted into the ordinary API. Reset updates password through mature Auth admin API, keeps UUID and revokes target sessions; no synthetic-email delivery claim. Pending/unknown reset blocks target business sessions; reconciliation uses the new password with GoTrue without granting business access. Administrator break-glass recovery is outside this command.

- [ ] Test non-admin/disabled/stale reauthentication, target substitution, concurrent/replayed actions, rate cap, partial failure recovery and old-session rejection without logging secrets.
- [ ] Run tests RED, implement bounded state machine and admin adapter, run GREEN and existing identity suite.
- [ ] Commit `feat: add audited local account recovery and revocation`.

### Task 5: Local task queues and Worker identities

**Files:** Create local-tasks contracts/database/service/worker-auth/http, SQL and native queue integration tests; adapt unified task selection and frontend adapters.

**Interfaces:** `submit(identity,kind,input,requestId)`, `claim(worker,kind,requestId)`, `renew(worker,runId,leaseToken)`, `update(worker,runId,leaseToken,patch)`, `complete(...)`, `cancel(identity,...)`, `retry(identity,...)`. Queue rows are separate from copied source tables, credentials hashed and kind-scoped, claim uses SKIP LOCKED. HTTP is fixed `/api/worker/v1/...`; browser API keeps existing fixed operations and return contracts.

- [ ] Native tests for empty restored queue, concurrent claim uniqueness, identity/context/input receipt conflicts, lost acknowledgement, stale leases, capped retry/backoff, cancelled completion and credential revocation; browser token never gains Worker permission.
- [ ] Run RED; implement queue/lease transitions and outbox events; run GREEN in CI plus fixed-operation tests.
- [ ] Commit `feat: run GPU task control in the local database`.

### Task 6: Local task files, results and import consistency

**Files:** Create local-tasks files module and tests; extend existing private stores/task-files/import SQL, facade photo resolver and source/result metadata adapters.

**Interfaces:** Task input snapshots use local file ID/hash/size/type and never arbitrary URL. `openInput(worker,runId,leaseToken,fileId)` and bounded result upload session/commit are lease-authorized; `importResult(identity,runId,artifactHash,targetSpace,requestId)` is idempotent. Reference protection retains inputs during active/history use.

- [ ] Test photo replacement/deletion, interrupted/ranged reads, >50MiB real-supported result handling with explicit per-kind limits and streaming, wrong digest, expired lease commit, duplicated import and cross-space access.
- [ ] Run RED; reuse bounded file store and atomic commit, then GREEN with file/scene/task regressions and native permission tests.
- [ ] Commit `feat: keep task input and result files in the local ownership domain`.

### Task 7: Explicit outbound Linux Worker gateways

**Files:** Create queue/local_gateway.py and facade/local_gateway.py, shared HTTPS client; modify settings/entrypoint, GPU Compose overlay and Worker protocol tests.

**Interfaces:** New gateway matches each existing pipeline gateway method; `VILLAGE_TASK_BACKEND=aliyun` selects approved HTTPS IP with per-kind private credential. Default source mode remains unchanged. HTTP client validates TLS and fixed relative paths, streams/hash-checks files, renews leases and never automatically falls back.

- [ ] Synthetic HTTP tests cover both pipeline method contracts, lost response retry, cancellation/lease loss, malformed server URLs, TLS errors, stale upload and no source client construction in local mode.
- [ ] Run RED; implement adapters only, preserving pipelines/models/GPU locks and egress networks; run Worker suite GREEN.
- [ ] Commit `feat: let campus GPU workers consume Aliyun queues over HTTPS`.

### Task 8: Local cloud-facade provider control

**Files:** Create cloud-facade adapter and tests; wire existing provider selector/status/rectification/crop/version frontend contracts to local task state.

**Interfaces:** `submitProvider(run)` records intent before billing, persists provider ID, polls boundedly and streams outputs locally. Unknown submit response enters manual reconciliation; no blind paid resubmission. Secrets are server-only files, provider host allowlisted.

- [ ] Test unknown acknowledgement, repeated submit, cancellation after provider acceptance, provider errors/oversized output/URL substitution and output ownership; use fixtures only.
- [ ] Run RED; implement then GREEN with frontend facade flow regressions.
- [ ] Commit `feat: manage optional facade provider jobs from Aliyun`.

### Task 9: HTTPS IP, full copy and coordinated deployment

**Files:** Create IP TLS helper, autonomous Nginx/Compose/deployer, full-copy and backup adapters, unit tests; preserve old cutover script as legacy.

**Interfaces:** `prepare-ip-tls.py --check|--staging|--issue|--renew-test`; Certbot 5.4+ webroot, fixed IP SAN, atomic cert install and tested reload hook. `deploy-autonomous.py --check|--deploy|--verify|--apply` resumes private checkpoints, exact image/hash labels and Auth schema proof; no automatic source mutations or data rollback.

- [ ] Test invalid IP/SAN/issuer, failed certificate or reload, old site preservation, image mismatch, unsupported Auth schema, disk budget, interrupted copy, file inventory growth, restart, retained candidate and explicit stop-only allowlist for obsolete containers.
- [ ] Run RED; implement fixed same-origin Auth proxy/ACME route and guarded handoff; run GREEN. Copy all relevant objects including the previous 114 exclusions, fresh consistent snapshot and Auth compatibility report; do not mark files complete from metadata alone.
- [ ] Validate Compose/Nginx/TLS renewal in disposable CI; resource/CA access on real host remains operator gate.
- [ ] Commit `feat: deploy and back up an autonomous HTTPS IP platform`.

### Task 10: Unified acceptance, release package and final review

**Files:** Extend native/browser/Worker CI tests, add autonomous acceptance tool, release manifest and final handoff.

**Interfaces:** Release package includes exact runtime commit/digests/CI evidence, API/Auth/Worker artifacts and immutable source defaults; private input bundle created only with hidden operator secrets. Acceptance emits separate synthetic/cloud/GPU/provider status, never a blanket success before actual evidence.

- [ ] Test source-blocked local login/signup/refresh/logout/disable/reset, user ownership, 2D→facade→3D, geo→import, scene/version/restart; test concurrency 1/5/10/20 and resource-bound failure reporting. Synthetic jobs do not claim actual ML output quality.
- [ ] Run all appropriate tests once; obtain fresh whole-change review, fix important findings with RED→GREEN regression, retain private ledgers.
- [ ] Build immutable archives, verify hash/platform/runtime/CI against exact commit; push unified change through authorized main workflow, avoid per-module deployment requests.
- [ ] Document one Aliyun flow then controlled two-Worker switch and one actual whole-flow checklist; remaining actual passwords/CA/GPU work clearly pending. Commit release proof after successful CI.

## Preflight evidence and execution authorization

2026-10-20 21:18 Shanghai operator output: old public web healthy on port 80; no listener on 443. Aliyun repository `66b8110` (no fetch yet). OS-visible memory 1.6GiB, available 778MiB, no swap; disk available 30GiB. This is a baseline, not load acceptance.

The user approved the architecture and explicitly authorized starting implementation. Preserve the previously chosen inline execution and unified delivery. This plan is available for review during execution; no additional approval loop for already authorized local work. Actual destructive/paid/external operations still use the concrete controls above.

Self-review: every design section maps to Tasks 1–10; shared policy/SDK/queue/file interfaces named once and consumed consistently. Real Auth compatibility, full storage bytes, IP CA access and real GPU acceptance remain measured gates, not assumptions. Independent subsystem commits do not imply separate operator deployments.
