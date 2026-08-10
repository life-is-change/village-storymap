# Photo Service Recovery and Detailed Roofs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the photo generator recover cleanly when its local backend comes online, and replace plain roof slabs with efficient GLB roofs that have pitch-aware geometry, embedded tile materials, ridges, eaves, fascia, gutters, and flat-roof parapets.

**Architecture:** Keep retry and form normalization as pure browser helpers, keep roof dimension rules in a Blender-independent Python module, and pass a backward-compatible roof appearance contract through FastAPI job records into Blender. Blender builds a low-poly structural roof plus a generated embedded texture; the browser continues to preview the exported GLB, so preview and download remain identical.

**Tech Stack:** Browser JavaScript and Node test runner; FastAPI, Pydantic and pytest; Blender Python (`bpy`); Three.js GLB preview.

## Global Constraints

- Keep existing `roof_type` values and photo task API paths unchanged.
- New `roof_material` and `roof_pitch` fields must have defaults so old callers and stored jobs remain valid.
- Do not add network dependencies or new runtime third-party packages.
- Do not automatically launch `.bat` files or submit AI work when health polling detects recovery.
- Poll only while photo mode is visible and a retry is useful; never poll continuously in preset mode or a hidden tab.
- Embed generated roof textures in the GLB; downloaded models must not depend on external image files.
- Do not model individual tiles, dormers, crossing roofs, chimneys, or structural rafters.
- Preserve unrelated user changes and stage only files named by each task.

---

## File Structure

- `rural_house_generator/photo-workflow.js`: pure service-state and roof-form helpers shared by browser code and Node tests.
- `rural_house_generator/app.js`: browser health polling, recovery action, new controls, and request integration.
- `rural_house_generator/index.html`: service-status UI and roof material/pitch controls.
- `rural_house_generator/style.css`: compact service-state and roof-control presentation.
- `rural_house_generator/backend/app/roof_profile.py`: pure roof dimensions, pitch and material profile calculation without `bpy`.
- `rural_house_generator/backend/app/schemas.py`: backward-compatible roof appearance fields.
- `rural_house_generator/backend/app/main.py`: form ingestion and pitch-derived prepared roof height.
- `rural_house_generator/backend/app/blender/generate_building.py`: generated roof texture and detailed low-poly roof construction.
- `rural_house_generator/tests/photo-workflow.test.js`: pure browser contract tests.
- `rural_house_generator/backend/tests/test_roof_profile.py`: pure roof calculation tests.
- `rural_house_generator/backend/tests/test_jobs.py`: API persistence/default tests.
- `rural_house_generator/backend/tests/test_direct_prepare.py`: prepared-height preservation tests.
- `rural_house_generator/backend/tests/test_generate_api.py`: real Blender GLB and manifest smoke assertions.

---

### Task 1: Pure Browser Recovery and Roof Form Contracts

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Produces: `transitionServiceState(current, event, hasPendingPhoto) -> "checking" | "online" | "offline" | "recovered"`.
- Produces: `isLocalServiceNetworkError(error) -> boolean`.
- Extends: `buildPhotoUploadConfig(config)` with `roofMaterial` and `roofPitch` inputs.
- Extends: `buildBuildingFields(config)` with `roof_material` and `roof_pitch` form fields.

- [ ] **Step 1: Write failing service-state tests**

Add imports and focused tests equivalent to:

```js
assert.equal(transitionServiceState('checking', 'failure', false), 'offline');
assert.equal(transitionServiceState('offline', 'success', false), 'online');
assert.equal(transitionServiceState('offline', 'success', true), 'recovered');
assert.equal(transitionServiceState('recovered', 'retry', true), 'checking');
assert.equal(transitionServiceState('online', 'failure', true), 'offline');
assert.throws(() => transitionServiceState('online', 'unknown', false));

const networkError = new Error('本地处理服务未启动或不可访问');
networkError.code = 'LOCAL_SERVICE_UNREACHABLE';
assert.equal(isLocalServiceNetworkError(networkError), true);
assert.equal(isLocalServiceNetworkError(new Error('Could not find both sides')), false);
```

- [ ] **Step 2: Write failing roof-form tests**

Assert that `buildPhotoUploadConfig` normalizes unknown values and that `buildBuildingFields` emits:

```js
{
  building_width: '16.7',
  building_depth: '11',
  wall_height: '3',
  roof_height: '0.54',
  roof_type: 'hip',
  roof_material: 'asphalt_shingle',
  roof_pitch: 'low'
}
```

