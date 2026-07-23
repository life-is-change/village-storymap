const test = require("node:test");
const assert = require("node:assert/strict");
const { findVillagePreview, createVillagePreviewController } = require("./village-preview.js");

test("preview catalog resolves only the requested village", () => {
  const catalog = { villages: [
    { id: "other", preview_path: "other.webp", bounds: [1, 2, 3, 4] },
    { id: "mibu", preview_path: "assets/villages/mibu/preview.webp", bounds: [113, 23, 114, 24] }
  ] };
  assert.equal(findVillagePreview(catalog, "mibu").preview_path, "assets/villages/mibu/preview.webp");
  assert.equal(findVillagePreview(catalog, "missing"), null);
});

test("controller replaces the preview layer and fits its geographic bounds", async () => {
  const calls = [];
  class ImageStatic { constructor(options) { this.options = options; } }
  class ImageLayer {
    constructor(options) { this.options = options; }
    setZIndex(value) { this.zIndex = value; }
  }
  const map = {
    addLayer(layer) { calls.push(["add", layer]); },
    removeLayer(layer) { calls.push(["remove", layer]); },
    getView() { return { fit(bounds, options) { calls.push(["fit", bounds, options]); } }; },
    getSize() { return [800, 600]; }
  };
  const controller = createVillagePreviewController({
    map,
    ol: { ImageLayer, ImageStatic },
    fetchJson: async () => ({ villages: [
      { id: "mibu", preview_path: "assets/villages/mibu/preview.webp", bounds: [113, 23, 114, 24] }
    ] })
  });
  const entry = await controller.show("mibu");
  assert.equal(entry.id, "mibu");
  assert.deepEqual(calls[0][0], "add");
  assert.deepEqual(calls[1][0], "fit");
  assert.equal(calls[0][1].zIndex, 3);
  assert.deepEqual(calls[0][1].options.source.options.imageExtent, [113, 23, 114, 24]);
});

test("missing requested preview fails instead of falling back to another village", async () => {
  const controller = createVillagePreviewController({
    map: { addLayer() {}, getView() { return { fit() {} }; } },
    ol: { ImageLayer: class {}, ImageStatic: class {} },
    fetchJson: async () => ({ villages: [{ id: "other", preview_path: "other.webp", bounds: [1, 2, 3, 4] }] })
  });
  await assert.rejects(() => controller.show("mibu"), /VILLAGE_PREVIEW_NOT_FOUND/);
});
