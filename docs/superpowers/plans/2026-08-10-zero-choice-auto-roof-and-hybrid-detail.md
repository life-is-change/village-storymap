# Zero-Choice Automatic Roof and Hybrid Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a photo workflow that needs only upload, roof-line placement, and generate, while automatically selecting a safe roof appearance and exporting a browser-friendly GLB with visibly richer roof-edge, ridge, and drainage geometry.

**Architecture:** A pure OpenCV roof analyzer converts the rectified image, building mask, and crop line into typed decisions with confidence and fallback metadata. A versioned FastAPI endpoint persists those decisions and manual overrides; the frontend debounces roof-line changes and hides overrides inside a collapsed advanced panel. Blender receives only resolved building/detail parameters and creates merged, bounded geometry for segmented ridge caps, eave tiles, soffits, gutters, downspouts, and edge closures.

**Tech Stack:** Vanilla JavaScript, Node test runner, FastAPI/Pydantic, Python 3.11, OpenCV/NumPy, pytest, Blender Python API, Three.js GLB preview.

## Global Constraints

- Default photo flow is exactly upload photo, drag the roof line, and generate; roof type, material, and pitch selectors stay collapsed under “高级设置”.
- Automatic analysis failures return the safe combination `hip + gray_tile + standard` and never fail photo rectification.
- Manual overrides win per field; re-upload clears all overrides, while moving the roof line preserves overrides and recomputes only automatic fields.
- Keep existing `roof_type`, `roof_material`, `roof_pitch`, photo job routes, GLB download, and platform replacement contracts backward compatible.
- Do not add cloud services, runtime network dependencies, or externally hosted textures.
- Do not invent chimneys, dormers, front gables, or compound roofs when the photo evidence is below the feature threshold.
- Do not model every roof tile; repeated eave and ridge elements must be merged into a bounded number of mesh objects.
- Preview and download must use the same backend-generated GLB.
- Preserve unrelated untracked files, including `assets/orthophoto.tif.aux.xml` and `assets/orthophoto.webp.aux.xml`.

---

### Task 1: Pure Roof Image Analyzer

**Files:**
- Create: `rural_house_generator/backend/app/roof_analysis.py`
- Create: `rural_house_generator/backend/tests/test_roof_analysis.py`

**Interfaces:**
- Consumes: rectified BGR image (`np.ndarray`), normalized roof line (`float` in `0..0.65`), and optional rectified building mask.
- Produces: `analyze_roof(image: np.ndarray, roof_top_norm: float, building_mask: np.ndarray | None = None) -> dict[str, object]` containing `type`, `material`, `pitch`, `warnings`, and `detected_features`; each decision is `{value, confidence, source}`.
- Produces: `fallback_roof_analysis(roof_top_norm) -> dict[str, object]` with `hip`, `gray_tile`, and `standard`, each marked `source="fallback"`.

- [ ] **Step 1: Write failing analyzer tests with deterministic synthetic roofs**

```python
def test_analyze_roof_recognizes_red_gable_and_high_pitch():
    image, mask = synthetic_roof(
        canvas=(420, 720),
        polygon=[(120, 180), (360, 35), (600, 180), (600, 380), (120, 380)],
        bgr=(45, 85, 190),
    )
    result = analyze_roof(image, roof_top_norm=180 / 419, building_mask=mask)
    assert result["type"]["value"] == "gable"
    assert result["pitch"]["value"] == "high"
    assert result["material"]["value"] == "terracotta_tile"
    assert all(result[key]["source"] == "automatic" for key in ("type", "pitch", "material"))


def test_analyze_roof_uses_safe_defaults_when_effective_region_is_too_small():
    image = np.full((240, 360, 3), 245, np.uint8)
    result = analyze_roof(image, roof_top_norm=0.04)
    assert [result[key]["value"] for key in ("type", "material", "pitch")] == [
        "hip", "gray_tile", "standard"
    ]
    assert result["warnings"] == ["roof_region_unclear"]
```

