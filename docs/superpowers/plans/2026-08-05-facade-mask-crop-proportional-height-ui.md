# Facade Mask Crop, Proportional Height and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove post-roof-cut side margins with the aligned SAM mask, derive photo-model height from facade aspect ratio and front length, and compact the photo-mode UI.

**Architecture:** `FullLocalFacadeRectifier` persists an aligned mask beside the rectified image. `prepare-direct` crops image and mask together, updates the job's authoritative dimensions, and Blender consumes those dimensions unchanged. The browser presents photo-specific inputs and uses the returned job dimensions for metrics.

**Tech Stack:** Python 3.12, OpenCV, FastAPI/Pydantic, Blender Python, vanilla JavaScript, CSS, Node test runner, pytest.

## Global Constraints

- Preset generation remains floor-based.
- Photo wall height is `front_length * texture_height / texture_width`.
- Existing jobs without an aligned mask use the legacy content crop.
- No new model dependency or network service is introduced.

---

### Task 1: Aligned mask crop

**Files:**
- Modify: `rural_house_generator/backend/app/facade/full_pipeline.py`
- Modify: `rural_house_generator/backend/app/facade/direct_crop.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Test: `rural_house_generator/backend/tests/test_direct_crop.py`

**Interfaces:**
- Produces: `crop_facade_body(image, crop_top, content_mask=None) -> np.ndarray`
- Produces artifact: `artifacts/building_mask_rectified.png` aligned with `rectified_source.png`

- [ ] Write a test whose white building mask occupies columns 24 through 95 and assert the result retains those columns plus two pixels of padding.
- [ ] Run `python -m pytest rural_house_generator/backend/tests/test_direct_crop.py -q` and confirm the new keyword argument fails.
- [ ] Crop the warped mask with the same `(x0, y0, x1, y1)` bounds as the rectified image and use mask column occupancy after the roof cut.
- [ ] Pass the stored aligned mask from `prepare-direct`; fall back to the legacy color heuristic when it is absent or invalid.
- [ ] Run the direct-crop and prepare API tests and confirm they pass.

### Task 2: Proportional photo height

**Files:**
- Modify: `rural_house_generator/backend/app/main.py`
- Test: `rural_house_generator/backend/tests/test_direct_prepare.py`
- Test: `rural_house_generator/backend/tests/test_generate_api.py`

**Interfaces:**
- Updates: `record["building"]["wall_height"]`
- Updates: `record["building"]["roof_height"]`

- [ ] Add a prepare API test using a 2:1 facade and 10 m front length; assert wall height becomes 5 m and hip roof height becomes 0.9 m.
- [ ] Run that test and confirm it fails with the submitted placeholder height.
- [ ] After final cropping, compute wall height from the texture shape and update the job; derive roof height by roof type.
- [ ] Run prepare and Blender-generation tests and verify the manifest contains the derived dimensions.

### Task 3: Photo-specific compact UI

**Files:**
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/photo-workflow.js`
- Test: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Produces: `photoHeightSummary(building) -> string`
- Consumes: `prepared.building` and `generated.building`

- [ ] Add a JavaScript test asserting the height summary formats the returned wall and total heights and that model metrics use returned dimensions.
- [ ] Run `node rural_house_generator/tests/photo-workflow.test.js` and confirm the missing helper fails.
- [ ] Add the read-only height summary, hide floor controls in photo mode, shorten the header copy and make desktop actions non-wrapping.
- [ ] Make `generatePhotoModel` read metrics from the prepared/generated job rather than the provisional upload form.
- [ ] Run Node tests and `node --check rural_house_generator/app.js`.

### Task 4: End-to-end verification

**Files:**
- Verify: local runtime artifacts under the current job directory

**Interfaces:**
- Consumes: ports 8011, 8012 and 8013 from `start_facade_generator.ps1`

- [ ] Run all backend and generator workflow tests.
- [ ] Restart the local services so the latest backend and UI are active.
- [ ] Re-run one real photo job through rectify, prepare and generate.
- [ ] Inspect `facade_texture.png` for side margins and `model_manifest.json` for the aspect-derived wall height.
