# External Facade Texture Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open Doubao with a copyable correction prompt, upload one already-corrected front elevation, and generate a white-box GLB with that image mapped upright to its front face.

**Architecture:** Keep preset generation unchanged. Replace only the active photo-mode UI and state with a single-file direct-texture flow. Add a dedicated backend direct-preparation endpoint that decodes the single stored image into the canonical texture artifact without any crop or warp, then reuse the existing Blender generation and artifact download boundary with a simplified white-box mesh.

**Tech Stack:** Static HTML/CSS, browser JavaScript, Node.js built-in test runner, FastAPI/Pydantic, OpenCV, pytest, Blender Python (`bpy`), Three.js GLB preview.

## Global Constraints

- The prompt text is exactly `把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影`.
- The external link is `https://www.doubao.com/chat/`, opens in a new tab, and uses `rel="noopener noreferrer"`.
- Accept exactly one JPEG or PNG no larger than 10 MB in the direct workflow.
- Do not perform local perspective correction, corner editing, cropping, segmentation, or generative repair.
- Map the complete uploaded image once to the front plane; keep the side, rear, and top surfaces neutral white.
- Do not add separate roof geometry in direct-texture mode.
- Preserve preset generation and the existing `village-house-generator:model-ready` handoff contract.
- Preserve unrelated user changes already present in the dirty worktree.

---

### Task 1: Direct-workflow browser contract and interface

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`

**Interfaces:**
- Produces: `CORRECTION_PROMPT: string`, `validateStandardFacadeFiles(files): { ok: true, file: File } | { ok: false, message: string }`, and direct workflow transitions `idle -> uploading -> preparing -> generating -> generated`.
- Consumes: existing `buildBuildingFields(config)` and `buildModelReadyMessage(options)` contracts.

- [ ] **Step 1: Write failing frontend contract tests**

Extend the imports and add tests equivalent to:

```js
const {
  CORRECTION_PROMPT,
  validateStandardFacadeFiles,
  transitionJobState
} = require('../photo-workflow.js');

test('exports the approved Doubao correction prompt verbatim', () => {
  assert.equal(
    CORRECTION_PROMPT,
    '把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影'
  );
});