Also assert defaults `gray_tile` and `standard` for unsupported or missing values.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node --test rural_house_generator\tests\photo-workflow.test.js
```

Expected: FAIL because `transitionServiceState` and `isLocalServiceNetworkError` are not exported and roof fields are absent.

- [ ] **Step 4: Implement the minimal pure helpers**

Use explicit state/event tables, tag network errors by `code`, and whitelist roof values:

```js
const ROOF_MATERIALS = new Set(['gray_tile', 'asphalt_shingle', 'terracotta_tile']);
const ROOF_PITCHES = new Set(['low', 'standard', 'high']);

function normalizeRoofAppearance(config) {
  return {
    roofMaterial: ROOF_MATERIALS.has(config?.roofMaterial) ? config.roofMaterial : 'gray_tile',
    roofPitch: ROOF_PITCHES.has(config?.roofPitch) ? config.roofPitch : 'standard'
  };
}
```

`transitionServiceState` must reject unknown states/events rather than silently returning a stale value. Export all new helpers from the existing factory return object.

- [ ] **Step 5: Run tests and verify GREEN**

Run the same Node command and expect all tests to pass without warnings.

- [ ] **Step 6: Commit the pure browser contracts**

```powershell
git add -- rural_house_generator/photo-workflow.js rural_house_generator/tests/photo-workflow.test.js
git commit -m "feat: define photo service recovery states"
```

---

### Task 2: Pure Roof Profile Rules

**Files:**
- Create: `rural_house_generator/backend/app/roof_profile.py`
- Create: `rural_house_generator/backend/tests/test_roof_profile.py`

**Interfaces:**
- Produces: `PITCH_DEGREES = {"low": 18.0, "standard": 26.0, "high": 34.0}`.
- Produces: `resolve_roof_profile(width, depth, wall_height, roof_type, roof_pitch="standard", roof_material="gray_tile") -> dict[str, object]`.
- Profile keys: `type`, `material`, `pitch`, `pitch_degrees`, `ridge_axis`, `height`, `eave`, `surface_thickness`, `fascia_height`, `ridge_radius`, `gutter_radius`, `parapet_height`, `coping_width`, `tile_scale`, `base_color`, `accent_color`.

- [ ] **Step 1: Write failing profile tests**

Cover exact pitch mapping, dimension-derived height, long-axis orientation, bounded details, flat-roof profile and material differences:

```python
profile = resolve_roof_profile(10.0, 6.0, 5.0, "hip", "standard", "gray_tile")
assert profile["ridge_axis"] == "x"
assert profile["pitch_degrees"] == 26.0
assert profile["height"] == pytest.approx(3.0 * math.tan(math.radians(26.0)), rel=1e-6)
assert 0.25 <= profile["eave"] <= 0.60
assert profile["surface_thickness"] == pytest.approx(0.12)

assert resolve_roof_profile(6, 10, 5, "hip")["ridge_axis"] == "y"
assert resolve_roof_profile(10, 6, 5, "flat")["height"] == pytest.approx(0.18)
assert resolve_roof_profile(10, 6, 5, "flat")["parapet_height"] == pytest.approx(0.60)
assert resolve_roof_profile(10, 6, 5, "gable", "high")["height"] > profile["height"]
assert resolve_roof_profile(10, 6, 5, "hip", roof_material="terracotta_tile")["base_color"] != profile["base_color"]
```

Also assert `ValueError` for non-positive dimensions and unsupported enum values.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_roof_profile.py -q
```

Expected: collection fails because `roof_profile` does not exist.

- [ ] **Step 3: Implement deterministic roof rules**

Implement clamping locally and calculate pitched height from the half-span perpendicular to the ridge:

```python
span = depth if ridge_axis == "x" else width
height = max(0.35, min(8.0, span * 0.5 * math.tan(math.radians(pitch_degrees))))
eave = max(0.25, min(0.60, min(width, depth) * 0.055))
```

Use flat roof `height=0.18`, `parapet_height=0.60`, and `coping_width=0.22`. Use material palettes:

