# 2D Cold Start and Facade Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 2D first-entry blank wait and make facade upload rectification understandable and recoverable.

**Architecture:** Bootstrap a pinned local OpenLayers browser build and initialize the map from fixed georeference metadata, then load overlays progressively. Add a strict-then-relaxed architectural-line detector and expose a browser fallback state when automatic rectification cannot produce a safe facade.

**Tech Stack:** Browser JavaScript, OpenLayers 10.8.0, Node test runner, FastAPI, OpenCV/NumPy, pytest.

## Global Constraints

- Preserve existing user changes in the dirty `learning` worktree.
- Keep OpenLayers pinned to 10.8.0; do not introduce a framework or bundler migration.
- Keep strict H0 output unchanged for images it already handles successfully.
- Never silently label an unrectified original as a standard facade.
- Roof cropping is shown only after rectification succeeds or the user explicitly chooses the original-image fallback.

---

### Task 1: Fast 2D bootstrap

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `features/ui/view-switcher.js`
- Test: `features/ui/2d-cold-start.test.js`

**Interfaces:**
- Produces: `window.__loadOpenLayers()` backed by local assets and a visible `setPlanMapLoadingState(isLoading, message)` transition.
- Changes: `resolveBasemapGeoref()` resolves from fixed metadata without loading `orthophoto.webp`.

- [ ] Write a failing source-level test asserting no `esm.sh/ol` imports and no `loadImageSize(BASEMAP_GEOREF.imageUrl)` dependency.
- [ ] Run `node --test features/ui/2d-cold-start.test.js` and confirm failure.
- [ ] Add the pinned local browser build and CSS, then replace dynamic imports with a local `window.ol` adapter.
- [ ] Make the 2D shell display a loading message before awaiting map creation and clear it immediately after creation.
- [ ] Remove the duplicate blocking selected-layer load from `switchTo2DView`; let the overlay renderer load missing data progressively.
- [ ] Rerun the focused test and `node --check` on changed JavaScript.

### Task 2: Relaxed H0 fallback

**Files:**
- Modify: `rural_house_generator/backend/app/facade/auto_rectify.py`
- Modify: `rural_house_generator/backend/tests/test_auto_rectify.py`

**Interfaces:**
- Produces: `detect_facade_quad(image)` with strict then relaxed passes and diagnostics key `detector_pass`.

- [ ] Add a failing regression test using a facade whose useful verticals are shorter than `width // 9`.
- [ ] Run the focused pytest and confirm strict-only detection fails.
- [ ] Extract line detection parameters, add the relaxed central-band candidate filter and robust boundary clustering.
- [ ] Keep area/out-of-bounds safety checks and return which pass succeeded.
- [ ] Run the focused rectifier/API tests.

### Task 3: Guided upload and recoverable failure

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Produces: fallback transition `error -> use_original -> rectified`, readable rectification errors, and UI actions `useOriginalBtn` / `retryPhotoBtn`.

- [ ] Add failing tests for the fallback transition and Chinese mapping of boundary-detection errors.
- [ ] Run the focused Node tests and confirm failure.
- [ ] Add the five-step progress copy and visible busy state during upload/rectification.
- [ ] On rectification failure, keep the preview and expose “使用原图继续” and “重新选择照片”.
- [ ] Make explicit fallback enable roof cropping/model generation without calling the failed rectified artifact.
- [ ] Rerun workflow tests and JavaScript syntax checks.

### Task 4: End-to-end verification

**Files:**
- Verify only.

**Interfaces:**
- Consumes: local static server, backend port 8011, actual uploaded `001-1.jpg` when available.

- [ ] Run all focused Node and Python tests.
- [ ] Start the local backend and verify `/health`.
- [ ] Upload the regression image and verify either relaxed-H0 success or an actionable fallback without losing the photo.
- [ ] Enter 2D from a cold page and verify the loading shell appears immediately and the map does not wait for orthophoto decoding.
- [ ] Inspect the final diff and report modified files and measured evidence.

