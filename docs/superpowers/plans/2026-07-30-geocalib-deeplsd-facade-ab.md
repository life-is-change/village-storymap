# GeoCalib and DeepLSD Facade A/B Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a reproducible four-variant A/B comparison of GeoCalib and DeepLSD against the current single-global-H0 plus structure-preserving-mesh baseline on facade samples 04, 05, and 06.

**Architecture:** An isolated `facade_model_ab` package wraps optional model inference behind dependency-injected adapters, converts every result into normalized coordinates, filters line candidates, runs the existing constrained rectifier, and writes comparable metrics and visual artifacts. Unit tests use deterministic fake model outputs; real inference is an explicit command using the existing `building_sam2` Python 3.10 CUDA environment and untracked checkpoints.

**Tech Stack:** Python 3.10, PyTorch 2.5.1 CUDA 12.1, GeoCalib, DeepLSD inference-only, NumPy, SciPy, OpenCV, pytest, JSON, HTML.

## Global Constraints

- Do not change the production upload UI, API, Blender path, or current sample manifests.
- Use only one global H0 followed by the existing bounded continuous mesh.
- Treat GeoCalib and DeepLSD as optional advisory inputs with baseline fallback.
- Do not download checkpoints during import or unit tests.
- Do not use DeepLSD Ceres refinement in this first trial.
- Do not perform generative occlusion removal in the A/B comparison.
- Preserve generated weights and image outputs as untracked runtime data.
- Run real inference on samples 04, 05, and 06 at their existing full resolution, with an internal inference resize recorded in diagnostics when required by a model.

---

### Task 1: Experiment Contracts and Fallback

**Files:**
- Create: `experiments/facade_model_ab/__init__.py`
- Create: `experiments/facade_model_ab/contracts.py`
- Create: `experiments/facade_model_ab/adapters.py`
- Create: `experiments/facade_model_ab/test_adapters.py`

**Interfaces:**
- Produces: `CalibrationResult`, `LineDetectionResult`, `ModelUnavailable`, `GeoCalibAdapter.calibrate(image)`, and `DeepLSDAdapter.detect(image)`.
- All point and segment arrays returned by adapters use normalized source-image coordinates in `[0, 1]`.

- [ ] Write a failing test that constructs unavailable adapters and asserts a structured fallback reason rather than an import-time exception.
- [ ] Run `E:\anaconda3\envs\building_sam2\python.exe -m pytest experiments/facade_model_ab/test_adapters.py -v` and verify the module-missing failure.
- [ ] Implement immutable result dataclasses, lazy imports, device selection, checkpoint validation, and dependency injection for fake backends.
- [ ] Add a failing test that verifies pixel-space DeepLSD output is normalized using the original image width and height.
- [ ] Implement normalization and finite/range validation, then run the focused tests until green.

### Task 2: Candidate Filtering and Geometry Metrics

**Files:**
- Create: `experiments/facade_model_ab/line_selection.py`
- Create: `experiments/facade_model_ab/metrics.py`
- Create: `experiments/facade_model_ab/test_line_selection.py`
- Create: `experiments/facade_model_ab/test_metrics.py`

**Interfaces:**
- Consumes: normalized line segments, scores, optional binary facade mask, and confirmed reference controls.
- Produces: `select_axis_lines(...) -> SelectedLines` and `measure_variant(...) -> dict[str, object]`.

- [ ] Write failing synthetic tests for minimum length, mask-support rejection, duplicate suppression, and horizontal/vertical vanishing-point consensus.
- [ ] Run both focused test files and verify they fail because the selectors are absent.
- [ ] Implement deterministic length/orientation prefiltering, mask-support sampling, robust vanishing-point fitting, inlier selection, and rejection-reason counts.
- [ ] Write failing metric tests for angular median/p95, inlier ratio, facade coverage, crop occupancy, and folded-triangle rejection.
- [ ] Implement metric calculation with JSON-safe finite values and run both focused suites until green.

### Task 3: Four-Variant Runner

**Files:**
- Create: `experiments/facade_model_ab/runner.py`
- Create: `experiments/facade_model_ab/test_runner.py`
- Reuse: `experiments/facade_25d/run_constrained_mesh.py`
- Reuse: `experiments/facade_25d/constrained_mesh.py`