```python
"gray_tile": ((0.16, 0.18, 0.19, 1.0), (0.08, 0.09, 0.10, 1.0))
"asphalt_shingle": ((0.20, 0.23, 0.25, 1.0), (0.11, 0.13, 0.15, 1.0))
"terracotta_tile": ((0.44, 0.16, 0.08, 1.0), (0.24, 0.07, 0.035, 1.0))
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the focused pytest command and expect PASS.

- [ ] **Step 5: Commit roof profile rules**

```powershell
git add -- rural_house_generator/backend/app/roof_profile.py rural_house_generator/backend/tests/test_roof_profile.py
git commit -m "feat: calculate detailed roof profiles"
```

---

### Task 3: Persist the Roof Appearance Contract

**Files:**
- Modify: `rural_house_generator/backend/app/schemas.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Modify: `rural_house_generator/backend/tests/conftest.py`
- Modify: `rural_house_generator/backend/tests/test_jobs.py`
- Modify: `rural_house_generator/backend/tests/test_direct_prepare.py`

**Interfaces:**
- Extends `BuildingSpec` with `roof_material: Literal[...] = "gray_tile"` and `roof_pitch: Literal[...] = "standard"`.
- Extends `POST /api/jobs` form with optional `roof_material` and `roof_pitch` defaults.
- Consumes: `resolve_roof_profile(...)` to update prepared `roof_height`.

- [ ] **Step 1: Write failing persistence and default tests**

Extend `valid_job_form` with `roof_material="asphalt_shingle"` and `roof_pitch="low"`. Assert the response and `job.json` retain both values. Add a second request omitting them and assert `gray_tile` and `standard` defaults.

- [ ] **Step 2: Write the failing pitch-derived prepare test**

Replace the old fixed `0.9` assertion for a 10 m by 6 m hip roof with:

```python
expected = resolve_roof_profile(10.0, 6.0, 5.0, "hip", "low", "asphalt_shingle")
assert prepared.json()["building"]["roof_height"] == pytest.approx(expected["height"], abs=0.001)
assert prepared.json()["building"]["roof_material"] == "asphalt_shingle"
assert prepared.json()["building"]["roof_pitch"] == "low"
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_jobs.py rural_house_generator\backend\tests\test_direct_prepare.py -q
```

Expected: FAIL because FastAPI ignores/rejects the new contract and preparation still uses a wall-height percentage.

- [ ] **Step 4: Implement schema, form and preparation changes**

Add optional form parameters after `roof_type`, pass them into `BuildingSpec`, and in `prepare_direct_job` resolve:

```python
roof = resolve_roof_profile(
    width=float(record["building"]["width"]),
    depth=float(record["building"]["depth"]),
    wall_height=wall_height,
    roof_type=str(record["building"]["roof_type"]),
    roof_pitch=str(record["building"].get("roof_pitch", "standard")),
    roof_material=str(record["building"].get("roof_material", "gray_tile")),
)
record["building"]["roof_height"] = round(float(roof["height"]), 3)
```

- [ ] **Step 5: Run focused and schema tests**

Run the Task 3 pytest command, then:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_health.py rural_house_generator\backend\tests\test_jobs.py rural_house_generator\backend\tests\test_direct_prepare.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit the backend contract**

```powershell
git add -- rural_house_generator/backend/app/schemas.py rural_house_generator/backend/app/main.py rural_house_generator/backend/tests/conftest.py rural_house_generator/backend/tests/test_jobs.py rural_house_generator/backend/tests/test_direct_prepare.py
git commit -m "feat: persist roof appearance settings"
```

---

### Task 4: Generate Detailed Low-Poly Roofs in Blender

**Files:**
- Modify: `rural_house_generator/backend/app/blender/generate_building.py`
- Modify: `rural_house_generator/backend/tests/test_generate_api.py`
- Modify: `rural_house_generator/backend/tests/test_end_to_end.py`

**Interfaces:**
- Consumes: `resolve_roof_profile(...)` and stored roof appearance fields.
- Produces named mesh objects: `Roof surface`, `Roof fascia *`, `Roof gutter *`, `Roof ridge`, `Roof hip ridge *`, `Roof parapet *`, `Roof coping *` as applicable.
- Produces manifest `roof` keys: `type`, `material`, `pitch`, `pitch_degrees`, `height`, `objects`.

- [ ] **Step 1: Write failing real-Blender smoke assertions**

Update the exact three-object assertion to subset assertions. For a hip roof require:

```python
names = set(manifest["object_names"])
assert {"Building body", "Photo facade", "Roof surface", "Roof ridge"} <= names
assert len([name for name in names if name.startswith("Roof hip ridge")]) == 4
assert len([name for name in names if name.startswith("Roof fascia")]) == 4
assert len([name for name in names if name.startswith("Roof gutter")]) >= 2
assert manifest["roof"]["material"] == "asphalt_shingle"
assert manifest["roof"]["pitch"] == "low"
assert manifest["roof"]["objects"] == sorted(name for name in names if name.startswith("Roof "))
```

