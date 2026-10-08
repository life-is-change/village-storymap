# Geoprocessing Preview, Contour Delete, and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview layers obey layer controls, support delete-only contour editing and optional labels, stop duplicate completion notifications, and restyle the production panel.

**Architecture:** Keep temporary result layers independent but expose one visibility/clear controller wired to workspace state. Represent contour permissions as action-specific capabilities and enforce them again in the database RPC. Keep panel status transitions and imported state inside the panel model, with a database lookup for restored tasks.

**Tech Stack:** Vanilla JavaScript, OpenLayers 10.8, Supabase/PostgreSQL, Node test runner, CSS.

## Global Constraints

- Work on the current `learning` branch without a worktree.
- Do not create intermediate commits.
- Contours support delete only; labels default off.
- Saving an imported result clears temporary preview layers.

---

### Task 1: Preview visibility ownership

**Files:**
- Modify: `features/geoprocessing/geoprocessing-result-layers.js`
- Modify: `features/geoprocessing/geoprocessing-result-layers.test.js`
- Modify: `features/ui/space-panel-events.js`
- Modify: `app.js`

- [ ] Write failing tests for selected-layer synchronization and clear-on-import.
- [ ] Verify tests fail for missing controller behavior.
- [ ] Add preview active state, `syncVisibleLayers()` and clear preview after import.
- [ ] Run focused tests and existing workspace tests.

### Task 2: Completion transition and saved state

**Files:**
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/geoprocessing/geoprocessing-panel.test.js`
- Modify: `features/geoprocessing/geoprocessing-client.js`
- Modify: `features/geoprocessing/geoprocessing-client.test.js`

- [ ] Write failing tests for one completion callback and restored imported status.
- [ ] Verify tests fail for repeated callbacks and missing import lookup.
- [ ] Implement transition notification, imported lookup and disabled saved button.
- [ ] Run focused tests.

### Task 3: Delete-only contours and label switch

**Files:**
- Modify: `features/ui/personal-layer-versions.js`
- Modify: `features/ui/personal-layer-versions.test.js`
- Modify: `features/map-editing/geometry-editor.js`
- Modify: `features/ui/space-panel.js`
- Modify: `features/ui/space-panel-events.js`
- Modify: `features/ui/map-style.js`
- Modify: `app.js`
- Create: `supabase_SQL/Enable Personal Contour Delete.sql`
- Modify: `features/data/personal-space-security.test.js`

- [ ] Write failing capability, toolbar, label and SQL contract tests.
- [ ] Verify failures are caused by current contour read-only behavior.
- [ ] Implement contour delete-only UI/action routing and per-space label state.
- [ ] Add the incremental security-definer RPC migration that accepts contour delete only.
- [ ] Run focused tests.

### Task 4: Production panel visual integration

**Files:**
- Modify: `features/geoprocessing/geoprocessing-panel.js`
- Modify: `features/geoprocessing/geoprocessing-panel.test.js`
- Modify: `style.css`
- Modify: `index.html`

- [ ] Write failing markup tests for semantic classes and Chinese artifact labels.
- [ ] Verify tests fail against the current raw form.
- [ ] Implement themed markup and responsive styles.
- [ ] Run focused tests.

### Task 5: Verification

- [ ] Run all `features/**/*.test.js` files.
- [ ] Run `node --check` on all changed JavaScript files.
- [ ] Run `git diff --check`.
- [ ] Verify no unintended commit was created and report the incremental SQL that must be executed.
