# Scene Studio Interaction Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make module 2 a consistent 3D-first public-space editor with visible boundaries, recognizable built-in components, usable asset navigation, correct 2D synchronization, and a stable homepage/header layout.

**Architecture:** Keep one scene document as the shared source for 2D and 3D. Extend the Cesium interaction adapter so point, line, and polygon assets can all be authored without leaving 3D; make the preview adapter render the saved design boundary and recognizable procedural graphics. Keep platform view state and the mounted viewport synchronized when leaving the studio.

**Tech Stack:** Browser JavaScript, CesiumJS, OpenLayers, Node test runner, React/Vite homepage.

**Spec:** User-approved corrections in the current Codex task on 2026-09-15.

## Global Constraints

- Work in the current `learning` branch and current checkout; create no branch or worktree.
- Preserve all unrelated and pre-existing uncommitted changes.
- 3D is the primary authoring mode; 2D shows and validates the same document.
- Exiting the studio must leave the platform in a real 2D state whose control highlight matches the visible canvas.
- Built-in assets must not claim to be GLB models when they are procedural graphics.

---

### Task 1: Correct 3D tool state and persistent boundary rendering

**Files:**
- Modify: `3D_scenes_edit/index.js`
- Modify: `3D_scenes_edit/map_2d/scene-editor-controller.js`
- Modify: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.js`
- Modify: `3D_scenes_edit/preview_3d/scene-preview-adapter.js`
- Test: corresponding `*.test.js` files

**Interfaces:**
- Produces a controller-supported `draw-boundary` tool and a preview record for `selectionBoundary`.
- Boundary completion switches the active tool to `select` only after the saved boundary is rendered.

- [ ] Write tests showing `draw-boundary` becomes active and a completed boundary remains represented after temporary vertices clear.
- [ ] Run the focused tests and confirm they fail for the current missing state/render behavior.
- [ ] Implement controller tool support and a depth-safe persistent boundary outline/fill in the preview adapter.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Keep all asset authoring in 3D

**Files:**
- Modify: `3D_scenes_edit/index.js`
- Modify: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.js`
- Test: `3D_scenes_edit/index.test.js`
- Test: `3D_scenes_edit/interaction_3d/cesium-scene-interactions.test.js`

**Interfaces:**
- `chooseAsset(assetId)` activates `place-asset`, `draw-line`, or `draw-surface` without switching mode.
- Cesium interactions emit `onCreate({ tool, asset, geometry })` for line and polygon completion.

- [ ] Write tests showing surface and line assets remain in 3D and produce GeoJSON geometry.
- [ ] Run the focused tests and confirm the current forced-2D behavior fails them.
- [ ] Implement multi-click line/polygon drawing with visible vertices, preview geometry, right-click/double-click completion, and Esc cancellation.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Render recognizable built-in procedural components

**Files:**
- Modify: `3D_scenes_edit/preview_3d/scene-to-cesium.js`
- Modify: `3D_scenes_edit/preview_3d/scene-preview-adapter.js`
- Test: `3D_scenes_edit/preview_3d/scene-to-cesium.test.js`
- Test: `3D_scenes_edit/preview_3d/scene-preview-adapter.test.js`

**Interfaces:**
- Seed catalog `renderer` values map to procedural component descriptors.
- Uploaded GLB assets continue to use the existing model path.

- [ ] Write tests proving seed assets are routed to category-specific procedural graphics instead of a universal labeled box.
- [ ] Run the focused tests and confirm they fail.
- [ ] Implement recognizable low-poly compositions for vegetation, seating/table, lighting/bin/signage, pavilion/shelter, fitness/play and simple structures.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Replace horizontal asset filters with grouped navigation

**Files:**
- Modify: `3D_scenes_edit/ui/scene-studio-panel.js`
- Modify: `3D_scenes_edit/style.css`
- Test: `3D_scenes_edit/ui/scene-studio-panel.test.js`

**Interfaces:**
- Asset panel exposes five fixed groups and a wrapped category grid; cards remain searchable.

- [ ] Write a rendering test showing grouped, non-horizontal category navigation.
- [ ] Run it and confirm the current single scrolling row fails.
- [ ] Implement group tabs, wrapped subcategories, and a vertically scrollable two-column card grid.
- [ ] Run the focused panel tests and confirm they pass.

### Task 5: Make studio exit and platform view state consistent

**Files:**
- Modify: `app.js`
- Modify: `3D_scenes_edit/integration/focus-mode.js` if lifecycle cleanup requires it
- Test: `3D_scenes_edit/integration/entrypoint-contract.test.js`

**Interfaces:**
- Closing the studio mounts the 2D map back in its platform home, calls `switchMainView('plan2d')`, refreshes the map target/size, and leaves Cesium hidden.

- [ ] Write an integration test for real 2D restoration rather than button-only state.
- [ ] Run it and confirm the current close function fails.
- [ ] Implement ordered viewport restoration and a post-close consistency correction.
- [ ] Run the focused integration tests and confirm they pass.

### Task 6: Stabilize platform and homepage top navigation layouts

**Files:**
- Modify: `style.css`
- Modify: `homepage/src/index.css`
- Test: `homepage/src/homepage-layout.test.js`

**Interfaces:**
- Platform workspace controls wrap/collapse secondary actions without obscuring the view switch.
- Homepage navigation uses equal outer tracks so the three links share the hero title's center axis.

- [ ] Write/update layout contract tests for equal-track homepage centering and responsive platform controls.
- [ ] Run them and confirm they fail against the current asymmetric grid.
- [ ] Implement the responsive layout CSS.
- [ ] Run homepage tests and `npm run build` from `homepage`.

### Task 7: Full verification and visual QA

**Files:**
- Verify only; do not create a commit unless the user requests one.

- [ ] Run all Node tests discovered under the repository.
- [ ] Run the homepage production build.
- [ ] Exercise boundary drawing, each asset geometry type, asset grouping, exit-to-2D, and homepage alignment in the existing local browser.
- [ ] Report remaining limitations honestly, especially procedural quality versus uploaded GLB assets.
