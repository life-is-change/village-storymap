const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DEFAULT_COURSE } = require("../course/course-model.js");
const {
  createCourseWorkbench,
  renderDashboard,
  renderTaskNavigation,
  getTaskActionState
} = require("./course-workbench.js");

const student = { name: "张三", student_id: "2026001" };

test("task drawer renders only the active stage guidance without a standalone platform card", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: { id: "g1", name: "第1小组" }, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[1],
    activeTaskId: "survey-collect"
  });

  assert.match(html, /调研采集与现状校核/);
  assert.match(html, /调研照片/);
  assert.doesNotMatch(html, /平台入口|进入原有 2D|进入原有 3D/);
  assert.doesNotMatch(html, /最近操作|个人记录/);
});

test("survey context focuses on outcomes, resources and recommended actions", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: "survey-collect"
  });

  assert.match(html, /阶段成果/);
  assert.match(html, /相关资料/);
  assert.match(html, /建议操作/);
  assert.doesNotMatch(html, /进入原有 2D|进入原有 3D|最近操作/);
});

test("join-group stage shows the join form inside the task drawer", () => {
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: "join-group"
  });

  assert.match(html, /data-group-join-form/);
  assert.match(html, /输入老师提供的组码/);
});

test("student without a group can inspect and complete later tasks without map entry buttons", () => {
  const task = DEFAULT_COURSE.tasks.find((item) => item.id === "diagnosis-list");
  const html = renderDashboard({
    course: DEFAULT_COURSE,
    user: student,
    context: { group: null, progress: { completedTaskIds: [] } },
    nextTask: DEFAULT_COURSE.tasks[0],
    activeTaskId: task.id
  });

  assert.match(html, new RegExp(task.title));
  assert.match(html, new RegExp(task.description));
  assert.match(html, /data-complete-task="diagnosis-list"/);
  assert.doesNotMatch(html, /data-workspace-view/);
  assert.doesNotMatch(html, /加入你的线下小组/);
  assert.doesNotMatch(html, /data-group-join-form/);
});

test("design task exposes 2D and 3D as views of one group workspace", () => {
  const state = getTaskActionState({
    task: DEFAULT_COURSE.tasks.find((task) => task.id === "design-workspace"),
    context: { group: { id: "g1", spaceId: "group-space-g1" } }
  });

  assert.equal(state.type, "workspace");
  assert.deepEqual(state.viewModes, ["2d", "3d"]);
  assert.equal(state.spaceId, "group-space-g1");
});

test("task navigation is an icon rail with accessible stage names", () => {
  const html = renderTaskNavigation({
    course: DEFAULT_COURSE,
    completedTaskIds: ["join-group", "learning-ready"],
    activeTaskId: "survey-collect"
  });

  assert.match(html, /course-task-rail-item is-complete/);
  assert.match(html, /course-task-rail-item is-active/);
  assert.match(html, /aria-label="3\. 图底生产，待完成"/);
  assert.match(html, /aria-label="4\. 调研采集与现状校核，进行中"/);
  assert.match(html, /course-task-rail-icon/);
  assert.doesNotMatch(html, /course-task-nav-copy/);
  assert.equal((html.match(/data-stage-kind="preparation"/g) || []).length, 2);
  assert.equal((html.match(/data-stage-kind="practice"/g) || []).length, 5);
});

test("workbench mounts geoprocessing only for the active figure-ground task", async () => {
  const panelMount = { kind: "geoprocessing-panel" };
  const container = {
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      return selector === "[data-geoprocessing-panel-mount]" ? panelMount : null;
    }
  };
  const mounted = [];
  const workbench = createCourseWorkbench({
    course: DEFAULT_COURSE,
    container,
    service: {
      async loadContext() {
        return { group: null, progress: { completedTaskIds: [] } };
      }
    },
    getUser: () => student,
    mountGeoprocessing: (target) => mounted.push(target)
  });

  await workbench.init();
  assert.equal(mounted.at(-1), null);

  await workbench.showTask("figure-ground-compose");
  assert.equal(mounted.at(-1), panelMount);
});

test("geoprocessing workbench scripts share a cache-busting release version", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const version = "20260723-contour-ui";

  for (const script of [
    "geoprocessing-client.js",
    "geoprocessing-aoi.js",
    "geoprocessing-result-layers.js",
    "geoprocessing-panel.js",
    "course-workbench.js"
  ]) {
    assert.match(html, new RegExp(`${script.replace(".", "\\.")}\\?v=${version}`));
  }
});

test("map application wires completed artifacts into a temporary preview layer", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  assert.match(app, /GeoprocessingResultLayersModule\.createResultLayerPreview/);
  assert.match(app, /onPreview:\s*async\s*\(artifacts\)/);
  assert.match(app, /createArtifactUrl\(artifact\.storage_path\)/);
  assert.match(app, /geoprocessingResultPreview\.syncVisibleLayers\(getSelectedLayersForCurrentSpace\(\)\)/);
  assert.match(app, /onImported:[\s\S]*?geoprocessingResultPreview\.clear\(\)/);
});

