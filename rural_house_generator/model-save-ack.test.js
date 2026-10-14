const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function fixture() {
  const replies = new Map(), messages = [], statuses = [], calls = { closed: 0 };
  const timers = new Map(); let elapsed = 0, nextTimerId = 0;
  const opener = { closed: false, postMessage: message => messages.push(message), focus() {} };
  const sandbox = { state: { currentBlob: new Blob(['glb']), currentModelInfo: { id: 'photo-run', metrics: {} },
      targetCode: '52', targetSpace: 'S' }, els: { sendBtn: { disabled: false } },
    window: { opener, location: { origin: 'http://localhost' }, close: () => calls.closed++,
      addEventListener: (type, listener) => replies.set(type, listener), removeEventListener: type => replies.delete(type),
      setTimeout: (callback, delay) => { const id = ++nextTimerId; timers.set(id, { callback, at: elapsed + delay, delay }); return id; },
      clearTimeout: id => timers.delete(id) }, crypto: require('node:crypto').webcrypto, console,
    PhotoWorkflow: require('./photo-workflow'), setStatus: message => statuses.push(message) };
  const first = source.indexOf('async function replaceOriginalBuilding(');
  const send = vm.runInNewContext(source.slice(first, source.indexOf('function loadImage(', first)) + ';replaceOriginalBuilding', sandbox);
  const advance = milliseconds => {
    elapsed += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= elapsed) { timers.delete(id); timer.callback(); }
  };
  return { sandbox, replies, messages, statuses, calls, send, timers, advance };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('generator remains open until the platform confirms durable model saving', async () => {
  const f = fixture(), pending = f.send(); await tick();
  assert.equal(f.calls.closed, 0);
  const requestId = f.messages[0].payload.requestId;
  assert.ok(requestId);
  f.replies.get('message')({ origin: 'http://localhost', source: f.sandbox.window.opener,
    data: { type: 'village-house-generator:model-saved', payload: { requestId, saved: true } } });
  await pending; assert.equal(f.calls.closed, 1); assert.equal(f.replies.size, 0);
});
test('failed save preserves the generator and its downloadable GLB', async () => {
  const f = fixture(), pending = f.send(); await tick();
  const requestId = f.messages[0].payload.requestId;
  f.replies.get('message')({ origin: 'http://localhost', source: f.sandbox.window.opener,
    data: { type: 'village-house-generator:model-saved', payload: { requestId, saved: false, error: 'database offline' } } });
  await pending; assert.equal(f.calls.closed, 0); assert.ok(f.sandbox.state.currentBlob);
  assert.match(f.statuses.join(' '), /database offline/); assert.equal(f.sandbox.els.sendBtn.disabled, false);
});

test('an acknowledgement after 100 seconds is accepted and another click cannot submit the pending model twice', async () => {
  const f = fixture(), pending = f.send(); await tick();
  await f.send();
  assert.equal(f.messages.length, 1);
  f.advance(100000); await tick();
  assert.equal(f.sandbox.state.modelSavePending, true, 'CPU processing and uploads may still be pending after 100 seconds');
  assert.equal(f.sandbox.els.sendBtn.disabled, true);
  await f.send();
  assert.equal(f.messages.length, 1);
  assert.match(f.statuses.join(' '), /自动准备轻量版本.*保存/);
  f.replies.get('message')({ origin: 'http://localhost', source: f.sandbox.window.opener,
    data: { type: 'village-house-generator:model-saved', payload: { requestId: f.messages[0].payload.requestId, saved: true } } });
  await pending;
  assert.equal(f.calls.closed, 1);
  assert.equal(f.sandbox.state.modelSavePending, false);
  assert.equal(f.timers.size, 0);
});

test('confirmation deadline covers processing and upload margin without claiming a late durable save was lost', async () => {
  const f = fixture(), pending = f.send(); await tick();
  const delay = [...f.timers.values()][0].delay;
  assert.ok(delay >= 300000, 'Confirmation deadline must cover 180s processing plus uploads');
  f.advance(delay); await pending;
  assert.equal(f.calls.closed, 0);
  assert.ok(f.sandbox.state.currentBlob);
  const message = f.statuses.at(-1);
  assert.match(message, /后台.*仍|仍.*处理|仍.*保存/);
  assert.match(message, /核对模型库/);
  assert.doesNotMatch(message, /同步失败|保存失败|丢失/);
  assert.equal(f.replies.size, 0);
});