**Interfaces:**
- Consumes: existing constrained manifest, optional model adapters, optional facade mask, and variant name.
- Produces: `run_sample_ab(...) -> dict[str, VariantResult]` for `baseline`, `geocalib`, `deeplsd`, and `combined`.

- [ ] Write a failing temporary-manifest integration test with fake calibration and line detections; assert four named results, one global H0 per successful variant, and baseline artifacts despite optional-model failure.
- [ ] Run the test and verify the runner-missing failure.
- [ ] Implement coordinate mapping for calibrated images, accepted/rejected automatic controls, safe merging with reference controls, and calls into the existing constrained rectifier.
- [ ] Persist per-variant `source-lines.png`, `working-image.png`, `rectified-facade.png`, `optimized-grid.png`, `comparison.jpg`, and `metrics.json`.
- [ ] Add tests that reject a calibration result when it worsens reference-line residuals beyond tolerance and that preserve the unmodified baseline manifest.
- [ ] Run the focused runner tests and existing `experiments/facade_25d` tests until green.

### Task 4: Reproducible Report and Linux Contract

**Files:**
- Create: `experiments/facade_model_ab/report.py`
- Create: `experiments/facade_model_ab/test_report.py`
- Create: `experiments/facade_model_ab/README.md`
- Create: `experiments/facade_model_ab/linux-requirements.txt`

**Interfaces:**
- Consumes: sample-level variant metrics.
- Produces: `summary.json`, `summary.csv`, `comparison.html`, and a Linux dependency/version record.

- [ ] Write a failing report test that includes one successful variant and one fallback, and asserts deterministic rows with no hidden failure.
- [ ] Implement report generation, relative artifact links, version capture, runtime timing, and optional CUDA peak-memory reporting.
- [ ] Document the exact Windows command, Linux command, model-cache locations, and inference-only DeepLSD limitation.
- [ ] Add pinned Linux package constraints compatible with a Python 3.10 CUDA worker, while keeping the experiment outside the current production Docker image.
- [ ] Run report tests and verify generated HTML references existing relative artifacts.

### Task 5: Install and Run Real Models

**Files:**
- Runtime clone: `rural_house_generator/runtime_storage/model_repos/GeoCalib/`
- Runtime clone: `rural_house_generator/runtime_storage/model_repos/DeepLSD/`
- Runtime weights: `rural_house_generator/runtime_storage/model_weights/`
- Generate: `rural_house_generator/runtime_storage/facade_model_ab/`

**Interfaces:**
- Uses `E:\anaconda3\envs\building_sam2\python.exe` with CUDA when available.
- Uses the official GeoCalib repository and the outdoor `deeplsd_md` checkpoint.

- [ ] Record the pre-install Python, PyTorch, CUDA, GPU, and package state.
- [ ] Clone official repositories into the untracked runtime model directory and install only inference dependencies into `building_sam2`.
- [ ] Download official checkpoints, record SHA-256 and byte size, and confirm each model loads independently.
- [ ] Run one smoke inference on a resized copy of sample 06 and record time and CUDA memory before launching the matrix.
- [ ] Run all four variants for samples 04, 05, and 06; a model failure must be recorded rather than aborting the matrix.
- [ ] Generate the summary report and inspect every output image at original detail.

### Task 6: Verification and Decision

**Files:**
- Verify: `experiments/facade_model_ab/`
- Verify: `experiments/facade_25d/`
- Inspect: `rural_house_generator/runtime_storage/facade_model_ab/`

**Interfaces:**
- Produces fresh automated-test evidence, artifact validation, and a keep/reject recommendation for each optional model.

- [ ] Run the complete new suite and all related facade regression suites with zero failures.
- [ ] Decode every generated image, validate every metrics JSON, require zero folded triangles, and confirm baseline files exist for every sample.
- [ ] Compare geometric residuals, facade coverage, runtime, and visible distortions across the 12 sample/variant combinations.
- [ ] Run `git diff --check`, inspect scoped Git status, and verify weights and generated artifacts are not staged.
- [ ] Report which model helps which failure mode, whether the combined variant meets the two-of-three success criterion, exact disk/VRAM costs, and the remaining Linux packaging work.
