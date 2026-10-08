# Module 2 3D-First Scene Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the accidental top-bar entry and 2D-first workflow with a course-launched, Cesium-first public-space editor whose changes remain synchronized with the existing 2D map, while allowing administrators to use an isolated no-group sandbox.

**Architecture:** Keep `SceneDocument` and reversible commands as the single source of truth. Add a Cesium interaction adapter that converts screen input into WGS84 commands, extend the platform context to distinguish `group` and `admin_sandbox`, and retain OpenLayers as the precision-editing view. Database changes ship as both an incremental migration for the already-deployed project and an updated canonical install script.

**Tech Stack:** Vanilla JavaScript, Node.js `node:test`, CesiumJS 1.118, OpenLayers 10.8, Supabase PostgreSQL/RLS/RPC/Storage.

**Spec:** `docs/superpowers/specs/2026-09-14-scene-studio-3d-first-redesign.md`

## Global Constraints

- Do not modify the shared-current baseline, existing building geometry, or existing building-model replacement workflow.
- `SceneDocument` remains the only persisted scene representation; both renderers consume it.
- Students require a real `group_plan`; administrators use an owner-isolated `admin_sandbox` with no group membership.
- The workspace top bar must retain its original nine direct controls and one-row layout.
- Module 2 starts in the existing Cesium village view; 2D is reached through the existing plane/solid switch.
- Archived code under `3D_scenes_edit/legacy/` stays read-only and outside the production load chain.
- All behavior changes use red-green TDD and every task ends with its focused tests passing.

---

### Task 1: Restore the top bar and add the course-task launch contract

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `features/ui/course-workbench.js`
- Modify: `features/ui/course-workbench.test.js`
- Modify: `3D_scenes_edit/integration/entrypoint-contract.test.js`
- Test: `features/ui/workspace-responsive-layout.test.js`

**Interfaces:**
- Consumes: `createCourseWorkbench({ onOpenSceneStudio })` dependency callback.
- Produces: one `data-scene-studio-open` button rendered only for `design-workspace`; callback invocation with `{ task, context }`.

- [ ] **Step 1: Write failing entry and top-bar regression tests**

```js
test("design task provides the module-two scene studio action", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: { id: "g1", spaceId: "s1" }, progress: { completedTaskIds: [] } },
    activeTaskId: "design-workspace"
  });
  assert.match(html, /data-scene-studio-open/);
  assert.match(html, />开始场景设计</);
});

test("scene studio does not add a direct child to the workspace top bar", () => {
  const bar = html.match(/id="workspaceContextBar"[\s\S]*?<\/div>\s*<aside id="projectSettingsDrawer"/)?.[0] || "";
  assert.doesNotMatch(bar, /id="openSceneStudioBtn"/);
  assert.equal((html.match(/id="sceneStudioMount"/g) || []).length, 1);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test features/ui/course-workbench.test.js 3D_scenes_edit/integration/entrypoint-contract.test.js features/ui/workspace-responsive-layout.test.js`

Expected: FAIL because the course action is absent and the top-bar button is still present.

- [ ] **Step 3: Render and bind the course action, remove the top-bar button**

```js
function renderTaskActions(task, context, completedTaskIds) {
  const sceneAction = task.id === "design-workspace"
    ? '<button type="button" class="course-btn course-btn-primary" data-scene-studio-open>开始场景设计</button>'
    : "";
  return `${sceneAction}<button type="button" class="course-btn" data-complete-task="${escapeHtml(task.id)}">记录本阶段完成</button>`;
}

const sceneButton = event.target.closest?.("[data-scene-studio-open]");
if (sceneButton) {
  await deps.onOpenSceneStudio?.({ task: course.tasks.find((item) => item.id === activeTaskId), context });
  return;
}
```

