const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '../../style.css'), 'utf8');

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(escaped + '\\s*\\{[^}]+\\}'))?.[0] || '';
}

test('drawer message cards provide readable hierarchy', () => {
  assert.match(rule('.project-settings-drawer .community-message-card'), /padding:\s*12px/);
  assert.match(rule('.project-settings-drawer .community-message-author'), /font-weight:\s*700/);
  assert.match(rule('.project-settings-drawer .community-message-time'), /font-size:\s*11px/);
  assert.match(rule('.project-settings-drawer .community-message-content'), /font-size:\s*14px/);
  assert.match(rule('.project-settings-drawer .community-message-content'), /line-height:\s*1\.55/);
});

test('drawer message actions and replies use compact styled controls', () => {
  assert.match(rule('.project-settings-drawer .community-message-action-btn'), /min-height:\s*30px/);
  assert.match(rule('.project-settings-drawer .community-message-action-btn'), /border-radius:\s*8px/);
  assert.match(rule('.project-settings-drawer .community-replies'), /background:/);
  assert.match(rule('.project-settings-drawer .community-reply-content'), /font-size:\s*12px/);
});

test('empty reply areas stay hidden until the user opens them', () => {
  assert.match(css, /\.project-settings-drawer \.community-replies\.is-empty:not\(\.is-open\)\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.project-settings-drawer \.community-message-composer\s*\{/);
});
