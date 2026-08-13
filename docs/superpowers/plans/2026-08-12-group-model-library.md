# Group Model Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace built-in 3D model presets and the building assembler with a secure group-scoped GLB model library that supports upload, placement, white-model restoration, guarded deletion, and immutable operation history.

**Architecture:** A focused browser module owns scope resolution, file validation, storage paths, Supabase CRUD, binding and logging. Supabase stores model metadata, building-to-model bindings and append-only audit events in separate tables, while a private storage bucket holds GLB files; RLS derives access from authenticated profiles and group memberships. `app-3d.js` consumes the module and keeps the existing Cesium transform controls and generated-house workflow intact.

**Tech Stack:** Vanilla JavaScript, CesiumJS, Supabase JavaScript v2, PostgreSQL/RLS, Supabase Storage, Node.js built-in test runner.

## Global Constraints

- Accept only `.glb` files up to 50 MB.
- In a course group, every member and platform administrator can list, upload, place and delete group models.
- Without a group, models are private to the authenticated uploader.
- Refuse deletion while any building binding references the model.
- Record upload, replacement, white-model restoration and model deletion as append-only audit events.
- Remove the complete `building-assembler` feature and bundled archive; preserve the rural-house photo generator.
- Do not create Git commits or push changes.

---

### Task 1: Model library domain and Supabase client

**Files:**
- Create: `features/models/group-model-library.js`
- Create: `features/models/group-model-library.test.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `window.GroupModelLibraryModule` and CommonJS exports for `resolveLibraryScope`, `validateGlbFile`, `buildStoragePath`, and `createGroupModelLibrary`.
- Consumes: authenticated user, active planning space, Supabase client and current course/group context supplied by `app-3d.js`.

- [ ] Write failing tests covering group/personal scope, GLB extension and size validation, group-prefixed storage paths, list/upload/place/restore/delete calls, deletion-in-use rejection and audit insertion.
- [ ] Run `node --test features/models/group-model-library.test.js` and verify failures are caused by the missing module.
- [ ] Implement the dependency-injected model library with exact Supabase table and storage operations.
- [ ] Run the focused test and require zero failures.
- [ ] Load the module before the lazily loaded `app-3d.js` entry point.

### Task 2: Secure database and storage schema

**Files:**
- Create: `supabase_SQL/Group Model Library.sql`
- Create: `features/data/group-model-library-security.test.js`

**Interfaces:**
- Produces tables `group_model_assets`, `building_model_bindings`, `model_operation_events`; RPC functions `place_group_model`, `restore_building_white_model`, `delete_group_model`; private bucket `group-models`.
- Consumes existing `profiles`, `group_memberships`, `planning_spaces`, `current_profile_role()` and `current_profile_student_key()`.

- [ ] Write a failing migration contract test for required columns, constraints, indexes, RPCs, RLS policies, bucket MIME/size limits and storage object policies.
- [ ] Run `node --test features/data/group-model-library-security.test.js` and verify the SQL contract is missing.
- [ ] Write an idempotent SQL migration whose security-definer RPCs atomically update bindings and append operation events.
- [ ] Ensure the model delete RPC locks the model row, rejects active bindings, deletes metadata only after the storage path is returned, and logs the deletion.
- [ ] Run the focused security test and require zero failures.

### Task 3: Replace preset controls with the scoped model library UI

**Files:**
- Modify: `app-3d.js`
- Modify: `style.css`
- Modify: `app.js`
- Create: `features/models/group-model-library-integration.test.js`

**Interfaces:**
- Consumes: `GroupModelLibraryModule.createGroupModelLibrary()` and current 2D space/course/auth state.
- Produces: a 3D object panel with model cards, GLB upload, `替换为此模型`, guarded `删除模型`, `恢复白模`, refresh and existing transform controls.

- [ ] Write failing integration-source tests asserting the new library module is used and preset/assembler controls are absent.
- [ ] Run the focused integration test and verify the expected failures.
- [ ] Add active space/group/user context resolution to the 3D dependencies without weakening RLS.
- [ ] Replace the three legacy preset card variants with one group-model-library renderer and one event binder.
- [ ] Upload GLB files to the scoped private bucket, insert metadata, refresh cards and show actionable errors.
- [ ] Apply a selected library model through the binding RPC, load a signed URL into Cesium, and retain the existing scale/rotation/stretch/offset controls.
- [ ] Restore white models and delete unused assets through RPCs; remove storage objects only after successful metadata deletion.
- [ ] Update the 3D script cache key and add responsive model-card styles.
- [ ] Run focused model tests plus existing 3D/auth/effective-building tests and require zero failures.

### Task 4: Remove the building assembler completely

**Files:**
- Delete: `building-assembler/index.html`
- Delete: `building-assembler/assembler.js`
- Delete: `building-assembler/style.css`
- Delete: `building-assembler/components-library.json`
- Delete: `building-assembler.zip`
- Modify: `app-3d.js`
- Modify: relevant documentation or entry-point references found by repository search

**Interfaces:**
- Produces: no assembler route, archive, UI control, message bridge or model-source wording.

- [ ] Add source assertions that no runtime or entry-point references `building-assembler`, `openBuildingAssemblerForEntity`, `openBuildingAssemblerBtn` or `组装模型`.
- [ ] Run the assertion and verify it fails before removal.
- [ ] Remove assembler files and every assembler-specific code path while preserving the rural-house generator message bridge.
- [ ] Search the repository for assembler references and require no product-code matches.
- [ ] Run the focused tests and require zero failures.

### Task 5: End-to-end verification and deployment handoff

**Files:**
- Modify only files required by test findings.

**Interfaces:**
- Validates all outputs from Tasks 1-4.

- [ ] Run `node --check app-3d.js`, `node --check features/models/group-model-library.js` and `node --check app.js`.
- [ ] Run every JavaScript test under `features` plus the rural-house generator JavaScript tests.
- [ ] Inspect `git diff --check`, `git status --short` and the complete diff; preserve unrelated pre-existing changes.
- [ ] Apply `supabase_SQL/Group Model Library.sql` to the configured project only if an authenticated database execution path is available, then verify tables, policies and bucket behavior.
- [ ] Browser-test group library listing, GLB validation, upload, replacement, reload persistence, white-model restoration, in-use deletion rejection, unused deletion and audit rows.
- [ ] Report exact verification evidence and any deployment step that still requires user action; do not commit.
