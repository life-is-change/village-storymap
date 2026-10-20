import test from 'node:test';import assert from 'node:assert/strict';import {createFileBudget} from '../unified/budgets.mjs';
test('ordinary, C2a and legacy files share a single aggregate budget and failed opens release it',async()=>{
 const budget=createFileBudget({reads:2,writes:1}),store={open:async()=>({close:async()=>{}})},a=budget.wrap(store),b=budget.wrap(store),legacy=budget.wrap(store);
 const x=await a.open(),y=await b.open();await assert.rejects(legacy.open(),{code:'FILE_BUSY'});await x.close();await x.close();const z=await legacy.open();assert.deepEqual(budget.diagnostics(),{read:2,write:0});await y.close();await z.close();
 await assert.rejects(budget.wrap({open:async()=>{throw Error('disk');}}).open());assert.equal(budget.diagnostics().read,0);
});
