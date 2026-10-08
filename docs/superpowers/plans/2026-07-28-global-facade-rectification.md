# Global Facade Rectification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rectify the complete main facade with one transform fitted from multiple architectural lines so that floors share the same horizontal and vertical coordinate system.

**Architecture:** Fit horizontal and vertical vanishing points from normalized line segments, build one axis-aligned projective transform, then warp a single main-wall crop with uniform output scale. Keep the existing per-plane renderer only for non-coplanar overlays such as fascia, slab fronts, and canopies.

**Tech Stack:** Python 3, NumPy, OpenCV, pytest, JSON manifests.

## Global Constraints

- Work only in `experiments/facade_25d`, sample manifests, and ignored runtime output.
- Do not modify the production webpage, upload workflow, or API.
- Do not create a Git commit.
- No floor may define an independent main-wall Homography.
- Hidden pixels are not reconstructed in this iteration.

---

### Task 1: Vanishing-Point Geometry

**Files:**
- Create: `experiments/facade_25d/global_rectification.py`
- Create: `experiments/facade_25d/test_global_rectification.py`

**Interfaces:**
- Produces: `fit_vanishing_point(lines: NDArray) -> NDArray`; `build_axis_rectification(horizontal_lines: NDArray, vertical_lines: NDArray) -> NDArray`; `transform_points(points: NDArray, transform: NDArray) -> NDArray`.

- [ ] **Step 1: Write the failing synthetic-grid test**

Create orthogonal source lines, project them through a fixed perspective matrix, call `build_axis_rectification`, and assert transformed horizontal lines have endpoint `dy < 1e-3`, vertical lines have `dx < 1e-3`, and two separated segments from the same original vertical line have matching x-coordinates.

- [ ] **Step 2: Verify RED**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d\test_global_rectification.py -q`

Expected: import failure because `global_rectification.py` does not exist.

- [ ] **Step 3: Implement line fitting and one shared transform**

Convert each segment to a normalized homogeneous line with `np.cross`, fit the shared intersection with SVD, construct the vanishing line from the two fitted points, send it to infinity, and apply a 2 by 2 affine axis transform so fitted horizontal and vertical directions map to x and y.

- [ ] **Step 4: Add explicit degeneracy tests**

Assert fewer than two lines, zero-length segments, coincident vanishing directions, or non-finite values raise `ValueError` with a specific geometry error.

- [ ] **Step 5: Verify GREEN**

Run the focused test file and expect all geometry tests to pass.

### Task 2: Global Wall Warp

**Files:**
- Modify: `experiments/facade_25d/global_rectification.py`
- Modify: `experiments/facade_25d/test_global_rectification.py`

**Interfaces:**
- Produces: `GlobalWarpResult(image, mask, transform, diagnostics)` and `warp_global_wall(image, crop_polygon, horizontal_lines, vertical_lines, output_width, padding) -> GlobalWarpResult`.

- [ ] **Step 1: Write the failing warp test**

Warp a synthetic grid into perspective, rectify it through `warp_global_wall`, and assert the result has a non-empty crop mask, bounded dimensions, vertical grid columns within one pixel, and no independent floor seam.

- [ ] **Step 2: Verify RED**

Expected: failure because `warp_global_wall` is missing.

- [ ] **Step 3: Implement bounded uniform-scale output**

Transform the crop polygon, translate its minimum x and y to the requested padding, use one scalar for x and y based on `output_width`, warp both the BGR image and binary crop mask, and fill outside pixels with the configured background.

- [ ] **Step 4: Emit numeric diagnostics**

Return horizontal endpoint slope residuals, vertical endpoint slope residuals, output width and height, and the fitted vanishing points.

- [ ] **Step 5: Verify GREEN**

Run the focused geometry and warp tests and expect zero failures.

### Task 3: Global Sample Runner

**Files:**
- Create: `experiments/facade_25d/run_global_sample.py`
- Create: `experiments/facade_25d/test_run_global_sample.py`

**Interfaces:**
- Consumes manifest keys: `image`, `main_wall.crop_polygon`, `main_wall.horizontal_lines`, `main_wall.vertical_lines`, `output_width`, `padding`, and `background`.
- Produces files: `01-source-lines.png`, `02-global-wall.png`, `03-final-atlas.png`, `comparison.jpg`, and `diagnostics.json`.

- [ ] **Step 1: Write the failing runner test**

Create a temporary synthetic input and manifest, call `run_global_sample`, assert every output exists and decodes, and assert diagnostics report bounded horizontal and vertical residuals.

- [ ] **Step 2: Verify RED**

Expected: import failure because `run_global_sample.py` does not exist.

- [ ] **Step 3: Implement manifest validation and diagnostics rendering**

Parse normalized line endpoints and crop points, reject coordinates outside `[0, 1]`, render selected line sets in distinct colors, run `warp_global_wall`, and write images with the Unicode-safe project image helpers.

- [ ] **Step 4: Verify GREEN**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d\test_run_global_sample.py -q`

Expected: all runner tests pass.

### Task 4: Real Sample Validation

**Files:**
- Create: `rural_house_generator/runtime_storage/facade_layering/sample_03/global-manifest.json`
- Create: `rural_house_generator/runtime_storage/facade_layering/sample_01/global-manifest.json`
- Generate: `rural_house_generator/runtime_storage/facade_25d/sample_03-global/`
- Generate: `rural_house_generator/runtime_storage/facade_25d/sample_01-global/`

**Interfaces:**
- Consumes the global sample runner from Task 3.
- Produces two comparable real-photo outputs using no independent main-wall floor transforms.

- [ ] **Step 1: Configure sample 03 line sets**

Use clear jambs across the left, center, and right of the second photograph plus several eave and floor-slab lines. Use one crop polygon spanning both floors.

- [ ] **Step 2: Render and inspect sample 03**

Require first- and second-floor wall directions to agree, and require the runner's residual diagnostics to be within the configured tolerance.

- [ ] **Step 3: Configure and render sample 01**

Use railing bars and door or window jambs for the vertical set, balcony and slab edges for the horizontal set, and one main-wall crop spanning all floors.

- [ ] **Step 4: Compare against piecewise outputs**

Check cross-floor wall-line continuity, overall aspect ratio, and remaining overlay or occlusion artifacts. Do not claim hidden wall recovery.

### Task 5: Regression Verification

**Files:**
- Verify: `experiments/facade_25d`
- Verify: `experiments/facade_rebuild`
- Verify: `experiments/facade_layering`

**Interfaces:**
- Consumes all previous tasks.
- Produces fresh automated and visual evidence.

- [ ] **Step 1: Run the complete related test suite**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d experiments\facade_rebuild experiments\facade_layering -q`

Expected: zero failures.

- [ ] **Step 2: Run formatting checks and inspect real outputs**

Run `git diff --check` for the experiment and documentation files, then inspect both generated comparison images at original resolution.

- [ ] **Step 3: Report measured residuals and limitations**

Provide both comparison images, numeric line residuals, and a clear distinction between corrected wall geometry and unresolved occlusion or non-planar overlays.
