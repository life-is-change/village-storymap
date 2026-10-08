# Facade Shared-Seam Rectification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a new sample atlas whose main facade bands share aligned left, right, and floor boundaries while corrected openings blend without hard rectangular edges.

**Architecture:** Keep the existing per-plane Homography renderer, but add optional alpha feathering for overlay planes. Express the Image-2-style facade skeleton through identical destination coordinates in the sample manifest, render wall bands first, and render protrusions and openings afterward.

**Tech Stack:** Python 3, NumPy, OpenCV, pytest, JSON sample manifest.

## Global Constraints

- Work only in the experimental facade pipeline and ignored runtime output.
- Do not modify the production webpage or API.
- Do not create a Git commit.
- Use one main-wall horizontal interval for all facade bands.
- Use a 2 to 4 pixel blend at floor seams and a narrow polygon feather for opening overlays.

---

### Task 1: Masked Plane Composition

**Files:**
- Modify: `experiments/facade_25d/orthographic.py`
- Modify: `experiments/facade_25d/run_sample.py`
- Test: `experiments/facade_25d/test_orthographic.py`
- Test: `experiments/facade_25d/test_run_sample.py`

**Interfaces:**
- Consumes: existing `PlaneSpec`, `rectify_plane`, and `compose_planes` interfaces.
- Produces: `PlaneSpec.feather_px: int = 0`; `compose_planes` uses a feathered alpha mask when this value is positive.

- [ ] **Step 1: Write the failing feather-composition test**

Create a colored test plane over a contrasting canvas and assert that its center is unchanged while a boundary pixel is a blend of plane and background.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d\test_orthographic.py -q`

Expected: FAIL because `PlaneSpec` does not accept `feather_px`.

- [ ] **Step 3: Implement minimal alpha feathering**

Add `feather_px` validation and construct a distance-to-edge alpha mask inside the destination rectangle. Preserve direct copy when `feather_px == 0`.

- [ ] **Step 4: Add and verify manifest parsing**

Add a sample-manifest test with `"feather_px": 3`, parse it in `run_sample`, and verify the generated files remain valid images.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d -q`

Expected: all facade 2.5D tests pass.

### Task 2: Shared Facade Skeleton Sample

**Files:**
- Modify: `rural_house_generator/runtime_storage/facade_layering/sample_01/25d-manifest.json`
- Generate: `rural_house_generator/runtime_storage/facade_25d/sample_01-v5/02-orthographic-atlas.png`
- Generate: `rural_house_generator/runtime_storage/facade_25d/sample_01-v5/comparison.jpg`

**Interfaces:**
- Consumes: optional `feather_px` parsed by Task 1.
- Produces: an Image-2-style sample with a shared main-wall interval and blended opening overlays.

- [ ] **Step 1: Normalize destination geometry**

Set all main facade and floor bands to the same normalized left and right coordinates. Retain only the roof edge as a wider overlay. Ensure adjacent floor band boxes reuse identical seam values.

- [ ] **Step 2: Configure narrow overlay feathering**

Set opening overlays to a narrow feather value. Keep structural wall bands opaque so their geometry remains crisp.

- [ ] **Step 3: Render the v5 atlas**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m experiments.facade_25d.run_sample --manifest rural_house_generator\runtime_storage\facade_layering\sample_01\25d-manifest.json --output-dir rural_house_generator\runtime_storage\facade_25d\sample_01-v5`

Expected: overlay, orthographic atlas, and comparison images are written.

- [ ] **Step 4: Visually inspect the actual symptom**

Check that the main left and right edges no longer jump at floor seams, no background strip appears between bands, the entry door remains vertical, and opening patch edges are less conspicuous.

### Task 3: Regression Verification

**Files:**
- Verify: `experiments/facade_25d`
- Verify: `experiments/facade_rebuild`
- Verify: `experiments/facade_layering`

**Interfaces:**
- Consumes: Tasks 1 and 2 outputs.
- Produces: fresh automated and visual evidence for the result.

- [ ] **Step 1: Run the complete related test suite**

Run: `E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_25d experiments\facade_rebuild experiments\facade_layering -q`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Report remaining visual limitations honestly**

Distinguish residual parallax caused by balconies from actual atlas gaps or composition seams, and provide the v5 comparison image for review.
