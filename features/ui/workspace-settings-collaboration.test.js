const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const panel = fs.readFileSync(path.join(root, 'features/ui/space-panel.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('space tools are presented before problems and discussion', () => {
  assert.ok(panel.indexOf('>空间工具<') < panel.indexOf('>问题与留言<'));
});

test('settings keeps problem marking above an inline class discussion composer', () => {
  assert.match(app, /data-community-action="report-point"/);
  assert.doesNotMatch(app, /data-community-action="discussion"/);
  assert.match(panel, /id="communityMessageComposer"/);
  assert.match(panel, /id="communityMessageInput"/);
  assert.match(panel, /id="communityMessageSubmitBtn"/);
  assert.match(app, /communityMessageSubmitBtn[\s\S]*submitCommunityMessage\(\{\s*category:\s*null/);
  assert.match(app, /report-point[\s\S]*startCommunityTaskReport\(\{\s*requireLocation:\s*true\s*\}\)/);
});

test('top class discussion entry focuses the inline composer', () => {
  assert.match(app, /classDiscussionBtn[\s\S]*focusCommunityMessageComposer/);
});

test('project settings drawer uses a compact desktop width', () => {
  const rule = css.match(/\.project-settings-drawer\s*\{[^}]+\}/)?.[0] || '';
  assert.match(rule, /width:\s*min\(320px/);
});
