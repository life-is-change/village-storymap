# Reality Inset Usability and Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Cesium photogrammetry inset easier to manipulate by adding an in-page enlarged mode and drag resizing, while rendering the DJI Terra 3D Tiles at visibly higher fidelity.

**Architecture:** Keep `features/3d/reality-inset.js` as the isolated secondary-Viewer controller. Add pure helpers for size clamping and quality settings, then let the controller coordinate expanded, fullscreen, drag-resize, and Cesium resize state. The platform shell only supplies the new controls and styles; building proxy synchronization remains unchanged.

**Tech Stack:** Browser JavaScript, CesiumJS 1.118, HTML/CSS, Node.js built-in `node:test`, local in-app browser smoke testing.

## Global Constraints

- Normal mode remains a draggable upper-right overlay above the main white-model Viewer.
- Expanded mode occupies about 70% of the main 3D host while leaving white-model context visible.
- Fullscreen and expanded modes are mutually exclusive.
- Resize minimum is exactly 360 × 260 CSS pixels and the panel must remain inside the main 3D host.
- Viewer resolution scale is `Math.min(devicePixelRatio, 2)`.
- Tileset `maximumScreenSpaceError` is 4, `dynamicScreenSpaceError` is false, and cache is 256 MiB.
- Preserve terrain, reset, close/reopen, titlebar dragging, fullscreen, and two-way building selection.
- Do not expose or alter the current Cesium ion token or Asset ID 5133927.
- Preserve unrelated user changes already present in the dirty worktree. Because the implementation files contain mixed pre-existing edits, do not create implementation commits unless their exact staged diff can be proven to contain only this feature.

---

### Task 1: Lock quality and resize rules with pure-function tests

**Files:**
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/reality-inset.js`

**Interfaces:**
- Produces: `clampPanelSize(size, boundsSize, minimumSize?) -> { width, height }`
- Produces: `getRealityRenderQuality(devicePixelRatio?) -> { resolutionScale, tilesetOptions }`
- Existing consumers continue using `clampPanelPosition` unchanged.

- [ ] **Step 1: Write the failing helper tests**

Add imports for `clampPanelSize` and `getRealityRenderQuality`, then add:

```js
test('clampPanelSize enforces the minimum and host boundary', () => {
  assert.deepEqual(
    clampPanelSize({ width: 200, height: 900 }, { width: 1000, height: 700 }),
    { width: 360, height: 700 }
  );
});

test('reality render quality favors sharp tiles without exceeding 2x DPR', () => {
  assert.deepEqual(getRealityRenderQuality(2.5), {
    resolutionScale: 2,
    tilesetOptions: {
      maximumScreenSpaceError: 4,
      dynamicScreenSpaceError: false,
      cacheBytes: 256 * 1024 * 1024
    }
  });
  assert.equal(getRealityRenderQuality(1.25).resolutionScale, 1.25);
});
```

- [ ] **Step 2: Run the unit test and observe the expected failure**

Run: `node features/3d/reality-inset.test.js`

Expected: FAIL because `clampPanelSize` and `getRealityRenderQuality` are not exported.

- [ ] **Step 3: Implement the pure helpers and exports**

Add near `clampPanelPosition`:

```js
function clampPanelSize(size = {}, boundsSize = {}, minimumSize = {}) {
  const minWidth = Math.max(0, toFiniteNumber(minimumSize.width, 360));
  const minHeight = Math.max(0, toFiniteNumber(minimumSize.height, 260));
  const boundsWidth = Math.max(0, toFiniteNumber(boundsSize.width, minWidth));
  const boundsHeight = Math.max(0, toFiniteNumber(boundsSize.height, minHeight));
  return {
    width: Math.min(Math.max(toFiniteNumber(size.width, minWidth), minWidth), boundsWidth),
    height: Math.min(Math.max(toFiniteNumber(size.height, minHeight), minHeight), boundsHeight)
  };
}

