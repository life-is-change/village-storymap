const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('top bar keeps class discussion but moves problem reporting into settings', () => {
  assert.doesNotMatch(html, /id="reportProblemBtn"/);
  assert.match(html, /id="classDiscussionBtn"/);
});

test('home action is the first fixed control in the workspace top bar', () => {
  const contextPanelIndex = html.indexOf('id="courseContextPanel"');
  const topBarIndex = html.indexOf('id="workspaceContextBar"');
  const homeIndex = html.indexOf('id="floatingHomeBtn"');
  const identityIndex = html.indexOf('class="workspace-context-identity"');

  assert.ok(contextPanelIndex >= 0 && topBarIndex > contextPanelIndex);
  assert.ok(homeIndex > topBarIndex, 'home action should be inside the workspace top bar');
  assert.ok(homeIndex < identityIndex, 'home action should precede workspace identity');
  assert.equal(html.match(/id="floatingHomeBtn"/g)?.length, 1);

  const homeRule = css.match(/\.workspace-context-bar \.map-floating-home-btn\s*\{[^}]+\}/)?.[0] || '';
  assert.match(homeRule, /width:\s*36px/);
  assert.match(homeRule, /min-width:\s*36px/);
});

test('space selector owns the flexible grid track without a fixed cap', () => {
  const barRule = css.match(/\.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  const activeRule = css.match(/body\.map-view-active \.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  const selectorRule = css.match(/\.workspace-space-select\s*\{[^}]+\}/)?.[0] || '';

  assert.match(barRule, /grid-template-columns:\s*var\(--workspace-grid-columns\)/);
  assert.match(activeRule, /display:\s*grid/);
  assert.match(selectorRule, /min-width:\s*0/);
  assert.match(selectorRule, /max-width:\s*none/);
  assert.match(selectorRule, /width:\s*100%/);
  assert.doesNotMatch(selectorRule, /flex:/);
  assert.doesNotMatch(css, /workspace-selector-max/);
  assert.doesNotMatch(css, /workspace-discussion-margin-left/);
});

test('top bar defines all four semantic side-panel states', () => {
  const leftOnly = css.match(/\.main-layout\.mode-map\.course-task-expanded:not\(\.mode-map-left-collapsed\)\.mode-map-right-collapsed \.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  const rightOnly = css.match(/\.main-layout\.mode-map\.mode-map-left-collapsed:not\(\.mode-map-right-collapsed\) \.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  const bothOpen = css.match(/\.main-layout\.mode-map\.course-task-expanded:not\(\.mode-map-left-collapsed\):not\(\.mode-map-right-collapsed\) \.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  const bothClosed = css.match(/\.main-layout\.mode-map\.mode-map-left-collapsed\.mode-map-right-collapsed \.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';

  assert.match(leftOnly, /--workspace-identity-display:\s*none/);
  assert.match(leftOnly, /--workspace-grid-columns:\s*auto\s+minmax\(130px,\s*180px\)\s+minmax\(160px,\s*1fr\)\s+auto\s+auto\s+auto\s+auto/);
  assert.match(leftOnly, /--workspace-action-label-display:\s*inline-flex/);

  assert.match(rightOnly, /--workspace-identity-display:\s*flex/);
  assert.match(rightOnly, /--workspace-grid-columns:\s*auto\s+minmax\(92px,\s*110px\)\s+minmax\(130px,\s*180px\)\s+minmax\(160px,\s*1fr\)\s+auto\s+auto\s+auto\s+auto/);
  assert.match(rightOnly, /--workspace-action-label-display:\s*inline-flex/);

  assert.match(bothOpen, /--workspace-identity-display:\s*none/);
  assert.match(bothOpen, /--workspace-grid-columns:\s*auto\s+minmax\(130px,\s*180px\)\s+minmax\(160px,\s*1fr\)\s+auto\s+auto\s+auto\s+auto/);
  assert.match(bothOpen, /--workspace-action-label-display:\s*none/);

  assert.match(bothClosed, /--workspace-identity-display:\s*flex/);
  assert.match(bothClosed, /--workspace-grid-columns:\s*auto\s+minmax\(92px,\s*110px\)\s+minmax\(130px,\s*180px\)\s+minmax\(160px,\s*1fr\)\s+auto\s+auto\s+auto\s+auto/);
  assert.match(bothClosed, /--workspace-action-label-display:\s*inline-flex/);
});

test('top bar adapts to the actual center workspace width', () => {
  const centerRule = css.match(/(?:^|\n)\.center-panel\s*\{[^}]+\}/)?.[0] || '';
  const desktopViewportRule = css.match(/@media \(max-width:\s*1120px\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(centerRule, /container-type:\s*inline-size/);
  assert.match(centerRule, /container-name:\s*workspace/);
  const barRule = css.match(/\.workspace-context-bar\s*\{[^}]+\}/)?.[0] || '';
  assert.match(barRule, /padding:\s*8px\s+14px/);
  assert.match(css, /@container workspace \(max-width:\s*1150px\)[\s\S]*?\.workspace-settings-btn span\s*\{[^}]*display:\s*none/);
  assert.match(css, /@container workspace \(max-width:\s*920px\)[\s\S]*?\.workspace-action-btn span\s*\{[^}]*display:\s*none/);
  assert.match(css, /@container workspace \(max-width:\s*620px\)/);
  assert.match(css, /\.workspace-view-mode-switch \.view-mode-btn\s*\{[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(css, /\.main-layout\.mode-map:not\(\.mode-map-(?:left|right)-collapsed\) \.workspace-settings-btn/);
  assert.doesNotMatch(desktopViewportRule, /workspace-settings-btn span/);
});

test('discussion and settings controls provide icon and text variants', () => {
  assert.match(html, /id="classDiscussionBtn"[\s\S]*?<svg[\s\S]*?<span>班级讨论<\/span>/);
  assert.match(html, /id="projectSettingsBtn"[\s\S]*?<svg[\s\S]*?<span>图层与项目设置<\/span>/);
});
