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

test('local survey subscribes to authorized events without opening a source channel',async()=>{
 const calls=[];const controller=createSurveyRealtimeController({services:{events:{createClient(options){return {async start(c){calls.push(c);options.onInvalidate();},async stop(){}};}}},client:{channel(){throw Error('SOURCE_CHANNEL_FORBIDDEN');}},loadLatest:()=>calls.push('refreshed')});
 await controller.start({spaceId:'A'});assert.deepEqual(calls,[{spaceId:'A'},'refreshed']);
});

test('local reconnect waits for the latest facts before reporting ready',async()=>{
 let options,finish;const refreshed=new Promise(r=>finish=r);
 const controller=createSurveyRealtimeController({services:{events:{createClient(o){options=o;return {start(){},stop(){}};}}},loadLatest:()=>refreshed});
 const pending=options.onInvalidate({kind:'refresh'});let done=false;Promise.resolve(pending).then(()=>done=true);
 await new Promise(r=>setImmediate(r));assert.equal(done,false);
 finish();await pending;await controller.stop();
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

test('source reconnect refresh failure blocks shared writes without an unhandled rejection',async()=>{
 let emitStatus,fail=false;const states=[];
 const client=fakeRealtimeClient({onSubscribe:emit=>emitStatus=emit});
 const controller=createSurveyRealtimeController({client,onConnectionChange:s=>states.push(s),loadLatest:async()=>{if(fail)throw Error('SHARED_REFRESH_FAILED');}});
 await controller.start({spaceId:'A'});await emitStatus('SUBSCRIBED');assert.equal(states.at(-1),'connected');
 fail=true;await assert.doesNotReject(emitStatus('SUBSCRIBED'));assert.equal(states.at(-1),'disconnected');await controller.stop();
});

test('a completed source refresh cannot mark a stopped subscription connected',async()=>{
 let emitStatus,finish;const states=[],pending=new Promise(r=>finish=r);
 const client=fakeRealtimeClient({onSubscribe:emit=>emitStatus=emit});
 const controller=createSurveyRealtimeController({client,onConnectionChange:s=>states.push(s),loadLatest:()=>pending});
 await controller.start({spaceId:'A'});const refreshing=emitStatus('SUBSCRIBED');await controller.stop();finish();await refreshing;
 assert.ok(!states.includes('connected'));
});

test('overlapping source stops detach the old channel only once',async()=>{
 let release,removals=0;const pending=new Promise(r=>release=r),client=fakeRealtimeClient();
 client.removeChannel=async()=>{removals++;await pending;};
 const controller=createSurveyRealtimeController({client});await controller.start({spaceId:'A'});
 const stopped=controller.stop(),started=controller.start({spaceId:'B'});await new Promise(r=>setImmediate(r));
 const actual=removals;release();await Promise.all([stopped,started]);await controller.stop();assert.equal(actual,1);
});

test('source change-event refresh failure clears ready and handles its rejection',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let emitStatus,fail=false;const states=[];
 const client=fakeRealtimeClient({onSubscribe:emit=>emitStatus=emit});
 const controller=createSurveyRealtimeController({client,debounceMs:10,onConnectionChange:s=>states.push(s),loadLatest:async()=>{if(fail)throw Error('SHARED_REFRESH_FAILED');}});
 await controller.start({spaceId:'A'});await emitStatus('SUBSCRIBED');fail=true;
 client.filters[0].callback({new:{}});t.mock.timers.tick(10);await new Promise(r=>setImmediate(r));
 assert.equal(states.at(-1),'disconnected');await controller.stop();
});

test("formal shared writes are guarded by the workspace connection state", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  assert.match(html, /survey-realtime-controller\.js/);
  assert.match(app, /surveyRealtimeState/);
  assert.match(app, /SHARED_DATA_NOT_SYNCHRONIZED/);
  assert.match(app, /syncSurveyRealtimeSubscription/);
});
