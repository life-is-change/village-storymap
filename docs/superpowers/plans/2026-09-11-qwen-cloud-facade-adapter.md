# Qwen Cloud Facade Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, configurable Qwen-backed cloud rectification source that stores completed images in platform storage and stays disabled when unconfigured.

**Architecture:** The static generator invokes an authenticated Supabase Edge Function. The function owns the provider adapter, reads secrets server-side, validates photo ownership/context, submits or polls the Qwen task, downloads successful output immediately, and stores it in `facade-generation`; the browser receives only capability, task status, and signed artifact access.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Supabase Storage/Postgres, Qwen Image Edit HTTP API, browser JavaScript, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-11-workspace-and-facade-workflows-design.md`

## Global Constraints

- Never expose `DASHSCOPE_API_KEY` to HTML, browser JavaScript, database rows, URLs, or logs.
- The cloud source is disabled unless provider, model, and secret are valid.
- Only authenticated users who can access the photo's teaching-project/village/space context may submit it.
- Persist provider/model/attempt count/estimated cost, never the credential.
- Download provider output before its temporary URL expires and store it under an owner/run-scoped path.
- Default maximum successful outputs per logical task is 1; explicit regeneration creates a separately costed attempt.

---

### Task 1: Add cloud run persistence and access control

**Files:**
- Create: `supabase_SQL/Cloud Facade Provider Runs.sql`
- Create: `features/data/cloud-facade-provider-migration.test.js`

**Interfaces:**
- Produces table `public.facade_cloud_runs(id, owner_id, teaching_project_id, village_id, space_id, object_code, photo_id, provider, model, provider_task_id, status, attempt_count, estimated_cost_cny, artifact_path, error_code, error_message, created_at, updated_at)`.
- Status values: `submitted`, `running`, `succeeded`, `failed`, `canceled`.
- RLS: owner reads own rows; teacher/admin reads accessible course rows; browser cannot insert/update/delete directly.

- [ ] **Step 1: Write failing SQL contract tests**

Assert the table, status check, photo/context foreign keys, RLS, revoked authenticated mutations, owner/staff select policy, and owner/run indexes exist.

- [ ] **Step 2: Run and verify failure**

Run: `node --test features/data/cloud-facade-provider-migration.test.js`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Write the idempotent migration**

Use `create table if not exists`, `alter table ... add column if not exists`, explicit policies, and grants. Reuse `context_space_accessible(...)` for staff/context visibility.

- [ ] **Step 4: Run the migration contract test**

Run: `node --test features/data/cloud-facade-provider-migration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "supabase_SQL/Cloud Facade Provider Runs.sql" features/data/cloud-facade-provider-migration.test.js
git commit -m "feat: add secure cloud facade run storage"
```

### Task 2: Implement a pure Qwen provider adapter

**Files:**
- Create: `supabase/functions/facade-cloud/qwen-provider.ts`
- Create: `supabase/functions/facade-cloud/qwen-provider.test.ts`

**Interfaces:**
- Produces: `createQwenProvider({ apiKey, model, fetchImpl })`.
- Produces methods `submit({ imageUrl, prompt, size }): Promise<{ taskId: string }>` and `poll(taskId): Promise<{ status: "running" | "succeeded" | "failed"; outputUrl?: string; errorCode?: string; errorMessage?: string }>`.
- Authentication header: `Authorization: Bearer ${apiKey}`; async task header is set only server-side.

- [ ] **Step 1: Write failing mocked-fetch tests**

Verify submit request shape, task-id parsing, running/success/failure normalization, redacted error messages, and rejection when the key/model is absent.

- [ ] **Step 2: Run and verify failure**

Run: `deno test supabase/functions/facade-cloud/qwen-provider.test.ts`

Expected: FAIL because the provider module is absent.

- [ ] **Step 3: Implement the adapter**

Use injected `fetchImpl`; enforce HTTPS output URLs; return stable platform error codes `CLOUD_AUTH_FAILED`, `CLOUD_BALANCE_EXHAUSTED`, `CLOUD_RATE_LIMITED`, `CLOUD_CONTENT_REJECTED`, `CLOUD_PROVIDER_FAILED`, and `CLOUD_PROVIDER_TIMEOUT`.

- [ ] **Step 4: Run adapter tests**

Run: `deno test supabase/functions/facade-cloud/qwen-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/facade-cloud/qwen-provider.ts supabase/functions/facade-cloud/qwen-provider.test.ts
git commit -m "feat: add qwen facade provider adapter"
```

### Task 3: Implement the authenticated Edge Function

**Files:**
- Create: `supabase/functions/facade-cloud/index.ts`
- Create: `supabase/functions/facade-cloud/index.test.ts`
- Modify: `supabase_SQL/README.md`

**Interfaces:**
- Request: `{ action: "capabilities" }`, `{ action: "submit", photoId: number, prompt: string, size: "1024*1024" | "2048*2048" }`, or `{ action: "poll", runId: string }`.
- Response: `{ available, provider?, model? }` or `{ runId, status, attemptCount, estimatedCostCny, artifactPath?, errorCode?, errorMessage? }`.
- Secrets: `DASHSCOPE_API_KEY`, `FACADE_CLOUD_PROVIDER=qwen`, `FACADE_CLOUD_MODEL`, `FACADE_CLOUD_MAX_ATTEMPTS=1`, `FACADE_CLOUD_ESTIMATED_COST_CNY=0.20`.

- [ ] **Step 1: Write failing function tests**

Mock Supabase and provider calls. Cover anonymous rejection, unavailable capability, inaccessible photo rejection, submit persistence, owner-only polling, successful output download/storage, and no retry for auth/balance/content failures.

- [ ] **Step 2: Run and verify failure**

Run: `deno test supabase/functions/facade-cloud/index.test.ts`

Expected: FAIL because the function is absent.

- [ ] **Step 3: Implement capability and submit actions**

Read the bearer token, establish a user-scoped Supabase client for authorization, use a service-role client only after access checks, create a signed source-photo URL, submit Qwen, and insert the run record.

- [ ] **Step 4: Implement poll and artifact persistence**

Poll the provider task. On success, download the image with a byte limit and allowed MIME check, upload to `facade-generation/{owner_id}/{run_id}/cloud/standard-facade.{ext}`, and update the run atomically. Strip provider URLs and secrets from errors.

- [ ] **Step 5: Run function tests and document deployment**

Run: `deno test supabase/functions/facade-cloud/*.test.ts`

Expected: PASS.

Document migration order, `supabase secrets set ...`, and `supabase functions deploy facade-cloud` in `supabase_SQL/README.md`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/facade-cloud supabase_SQL/README.md
git commit -m "feat: add authenticated cloud facade function"
```

### Task 4: Add the browser cloud client and generator integration

**Files:**
- Create: `rural_house_generator/facade-cloud-client.js`
- Create: `rural_house_generator/facade-cloud-client.test.js`
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Produces: `createFacadeCloudClient(supabaseClient)` with `capabilities()`, `submit({ photoId, prompt, size })`, `poll(runId)`, and `createArtifactUrl(path, expiresIn=300)`.
- Consumes: opener Supabase client and `acceptStandardFacade(...)` from the source-redesign plan.

- [ ] **Step 1: Write failing client tests**

Test function invocation payloads, unavailable response, normalized errors, polling terminal states, signed artifact URL creation, and rejection of artifact paths outside the authenticated run result.

- [ ] **Step 2: Run and verify failure**

Run: `node --test rural_house_generator/facade-cloud-client.test.js rural_house_generator/tests/photo-workflow.test.js`

Expected: FAIL because the client and UI wiring are absent.

- [ ] **Step 3: Implement the client and load order**

Add the UMD client before module `app.js`. Keep credentials inside the Supabase session; never accept a provider key from DOM or query parameters.

- [ ] **Step 4: Integrate cloud capability, submit, and poll UI**

On startup query capabilities. Disable cloud selection with “管理员尚未启用” when unavailable. On submit show estimated per-attempt cost, poll with bounded backoff, map stable error codes to Chinese messages, and pass the signed successful artifact URL to `acceptStandardFacade`.

- [ ] **Step 5: Run generator tests and credential scan**

Run: `node --test rural_house_generator/*.test.js rural_house_generator/tests/*.test.js`

Run: `rg -n "DASHSCOPE_API_KEY|sk-[A-Za-z0-9]" index.html app.js rural_house_generator features`

Expected: tests PASS; scan finds no credential value or browser-side secret variable.

- [ ] **Step 6: Commit**

```bash
git add rural_house_generator/facade-cloud-client.js rural_house_generator/facade-cloud-client.test.js rural_house_generator/index.html rural_house_generator/app.js rural_house_generator/tests/photo-workflow.test.js
git commit -m "feat: connect generator to cloud facade provider"
```

### Task 5: Full verification and deployment readiness

**Files:**
- Modify only if failures expose defects in files already listed above.

**Interfaces:**
- Consumes all prior tasks.
- Produces a clean, deployable `learning` branch with the cloud feature safely disabled until secrets and migration are deployed.

- [ ] **Step 1: Run JavaScript suites**

Run: `node --test features/**/*.test.js rural_house_generator/*.test.js rural_house_generator/tests/*.test.js`

Expected: PASS.

- [ ] **Step 2: Run server tests**

Run: `python -m pytest server/tests rural_house_generator/backend/tests -q`

Expected: PASS.

- [ ] **Step 3: Run syntax and diff checks**

Run: `node --check app.js`

Run: `node --check rural_house_generator/app.js`

Run: `git diff --check`

Expected: all commands succeed.

- [ ] **Step 4: Verify disabled deployment state**

Without Supabase secrets, open the generator and confirm local/external modes work while cloud mode says “管理员尚未启用”. Apply the SQL and deploy the Edge Function only after the administrator supplies a valid DashScope key.

- [ ] **Step 5: Commit any final verified corrections**

```bash
git add -A
git commit -m "test: verify workspace and facade workflow redesign"
```