Delete the `openSceneStudioBtn` button block from `workspaceContextBar`, its cached DOM constant and its persistent-control binding. Keep `openSceneStudioWorkspace()`, `sceneStudioMount`, scripts and styles because the course callback now launches the same feature.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test features/ui/course-workbench.test.js 3D_scenes_edit/integration/entrypoint-contract.test.js features/ui/workspace-responsive-layout.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html app.js features/ui/course-workbench.js features/ui/course-workbench.test.js 3D_scenes_edit/integration/entrypoint-contract.test.js
git commit -m "fix: move scene studio entry out of workspace top bar"
```

### Task 2: Model group and administrator-sandbox contexts

**Files:**
- Modify: `3D_scenes_edit/integration/platform-bridge.js`
- Modify: `3D_scenes_edit/integration/platform-bridge.test.js`
- Modify: `3D_scenes_edit/domain/scene-document.js`
- Modify: `3D_scenes_edit/domain/scene-document.test.js`
- Modify: `3D_scenes_edit/index.js`
- Modify: `3D_scenes_edit/index.test.js`

**Interfaces:**
- Consumes: platform state `{ user, role, group, space, teachingProjectId, courseId, villageId }`.
- Produces: context `{ scopeKind: "group"|"admin_sandbox", groupId: string|null, ownerId: string, ... }` and scope-safe draft identity.

- [ ] **Step 1: Write failing context tests**

```js
test("administrator without a group receives an isolated sandbox context", () => {
  const result = buildSceneEditContext({
    activeView: "model3d",
    user: { id: "admin-1", name: "管理员" },
    role: "admin",
    group: null,
    space: { id: "shared", actualSpaceId: "shared", title: "全班共享现状" },
    teachingProjectId: "tp", courseId: "c", villageId: "v",
    baselineFeatures: []
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.scopeKind, "admin_sandbox");
  assert.equal(result.context.groupId, null);
  assert.equal(result.context.ownerId, "admin-1");
});

test("student without a group is still rejected", () => {
  const result = buildSceneEditContext({ activeView: "model3d", user: { id: "u" }, role: "student" });
  assert.equal(result.code, "GROUP_REQUIRED");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/domain/scene-document.test.js 3D_scenes_edit/index.test.js`

Expected: FAIL because `groupId` is mandatory and `scopeKind` is absent.

- [ ] **Step 3: Implement normalized context and document scope**

```js
const isAdminSandbox = state?.role === "admin" && !state?.group?.id;
if (!isAdminSandbox && !state?.group?.id) return fail("GROUP_REQUIRED", "请先加入课程小组");
const scopeKind = isAdminSandbox ? "admin_sandbox" : "group";
const groupId = isAdminSandbox ? null : String(state.group.id);

return { ok: true, context: {
  scopeKind,
  groupId,
  ownerId: String(state.user.id),
  // existing immutable project, village, space and baseline fields
} };
```

Change context validation so `groupId` is required only for `scopeKind === "group"`. Include `scopeKind` and `ownerId` in `scopeKey()` and `buildDraftIdentity()`. Persist `scopeKind` in document metadata without changing geometry schema.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/domain/scene-document.test.js 3D_scenes_edit/index.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 3D_scenes_edit/integration/platform-bridge.js 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/domain/scene-document.js 3D_scenes_edit/domain/scene-document.test.js 3D_scenes_edit/index.js 3D_scenes_edit/index.test.js
git commit -m "feat: support isolated administrator scene sandboxes"
```

### Task 3: Add the already-deployed database migration

**Files:**
- Create: `supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql`
- Modify: `supabase_SQL/Scene Edit Studio.sql`
- Modify: `3D_scenes_edit/persistence/scene-edit-schema.test.js`
- Modify: `3D_scenes_edit/persistence/scene-edit-client.js`
- Modify: `3D_scenes_edit/persistence/scene-edit-client.test.js`

**Interfaces:**
- Produces RPC: `scene_edit_create_project(..., p_scope_kind text default 'group')`.
- Produces query rules keyed by `(scope_kind, group_id, created_by)`.
- Consumes context from Task 2.

- [ ] **Step 1: Write failing schema and client tests**

```js
test("incremental migration isolates administrator sandboxes", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_SQL", "MIGRATION - Scene Edit Admin Sandbox.sql"), "utf8");
  assert.match(sql, /add column if not exists scope_kind/i);
  assert.match(sql, /drop not null/i);
  assert.match(sql, /admin_sandbox/i);
  assert.match(sql, /created_by\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /current_profile_role\(\)\s*=\s*'admin'/i);
});

test("client sends the project scope to creation", async () => {
  await client.createProject({ ...base, scopeKind: "admin_sandbox", groupId: null });
  assert.equal(calls[0].args.p_scope_kind, "admin_sandbox");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/persistence/scene-edit-schema.test.js 3D_scenes_edit/persistence/scene-edit-client.test.js`

Expected: FAIL because the incremental SQL and scope argument do not exist.

- [ ] **Step 3: Implement idempotent SQL and scoped queries**

The migration must perform this shape change and then replace affected policies/RPCs:

```sql
alter table public.scene_edit_projects
  add column if not exists scope_kind text not null default 'group';

alter table public.scene_edit_projects alter column group_id drop not null;

alter table public.scene_edit_projects
  drop constraint if exists scene_edit_projects_scope_kind_check;
alter table public.scene_edit_projects
  add constraint scene_edit_projects_scope_kind_check check (
    (scope_kind = 'group' and group_id is not null)
    or (scope_kind = 'admin_sandbox' and group_id is null)
  );
```

The create/save/read/version/restore/branch RPC authorization predicate must be:

```sql
(project.scope_kind = 'group' and (
  public.is_scene_edit_staff()
  or public.is_scene_edit_group_member(project.group_id, teaching.course_id)
))
or (project.scope_kind = 'admin_sandbox'
    and project.created_by = auth.uid()
    and public.current_profile_role() = 'admin')
```

Update the canonical install script to create the final schema directly. Update `findActiveProject()` to use `.eq("group_id", id)` for group scope and `.is("group_id", null).eq("created_by", ownerId)` for administrator scope.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test 3D_scenes_edit/persistence/scene-edit-schema.test.js 3D_scenes_edit/persistence/scene-edit-client.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql" "supabase_SQL/Scene Edit Studio.sql" 3D_scenes_edit/persistence/scene-edit-schema.test.js 3D_scenes_edit/persistence/scene-edit-client.js 3D_scenes_edit/persistence/scene-edit-client.test.js
git commit -m "feat: add administrator scene sandbox persistence"
```

### Task 4: Add Cesium ground picking and 3D boundary drawing

**Files:**
- Create: `3D_scenes_edit/interaction_3d/cesium-ground-picker.js`
- Create: `3D_scenes_edit/interaction_3d/cesium-ground-picker.test.js`
- Create: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.js`
- Create: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `pickGroundDegrees({ Cesium, viewer, screenPosition }): [lon, lat, height]|null`.
- Produces: `createCesiumSceneInteractions({ Cesium, viewer, onBoundaryComplete, onStatus })` with `activate(tool)`, `cancel()`, `dispose()`.

- [ ] **Step 1: Write failing picker and boundary tests**

```js
test("ground picker prefers scene depth and returns WGS84 degrees", () => {
  const result = pickGroundDegrees({ Cesium, viewer, screenPosition: { x: 10, y: 20 } });
  assert.deepEqual(result, [114.1, 23.7, 12]);
  assert.equal(viewer.scene.pickPositionCalls, 1);
});

test("boundary drawing closes three ground points", () => {
  const interactions = createCesiumSceneInteractions(fakes);
  interactions.activate("draw-boundary");
  click([114, 23]); click([114.001, 23]); click([114.001, 23.001]); finish();
  assert.deepEqual(completed.coordinates[0][0], completed.coordinates[0].at(-1));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/interaction_3d/cesium-ground-picker.test.js 3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js`

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement picker and boundary state machine**

```js
function pickGroundDegrees({ Cesium, viewer, screenPosition }) {
  let cartesian = viewer.scene.pickPositionSupported
    ? viewer.scene.pickPosition(screenPosition)
    : null;
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(screenPosition);
    cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
  }
  if (!cartesian) return null;
  const value = Cesium.Cartographic.fromCartesian(cartesian);
  return [Cesium.Math.toDegrees(value.longitude), Cesium.Math.toDegrees(value.latitude), value.height || 0];
}
```

Use one `Cesium.ScreenSpaceEventHandler`; store draft vertices only inside the adapter; emit GeoJSON only after at least three unique points; remove preview entities and restore camera controls in `cancel()` and `dispose()`.

- [ ] **Step 4: Load scripts before `3D_scenes_edit/index.js` and run GREEN tests**

Run: `node --test 3D_scenes_edit/interaction_3d/*.test.js 3D_scenes_edit/integration/entrypoint-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 3D_scenes_edit/interaction_3d index.html 3D_scenes_edit/integration/entrypoint-contract.test.js
git commit -m "feat: draw public-space boundaries in cesium"
```

### Task 5: Implement 3D asset preview, placement and horizontal dragging

**Files:**
- Modify: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.js`
- Modify: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js`
- Modify: `3D_scenes_edit/preview_3d/scene-preview-adapter.js`
- Modify: `3D_scenes_edit/preview_3d/scene-preview-adapter.test.js`
- Modify: `3D_scenes_edit/map_2d/scene-editor-controller.js`
- Modify: `3D_scenes_edit/map_2d/scene-editor-controller.test.js`

**Interfaces:**
- Extends interactions with `setAsset(asset)`, `setDocument(document)`, `activate("place-asset"|"select"|"move")`.
- Emits `onPlace({ asset, coordinate })`, `onSelect(ids)`, `onMove({ id, coordinate })`.
- Extends preview adapter with `pickObjectId(picked): string|null` and `setGhost(asset, coordinate)`, `clearGhost()`.

- [ ] **Step 1: Write failing placement and dragging tests**

```js
test("placing an asset emits its ground coordinate", () => {
  interactions.setAsset({ id: "bench", kind: "asset", category: "bench" });
  interactions.activate("place-asset");
  move([114, 23, 2]);
  click([114, 23, 2]);
  assert.deepEqual(events.at(-1), ["place", "bench", [114, 23]]);
});

test("dragging a scene entity emits a horizontal move and restores camera input", () => {
  dragEntity("scene-edit:o1", [114.002, 23.003, 5]);
  assert.deepEqual(events.at(-1), ["move", "o1", [114.002, 23.003]]);
  assert.equal(viewer.scene.screenSpaceCameraController.enableInputs, true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js 3D_scenes_edit/preview_3d/scene-preview-adapter.test.js 3D_scenes_edit/map_2d/scene-editor-controller.test.js`

Expected: FAIL because interactive picking and ghost placement are absent.

- [ ] **Step 3: Implement command-producing placement and dragging**

Use `properties.sourceObjectId` from preview entities. `onPlace` must call the existing object factory with a GeoJSON point; `onMove` must call a controller method that executes one `updateObject` command:

```js
moveObject(id, coordinate) {
  const object = history.present.objects.find((item) => item.id === id);
  if (!object || !Array.isArray(coordinate)) return { ok: false, code: "OBJECT_NOT_MOVABLE" };
  select([id]);
  apply({ type: "updateObject", id, patch: { geometry: { type: "Point", coordinates: coordinate.slice(0, 2) } } });
  return { ok: true, id };
}
```

The ghost is a dedicated non-persisted Cesium entity. Never insert it into `SceneDocument`, selection or autosave.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test 3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js 3D_scenes_edit/preview_3d/scene-preview-adapter.test.js 3D_scenes_edit/map_2d/scene-editor-controller.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 3D_scenes_edit/interaction_3d 3D_scenes_edit/preview_3d/scene-preview-adapter.js 3D_scenes_edit/preview_3d/scene-preview-adapter.test.js 3D_scenes_edit/map_2d/scene-editor-controller.js 3D_scenes_edit/map_2d/scene-editor-controller.test.js
git commit -m "feat: place and move scene assets in 3d"
```

### Task 6: Make the workbench 3D-first and keep 2D synchronized

**Files:**
- Modify: `3D_scenes_edit/index.js`
- Modify: `3D_scenes_edit/index.test.js`
- Modify: `3D_scenes_edit/integration/platform-bridge.js`
- Modify: `app.js`
- Modify: `features/ui/workspace-context-behavior.test.js`
- Test: `3D_scenes_edit/acceptance/scene-workflow.test.js`

**Interfaces:**
- Consumes: interaction adapter from Tasks 4–5 and `ensure3D()` from `app.js`.
- Produces: `studio.switchMode("2d"|"3d")`; one active studio preserved across platform view switches.

- [ ] **Step 1: Write failing 3D-first and synchronization tests**

```js
test("studio starts in 3d and a placed object is present in the 2d document", async () => {
  const studio = await Studio.create(options);
  assert.equal(studio.getState().mode, "3d");
  threeD.place({ assetId: "bench", coordinate: [114, 23] });
  await studio.switchMode("2d");
  assert.deepEqual(studio.getDocument().objects[0].geometry.coordinates, [114, 23]);
  assert.equal(twoD.renderedIds.includes(studio.getDocument().objects[0].id), true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/index.test.js 3D_scenes_edit/acceptance/scene-workflow.test.js features/ui/workspace-context-behavior.test.js`

Expected: FAIL because mode starts as `2d`, opening forces `plan2d`, and platform switching closes/recreates the wrong view.

- [ ] **Step 3: Wire 3D-first startup and shared command updates**

Change `openSceneStudioWorkspace()` to initialize Cesium first:

```js
async function openSceneStudioWorkspace() {
  switchMainView("model3d");
  const api = await ensureVillage3DLoaded();
  await api.enter();
  await ensurePlanMap();
  await ensureSelectedLayersLoaded();
  const result = await ensureSceneStudioPlatformBridge()?.open();
  if (!result?.ok) restoreSceneStudioViewportTargets();
  return result;
}
```

Initialize `mode = "3d"`, create the preview and Cesium interactions before first render, and keep the controller as the only command writer. On `switchMode("2d")`, render the existing document through `scene-layer-adapter`; on `switchMode("3d")`, render it through `scene-preview-adapter` without rebuilding the document.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test 3D_scenes_edit/index.test.js 3D_scenes_edit/acceptance/scene-workflow.test.js features/ui/workspace-context-behavior.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 3D_scenes_edit/index.js 3D_scenes_edit/index.test.js 3D_scenes_edit/integration/platform-bridge.js app.js features/ui/workspace-context-behavior.test.js 3D_scenes_edit/acceptance/scene-workflow.test.js
git commit -m "feat: make scene studio a 3d-first synchronized workflow"
```

### Task 7: Build the contextual 3D scene-design toolbar

**Files:**
- Create: `3D_scenes_edit/ui/scene-studio-toolbar.js`
- Create: `3D_scenes_edit/ui/scene-studio-toolbar.test.js`
- Modify: `3D_scenes_edit/ui/scene-studio-panel.js`
- Modify: `3D_scenes_edit/ui/scene-studio-panel.test.js`
- Modify: `3D_scenes_edit/style.css`
- Modify: `index.html`

**Interfaces:**
- Produces: `createSceneStudioToolbar({ root, onAction })` with `render(viewModel)`, `focus()`, `dispose()`.
- Consumes existing dispatcher actions: `tool`, `choose-asset`, `undo`, `redo`, `copy`, `delete`, `property`, `milestone`, `close`.

- [ ] **Step 1: Write failing toolbar behavior tests**

```js
test("3d toolbar exposes scene actions without entering project settings", () => {
  const html = renderToolbar({ mode: "3d", phase: "editing", assets: [{ id: "bench", label: "木座椅" }] });
  for (const value of ["draw-boundary", "select", "move"]) {
    assert.match(html, new RegExp(`data-action="tool" data-value="${value}"`));
  }
  for (const action of ["undo", "redo", "duplicate", "delete", "milestone", "close"]) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  assert.match(html, /data-action="choose-asset" data-value="bench"/);
  assert.doesNotMatch(html, /projectSettingsDrawer/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/ui/scene-studio-toolbar.test.js 3D_scenes_edit/ui/scene-studio-panel.test.js`

Expected: FAIL because the contextual toolbar module is absent.

- [ ] **Step 3: Implement the view-specific toolbar and styles**

Render a compact left-side tool rail and collapsible asset panel over `.scene-studio-canvas`; keep the status and selected-object property controls in the existing panel. Use one delegated click listener and emit existing action objects:

```js
root.addEventListener("click", (event) => {
  const control = event.target.closest?.("[data-action]");
  if (control) onAction({ type: control.dataset.action, value: control.dataset.value || "" });
});
```

The tool rail must not modify `.workspace-context-bar` dimensions or children.

- [ ] **Step 4: Load the toolbar before `index.js` and run GREEN tests**

Run: `node --test 3D_scenes_edit/ui/scene-studio-toolbar.test.js 3D_scenes_edit/ui/scene-studio-panel.test.js 3D_scenes_edit/integration/entrypoint-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 3D_scenes_edit/ui/scene-studio-toolbar.js 3D_scenes_edit/ui/scene-studio-toolbar.test.js 3D_scenes_edit/ui/scene-studio-panel.js 3D_scenes_edit/ui/scene-studio-panel.test.js 3D_scenes_edit/style.css index.html 3D_scenes_edit/integration/entrypoint-contract.test.js
git commit -m "feat: add contextual 3d scene design tools"
```

### Task 8: Wire the administrator role and asset upload scope at platform level

**Files:**
- Modify: `app.js`
- Modify: `3D_scenes_edit/integration/platform-bridge.test.js`
- Modify: `3D_scenes_edit/assets/scene-asset-library.test.js`
- Modify: `features/ui/course-workbench.test.js`

**Interfaces:**
- Consumes: `getCourseUser()` and `isAdminIdentity()`.
- Produces: platform state `role`; uploads with `personal` scope for admin sandbox and `group` scope for students.

- [ ] **Step 1: Write failing role and upload-scope tests**

```js
test("platform state identifies an authenticated administrator", () => {
  assert.match(appSource, /role:\s*isAdminIdentity\(currentUserName\)\s*\?\s*"admin"\s*:\s*"student"/);
});

test("admin sandbox uploads are personal rather than fake group assets", async () => {
  await upload({ context: { scopeKind: "admin_sandbox", ownerId: "a1", groupId: null } });
  assert.equal(record.scope_kind, "personal");
  assert.equal(record.group_id, null);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/assets/scene-asset-library.test.js features/ui/course-workbench.test.js`

Expected: FAIL because role and sandbox upload scope are not wired.

- [ ] **Step 3: Implement role and upload scoping**

```js
role: isAdminIdentity(currentUserName) ? "admin" : "student"
```

For uploads:

```js
const sandbox = context.scopeKind === "admin_sandbox";
const scope = sandbox ? "personal" : "group";
const ownerId = sandbox ? context.ownerId : context.groupId;
const groupId = sandbox ? null : context.groupId;
```

Bind `onOpenSceneStudio` in the workbench dependencies to `openSceneStudioWorkspace`. Do not require `context.group` when `isAdminIdentity(currentUserName)` is true.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/assets/scene-asset-library.test.js features/ui/course-workbench.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js 3D_scenes_edit/integration/platform-bridge.test.js 3D_scenes_edit/assets/scene-asset-library.test.js features/ui/course-workbench.test.js
git commit -m "feat: launch admin and student scene scopes correctly"
```

### Task 9: Acceptance, browser regression and deployment handoff

**Files:**
- Modify: `3D_scenes_edit/acceptance/scene-workflow.test.js`
- Modify: `3D_scenes_edit/acceptance/manual-checklist.md`
- Modify: `3D_scenes_edit/README.md`

**Interfaces:**
- Verifies every interface produced by Tasks 1–8.
- Produces the exact incremental SQL filename the user must execute.

- [ ] **Step 1: Add an end-to-end automated workflow test**

```js
test("3d-first workflow preserves baseline and synchronizes into 2d", async () => {
  const studio = await Studio.create(adminOrGroupOptions);
  assert.equal(studio.getState().mode, "3d");
  threeD.completeBoundary(boundary);
  threeD.place("bench", [114, 23]);
  threeD.move(studio.getDocument().objects[0].id, [114.0002, 23.0003]);
  await studio.switchMode("2d");
  assert.deepEqual(twoD.document.objects, studio.getDocument().objects);
  assert.deepEqual(originalBaseline, frozenBaseline);
});
```

- [ ] **Step 2: Run the acceptance and UI suites**

Run: `node --test 3D_scenes_edit/acceptance/*.test.js 3D_scenes_edit/**/*.test.js features/ui/*.test.js`

Expected: PASS.

- [ ] **Step 3: Update deployment and manual-check documentation**

Document this ordered deployment sequence:

1. Existing installations execute `supabase_SQL/MIGRATION - Scene Edit Admin Sandbox.sql` once.
2. Refresh the web application.
3. Verify administrator no-group launch.
4. Verify student group launch.
5. Verify 3D place → 2D inspect → 3D restore.

- [ ] **Step 4: Run the full suite**

Run: `node --test`

Expected: all tests pass with zero failures, cancellations, skips or todos.

- [ ] **Step 5: Perform browser smoke verification**

Open the local site in Chrome or Edge and verify:

- the workspace top bar remains one row with both side panels open;
- module two launches from the design task into Cesium;
- the contextual scene toolbar overlays the 3D view;
- switching to 2D shows the same object footprint;
- closing the studio restores the original map and 3D controls.

- [ ] **Step 6: Commit**

```bash
git add 3D_scenes_edit/acceptance/scene-workflow.test.js 3D_scenes_edit/acceptance/manual-checklist.md 3D_scenes_edit/README.md
git commit -m "test: verify 3d-first public-space workflow"
```
