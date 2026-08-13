# Reality Building Closeup Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace proxy-entity `flyTo` with a safe, size-aware oblique closeup camera that targets the actual photogrammetry surface of the selected building.

**Architecture:** The main Viewer summarizes each building footprint as center longitude/latitude, horizontal radius, height, and fallback base height. The reality controller samples the highest-detail scene surface at that center, derives a building upper-center target, and flies a synthetic bounding sphere with deterministic safe pitch and range. Existing proxy entities remain only for code matching and reverse picking.

**Tech Stack:** Browser JavaScript, CesiumJS 1.118 (`Scene.sampleHeightMostDetailed`, `Camera.flyToBoundingSphere`), Node.js built-in `node:test`, local browser smoke testing.

## Global Constraints

- Preserve Asset ID 5133927, the current Cesium ion Token, model transform, building code matching, panel layout, and two-way selection.
- Do not call `viewer.flyTo(proxyEntity)` for building closeups.
- Use `scene.sampleHeightMostDetailed` when supported; it must finish before the camera flight begins.
- Target pitch is exactly `-Math.PI / 6` (about -30 degrees).
- Closeup range is clamped to 35–90 metres.
- Target height is sampled roof height minus 35% of building height; fallback target height is base height plus 65% of building height.
- A stale height-sampling result must never move the camera after a newer building selection.
- Preserve unrelated user changes in the dirty `learning` worktree; do not stage or commit mixed implementation files.

---

### Task 1: Define deterministic closeup camera calculations

**Files:**
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/reality-inset.js`

**Interfaces:**
- Produces: `resolveRealityTargetHeight(sampledHeight, fallbackBaseHeight, buildingHeight) -> { height, sampled }`
- Produces: `getRealityCloseupCamera(record, sampledHeight, currentHeading?) -> { longitude, latitude, targetHeight, radius, heading, pitch, range, sampled } | null`

- [ ] **Step 1: Write failing target-height and camera tests**

Import the two new helpers and add:

```js
test('sampled roof height produces a target inside the upper building volume', () => {
  assert.deepEqual(resolveRealityTargetHeight(128, 100, 12), {
    height: 123.8,
    sampled: true
  });
});

test('missing scene height falls back above the building base', () => {
  assert.deepEqual(resolveRealityTargetHeight(undefined, 100, 12), {
    height: 107.8,
    sampled: false
  });
});

test('closeup camera frames a house from a safe oblique range', () => {
  const camera = getRealityCloseupCamera({
    longitude: 1.98,
    latitude: 0.39,
    horizontalRadius: 8,
    height: 12,
    baseHeight: 100
  }, 128, 0.75);
  assert.equal(camera.targetHeight, 123.8);
  assert.equal(camera.heading, 0.75);
  assert.equal(camera.pitch, -Math.PI / 6);
  assert.equal(camera.range, 35);
  assert.equal(camera.radius, 8);
  assert.equal(camera.sampled, true);
});

test('closeup camera pulls back for large buildings without exceeding 90 metres', () => {
  const camera = getRealityCloseupCamera({
    longitude: 1.98,
    latitude: 0.39,
    horizontalRadius: 40,
    height: 30,
    baseHeight: 100
  }, 135, NaN);
  assert.equal(camera.range, 90);
  assert.equal(camera.pitch, -Math.PI / 6);
  assert.ok(Number.isFinite(camera.heading));
});
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `node features/3d/reality-inset.test.js`

Expected: FAIL because both helpers are undefined.

- [ ] **Step 3: Implement the pure calculation helpers**

Add:

```js
function clampNumber(value, minimum, maximum, fallback) {
  const finite = toFiniteNumber(value, fallback);
  return Math.min(Math.max(finite, minimum), maximum);
}

function resolveRealityTargetHeight(sampledHeight, fallbackBaseHeight, buildingHeight) {
  const safeHeight = Math.max(1, toFiniteNumber(buildingHeight, 9));
  if (Number.isFinite(Number(sampledHeight))) {
    return {
      height: Number(sampledHeight) - safeHeight * 0.35,
      sampled: true
    };
  }
  return {
    height: toFiniteNumber(fallbackBaseHeight, 0) + safeHeight * 0.65,
    sampled: false
  };
}

function getRealityCloseupCamera(record = {}, sampledHeight, currentHeading) {
  const longitude = Number(record.longitude);
  const latitude = Number(record.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const buildingHeight = Math.max(1, toFiniteNumber(record.height, 9));
  const radius = Math.max(
    6,
    toFiniteNumber(record.horizontalRadius, 6),
    buildingHeight / 2
  );
  const target = resolveRealityTargetHeight(
    sampledHeight,
    record.baseHeight,
    buildingHeight
  );
  return {
    longitude,
    latitude,
    targetHeight: target.height,
    radius,
    heading: Number.isFinite(Number(currentHeading)) ? Number(currentHeading) : Math.PI * 0.75,
    pitch: -Math.PI / 6,
    range: clampNumber(radius * 4.5, 35, 90, 35),
    sampled: target.sampled
  };
}
```

