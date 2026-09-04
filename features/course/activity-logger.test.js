const test = require("node:test");
const assert = require("node:assert/strict");

const { createActivityLogger } = require("./activity-logger.js");

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function sequentialUuid() {
  let value = 0;
  return () => `event-${++value}`;
}

function createLogger(overrides = {}) {
  return createActivityLogger({
    storage: createMemoryStorage(),
    uuid: sequentialUuid(),
    now: () => "2026-07-15T09:00:00.000Z",
    getContext: () => ({
      actor: { studentKey: "2026001::张三", name: "张三" },
      courseId: "mibu-village-planning",
      teachingProjectId: "project-1",
      villageId: "village-1",
      groupId: "group-1",
      taskId: "design-workspace",
      spaceId: "group-space-1",
      viewMode: "2d"
    }),
    ...overrides
  });
}

test("record appends actions instead of overwriting current state", async () => {
  const logger = createLogger();

  await logger.record("view_switched", { type: "workspace", id: "space-1" }, { viewMode: "2d" });
  await logger.record("view_switched", { type: "workspace", id: "space-1" }, { viewMode: "3d" });

  const events = logger.listLocalEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.clientEventId), ["event-1", "event-2"]);
  assert.deepEqual(events.map((event) => event.viewMode), ["2d", "3d"]);
});

test("record attaches actor, course, group, task and target context", async () => {
  const logger = createLogger();

  const event = await logger.record(
    "feature_updated",
    { type: "building", id: "B023" },
    { changedFields: ["建筑高度"] }
  );

  assert.equal(event.studentKey, "2026001::张三");
  assert.equal(event.courseId, "mibu-village-planning");
  assert.equal(event.teachingProjectId, "project-1");
  assert.equal(event.villageId, "village-1");
  assert.equal(event.groupId, "group-1");
  assert.equal(event.taskId, "design-workspace");
  assert.equal(event.targetType, "building");
  assert.equal(event.targetId, "B023");
});

test("flush keeps a failed event pending and de-duplicates a successful retry", async () => {
  let attempts = 0;
  const remote = {
    async insert(event) {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return event.clientEventId;
    }
  };
  const logger = createLogger({ remote });
  await logger.record("task_started", { type: "task", id: "survey-collect" }, {});

  await logger.flush();
  assert.equal(logger.listLocalEvents()[0].syncStatus, "pending");

  await logger.flush();
  const events = logger.listLocalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].syncStatus, "synced");
  assert.equal(attempts, 2);
});

test("local event filters support research queries", async () => {
  const logger = createLogger();
  await logger.record("task_started", { type: "task", id: "design-workspace" }, {});
  await logger.record("view_switched", { type: "workspace", id: "group-space-1" }, {});

  assert.equal(logger.listLocalEvents({ action: "view_switched" }).length, 1);
  assert.equal(logger.listLocalEvents({ groupId: "other-group" }).length, 0);
});
