const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const file = path.join(__dirname, 'homepage-entry-bootstrap.js');
  const events = [];
  const frameWindow = {};
  const elements = new Map();
  function element(id) {
    const classes = new Set();
    const node = { hidden: true, textContent: '', classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value)
    }, querySelector: () => element('label') };
    elements.set(id, node);
    return node;
  }
  ['mainLayout', 'overviewView', 'plan2dView', 'model3dView', 'map2dLoading'].forEach(element);
  elements.set('homeLandingFrame', { contentWindow: frameWindow });
  let handler;
  const window = {
    addEventListener: (_type, listener) => { handler = listener; },
    dispatchEvent: (event) => { events.push(event); handler(event); }
  };
  const document = { getElementById: (id) => elements.get(id), body: element('body') };
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, document });
  return { window, elements, events, click(source = frameWindow, villageId = 'mibu') {
    handler?.({ source, data: { type: 'village-home-enter', payload: { villageId } } });
  } };
}

test('a homepage click reveals loading while the application scripts are still unavailable', () => {
  const env = setup();
  env.click();
  assert.equal(env.elements.get('plan2dView').classList.contains('active'), true);
  assert.equal(env.elements.get('map2dLoading').hidden, false);
  assert.equal(env.window.__homepageEntryBootstrap.hasPending(), true);
});

test('the early click is delivered once after authentication and application initialization', () => {
  const env = setup();
  env.click();
  env.click(undefined, 'red');
  assert.ok(env.window.__homepageEntryBootstrap, 'the early entry receiver must exist');
  env.window.__homepageEntryBootstrap.resume();
  env.window.__homepageEntryBootstrap.resume();
  assert.equal(env.events.length, 1);
  assert.equal(env.events[0].data.payload.villageId, 'red');
});

test('messages from a different window cannot reveal the platform shell', () => {
  const env = setup();
  env.click({});
  assert.equal(env.elements.get('plan2dView').classList.contains('active'), false);
});
