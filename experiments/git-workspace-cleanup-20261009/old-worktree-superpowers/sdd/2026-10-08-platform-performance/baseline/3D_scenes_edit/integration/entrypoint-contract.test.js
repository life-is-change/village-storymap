const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");

test("keeps the scene studio out of the fixed top bar and declares one isolated mount", () => {
  assert.equal((html.match(/id="openSceneStudioBtn"/g) || []).length, 0);
  assert.equal((html.match(/id="sceneStudioMount"/g) || []).length, 1);
  assert.match(html, /3D_scenes_edit\/style\.css/);
});

test("closing the scene studio restores an actual 2D platform viewport", () => {
  const closeBody = appSource.match(/function closeSceneStudioWorkspace\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(closeBody, /switchMainView\("plan2d"\)/);
  assert.match(closeBody, /planMap\?\.setTarget\?\.\(map2dEl\)/);
  assert.match(closeBody, /planMap\?\.updateSize\?\.\(\)/);
});

test("loads scene studio dependencies before app.js and never loads archived builders", () => {
  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1].split("?")[0]);
  const expected = [
    "3D_scenes_edit/domain/scene-document.js", "3D_scenes_edit/domain/scene-commands.js", "3D_scenes_edit/domain/geometry-rules.js",
    "3D_scenes_edit/persistence/scene-edit-client.js", "3D_scenes_edit/persistence/local-draft-store.js", "3D_scenes_edit/persistence/autosave-controller.js",
    "3D_scenes_edit/assets/scene-asset-library.js", "3D_scenes_edit/map_2d/scene-layer-adapter.js", "3D_scenes_edit/map_2d/scene-editor-controller.js",
    "3D_scenes_edit/map_2d/openlayers-interactions.js", "3D_scenes_edit/ui/scene-studio-toolbar.js", "3D_scenes_edit/ui/scene-studio-panel.js", "3D_scenes_edit/preview_3d/scene-to-cesium.js",
    "3D_scenes_edit/preview_3d/scene-preview-adapter.js", "3D_scenes_edit/preview_3d/scene-transform-bridge.js",
    "3D_scenes_edit/interaction_3d/cesium-ground-picker.js", "3D_scenes_edit/interaction_3d/cesium-scene-interactions.js", "3D_scenes_edit/integration/focus-mode.js",
    "3D_scenes_edit/integration/platform-bridge.js", "3D_scenes_edit/index.js", "app.js"
  ];
  let cursor = -1;
  for (const src of expected) {
    const next = scriptSources.indexOf(src);
    assert.ok(next > cursor, `${src} must appear once in dependency order`);
    assert.equal(scriptSources.lastIndexOf(src), next, `${src} must not be duplicated`);
    cursor = next;
  }
  assert.equal(/3D_scenes_edit\/legacy\/|building-assembler/.test(html), false);
});
