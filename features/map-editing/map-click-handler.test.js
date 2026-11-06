const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
delete require.cache[require.resolve('./map-click-handler.js')];
require('./map-click-handler.js');
const handler = global.window.MapClickHandlerModule;

function createHarness(lockResult = { success: true }) {
  const state = { originalGeoms: new Map(), mode: 'idle' };
  const feature = {
    get(key) { return key === 'layerKey' ? 'building' : key === 'sourceCode' ? 'B1' : null; },
    getGeometry() { return { clone: () => ({ cloned: true }) }; }
  };
  class Interaction { on() {} }
  class Collection { constructor(items) { this.items = items; } }
  const calls = [];
  const deps = {
    normalizeCode: String,
    acquireFeatureEditLock: async () => lockResult,
    showToast: (...args) => calls.push(['toast', ...args]),
    getLayerLabel: () => '建筑',
    getBuildingEditState: () => state,
    setActiveFeature: (value) => calls.push(['active', value]),
    buildDirtyFeatureKey: (layer, code) => `${layer}:${code}`,
    getOlReady: async () => ({ Modify: Interaction, Snap: Interaction, Collection }),
    clearBuildingInteractions: () => calls.push(['clear']),
    getPlanVectorSource: () => ({}),
    getPlanVectorLayer: () => ({ changed() {} }),
    refreshBuildingEdgeLabels() {},
    getPlanMap: () => ({ addInteraction: () => calls.push(['interaction']) }),
    setCurrentInfoMode() {},
    markBuildingDirty() {},
    updateBuildingEditorToolbarState: () => calls.push(['toolbar'])
  };
  return { deps, feature, state, calls };
}

test('direct geometry shortcut locks and activates the already selected feature', async () => {
  const { deps, feature, state, calls } = createHarness();
  assert.equal(await handler.startModifyFeature(deps, feature, 'building'), true);
  assert.equal(state.mode, 'modify');
  assert.equal(state.originalGeoms.has('building:B1'), true);
  assert.ok(calls.some(([name, value]) => name === 'active' && value === feature));
});

test('direct geometry shortcut keeps selection unchanged when lock is occupied', async () => {
  const { deps, feature, state, calls } = createHarness({ success: false, reason: 'locked', editorName: '同学甲' });
  assert.equal(await handler.startModifyFeature(deps, feature, 'building'), false);
  assert.equal(state.mode, 'idle');
  assert.ok(calls.some((call) => call[0] === 'toast' && /同学甲/.test(call[1])));
});

test('a photographed vector stays on the map when deletion is denied',async()=>{
 const {deps,feature,state,calls}=createHarness();
 state.mode='delete';state.pendingDeletedFeatures=[];
 let removed=false;let locked=false;
 deps.acquireFeatureEditLock=async()=>{locked=true;return {success:true};};
 Object.assign(deps,{getCommunityTaskEditState:()=>({}),getCurrentGeometryEditLayer:()=> 'building',
  getPlanVectorSource:()=>({removeFeature(){removed=true;}}),canDeleteFeature:async()=>false});
 global.window.MapHitPolicyModule={pickFeatureAtPixel:()=>feature};
 await handler.handlePlanMapSingleClick(deps,{pixel:[0,0]});
 assert.equal(removed,false);assert.equal(locked,false);assert.equal(state.pendingDeletedFeatures.length,0);
});
