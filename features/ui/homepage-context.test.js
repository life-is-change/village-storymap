const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../villages/village-model.js");
const { confirmedHomepageContext } = require("./homepage-context.js");

test("an incomplete startup context must not replace the homepage village cache", () => {
  assert.equal(confirmedHomepageContext(null, model), null);
  assert.equal(confirmedHomepageContext({}, model), null);
  assert.equal(confirmedHomepageContext({ project: { id: "p1" }, villages: [] }, model), null);
});

test("confirmed project context publishes both practice villages before workspace loading", () => {
  const result = confirmedHomepageContext({
    project: { id: "p1", practiceVillageId: "mibu" },
    villages: [
      { id: "mibu", name: "米埗村", isPractice: true, status: "published" },
      { id: "red", name: "红星村", isPractice: true, status: "published" }
    ], villageId: "red"
  }, model);
  assert.deepEqual(result.villages.map((village) => village.id), ["mibu", "red"]);
  assert.equal(result.selectedVillageId, "red");
});

test("early server response preserves a valid cached village selection", () => {
  const context = confirmedHomepageContext({
    project: { id: "p1", practiceVillageId: "mibu" },
    villages: [
      { id: "mibu", name: "米埗村", isPractice: true, status: "published" },
      { id: "red", name: "红星村", isPractice: true, status: "published" }
    ]
  }, model, "red");
  assert.equal(context.selectedVillageId, "red");
});