function getRealityRenderQuality(devicePixelRatio = 1) {
  return {
    resolutionScale: Math.min(Math.max(toFiniteNumber(devicePixelRatio, 1), 1), 2),
    tilesetOptions: {
      maximumScreenSpaceError: 4,
      dynamicScreenSpaceError: false,
      cacheBytes: 256 * 1024 * 1024
    }
  };
}
```

Export both helpers from the module return object.

- [ ] **Step 4: Run the helper tests**

Run: `node features/3d/reality-inset.test.js`

Expected: 9 tests pass, 0 fail.

- [ ] **Step 5: Checkpoint the exact diff**

Run: `git diff -- features/3d/reality-inset.js features/3d/reality-inset.test.js`

Expected: only the two helpers, their exports, imports, and tests are new in this task. Do not commit mixed pre-existing hunks.

---

### Task 2: Add accessible enlarge and resize controls to the shell

**Files:**
- Modify: `features/3d/3d-runtime-integration.test.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app-3d.js`

**Interfaces:**
- Produces DOM references `reality3dExpandBtn` and `reality3dResizeHandle`.
- `ensureRealityInsetController()` passes them as `expandButton` and `resizeHandle`.
- The controller will apply `is-expanded` and `is-resizing` classes in Task 3.

- [ ] **Step 1: Write the failing integration assertions**

Extend the existing “3D view exposes…” test with:

```js
const app3d = read('app-3d.js');
assert.match(html, /id="reality3dExpandBtn"[^>]*aria-label="放大实景窗口"/);
assert.match(html, /id="reality3dResizeHandle"[^>]*aria-label="调整实景窗口大小"/);
assert.match(css, /\.reality-3d-panel\.is-expanded/);
assert.match(css, /\.reality-3d-resize-handle/);
assert.match(app3d, /expandButton:\s*byId\("reality3dExpandBtn"\)/);
assert.match(app3d, /resizeHandle:\s*byId\("reality3dResizeHandle"\)/);
```

- [ ] **Step 2: Run the integration test and observe failure**

Run: `node features/3d/3d-runtime-integration.test.js`

Expected: FAIL at the first missing `reality3dExpandBtn` assertion.

- [ ] **Step 3: Add the two HTML controls**

Between reset and fullscreen buttons add:

```html
<button id="reality3dExpandBtn" type="button" aria-label="放大实景窗口" title="放大实景窗口" aria-pressed="false">↗</button>
```

Inside `.reality-3d-stage`, after the retry button, add:

```html
<button id="reality3dResizeHandle" class="reality-3d-resize-handle" type="button" aria-label="调整实景窗口大小" title="拖动调整窗口大小"></button>
```

- [ ] **Step 4: Add expanded, resized, and responsive CSS**

Increase normal panel sizing and add explicit states:

```css
.reality-3d-panel {
  width: clamp(400px, 42%, 680px);
  height: clamp(300px, 46%, 500px);
  min-width: 360px;
  min-height: 260px;
}

.reality-3d-panel.is-expanded {
  top: 3% !important;
  right: 3% !important;
  left: auto !important;
  width: 70% !important;
  height: 70% !important;
}

.reality-3d-panel.is-resizing {
  user-select: none;
  transition: none;
}

