# 3D Scenes Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently usable, student-first public-space scene studio that edits a protected village baseline through one canonical scene document, precise 2D tools, synchronized 3D preview, group assets, autosave, and milestone versions.

**Architecture:** Keep the root `index.html` as the only integrated entry and add a self-contained `3D_scenes_edit/` module. Pure domain, command, geometry, persistence, and asset services use the repository's UMD/CommonJS pattern and are covered by `node:test`; thin OpenLayers and Cesium adapters render the same canonical document. Supabase stores the editable document, revisioned milestones, assets, and group permissions, while `localStorage` protects unsynced drafts. The historical building assemblers are copied into a read-only legacy area for provenance and selective algorithm study, never loaded by the product.

**Tech Stack:** Vanilla JavaScript UMD/CommonJS modules, Node.js `node:test`, existing OpenLayers runtime, existing Cesium 1.118 runtime, Supabase/PostgreSQL/RLS, HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-09-14-three-scale-studios-and-scene-editor-design.md`

## Global Constraints

- Do not move or replace the root entry files. `index.html` remains the only platform entry; `app.js` and `app-3d.js` receive only bridge-level changes.
- Put production code, tests, styles, seed metadata, and copied legacy material under `3D_scenes_edit/`. The only exception is database SQL under `supabase_SQL/`.
- Never mutate the source village layers or the group baseline. Every edit is a logical overlay tied to `baselineRef` and `baselineRevision`.
- Use one canonical `SceneDocument`; 2D and 3D are projections of it, not separate save formats.
- Do not add a production Three.js dependency. Reuse OpenLayers and Cesium already loaded by the platform.
- Do not load anything under `3D_scenes_edit/legacy/` in `index.html`, `app.js`, or `app-3d.js`.
- Preserve unrelated working-tree changes. Commit only files belonging to the task being completed.
- Run each listed focused test before its commit, then run the complete acceptance command in Task 11.

---

### Task 1: Freeze Both Historical Building-Assembler Sources

**Files:**
- Create: `3D_scenes_edit/legacy/git_pre_delete/assembler.js`
- Create: `3D_scenes_edit/legacy/git_pre_delete/index.html`
- Create: `3D_scenes_edit/legacy/git_pre_delete/style.css`
- Create: `3D_scenes_edit/legacy/git_pre_delete/components-library.json`
- Create: `3D_scenes_edit/legacy/cong_0526/assembler.js`
- Create: `3D_scenes_edit/legacy/cong_0526/index.html`
- Create: `3D_scenes_edit/legacy/cong_0526/style.css`
- Create: `3D_scenes_edit/legacy/cong_0526/components-library.json`
- Create: `3D_scenes_edit/legacy/provenance.json`
- Create: `3D_scenes_edit/legacy/README.md`
- Test: `3D_scenes_edit/legacy/legacy-provenance.test.js`

- [ ] **Step 1: Write the failing provenance test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const manifest = require("./provenance.json");

test("every archived source exists and matches its recorded sha256", () => {
  for (const source of manifest.sources) {
    for (const file of source.files) {
      const bytes = fs.readFileSync(path.join(root, source.folder, file.name));
      assert.equal(bytes.length, file.bytes);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
  }
});

test("legacy code is explicitly excluded from production loading", () => {
  for (const file of ["../../index.html", "../../app.js", "../../app-3d.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /3D_scenes_edit[\\/]legacy/);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails because the manifest is absent**

Run: `node --test 3D_scenes_edit/legacy/legacy-provenance.test.js`
Expected: FAIL with `Cannot find module './provenance.json'`.

- [ ] **Step 3: Export the Git source without checking out over current files**

Use `git show 008893caff37b0f6297ebc04318c8a5580b81685:building-assembler/<file>` and write each returned byte stream only to `3D_scenes_edit/legacy/git_pre_delete/<file>`. Record commit `008893caff37b0f6297ebc04318c8a5580b81685` and these Git blob IDs in `provenance.json`: `assembler.js` = `c47eb03f5a818f98d4dd21684187a9a467db457f`, `components-library.json` = `5f3bb104bf6e2608835b44bf95276329bcb5253c`, `index.html` = `4ed1442013fa5fd5619ea925398450033c6af6e8`, `style.css` = `a43313f214e41375a41a4f5f9e802f4327dd0250`.

- [ ] **Step 4: Copy the 0526 source into its isolated folder**

Copy only the four named files from `E:\研究生工作\332工作\3D村庄规划网页\village-storymap聪0526\building-assembler\`. Record source path, timestamp of copying, byte length, and SHA-256. Known source checksums are: `assembler.js` = `55fe8c2aa60f5032dd0a0820fd666738873cc1b32300e931a2fd8dd508389e9e`; `components-library.json` = `03d90b16cd150e64140a1c10402216e9fae536af645e9c32b345cac180748028`; `index.html` = `211240b8088dc11d44f1039a63720ef8af09335093ca04bdfe8dab3b31357121`; `style.css` = `80caa836562df17dada7ba9269d0fd3b3c9740014f10906ae4e20528c9d1ba35`.

- [ ] **Step 5: Document reuse boundaries**

In `legacy/README.md`, state that the Git snapshot is the structural reference, the 0526 snapshot is a reference for range drawing, dimensions, rotated footprints, support constraints, property editing, and snapshot history, and neither folder is a production dependency.

- [ ] **Step 6: Run the test and commit**

Run: `node --test 3D_scenes_edit/legacy/legacy-provenance.test.js`
Expected: PASS, 2 tests.

Commit: `git commit -m "chore: archive scene editor reference sources"`

---

### Task 2: Define and Validate the Canonical Scene Document

**Files:**
- Create: `3D_scenes_edit/domain/scene-document.js`
- Test: `3D_scenes_edit/domain/scene-document.test.js`
- Create: `3D_scenes_edit/README.md`

- [ ] **Step 1: Write failing tests for a new document and valid object categories**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const SceneDocument = require("./scene-document");

test("creates an empty overlay linked to an immutable baseline", () => {
  const doc = SceneDocument.create({ projectId: "p1", groupId: "g1", spaceId: "s1", baselineRevision: 7 });
  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(doc.baselineRef, { spaceId: "s1", revision: 7 });
  assert.deepEqual(doc.objects, []);
});

test("accepts point, line, surface and structure records", () => {
  const point = { id: "o1", kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.1, 30.2] }, transform: { headingDeg: 0, scale: [1, 1, 1], heightOffsetM: 0 }, properties: {} };
  assert.deepEqual(SceneDocument.validateObject(point), { ok: true, errors: [] });
});

test("rejects invalid coordinates and unsupported kinds", () => {
  const result = SceneDocument.validateObject({ id: "bad", kind: "house", geometry: { type: "Point", coordinates: [999, 30] } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /kind|longitude/);
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `node --test 3D_scenes_edit/domain/scene-document.test.js`
Expected: FAIL with `Cannot find module './scene-document'`.

- [ ] **Step 3: Implement the UMD module**

Expose `create`, `clone`, `validate`, `validateObject`, and constants `KINDS` and `CATEGORIES`. Use `kind` values `surface`, `line`, `asset`, `structure`, `group`; GeoJSON geometries in EPSG:4326; and this exact transform shape for placeable objects:

```js
transform: {
  headingDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  scale: [1, 1, 1],
  heightOffsetM: 0
}
```

Store 3D-only changes inside `transform`; never rewrite a polygon because height, pitch, roll, or material changed. Include `revision`, `updatedAt`, `selectionBoundary`, `objects`, `groups`, `layers`, `assetRefs`, and `metadata` in every document. Surface properties include `materialRef`, `elevationM`, and `extrusionHeightM`; line properties include `widthM`, `heightM`, `repeatAssetRef`, and `repeatSpacingM`. Return structured validation errors; do not throw for user data.

- [ ] **Step 4: Document the module boundary and coordinate rules**

In `3D_scenes_edit/README.md`, list the folder layout, canonical schema, EPSG:4326 persistence, meter-based heights and line widths, and the rule that OpenLayers/Cesium adapters may convert coordinates only at render time.

- [ ] **Step 5: Run tests and commit**

Run: `node --test 3D_scenes_edit/domain/scene-document.test.js`
Expected: PASS.

Commit: `git commit -m "feat: define canonical scene document"`

---

### Task 3: Add Reversible Commands and Metric Geometry Rules

**Files:**
- Create: `3D_scenes_edit/domain/scene-commands.js`
- Test: `3D_scenes_edit/domain/scene-commands.test.js`
- Create: `3D_scenes_edit/domain/geometry-rules.js`
- Test: `3D_scenes_edit/domain/geometry-rules.test.js`

- [ ] **Step 1: Write failing command-history tests**

Cover `addObject`, `updateObject`, `deleteObjects`, `duplicateObjects`, `groupObjects`, `ungroupObjects`, `alignObjects`, `distributeObjects`, `reorderLayer`, `undo`, and `redo`. Assert that alignment supports left/center/right/top/middle/bottom, distribution supports equal horizontal/vertical gaps, and fewer than three selected objects make distribution a no-op. Assert that updating X/Y/heading/scale changes the canonical object, while updating `heightOffsetM`, pitch, roll, or material leaves its 2D geometry byte-for-byte equal.

- [ ] **Step 2: Run and confirm the command module is missing**

Run: `node --test 3D_scenes_edit/domain/scene-commands.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement immutable command application**

