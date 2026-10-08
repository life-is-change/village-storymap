const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPlatformEntryController } = require("./platform-entry-controller.js");
const { resolveHomepageCommand } = require("../villages/village-model.js");

test("both homepage entry buttons are wired to the same selected-village request", () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../homepage/src/App.tsx'), 'utf8');
  for (const label of ['进入互动平台', '立即进入平台']) {
    const button = source.match(new RegExp(`<Button\\b([^>]*)>\\s*${label}`));
    assert.ok(button, `${label} button exists`);
    assert.match(button[1], /onClick=\{requestEnterPlatform\}/, `${label} must post its selected village`);
  }
});

test("homepage entry clicks reach React even while the legacy identity bridge is bound", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");
  const start = app.indexOf("function bindHomepageLandingBridge()");
  const end = app.indexOf("\nfunction shouldShowVillageFillForCurrentSpace()", start);
  let capture;
  let legacyClicks = 0;
  const frameDoc = {
    documentElement: { dataset: {} },
    addEventListener(type, handler) { if (type === 'click') capture = handler; }
  };
  const frame = { dataset: {}, contentWindow: {}, contentDocument: frameDoc, addEventListener() {} };
  vm.runInNewContext(`${app.slice(start, end)}\nbindHomepageLandingBridge();`, {
    document: { getElementById: id => id === 'homeLandingFrame' ? frame : null },
    window: { addEventListener() {} },
    renderHomepageIdentityUi() {}, ensureHomepageLogoutButton() {}, setTimeout() {},
    normalizeBridgeButtonLabel: value => value.trim(),
    statusBadge: { click() { legacyClicks += 1; } }
  });
  for (const label of ['进入互动平台', '立即进入平台']) {
    let blocked = false;
    const button = { textContent: label, matches: () => false };
    capture({ target: { closest: () => button },
      preventDefault() { blocked = true; }, stopPropagation() { blocked = true; },
      stopImmediatePropagation() { blocked = true; }
    });
    assert.equal(blocked, false, `${label} must deliver its selected-village message to the early entry queue`);
  }
  assert.equal(legacyClicks, 0);
});

test("homepage village click starts entry immediately but validates its village after readiness", async () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");
  const start = app.indexOf("function bindHomepageLandingBridge()");
  const end = app.indexOf("\nfunction shouldShowVillageFillForCurrentSpace()", start);
  assert.ok(start >= 0 && end > start);

  const frame = {
    dataset: {},
    contentWindow: {},
    contentDocument: null,
    addEventListener() {}
  };
  let messageHandler;
  const requests = [];
  let releaseReady;
  const ready = new Promise((resolve) => { releaseReady = resolve; });
  const sandbox = {
    document: { getElementById: () => frame },
    window: {
      addEventListener: (type, handler) => {
        if (type === "message") messageHandler = handler;
      },
      VillageModelModule: {
        buildProjectEntries: () => [{ villageId: "mibu", teachingProjectId: "project" }],
        resolveHomepageCommand
      }
    },
    projectSwitcher: null,
    villageProjectReadyPromise: ready,
    activeVillageContext: {},
    enterCoursePlatform: (request) => { requests.push(request); return Promise.resolve(null); }
  };
  vm.runInNewContext(`${app.slice(start, end)}\nbindHomepageLandingBridge();`, sandbox);
  assert.equal(typeof messageHandler, "function");

  void messageHandler({
    source: frame.contentWindow,
    data: { type: "village-home-enter", payload: { villageId: "mibu" } }
  });
  assert.equal(requests.length, 1, "the parent should show its loading shell on the same click");
  assert.equal(requests[0].villageId, "mibu");

  const selected = requests[0].resolveEntry();
  sandbox.projectSwitcher = {};
  releaseReady();
  assert.equal((await selected).villageId, "mibu");

  void messageHandler({
    source: frame.contentWindow,
    data: { type: "village-home-enter", payload: { villageId: "outside-project" } }
  });
  await assert.rejects(requests[1].resolveEntry(), /当前村庄暂时无法进入/);
});

test("platform map is not constructed until the selected village context is ready", async () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");
  const start = app.indexOf("function ensurePlatformEntryController()");
  const end = app.indexOf("\nfunction enterCoursePlatform(", start);
  assert.ok(start >= 0 && end > start);

  let releaseEntry;
  const entryReady = new Promise((resolve) => { releaseEntry = resolve; });
  const events = [];
  const sandbox = {
    platformEntryController: null,
    ENABLE_SUPABASE_SYNC: true,
    window: {
      PlatformEntryControllerModule: { createPlatformEntryController },
      CourseModelModule: { DEFAULT_COURSE: { id: "course" } }
    },
    projectSwitcher: {
      async switchTo(entry) { events.push(`village:${entry.villageId}`); }
    },
    villageProjectReadyPromise: Promise.resolve({ teachingProjectId: 'project', villageId: 'red', spaceId: 'space' }),
    activeVillageContext: { teachingProjectId: 'project', villageId: 'red', spaceId: 'space' },
    clearTheoryPracticeContext() {},
    switchMainView() {},
    setPlanMapLoadingState() {},
    ensurePlanMap: async () => { events.push("map"); },
    ensureLayerLoaded: async () => {},
    ensureCourseWorkbenchInitialized: async () => ({ getContext: () => ({ group: null }) }),
    openCoursePlanningWorkspace: async () => {},
    recordCourseActivity: async () => {},
    showVillageOverview() {},
    console
  };
  const controller = vm.runInNewContext(`${app.slice(start, end)}\nensurePlatformEntryController();`, sandbox);
  const pending = controller.enter({
    villageId: "red",
    resolveEntry: () => entryReady
  });
  assert.deepEqual(events, [], "early entry must not create a map with the previous village's extent");

  releaseEntry({ villageId: "red" });
  await pending;
  assert.deepEqual(events.slice(0, 2), ["village:red", "map"]);
});

test("generic homepage entry also waits for project startup and rejects incomplete context", async () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");
  const body = app.slice(app.indexOf("function ensurePlatformEntryController()"), app.indexOf("\nfunction enterCoursePlatform("));
  let release; const ready = new Promise(resolve => { release = resolve; });
  const events = [];
  const sandbox = {
    platformEntryController: null, villageProjectReadyPromise: ready, activeVillageContext: null,
    ENABLE_SUPABASE_SYNC: true,
    window: { PlatformEntryControllerModule: { createPlatformEntryController }, CourseModelModule: { DEFAULT_COURSE: { id: 'course' } } },
    clearTheoryPracticeContext() {}, switchMainView() {}, setPlanMapLoadingState() {},
    ensurePlanMap: async () => events.push('map'),
    ensureCourseWorkbenchInitialized: async () => ({ getContext: () => ({ group: null }) }),
    openCoursePlanningWorkspace: async () => events.push('open'), recordCourseActivity: async () => {}, console
  };
  const controller = vm.runInNewContext(`${body}; ensurePlatformEntryController();`, sandbox);
  const pending = controller.enter();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
  release(null);
  await assert.rejects(pending, /村庄上下文/);
  assert.deepEqual(events, [], 'an empty fallback must never report successful map entry');
  sandbox.ENABLE_SUPABASE_SYNC = false;
  await controller.enter();
  assert.deepEqual(events, ['map', 'open'], 'explicit offline mode retains its local map workflow');
});
