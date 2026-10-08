import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./index.css", import.meta.url), "utf8");

test("homepage removes the teaching-purpose module and navigation entry", () => {
  assert.doesNotMatch(source, /id=["']teaching-purpose["']/);
  assert.doesNotMatch(source, /scrollToSection\(["']teaching-purpose["']\)/);
  assert.doesNotMatch(source, />\s*教学目的\s*</);
});

test("homepage top navigation keeps the three remaining destinations in order", () => {
  const guide = source.indexOf("scrollToSection('platform-guide')");
  const theory = source.indexOf("scrollToSection('theory-learning')");
  const practice = source.indexOf("scrollToSection('practice')");
  assert.ok(guide >= 0 && theory > guide && practice > theory);
});

test("desktop homepage navigation is centered between equal outer tracks", () => {
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
});
