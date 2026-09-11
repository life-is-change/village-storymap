const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

function getFunctionBody(name) {
  const asyncStart = appSource.indexOf(`async function ${name}()`);
  const syncStart = appSource.indexOf(`function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `${name} should exist`);
  const next = appSource.indexOf('\nfunction ', start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

test('edit geometry shortcut opens settings without opening the course panel or selecting a tool', () => {
  const body = getFunctionBody('startSelectedSurveyGeometryEdit');
  const focusBody = getFunctionBody('focusGeometryWorkspace');

  assert.match(body, /focusGeometryWorkspace/);
  assert.match(focusBody, /setProjectSettingsOpen\(true\)/);
  assert.match(focusBody, /isSpaceOptionsExpanded\s*=\s*true/);
  assert.match(focusBody, /isToolboxExpanded\s*=\s*true/);
  assert.doesNotMatch(body, /setCourseTaskSidebarExpanded/);
  assert.doesNotMatch(body, /showTask/);
  assert.doesNotMatch(body, /startModifyFeature/);
  assert.doesNotMatch(body, /activateGeometryEditLayer/);
});