Expose `createHistory(document, { limit: 100 })`, `execute(history, command)`, `undo(history)`, and `redo(history)`. Store before/after document snapshots in memory, trim the oldest entry over 100, and clear redo after a new command. Commands must return new objects without mutating input.

- [ ] **Step 4: Write failing metric-rule tests**

Test point-in-polygon selection, polygon area, line length, 0.5 m grid snapping, minimum 0.8 m clear width, baseline-building intersection, object-boundary containment, rotated rectangular footprints, and self-intersecting polygon rejection. Use fixed Wuhan-area coordinates so meter conversion is exercised.

- [ ] **Step 5: Implement engine-independent geometry rules**

Expose `measureAreaM2`, `measureLengthM`, `snapCoordinate`, `rotatedFootprint`, `containsGeometry`, `intersectsAny`, and `validateSelectionBoundary`. Use a local equirectangular meter projection centered on the edited boundary for calculations; persist the result back as WGS84. Return `{ ok, errors, warnings, measurements }` so the UI can distinguish blockers from accessibility warnings.

- [ ] **Step 6: Run both suites and commit**

Run: `node --test 3D_scenes_edit/domain/scene-commands.test.js 3D_scenes_edit/domain/geometry-rules.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add reversible scene commands and geometry rules"`

---

### Task 4: Create Supabase Storage, Revision, and RLS Contracts

