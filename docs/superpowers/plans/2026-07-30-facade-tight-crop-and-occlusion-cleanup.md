# Facade Tight Crop and Occlusion Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate faithful tight front-elevation atlases and separate local-LaMa cleanup candidates for samples 04 and 05.

**Architecture:** Keep one global `H0`, but replace the single inner-rectangle crop with union-bounds placement plus a transformed multi-polygon front-surface mask. Tight-crop the masked atlas and run occlusion cleanup only as an optional second output.

**Tech Stack:** Python 3.11, NumPy, OpenCV, Pillow, pytest, existing SimpleLaMa worker.

## Global Constraints

- One global `H0` per photograph; no per-floor Homography.
- Faithful output samples source pixels once.
- Default final padding is zero.
- LaMa output is separate and never overwrites the faithful atlas.
- Protected unmasked pixels must remain byte-identical in the cleaned composite.

---

### Task 1: Union Canvas and Tight Alpha Crop

**Files:**
- Modify: `experiments/facade_25d/constrained_mesh.py`
- Test: `experiments/facade_25d/test_constrained_mesh.py`

**Interfaces:**
- Produces: `build_union_canvas_transform(...) -> GlobalCanvasGeometry`
- Produces: `tight_crop_rgba(image, mask, padding=0) -> tuple[np.ndarray, np.ndarray, tuple[int, int, int, int]]`

- [ ] Write failing tests proving all transformed crop vertices remain inside the union canvas and a zero-padding alpha crop touches all four sides.
- [ ] Run the focused tests and confirm failure because the new interfaces do not exist.
- [ ] Implement union min/max bounds and mask-based RGBA tight cropping.
- [ ] Run focused and complete `experiments/facade_25d` tests.

### Task 2: Shared-H0 Front-Surface Masks

**Files:**
- Create: `experiments/facade_25d/front_surface_atlas.py`
- Create: `experiments/facade_25d/test_front_surface_atlas.py`

**Interfaces:**
- Consumes: global transform and normalized source polygons.
- Produces: `render_front_surface_atlas(image, transform, polygons, output_size, padding=0) -> FrontSurfaceAtlasResult`.

- [ ] Write failing tests for multiple stepped polygons sharing one transform, transparent side regions and single-pass remapping.
- [ ] Run tests and confirm the renderer is missing.
- [ ] Implement polygon transformation, raster mask union, one `cv2.remap`, RGBA assembly and tight crop.
- [ ] Verify focused and complete tests.

### Task 3: Sample Runner and Manifests

**Files:**
- Create: `experiments/facade_25d/run_front_surface_sample.py`
- Create: `experiments/facade_25d/test_run_front_surface_sample.py`
- Modify: `rural_house_generator/runtime_storage/facade_layering/sample_04/constrained-manifest.json`
- Modify: `rural_house_generator/runtime_storage/facade_layering/sample_05/constrained-manifest.json`

**Interfaces:**
- Consumes: `front_surfaces` polygon list and existing H0 controls.
- Produces: faithful RGBA, preview, mask, comparison and diagnostics JSON.

- [ ] Write a failing integration test for decoded outputs, zero-padding tight bounds and one resample pass.
- [ ] Add front-surface polygons for roof fascia, upper wall, balcony fascia and visible ground wall.
- [ ] Implement the runner using Task 2 without additional Homographies.
- [ ] Render samples 04 and 05 and visually inspect boundaries.

### Task 4: Conservative LaMa Candidate

**Files:**
- Create: `experiments/facade_25d/occlusion_cleanup.py`
- Create: `experiments/facade_25d/test_occlusion_cleanup.py`
- Modify: sample 04 and 05 manifests with optional `occlusion_polygons` and `protected_polygons`.

**Interfaces:**
- Produces: `build_cleanup_mask(...) -> np.ndarray`.
- Produces: `composite_inpainted_candidate(faithful, inpainted, mask) -> np.ndarray`.

- [ ] Write failing tests proving protected regions are removed from the cleanup mask and unmasked pixels remain byte-identical.
- [ ] Implement mask construction and exact masked compositing.
- [ ] Invoke the existing `run_lama` worker with `E:/anaconda3/envs/building_lama/Scripts/python.exe`.
- [ ] Generate cleaned candidates without replacing faithful outputs.

### Task 5: Final Verification

**Files:**
- Verify all files above.

- [ ] Run `E:/anaconda3/envs/building_facade_pilot/python.exe -m pytest experiments/facade_25d experiments/facade_layering -q`.
- [ ] Check diagnostics: zero folded triangles, one faithful resample, zero-padding alpha bounds touching all edges.
- [ ] Compare faithful and cleaned outputs visually and report any retained large occlusions or generated uncertainty.
