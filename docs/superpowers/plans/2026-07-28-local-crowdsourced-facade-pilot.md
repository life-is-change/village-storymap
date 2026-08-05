# Local Crowdsourced Facade Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current task. Do not delegate work unless the user explicitly requests sub-agents.

**Goal:** 在本机完成一个不依赖 SAM3 的最小闭环：读取建筑已有照片或补充上传普通照片，人工标注立面四角并校正透视，将真实立面烘焙到简化建筑模型上，生成 GLB 并在现有页面中预览/回传。

**Architecture:** 保留现有预设建筑生成模式，在 `rural_house_generator` 内新增独立的“实景照片”工作流。浏览器负责照片选择、四角交互、参数填写和结果预览；本地 FastAPI 服务负责磁盘任务状态、图片校正和 Blender 调用；Blender 脚本生成矩形体量、简化屋顶和贴图立面。第一轮只验证人工可控基线，SAM3 自动分割在基线验收后另立计划。

**Tech Stack:** Python 3.12、FastAPI、Pydantic、OpenCV headless、Pillow、NumPy、pytest、Blender 3.6 Python、原生 JavaScript、Three.js/GLTFLoader。

## Global Constraints

- 不执行 `git commit`、`git push`、分支切换或历史改写；每个检查点仅展示状态和测试结果。
- 不修改或删除 `E:\anaconda3\envs\building_sam3`；新建隔离环境 `E:\anaconda3\envs\building_facade_pilot`。
- 不复制参考目录中的运行产物、缓存、内存任务存储或预设图片；只移植经确认必要的算法结构。
- 保留现有预设模式以及 `HOUSE_GENERATOR_MODEL_READY` 的 `postMessage` 协议。
- 所有运行时文件写入 `rural_house_generator/runtime_storage/`，并加入忽略规则。
- 自动化测试可使用程序生成的透视棋盘立面；真实效果验收使用 3–5 张实际普通照片。

---

### Task 1: Establish a clean local runtime

**Files:**
- Create: `rural_house_generator/backend/requirements-baseline.txt`
- Create: `rural_house_generator/backend/README.md`
- Modify: `.gitignore`

**Step 1: Record the baseline dependencies**

Create `requirements-baseline.txt` with pinned FastAPI, Uvicorn, multipart, Pydantic, OpenCV headless, Pillow, NumPy and pytest versions that support Python 3.12. Do not include Torch, Transformers or SAM3.

**Step 2: Create the isolated Conda environment**

Run:

```powershell
E:\anaconda3\Scripts\conda.exe create -p E:\anaconda3\envs\building_facade_pilot python=3.12 pip -y
E:\anaconda3\envs\building_facade_pilot\python.exe -m pip install -r rural_house_generator\backend\requirements-baseline.txt
```

Expected: both commands exit with code 0 and the existing `building_sam3` environment is untouched.

**Step 3: Add runtime ignores and operating notes**

Ignore `rural_house_generator/runtime_storage/`, backend caches and local `.env` files. Document the environment path, Blender path `D:\Blender\blender.exe`, startup command and health-check URL.

**Step 4: Verify imports**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -c "import fastapi, cv2, PIL, numpy, pydantic; print('baseline imports ok')"
```

Expected: `baseline imports ok`.

**Checkpoint:** Show `git diff --stat`, environment location and import output. Do not commit.

---

### Task 2: Add persistent local job storage and API skeleton

**Files:**
- Create: `rural_house_generator/backend/app/__init__.py`
- Create: `rural_house_generator/backend/app/config.py`
- Create: `rural_house_generator/backend/app/schemas.py`
- Create: `rural_house_generator/backend/app/job_store.py`
- Create: `rural_house_generator/backend/app/main.py`
- Create: `rural_house_generator/backend/tests/conftest.py`
- Create: `rural_house_generator/backend/tests/test_health.py`
- Create: `rural_house_generator/backend/tests/test_jobs.py`

**Step 1: Write failing API tests**

Cover:

- `GET /health` returns `{"status": "ok"}`.
- `POST /api/jobs` accepts one or more JPEG/PNG files plus building dimensions and returns a job ID.
- Uploaded files and `job.json` are written beneath a test runtime directory.
- `GET /api/jobs/{job_id}` survives a new `DiskJobStore` instance.
- Missing jobs return 404; unsupported and oversized files return 4xx with an explicit message.

**Step 2: Run tests to verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_health.py rural_house_generator\backend\tests\test_jobs.py -q
```

