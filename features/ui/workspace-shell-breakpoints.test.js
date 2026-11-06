const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../../style.css'), 'utf8');

test('the laptop map grid reserves a column for the persistent course rail', () => {
  const rule = css.match(/body\.map-view-active \.main-layout\.mode-map\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /grid-template-columns:\s*var\(--course-task-width\)\s+var\(--left-panel-width\)\s+minmax\(0,\s*1fr\)\s+var\(--right-panel-width\)/);
});

test('narrow center workspaces wrap controls instead of overflowing fixed minimum tracks', () => {
  const compact = css.slice(css.indexOf('@container workspace (max-width: 620px)'), css.indexOf('@media (max-width: 820px)', css.indexOf('@container workspace (max-width: 620px)')));
  const bar = compact.match(/\.workspace-context-bar\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(bar, /display:\s*flex/);
  assert.match(bar, /flex-wrap:\s*wrap/);
  assert.match(bar, /height:\s*auto/);
  assert.match(bar, /max-height:\s*none/);
  assert.match(compact, /\.workspace-project-select,\s*\.workspace-space-select\s*\{[^}]*flex:\s*1\s+1\s+100px/);
});
