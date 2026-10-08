# Canonical Facade Rebuild Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a clean two-dimensional frontal-facade preview from the first real house photo using only one coarse four-corner selection plus known floor count.

**Architecture:** Reuse the existing four-corner rectification as an initial crop, then analyze broad horizontal bands and dark opening regions. Render a new canonical facade rather than pasting the whole photograph: sampled wall colors, simplified openings, procedural balcony rails, floor slabs, columns, roof, and base trim are composed onto a white canvas. Keep this as an isolated experiment until its visual result is accepted.

**Tech Stack:** Python 3, OpenCV, NumPy, pytest.

## Global Constraints

- Do not modify the webpage or production API in this prototype.
- Do not download or use a generative model.
- Do not create a Git commit.
- The only simulated manual annotation is one four-corner building quadrilateral; floor count is supplied by the existing building form.
- Output is a visual canonicalization, not a metric orthophoto.

---

### Task 1: Canonical Layout and Opening Detection

**Files:**
- Create: `experiments/facade_rebuild/__init__.py`
- Create: `experiments/facade_rebuild/canonicalize.py`
- Create: `experiments/facade_rebuild/test_canonicalize.py`

**Interfaces:**
- Consumes: a BGR facade image already rectified from four corners and an integer floor count.
- Produces: `build_floor_bands(height: int, floors: int) -> tuple[FloorBand, ...]` and `detect_openings(image: NDArray[np.uint8], band: FloorBand) -> tuple[Opening, ...]`.

- [ ] **Step 1: Write failing layout tests**

  Test that three floor bands are ordered, non-overlapping, remain inside the canvas, and reserve roof/base space. Test a synthetic facade containing two broad dark rectangles and thin railing lines; only the broad rectangles must be returned as openings.

- [ ] **Step 2: Run tests and verify RED**

  Run: `E:\anaconda3\envs\building_lama\Scripts\python.exe -m pytest experiments/facade_rebuild/test_canonicalize.py -v`

  Expected: collection/import failure because `canonicalize.py` does not exist.

- [ ] **Step 3: Implement minimal geometry analysis**

  Add immutable `FloorBand` and `Opening` dataclasses. Divide usable height using stable canonical proportions and detect large dark components after morphological removal of thin rail lines. Merge overlapping component boxes and reject edge noise.

- [ ] **Step 4: Run tests and verify GREEN**

  Run the Task 1 pytest command and expect all tests to pass.

### Task 2: Procedural Facade Renderer

**Files:**
- Modify: `experiments/facade_rebuild/canonicalize.py`
- Modify: `experiments/facade_rebuild/test_canonicalize.py`

**Interfaces:**
- Consumes: rectified BGR facade, `FloorBand` instances, detected openings, and `FacadeStyle` options.
- Produces: `render_canonical_facade(rectified: NDArray[np.uint8], floors: int) -> NDArray[np.uint8]`.

- [ ] **Step 1: Write failing renderer tests**

  Test that output has the requested dimensions, white exterior margins, horizontal floor slabs, and that a three-floor render contains procedural balcony rails only on the upper two levels.

- [ ] **Step 2: Run tests and verify RED**

  Run the Task 1 pytest command and expect failures because the renderer is missing.

- [ ] **Step 3: Implement the renderer**

  Sample bright wall pixels for a neutral facade color. Draw roof tiles, wall bands, slabs, base trim, upper-floor railings, ground-floor columns, and simplified framed openings. Copy only low-frequency color from the photo; do not paste complete floor strips.

- [ ] **Step 4: Run tests and verify GREEN**

  Run the Task 1 pytest command and expect all tests to pass.

### Task 3: Sample Runner and Visual Comparison

**Files:**
- Create: `experiments/facade_rebuild/run_sample.py`
- Create: `experiments/facade_rebuild/test_run_sample.py`
- Create at runtime: `rural_house_generator/runtime_storage/facade_rebuild/sample_01/*.png`

**Interfaces:**
- Consumes: `experiments/facade_layering/sample_01.json` and its staged input image.
- Produces: rectified input, canonical facade, edge overlay, and a side-by-side comparison.

- [ ] **Step 1: Write failing runner test**

  Test with a temporary synthetic image and manifest that the runner writes four readable images and returns their exact paths.

- [ ] **Step 2: Run tests and verify RED**

  Run: `E:\anaconda3\envs\building_lama\Scripts\python.exe -m pytest experiments/facade_rebuild/test_run_sample.py -v`

  Expected: collection/import failure because `run_sample.py` does not exist.

- [ ] **Step 3: Implement and run the real sample**

  Reuse `load_manifest` and `rectify_base`, call the canonical renderer with three floors, and write diagnostic images under ignored runtime storage.

- [ ] **Step 4: Verify tests and inspect output**

  Run both facade experiment test suites, execute the sample runner, and visually inspect the canonical output at full detail.