Expected: collection/import failure because the backend modules do not yet exist.

**Step 3: Implement the minimal API and disk store**

Implement `create_app(runtime_root: Path | None = None) -> FastAPI`, validated Pydantic request/result models, UUID job directories and atomic JSON replacement. Store only sanitized generated filenames; never trust an uploaded path.

**Step 4: Run tests to verify GREEN**

Run the same pytest command.

Expected: all Task 2 tests pass.

**Checkpoint:** Show test output and changed paths. Do not commit.

---

### Task 3: Implement manual four-corner facade rectification

**Files:**
- Create: `rural_house_generator/backend/app/facade/__init__.py`
- Create: `rural_house_generator/backend/app/facade/perspective.py`
- Modify: `rural_house_generator/backend/app/schemas.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Create: `rural_house_generator/backend/tests/test_perspective.py`
- Create: `rural_house_generator/backend/tests/test_prepare_api.py`

**Step 1: Write failing geometry and endpoint tests**

Generate a synthetic checker facade, warp it into a quadrilateral, then assert that `order_corners()` consistently returns top-left, top-right, bottom-right, bottom-left and `rectify_facade()` restores the expected rectangular image within a bounded pixel error. Test `POST /api/jobs/{job_id}/prepare` with normalized four-corner coordinates and verify `rectified_facade.png` plus artifact metadata are persisted.

**Step 2: Run tests to verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_perspective.py rural_house_generator\backend\tests\test_prepare_api.py -q
```

Expected: failures for missing rectification code and endpoint.

**Step 3: Implement rectification**

Validate four finite normalized points, reject degenerate polygons, convert them to source pixels, compute output dimensions from opposing edge lengths and apply `cv2.getPerspectiveTransform`/`cv2.warpPerspective`. Save a high-quality PNG and a small preview. Return explicit errors for invalid geometry.

**Step 4: Run tests to verify GREEN**

Run the Task 3 tests, then all backend tests.

Expected: all tests pass.

**Checkpoint:** Inspect the generated synthetic source and rectified preview. Do not commit.

---

### Task 4: Generate a textured GLB with Blender

**Files:**
- Create: `rural_house_generator/backend/app/blender/__init__.py`
- Create: `rural_house_generator/backend/app/blender/generate_building.py`
- Create: `rural_house_generator/backend/app/blender_service.py`
- Modify: `rural_house_generator/backend/app/schemas.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Create: `rural_house_generator/backend/tests/test_blender_service.py`
- Create: `rural_house_generator/backend/tests/test_generate_api.py`

**Step 1: Write failing command and API tests**

Assert that the Blender service constructs an argument-list process invocation without shell interpolation. Test missing Blender and missing prepared texture errors. Add an integration-marked smoke test that calls Blender against the synthetic facade and checks that a non-empty GLB is produced.

**Step 2: Run tests to verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_blender_service.py rural_house_generator\backend\tests\test_generate_api.py -q
```

Expected: missing implementation failures.

**Step 3: Implement the Blender generator**

Create a rectangular building using width, depth, wall height and roof height. UV-map the selected real facade to the front wall, apply a neutral compatible material to side/rear walls, add a simple gable or flat roof, set meter units, apply transforms and export GLB. The service captures stdout/stderr, enforces a timeout and persists artifact metadata.

**Step 4: Implement `POST /api/jobs/{job_id}/generate` and artifact download**

Return job status and a URL for `building.glb`. Never expose arbitrary filesystem paths.

**Step 5: Run unit and Blender smoke tests**