Export both public helpers. Keep `clampNumber` private.

- [ ] **Step 4: Run the unit tests and verify GREEN**

Run: `node features/3d/reality-inset.test.js`

Expected: 14 tests pass, 0 fail.

- [ ] **Step 5: Inspect the focused diff**

Run: `git diff -- features/3d/reality-inset.js features/3d/reality-inset.test.js`

Expected: only the new helpers, exports, imports, and four tests are added in this task.

---

### Task 2: Add footprint center and radius to proxy records

**Files:**
- Modify: `features/3d/3d-runtime-integration.test.js`
- Modify: `app-3d.js`

**Interfaces:**
- Consumes: existing `getEntityCenterCartographic(entity)` and `getEntityFootprintSizeMeters(entity, headingDeg)`.
- Produces proxy record fields `longitude`, `latitude`, and `horizontalRadius` in radians/metres.
- Existing `positions`, `baseHeight`, `height`, `code`, and `name` remain unchanged.

- [ ] **Step 1: Write the failing integration assertions**

In the “main and reality viewers synchronize…” test add:

```js
assert.match(app3d, /const center = getEntityCenterCartographic\(entity\)/);
assert.match(app3d, /longitude:\s*center\.longitude/);
assert.match(app3d, /latitude:\s*center\.latitude/);
assert.match(app3d, /horizontalRadius:/);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node features/3d/3d-runtime-integration.test.js`

Expected: FAIL because `buildRealityProxyRecords` does not create center/radius metadata.

- [ ] **Step 3: Compute the geometry summary in `buildRealityProxyRecords`**

Before pushing each record:

```js
const center = getEntityCenterCartographic(entity);
if (!center) return;
const footprint = getEntityFootprintSizeMeters(
  entity,
  estimateEntityFootprintHeadingDeg(entity)
);
const horizontalRadius = footprint
  ? Math.hypot(footprint.sizeX, footprint.sizeY) / 2
  : 6;
```

Add to the record:

```js
longitude: center.longitude,
latitude: center.latitude,
horizontalRadius: Number.isFinite(horizontalRadius) ? Math.max(1, horizontalRadius) : 6,
```

- [ ] **Step 4: Run the integration test and syntax check**

Run:

```powershell
node features/3d/3d-runtime-integration.test.js
node --check app-3d.js
```

Expected: 4 tests pass and syntax check exits 0.

- [ ] **Step 5: Inspect the app integration diff**

Run: `git diff -- app-3d.js features/3d/3d-runtime-integration.test.js`

Expected: only proxy metadata generation and its assertions are new; white-model geometry and terrain code are unchanged.

---

### Task 3: Sample the photogrammetry surface and fly a synthetic target

