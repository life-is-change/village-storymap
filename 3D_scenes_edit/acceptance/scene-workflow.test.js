const test = require("node:test");
const assert = require("node:assert/strict");
const Studio = require("../index");
const SceneDocument = require("../domain/scene-document");

const boundary = { type: "Polygon", coordinates: [[[114, 30], [114.002, 30], [114.002, 30.002], [114, 30.002], [114, 30]]] };
const context = { userId: "u", teachingProjectId: "tp", courseId: "c", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 2, baselineFeatures: [{ layerKey: "building", geometry: { type: "Polygon", coordinates: [[[114.01, 30.01], [114.011, 30.01], [114.01, 30.01]]] } }] };

function root() { return { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, focus() {} }; }
function backend() {
  const documents = new Map();
  const versions = [];
  let sequence = 0;
  return {
    documents, versions,
    async findActiveProject() { const latest = [...documents.keys()].at(-1); return { ok: true, data: latest ? { id: latest } : null }; },
    async createProject(input) { const id = `p${++sequence}`; documents.set(id, SceneDocument.create({ projectId: id, villageId: input.villageId, groupId: input.groupId, spaceId: input.spaceId, baselineRevision: input.baselineRevision, selectionBoundary: input.selectionBoundary })); return { ok: true, data: { id, revision: 0 } }; },
    async loadProject(id) { return { ok: true, data: structuredClone(documents.get(id)) }; },
    async saveDraft(document) { if (this.nextSaveResult) { const result = this.nextSaveResult; this.nextSaveResult = null; return result; } const saved = structuredClone(document); saved.revision += 1; saved.updatedAt = new Date(Date.parse(saved.updatedAt) + 1000).toISOString(); documents.set(saved.projectId, saved); return { ok: true, data: { revision: saved.revision, updatedAt: saved.updatedAt } }; },
    async listAssets() { return { ok: true, data: [] }; },
    async listVersions(projectId) { return { ok: true, data: versions.filter((item) => item.project_id === projectId).map((item) => structuredClone(item)) }; },
    async createVersion(input) { const version = { id: `v${versions.length + 1}`, project_id: input.document.projectId, revision: input.document.revision, label: input.label, description: input.description, preview_path: input.previewPath, submission_status: "milestone", document: structuredClone(input.document) }; versions.push(version); return { ok: true, data: version }; },
    async restoreVersionAsDraft(input) { const source = versions.find((item) => item.id === input.versionId); const id = `p${++sequence}`; const copy = structuredClone(source.document); copy.projectId = id; copy.revision = 1; documents.set(id, copy); return { ok: true, data: { id, revision: 1 } }; },
    async submitVersion(id) { const version = versions.find((item) => item.id === id); version.submission_status = "submitted"; return { ok: true, data: { id, submissionStatus: "submitted" } }; },
    async branchFromBaseline(input) { const id = `p${++sequence}`; documents.set(id, SceneDocument.create({ projectId: id, villageId: "v", groupId: "g", spaceId: "s", baselineRevision: input.baselineRevision })); return { ok: true, data: { id, revision: 0 } }; }
  };
}

function services(client, localRecord = null) {
  return { client, localStore: { read: () => localRecord, write() {}, remove() {} }, adapter: { mount() {}, render() {}, dispose() {} }, interactions: { activate() {}, dispose() {} } };
}

