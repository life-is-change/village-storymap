const test = require("node:test");
const assert = require("node:assert/strict");
const { pickGroundDegrees } = require("./cesium-ground-picker");

function cesiumFixture() {
  return {
    Cartographic: { fromCartesian: (value) => value.cartographic },
    Math: { toDegrees: (value) => value * 180 / Math.PI }
  };
}

test("ground picker prefers scene depth and returns WGS84 degrees", () => {
  let depthCalls = 0;
  let globeCalls = 0;
  const viewer = {
    scene: {
      pickPositionSupported: true,
      pickPosition() { depthCalls += 1; return { cartographic: { longitude: Math.PI / 2, latitude: Math.PI / 6, height: 12 } }; },
      globe: { pick() { globeCalls += 1; return null; } }
    },
    camera: { getPickRay() { return {}; } }
  };
  assert.deepEqual(pickGroundDegrees({ Cesium: cesiumFixture(), viewer, screenPosition: { x: 10, y: 20 } }), [90, 29.999999999999996, 12]);
  assert.equal(depthCalls, 1);
  assert.equal(globeCalls, 0);
});

test("ground picker falls back to globe ray and returns null when neither hits", () => {
  const Cesium = cesiumFixture();
  let globeHit = { cartographic: { longitude: 0, latitude: 0, height: undefined } };
  const viewer = {
    scene: { pickPositionSupported: true, pickPosition: () => null, globe: { pick: () => globeHit } },
    camera: { getPickRay: () => ({ ray: true }) }
  };
  assert.deepEqual(pickGroundDegrees({ Cesium, viewer, screenPosition: {} }), [0, 0, 0]);
  globeHit = null;
  assert.equal(pickGroundDegrees({ Cesium, viewer, screenPosition: {} }), null);
});

test("preview ground picking skips the expensive depth buffer and uses the terrain ray", () => {
  let depthCalls = 0;
  let globeCalls = 0;
  const viewer = {
    scene: {
      pickPositionSupported: true,
      pickPosition() { depthCalls += 1; return { cartographic: { longitude: 1, latitude: 1, height: 99 } }; },
      globe: { pick() { globeCalls += 1; return { cartographic: { longitude: 0, latitude: 0, height: 0 } }; } }
    },
    camera: { getPickRay: () => ({ ray: true }) }
  };
  assert.deepEqual(pickGroundDegrees({ Cesium: cesiumFixture(), viewer, screenPosition: {}, skipDepth: true }), [0, 0, 0]);
  assert.equal(depthCalls, 0);
  assert.equal(globeCalls, 1);
});
