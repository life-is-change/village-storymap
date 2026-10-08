const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const cssSource = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("expanded course context keeps a compact aligned header", () => {
  const rule = cssSource.match(/\.course-context-panel-header\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(rule, /height:\s*64px/);
  assert.match(rule, /box-sizing:\s*border-box/);
});

test("collapsed right panel resets the late workspace width variable", () => {
  assert.match(
    cssSource,
    /\.main-layout\.mode-map\.mode-map-right-collapsed\s*\{[\s\S]*?--right-panel-width:\s*0px/
  );
});

test("workspace top bar has a fixed compact height", () => {
  const rule = cssSource.match(/\.workspace-context-bar\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.match(rule, /height:\s*64px/);
  assert.match(rule, /box-sizing:\s*border-box/);
});