test("student scene workflow preserves baseline through editing, milestones, compare, restore and submit", async () => {
  const client = backend();
  let id = 0;
  const studio = await Studio.create({ root: root(), context, services: services(client), idFactory: () => `o${++id}`, onMilestone: ({ document }) => client.createVersion({ document, label: versionsLabel(), description: "阶段说明", previewPath: "group/g/preview.png" }) });
  assert.equal(studio.ok, true);
  assert.equal(studio.setSelectionBoundary(boundary).ok, true);
  const inputs = [
    ["asset", "bench", { type: "Point", coordinates: [114.0004, 30.0004] }],
    ["asset", "tree", { type: "Point", coordinates: [114.0008, 30.0008] }],
    ["line", "path", { type: "LineString", coordinates: [[114.0002, 30.0002], [114.0015, 30.0015]] }],
    ["surface", "paving", { type: "Polygon", coordinates: [[[114.0003, 30.0003], [114.001, 30.0003], [114.001, 30.001], [114.0003, 30.0003]]] }]
  ];
  for (const [kind, category, geometry] of inputs) assert.equal(studio.createObject({ kind, category, geometry, properties: kind === "asset" ? { footprintM: [1, 1] } : {} }).ok, true);
  studio.select(["o1"]);
  studio.updateSelection({ geometry: { type: "Point", coordinates: [114.0005, 30.0005] } });
  await studio.dispatch({ type: "property", path: "transform.headingDeg", value: 35 });
  const geometryBefore3D = structuredClone(studio.getDocument().objects[0].geometry);
  await studio.dispatch({ type: "property", path: "transform.heightOffsetM", value: 2 });
  assert.deepEqual(studio.getDocument().objects[0].geometry, geometryBefore3D);
  await studio.flush();
  await studio.dispatch({ type: "milestone" });
  studio.updateSelection({ transform: { headingDeg: 50 } });
  await studio.flush();
  await studio.dispatch({ type: "milestone" });
  assert.equal(client.versions.length, 2);
  await studio.dispatch({ type: "compare-version", value: "v1" });
  await studio.dispatch({ type: "compare-version", value: "v2" });
  assert.deepEqual(studio.getState().comparisonIds, ["v1", "v2"]);
  const restored = await studio.dispatch({ type: "restore-version", value: "v1" });
  assert.notEqual(restored.data.id, studio.getDocument().projectId);
  await studio.dispatch({ type: "submit-version", value: "v2" });
  assert.equal(client.versions[1].submission_status, "submitted");
  assert.deepEqual(context.baselineFeatures[0].geometry, { type: "Polygon", coordinates: [[[114.01, 30.01], [114.011, 30.01], [114.01, 30.01]]] });
  studio.dispose();

  function versionsLabel() { return `阶段${client.versions.length + 1}`; }
});

test("same-revision offline draft wins by timestamp and conflict copy never overwrites remote", async () => {
  const server = SceneDocument.create({ projectId: "p1", villageId: "v", groupId: "g", spaceId: "s", baselineRevision: 2, revision: 3, now: "2026-09-14T01:00:00Z" });
  const local = structuredClone(server); local.metadata.local = true;
  assert.equal(Studio.chooseInitialDocument(server, { revision: 3, savedAt: "2026-09-14T02:00:00Z", document: local }).metadata.local, true);
});

test("a baseline upgrade requires a branch instead of mutating the old project", () => {
  assert.equal(Studio.needsBaselineBranch({ baselineRef: { revision: 2 } }, { baselineRevision: 3 }), true);
  assert.equal(Studio.needsBaselineBranch({ baselineRef: { revision: 3 } }, { baselineRevision: 3 }), false);
});

test("revision conflict preserves the local document and saving a copy leaves the remote untouched", async () => {
  const client = backend();
  const studio = await Studio.create({ root: root(), context, services: services(client), idFactory: () => "local-object" });
  studio.setSelectionBoundary(boundary);
  studio.createObject({ kind: "asset", category: "bench", geometry: { type: "Point", coordinates: [114.001, 30.001] }, properties: { footprintM: [1, 1] } });
  const oldProjectId = studio.getDocument().projectId;
  const remoteBefore = structuredClone(client.documents.get(oldProjectId));
  client.nextSaveResult = { ok: false, code: "REVISION_CONFLICT", remoteRevision: 8 };
  await studio.flush();
  assert.equal(studio.getState().save.status, "conflict");
  const result = await studio.dispatch({ type: "conflict-copy" });
  assert.equal(result.ok, true);
  assert.notEqual(studio.getDocument().projectId, oldProjectId);
  assert.deepEqual(client.documents.get(oldProjectId), remoteBefore);
  assert.equal(studio.getDocument().objects.length, 1);
  studio.dispose();
});

