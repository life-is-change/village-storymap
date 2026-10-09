const test = require("node:test");
const assert = require("node:assert/strict");

const Thumbnail = require("./model-top-view-thumbnail");

test("generates a PNG top view from a local GLB and revokes its temporary URL", async () => {
  const calls = [];
  const png = { type: "image/png", size: 88 };
  const service = Thumbnail.createModelTopViewThumbnailer({
    urlApi: {
      createObjectURL(file) { calls.push(["create", file]); return "blob:student-model"; },
      revokeObjectURL(url) { calls.push(["revoke", url]); }
    },
    rendererFactory: async () => ({
      async render(url) { calls.push(["render", url]); return png; },
      dispose() { calls.push(["dispose"]); }
    })
  });
  const file = { name: "student.glb" };
  const result = await service.generate(file);
  assert.deepEqual(result, { ok: true, blob: png });
  assert.deepEqual(calls.map(([kind]) => kind), ["create", "render", "revoke"]);
  await service.dispose();
  assert.equal(calls.at(-1)[0], "dispose");
});

test("thumbnail generation fails softly so uploading the GLB can continue", async () => {
  const service = Thumbnail.createModelTopViewThumbnailer({
    urlApi: { createObjectURL: () => "blob:bad", revokeObjectURL() {} },
    rendererFactory: async () => ({ async render() { throw new Error("WebGL unavailable"); }, dispose() {} })
  });
  const result = await service.generate({ name: "student.glb" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TOP_VIEW_GENERATION_FAILED");
  assert.match(result.message, /WebGL unavailable/);
});

test("Cesium renderer waits for Model.readyEvent before reading its bounding sphere", async () => {
  let ready = false;
  let listeners = [];
  let readyListeners = [];
  const scene = {
    primitives: { removeAll() {}, add(value) { return value; } },
    postRender: {
      addEventListener(callback) {
        listeners.push(callback);
        return () => { listeners = listeners.filter((item) => item !== callback); };
      }
    },
    requestRender() {
      queueMicrotask(() => {
        [...listeners].forEach((callback) => callback());
        if (!ready) {
          ready = true;
          [...readyListeners].forEach((callback) => callback());
        }
      });
    },
    canvas: { toBlob(callback) { callback({ type: "image/png", size: 1 }); } },
    globe: {}, skyBox: {}, skyAtmosphere: {}, sun: {}, moon: {}, fog: {}
  };
  const model = {
    get ready() { return ready; },
    readyEvent: {
      addEventListener(callback) {
        readyListeners.push(callback);
        return () => { readyListeners = readyListeners.filter((item) => item !== callback); };
      }
    },
    errorEvent: { addEventListener() { return () => {}; } }
  };
  Object.defineProperty(model, "boundingSphere", {
    get() {
      if (!ready) throw new Error("boundingSphere is unavailable before readyEvent");
      return { radius: 2 };
    }
  });
  const container = { style: {}, appendChild() {}, remove() {}, innerHTML: "" };
  const documentRef = { body: { appendChild() {} }, createElement: () => container };
  const Cesium = {
    Viewer: class {
      constructor() { this.scene = scene; this.camera = { viewBoundingSphere(sphere) { assert.equal(sphere.radius, 2); } }; }
      destroy() {}
    },
    Model: { async fromGltfAsync() { return model; } },
    EllipsoidTerrainProvider: class {},
    Color: { TRANSPARENT: {} },
    Cartesian3: { fromDegrees() { return {}; } },
    Transforms: { eastNorthUpToFixedFrame() { return {}; } },
    HeadingPitchRange: class {},
    Math: { PI_OVER_TWO: Math.PI / 2 }
  };
  const renderer = await Thumbnail.createCesiumRenderer({ Cesium, document: documentRef, size: 64 });
  const blob = await renderer.render("bench.glb");
  assert.equal(blob.type, "image/png");
});