test("course entry ensures one personal figure-ground space without mirroring it to legacy planning spaces", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  assert.match(html, /features\/data\/personal-space-client\.js\?v=20260805-backup/);
  assert.match(app, /PersonalSpaceClientModule\.createPersonalSpaceClient/);
  assert.match(app, /personalSpaceClient\.ensure\(/);
  assert.match(app, /s\.spaceType !== "course_personal"/);
});

test("workspace initialization waits for auth and reloads account-scoped state after identity changes", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  assert.match(app, /await window\.VillageAuth\?\.ready/);
  assert.match(app, /buildAccountStorageKey/);
  assert.match(app, /reloadWorkspaceForAuthenticatedAccount/);
  assert.match(app, /personalSpaceClient\.listSelections\(coursePersonalSpace\.id\)/);
});

test("remote space sync treats an empty server result as authoritative and preserves personal workspaces", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  assert.match(app, /if\s*\(!Array\.isArray\(data\)\)\s*return null;[\s\S]*?return data\.map/);
  assert.match(app, /mergeWorkspaceSpaces\(/);
  assert.match(app, /saveSpacesToStorage\(\{\s*syncRemote:\s*false\s*\}\)/);
  assert.match(html, /course-workspace-adapter\.js\?v=20260805-backup/);
  assert.match(html, /app\.js\?v=20260805-backup/);
});

test("personal space reliability scripts share a cache-busting release version", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const version = "20260805-backup";

  for (const script of [
    "space-panel-events.js",
    "course-workspace-adapter.js",
    "personal-space-client.js",
    "personal-layer-versions.js",
    "overlay-renderer.js",
    "app.js"
  ]) {
    assert.match(html, new RegExp(`${script.replace(".", "\\.")}\\?v=${version}`));
  }
});

test("personal spaces render only current imported versions instead of teacher static vectors", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const overlay = fs.readFileSync(path.join(__dirname, "../map-editing/overlay-renderer.js"), "utf8");
  assert.match(app, /async function listCurrentPersonalLayerFeatures/);
  assert.match(overlay, /deps\.isCurrentSpacePersonal\(\)/);
  assert.match(overlay, /deps\.listCurrentPersonalLayerFeatures\(currentSpaceId, layerKey\)/);
  assert.match(overlay, /buildRawFeatureFromPersonalRow/);
  assert.match(app, /space\?\.spaceType === "course_personal"[\s\S]+\["figureGround", "building", "road", "water", "contours"\]/);
});

test("manual edits in a personal space stay in the active personal layer version", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  assert.match(app, /resolveCurrentPersonalVersionId/);
  assert.match(app, /personalSpaceClient\.upsertFeature/);
  assert.match(app, /personalSpaceClient\.softDeleteFeature/);
});

test("personal contours expose delete-only editing and an opt-in value label toggle", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const panel = fs.readFileSync(path.join(__dirname, "space-panel.js"), "utf8");
  const events = fs.readFileSync(path.join(__dirname, "space-panel-events.js"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "../map-editing/geometry-editor.js"), "utf8");
  const style = fs.readFileSync(path.join(__dirname, "map-style.js"), "utf8");
  assert.match(app, /EDITABLE_GEOMETRY_LAYERS\s*=\s*\["building",\s*"road",\s*"water",\s*"contours"\]/);
  assert.match(panel, /data-contour-label-toggle/);
  assert.match(panel, />数值</);
  assert.match(events, /contourLabelsVisible/);
  assert.match(editor, /btnTargetContours/);
  assert.match(editor, /isContourMode/);
  assert.match(style, /getContourLabelsVisible\(\)/);
});

test("object selection renders feedback before optional remote details finish", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");
  assert.match(app, /renderObjectInfoLoadingState\(/);
  assert.match(app, /Promise\.allSettled\(/);
});

test("personal overlay keeps object identity in the right-panel base row", () => {
  const overlay = fs.readFileSync(path.join(__dirname, "..", "map-editing", "overlay-renderer.js"), "utf8");
  assert.match(overlay, /object_code:\s*row\.object_code/);
  assert.match(overlay, /object_name:\s*row\.object_name/);
});

test("personal map refresh invalidates only the active personal layer cache", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const refreshHandler = app.match(/const refreshBtn = document\.getElementById\("btnRefreshCommunityTask"\);([\s\S]*?)\n  const btn3d/)?.[1] || "";
  assert.match(refreshHandler, /spaceType === "course_personal"/);
  assert.match(refreshHandler, /personalSpaceClient\.refreshCurrentLayers\(currentSpace\.id\)/);
  const personalBranch = refreshHandler.match(/spaceType === "course_personal"([\s\S]*?)return;/)?.[1] || "";
  assert.doesNotMatch(personalBranch, /syncSpacesFromSupabase/);
  assert.doesNotMatch(personalBranch, /refreshCommunityTasksOnMap/);
});
