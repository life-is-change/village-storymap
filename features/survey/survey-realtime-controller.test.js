const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createSurveyRealtimeController } = require("./survey-realtime-controller.js");

function fakeRealtimeClient({ onSubscribe } = {}) {
  const filters = [];
  const channel = {
    on(type, filter, callback) {
      filters.push({ type, filter, callback });
      return channel;
    },
    subscribe(callback) {
      onSubscribe?.(callback);
      return channel;
    }
  };
  return {
    filters,
    channel: () => channel,
    removeChannel: async () => {}
  };
}

test("subscribes to reviews and locks with one space filter", async () => {
  const client = fakeRealtimeClient();
  const controller = createSurveyRealtimeController({ client, loadLatest: async () => {} });
  await controller.start({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  assert.deepEqual(client.filters.map((item) => item.filter.table), [
    "survey_feature_reviews", "feature_edit_locks"
  ]);
  assert.ok(client.filters.every((item) => item.filter.filter === "space_id=eq.s1"));
});

test("realtime reloads facts after reconnect before reporting connected", async () => {
  const calls = [];
  let emitStatus;
  const client = fakeRealtimeClient({ onSubscribe: (emit) => { emitStatus = emit; } });
  const controller = createSurveyRealtimeController({
    client,
    loadLatest: async () => calls.push("reload"),
    onConnectionChange: (state) => calls.push(state)
  });
  await controller.start({ teachingProjectId: "p1", villageId: "v1", spaceId: "s1" });
  await emitStatus("SUBSCRIBED");
  assert.deepEqual(calls, ["connecting", "reload", "connected"]);
});

test("formal shared writes are guarded by the workspace connection state", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  assert.match(html, /survey-realtime-controller\.js/);
  assert.match(app, /surveyRealtimeState/);
  assert.match(app, /SHARED_DATA_NOT_SYNCHRONIZED/);
  assert.match(app, /syncSurveyRealtimeSubscription/);
});