Add direct Blender smoke variants for gable and flat roofs. Gable requires ridge and fascia but no hip ridges. Flat requires four parapets and four copings but no pitched ridge.

- [ ] **Step 2: Run the hip smoke test and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_generate_api.py -q
```

Expected: FAIL because current Blender output only contains one plain roof mesh and old manifest keys.

- [ ] **Step 3: Add embedded generated tile materials**

Implement `roof_material(profile)` by creating a deterministic 256×256 Blender image. Fill pixels with the profile base color, dark horizontal course joints, staggered vertical joints, and small deterministic color variation based on integer pixel coordinates. Pack the image, connect it to Principled Base Color, set roughness to `0.78` for tile, `0.88` for asphalt and `0.72` for terracotta, and connect a grayscale copy through a Bump node with strength no greater than `0.18`.

Use UV scale from `profile["tile_scale"]`; do not generate individual tile meshes.

- [ ] **Step 4: Add shared geometry helpers**

Implement these concrete helpers:

```python
def mesh_object(name, vertices, faces, material, *, solidify=0.0): ...
def add_box(name, center, dimensions, material): ...
def add_cap_between(name, start, end, radius, material): ...
def assign_roof_uv(mesh, face_basis, tile_scale): ...
```

`mesh_object` applies a Solidify modifier when `solidify > 0`. `add_cap_between` creates a 12-sided cylinder, rotates its local Z axis onto `end - start`, and embeds its lower half into the roof surface. Geometry helpers return created object names for the manifest.

- [ ] **Step 5: Replace hip and gable surfaces**

Construct the pitched surface from the same six roof control vertices already used by the script, but rename it `Roof surface`, add `profile["surface_thickness"]`, and assign per-slope UV bases parallel to each eave. Add:

- one main ridge cap between ridge endpoints;
- four hip caps between roof corners and their nearest ridge endpoints for hip roofs;
- four fascia boxes following eave edges;
- at least front and rear gutter cylinders below the eaves;
- two gable verge/fascia pieces and one main ridge for gable roofs.

All cap, fascia and gutter endpoints must be derived from the roof control vertices so changing width, depth or pitch cannot detach them.

- [ ] **Step 6: Replace the flat slab**

Generate a `Roof surface` slab with height `0.18`, four parapet boxes with profile height, and four wider coping boxes above them. Use a neutral concrete roof material for the slab and the selected roof palette only when explicitly chosen; record all objects in the manifest.

- [ ] **Step 7: Extend the manifest and run Blender tests**

Write the complete resolved roof data and sorted roof object names. Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_generate_api.py rural_house_generator\backend\tests\test_end_to_end.py -q
```

Expected: PASS, each downloaded file begins with `glTF`, and no Blender stderr contains a traceback.

- [ ] **Step 8: Commit detailed Blender roofs**

```powershell
git add -- rural_house_generator/backend/app/blender/generate_building.py rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py
git commit -m "feat: generate structured tiled roofs"
```

---

### Task 5: Integrate Roof Controls and Recoverable Service UI

**Files:**
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`

**Interfaces:**
- Consumes: `transitionServiceState`, `isLocalServiceNetworkError`, extended form helpers.
- DOM IDs: `photoServiceState`, `photoServiceMessage`, `recoverPhotoBtn`, `roofMaterialInput`, `roofPitchInput`.
- Browser functions: `checkPhotoService()`, `schedulePhotoServiceCheck()`, `renderPhotoServiceState()`, `recoverCurrentPhoto()`.

- [ ] **Step 1: Add failing source-contract tests**

In the Node test, read `index.html` and `app.js` and assert the DOM IDs exist, `app.js` listens to `visibilitychange`, uses a single `setTimeout`-based poll, and binds `recoverPhotoBtn` to recovery. Keep behavioral state transitions in the pure helper tests from Task 1.

- [ ] **Step 2: Run Node tests and verify RED**

Run:

```powershell
node --test rural_house_generator\tests\photo-workflow.test.js
```

Expected: FAIL because service state UI, recovery button and roof selects do not exist.

- [ ] **Step 3: Add compact UI controls**

Add the service status above the photo file input and add roof selects beside the existing type select:

```html
<select id="roofMaterialInput">
  <option value="gray_tile" selected>岭南灰瓦</option>
  <option value="asphalt_shingle">沥青瓦</option>
  <option value="terracotta_tile">陶瓦</option>
