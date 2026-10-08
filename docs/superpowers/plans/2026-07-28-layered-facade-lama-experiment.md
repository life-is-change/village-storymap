# Layered Facade + LaMa Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 1 号真实房屋照片验证“主墙与阳台分层透视校正 + LaMa 遮挡补洞”能否生成可用的单张正立面贴图。

**Architecture:** 以现有四点透视模块为基础，新增与网页/API 解耦的分层合成核心。主墙四边形生成目标画布；每个阳台正面四边形独立拉正为轴对齐图层并羽化叠加。LaMa 作为独立进程处理显式遮挡蒙版，失败时保留未补洞结果，不让模型依赖污染现有 `building_facade_pilot` 环境。

**Tech Stack:** Python 3.12、OpenCV、NumPy、pytest；独立 Python 3.11 LaMa 环境、PyTorch/CUDA；PNG 调试产物。

## Global Constraints

- 不执行 `git commit`、`git push`、分支切换或历史改写。
- 不修改网页、FastAPI 和 Blender 流程；本轮只建立 `experiments/facade_layering/` 离线实验。
- 不修改 `E:\anaconda3\envs\building_sam3`；LaMa 使用新的隔离环境 `E:\anaconda3\envs\building_lama`。
- 输入照片和生成图片写入 Git 忽略的 `rural_house_generator/runtime_storage/facade_layering/`。
- 第一轮只要求楼层、门窗位置和阳台总体形态基本保持；栏杆、窗格、文字、污渍不作为准确性指标。
- 任何自动建议均允许人工覆盖；真实照片验收以分阶段对照图为准。

---

### Task 1: Add tested layered projective composition

**Files:**
- Create: `experiments/facade_layering/__init__.py`
- Create: `experiments/facade_layering/layered_rectify.py`
- Create: `experiments/facade_layering/test_layered_rectify.py`

**Interfaces:**
- Produces: `LayerSpec(source_quad: np.ndarray, destination_box: tuple[float, float, float, float], feather_px: int)`。
- Produces: `rectify_base(image, source_quad, output_size) -> tuple[np.ndarray, np.ndarray]`，返回校正图和源图到画布的单应矩阵。
- Produces: `composite_planar_layer(canvas, source, spec) -> tuple[np.ndarray, np.ndarray]`，返回合成图与覆盖蒙版。

- [ ] **Step 1: Write failing synthetic geometry tests**

```python
def test_balcony_layer_is_rectangular_after_composition():
    source, base_quad, balcony_quad = make_skewed_facade_fixture()
    canvas, _ = rectify_base(source, base_quad, (640, 480))
    result, mask = composite_planar_layer(
        canvas,
        source,
        LayerSpec(balcony_quad, (0.1, 0.25, 0.9, 0.45), feather_px=0),
    )
    assert result.shape == (480, 640, 3)
    assert mask[120:216].mean() > 250
    assert vertical_edge_error(result, (64, 120, 576, 216)) < 2.0
```

```python
def test_feathered_layer_has_no_binary_edge_jump():
    result, mask = composite_planar_layer(... feather_px=8)
    assert 0 < mask[boundary_y, center_x] < 255
```

- [ ] **Step 2: Run RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering\test_layered_rectify.py -q
```

Expected: collection fails because `layered_rectify` does not exist.

- [ ] **Step 3: Implement the minimal geometry core**

Validate each quadrilateral with the existing `order_corners()` contract, use `cv2.getPerspectiveTransform` and `cv2.warpPerspective`, convert normalized destination boxes to literal pixel rectangles, and alpha-composite with an optional Gaussian-feathered mask. Reject boxes outside `[0, 1]` or with zero area.

- [ ] **Step 4: Run GREEN and the existing perspective tests**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering\test_layered_rectify.py rural_house_generator\backend\tests\test_perspective.py -q
```

Expected: all tests pass.

---

### Task 2: Add a deterministic experiment manifest and renderer

**Files:**
- Create: `experiments/facade_layering/manifest.py`
- Create: `experiments/facade_layering/render_experiment.py`
- Create: `experiments/facade_layering/test_manifest.py`
- Create: `experiments/facade_layering/sample_01.json`

