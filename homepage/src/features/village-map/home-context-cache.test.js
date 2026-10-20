import test from "node:test";
import assert from "node:assert/strict";
import { readHomeContext, writeHomeContext } from "./home-context-cache.js";

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value))
  };
}

test("homepage restores the last confirmed village context before the parent replies", () => {
  const store = storage();
  writeHomeContext(store, {
    villages: [{ id: "practice", name: "米埗村" }, { id: "formal", name: "红星村" }],
    selectedVillageId: "formal"
  });
  const restored = readHomeContext(store);
  assert.equal(restored.villages.length, 2);
  assert.equal(restored.selectedVillageId, "formal");
});

test("homepage ignores malformed or empty cached contexts", () => {
  const malformed = { getItem: () => "{" };
  assert.equal(readHomeContext(malformed), null);
  const empty = storage();
  writeHomeContext(empty, { villages: [], selectedVillageId: "" });
  assert.equal(readHomeContext(empty), null);
});
test('Aliyun homepage waits for current parent authorization instead of restoring a previous user catalog',()=>{
 const previous=globalThis.window;globalThis.window={parent:{VILLAGE_DEPLOYMENT:{mode:'aliyun'}}};
 try{const store=storage();assert.equal(writeHomeContext(store,{villages:[{id:'private-draft'}]}),false);assert.equal(readHomeContext({getItem:()=>JSON.stringify({villages:[{id:'private-draft'}]})}),null);}finally{globalThis.window=previous;}
});
