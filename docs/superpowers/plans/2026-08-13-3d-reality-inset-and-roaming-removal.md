# 3D Reality Inset and Roaming Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable, fullscreen-capable Cesium ion reality-model inset for Asset `5133927`, synchronize building selection by code, and completely remove first-person and drone roaming.

**Architecture:** Keep the existing white-model Cesium Viewer in `app-3d.js` and create a focused `VillageRealityInsetModule` that owns the secondary Viewer, panel controls, terrain fallback, 3D Tiles lifecycle, and transparent proxy entities. `app-3d.js` remains the source of building state and sends normalized proxy records to the inset controller; selection callbacks connect both viewers without continuous camera synchronization.

**Tech Stack:** CesiumJS 1.118, browser JavaScript, HTML/CSS, Node.js `node:test`, Cesium ion Asset `5133927`.

## Global Constraints

- Preserve all pre-existing working-tree changes in `app-3d.js`, `app.js`, `index.html`, and `style.css`.
- Do not commit implementation files that contain unrelated pre-existing user changes; stage or commit only files proven to contain task-only changes.
- Use Cesium ion Asset ID `5133927` and the existing `window.CESIUM_ION_TOKEN` with read-only asset access.
- Do not add a Supabase table or persist inset position/model transforms.
- Keep ordinary Cesium camera navigation, measurement, building selection, attributes, and recenter behavior.
- Do not add `terra_b3dms.zip` or an extracted `terra_b3dms/` directory to Git.

---

### Task 1: Roaming Removal Contract

