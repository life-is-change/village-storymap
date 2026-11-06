// Run with Node after installing tools/unified-tests dependencies and Chrome.
// This isolated CSS fixture loads no application scripts or external services.
const { chromium } = require('../../tools/unified-tests/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '')
  .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    let checked = 0;
    for (const width of [1920, 1536, 1440, 1366, 1280, 1200, 1100, 1024, 900, 820]) {
      await page.setViewportSize({ width, height: 768 });
      await page.setContent(html);
      await page.addStyleTag({ content: css + '* { transition: none !important; }' });
      for (const model of [false, true]) for (const collapsed of [false, true]) for (const leftCollapsed of [false, true]) for (const managed of [false, true]) {
        const result = await page.evaluate(({ model, collapsed, leftCollapsed, managed }) => {
          document.body.className = 'map-view-active' + (model ? ' model3d-view-active' : '');
          document.querySelector('.main-layout').className = 'main-layout mode-map course-task-expanded' + (collapsed ? ' mode-map-right-collapsed' : '') + (leftCollapsed ? ' mode-map-left-collapsed' : '');
          document.querySelector('#workspaceContextBar').classList.toggle('is-managed-village', managed);
          document.querySelector('#workspaceSpaceActions').hidden = managed;
          document.querySelector('#workspaceViewModeSwitch').innerHTML = '<div class="view-mode-switch"><button class="view-mode-btn">2D 地图</button><button class="view-mode-btn">3D 模型</button></div>';
          document.querySelector('#projectHeaderSelect').innerHTML = '<select><option>米埗村规划项目</option></select>';
          document.querySelector('#spaceHeaderSelect').innerHTML = '<select class="space-select-dropdown"><option>我的规划空间</option></select>';
          const survey = document.querySelector('#surveyReviewPanelRoot');
          survey.hidden = false;
          survey.innerHTML = '<details class="survey-activity-only"><summary>调研进度</summary></details>';
          const bar = document.querySelector('#workspaceContextBar');
          const rect = bar.getBoundingClientRect();
          const panel = document.querySelector('.detail-panel').getBoundingClientRect();
          const outside = [...bar.children].filter((element) => getComputedStyle(element).display !== 'none').filter((element) => {
            const child = element.getBoundingClientRect();
            return child.left < rect.left - 1 || child.right > rect.right + 1 || child.bottom > rect.bottom + 1;
          }).map((element) => element.id || element.className);
          return { panelRight: panel.right, centerWidth: document.querySelector('.center-panel').getBoundingClientRect().width,
            barHeight: rect.height, overflow: bar.scrollWidth > bar.clientWidth + 1, outside };
        }, { model, collapsed, leftCollapsed, managed });
        const label = JSON.stringify({ width, model, collapsed, leftCollapsed, managed, ...result });
        assert.ok(Math.abs(result.panelRight - width) <= 1, label);
        assert.equal(result.overflow, false, label);
        assert.deepEqual(result.outside, [], label);
        if (width > 820) assert.ok(result.centerWidth >= 350, label);
        if (width >= 1024) assert.ok(result.barHeight <= 124, label);
        checked++;
      }
    }
    console.log(`PASS: ${checked} isolated workspace layout cases (820–1920px, 2D/3D, both panel states, managed/personal).`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
