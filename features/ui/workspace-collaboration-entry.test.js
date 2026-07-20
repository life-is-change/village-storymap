const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('top workspace bar keeps class discussion while problem reporting lives in settings', () => {
  assert.doesNotMatch(html, /id="reportProblemBtn"/);
  assert.match(html, /id="classDiscussionBtn"/);
  assert.match(app, /data-community-action="report-point"/);
  assert.doesNotMatch(app, /data-community-action="discussion"/);
  assert.match(app, /focusCommunityMessageComposer/);
});

test('problem entry requires a map location while ordinary discussion remains available', () => {
  assert.match(app, /function startCommunityTaskReport\([^)]*requireLocation/);
  assert.match(app, /showCommunityTaskReportDialog\(\{[\s\S]*requireLocation/);
  assert.match(app, /data-community-action="report-point"[\s\S]*startCommunityTaskReport\(\{\s*requireLocation:\s*true\s*\}\)/);
});

test('class discussion entry opens the existing discussion area', () => {
  assert.match(app, /classDiscussionBtn[\s\S]*isCommunityExpanded\s*=\s*true/);
  assert.match(app, /classDiscussionBtn[\s\S]*setProjectSettingsOpen\(true\)/);
  assert.match(app, /classDiscussionBtn[\s\S]*communityMessageBoard/);
});