Run all backend tests, including the marked Blender smoke test with `BLENDER_EXECUTABLE=D:\Blender\blender.exe`.

Expected: all pass and a non-empty synthetic textured GLB exists in the test runtime.

**Checkpoint:** Report GLB size, Blender version and tests. Do not commit.

---

### Task 5: Add the real-photo browser workflow without breaking presets

**Files:**
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`
- Create: `rural_house_generator/photo-workflow.js`
- Create: `rural_house_generator/tests/photo-workflow.test.js`

**Step 1: Write failing pure-JavaScript tests**

Test normalized corner conversion, drag clamping, API payload construction, job-state transitions and generated-model message construction. Keep DOM-independent logic in `photo-workflow.js` so it can run under Node without adding a frontend framework.

**Step 2: Run tests to verify RED**

Run:

```powershell
node --test rural_house_generator\tests\photo-workflow.test.js
```

Expected: failure because the module does not exist.

**Step 3: Implement the photo mode UI**

Add a mode switch while leaving preset controls intact. The photo mode shall:

- show existing-photo placeholders supplied through query/context and allow supplemental multi-file upload;
- display the chosen photo on a canvas with four draggable corner handles;
- submit upload, prepare and generate operations with visible progress and recoverable error messages;
- load the returned GLB into the existing Three.js preview;
- export/download and send the same `HOUSE_GENERATOR_MODEL_READY` message shape used by preset mode.

If no existing-photo API is available locally, display an explicit “暂未接入已有照片库” state and keep supplemental upload fully functional; do not fabricate images.

**Step 4: Run frontend tests and syntax checks**

Run:

```powershell
node --test rural_house_generator\tests\photo-workflow.test.js
node --check rural_house_generator\photo-workflow.js
node --check rural_house_generator\app.js
```

Expected: all pass.

**Checkpoint:** Open the page locally, confirm preset generation still works, and exercise the complete synthetic-photo flow. Do not commit.

---

### Task 6: Verify the platform handoff and real-photo acceptance

**Files:**
- Modify only if required by a failing contract test: `app-3d.js`
- Create: `rural_house_generator/backend/tests/test_end_to_end.py`
- Update: `rural_house_generator/backend/README.md`

**Step 1: Add an end-to-end automated smoke test**

Use the synthetic perspective image to create, prepare and generate a job through FastAPI. Assert persisted state, downloadable GLB, MIME type and non-empty artifact.

**Step 2: Run the complete regression suite**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests -q
node --test rural_house_generator\tests\photo-workflow.test.js
node --check rural_house_generator\app.js
```

Expected: all tests pass.

**Step 3: Perform browser/platform integration verification**

Start the API and static server, open the generator through the main 3D application, generate a photo-textured GLB and confirm the parent receives and displays it. Modify `app-3d.js` only if the existing message contract demonstrably fails.

**Step 4: Perform real-photo visual acceptance**

For 3–5 ordinary building photos, record:

- whether four-corner correction succeeds after at most one manual adjustment;
- whether the main facade is legible and oriented correctly;
- whether doors/windows remain recognizable in the baked texture;
- generation duration and output size;
- known failures such as occlusion, severe obliqueness, reflections or insufficient resolution.

The phase is accepted when at least four samples produce usable front-facade GLBs without crashes. If real photos are not yet available, mark this single acceptance item as awaiting user samples while retaining the passing synthetic E2E result.

**Step 5: Document the exact local commands and limitations**

Update the README with startup, browser URL, supported image types/limits, runtime cleanup and the explicit statement that SAM3 and automatic facade understanding are not part of this baseline.

**Checkpoint:** Present test evidence, visual samples, limitations and `git status`. Do not commit.

---

## Deferred Phase: SAM3-assisted automation

After the user accepts the manual baseline quality, create a separate plan to establish a compatible CUDA/PyTorch/SAM3 environment, validate `E:\SAM3_PT` with a single image at conservative resolution, add facade-region suggestions as an optional helper, and retain manual four-corner fallback. Do not couple baseline generation to SAM3 availability.