.reality-3d-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 6;
  width: 26px;
  height: 26px;
  border: 0;
  background: linear-gradient(135deg, transparent 48%, rgba(255,255,255,.9) 49% 57%, transparent 58% 65%, rgba(255,255,255,.9) 66% 74%, transparent 75%);
  cursor: nwse-resize;
  touch-action: none;
}
```

In the narrow-screen media query use `min-width: 0`, `width: min(520px, calc(100% - 20px))`, and ensure `.is-expanded` uses `width: calc(100% - 20px) !important` and `height: 70% !important`.

- [ ] **Step 5: Pass the DOM references into the controller**

In `ensureRealityInsetController()` add:

```js
expandButton: byId("reality3dExpandBtn"),
resizeHandle: byId("reality3dResizeHandle"),
```

- [ ] **Step 6: Run the integration test**

Run: `node features/3d/3d-runtime-integration.test.js`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 7: Checkpoint the exact shell diff**

Run: `git diff -- index.html style.css app-3d.js features/3d/3d-runtime-integration.test.js`

Expected: the new controls, style states, references, and assertions are present without changing the Token or Asset ID.

---

### Task 3: Implement enlarge, resize, and high-quality Cesium behavior

**Files:**
- Modify: `features/3d/reality-inset.test.js`
- Modify: `features/3d/reality-inset.js`

**Interfaces:**
- Consumes: `expandButton`, `resizeHandle`, `clampPanelSize`, and `getRealityRenderQuality`.
- Produces controller method `toggleExpanded(force?) -> boolean`.
- Existing controller methods and callbacks retain their signatures.

- [ ] **Step 1: Extend the lifecycle API test**

Add `toggleExpanded` to the expected controller method list:

```js
[
  'enter', 'show', 'hide', 'toggle', 'toggleExpanded', 'resetView',
  'setTerrainEnabled', 'syncBuildingProxies', 'focusBuilding', 'resize', 'destroy'
].forEach((name) => assert.equal(typeof controller[name], 'function', name));
```

- [ ] **Step 2: Run the unit test and observe failure**

Run: `node features/3d/reality-inset.test.js`

Expected: FAIL because `controller.toggleExpanded` is undefined.

- [ ] **Step 3: Add controller state and expanded-mode behavior**

Resolve `expandButton` and `resizeHandle`, then add `expanded` and `normalPanelRect` state. Implement:

```js
function updateExpandedUi() {
  panel?.classList.toggle("is-expanded", expanded);
  expandButton?.classList.toggle("is-active", expanded);
  expandButton?.setAttribute("aria-pressed", expanded ? "true" : "false");
  expandButton?.setAttribute("aria-label", expanded ? "还原实景窗口" : "放大实景窗口");
  expandButton?.setAttribute("title", expanded ? "还原实景窗口" : "放大实景窗口");
  setTimeout(() => resize(), 0);
}

function toggleExpanded(force) {
  if (!panel || documentRef?.fullscreenElement === panel || fullscreenFallback) return false;
  const next = typeof force === "boolean" ? force : !expanded;
  if (next === expanded) return expanded;
  if (next) {
    const hostRect = host.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    normalPanelRect = {
      left: panelRect.left - hostRect.left,
      top: panelRect.top - hostRect.top,
      width: panelRect.width,
      height: panelRect.height
    };
    panel.style.removeProperty("width");
    panel.style.removeProperty("height");
  } else if (normalPanelRect) {
    panel.style.left = `${normalPanelRect.left}px`;
    panel.style.top = `${normalPanelRect.top}px`;
    panel.style.right = "auto";
    panel.style.width = `${normalPanelRect.width}px`;
    panel.style.height = `${normalPanelRect.height}px`;
  }
  expanded = next;
  updateExpandedUi();
  return expanded;
}
```

Bind the expand button click and titlebar double-click. Ignore double-clicks originating from titlebar buttons.

- [ ] **Step 4: Make fullscreen mutually exclusive with expanded mode**

Before entering fullscreen call `toggleExpanded(false)`. In `updateFullscreenUi()`, disable the expand button while fullscreen is active and keep its ARIA state accurate.

- [ ] **Step 5: Implement pointer-driven resize**

Add `bindResizing()` using the same document-level pointer pattern as titlebar dragging:

```js
const onPointerMove = (event) => {
  if (!resizeState) return;
  const size = clampPanelSize(
    {
      width: resizeState.width + event.clientX - resizeState.pointerX,
      height: resizeState.height + event.clientY - resizeState.pointerY
    },
    {
      width: resizeState.hostWidth - resizeState.left,
      height: resizeState.hostHeight - resizeState.top
    }
  );
  panel.style.width = `${size.width}px`;
  panel.style.height = `${size.height}px`;
  resize();
};
```

On pointerdown, exit expanded mode first, capture host/panel dimensions, set pointer capture when supported, and add `is-resizing`. On pointerup/cancel, remove the state class, constrain the panel, and call a final `resize()`.

- [ ] **Step 6: Observe panel size changes not caused by pointer dragging**

When `root.ResizeObserver` is available, observe `panel` and call `resize()` from the callback. Register `disconnect()` in `cleanupCallbacks`. Keep the existing window resize fallback.

- [ ] **Step 7: Apply the approved quality settings**

In `createViewer()`:

```js
const quality = getRealityRenderQuality(root.devicePixelRatio);
instance.resolutionScale = quality.resolutionScale;
```

In `loadTileset()`:

```js
const quality = getRealityRenderQuality(root.devicePixelRatio);
const nextTileset = await CesiumRef.Cesium3DTileset.fromIonAssetId(
  config.ionAssetId,
  quality.tilesetOptions
);
```

- [ ] **Step 8: Export the new API and bind all controls once**

Return `toggleExpanded` from the controller API, call `bindResizing()` beside `bindDragging()`, and remove all new listeners/observers through the existing cleanup mechanism in `destroy()`.

- [ ] **Step 9: Run focused tests and syntax checks**

Run:

```powershell
node features/3d/reality-inset.test.js
node features/3d/3d-runtime-integration.test.js
node --check features/3d/reality-inset.js
node --check app-3d.js
```

Expected: 13 tests pass across the two test files and both syntax checks exit 0.

- [ ] **Step 10: Checkpoint the exact controller diff**

Run: `git diff -- features/3d/reality-inset.js features/3d/reality-inset.test.js`

Expected: quality settings and expanded/resize behavior match the spec; proxy selection and terrain logic are unchanged.

---

### Task 4: Run regression and browser visual verification

**Files:**
- Temporarily create then delete: `_reality-inset-quality-smoke.html`
- Verify: `features/3d/reality-inset.js`
- Verify: `index.html`
- Verify: `style.css`

**Interfaces:**
- Consumes the production controller and current `window.CESIUM_ION_TOKEN` without copying the token into the temporary file.
- Produces no persistent runtime file.

- [ ] **Step 1: Run all relevant automated tests**

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

Expected: every test passes and every syntax check exits 0.

- [ ] **Step 2: Create a temporary local smoke page using production assets**

The page must load `style.css`, CesiumJS 1.118, and `features/3d/reality-inset.js`; fetch `index.html` locally to read the existing `window.CESIUM_ION_TOKEN`; instantiate Asset 5133927; and reproduce the production panel DOM including expand and resize controls. Do not print or persist the extracted Token.

- [ ] **Step 3: Verify real-model readiness and quality in the browser**

Start `python -m http.server 8765 --bind 127.0.0.1`, open the temporary page, and wait until `#reality3dStatus` reads `实景模型已就绪`.