Also cover a long-ridge trapezoid as `hip`, a near-horizontal silhouette as `flat`, blue/neutral gray as `gray_tile`, dark neutral granular color as `asphalt_shingle`, and an occluded/low-confidence mask that must not emit optional features.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_roof_analysis.py -q --basetemp=C:\Users\MR\.codex\visualizations\2026\08\10\019fe97d-3614-7702-b760-89c0accf5f05\pytest-auto-roof-red -p no:cacheprovider
```

Expected: FAIL with `ModuleNotFoundError` for `roof_analysis`.

- [ ] **Step 3: Implement bounded ROI, silhouette, line, and color analysis**

Create typed constants and small focused helpers:

```python
SAFE_VALUES = {"type": "hip", "material": "gray_tile", "pitch": "standard"}


def decision(value: str, confidence: float, source: str = "automatic") -> dict[str, object]:
    return {"value": value, "confidence": round(float(np.clip(confidence, 0, 1)), 3), "source": source}


def analyze_roof(
    image: np.ndarray,
    roof_top_norm: float,
    building_mask: np.ndarray | None = None,
) -> dict[str, object]:
    crop_y = int(round(np.clip(roof_top_norm, 0, 0.65) * (image.shape[0] - 1)))
    roi, roi_mask = extract_roof_region(image, crop_y, building_mask)
    if roi.size == 0 or cv2.countNonZero(roi_mask) < 800:
        return fallback_roof_analysis(roof_top_norm)
    silhouette = roof_silhouette(roi_mask)
    lines = dominant_roof_lines(roi, roi_mask)
    result = {
        "type": classify_roof_type(silhouette, lines),
        "pitch": classify_roof_pitch(silhouette, lines),
        "material": classify_roof_material(roi, roi_mask),
        "warnings": [],
        "detected_features": [],
        "crop_top": round(float(roof_top_norm), 6),
    }
    return apply_confidence_fallbacks(result)
