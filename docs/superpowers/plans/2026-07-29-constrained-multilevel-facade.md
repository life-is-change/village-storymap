# Constrained Multilevel Facade Rectification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-storey facade rectifier that uses one global H0, a bounded continuous mesh optimized by SciPy, and one OpenCV remap pass.

**Architecture:** `constrained_mesh.py` owns geometry, residual construction, least-squares optimization and triangular inverse-map rasterization. `run_constrained_mesh.py` owns manifest validation and diagnostic artifact generation. The established global vanishing-point functions remain the only projective stage.

**Tech Stack:** Python 3.12, NumPy, SciPy `least_squares`, OpenCV, pytest, JSON manifests.

## Global Constraints

- Do not compute an independent Homography for any floor or overlay.
- Use one global H0 fitted from features across the complete facade.
- Limit local correction to a shared bounded continuous mesh.
- Call `cv2.remap` exactly once for the final image.
- Preserve original photographic content and use no generative model.
- Work only in the experiment, documentation, sample manifest and ignored runtime output.
- Do not create a Git commit.

---

### Task 1: Joint Mesh Optimizer

**Files:**
- Create: `experiments/facade_25d/constrained_mesh.py`
- Create: `experiments/facade_25d/test_constrained_mesh.py`

**Interfaces:**
- Produces: `build_global_canvas_transform(...)`, `optimize_mesh(...)`, `map_points_with_mesh(...)`, `remap_with_triangular_mesh(...)`, and `rectify_with_constrained_mesh(...)`.

- [ ] Write a synthetic failing test whose initial H0 lines retain controlled local offsets and whose optimized residual is lower while boundary vertices remain unchanged.
- [ ] Run the focused test and verify the missing-module failure.
- [ ] Implement H0 canvas placement and bilinear displacement evaluation.
- [ ] Implement a single `least_squares` residual vector containing line, axis, level, boundary, scale, smoothness and magnitude terms.
- [ ] Add bounded optimization and reject folded triangles.
- [ ] Write a failing call-count test and implement triangular inverse-map construction followed by exactly one `cv2.remap` call.
- [ ] Run the focused tests until green.

### Task 2: Manifest Runner and Diagnostics

**Files:**
- Create: `experiments/facade_25d/run_constrained_mesh.py`
- Create: `experiments/facade_25d/test_run_constrained_mesh.py`

**Interfaces:**
- Consumes: the global wall keys plus `mesh.columns`, `mesh.rows`, `mesh.max_displacement_px`, `mesh.weights`, `mesh.axis_groups`, and `mesh.level_groups`.
- Produces: `01-source-controls.png`, `02-rectified-facade.png`, `03-optimized-grid.png`, `comparison.jpg`, and `transform-parameters.json`.

- [ ] Write a failing temporary-manifest integration test.
- [ ] Verify it fails because the runner is absent.
- [ ] Implement normalized geometry validation and conversion.
- [ ] Draw source line/group controls and target base/optimized grids.
- [ ] Serialize H0, mesh vertices, optimizer diagnostics, constraint residuals and `resample_passes: 1`.
- [ ] Run the integration test until green.

### Task 3: Two-Storey Real Sample

**Files:**
- Create: `rural_house_generator/runtime_storage/facade_layering/sample_04/constrained-manifest.json`
- Generate: `rural_house_generator/runtime_storage/facade_25d/sample_04-constrained/`

**Interfaces:**
- Uses the current two-storey source photograph and its global controls.
- Adds shared rows for the eave, balcony, ground-floor lintel and wall base plus cross-floor column groups.

- [ ] Configure a modest mesh with fixed outer boundaries and displacement limits no larger than 28 px horizontally and 20 px vertically.
- [ ] Run the new sample runner under an environment that provides SciPy.
- [ ] Inspect the source control overlay, final facade and optimized grid at original resolution.
- [ ] Adjust only manifest control selections or weights if a control line is inaccurate; do not introduce another Homography.

### Task 4: Regression Verification

**Files:**
- Verify: `experiments/facade_25d`, `experiments/facade_rebuild`, and `experiments/facade_layering`.

**Interfaces:**
- Produces fresh test, artifact and parameter evidence.

- [ ] Run the complete related pytest suite with the SciPy-capable environment and require zero failures.
- [ ] Decode every generated image, verify the parameter JSON, and verify no triangle is folded.
- [ ] Run `git diff --check` and inspect scoped Git status without committing.
- [ ] Report the corrected image, control-line debug image, transform parameters and remaining non-planar/occlusion limitations.
