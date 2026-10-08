# Facade Body Crop and Independent Roof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a contextual generate action, one draggable roof boundary, automatic left/right blank trimming, and selectable generated roofs to the direct facade workflow.

**Architecture:** The browser owns only the normalized top crop and roof selection. A focused OpenCV module performs deterministic body cropping, while Blender independently creates the selected roof mesh and writes its object name to the existing manifest.

**Tech Stack:** HTML/CSS, browser JavaScript, Node test runner, FastAPI/Pydantic, OpenCV, pytest, Blender Python.

## Global Constraints

- Students adjust one horizontal roof boundary only.
- Left/right blank margins are automatic and fail open to full width.
- Default roof is `hip`; supported values are `hip`, `gable`, and `flat`.
- Sloped roof height is exactly `wall_height * 0.18`; flat cap height is `max(0.2, wall_height * 0.04)`.
- Preset generation and platform handoff remain unchanged.

---

### Task 1: Browser crop and contextual action

**Files:** `rural_house_generator/photo-workflow.js`, `rural_house_generator/tests/photo-workflow.test.js`, `rural_house_generator/index.html`, `rural_house_generator/style.css`, `rural_house_generator/app.js`

- [ ] Add failing tests for `clampCropTop`, `automaticRoofHeight`, and `buildDirectPreparePath`.
- [ ] Run `node --test --test-isolation=none rural_house_generator/tests/photo-workflow.test.js` and confirm missing-function failures.
- [ ] Implement the pure helpers and rerun the tests green.
- [ ] Add the preview overlay, draggable horizontal handle, excluded-area shade, roof selector, and disabled contextual generate button.
- [ ] Bind pointer movement to normalized crop state, synchronize both generate buttons, and send `/prepare-direct?crop_top=<value>`.
- [ ] Run Node tests and syntax checks.

### Task 2: Deterministic wall-body crop

**Files:** create `rural_house_generator/backend/app/facade/direct_crop.py`, create `rural_house_generator/backend/tests/test_direct_crop.py`, modify `rural_house_generator/backend/app/main.py`, modify `rural_house_generator/backend/tests/test_direct_prepare.py`

- [ ] Add failing unit tests with literal expected bounds for top removal, automatic white-margin removal, preservation of internal white walls, and fail-open behavior.
- [ ] Add failing API tests for normalized crop input and canonical output size.
- [ ] Implement `crop_facade_body(image, crop_top) -> np.ndarray` using corner-background distance, grayscale edges, column evidence, and safety padding.
- [ ] Validate `crop_top` at the API boundary and write the returned crop as `facade_texture.png`.
- [ ] Run direct-crop, direct-prepare, and legacy preparation regression tests.

### Task 3: Independent selectable roofs

**Files:** `rural_house_generator/backend/app/schemas.py`, `rural_house_generator/backend/app/blender/generate_building.py`, `rural_house_generator/backend/tests/test_generate_api.py`, `rural_house_generator/backend/tests/test_end_to_end.py`

- [ ] Change real Blender tests first to submit `roof_type=hip`, derive the 18% height, and require `Hipped roof` alongside body and facade objects.
- [ ] Run the focused tests and confirm failure against the roofless generator.
- [ ] Extend `BuildingSpec` with `hip`; implement a four-slope roof mesh; restore gable and flat roof dispatch with dark neutral material.
- [ ] Register the correct roof in `model_manifest.json` and keep the wall texture isolated to `Photo facade`.
- [ ] Run focused real-Blender tests and the complete backend suite.

### Task 4: Browser acceptance

**Files:** runtime artifacts only unless a failing regression requires a tested source fix.

- [ ] Run all Node tests, syntax checks, backend tests, and `git diff --check`.
- [ ] Open the live page, upload the supplied corrected facade, move the roof boundary, choose `四坡屋顶`, and click the contextual generate button.
- [ ] Verify the canonical texture excludes the photographed roof and has narrower width than the source when blank margins exist.
- [ ] Verify the GLB header, object manifest, front texture orientation, white side/rear walls, and independent hipped roof visually.