</select>
<select id="roofPitchInput">
  <option value="low">低坡</option>
  <option value="standard" selected>标准坡</option>
  <option value="high">高坡</option>
</select>
```

The service panel must use text plus color, keep the recovery button hidden unless state is `recovered`, and remain usable at the current narrow left-panel width.

- [ ] **Step 4: Implement bounded health polling**

Maintain one timer handle in state. On entry to photo mode or document visibility restoration, call `checkPhotoService`. A failure schedules the next check after 3 seconds. A success stops polling unless a pending photo exists and state is `recovered`. Leaving photo mode or hiding the document clears the timer.

Use a 1500 ms `AbortController` timeout for `/health`. Health requests never call job APIs.

- [ ] **Step 5: Preserve and manually recover the current photo**

When `apiRequest` catches a fetch failure, create an error with `code="LOCAL_SERVICE_UNREACHABLE"`. In `rectifyUploadedPhoto`, only this code changes service state to offline and marks the retained `state.photoFile` as pending. Business errors continue to show existing “使用原图继续” actions.

`recoverCurrentPhoto` must:

```js
if (!state.photoFile) {
  els.photoInput.click();
  return;
}
state.photoJobId = '';
state.photoWorkflowState = 'idle';
transition the service state with 'retry';
await rectifyUploadedPhoto();
```

Disable the recovery button during the call and prevent concurrent recovery promises.

- [ ] **Step 6: Send the roof appearance settings**

Read `roofMaterialInput.value` and `roofPitchInput.value` in `readPhotoBuildingConfig`, then let the pure helpers emit the two API form fields. Existing preset-mode roof creation remains unchanged.

- [ ] **Step 7: Run Node tests and verify GREEN**

Run the Task 5 Node command and expect PASS.

- [ ] **Step 8: Commit UI integration**

```powershell
git add -- rural_house_generator/index.html rural_house_generator/style.css rural_house_generator/app.js rural_house_generator/photo-workflow.js rural_house_generator/tests/photo-workflow.test.js
git commit -m "feat: recover photo processing and configure roofs"
```

---

### Task 6: Full Verification and Visual QA

**Files:**
- Modify only if verification exposes a defect in files already listed above.
- Do not modify unrelated assets or normalization metadata.

**Interfaces:**
- Consumes all prior tasks.
- Produces evidence for automated correctness, real GLB export and browser-visible roof quality.

- [ ] **Step 1: Run the complete focused suites**

```powershell
node --test rural_house_generator\tests\photo-workflow.test.js rural_house_generator\tests\launcher.test.js
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests -q
```

Expected: all tests pass; no new warnings or tracebacks.

- [ ] **Step 2: Restart the facade services from the updated source**

Stop only the known 8011/8012/8013/8000 launcher-owned processes after resolving their executable paths, then run `start_facade_generator.ps1`. Verify:

```powershell
Invoke-RestMethod http://127.0.0.1:8011/health
Invoke-RestMethod http://127.0.0.1:8012/health
Invoke-RestMethod http://127.0.0.1:8013/health
```

Expected: each returns `status: ok`.

- [ ] **Step 3: Generate visual variants from one retained facade**

Create hip gray-tile standard-pitch, hip asphalt low-pitch, gable terracotta high-pitch and flat-roof jobs using the same facade image. Download each GLB and retain its `model_manifest.json` under the runtime job artifacts, not in Git.

- [ ] **Step 4: Inspect the variants in the existing Three.js preview**

Check oblique-front and oblique-rear views. Verify:

- hip roof has visible tile scale, main ridge, four hip ridges, fascia thickness and attached gutters;
- gable roof has ridge, verge/fascia and no hip caps;
- flat roof has parapets and coping;
- no roof floats above or cuts through the wall body;
- tile courses are not stretched and adjacent slope directions remain plausible;
- frame rate remains interactive and GLB reload matches first preview.

- [ ] **Step 5: Verify service recovery manually**

With the page holding a selected photo, make 8011 unavailable, confirm offline state without losing the preview, restore 8011, wait for “服务已恢复”, click “重新处理当前照片”, and confirm a new job reaches rectification. Confirm no job is created merely by health polling.

- [ ] **Step 6: Run final regression and inspect the diff**

Repeat the complete focused suites, then run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: tests pass, no whitespace errors, and only the planned implementation files plus the user's pre-existing unrelated files appear.
