const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const appSource = read("app.js");
const clickSource = read("features/map-editing/map-click-handler.js");
const hoverSource = read("features/map-editing/map-hover-handler.js");
const overlaySource = read("features/map-editing/overlay-renderer.js");

test("message board is rendered in project settings instead of the object panel", () => {
  const refreshFunction = appSource.match(
    /async function refreshCommunityMessageBoard\(\)[\s\S]*?(?=\nasync function|\nfunction refreshCommunityScoreBadge)/
  )?.[0] || "";

  assert.doesNotMatch(refreshFunction, /getElementById\("infoPanel"\)/);
  assert.match(appSource, /data-community-action="report-point"/);
});

test("map objects and problem points remain interactive in the unified workspace", () => {
  assert.doesNotMatch(clickSource, /if \(!isPlanningMode\)/);
  assert.doesNotMatch(hoverSource, /if \(!isPlanningMode\)/);
  assert.match(clickSource, /layerKey"\) === "communityTask"/);
});

test("problem points are loaded alongside ordinary map layers", () => {
  assert.doesNotMatch(overlaySource, /if \(!deps\.getIsPlanningMode\(\)\)/);
  assert.match(overlaySource, /get\?\.\("layerKey"\)[\s\S]*?layerKey === "communityTask"/);
  assert.match(overlaySource, /nextVectorSource\.addFeature\(feature\)/);
  assert.doesNotMatch(overlaySource, /refreshCommunityTasksOnMap/);
});
