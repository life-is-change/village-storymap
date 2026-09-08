# Teaching Project Practice Catalog and Village Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every published practice village available to the current semester project, support successive semester projects, and add safe village archive/restore/delete controls.

**Architecture:** Keep `practice_village_id` as the backward-compatible default while deriving the accessible practice catalog from all published practice villages. Add one idempotent SQL migration for project lifecycle and village lifecycle RPCs, then adapt the shared model/client and the existing administrator controller so the homepage and workspace consume the same server context. Permanent deletion remains a two-stage Storage-plus-database operation and is permitted only after server-side usage checks.

**Tech Stack:** PostgreSQL/PostGIS/Supabase RLS and RPC, Supabase Storage JS, browser JavaScript, React/Vite homepage, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-teaching-project-practice-catalog-village-lifecycle-design.md`

## Global Constraints

- Do not commit or push Git changes; the user requested workspace-only documents and implementation until a later explicit backup request.
- Preserve all existing user changes and unrelated untracked planning documents.
- Keep exactly one non-completed/non-archived teaching project active globally.
- All published, non-archived practice villages are available to the current project.
- Keep 米埗村 as the protected default practice village.
- Never cascade-delete student or teaching成果.
- Use a clearly named, repeatable SQL migration; do not create an `Untitled query` file.
- Do not apply the new migration to the remote Supabase project without a fresh deployment checkpoint.

---

### Task 1: Database Contract for Semester Projects and Village Lifecycle

**Files:**
- Create: `supabase_SQL/Teaching Project Practice Catalog and Village Lifecycle.sql`
- Create: `features/data/teaching-project-village-lifecycle-migration.test.js`

**Interfaces:**
- Produces: `get_active_project_context()`, `ensure_all_project_practice_spaces(uuid)`, `archive_teaching_project(uuid)`, `get_village_removal_preview(uuid)`, `archive_village(uuid)`, `restore_village(uuid)`, and `delete_unused_village(uuid)`.
- Preserves: existing `create_teaching_project(text,text,uuid)`, `publish_village_dataset(uuid)`, and `ensure_context_space(uuid,uuid,text,text,text)` signatures.

- [ ] **Step 1: Write the failing migration contract tests**

Create tests that load the named migration and independently assert these contracts:

```js
test("同一课程允许多个学期项目但仍只有一个当前项目", () => {
  assert.match(sql, /drop constraint if exists teaching_projects_course_id_key/i);
  assert.match(sql, /create index if not exists teaching_projects_course_id_idx/i);
  assert.match(sql, /teaching_projects_one_current_idx/i);
});

test("当前上下文包含全部已发布练习村和当前正式村", () => {
  assert.match(sql, /village\.is_practice[\s\S]*village\.status\s*=\s*'published'/i);
  assert.match(sql, /project\.formal_village_id/i);
});

