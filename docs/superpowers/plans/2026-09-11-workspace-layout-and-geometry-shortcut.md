# Workspace Layout and Geometry Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the map top bar usable in every side-panel state, add a one-click current-object geometry editor, and keep the 3D interaction hint clear of the left rail.

**Architecture:** CSS container queries own the top-bar density and shared layout variables own occlusion offsets. The survey panel emits an edit intent; `app.js` coordinates the existing course workbench and geometry editor instead of duplicating editing or persistence logic.

**Tech Stack:** HTML, CSS container queries, browser JavaScript, OpenLayers geometry editor, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-11-workspace-and-facade-workflows-design.md`

## Global Constraints

- The top bar stays one row and never overlaps at all four left/right panel combinations.
- Geometry edits continue through the existing lock, save, version, and survey-review paths.
- The shortcut targets the currently selected building, road, or water feature without requiring a second map search.
- The 3D hint must account for the persistent 68px task rail and the optional 300px course panel.

---

### Task 1: Define top-bar density behavior with regression tests

**Files:**
- Modify: `features/ui/workspace-responsive-layout.test.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `.center-panel` container named `workspace`; layout state classes on `#mainLayout`.
- Produces: `--workspace-grid-columns`, `--workspace-action-label-display`, and `--workspace-identity-display` values that match visible controls.

- [ ] **Step 1: Write failing assertions for compact side-panel states**

Add assertions that both-open mode uses narrower selector tracks, hides identity and action labels, gives each visible control its own track, and applies `min-width: 0` to direct grid children. Assert managed villages have one fewer action track.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test features/ui/workspace-responsive-layout.test.js`

Expected: FAIL because current both-open and managed grids retain oversized fixed tracks.

- [ ] **Step 3: Implement the compact grid rules**

In `style.css`, replace the repeated fixed templates with explicit normal, single-panel, both-panel, and managed-village templates. Add `min-width: 0` to direct children, ellipsis rules to both selectors, and container-query rules that hide labels before controls. Preserve a single-row fixed height.

- [ ] **Step 4: Run the focused layout test**

Run: `node --test features/ui/workspace-responsive-layout.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ui/workspace-responsive-layout.test.js style.css
git commit -m "fix: coordinate workspace top bar with side panels"
```

### Task 2: Render and dispatch the geometry edit shortcut

**Files:**
- Modify: `features/survey/survey-review-panel.test.js`
- Modify: `features/survey/survey-review-panel.js`

**Interfaces:**
- Consumes: review rows normalized by `normalizeReview(review)`.
- Produces: `data-survey-edit-geometry` button and `onEditGeometry(review)` callback.

- [ ] **Step 1: Write failing panel tests**

Assert pending state contains both `data-survey-confirm` and `data-survey-edit-geometry`; confirmed and modified states retain only edit; deleted state has no edit. Add a controller click test proving `onEditGeometry` receives the current review.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test features/survey/survey-review-panel.test.js`

Expected: FAIL because the edit action and callback do not exist.

- [ ] **Step 3: Add the secondary edit action**

Extend `renderObjectReview` with an action row. Extend `createSurveyReviewPanel({ ..., onEditGeometry })` and dispatch the callback from `[data-survey-edit-geometry]`. Keep confirm as the primary button and edit as a quiet outlined button.

- [ ] **Step 4: Run the focused test**

Run: `node --test features/survey/survey-review-panel.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/survey/survey-review-panel.test.js features/survey/survey-review-panel.js
git commit -m "feat: add geometry edit action to survey review"
```

### Task 3: Connect the shortcut to the existing editor

**Files:**
- Modify: `features/ui/course-workbench.test.js`
- Modify: `features/ui/course-workbench.js`
- Modify: `features/map-editing/geometry-editor.test.js`
- Modify: `features/map-editing/geometry-editor.js`
- Modify: `app.js`
- Modify: `style.css`

**Interfaces:**
- Produces: `courseWorkbench.showTask(taskId): Promise<void>` remains the task-selection entry point.
- Produces: `GeometryEditorModule.startModifyFeature(deps, layerKey, feature): Promise<boolean>` selects the supplied feature, acquires its lock through existing dependencies, attaches `Modify`/`Snap`, and returns whether editing started.
- Consumes: `currentSelectedObject`, `planVectorLayer`, `doSetActiveFeature`, `setCourseTaskSidebarExpanded(true)`.

- [ ] **Step 1: Write failing editor and workbench tests**

Test that programmatic `showTask("survey-collect")` renders and notifies like a navigation click. Test `startModifyFeature` rejects non-editable/unsupported inputs, activates the supplied feature, and enters `modify` only after lock acquisition.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test features/ui/course-workbench.test.js features/map-editing/geometry-editor.test.js`

Expected: FAIL because targeted modification is not exported.

- [ ] **Step 3: Implement targeted modification in the editor**

Extract the existing feature-click modify setup into `startModifyFeature`. Make the ordinary `modify-pending` click path call the same function so locking and interaction creation have one implementation.

- [ ] **Step 4: Wire the object panel in `app.js`**

Create `editSelectedSurveyGeometry(review, layerKey, objectCode)` that validates the space, switches to 2D if needed, expands the course panel, calls `courseWorkbench.showTask("survey-collect")`, selects the correct editing layer, resolves the active OpenLayers feature by code, and calls `startModifyFeature`. Bind both the standalone survey panel and object-info button to it.

- [ ] **Step 5: Add action-row styles and run focused tests**

Run: `node --test features/ui/course-workbench.test.js features/map-editing/geometry-editor.test.js features/survey/survey-review-panel.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/ui/course-workbench.test.js features/ui/course-workbench.js features/map-editing/geometry-editor.test.js features/map-editing/geometry-editor.js app.js style.css
git commit -m "feat: open selected object directly in geometry editor"
```

### Task 4: Move the 3D hint outside the left occlusion region

**Files:**
- Modify: `features/ui/workspace-responsive-layout.test.js`
- Modify: `style.css`

**Interfaces:**
- Consumes: `--course-task-width` and `--left-panel-width`.
- Produces: `--workspace-left-occlusion` used by `.model-3d-hint`.

- [ ] **Step 1: Add a failing CSS contract test**

Assert `.model-3d-hint` uses a shared safe-offset variable containing both the task rail and expanded course panel widths, with a small-screen max-width rule.

- [ ] **Step 2: Run and verify failure**

Run: `node --test features/ui/workspace-responsive-layout.test.js`

Expected: FAIL because the hint currently includes only `--left-panel-width`.

- [ ] **Step 3: Implement the shared occlusion offset**

Define the offset on `.main-layout.mode-map`, update it with panel-state variables, and set the hint left/max-width from it. Do not add JavaScript pixel updates.

- [ ] **Step 4: Run UI regression tests**

Run: `node --test features/ui/workspace-responsive-layout.test.js features/ui/workspace-shell-regression.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/ui/workspace-responsive-layout.test.js style.css
git commit -m "fix: keep 3d interaction hint clear of side panels"
```