**Files:**
- Create: `supabase_SQL/Scene Edit Studio.sql`
- Test: `3D_scenes_edit/persistence/scene-edit-schema.test.js`

- [ ] **Step 1: Write a failing static contract test**

Read the SQL file and assert the presence of `scene_edit_projects`, `scene_edit_objects`, `scene_edit_assets`, `scene_edit_components`, `scene_edit_versions`, `scene_edit_save_draft`, revision conflict handling, RLS enablement for all five tables, and policies that call the existing membership/role helpers used by current group data. Also assert creation of private buckets `scene-assets` and `scene-version-previews` plus scoped storage policies.

- [ ] **Step 2: Run and verify the missing SQL failure**

Run: `node --test 3D_scenes_edit/persistence/scene-edit-schema.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the database contract**

Persist project metadata separately from the current object set; the client assembles these rows into the one canonical `SceneDocument`:

```sql
create table if not exists public.scene_edit_projects (
  id uuid primary key default gen_random_uuid(),
  village_id text not null,
  space_id text not null,
  group_id uuid not null,
  title text not null,
  baseline_revision bigint not null,
  selection_boundary jsonb not null,
  layers jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  revision bigint not null default 0,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add `scene_edit_objects(project_id, object_id, kind, category, geometry, transform, properties, layer_id, group_id, z_index, updated_at)` with unique `(project_id, object_id)`. Add `scene_edit_versions(project_id, revision, label, description, document, preview_path, submission_status, created_by, created_at)`, `scene_edit_assets(group_id, scope, kind, storage_path, display_name, mime_type, bytes, metadata, license, archived_at, created_by, created_at)`, and `scene_edit_components(group_id, scope, display_name, document_fragment, preview_path, archived_at, created_by, created_at)`. Implement `scene_edit_save_draft(project_id, expected_revision, document)` as a security-definer RPC that validates ownership, atomically upserts the document's object set, removes only current rows omitted from that document, and increments revision; raise SQLSTATE `40001` on a stale revision. Implement `scene_edit_load_project(project_id)` to assemble the canonical document and `scene_edit_create_version(project_id, expected_revision, label, description, preview_path)` from the current saved rows.

- [ ] **Step 4: Add least-privilege access policies**

Students may select and mutate records only for groups they belong to; teachers/admins may read course-linked groups but do not gate draft saving. Shared assets are readable inside the course; group and personal assets remain scoped. Teachers/admins may set `archived_at` to take down an asset/component but may not alter its content. Deny updates to `group_id`, `village_id`, `space_id`, `created_by`, and `baseline_revision` after creation. Keep both storage buckets private and resolve downloads through signed URLs. Asset records referenced by any version use soft deletion only.

- [ ] **Step 5: Run test and commit**

Run: `node --test 3D_scenes_edit/persistence/scene-edit-schema.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add scene studio database contract"`

---

### Task 5: Implement Revision-Safe Persistence and Draft Recovery

**Files:**
- Create: `3D_scenes_edit/persistence/scene-edit-client.js`
- Test: `3D_scenes_edit/persistence/scene-edit-client.test.js`
- Create: `3D_scenes_edit/persistence/autosave-controller.js`
- Test: `3D_scenes_edit/persistence/autosave-controller.test.js`
- Create: `3D_scenes_edit/persistence/local-draft-store.js`
- Test: `3D_scenes_edit/persistence/local-draft-store.test.js`

- [ ] **Step 1: Write failing client tests with a fake Supabase chain**

Cover `createProject`, `branchFromBaseline`, `loadProject`, `saveDraft`, `createVersion`, `restoreVersionAsDraft`, `submitVersion`, `listVersions`, `listAssets`, and stale-revision normalization. Assert all calls include the active `groupId`/`spaceId`, baseline upgrades create a new project ID instead of mutating `baselineRevision`, version restore creates a fresh draft, and `saveDraft` returns `{ ok: false, code: "REVISION_CONFLICT", remoteRevision }` instead of overwriting.

- [ ] **Step 2: Implement the persistence client**

Expose `createSceneEditClient({ supabaseClient })`. Validate every outgoing document with `SceneDocument.validate`; call the load/save/version/branch/restore/submit RPCs from Task 4; map network, auth, validation, and revision failures to stable error codes.

- [ ] **Step 3: Write failing autosave and local recovery tests**

Use an injectable clock and storage adapter. Assert edits debounce for 1000 ms, one save runs at a time, edits made during a save trigger one following save, failures keep a local draft, and a successful server save removes only the matching local revision. Assert recovery keys equal `scene-edit:<userId>:<groupId>:<spaceId>:<projectId>`.

- [ ] **Step 4: Implement autosave and local draft modules**

Expose `createAutosaveController({ save, localDraftStore, delayMs: 1000, clock })` with `markDirty`, `flush`, `getState`, and `dispose`. States are `clean`, `dirty`, `saving`, `saved`, `offline`, `conflict`. Expose `createLocalDraftStore(storage)` with `read`, `write`, and `remove`.

- [ ] **Step 5: Run persistence suites and commit**

Run: `node --test 3D_scenes_edit/persistence/*.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add safe scene draft persistence"`

---

### Task 6: Build the Hybrid Scene Asset Library

**Files:**
- Create: `3D_scenes_edit/assets/scene-asset-library.js`
- Test: `3D_scenes_edit/assets/scene-asset-library.test.js`
- Create: `3D_scenes_edit/assets/seed/catalog.json`
- Create: `3D_scenes_edit/assets/seed/README.md`

- [ ] **Step 1: Write failing validation and path tests**

Accept `.glb` object models up to 50 MiB, `.png/.jpg/.jpeg/.webp` ground textures up to 10 MiB, and `.svg/.png` 2D symbols up to 5 MiB. Reject mismatched extension/MIME pairs, GLB files without magic bytes `glTF`, executable SVG content, negative scale metadata, and paths not scoped to `course|group|personal`.

- [ ] **Step 2: Implement pure validation and storage paths**

Expose `validateAssetFile`, `sanitizeDisplayName`, `buildStoragePath`, `normalizeAssetRecord`, `inspectGlbHeader`, and `createAssetLibrary`. Generate paths as `<scope>/<ownerId>/<yyyy-mm>/<uuid>.<ext>`; never use the original file name in storage. `inspectGlbHeader` validates GLB version/declared length and reports accessor bounds plus primitive/texture counts when present. `createAssetLibrary` wraps upload, signed URL generation, scope publication, shared-asset copying, reference counting, and soft deletion.

- [ ] **Step 3: Add the initial seed catalog**

Define metadata entries, even where the visual is currently a procedural fallback, for: paving, grass, water, planter, activity field, path, curb, low wall, fence, hedge, drainage, tree, shrub, bench, table, light, bin, sign, sculpture, fitness, pavilion, pergola, bus stop, stall, stage, and play equipment. Each entry has a stable `seed:<category>:<variant>` ID, `kind`, `category`, `footprintM`, `defaultHeightM`, `renderer`, and Chinese label. Do not copy copyrighted game assets.

- [ ] **Step 4: Implement preview, calibration, lifecycle, and component tests**

Assert a successfully previewed GLB stores measured bounding-sphere dimensions, a top-view preview path, calibrated real width/depth/height, heading correction, and ground offset. Assert `publishToCourse` creates an immutable shared record, `copySharedAsset` creates a group-owned record, and `removeAsset` archives referenced files rather than deleting them. Assert `createComponent(selection, origin)` stores normalized relative coordinates and asset references, and `instantiateComponent(component, target)` creates fresh object/group IDs without altering the component.

- [ ] **Step 5: Run tests and commit**

Run: `node --test 3D_scenes_edit/assets/scene-asset-library.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add hybrid public-space asset library"`

---

### Task 7: Render and Edit the Canonical Document in OpenLayers

**Files:**
- Create: `3D_scenes_edit/map_2d/scene-layer-adapter.js`
- Test: `3D_scenes_edit/map_2d/scene-layer-adapter.test.js`
- Create: `3D_scenes_edit/map_2d/scene-editor-controller.js`
- Test: `3D_scenes_edit/map_2d/scene-editor-controller.test.js`

- [ ] **Step 1: Write failing pure adapter tests**

Inject a fake `ol` facade. Assert surfaces become polygon features, lines become line features with meter-width metadata, assets/structures become point features plus rotated footprints, IDs round-trip, hidden layers are skipped, and selected/locked/error states produce distinct style tokens.

- [ ] **Step 2: Implement `createSceneLayerAdapter({ ol, map, projection })`**

Expose `mount`, `render(document, viewState)`, `hitTest(pixel)`, `fitBoundary`, and `dispose`. Maintain dedicated overlay layers and never add editable features to baseline source objects. Convert EPSG:4326 to the map projection only inside the adapter.

- [ ] **Step 3: Write failing controller tests**

Cover tools `select`, `box-select`, `draw-surface`, `draw-rectangle`, `draw-line`, `place-asset`, `move`, `rotate`, `scale`, `measure`, `pan`, and node editing for lines/polygons. Assert modifier-key multi-select, delete/copy/group/align/distribute shortcuts, grid/endpoint/edge/center/baseline-feature snapping, distance/angle/area/object-size measurements, surface material/elevation/extrusion updates, line width/height/repeat-spacing updates, boundary validation, baseline collision warnings, locked/layer-order behavior, and command-history integration.

- [ ] **Step 4: Implement the controller with injected interactions**

Expose `createSceneEditorController({ adapter, history, geometryRules, onDocumentChange, onStatus })`; keep DOM and OpenLayers event binding out of domain modules. Every accepted edit must execute exactly one reversible command and call `onDocumentChange(nextDocument)`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test 3D_scenes_edit/map_2d/*.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add precise 2d scene editing adapter"`

---

### Task 8: Build the Student-Facing Workbench

**Files:**
- Create: `3D_scenes_edit/ui/scene-studio-panel.js`
- Test: `3D_scenes_edit/ui/scene-studio-panel.test.js`
- Create: `3D_scenes_edit/style.css`
- Create: `3D_scenes_edit/index.js`
- Test: `3D_scenes_edit/index.test.js`

- [ ] **Step 1: Write failing UI state tests**

Test the pure `buildViewModel(state)` result for: no project, drawing boundary, boundary error, editing, saving, offline recovery, revision conflict, and read-only viewing. Assert the workbench exposes layers, object tree, asset categories, properties, history controls, 2D/3D switch, save state, and milestone action without teacher approval controls.

- [ ] **Step 2: Implement the panel as a narrow DOM adapter**

Expose `createSceneStudioPanel({ root, onAction })` with `render(viewModel)`, `focus()`, and `dispose()`. Use `data-action` attributes for all commands, proper labels/keyboard focus, a collapsible asset drawer, layer lock/hide buttons, selection count, numeric transform inputs, and non-blocking validation messages.

- [ ] **Step 3: Add exact keyboard behavior**

Bind `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+C`, `Ctrl/Cmd+D`, `Delete`, `Escape`, and `G` only while the studio owns focus. Never intercept browser shortcuts while an input or textarea is active.

- [ ] **Step 4: Implement the studio coordinator**

Expose `window.SceneEditStudio.create({ root, map, supabaseClient, context, ensure3D })`. It owns the canonical document, command history, controller, autosave, assets, panel, and current mode. `context` must contain `{ userId, villageId, groupId, spaceId, baselineRevision, baselineFeatures }`; return a visible error if any required identity or group field is absent.

- [ ] **Step 5: Style for a map-first classroom workflow**

Use a left tool rail, right properties/assets panel, bottom save/status bar, and center map canvas. At widths under 900 px, collapse the right panel into a drawer but keep selection, undo, and save state visible. Respect existing CSS variables and avoid global element selectors.

- [ ] **Step 6: Run tests and commit**

Run: `node --test 3D_scenes_edit/ui/scene-studio-panel.test.js 3D_scenes_edit/index.test.js`
Expected: PASS.

Commit: `git commit -m "feat: build student scene studio workbench"`

---

### Task 9: Add Cesium Preview and Controlled 3D Fine-Tuning

**Files:**
- Create: `3D_scenes_edit/preview_3d/scene-to-cesium.js`
- Test: `3D_scenes_edit/preview_3d/scene-to-cesium.test.js`
- Create: `3D_scenes_edit/preview_3d/scene-preview-adapter.js`
- Test: `3D_scenes_edit/preview_3d/scene-preview-adapter.test.js`
- Create: `3D_scenes_edit/preview_3d/scene-transform-bridge.js`
- Test: `3D_scenes_edit/preview_3d/scene-transform-bridge.test.js`

- [ ] **Step 1: Write failing conversion tests**

Assert points use `Cesium.Cartesian3.fromDegrees`, headings/pitch/roll are converted to radians, GLBs use a model matrix and scale, surfaces/lines map to Cesium entities or ground primitives, repeated seed objects share a renderer batch key, and missing/failed GLBs fall back to labeled boxes without failing the whole preview.

- [ ] **Step 2: Implement pure Cesium descriptors**

`toCesiumDescriptors(document, assetMap)` returns serializable descriptors separated into `models`, `instances`, `polygons`, `polylines`, and `fallbacks`. Do not touch the viewer in this function. Include source object IDs on every descriptor.

- [ ] **Step 3: Implement the viewer adapter**

Expose `createScenePreviewAdapter({ Cesium, viewer, assetResolver })` with `render`, `select`, `flyToBoundary`, and `dispose`. Reuse primitives by object ID; destroy removed resources; resolve private GLBs through signed URLs; revoke object URLs when replaced. Limit parallel model loads to four.

- [ ] **Step 4: Write and implement transform-bridge tests**

Allow X/Y move, yaw, horizontal scale, duplicate, delete, and group actions to update the canonical document and therefore 2D. Allow height, Z scale, pitch, roll, and material to update only `transform`/`properties`. Reject polygon and line vertex editing in 3D with status `EDIT_IN_2D`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test 3D_scenes_edit/preview_3d/*.test.js`
Expected: PASS.

Commit: `git commit -m "feat: add synchronized cesium scene preview"`

---

### Task 10: Integrate the Studio Through Minimal Platform Bridges

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `app-3d.js`
- Create: `3D_scenes_edit/integration/platform-bridge.js`
- Test: `3D_scenes_edit/integration/platform-bridge.test.js`
- Test: `3D_scenes_edit/integration/entrypoint-contract.test.js`

- [ ] **Step 1: Write failing context and entrypoint tests**

Assert `buildSceneEditContext` extracts the signed-in user, village, current group/space, baseline revision, and cloned baseline geometry without leaking live OpenLayers features. Read `index.html` and assert one `#sceneStudioMount`, one `#openSceneStudioBtn`, scripts in dependency order before `app.js`, and no legacy script path.

- [ ] **Step 2: Implement the pure platform bridge**

Expose `buildSceneEditContext`, `openSceneStudio`, `closeSceneStudio`, and `syncSceneEditContext`. Clone baseline features to GeoJSON immediately. Refuse launch in overview/no-group/no-space states with stable error codes used by existing toast handling.

- [ ] **Step 3: Add the integrated mount and scripts**

Add a `公共空间设计` button beside the project settings control and a hidden `#sceneStudioMount` sibling of the existing content views. Add `3D_scenes_edit/style.css` and production script tags in dependency order: domain, persistence, assets, 2D, UI, preview descriptors/bridge, integration, `3D_scenes_edit/index.js`, then `app.js`.

- [ ] **Step 4: Add only lifecycle hooks to `app.js`**

On open, build context from current platform state and create or refresh the studio. On space/group/user changes, close or rescope it before any draft can save. On 3D mode request, call existing `ensureVillage3DLoaded()` and pass a viewer accessor. Preserve existing geometry editing and group-model-library paths.

- [ ] **Step 5: Expose a narrow viewer accessor in `app-3d.js`**

Add `Village3D.getViewer()` and `Village3D.focusSceneBoundary(boundary)` without exposing unrelated internals. The studio owns only its tagged data sources/primitives and removes those on close; it must not clear village entities.

- [ ] **Step 6: Run tests and commit**

Run: `node --test 3D_scenes_edit/integration/*.test.js`
Expected: PASS.

Commit: `git commit -m "feat: integrate public-space scene studio"`

---

### Task 11: Add Milestones, Conflict Recovery, and End-to-End Acceptance

**Files:**
- Modify: `3D_scenes_edit/index.js`
- Modify: `3D_scenes_edit/ui/scene-studio-panel.js`
- Modify: `3D_scenes_edit/style.css`
- Create: `3D_scenes_edit/acceptance/scene-workflow.test.js`
- Create: `3D_scenes_edit/acceptance/performance-budget.test.js`
- Create: `3D_scenes_edit/acceptance/manual-checklist.md`

- [ ] **Step 1: Write the failing workflow acceptance test**

Drive the coordinator with fake map, Cesium, storage, and Supabase adapters through: create project from baseline → draw valid public-space boundary → place a bench/tree/path/paving → move and rotate in 2D → alter height in 3D → verify 2D geometry is unchanged → autosave → create a labeled milestone with description and preview → reload → compare baseline/current/two milestones → restore a milestone as a new draft → submit one version. Add separate cases for a baseline-upgrade branch, GLB failure fallback, offline recovery, and revision conflict without data loss.

- [ ] **Step 2: Implement milestone and conflict UI**

Require a 1–40 character milestone label and an optional description up to 500 characters. Capture a canvas preview after removing selection handles, upload it to `scene-version-previews`, and store its path with the immutable snapshot. Add baseline-vs-version and version-vs-version compare modes using tinted overlay layers, plus `恢复为新草稿` and `提交此版本` actions. Show saved timestamp, revision, author, and submission status. On conflict, preserve the local document, fetch the remote document, and offer exactly: `保留本地副本`, `载入远端版本`, `另存为新方案`; never silently merge or overwrite.

- [ ] **Step 3: Add the performance budget test**

Generate 300 scene objects referencing 50 distinct GLB asset IDs. Assert document validation and command execution each finish under 100 ms in Node on three consecutive runs, descriptor conversion under 200 ms, repeated seed items produce batched instance keys, and the preview adapter never starts more than four concurrent GLB resolves. Treat browser frame-rate as a manual check because CI has no representative GPU.

- [ ] **Step 4: Write and execute the browser checklist**

In `manual-checklist.md`, record results for Chrome/Edge at desktop and 900 px width: launch from platform; group/space isolation; arbitrary valid boundary selection; invalid boundary/building collision feedback; point/line/surface/structure placement; layer lock/hide/order; multi-select/copy/group/align/distribute; all snap modes; distance/angle/area/object dimensions; surface extrusion; repeated line assets; uploaded GLB preview/calibration; component save/reuse/share-copy/archive; undo/redo; 2D↔3D synchronization; missing model fallback; autosave/offline recovery; milestone preview/compare/restore/submit; baseline-upgrade branch; teacher read-only inspection and asset takedown; existing building update and geometry editing regression; no request for legacy files.

- [ ] **Step 5: Run the complete automated suite**

Run: `node --test 3D_scenes_edit/**/*.test.js`
Expected: PASS with no skipped or todo tests.

Run: `node --test features/map-editing/*.test.js features/models/group-model-library.test.js`
Expected: PASS; existing map editing and model library remain intact.

- [ ] **Step 6: Inspect the final diff and production references**

Run: `git diff --check`
Expected: no output.

Run: `rg -n "3D_scenes_edit[/\\]legacy|building-assembler" index.html app.js app-3d.js 3D_scenes_edit --glob "!legacy/**"`
Expected: only documentation/tests that assert exclusion; no production import or URL.

- [ ] **Step 7: Commit the acceptance slice**

Commit: `git commit -m "test: verify public-space scene workflow"`

---

## Completion Gate

- The public-space studio opens inside the current web platform and can be used independently by a student group.
- The baseline remains unchanged after editing, saving, reloading, switching 2D/3D, and restoring a milestone.
- Point, line, surface, small-structure, uploaded GLB, and composite-component workflows are all demonstrable.
- The production page makes zero requests to either historical assembler folder.
- Automated suites pass, the browser checklist is recorded, and `git diff --check` is clean.
- Module 1 and Module 3 are not made prerequisites; this implementation exposes only optional asset/document extension points for future studio interoperability.