test("offline failure keeps a recoverable local draft", async () => {
  const client = backend();
  const records = [];
  const localStore = { read: () => null, write(_identity, record) { records.push(structuredClone(record)); }, remove() {} };
  const studio = await Studio.create({ root: root(), context, services: { ...services(client), localStore }, idFactory: () => "offline-object" });
  studio.setSelectionBoundary(boundary);
  studio.createObject({ kind: "asset", category: "tree", geometry: { type: "Point", coordinates: [114.001, 30.001] }, properties: { footprintM: [1, 1] } });
  client.nextSaveResult = { ok: false, code: "NETWORK_ERROR" };
  await studio.flush();
  assert.equal(studio.getState().save.status, "offline");
  assert.equal(records.at(-1).document.objects[0].id, "offline-object");
  studio.dispose();
});

test("3D placement and dragging synchronize into the 2D document without mutating baseline", async () => {
  let handler = null;
  let ground = [114.0004, 30.0004, 0];
  let pickedEntity = null;
  class ScreenSpaceEventHandler {
    constructor() { this.actions = {}; handler = this; }
    setInputAction(action, type) { this.actions[type] = action; }
    removeInputAction(type) { delete this.actions[type]; }
    destroy() {}
  }
  const entities = [];
  const Cesium = {
    ScreenSpaceEventHandler,
    ScreenSpaceEventType: { LEFT_CLICK: "left", RIGHT_CLICK: "right", LEFT_DOUBLE_CLICK: "double", MOUSE_MOVE: "move", LEFT_DOWN: "down", LEFT_UP: "up" },
    Cartographic: { fromCartesian: (value) => ({ longitude: value[0], latitude: value[1], height: value[2] }) },
    Math: { toDegrees: (value) => value },
    Cartesian3: { fromDegrees: (...value) => value, fromDegreesArray: (value) => value },
    HeadingPitchRoll: class HeadingPitchRoll { constructor(heading, pitch, roll) { Object.assign(this, { heading, pitch, roll }); } },
    Transforms: { headingPitchRollQuaternion: () => ({}) },
    Color: { WHITE: { withAlpha: () => ({}) }, GRAY: { withAlpha: () => ({}) }, YELLOW: { withAlpha: () => ({}) } },
    HeightReference: { RELATIVE_TO_GROUND: "ground" }
  };
  const viewer = {
    canvas: {},
    entities: { add(value) { entities.push(value); return value; }, remove(value) { const i = entities.indexOf(value); if (i >= 0) entities.splice(i, 1); } },
    scene: {
      pickPositionSupported: true, pickPosition: () => ground, pick: () => pickedEntity,
      globe: { pick: () => null }, screenSpaceCameraController: { enableInputs: true }
    },
    camera: { getPickRay: () => ({}), flyTo() {} }
  };
  const rendered2D = [];
  const frozenBaseline = structuredClone(context.baselineFeatures);
  const client = backend();
  let id = 0;
  const studio = await Studio.create({
    root: root(),
    context: { ...context, selectionBoundary: boundary, seedAssets: [{ id: "seed:bench:wood", kind: "asset", category: "bench", label: "木座椅", footprintM: [1.8, .65], defaultHeightM: .85 }] },
    services: { client, localStore: { read: () => null, write() {}, remove() {} }, adapter: { mount() {}, render(document) { rendered2D.push(structuredClone(document)); }, dispose() {} } },
    ensure3D: async () => ({ Cesium, viewer }),
    idFactory: () => `o${++id}`
  });
  assert.equal(studio.getState().mode, "3d");
  await studio.dispatch({ type: "choose-asset", value: "seed:bench:wood" });
  handler.actions.move({ endPosition: {} });
  handler.actions.left({ position: {} });
  assert.deepEqual(studio.getDocument().objects[0].geometry.coordinates, [114.0004, 30.0004]);

  await studio.dispatch({ type: "tool", value: "move" });
  pickedEntity = { id: entities.find((entity) => entity.id === "scene-edit:o1") };
  handler.actions.down({ position: {} });
  ground = [114.0008, 30.0009, 0];
  handler.actions.move({ endPosition: {} });
  handler.actions.up({ position: {} });
  await studio.switchMode("2d");
  assert.deepEqual(studio.getDocument().objects[0].geometry.coordinates, [114.0008, 30.0009]);
  assert.deepEqual(rendered2D.at(-1).objects, studio.getDocument().objects);
  assert.deepEqual(context.baselineFeatures, frozenBaseline);
  studio.dispose();
});
