const test = require("node:test");
const assert = require("node:assert/strict");
const FocusMode = require("./focus-mode");

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

test("scene focus hides reality and restores its previous visible state", () => {
  const body = { classList: classList() };
  let realityVisible = true;
  const changes = [];
  const focus = FocusMode.createSceneStudioFocusMode({
    body,
    getRealityVisible: () => realityVisible,
    setRealityVisible(value) { realityVisible = value; changes.push(value); }
  });

  focus.enter();
  focus.enter();
  assert.equal(body.classList.contains("scene-studio-active"), true);
  assert.equal(realityVisible, false);
  focus.exit();

  assert.equal(body.classList.contains("scene-studio-active"), false);
  assert.equal(realityVisible, true);
  assert.deepEqual(changes, [false, false, true]);
});

test("scene focus keeps a previously hidden reality inset hidden on exit", () => {
  const body = { classList: classList() };
  let realityVisible = false;
  const focus = FocusMode.createSceneStudioFocusMode({
    body,
    getRealityVisible: () => realityVisible,
    setRealityVisible(value) { realityVisible = value; }
  });

  focus.enter();
  focus.exit();

  assert.equal(realityVisible, false);
});

test("scene focus hides platform chrome and restores each previous hidden state", () => {
  const body = { classList: classList() };
  const detailPanel = { hidden: false };
  const rightToggle = { hidden: false };
  const workspaceBar = { hidden: true };
  const focus = FocusMode.createSceneStudioFocusMode({
    body,
    chromeElements: [detailPanel, rightToggle, workspaceBar]
  });

  focus.enter();
  assert.equal(detailPanel.hidden, true);
  assert.equal(rightToggle.hidden, true);
  assert.equal(workspaceBar.hidden, true);

  focus.exit();
  assert.equal(detailPanel.hidden, false);
  assert.equal(rightToggle.hidden, false);
  assert.equal(workspaceBar.hidden, true);
});
