const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
function fixture() {
  const replies = new Map(), messages = [], statuses = [], calls = { closed: 0 };
  const opener = { closed: false, postMessage: message => messages.push(message), focus() {} };
  const sandbox = { state: { currentBlob: new Blob(['glb']), currentModelInfo: { id: 'photo-run', metrics: {} },
      targetCode: '52', targetSpace: 'S' }, els: { sendBtn: { disabled: false } },
    window: { opener, location: { origin: 'http://localhost' }, close: () => calls.closed++,
      addEventListener: (type, listener) => replies.set(type, listener), removeEventListener: type => replies.delete(type),
      setTimeout, clearTimeout }, crypto: require('node:crypto').webcrypto, console,
    PhotoWorkflow: require('./photo-workflow'), setStatus: message => statuses.push(message) };
  const first = source.indexOf('async function replaceOriginalBuilding(');
  const send = vm.runInNewContext(source.slice(first, source.indexOf('function loadImage(', first)) + ';replaceOriginalBuilding', sandbox);
  return { sandbox, replies, messages, statuses, calls, send };
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
