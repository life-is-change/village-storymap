# Personal Space Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personal course spaces authoritative and private, make layer visibility responsive, and render figure-ground as a live combination of current personal layers.

**Architecture:** `course_personal_spaces` remains the personal-work source of truth; legacy `planning_spaces` is limited to staff and the active group. The map renderer receives one latest-wins refresh request and skips unrelated community requests on ordinary layer toggles. The figure-ground switch is a live view over the four selected personal layer versions rather than a separately stored result.

**Tech Stack:** Vanilla JavaScript, OpenLayers, Supabase Auth/PostgREST/RLS, Node built-in test runner.

## Global Constraints

- Work only on `learning`; do not stage `docs/superpowers/*linux*` or `experiments/`.
- Keep the existing building/road/water/contour visual styles unchanged.
- Personal spaces must never be upserted into `planning_spaces`.
- Do not delete existing Supabase rows in this change.
- Do not commit or push unless the user separately requests it.

---

### Task 1: Make planning-space sync account- and group-safe

**Files:**
- Modify: `features/course/course-workspace-adapter.js`
- Modify: `app.js:619-740, 1678-1777`
- Create: `supabase_SQL/Secure Planning Space Visibility.sql`
- Modify: `features/course/course-workspace-adapter.test.js`
- Create: `features/data/planning-space-security.test.js`

**Interfaces:**
- Produces `filterRemotePlanningSpaces(remoteSpaces, visibility)` and `mergeWorkspaceSpaces(options)`.
- `mergeWorkspaceSpaces` returns the base space, all local `course_personal` spaces, and only visible remote course-group spaces.

- [ ] **Step 1: Write failing tests**

```js
assert.deepEqual(filterRemotePlanningSpaces(remote, {
  isAdmin: false,
  activeGroupId: "group-mine"
}).map((space) => space.id), ["group-mine"]);

assert.deepEqual(mergeWorkspaceSpaces({
  localSpaces: [base, personal, stale],
  remoteSpaces: [],
  baseSpaceId: "current",
  activeGroupId: ""
}), [base, personal]);
```

- [ ] **Step 2: Run the tests and verify they fail because the helpers are absent.**

Run: `node features/course/course-workspace-adapter.test.js`

- [ ] **Step 3: Implement the adapter helpers and use them in `syncSpacesFromSupabase`.**

```js
const merged = mergeWorkspaceSpaces({
  localSpaces: spaces,
  remoteSpaces,
  baseSpaceId: BASE_SPACE_ID,
  isStaff,
  activeGroupId
});
```

Treat `[]` from Supabase as a successful authoritative response. Preserve personal spaces and use `saveSpacesToStorage({ syncRemote: false })` while creating one.

- [ ] **Step 4: Add and validate the RLS migration.**

The SQL drops `"Allow all"`, grants staff access, grants a student access only where their profile key matches a `group_memberships` row, and revokes anonymous access.

- [ ] **Step 5: Run focused tests.**

Run: `node features/course/course-workspace-adapter.test.js; node features/data/planning-space-security.test.js`

### Task 2: Make map refresh latest-wins and decouple community data

**Files:**
- Modify: `features/map-editing/overlay-renderer.js`
- Modify: `app.js:3138-3205, 5205-5207, 7240-7317`
- Modify: `features/ui/space-panel-events.js:126-175`
- Modify: `features/map-editing/overlay-renderer.test.js`

**Interfaces:**
- Produces `createOverlayRefreshController({ render })` with `request()` and `invalidate()`.
- The controller runs one render at a time and discards results from superseded requests.

- [ ] **Step 1: Write a failing refresh-controller test.**

```js
const calls = [];
const controller = createOverlayRefreshController({
  render: async (request) => calls.push(request.id)
});
await Promise.all([controller.request(), controller.request()]);
assert.deepEqual(calls, [2]);
```

- [ ] **Step 2: Run the focused test and verify the controller is absent.**

Run: `node features/map-editing/overlay-renderer.test.js`

- [ ] **Step 3: Implement latest-wins overlay refresh.**

`refresh2DOverlay()` must await the newest request. Layer-button handlers must await it. Normal overlay refresh must not call `refreshCommunityTasksOnMap`; community data retains its own explicit refresh path.

- [ ] **Step 4: Narrow the right-bottom refresh button.**

For a personal space, invalidate only `personalSpaceClient` data for the current personal space and re-render its four current layers. It must not call `syncSpacesFromSupabase`, clear teacher GeoJSON cache, or refresh community data.

- [ ] **Step 5: Run focused tests.**

Run: `node features/map-editing/overlay-renderer.test.js; node features/ui/course-workbench.test.js`

### Task 3: Make figure-ground a live personal composition

**Files:**
- Modify: `features/ui/personal-layer-versions.js`
- Modify: `features/ui/personal-layer-versions.test.js`
- Modify: `app.js:1715-1777, 2640-2648`
- Modify: `features/map-editing/overlay-renderer.js`

**Interfaces:**
- Produces `resolveLiveFigureGroundLayerKeys()` returning `['building', 'road', 'water', 'contours']`.
- `refreshLiveFigureGroundIfActive()` only refreshes when the current space is personal and the selected layer set contains `figureGround`.

- [ ] **Step 1: Write a failing composition test.**

```js
assert.deepEqual(resolveLiveFigureGroundLayerKeys(), [
  "building", "road", "water", "contours"
]);
assert.equal(shouldRefreshLiveFigureGround({
  spaceType: "course_personal",
  selectedLayers: ["figureGround"]
}), true);
```

- [ ] **Step 2: Run the focused test and verify the live-refresh predicate is absent.**

Run: `node features/ui/personal-layer-versions.test.js`

- [ ] **Step 3: Implement the live composition helpers.**

Keep the four existing current-version queries and styles. Do not create a composition table or extra result version.

- [ ] **Step 4: Call the live-refresh helper after personal import, personal edit save, and current-version change.**

```js
await personalSpaceClient.saveEdits(spaceId, changes);
await refreshLiveFigureGroundIfActive();
```

- [ ] **Step 5: Run focused tests.**

Run: `node features/ui/personal-layer-versions.test.js; node features/ui/course-workbench.test.js`

### Task 4: Verify the integrated classroom path

**Files:**
- Modify: `index.html`
- Modify: `features/ui/course-workbench.test.js`

- [ ] **Step 1: Add a cache-busting release version assertion for every changed browser script.**

- [ ] **Step 2: Run `node --check app.js` and module syntax checks.**

- [ ] **Step 3: Run every `features/**/*.test.js` test file and `git diff --check`.**

- [ ] **Step 4: Review `git diff --name-only` and confirm only classroom-platform files are staged later.**