test("村庄生命周期RPC受管理员权限和二次使用检查保护", () => {
  for (const name of ["get_village_removal_preview", "archive_village", "restore_village", "delete_unused_village"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`, "i"));
  }
  assert.match(sql, /SYSTEM_VILLAGE_PROTECTED/i);
  assert.match(sql, /VILLAGE_IN_USE/i);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test features/data/teaching-project-village-lifecycle-migration.test.js`

Expected: FAIL because the named migration does not exist or lacks the required contracts.

- [ ] **Step 3: Implement the idempotent migration**

The migration must:

```sql
begin;
alter table public.teaching_projects drop constraint if exists teaching_projects_course_id_key;
create index if not exists teaching_projects_course_id_idx on public.teaching_projects(course_id);
```

Then replace the affected functions, backfill `practice_shared` spaces for the current project, add administrator-only lifecycle RPCs, revoke default execution, grant only to `authenticated`, and finish with `commit;`.

`delete_unused_village` must recalculate usage inside the transaction, reject the protected 米埗 UUID/name, reject any `teaching_projects` or course-data reference, and only delete administrator-prepared dataset/reality rows plus the village. It must not use `cascade` against teaching成果 tables.

- [ ] **Step 4: Run migration contract tests and related security tests**

Run:

```powershell
node --test features/data/teaching-project-village-lifecycle-migration.test.js features/data/multi-village-security.test.js features/data/multi-village-repair-migration.test.js
```

Expected: PASS with zero failures.

---

### Task 2: Shared Multi-Practice Context Model and Client

**Files:**
- Modify: `features/villages/village-model.js`
- Modify: `features/villages/village-model.test.js`
- Modify: `features/villages/village-client.js`
- Modify: `features/villages/village-client.test.js`
- Modify: `features/integration/multi-village-flow.test.js`

**Interfaces:**
- Consumes: the expanded `get_active_project_context()` payload.
- Produces: `buildProjectEntries()` and `buildHomepageProjectVillages()` containing all published practice villages plus the current formal village.
- Produces client methods: `archiveTeachingProject`, `getVillageRemovalPreview`, `archiveVillage`, `restoreVillage`, and `deleteUnusedVillage`.

- [ ] **Step 1: Write failing model tests for multiple practice villages**

Add literal fixtures containing 米埗村, 红星村, one archived practice village, and one formal village. Assert:

```js
assert.deepEqual(entries.map((item) => item.villageName), ["正式村", "米埗村", "红星村"]);
assert.deepEqual(home.map((item) => item.name), ["米埗村", "红星村", "正式村"]);
```

Also assert archived/draft practice villages are absent and that default practice ordering remains stable.

- [ ] **Step 2: Write failing client tests**

Use a complete fake RPC payload with two published practice villages. Assert `getActiveContext()` preserves both rather than filtering by `practiceVillageId`, and assert each lifecycle method calls its exact RPC argument contract.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test features/villages/village-model.test.js features/villages/village-client.test.js features/integration/multi-village-flow.test.js
```

Expected: FAIL because the second practice village is filtered and lifecycle methods do not exist.

- [ ] **Step 4: Implement the minimal shared model/client changes**

- Use the RPC-provided village list as the authoritative project catalog.
- Include every `isPractice && status === "published"` village.
- Include the formal village only when `formalProjectOpen` and the ID matches.
- Keep formal first in the workspace only if that is the current established order; keep default practice first on the homepage.
- Add thin validated lifecycle RPC client methods.

- [ ] **Step 5: Re-run focused tests**

Expected: all focused tests PASS.

---

### Task 3: Teaching Project Lifecycle in the Administrator Page

**Files:**
- Modify: `admin.html`
- Modify: `admin.css`
- Modify: `features/admin/village-admin.js`
- Modify: `features/admin/village-admin.test.js`
- Modify: `admin.js`

**Interfaces:**
- Consumes: `client.archiveTeachingProject()` and existing `client.createTeachingProject()`.
- Produces: a project card, archive action, and next-semester creation form inside the existing village/project administrator tab.

- [ ] **Step 1: Write failing controller tests**

Add tests proving:

```js
await controller.archiveTeachingProject("p1");
assert.deepEqual(calls.at(-1), { name: "archiveTeachingProject", input: { teachingProjectId: "p1" } });

await controller.createTeachingProject({ name: "2027 春季村庄规划课程", courseId: "village-planning", practiceVillageId: "mibu" });
assert.equal(calls.at(-1).name, "createTeachingProject");
```

Also assert cancellation makes no RPC call and that project creation is not offered while an active project exists.

- [ ] **Step 2: Run administrator tests and verify RED**

Run: `node --test features/admin/village-admin.test.js`

Expected: FAIL because the lifecycle controller methods are missing.

- [ ] **Step 3: Implement controller behavior and compact UI**

- Add an independent “教学项目” card above the existing three-step village workflow.
- Show active project fields and one dangerous “结束并归档本学期” action.
- When no project is active, show the next-semester form with project name, course template and default practice village.
- Use the existing confirm and notification adapters.
- Refresh all village/project state after each successful operation.

- [ ] **Step 4: Run administrator tests**

Expected: PASS.

---

### Task 4: Safe Village Removal, Archive, and Restore UI

**Files:**
- Modify: `features/admin/village-admin.js`
- Modify: `features/admin/village-admin.test.js`
- Modify: `features/villages/village-client.js`
- Modify: `admin.css`

**Interfaces:**
- Consumes: server removal preview and lifecycle RPCs from Tasks 1–2.
- Consumes: Supabase Storage bucket `village-datasets`.
- Produces: precise Storage deletion followed by database deletion only for unused villages.

- [ ] **Step 1: Write failing deletion-state and side-effect tests**

Cover these observable behaviors:

```js
// An unused village removes exact preview paths before the database RPC.
assert.deepEqual(events, [
  ["storage.remove", ["village-id/pkg/boundary.geojson"]],
  ["deleteUnusedVillage", { villageId: "village-id" }]
]);

// A storage failure prevents database deletion.
await assert.rejects(() => controller.deleteVillage("village-id"), /STORAGE_CLEANUP_FAILED/);
assert.equal(events.some(([name]) => name === "deleteUnusedVillage"), false);
```

Also test archive/restore, protected 米埗村, active formal village, confirmation cancellation, and a server preview changing from `delete` to `archive`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test features/admin/village-admin.test.js features/villages/village-client.test.js`

Expected: FAIL for missing removal behavior.

- [ ] **Step 3: Implement removal workflow**

- Render server-derived action labels: permanent delete, archive, restore, or blocked reason.
- Fetch a fresh preview immediately before each action.
- For permanent deletion, remove only the exact normalized paths returned by the server.
- If any Storage response contains an error, throw `STORAGE_CLEANUP_FAILED` and leave database rows untouched.
- Call `delete_unused_village` only after Storage succeeds; rely on its transactional recheck.
- Refresh UI after success.

- [ ] **Step 4: Re-run focused tests**

Expected: PASS.

---

### Task 5: Homepage and Workspace Integration

**Files:**
- Modify: `app.js`
- Modify: `features/villages/village-model.test.js`
- Modify: `homepage/src/features/village-map/village-data.test.js`
- Rebuild: `homepage/dist/**`

**Interfaces:**
- Consumes: the single `activeVillageContext` catalog.
- Produces: identical visible village sets in the main switcher and `village-home-context` iframe message.

- [ ] **Step 1: Add failing integration assertions**

Assert a context containing 米埗村, 红星村 and the formal village produces all three homepage cards/options, while an archived practice village is absent. Assert selecting 红星村 keeps the same teaching project ID and creates/loads only 红星村’s project-scoped spaces.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run:

```powershell
node --test features/villages/village-model.test.js features/integration/multi-village-flow.test.js
Set-Location homepage
npm test
```

- [ ] **Step 3: Implement integration and rebuild homepage**

- Remove any remaining single-practice assumptions in `app.js`.
- Keep `village-home-context` as the only homepage runtime source.
- Increment cache-busting query strings for changed browser scripts.
- Run the existing homepage build command so `homepage/dist` matches source.

- [ ] **Step 4: Re-run focused tests and build**

Expected: tests and homepage build PASS.

---

### Task 6: Full Verification and Deployment Checkpoint

**Files:**
- Verify all modified files.
- Remote deployment target after explicit checkpoint: Supabase project `rzmbmwauomzwiyenafha`.

**Interfaces:**
- Produces: a locally verified migration and application bundle ready for remote application.

- [ ] **Step 1: Run syntax checks**

Run:

```powershell
node --check features/villages/village-model.js
node --check features/villages/village-client.js
node --check features/admin/village-admin.js
node --check app.js
```

- [ ] **Step 2: Run the complete Node test suite**

Run: `node --test`

Expected: zero failures.

- [ ] **Step 3: Run homepage tests and production build**

Run inside `homepage`:

```powershell
npm test
npm run build
```

Expected: zero test failures and successful Vite build.

- [ ] **Step 4: Inspect worktree and formatting**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm unrelated untracked documents and prior MIME fixes remain intact.

- [ ] **Step 5: Request the remote deployment checkpoint**

Present the exact named migration and verified test results. Apply it to `rzmbmwauomzwiyenafha` only after the user explicitly approves this new migration deployment.

- [ ] **Step 6: Perform live acceptance after deployment**

Verify:

- 米埗村 and 红星村 both appear on the homepage and in the workspace.
- A new semester project can reuse the same course template after the old project is archived.
- An unused temporary village can be permanently deleted.
- An in-use village can only be archived and restored.
- 米埗村 and the active formal village cannot be deleted.