```

Use Canny + `cv2.HoughLinesP` only inside the bounded roof ROI. Classify pitch from the median stable diagonal angle (`<22° low`, `22–31° standard`, `>31° high`) combined with silhouette height/width. Classify material from masked HSV pixels after dropping low-saturation bright sky and green vegetation. Emit no optional feature unless a closed protrusion has confidence at least `0.82`; the first implementation may validly return an empty feature list for all ambiguous samples.

- [ ] **Step 4: Run analyzer tests and verify GREEN**

Run the Step 2 command again.

Expected: all analyzer tests PASS.

- [ ] **Step 5: Commit the analyzer**

```powershell
git add -- rural_house_generator/backend/app/roof_analysis.py rural_house_generator/backend/tests/test_roof_analysis.py
git commit -m "feat: analyze roof appearance from photos"
```

---

### Task 2: Versioned Analysis API and Persistence

**Files:**
- Modify: `rural_house_generator/backend/app/schemas.py`
- Modify: `rural_house_generator/backend/app/main.py`
- Modify: `rural_house_generator/backend/app/blender_service.py`
- Modify: `rural_house_generator/backend/tests/conftest.py`
- Create: `rural_house_generator/backend/tests/test_roof_analysis_api.py`
- Modify: `rural_house_generator/backend/tests/test_direct_prepare.py`

**Interfaces:**
- Consumes: `analyze_roof(image: np.ndarray, roof_top_norm: float, building_mask: np.ndarray | None = None) -> dict[str, object]` and `fallback_roof_analysis(roof_top_norm: float) -> dict[str, object]` from Task 1.
- Produces: Pydantic `RoofDecision`, `RoofAnalysis`, and optional `JobRecord.roof_analysis`.
- Produces: `POST /api/jobs/{job_id}/analyze-roof` form endpoint accepting `roof_top_norm`, `revision`, and optional `roof_type_override`, `roof_material_override`, `roof_pitch_override`.
- Guarantees: stale revisions do not overwrite current analysis; persisted `building` always holds the resolved values used by prepare/generate.

- [ ] **Step 1: Write failing API contract tests**

```python
def test_analyze_roof_endpoint_persists_automatic_values(client, rectified_job):
    response = client.post(
        f"/api/jobs/{rectified_job['id']}/analyze-roof",
        data={"roof_top_norm": "0.31", "revision": "1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["roof_analysis"]["revision"] == 1
    assert body["building"]["roof_type"] == body["roof_analysis"]["type"]["value"]


def test_stale_analysis_revision_cannot_replace_manual_override(client, rectified_job):
    job_id = rectified_job["id"]
    accepted = client.post(
        f"/api/jobs/{job_id}/analyze-roof",
        data={"roof_top_norm": "0.30", "revision": "4", "roof_pitch_override": "high"},
    ).json()
    stale = client.post(
        f"/api/jobs/{job_id}/analyze-roof",
        data={"roof_top_norm": "0.28", "revision": "3"},
    ).json()
    assert stale["roof_analysis"] == accepted["roof_analysis"]
    assert stale["roof_analysis"]["pitch"]["source"] == "manual"
```

Also assert: endpoint requires `rectified` status, invalid override returns 422, moving the line preserves previously persisted manual decisions, a new rectification clears old analysis, and old jobs without `roof_analysis` still prepare with existing building fields.

- [ ] **Step 2: Run API tests and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_roof_analysis_api.py rural_house_generator\backend\tests\test_direct_prepare.py -q --basetemp=C:\Users\MR\.codex\visualizations\2026\08\10\019fe97d-3614-7702-b760-89c0accf5f05\pytest-auto-roof-api-red -p no:cacheprovider
```

Expected: endpoint tests FAIL with 404 and schema field assertions fail.

- [ ] **Step 3: Add typed schemas and merge helper**

```python
class RoofDecision(BaseModel):
    value: str
    confidence: float = Field(ge=0, le=1)
    source: Literal["automatic", "fallback", "manual"]


class RoofAnalysis(BaseModel):
    type: RoofDecision
    material: RoofDecision
    pitch: RoofDecision
    crop_top: float = Field(ge=0, le=0.65)
    revision: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)
    detected_features: list[str] = Field(default_factory=list)
```

Use field-specific `Literal` types or validators so a type decision cannot contain a material value. Add `roof_analysis: RoofAnalysis | None = None` to `JobRecord`.

- [ ] **Step 4: Implement the endpoint and stale-write protection**

Read `rectified_source`, decode the optional mask, call `analyze_roof`, merge each non-null override as `{value, confidence: 1.0, source: "manual"}`, and preserve a previous manual decision when the corresponding override field is absent. If `revision <= current_revision`, immediately return the current record without re-analysis or writes. Persist resolved values into `record["building"]` and clear `roof_analysis` whenever `rectify_job` replaces the rectified artifacts.

- [ ] **Step 5: Pass analysis metadata into Blender configuration**

Change `BlenderService.generate(job_dir: Path, building: dict, texture_path: Path, roof_analysis: dict | None = None) -> Path` to write analysis beside `building` in `generation_config.json`. Call it from `generate_job` with `record.get("roof_analysis")`. Old callers remain valid through the default argument.

- [ ] **Step 6: Run API tests and verify GREEN**

Run the Step 2 command again.

Expected: all selected API and direct-prepare tests PASS.

- [ ] **Step 7: Commit the API contract**

```powershell
git add -- rural_house_generator/backend/app/schemas.py rural_house_generator/backend/app/main.py rural_house_generator/backend/app/blender_service.py rural_house_generator/backend/tests/conftest.py rural_house_generator/backend/tests/test_roof_analysis_api.py rural_house_generator/backend/tests/test_direct_prepare.py
git commit -m "feat: persist automatic roof analysis"
```

---

### Task 3: Zero-Choice Frontend and Manual Overrides

**Files:**
- Modify: `rural_house_generator/photo-workflow.js`
- Modify: `rural_house_generator/tests/photo-workflow.test.js`
- Modify: `rural_house_generator/index.html`
- Modify: `rural_house_generator/style.css`
- Modify: `rural_house_generator/app.js`

**Interfaces:**
- Consumes: Task 2 endpoint and `JobRecord.roof_analysis`.
- Produces: pure functions `buildRoofAnalysisForm`, `roofAnalysisSummary`, `nextRoofAnalysisState`, and `clearRoofOverrides` in `PhotoWorkflow`.
- UI contract: `#roofAnalysisSummary` is visible; `#roofAdvanced` is a collapsed `<details>` containing the existing selects; `#photoGenerateBtn` is disabled while analysis is pending.

- [ ] **Step 1: Write failing pure frontend tests**

```javascript
test('automatic roof summary keeps normal workflow to one compact line', () => {
  assert.equal(
    PhotoWorkflow.roofAnalysisSummary({
      type: { value: 'hip', confidence: 0.88, source: 'automatic' },
      material: { value: 'gray_tile', confidence: 0.91, source: 'automatic' },
      pitch: { value: 'high', confidence: 0.76, source: 'automatic' },
      warnings: []
    }),
    '已自动匹配：岭南灰瓦 · 四坡屋顶 · 高坡'
  );
});


test('moving the crop line preserves manual fields but invalidates automatic fields', () => {
  const next = PhotoWorkflow.nextRoofAnalysisState(current, { cropTop: 0.27 });
  assert.equal(next.overrides.roofPitch, 'high');
  assert.equal(next.analysis, null);
  assert.equal(next.status, 'pending');
});
```

Also cover fallback copy, form field names, monotonically increasing revisions, re-upload clearing all overrides, and normalized values from an API response.

- [ ] **Step 2: Run Node tests and verify RED**

Run:

```powershell
node --test --test-isolation=none rural_house_generator\tests\photo-workflow.test.js
```

Expected: FAIL because the new pure functions do not exist.

- [ ] **Step 3: Implement pure state and serialization helpers**

```javascript
function buildRoofAnalysisForm({ cropTop, revision, overrides = {} }) {
  const form = new FormData();
  form.append('roof_top_norm', String(clampRoofBoundary(cropTop)));
  form.append('revision', String(revision));
  if (overrides.roofType) form.append('roof_type_override', normalizeRoofType(overrides.roofType));
  if (overrides.roofMaterial) form.append('roof_material_override', normalizeRoofMaterial(overrides.roofMaterial));
  if (overrides.roofPitch) form.append('roof_pitch_override', normalizeRoofPitch(overrides.roofPitch));
  return form;
}
```

Keep labels in one lookup table so summary and selects cannot drift.

- [ ] **Step 4: Replace the exposed option card with a collapsed advanced panel**

Use semantic markup:

```html
<div id="roofAnalysisSummary" class="roof-analysis-summary" aria-live="polite">
  拖动屋顶线后自动匹配屋顶
</div>
<details id="roofAdvanced" class="roof-advanced">
  <summary>高级设置</summary>
  <div class="roof-options">
    <label><span>生成屋顶</span><select id="roofTypeInput"><option value="hip">四坡屋顶</option><option value="gable">双坡屋顶</option><option value="flat">平屋顶</option></select></label>
    <label><span>屋顶材质</span><select id="roofMaterialInput"><option value="gray_tile">岭南灰瓦</option><option value="asphalt_shingle">沥青瓦</option><option value="terracotta_tile">陶瓦</option></select></label>
    <label><span>屋顶坡度</span><select id="roofPitchInput"><option value="low">低坡</option><option value="standard">标准坡</option><option value="high">高坡</option></select></label>
  </div>
</details>
```

The summary must remain visible above the generate button. The details element is closed on initial load and after every new upload.

- [ ] **Step 5: Wire debounced, versioned analysis into `app.js`**

Add state fields `roofAnalysis`, `roofAnalysisStatus`, `roofAnalysisRevision`, `roofOverrides`, `roofAnalysisTimer`, and `roofAnalysisAbortController`. On rectification completion and on crop-line drag end, schedule analysis after 350 ms. Increment revision before every request; abort the previous fetch and ignore any response whose requested revision is not the current revision. Keep manual override selects synced with resolved analysis until the user changes a field; a change records only that field as manual and immediately schedules a new request.

During `pending`, disable `photoGenerateBtn` and show “正在匹配屋顶…”. During fallback, enable generate and show the safe-default warning. `readPhotoBuildingConfig()` uses resolved analysis values, not raw select defaults. A new file calls `clearRoofOverrides()` and closes `roofAdvanced`.

- [ ] **Step 6: Run Node tests and syntax checks**

Run:

```powershell
node --test --test-isolation=none rural_house_generator\tests\photo-workflow.test.js rural_house_generator\tests\launcher.test.js
node --check rural_house_generator\photo-workflow.js
node --check rural_house_generator\app.js
```

Expected: all tests PASS and both syntax checks exit 0.

- [ ] **Step 7: Commit the zero-choice UI**

```powershell
git add -- rural_house_generator/photo-workflow.js rural_house_generator/tests/photo-workflow.test.js rural_house_generator/index.html rural_house_generator/style.css rural_house_generator/app.js
git commit -m "feat: automate roof choices in photo mode"
```

---

### Task 4: Pure Detail Profile and Geometry Budgets

**Files:**
- Modify: `rural_house_generator/backend/app/roof_profile.py`
- Modify: `rural_house_generator/backend/tests/test_roof_profile.py`

**Interfaces:**
- Consumes: resolved building dimensions, roof type, material, and pitch.
- Produces: detail profile keys `soffit_thickness`, `drip_edge_height`, `eave_tile_width`, `eave_tile_rise`, `ridge_cap_length`, `ridge_cap_overlap`, `gutter_radius`, `downspout_radius`, `downspout_offset`, `max_eave_tiles`, and `max_ridge_caps`.
- Produces: `bounded_segment_count(length, nominal_size, maximum) -> int` used by Blender geometry.

- [ ] **Step 1: Write failing budget and dimension tests**

```python
def test_detailed_roof_profile_has_bounded_visible_components():
    profile = resolve_roof_profile(10, 7, 6, "hip", "standard", "gray_tile")
    assert 0.08 <= profile["soffit_thickness"] <= 0.18
    assert 0.24 <= profile["eave_tile_width"] <= 0.42
    assert profile["ridge_cap_overlap"] < profile["ridge_cap_length"]
    assert bounded_segment_count(200, profile["eave_tile_width"], profile["max_eave_tiles"]) == profile["max_eave_tiles"]
```

Also verify flat roofs set pitched detail flags false, downspout radius is smaller than gutter radius, and normal residential dimensions produce more than one ridge cap.

- [ ] **Step 2: Run profile tests and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_roof_profile.py -q --basetemp=C:\Users\MR\.codex\visualizations\2026\08\10\019fe97d-3614-7702-b760-89c0accf5f05\pytest-roof-detail-red -p no:cacheprovider
```

Expected: FAIL with missing keys/function.

- [ ] **Step 3: Implement architectural defaults and hard upper bounds**

```python
def bounded_segment_count(length: float, nominal_size: float, maximum: int) -> int:
    return max(1, min(int(maximum), int(math.ceil(float(length) / float(nominal_size)))))
```

Use 0.12 m soffit thickness, 0.08 m drip edge, 0.32 m nominal eave tile width, 0.055 m eave tile rise, 0.42 m ridge cap length, 0.07 m overlap, 0.075 m gutter radius, 0.055 m downspout radius, maximum 160 eave tiles per strip, and maximum 96 caps per ridge path. Scale only where the existing building-size bounds require it.

- [ ] **Step 4: Run profile tests and verify GREEN**

Run the Step 2 command again.

Expected: all roof profile tests PASS.

- [ ] **Step 5: Commit detail parameters**

```powershell
git add -- rural_house_generator/backend/app/roof_profile.py rural_house_generator/backend/tests/test_roof_profile.py
git commit -m "feat: define bounded roof detail profiles"
```

---

### Task 5: Merged Blender Roof Details

**Files:**
- Modify: `rural_house_generator/backend/app/blender/generate_building.py`
- Modify: `rural_house_generator/backend/tests/test_generate_api.py`
- Modify: `rural_house_generator/backend/tests/test_end_to_end.py`

**Interfaces:**
- Consumes: detail profile and `bounded_segment_count` from Task 4; optional `roof_analysis` from generation config.
- Produces: merged mesh objects named `Roof soffit`, `Roof drip edge`, `Roof eave tiles *`, `Roof ridge caps`, `Roof hip ridge caps *`, `Roof gutter *`, `Roof downspout *`, and `Roof edge closure *`.
- Produces: manifest `roof.detail_counts` and `roof.analysis` while preserving existing manifest fields.

- [ ] **Step 1: Strengthen real-Blender tests before implementation**

```python
assert "Roof soffit" in names
assert "Roof ridge caps" in names
assert len([name for name in names if name.startswith("Roof hip ridge caps")]) == 4
assert len([name for name in names if name.startswith("Roof downspout")]) == 2
assert manifest["roof"]["detail_counts"]["ridge_caps"] > 1
assert manifest["roof"]["detail_counts"]["eave_tiles"] <= 640
```

For gable roofs require two gable edge closures and no hip cap objects. For flat roofs assert none of the pitched tile/cap/downspout objects are present. Retain the binary GLB header/size assertions, then reload the final artifact with the existing browser Three.js `GLTFLoader` during Task 6; do not add a new GLB parsing dependency only for tests.

- [ ] **Step 2: Run real Blender tests and verify RED**

Run:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests\test_generate_api.py rural_house_generator\backend\tests\test_end_to_end.py -q --basetemp=C:\Users\MR\.codex\visualizations\2026\08\10\019fe97d-3614-7702-b760-89c0accf5f05\pytest-blender-detail-red -p no:cacheprovider
```

Expected: structural assertions FAIL because current ridges are continuous cylinders and detailed objects are absent.

- [ ] **Step 3: Add reusable merged-mesh builders**

Implement focused helpers:

```python
def add_segmented_caps(name, start, end, radius, cap_length, overlap, maximum, material):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    count = bounded_segment_count(direction.length, cap_length - overlap, maximum)
    vertices, faces = [], []
    for index in range(count):
        center = start_v.lerp(end_v, (index + 0.5) / count)
        append_oriented_cap(vertices, faces, center, direction.normalized(), radius, cap_length)
    return mesh_from_buffers(name, vertices, faces, material), count


def add_eave_tile_strip(name, start, end, tile_width, rise, maximum, material):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    count = bounded_segment_count(direction.length, tile_width, maximum)
    vertices, faces = [], []
    for index in range(count):
        center = start_v.lerp(end_v, (index + 0.5) / count)
        append_eave_tile(vertices, faces, center, direction.normalized(), tile_width, rise)
    return mesh_from_buffers(name, vertices, faces, material), count


def add_downspout(name, top, wall_height, radius, material):
    vertices, faces = [], []
    append_pipe_section(vertices, faces, Vector(top), Vector((top[0], top[1], 0.12)), radius)
    append_pipe_section(vertices, faces, Vector((top[0], top[1], 0.12)), Vector((top[0], top[1] - 0.24, 0.12)), radius)
    append_hopper(vertices, faces, Vector(top), radius * 1.8)
    return mesh_from_buffers(name, vertices, faces, material)
```

Implement `mesh_from_buffers`, `append_oriented_cap`, `append_eave_tile`, `append_pipe_section`, and `append_hopper` in the same file. Each append helper adds transformed vertices and offset face indices to shared lists; only `mesh_from_buffers` creates a Blender object. Use eight radial sections for caps and pipes, apply transforms before GLB export, and never create one Blender object per repeated element.

- [ ] **Step 4: Replace continuous ridge cylinders and enrich the perimeter**

For hip roofs, generate one merged main-ridge cap object and four merged hip-ridge cap objects. For gable roofs, generate one ridge-cap object plus two gable edge closures. Add soffit slab, drip edges, front/rear eave tile strips, U-profile gutter meshes, two side downspouts, and corner closures. Keep the existing roof surface and material.

The gutter must be an open U/half-round profile rather than a solid cylinder. The downspout bottom ends 0.12 m above ground and turns away from the wall. Place details with small clearances derived from the profile to avoid z-fighting and obvious intersections.

- [ ] **Step 5: Persist detail counts and analysis in the manifest**

Read `config.get("roof_analysis")`, copy it to `manifest["roof"]["analysis"]`, and record counts returned by each builder. Do not place detection decisions inside Blender; optional features are only built when explicitly present in the resolved config and above threshold.

- [ ] **Step 6: Run real Blender tests and verify GREEN**

Run the Step 2 command again.

Expected: all real Blender and end-to-end tests PASS.

- [ ] **Step 7: Commit Blender details**

```powershell
git add -- rural_house_generator/backend/app/blender/generate_building.py rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py
git commit -m "feat: generate refined roof edge details"
```

---

### Task 6: Full Regression, Service Restart, and Browser Visual QA

**Files:**
- Modify if a defect is found: files owned by Tasks 1–5 and their corresponding tests only.
- Verify: `rural_house_generator/index.html`
- Verify: `rural_house_generator/app.js`
- Verify: generated runtime job artifacts and `model_manifest.json`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: a healthy local service set and one visually verified GLB from the current two-storey facade photo.

- [ ] **Step 1: Run the complete automated suite**

```powershell
node --test --test-isolation=none rural_house_generator\tests\photo-workflow.test.js rural_house_generator\tests\launcher.test.js
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest rural_house_generator\backend\tests -q --basetemp=C:\Users\MR\.codex\visualizations\2026\08\10\019fe97d-3614-7702-b760-89c0accf5f05\pytest-auto-roof-full -p no:cacheprovider
```

Expected: Node and Python suites report zero failures.

- [ ] **Step 2: Restart only verified local service processes**

Resolve listeners on ports 8000, 8011, 8012, and 8013. Stop a process only after its executable and command line match this repository’s launcher contract. Relaunch `start_facade_generator.ps1` with hidden windows and verify `/health` on 8011, 8012, and 8013 returns HTTP 200. Do not terminate unrelated Python processes.

- [ ] **Step 3: Verify the zero-choice browser flow**

Reload `http://127.0.0.1:8000/rural_house_generator/index.html?mode=photo`, upload the retained `001-1.jpg` sample, wait for rectification, drag the roof line, and confirm:

- the three selectors are absent from the normal flow;
- the automatic summary appears;
- the generate button waits for analysis and then enables;
- opening “高级设置” exposes the selectors;
- changing one field marks it manual without resetting the other automatic fields.

- [ ] **Step 4: Generate and visually inspect the refined GLB**

Generate the model, rotate and zoom the preview, and confirm visible tile scale, overlapping ridge caps, eave tile row, soffit/drip edge, open gutters, side downspouts, and clean corner closures. Check browser console warnings/errors and inspect the manifest’s resolved analysis and bounded detail counts.

- [ ] **Step 5: Fix any visual defect with a focused RED/GREEN test**

If visual inspection reveals a defect, add the smallest deterministic assertion reproducing it, confirm RED, patch only the owning module, rerun the focused test, and then repeat Steps 1 and 4. Do not weaken geometry-count or compatibility assertions to make a failure pass.

- [ ] **Step 6: Commit final QA adjustments, if any**

```powershell
git add -- rural_house_generator/photo-workflow.js rural_house_generator/tests/photo-workflow.test.js rural_house_generator/index.html rural_house_generator/style.css rural_house_generator/app.js rural_house_generator/backend/app/roof_analysis.py rural_house_generator/backend/app/schemas.py rural_house_generator/backend/app/main.py rural_house_generator/backend/app/blender_service.py rural_house_generator/backend/app/roof_profile.py rural_house_generator/backend/app/blender/generate_building.py rural_house_generator/backend/tests/test_roof_analysis.py rural_house_generator/backend/tests/test_roof_analysis_api.py rural_house_generator/backend/tests/test_direct_prepare.py rural_house_generator/backend/tests/test_roof_profile.py rural_house_generator/backend/tests/test_generate_api.py rural_house_generator/backend/tests/test_end_to_end.py
git commit -m "fix: polish automatic detailed roof preview"
```

Skip this commit only when Step 5 required no code changes.

---

## Final Verification Checklist

- [ ] The default UI exposes no roof choice before the user asks for advanced settings.
- [ ] Automatic values, confidence, source, warning, crop line, and revision persist in the job.
- [ ] Stale requests cannot overwrite the newest roof line or manual decision.
- [ ] Safe fallback never blocks preparing or generating a model.
- [ ] Manual values override per field and re-upload clears them.
- [ ] Existing clients and old task records still generate with the original fields.
- [ ] Hip, gable, and flat GLBs reload successfully.
- [ ] Pitched roofs show bounded merged geometry for ridge, eave, soffit, drainage, and closures.
- [ ] Flat roofs do not receive pitched-roof decorative geometry.
- [ ] No unconfirmed chimney, dormer, front gable, or compound roof is invented.
- [ ] Full Node and Python suites pass after the final visual inspection.
