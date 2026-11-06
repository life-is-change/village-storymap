const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Glb = require('../../features/models/glb-normalization');
const root = path.join(__dirname, 'curated');

test('curated catalog contains 100 portable, calibrated and credited single assets and 24 editable templates', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
  const singles = catalog.assets.filter(a => a.kind !== 'group');
  const combos = catalog.assets.filter(a => a.kind === 'group');
  assert.equal(singles.length, 100);
  assert.equal(combos.length, 24);
  const byId = new Map(singles.map(a => [a.id, a]));
  for (const a of singles) {
    assert.match(a.label, /[\u4e00-\u9fff]/);
    assert.ok(a.metadata.license && a.metadata.source);
    const bytes = fs.readFileSync(path.resolve(__dirname, '../..', a.url.split('?')[0]));
    const i = Glb.inspectGlb(bytes);
    assert.equal(i.anchor, 'bottom-center', a.id);
    assert.ok(Math.abs(i.bounds.min[1]) < 1e-5, a.id);
    assert.ok(Math.max(...i.bounds.size) < 20, a.id);
    assert.ok(Math.abs(i.bounds.size[0] - a.footprintM[0]) < 1e-4);
    assert.ok(Math.abs(i.bounds.size[2] - a.footprintM[1]) < 1e-4);
    assert.ok(Math.abs(i.bounds.size[1] - a.defaultHeightM) < 1e-4);
    const json = Glb.readGlb(bytes).json;
    assert.ok(!(json.images || []).some(image => image.uri && !image.uri.startsWith('data:')));
  }
  for (const a of combos) {
    assert.ok(a.children.length > 1);
    assert.ok(a.footprintM.every(n => n > 0 && Number.isFinite(n)));
    for (const child of a.children) {
      assert.ok(byId.has(child.assetRef));
      assert.equal(child.offsetM.length, 2);
      assert.ok(child.offsetM.every(Number.isFinite));
    }
  }
  const elder=combos.find(a=>a.id==='seed:curated:combo-elderly-activity-corner');
  assert.equal(elder.children[1].headingDeg,-90,'GLB +Y rotation converts to negative Cesium heading');
});
test('curated static model URLs pass the existing scoped resolver without accepting arbitrary paths',async()=>{
 const {createSceneServices}=require('../../features/data/scene-services');
 const service=createSceneServices({api:{dataClient:{},dispose(){}},contextProvider:()=>({}),instanceId:'test',storage:{}});
 const a=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'))).assets[0];
 assert.equal(await service.resolveAssetUrl(a),a.url);
 await assert.rejects(service.resolveAssetUrl({...a,url:'https://foreign.invalid/x.glb'}));
 service.dispose();
});