**Interfaces:**
- Produces: `load_manifest(path: Path, image_shape: tuple[int, int]) -> ExperimentManifest`。
- Produces: CLI `python -m experiments.facade_layering.render_experiment --manifest ... --output-dir ...`。
- Manifest contains `image`, `output_size`, `base_quad`, `layers[]`, and optional `occlusion_mask` paths using normalized coordinates.

- [ ] **Step 1: Write failing validation tests**

Use literal JSON fixtures to assert that four normalized points load successfully; three points, self-crossing quadrilaterals, invalid destination boxes and paths outside the manifest directory are rejected with explicit messages.

- [ ] **Step 2: Run RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering\test_manifest.py -q
```

Expected: import failure for the missing manifest module.

- [ ] **Step 3: Implement manifest loading and stage renderer**

Write `01-base-rectified.png`, one `02-layer-XX.png` per balcony layer, `03-layered.png`, and `debug-overlay.png`. Resolve input paths relative to the manifest and refuse path traversal. The renderer must not call LaMa yet.

- [ ] **Step 4: Run GREEN and syntax checks**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering -q
E:\anaconda3\envs\building_facade_pilot\python.exe -m compileall -q experiments\facade_layering
```

Expected: all tests pass and compilation exits 0.

---

### Task 3: Integrate LaMa through an isolated subprocess

**Files:**
- Create: `experiments/facade_layering/inpaint_provider.py`
- Create: `experiments/facade_layering/lama_worker.py`
- Create: `experiments/facade_layering/test_inpaint_provider.py`
- Modify: `experiments/facade_layering/render_experiment.py`

**Interfaces:**
- Produces: `run_lama(image_path, mask_path, output_path, python_executable, timeout_seconds=300) -> InpaintResult`。
- `InpaintResult` contains `provider`, `output_path`, `elapsed_seconds`, `notes` and never silently reports LaMa when fallback output was used.

- [ ] **Step 1: Write failing provider-contract tests**

Use a temporary executable script as the real subprocess boundary. Assert argument-list invocation, successful output validation, timeout reporting, missing executable handling, and preservation of the layered image when the worker fails.

- [ ] **Step 2: Run RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering\test_inpaint_provider.py -q
```

Expected: import failure for the missing provider.

- [ ] **Step 3: Implement the provider and isolated environment**

Create `E:\anaconda3\envs\building_lama` with Python 3.11, install a CUDA-compatible PyTorch build and a maintained LaMa wrapper, then make `lama_worker.py` load the local LaMa checkpoint and write the requested PNG. Keep downloads and model caches outside Git.

- [ ] **Step 4: Run GREEN and a real LaMa smoke test**

Generate a small striped synthetic image with a rectangular hole. Verify the worker exits 0, writes a decodable image with the same dimensions, and `nvidia-smi` shows GPU use when CUDA is available.

---

### Task 4: Produce and inspect the real-photo comparison

**Files:**
- Modify: `experiments/facade_layering/sample_01.json`
- Runtime only: `rural_house_generator/runtime_storage/facade_layering/sample_01/*`

- [ ] **Step 1: Copy the supplied photo into ignored runtime storage**

Copy `C:\Users\MR\AppData\Local\Temp\codex-clipboard-f59ea6f8-3dee-43f4-a5cb-4ff3b89fc050.jpg` to the sample runtime directory without altering the original.

- [ ] **Step 2: Record manual normalized geometry**

Mark the outer main-wall quadrilateral and separate front-plane quadrilaterals for the two dominant upper balconies. Add only conservative occlusion masks for clothes, wires or isolated foreground objects; do not mask doors, windows or an entire balcony.

- [ ] **Step 3: Render all stages**

Produce the original annotation overlay, base-only rectification, layered rectification, LaMa result and a side-by-side contact sheet. Record output dimensions and elapsed time.

- [ ] **Step 4: Visual QA**

Inspect at original detail and at a 768-pixel preview. Check that verticals are upright, floor bands are horizontal, door/window ordering is unchanged, balcony bands remain at the correct floors, and LaMa does not introduce a conspicuous false opening.

- [ ] **Step 5: Run complete regression tests and report status**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_layering rural_house_generator\backend\tests -q
git status --short
```

Expected: tests pass; no runtime images are tracked; no commit is created.

