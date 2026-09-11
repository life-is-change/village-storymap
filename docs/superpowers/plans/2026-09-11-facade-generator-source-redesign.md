# Facade Generator Source Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all preset-style functionality and make local worker, external AI, and cloud API three explicit ways to obtain the same standard-facade input.

**Architecture:** A small source-mode controller owns mode selection and capability messages. All successful sources converge on the existing crop, roof, GLB, download, and replacement pipeline; photo ownership and deletion policy remain in the main platform.

**Tech Stack:** HTML, CSS, browser JavaScript, Supabase facade queue, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-11-workspace-and-facade-workflows-design.md`

## Global Constraints

- Delete the 28 tracked preset JPG files and `normalization_meta.json`.
- Do not retain unreachable preset parsing or four-side extraction code.
- Switching source modes must preserve the currently selected/uploaded photo.
- External AI results are uploaded back to the current building photo library with the authenticated uploader.
- Cloud mode must remain understandable and disabled when the server capability is not configured.

---

### Task 1: Define source-mode behavior

**Files:**
- Create: `rural_house_generator/facade-source-mode.js`
- Create: `rural_house_generator/facade-source-mode.test.js`

**Interfaces:**
- Produces: `SOURCE_MODES = { LOCAL_WORKER, EXTERNAL_PROMPT, CLOUD_API }`.
- Produces: `resolveFacadeSource(value, capabilities) -> "local_worker" | "external_prompt" | "cloud_api"`.
- Produces: `sourcePresentation(source, capabilities) -> { enabled, title, description, actionLabel, tone }`.

- [ ] **Step 1: Write failing mode tests**

Cover default local selection, external availability without a backend, cloud disabled when `capabilities.cloud.available !== true`, and preservation of an explicitly selected source when still enabled.

- [ ] **Step 2: Run and verify failure**

Run: `node --test rural_house_generator/facade-source-mode.test.js`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the pure controller**

Use a UMD-style module consistent with `photo-workflow.js`; keep DOM and Supabase out of this file.

- [ ] **Step 4: Run focused tests**

Run: `node --test rural_house_generator/facade-source-mode.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rural_house_generator/facade-source-mode.js rural_house_generator/facade-source-mode.test.js
git commit -m "feat: define facade source modes"
```

### Task 2: Replace preset UI with three source cards

**Files:**
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Consumes: `facade-source-mode.js` before the module application script.
- Produces: buttons with `data-facade-source="local_worker|external_prompt|cloud_api"` and panels with matching `data-facade-source-panel`.

- [ ] **Step 1: Add failing DOM contract tests**

Assert the HTML contains all three source keys, has no “预设样式”, no preset list/search elements, and loads `facade-source-mode.js` before `app.js`.

- [ ] **Step 2: Run and verify failure**

Run: `node --test rural_house_generator/tests/photo-workflow.test.js rural_house_generator/facade-source-mode.test.js`

Expected: FAIL on the existing preset markup.

- [ ] **Step 3: Replace the sidebar markup and styles**

Make “工作站自动处理” the initial selected card. Move the existing prompt/copy/Doubao controls into the external panel. Add a cloud capability/status panel and retain one shared photo-material list, upload control, standard-facade preview, crop controls, roof options, and model generation button.

- [ ] **Step 4: Run focused tests**

Run: `node --test rural_house_generator/tests/photo-workflow.test.js rural_house_generator/facade-source-mode.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rural_house_generator/index.html rural_house_generator/style.css rural_house_generator/tests/photo-workflow.test.js
git commit -m "feat: present three facade processing sources"
```

### Task 3: Remove preset runtime code and resources

**Files:**
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`
- Delete: `rural_house_generator/normalization_meta.json`
- Delete: `rural_house_generator/building_styles/*.jpg`

**Interfaces:**
- Consumes: `FacadeSourceMode` and the existing `PhotoWorkflow` crop/generation functions.
- Produces: `state.facadeSource` and `setFacadeSource(source)`; no `state.presets`, `state.selected`, or `loadMeta()`.

- [ ] **Step 1: Add failing absence and initialization tests**

Assert tracked generator sources do not reference `normalization_meta.json`, `building_styles`, `presetModeBtn`, `presetSection`, `renderPresetList`, or `extractFacadeTextures`. Assert initialization succeeds from target dimensions without metadata.

- [ ] **Step 2: Run and verify failure**

Run: `node --test rural_house_generator/tests/photo-workflow.test.js`

Expected: FAIL because preset code and resources remain.

- [ ] **Step 3: Remove preset state and generation branches**

Delete preset event bindings, metadata loading, preset rendering/selection, preset texture extraction, and the preset-only generator. Initialize length/width from target query parameters with safe defaults. Make the top generate button dispatch only after a standard facade is ready.

- [ ] **Step 4: Delete tracked preset assets**

Delete exactly `rural_house_generator/normalization_meta.json` and the 28 tracked files under `rural_house_generator/building_styles/`; remove the empty directory.

- [ ] **Step 5: Run tests and repository reference scan**

Run: `node --test rural_house_generator/*.test.js rural_house_generator/tests/*.test.js`

Run: `rg -n "normalization_meta|building_styles|预设样式|presetModeBtn|presetSection" rural_house_generator`

Expected: tests PASS and reference scan returns no production references.

- [ ] **Step 6: Commit**

```bash
git add -A rural_house_generator
git commit -m "refactor: remove facade preset catalog"
```

### Task 4: Connect each source to the shared standard-facade flow

**Files:**
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/photo-material-bridge.js`
- Modify: `rural_house_generator/photo-material-bridge.test.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Produces: `acceptStandardFacade({ url, source, photoId, uploadedBy })` as the sole transition into crop/model preparation.
- Consumes: opener upload bridge for external results; local queue artifacts; cloud client results from the cloud-provider plan.

- [ ] **Step 1: Add failing convergence tests**

Test that local rectified artifacts, externally uploaded results, and cloud result URLs all call the same standard-facade transition; changing source does not clear `photoFile`, `selectedPhotoId`, or preview state.

- [ ] **Step 2: Run and verify failure**

Run: `node --test rural_house_generator/photo-material-bridge.test.js rural_house_generator/tests/photo-workflow.test.js`

Expected: FAIL because the shared transition does not yet exist.

- [ ] **Step 3: Implement shared facade acceptance**

Extract preview image loading, crop initialization, roof analysis reset, and generate-button enablement into `acceptStandardFacade`. Use it from local completion and external-result upload. Keep uploader identity supplied by the main platform bridge.

- [ ] **Step 4: Run generator tests**

Run: `node --test rural_house_generator/*.test.js rural_house_generator/tests/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add rural_house_generator/app.js rural_house_generator/photo-material-bridge.js rural_house_generator/photo-material-bridge.test.js rural_house_generator/tests/photo-workflow.test.js
git commit -m "refactor: converge facade sources on one model pipeline"
```