Evaluate the live canvas and assert:

```js
const canvas = document.querySelector('#reality3dContainer canvas');
({
  cssWidth: canvas.clientWidth,
  cssHeight: canvas.clientHeight,
  drawingWidth: canvas.width,
  drawingHeight: canvas.height
});
```

Expected: drawing-buffer dimensions are at least the CSS dimensions and increase according to device DPR up to the 2× cap. The exact tileset options are already locked by the pure-function unit test, while this browser check proves the production canvas applies the higher resolution.

- [ ] **Step 4: Verify window interactions visually**

Check all of the following:

- Clicking “放大实景窗口” applies `is-expanded`, changes its label to “还原实景窗口”, and leaves part of the white-model background visible.
- Clicking again restores the prior position and dimensions.
- Dragging the resize handle increases the panel dimensions and the Cesium canvas follows the new dimensions.
- Fullscreen clears expanded mode and exiting fullscreen returns to a usable normal panel.
- Close/reopen, terrain toggle, reset, titlebar dragging, and building status text remain functional.
- Browser console has no new error from the inset controller.

- [ ] **Step 5: Clean temporary artifacts and rerun verification**

Finalize browser tabs, delete `_reality-inset-quality-smoke.html`, stop the local server, then run:

```powershell
node features/3d/reality-inset.test.js
node features/3d/3d-runtime-integration.test.js
node --check features/3d/reality-inset.js
git diff --check
Test-Path -LiteralPath '_reality-inset-quality-smoke.html'
```

Expected: tests and syntax check pass; `git diff --check` reports no whitespace error; the final command returns `False`.

- [ ] **Step 6: Report the browser-side performance tradeoff**

State that clarity is improved by client-side DPR and tile refinement, while initial tile loading, network transfer, GPU load, and memory use increase. Do not claim the 4090 server renders the Cesium client.
