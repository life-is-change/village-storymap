const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");

test("homepage identity bridge relies on the React homepage instead of injecting a second account UI", () => {
  const renderFunction = appSource.match(
    /function renderHomepageIdentityUi[\s\S]*?(?=\nfunction applyHomepageVisualTweaks)/
  )?.[0] || "";
  const bindFunction = appSource.match(
    /function bindHomepageLandingBridge[\s\S]*?(?=\nfunction shouldShowVillageFillForCurrentSpace)/
  )?.[0] || "";

  assert.match(renderFunction, /broadcastAuthState/);
  assert.doesNotMatch(renderFunction, /createElement|innerHTML|appendChild|applyHomepageVisualTweaks/);
  assert.doesNotMatch(bindFunction, /applyHomepageVisualTweaks/);
});