**Files:**
- Create: `features/3d/3d-runtime-integration.test.js`
- Modify: `app-3d.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `ENTRYPOINTS.md`
- Delete: `features/first-person/first-person-controller.js`
- Delete: `features/drone/drone-controller.js`
- Delete: `features/drone/assets/animated-drone.glb`
- Delete: `features/DJIA.glb`

**Interfaces:**
- Consumes: existing `window.Village3D` public API.
- Produces: `window.Village3D` without `toggleFirstPersonMode`; no roaming script requests, buttons, state, or runtime resources.

- [ ] **Step 1: Write the failing runtime integration test**

```js
test('roaming runtime is completely removed while core 3D controls remain', () => {
  assert.doesNotMatch(app, /first-person-controller|drone-controller/);
  assert.doesNotMatch(app3d, /VillageFirstPersonModule|VillageDroneModule|toggleFirstPersonMode|toggleDroneMode/);
  assert.doesNotMatch(html, /firstPerson3dBtn|drone3dBtn/);
  assert.doesNotMatch(css, /#firstPerson3dBtn|#drone3dBtn|\.map-drone-btn/);
  assert.match(app3d, /toggleMeasureMode/);
  assert.match(app3d, /function recenter\(/);
  for (const relative of roamingFiles) {
    assert.equal(fs.existsSync(path.join(root, relative)), false);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test features/3d/3d-runtime-integration.test.js`

Expected: FAIL because roaming scripts, buttons, functions, styles, and files still exist.

- [ ] **Step 3: Remove roaming references and files**

Remove both controller blocks from `app-3d.js`, their initialization/lifecycle calls, their click guards, and `toggleFirstPersonMode` from `window.Village3D`. Remove the lazy script loads, HTML buttons, CSS selectors, and outdated `ENTRYPOINTS.md` description. Change the hint to:

```js
const DEFAULT_3D_HINT_TEXT = "操作提示：左键拖拽平移，滚轮缩放，按住滚轮旋转。";
```

- [ ] **Step 4: Run the focused test and syntax checks**

Run:

```powershell
node --test features/3d/3d-runtime-integration.test.js
node --check app.js
node --check app-3d.js
```

Expected: all commands PASS.

---

### Task 2: Reality Inset Controller and Pure Helpers

**Files:**
- Create: `features/3d/reality-inset.js`
- Create: `features/3d/reality-inset.test.js`
- Modify: `features/3d/3d-runtime-integration.test.js`

**Interfaces:**
- Consumes: `{ Cesium, panel, container, statusEl, config, onBuildingSelected }`.
- Produces: `window.VillageRealityInsetModule.createController(options)` returning `{ enter, show, hide, toggle, resetView, setTerrainEnabled, syncBuildingProxies, focusBuilding, resize, destroy }`.
- Produces helpers `normalizeConfig(candidate)` and `clampPanelPosition(position, panelSize, boundsSize)` for Node tests.

- [ ] **Step 1: Write failing helper tests**

```js
test('normalizeConfig pins the approved asset and safe defaults', () => {
  assert.deepEqual(normalizeConfig({ ionAssetId: 5133927 }), {
    enabled: true,
    ionAssetId: 5133927,
    title: '米埗村实景模型',
    terrainEnabled: true,
    heightOffset: 0
  });
});

test('clampPanelPosition keeps a dragged panel inside the host', () => {
  assert.deepEqual(
    clampPanelPosition({ x: 900, y: -30 }, { width: 320, height: 220 }, { width: 1000, height: 700 }),
    { x: 680, y: 0 }
  );
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run: `node --test features/3d/reality-inset.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the UMD module and controller shell**

Use a browser/Node-compatible wrapper:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VillageRealityInsetModule = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function normalizeConfig(candidate = {}) {
    return {
      enabled: candidate.enabled !== false,
      ionAssetId: Number(candidate.ionAssetId) || 5133927,
      title: String(candidate.title || '米埗村实景模型'),
      terrainEnabled: candidate.terrainEnabled !== false,
      heightOffset: Number(candidate.heightOffset) || 0
    };
  }

  function clampPanelPosition(position, panelSize, boundsSize) {
    return {
      x: Math.min(Math.max(Number(position.x) || 0, 0), Math.max(0, boundsSize.width - panelSize.width)),
      y: Math.min(Math.max(Number(position.y) || 0, 0), Math.max(0, boundsSize.height - panelSize.height))
    };
  }

  function createController(options) {
    const config = normalizeConfig(options.config);
    let viewer = null;
    let tileset = null;
    let proxyDataSource = null;
    let visible = true;
    let destroyed = false;

    async function enter() {
      if (destroyed) return false;
      if (!viewer) viewer = createInsetViewer(options.Cesium, options.container);
      if (!tileset) tileset = await loadIonTileset(options.Cesium, viewer, config);
      return true;
    }

    return {
      enter,
      show: () => setVisible(true),
      hide: () => setVisible(false),
      toggle: () => setVisible(!visible),
      resetView,
      setTerrainEnabled,
      syncBuildingProxies,
      focusBuilding,
      resize: () => viewer?.resize(),
      destroy
    };
  }
  return { normalizeConfig, clampPanelPosition, createController };
});
```

The controller must lazily create a Cesium Viewer, load `Cesium3DTileset.fromIonAssetId(config.ionAssetId)`, expose loading/error/retry status, create proxy entities, and destroy all events/viewer resources.

- [ ] **Step 4: Run helper and integration tests**

Run: `node --test features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js`

Expected: PASS.

---

### Task 3: Inset Markup, Controls, Dragging, and Fullscreen

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Modify: `features/3d/3d-runtime-integration.test.js`

**Interfaces:**
- Consumes: `VillageRealityInsetModule` loaded before `app-3d.js`.
- Produces DOM IDs `reality3dPanel`, `reality3dTitlebar`, `reality3dContainer`, `reality3dStatus`, `reality3dFullscreenBtn`, `reality3dResetBtn`, `reality3dTerrainBtn`, `reality3dCloseBtn`, and `reality3dToggleBtn`.

- [ ] **Step 1: Add failing DOM and stylesheet assertions**

```js
assert.match(html, /id="reality3dPanel"/);
assert.match(html, /id="reality3dContainer"/);
assert.match(html, /id="reality3dFullscreenBtn"/);
assert.match(html, /id="reality3dToggleBtn"/);
assert.match(css, /\.reality-3d-panel\s*\{/);
assert.match(css, /\.reality-3d-panel\.is-fullscreen/);
assert.match(app, /features\/3d\/reality-inset\.js/);
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `node --test features/3d/3d-runtime-integration.test.js`

Expected: FAIL because the panel and module load do not exist.

- [ ] **Step 3: Add accessible panel markup and responsive styles**

Place the panel inside `.model-frame`, add button `aria-label`s, use a fixed default top/right offset, constrain drag transforms to the host, and implement `.is-hidden` and `.is-fullscreen` states. Keep the Cesium canvas at `width: 100%; height: 100%`.

- [ ] **Step 4: Load the controller module lazily**

Replace roaming lazy loads with:

```js
await loadScriptOnce(
  'features/3d/reality-inset.js?v=20260813-reality-inset',
  'reality-inset-script'
);
```

- [ ] **Step 5: Run integration and syntax checks**

Run:

```powershell
node --test features/3d/3d-runtime-integration.test.js
node --check features/3d/reality-inset.js
node --check app.js
```

Expected: PASS.

---

### Task 4: Main Viewer Building Synchronization

**Files:**
- Modify: `app-3d.js`
- Modify: `features/3d/reality-inset.js`
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/3d-runtime-integration.test.js`

**Interfaces:**
- Consumes: `syncBuildingProxies(records)` where each record is `{ code: string, name: string, positions: Cartesian3[], baseHeight: number, height: number }`.
- Produces: `focusBuilding(code): Promise<boolean>` and callback `onBuildingSelected(code)`.

- [ ] **Step 1: Add failing code-normalization and last-selection tests**

```js
test('normalizeBuildingCode makes proxy lookup stable', () => {
  assert.equal(normalizeBuildingCode(' h-001 '), 'H-001');
});

test('a newer focus request supersedes an older request token', () => {
  const gate = createFocusRequestGate();
  const first = gate.next();
  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js`

Expected: FAIL for missing synchronization helpers and integration calls.

- [ ] **Step 3: Build proxy records from current main entities**

Add `buildRealityProxyRecords()` in `app-3d.js`. Read polygon hierarchy, normalized source code, terrain/base height, and building height without mutating the original Entity. Call `syncBuildingProxies` after every successful building load/reload.

- [ ] **Step 4: Connect selection in both directions**

After `setActiveEntity(entity)` and `showEntityInfo(entity)` in the main click path, call:

```js
realityInsetController?.focusBuilding(entity.__sourceCode);
```

The inset callback resolves the main entity, sets it active, shows its info, and requests main-scene rendering. Guard programmatic selection to prevent recursive synchronization.

- [ ] **Step 5: Run focused tests and syntax checks**

Run:

```powershell
node --test features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js
node --check app-3d.js
node --check features/3d/reality-inset.js
```

Expected: PASS.

---

### Task 5: Terrain Fallback, Lifecycle, and Final Verification

**Files:**
- Modify: `features/3d/reality-inset.js`
- Modify: `app-3d.js`
- Modify: `.gitignore`
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/3d-runtime-integration.test.js`

**Interfaces:**
- Consumes: `enter()`, `hide()`, `show()`, `resize()`, `destroy()` from the inset controller.
- Produces: deterministic cleanup, ellipsoid fallback, paused hidden rendering, and repository protection for local model archives.

- [ ] **Step 1: Add failing lifecycle and ignore-policy assertions**

```js
assert.match(gitignore, /^terra_b3dms\.zip$/m);
assert.match(gitignore, /^terra_b3dms\/$/m);
assert.match(app3d, /realityInsetController\.destroy\(\)/);
assert.match(inset, /EllipsoidTerrainProvider/);
assert.match(inset, /requestRenderMode:\s*true/);
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js`

Expected: FAIL until lifecycle and ignore policy are complete.

- [ ] **Step 3: Implement fallback and lifecycle cleanup**

Use ellipsoid terrain immediately, attempt world terrain in the background only when enabled, update the terrain button state on fallback, disable continuous rendering while hidden, resize after fullscreen changes, and remove panel/document listeners in `destroy()`.

- [ ] **Step 4: Protect local model data**

Append exactly:

```gitignore
terra_b3dms.zip
terra_b3dms/
```

- [ ] **Step 5: Run complete verification**

Run:

```powershell
node --test features/3d/reality-inset.test.js features/3d/3d-runtime-integration.test.js features/models/group-model-library-integration.test.js features/ui/2d-cold-start.test.js
node --check app.js
node --check app-3d.js
node --check features/3d/reality-inset.js
rg -n "VillageFirstPersonModule|VillageDroneModule|firstPerson3dBtn|drone3dBtn|features/DJIA\.glb|animated-drone\.glb" app.js app-3d.js index.html style.css features ENTRYPOINTS.md
git diff --check
git status --short
```

Expected: all tests and syntax checks PASS; `rg` returns no runtime matches; `terra_b3dms.zip` no longer appears as untracked; unrelated pre-existing changes remain untouched.

- [ ] **Step 6: Perform browser smoke verification**

Open the 3D module and verify: white models render first; the inset loads Asset `5133927`; drag, reset, terrain toggle, close/reopen, and fullscreen work; clicking a known building focuses the inset proxy; measuring and recentering remain functional; no roaming controls or missing-resource requests remain.
