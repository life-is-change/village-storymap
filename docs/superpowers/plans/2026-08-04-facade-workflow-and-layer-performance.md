# Facade Workflow and Layer Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make facade rectification precede roof cropping, make the local backend reliably diagnosable/startable, and make 2D layer toggles incremental.

**Architecture:** Add a rectification API stage backed by a provider interface and a local DINO/H0 worker, then gate the browser crop UI on the returned rectified preview. Preserve the single OpenLayers vector layer but reuse features for unchanged layer keys and rebuild only newly enabled keys.

**Tech Stack:** Browser JavaScript, Node test runner, FastAPI, OpenCV/NumPy, Grounding DINO worker, existing global-H0 utilities, OpenLayers.

## Global Constraints

- Roof cropping is unavailable until rectification succeeds.
- Model generation never reads the original upload as its texture.
- Connection refusal must not surface as raw `Failed to fetch`.
- Ordinary layer toggles must not rebuild unchanged layers.
- Force refresh, space changes and realtime invalidation retain full rebuild semantics.

---

### Task 1: Browser workflow and service diagnostics

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/index.html`

**Interfaces:**
- Produces: `buildRectifyPath(jobId)`, rectification-aware state transitions, and `friendlyServiceError(error)`.

- [ ] Add failing Node tests proving `uploaded -> rectifying -> rectified -> preparing` order and readable connection-refused text.
- [ ] Run `node --test rural_house_generator/tests/photo-workflow.test.js` and confirm failure.
- [ ] Implement the helper/state changes and rerun until green.
- [ ] Update the UI so upload displays the original without a crop handle; rectification replaces the preview and enables roof cropping/model generation.

### Task 2: Backend rectification stage

**Files:**
- Create: `rural_house_generator/backend/app/facade/auto_rectify.py`
- Create: `rural_house_generator/backend/tests/test_rectify_api.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Modify: `rural_house_generator/backend/app/schemas.py`
- Modify: `rural_house_generator/backend/app/facade/direct_crop.py`

**Interfaces:**
- Produces: `POST /api/jobs/{job_id}/rectify`, `AutoFacadeRectifier.rectify(image) -> RectificationResult`.
- Changes: `prepare-direct` reads `artifacts/rectified_source.png` and rejects unrectified jobs.

- [ ] Add failing API tests for artifact persistence, state transition, and rejection of crop-before-rectify.
- [ ] Run focused pytest and confirm the expected failures.
- [ ] Implement a provider-injected rectifier and endpoint; default provider detects a conservative building envelope, fits facade line families, and performs one global H0.
- [ ] Save `rectified_source.png`, `rectified_preview.jpg`, and `rectification_diagnostics.json`.
- [ ] Run focused tests until green.

### Task 3: Reliable local launcher

**Files:**
- Create: `start_facade_generator.ps1`
- Create: `start_facade_generator.bat`
- Modify: `rural_house_generator/backend/README.md`

**Interfaces:**
- Produces: one command that starts port 8011, starts the static server on port 8000, and checks `/health`.

- [ ] Add a source-level test asserting the launcher contains both ports, the configured Python environment, hidden child processes, and health check.
- [ ] Run the test and confirm failure before creating scripts.
- [ ] Implement both launchers and document use.
- [ ] Run the source-level test and an actual `/health` request.

### Task 4: Incremental 2D overlay rendering

**Files:**
- Modify: `features/map-editing/overlay-renderer.js`
- Modify: `features/map-editing/overlay-renderer.test.js`
- Modify: `features/ui/space-panel-events.js`
- Modify: `app.js`

**Interfaces:**
- Changes: `refresh2DOverlay(deps, request, options)` accepts `{ forceFullRebuild }`; ordinary toggles reuse unchanged layer features.

- [ ] Add failing tests proving unchanged features are reused, disabled layers are dropped, and force refresh does not reuse.
- [ ] Run focused Node tests and confirm failure.
- [ ] Implement source-layer diffing and restrict build/database work to missing layer keys.
- [ ] Update button state before awaiting layer load and reserve force rebuild for explicit invalidation paths.
- [ ] Run focused tests and the full related Node suite.

### Task 5: End-to-end verification

**Files:**
- Verify only.

- [ ] Run all rural-house Node and Python tests plus overlay/UI tests.
- [ ] Run `node --check` on modified JavaScript.
- [ ] Start the backend and static server, verify `/health`, upload a synthetic perspective facade, rectify, crop, generate, and download a GLB.
- [ ] Inspect git diff for unrelated changes and report exact evidence.

