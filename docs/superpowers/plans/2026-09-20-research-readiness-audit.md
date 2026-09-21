# Platform Research Readiness Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the current local platform against `docs/Codex_平台研究可用性核验与完善清单.md` and produce six evidence-backed reports without modifying application code or database schema.

**Architecture:** Treat repository code, tests, migrations, Git history, and deployed Supabase state as separate evidence classes. Map research semantics onto existing implementation first, mark anything that requires live database verification explicitly, and derive a minimal P0/P1/P2 change plan only from demonstrated gaps.

**Tech Stack:** Static HTML/JavaScript, Cesium/OpenLayers, Supabase PostgreSQL/RLS/RPC/Realtime, Node.js tests, Git.

**Spec:** `docs/Codex_平台研究可用性核验与完善清单.md`

## Global Constraints

- Create only the six reports requested under `docs/research-audit/`; do not alter application code, SQL, remote data, or permissions.
- Use `learning` plus the current uncommitted local workspace as the implementation baseline; use `2026-0911` only as a historical comparison when the ref is available.
- Never infer remote deployment from migration files; label repository evidence and live-environment evidence separately.
- Prefer existing fields, tables, events, and version systems over proposing parallel research infrastructure.
- Research logging must remain low-frequency, optional, exportable, and privacy-minimizing.
- Do not commit, push, merge, or create branches during this audit.

## Review Focus

- SQL migrations may describe structures not deployed remotely; every schema claim must state its evidence source.
- Current uncommitted 3D work may be absent from Git history; the audit must inspect the working tree, not only HEAD.
- Identically named IDs may have incompatible types or null semantics across modules; mappings must record type and authority.
- Activity events may duplicate fact/version tables; recommendations must distinguish behavior evidence from state evidence.
- Administrator test activity may contaminate student research exports; identity and export findings must call this out explicitly.

---

### Task 1: Establish evidence inventory and schema map

**Files:**
- Create: `docs/research-audit/01-current-schema-map.md`

**Interfaces:**
- Consumes: repository tree, SQL migrations, RLS/RPC definitions, application data clients, Git refs/status.
- Produces: authoritative table/field/context mapping used by Tasks 2–6.

- [ ] Inventory entrypoints, script loading, current branch/HEAD, uncommitted files, relevant Git refs, migrations, clients, RLS policies, RPCs, and Realtime publication statements.
- [ ] Extract research context identifiers and record type, nullability, source of authority, read/write locations, and live-verification status.
- [ ] Write the module comparison table and actual schema map with the required status vocabulary.
- [ ] Verify every named table/function/file in the report exists in repository evidence or is explicitly marked unverified.

### Task 2: Inventory behavior events

**Files:**
- Create: `docs/research-audit/02-event-inventory.md`

**Interfaces:**
- Consumes: Task 1 context map; all logger and `activity_events` call sites.
- Produces: action dictionary and research-semantic mapping used by Tasks 5–6.

- [ ] Scan `.record(...)`, `activityLogger.record(...)`, `action:` and direct `activity_events` writes.
- [ ] Record action name, trigger, context, persistence path, target identity, frequency risk, and evidence location.
- [ ] Map existing actions to task/view/edit/survey/version/scene research semantics without renaming them.
- [ ] Identify unknown, duplicated, missing-context, or high-frequency risks and mark remote-only questions.

### Task 3: Audit versioning and classroom chain

**Files:**
- Create: `docs/research-audit/03-versioning-audit.md`

**Interfaces:**
- Consumes: Task 1 schema map; snapshot, freeze, group baseline, conflict, restore, and submission code/tests.
- Produces: V0/V1/V2/Vfinal feasibility and version gaps used by Tasks 5–6.

- [ ] Trace formal shared survey state through freeze snapshot, group plan initialization, override/revision, conflict, restore, and final output.
- [ ] Distinguish implemented, tested, migration-only, and live-unverified capabilities.
- [ ] Test whether existing snapshots can carry milestone semantics without a second version system.
- [ ] State which design hypotheses are fully, partly, or not yet verifiable from current version evidence.

### Task 4: Audit the local 3D scene studio

**Files:**
- Create: `docs/research-audit/04-3d-scene-audit.md`

**Interfaces:**
- Consumes: current working-tree `3D_scenes_edit/`, its SQL migration, tests, and integration entrypoints.
- Produces: scene structure/persistence/revision/logging/export findings used by Tasks 5–6.

- [ ] Document actual file paths, scene document schema, stable IDs, asset categories, persistence layers, 2D/3D source of truth, undo/restore, milestone/version support, and tests.
- [ ] Trace administrator sandbox and student/group context, including null-group behavior.
- [ ] Determine whether scene operations currently create research-usable events or only document revisions.
- [ ] Verify claims against focused scene tests and record test counts/results without changing implementation.

### Task 5: Build the research data gap matrix

**Files:**
- Create: `docs/research-audit/05-research-data-gap-matrix.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: consolidated status/gap/risk matrix consumed by Task 6.

- [ ] Classify every checklist domain using: fully implemented, partially implemented, equivalent naming, frontend-only, database-only, unusable logging/versioning, or missing.
- [ ] Evaluate context completeness, sessions/offline integrity, privacy, task model, evidence references, 2D/3D linkage, exports, and design hypotheses.
- [ ] Separate technical gaps from classroom-task-design gaps and live-environment verification gaps.
- [ ] Record the exact evidence path for each conclusion and avoid recommendations not supported by a demonstrated gap.

### Task 6: Produce the minimal change plan

**Files:**
- Create: `docs/research-audit/06-minimal-change-plan.md`

**Interfaces:**
- Consumes: Task 5 gap matrix and all evidence reports.
- Produces: prioritized, compatibility-aware P0/P1/P2 patch candidates for later user approval.

- [ ] Rank only blocking or high-value gaps by P0/P1/P2, including “verify remotely” actions that require no code.
- [ ] For each candidate state rationale, exact files/tables, compatibility and migration impact, RLS/RPC/Realtime impact, old-data handling, and required tests.
- [ ] Define the formal classroom simulation and anonymous research-export acceptance criteria.
- [ ] Cross-check all six reports for consistent table, field, action, version, and scene terminology; run Markdown/link/path validation and `git diff --check`.