test('direct facade upload accepts exactly one supported image up to 10 MB', () => {
  const jpeg = { name: 'facade.jpg', type: 'image/jpeg', size: 1024 };
  assert.deepEqual(validateStandardFacadeFiles([jpeg]), { ok: true, file: jpeg });
  assert.match(validateStandardFacadeFiles([]).message, /一张/);
  assert.match(validateStandardFacadeFiles([jpeg, jpeg]).message, /只能上传一张/);
  assert.match(
    validateStandardFacadeFiles([{ name: 'x.webp', type: 'image/webp', size: 5 }]).message,
    /JPG 或 PNG/
  );
  assert.match(
    validateStandardFacadeFiles([{ name: 'large.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }]).message,
    /10 MB/
  );
});

test('direct workflow keeps preparation but skips corner correction state', () => {
  assert.equal(transitionJobState('idle', 'upload'), 'uploading');
  assert.equal(transitionJobState('uploading', 'uploaded'), 'preparing');
  assert.equal(transitionJobState('preparing', 'prepared'), 'generating');
  assert.equal(transitionJobState('generating', 'generated'), 'generated');
});
```

- [ ] **Step 2: Run the focused Node tests and confirm failure**

Run: `node --test rural_house_generator/tests/photo-workflow.test.js`

Expected: FAIL because `CORRECTION_PROMPT` and `validateStandardFacadeFiles` are not exported.

- [ ] **Step 3: Implement the pure JavaScript contract**

Add the exact prompt constant and a single-file validator to `photo-workflow.js`:

```js
const CORRECTION_PROMPT = '把带透视的建筑实拍图，转换成规整干净、轴线对齐、材质统一的标准建筑正立面投影';

function validateStandardFacadeFiles(files) {
  const selected = Array.from(files || []);
  if (selected.length !== 1) {
    return { ok: false, message: selected.length ? '只能上传一张标准正立面图。' : '请选择一张标准正立面图。' };
  }
  const file = selected[0];
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return { ok: false, message: '请选择 JPG 或 PNG 标准正立面图。' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, message: `${file.name} 超过 10 MB，请压缩后重试。` };
  }
  return { ok: true, file };
}
```

Export both names while retaining the existing exports.

- [ ] **Step 4: Replace the photo-mode markup and styles**

In `index.html`, rename the mode to `标准正立面贴图`, remove the multiple-file attribute, existing-photo list, roof inputs, and four-corner canvas. Add:

```html
<div class="external-correction">
  <p>先用豆包把实拍图处理成标准正立面，再回到这里上传。</p>
  <textarea id="correctionPrompt" readonly></textarea>
  <div class="external-correction-actions">
    <a href="https://www.doubao.com/chat/" target="_blank" rel="noopener noreferrer">打开豆包</a>
    <button id="copyPromptBtn" type="button">复制提示词</button>
  </div>
</div>
<label class="upload-box" for="photoInput">
  <strong>上传标准正立面图</strong>
  <span>仅一张 JPG / PNG，不超过 10 MB；本地不会再次矫正或裁切</span>
  <input id="photoInput" type="file" accept="image/jpeg,image/png" />
</label>
<div class="standard-facade-preview">
  <div id="photoPreviewEmpty">尚未选择图片</div>
  <img id="photoPreview" alt="标准正立面图预览" hidden />
</div>
```

Update `style.css` for the new preparation panel, action row, selectable prompt, and contained `object-fit: contain` preview. Remove styles used only by the corner editor and multi-photo list.

- [ ] **Step 5: Rewire `app.js` to the single-file direct flow**

Remove photo-corner state, pointer listeners, existing-photo fetch/list logic, roof controls, and canvas drawing functions. Bind `copyPromptBtn` so it calls `navigator.clipboard.writeText(PhotoWorkflow.CORRECTION_PROMPT)` and falls back to a manual-copy status. Use `validateStandardFacadeFiles` in `handlePhotoFiles`, revoke the prior object URL, load one preview image, and keep exactly one file in state.

Change photo-mode copy and generation request:

```js
formData.append('photos', state.photoFile, state.photoFile.name);
const created = await apiRequest('/api/jobs', { method: 'POST', body: formData });
const prepared = await apiRequest(`/api/jobs/${created.id}/prepare-direct`, { method: 'POST' });
const generated = await apiRequest(`/api/jobs/${prepared.id}/generate`, { method: 'POST' });
```

Set `roof_height` to `0`, `roof_type` to `flat`, and `modelMetrics.totalHeight` to `wall_height`. Use Chinese status copy that consistently says `标准正立面贴图` and never says local correction.

- [ ] **Step 6: Run frontend tests and syntax checks**

Run:

```powershell
node --test rural_house_generator/tests/photo-workflow.test.js
node --check rural_house_generator/photo-workflow.js
node --check rural_house_generator/app.js
```

Expected: all tests pass and both syntax checks exit 0.

- [ ] **Step 7: Commit the browser workflow**

```powershell
git add rural_house_generator/photo-workflow.js rural_house_generator/tests/photo-workflow.test.js rural_house_generator/index.html rural_house_generator/style.css rural_house_generator/app.js
git commit -m "feat: add external facade correction upload flow"
```

---

### Task 2: Backend direct preparation

**Files:**
- Modify: `rural_house_generator/backend/app/main.py`
- Create: `rural_house_generator/backend/tests/test_direct_prepare.py`
- Modify: `rural_house_generator/backend/README.md`

**Interfaces:**
- Consumes: jobs created through `POST /api/jobs` and `DiskJobStore.job_dir(job_id)`.
- Produces: `POST /api/jobs/{job_id}/prepare-direct -> JobRecord` with `status == "prepared"` and `artifacts.rectified_facade == "artifacts/facade_texture.png"`.

- [ ] **Step 1: Write failing direct-preparation API tests**

Create tests equivalent to:

```python
def test_prepare_direct_preserves_complete_uploaded_image(client, valid_job_form):
    image = np.zeros((37, 59, 3), dtype=np.uint8)
    image[:, :20] = (0, 0, 255)
    ok, encoded = cv2.imencode('.png', image)
    assert ok
    created = client.post(
        '/api/jobs', data=valid_job_form,
        files=[('photos', ('facade.png', encoded.tobytes(), 'image/png'))],
    )
    job_id = created.json()['id']

    prepared = client.post(f'/api/jobs/{job_id}/prepare-direct')

    assert prepared.status_code == 200
    assert prepared.json()['status'] == 'prepared'
    relative = prepared.json()['artifacts']['rectified_facade']
    stored = cv2.imread(str(client.app.state.job_store.job_dir(job_id) / relative))
    assert stored.shape == image.shape
    assert np.array_equal(stored, image)

def test_prepare_direct_rejects_multiple_photos(client, valid_job_form):
    encoded = valid_png_bytes()
    created = client.post(
        '/api/jobs', data=valid_job_form,
        files=[
            ('photos', ('one.png', encoded, 'image/png')),
            ('photos', ('two.png', encoded, 'image/png')),
        ],
    )
    response = client.post(f"/api/jobs/{created.json()['id']}/prepare-direct")
    assert response.status_code == 422
    assert response.json()['detail'] == 'Direct texture workflow requires exactly one image'

def test_prepare_direct_rejects_undecodable_image(client, valid_job_form):
    created = client.post(
        '/api/jobs', data=valid_job_form,
        files=[('photos', ('broken.png', b'not-png', 'image/png'))],
    )
    response = client.post(f"/api/jobs/{created.json()['id']}/prepare-direct")
    assert response.status_code == 422
    assert response.json()['detail'] == 'Uploaded image cannot be decoded'
```

Include a small `valid_png_bytes()` helper built with `cv2.imencode`.

- [ ] **Step 2: Run tests and confirm the route is missing**

Run: `python -m pytest rural_house_generator/backend/tests/test_direct_prepare.py -q`

Expected: FAIL with HTTP 404 for `/prepare-direct`.

- [ ] **Step 3: Implement `prepare-direct` without image geometry changes**

Add a route next to the legacy `/prepare` route. It must load the job, require one photo, decode it with `read_image`, and write the same full pixel matrix as PNG:

```python
@application.post('/api/jobs/{job_id}/prepare-direct', response_model=JobRecord)
def prepare_direct_job(job_id: str) -> JobRecord:
    record = load_job_or_404(store, job_id)
    if len(record['photos']) != 1:
        raise HTTPException(422, 'Direct texture workflow requires exactly one image')
    photo_path = store.job_dir(job_id) / 'inputs' / record['photos'][0]['filename']
    image = read_image(photo_path)
    if image is None:
        raise HTTPException(422, 'Uploaded image cannot be decoded')
    texture_path = store.job_dir(job_id) / 'artifacts' / 'facade_texture.png'
    texture_path.parent.mkdir(exist_ok=True)
    if not write_image(texture_path, image, '.png'):
        raise HTTPException(500, 'Failed to save facade texture')
    record['status'] = 'prepared'
    record['artifacts']['rectified_facade'] = 'artifacts/facade_texture.png'
    record['updated_at'] = datetime.now(UTC).isoformat()
    record['error'] = None
    store.write(job_id, record)
    return JobRecord.model_validate(record)
```

Extract `load_job_or_404` only if it reduces repeated job lookup without changing route behavior. Keep the legacy corner endpoint for compatibility, but do not call it from the UI.

- [ ] **Step 4: Document the new operator workflow**

Update `backend/README.md` to replace the active four-corner instructions with: start services, open Doubao, copy the approved prompt, upload one corrected image, set dimensions, generate. Document that `/prepare-direct` only decodes and stores the canonical PNG and that the legacy `/prepare` remains compatibility-only.

- [ ] **Step 5: Run backend preparation and regression tests**

Run:

```powershell
python -m pytest rural_house_generator/backend/tests/test_direct_prepare.py rural_house_generator/backend/tests/test_jobs.py rural_house_generator/backend/tests/test_prepare_api.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit backend direct preparation**

```powershell
git add rural_house_generator/backend/app/main.py rural_house_generator/backend/tests/test_direct_prepare.py rural_house_generator/backend/README.md
git commit -m "feat: prepare standard facade textures directly"
```

---

### Task 3: White-box Blender model and real generation test

**Files:**
- Modify: `rural_house_generator/backend/app/blender/generate_building.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Modify: `rural_house_generator/backend/tests/test_generate_api.py`
- Modify: `rural_house_generator/backend/tests/test_end_to_end.py`

**Interfaces:**
- Consumes: canonical `artifacts/facade_texture.png` and `BuildingSpec` from Task 2.
- Produces: `artifacts/building.glb`, with object `Photo facade` in front of neutral object `Building body`; no roof object is created.

- [ ] **Step 1: Change real Blender integration tests to the direct endpoint**

Use the unwarped `facade` fixture image, upload one PNG, call `/prepare-direct`, then `/generate`. Preserve assertions for status, `glTF` header, download media type, persistence across restart, and artifact size. Add a Blender-side structural assertion after importing the GLB in a background verification command or by writing an inspection JSON in the generation script:

```python
assert set(payload['object_names']) >= {'Building body', 'Photo facade'}
assert not any('roof' in name.lower() for name in payload['object_names'])
```

The inspection JSON should be emitted as `artifacts/model_manifest.json` by `generate_building.py` and registered by the API after successful generation.

- [ ] **Step 2: Run the real generation tests and confirm the old workflow expectation fails**

Run: `python -m pytest rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py -q`

Expected: FAIL until tests and generator use `/prepare-direct` and the manifest exists.

- [ ] **Step 3: Simplify the Blender script to a neutral white box**

Use one neutral material for the box:

```python
white_material = neutral_material('Neutral white shell', (0.82, 0.82, 0.79, 1.0))
add_body(width, depth, wall_height, white_material)
add_facade_plane(width, depth, wall_height, photo_material)
```

Do not call `add_gable_roof` or `add_flat_roof`. Keep the front plane offset by `0.004` meters to avoid z-fighting and retain the UV order `((0, 0), (0, 1), (1, 1), (1, 0))`. Before GLB export, write:

```python
manifest_path = output_path.parent / 'model_manifest.json'
manifest_path.write_text(json.dumps({
    'object_names': sorted(obj.name for obj in bpy.context.scene.objects if obj.type == 'MESH'),
    'front_texture': texture_path.name,
    'dimensions': {'width': width, 'depth': depth, 'height': wall_height},
}, ensure_ascii=False, indent=2), encoding='utf-8')
```

Register `model_manifest` in `generate_job` only when the file exists.

- [ ] **Step 4: Run direct generation and the complete backend suite**

Run:

```powershell
python -m pytest rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py -q
python -m pytest rural_house_generator/backend/tests -q
```

Expected: direct real-Blender tests and the full backend suite pass.

- [ ] **Step 5: Commit the white-box generator**

```powershell
git add rural_house_generator/backend/app/blender/generate_building.py rural_house_generator/backend/app/main.py rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py
git commit -m "feat: generate direct-textured white box models"
```

---

### Task 4: Supplied-image acceptance run and visual verification

**Files:**
- Create during the run: `rural_house_generator/runtime_storage/jobs/<job-id>/artifacts/facade_texture.png`
- Create during the run: `rural_house_generator/runtime_storage/jobs/<job-id>/artifacts/building.glb`
- Create during the run: `rural_house_generator/runtime_storage/jobs/<job-id>/artifacts/model_manifest.json`
- Modify if defects are found: the smallest relevant file from Tasks 1–3, with a failing regression test first.

**Interfaces:**
- Consumes: `C:/Users/MR/AppData/Local/Temp/codex-clipboard-fcc1312c-c530-43ae-b4ee-1077984245ff.png` and the live UI/backend.
- Produces: a downloadable example GLB and visually verified browser preview using the exact supplied image.

- [ ] **Step 1: Run all automated checks from a clean command invocation**

Run:

```powershell
node --test rural_house_generator/tests/photo-workflow.test.js
node --check rural_house_generator/photo-workflow.js
node --check rural_house_generator/app.js
python -m pytest rural_house_generator/backend/tests -q
git diff --check
```

Expected: every command exits 0; `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Start the backend and static server**

Start the backend on `127.0.0.1:8011` using the project environment documented in `backend/README.md`, and start a static server from the repository root on `127.0.0.1:8000`. Confirm `GET http://127.0.0.1:8011/health` returns `{"status":"ok"}`.

- [ ] **Step 3: Execute the exact user workflow**

Open `http://127.0.0.1:8000/rural_house_generator/`, choose `标准正立面贴图`, confirm the prompt is exact and the Doubao link targets the official URL, upload the supplied PNG, retain the default dimensions, and click `生成标准正立面贴图建筑`.

Expected: progress reaches 100%, the Three.js preview loads, and a GLB download link appears.

- [ ] **Step 4: Inspect the visual result**

Capture the browser preview from a straight-on and oblique angle. Confirm the source image is upright, not mirrored, not cropped, appears only on the front, and the side/rear/top are neutral white. If any check fails, add a regression test, make the minimum fix, and repeat Steps 1–4.

- [ ] **Step 5: Verify persisted artifacts**

Resolve the completed job directory and verify:

```powershell
$glb = Get-Item '<resolved-job-dir>\artifacts\building.glb'
$header = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($glb.FullName)[0..3])
if ($header -ne 'glTF') { throw "Invalid GLB header: $header" }
Get-Content -Raw -Encoding utf8 '<resolved-job-dir>\artifacts\model_manifest.json'
```

Expected: header is `glTF`, the manifest names only `Building body` and `Photo facade` mesh objects, and the canonical texture has the supplied image's pixel dimensions.

- [ ] **Step 6: Commit acceptance fixes, if any, and report artifacts**

If the acceptance run required code changes, stage only those tested files and commit them with `fix: correct direct facade model preview`. Report the absolute GLB path, the model manifest path, test results, and any limitation that remains.
