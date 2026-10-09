const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeoprocessingPanel } = require('./geoprocessing-panel');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ listArtifacts, createArtifactUrl } = {}) {
  let update, click, artifactSlot = null, redraws = 0, stopped = 0, listed = 0, signed = 0;
  const runSlot = { set innerHTML(html) {
    redraws++;
    artifactSlot = html.includes('data-artifact-list') ? { innerHTML: '', textContent: '' } : null;
  } };
  const container = {
    innerHTML: '',
    addEventListener(type, handler) { if (type === 'click') click = handler; },
    removeEventListener() {},
    querySelector(selector) {
      return {
        '[data-geoprocessing-form]': { addEventListener() {} },
        '[data-geoprocessing-run-slot]': runSlot,
        '[data-artifact-list]': artifactSlot,
        '.geoprocessing-submit': {},
        '[data-geoprocessing-message]': {}
      }[selector] || null;
    }
  };
  const client = {
    listMine: async () => [{ id: 'r1', status: 'running', progress: 50 }],
    subscribe(_id, handler) { update = handler; return () => stopped++; },
    async listArtifacts(id) {
      listed++;
      return listArtifacts ? listArtifacts(id) : [{ storage_path: 'r1/buildings.json', artifact_type: 'buildings', feature_count: 262 }];
    },
    async createArtifactUrl(path) {
      signed++;
      return createArtifactUrl ? createArtifactUrl(path) : { signedUrl: 'https://test.invalid/signed' };
    }
  };
  const panel = createGeoprocessingPanel({ container, client, villageId: 'v', sourceStatus: { state: 'ready' } });
  panel.mount();
  return {
    panel,
    completed() { update({ id: 'r1', status: 'completed', current_stage: 'completed', progress: 100 }); },
    active() { update({ id: 'r1', status: 'running', progress: 50 }); },
    refresh() { return click({ target: { closest: selector => selector === '[data-refresh-artifacts]' } }); },
    stats: () => ({ redraws, stopped, listed, signed, html: artifactSlot?.innerHTML })
  };
}

test('duplicate completion notifications preserve result DOM and sign only once', async () => {
  const f = fixture(); await tick();
  f.completed(); await tick();
  const first = f.stats();
  f.completed(); await tick();
  assert.equal(f.stats().redraws, first.redraws);
  assert.equal(f.stats().listed, 1);
  assert.equal(f.stats().signed, 1);
  assert.match(f.stats().html, /262 个要素/);
  assert.equal(f.stats().stopped, 1);
});

test('duplicate completion during signing shares work and cannot regress to running', async () => {
  let release; const gate = new Promise(resolve => release = resolve);
  const f = fixture({ createArtifactUrl: async () => { await gate; return { signedUrl: 'https://test.invalid/result' }; } });
  await tick(); f.completed(); await tick(); f.completed(); f.active();
  release(); await tick();
  assert.equal(f.stats().listed, 1);
  assert.equal(f.stats().signed, 1);
  assert.equal(f.panel.getRun().status, 'completed');
  assert.match(f.stats().html, /个人成果/);
});

test('explicit refresh renews links without recreating the result card', async () => {
  const f = fixture(); await tick(); f.completed(); await tick();
  const redraws = f.stats().redraws;
  await f.refresh(); await tick();
  assert.equal(f.stats().signed, 2);
  assert.equal(f.stats().redraws, redraws);
  assert.match(f.stats().html, /个人成果/);
});

test('late artifact work after destroy cannot sign or update a removed panel', async () => {
  let release; const gate = new Promise(resolve => release = resolve);
  const f = fixture({ listArtifacts: async () => { await gate; return [{ storage_path: 'old' }]; } });
  await tick(); f.completed(); await tick(); f.panel.destroy(); release(); await tick();
  assert.equal(f.stats().signed, 0);
});
