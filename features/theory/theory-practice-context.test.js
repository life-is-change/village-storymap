const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveTheoryPracticeMessage,
  executeTheoryPracticeContext
} = require("./theory-practice-context.js");

test("large-scale design opens the terrain-and-water 2D context", () => {
  const context = resolveTheoryPracticeMessage({
    type: "village-theory-practice",
    payload: {
      lessonId: "lesson05",
      stepId: "large_scale",
      mapTask: "large_scale_design",
      lessonTitle: "第五讲：乡村设计",
      taskTitle: "从山水格局和地形环境看村庄"
    }
  });

  assert.deepEqual(context, {
    lessonId: "lesson05",
    stepId: "large_scale",
    mapTask: "large_scale_design",
    lessonTitle: "第五讲：乡村设计",
    taskTitle: "从山水格局和地形环境看村庄",
    stageLabel: "第五讲 · 千尺审势",
    view: "plan2d",
    space: "current",
    layers: ["water", "contours"],
    basemapVisible: true,
    tool: "project_settings",
    instruction: "结合水系、等高线和遥感底图判断村庄山水格局、选址安全与生态联系。"
  });
});

test("small-scale design opens the building-focused 3D context", () => {
  const context = resolveTheoryPracticeMessage({
    type: "village-theory-practice",
    payload: {
      lessonId: "lesson05",
      stepId: "small_scale",
      mapTask: "small_scale_design",
      lessonTitle: "第五讲：乡村设计",
      taskTitle: "从农房和日常生活细节提升品质"
    }
  });

  assert.equal(context.view, "model3d");
  assert.equal(context.space, "group");
  assert.deepEqual(context.layers, ["building"]);
  assert.equal(context.tool, "object_info");
});

test("unknown or malformed theory tasks are rejected", () => {
  assert.equal(resolveTheoryPracticeMessage({ type: "village-theory-practice", payload: { mapTask: "unknown" } }), null);
  assert.equal(resolveTheoryPracticeMessage({ type: "different-message", payload: { mapTask: "large_scale_design" } }), null);
  assert.equal(resolveTheoryPracticeMessage(null), null);
});

test("practice execution enters the workspace before applying layers and opening the tool", async () => {
  const calls = [];
  const context = resolveTheoryPracticeMessage({
    type: "village-theory-practice",
    payload: { mapTask: "planning_relationship", lessonId: "lesson03", stepId: "relationship_analysis" }
  });

  const executed = await executeTheoryPracticeContext(context, {
    openWorkspace: async (view, space) => calls.push(["workspace", view, space]),
    applyWorkspace: async (settings) => calls.push(["settings", settings]),
    openTool: async (tool) => calls.push(["tool", tool]),
    setContext: (value) => calls.push(["context", value.mapTask]),
    notify: (message) => calls.push(["notify", message])
  });

  assert.equal(executed, true);
  assert.deepEqual(calls.map((call) => call[0]), ["workspace", "settings", "tool", "context", "notify"]);
  assert.deepEqual(calls[1][1], { layers: ["building", "road", "water"], basemapVisible: true });
  assert.equal(calls[2][1], "problem_marker");
});

test("practice execution ignores an empty context", async () => {
  let opened = false;
  const executed = await executeTheoryPracticeContext(null, {
    openWorkspace: async () => { opened = true; }
  });
  assert.equal(executed, false);
  assert.equal(opened, false);
});