**Files:**
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/reality-inset.js`

**Interfaces:**
- Consumes proxy records containing `longitude`, `latitude`, `horizontalRadius`, `height`, and `baseHeight`.
- Produces private `sampleRealitySurfaceHeight(record) -> Promise<number | undefined>`.
- `focusBuilding(sourceCode) -> Promise<boolean>` retains its public signature.

- [ ] **Step 1: Add source-level regression assertions before production edits**

Add a test that reads `reality-inset.js` through `fs.readFileSync` and asserts:

```js
assert.match(source, /sampleHeightMostDetailed/);
assert.match(source, /camera\.flyToBoundingSphere/);
assert.doesNotMatch(source, /viewer\.flyTo\(entity/);
```

- [ ] **Step 2: Run the unit test and verify RED**

Run: `node features/3d/reality-inset.test.js`

Expected: FAIL because the controller still contains `viewer.flyTo(entity)` and has no surface sampling.

- [ ] **Step 3: Preserve focus metadata alongside each proxy entity**

In `applyProxyRecords`, after creating an entity, assign a normalized record:

```js
entity.__realityFocusRecord = {
  code,
  longitude: toFiniteNumber(record.longitude, NaN),
  latitude: toFiniteNumber(record.latitude, NaN),
  horizontalRadius: Math.max(1, toFiniteNumber(record.horizontalRadius, 6)),
  baseHeight,
  height
};
```

- [ ] **Step 4: Implement highest-detail surface sampling**

Add:

```js
async function sampleRealitySurfaceHeight(record) {
  if (!viewer?.scene || !CesiumRef || !record) return undefined;
  const longitude = Number(record.longitude);
  const latitude = Number(record.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  if (
    viewer.scene.sampleHeightSupported === false ||
    typeof viewer.scene.sampleHeightMostDetailed !== "function"
  ) return undefined;

  try {
    const samples = await viewer.scene.sampleHeightMostDetailed([
      new CesiumRef.Cartographic(longitude, latitude, 0)
    ]);
    const height = Number(samples?.[0]?.height);
    return Number.isFinite(height) ? height : undefined;
  } catch (_) {
    return undefined;
  }
}
```

- [ ] **Step 5: Replace entity `flyTo` with closeup camera flight**

In `focusBuilding`:

1. Read `entity.__realityFocusRecord` and reject records without a valid center.
2. Set status to `正在获取实景建筑表面…`.
3. Await `sampleRealitySurfaceHeight(record)`.
4. Immediately recheck `focusGate.isCurrent(token)`.
5. Call `getRealityCloseupCamera(record, sampledHeight, viewer.camera.heading)`.
6. Create the target and sphere:

```js
const target = CesiumRef.Cartesian3.fromRadians(
  camera.longitude,
  camera.latitude,
  camera.targetHeight
);
const sphere = new CesiumRef.BoundingSphere(target, camera.radius);
await new Promise((resolve, reject) => {
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.1,
    offset: new CesiumRef.HeadingPitchRange(
      camera.heading,
      camera.pitch,
      camera.range
    ),
    complete: resolve,
    cancel: () => reject(new Error("CAMERA_FLIGHT_CANCELLED"))
  });
});
```

7. Recheck the request token before setting the final status.
8. Use `已定位建筑 CODE` when sampled and `已使用近似高度定位建筑 CODE` when falling back.

- [ ] **Step 6: Run focused tests and syntax checks**

Run:

```powershell
node features/3d/reality-inset.test.js
node features/3d/3d-runtime-integration.test.js
node --check features/3d/reality-inset.js
node --check app-3d.js
```

Expected: all tests pass, no `viewer.flyTo(entity)` remains, and both syntax checks exit 0.

- [ ] **Step 7: Inspect the controller diff**

Run: `git diff -- features/3d/reality-inset.js features/3d/reality-inset.test.js`

Expected: proxy picking, terrain switching, window controls, and tileset quality settings remain unchanged.

---

### Task 4: Verify the closeup against the real Cesium asset

**Files:**
- Temporarily create then delete: `_reality-closeup-smoke.html`
- Verify: `features/3d/reality-inset.js`
- Verify: `app-3d.js`

**Interfaces:**
- Uses production Cesium Token indirectly by reading `index.html`; the Token must never be printed or copied into the temporary page.
- Uses a known proxy record near the loaded asset or the currently selected building record supplied by the harness.
- Produces no persistent test artifact.

- [ ] **Step 1: Run the complete relevant regression suite**

Run:

```powershell
node features/3d/reality-inset.test.js
node features/3d/3d-runtime-integration.test.js
node features/models/group-model-library-integration.test.js
node features/ui/2d-cold-start.test.js
node --check app.js
node --check app-3d.js
node --check features/3d/reality-inset.js
```

Expected: every test passes and each syntax check exits 0.

- [ ] **Step 2: Create a temporary real-asset harness**

Load CesiumJS 1.118, production `style.css`, production `reality-inset.js`, and Asset 5133927. Read the Token from local `index.html` at runtime. Supply one proxy record with the selected building's actual center, radius, height, and base height, then call `focusBuilding(code)` after `enter()`.

- [ ] **Step 3: Verify the live camera numerically**

After the focus promise resolves, evaluate:

```js
const cameraCartographic = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, focusTarget);
({ cameraHeight: cameraCartographic.height, targetHeight, distance, statusText });
```

Expected:

- status is `已定位建筑 CODE` or the explicit approximate-height fallback;
- distance is between 35 and 100 metres, allowing Cesium's bounding-sphere framing adjustment;
- camera height is above target height;
- controller does not throw or leave the camera inside scene geometry.

- [ ] **Step 4: Verify the visual composition**

Capture a screenshot and confirm the selected building is centered with both roof and façade visible. Confirm the view does not resemble a ground-level green mesh and the browser console has no new warning/error.

- [ ] **Step 5: Clean up and run final verification**

Finalize browser tabs, delete `_reality-closeup-smoke.html`, stop the local server, then run:

```powershell
node features/3d/reality-inset.test.js
node features/3d/3d-runtime-integration.test.js
node --check features/3d/reality-inset.js
git diff --check
Test-Path -LiteralPath '_reality-closeup-smoke.html'
```

Expected: tests and syntax checks pass, no whitespace error is reported, and the temporary path returns `False`.

- [ ] **Step 6: Report limitations accurately**

State that the camera composition is corrected without changing building correspondence. If a footprint center lies on a tree canopy or outside the photogrammetry coverage, height sampling may use that surface or the fallback; the safe range still prevents the camera from entering the mesh.

