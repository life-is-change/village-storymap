const test=require('node:test');
const assert=require('node:assert/strict');
const {runBoundedTasks}=require('./effective-building-features');
test('restores 100 models with at most three active decodes and preserves same-object order',async()=>{
 let active=0,peak=0; const order=[];
 const items=Array.from({length:100},(_,i)=>({code:String(i%50),i}));
 const results=await runBoundedTasks(items,async item=>{
  active++;peak=Math.max(peak,active);
  await new Promise(r=>setImmediate(r));
  order.push(item.i);active--;return item.i;
 },{concurrency:3,key:item=>item.code});
 assert.equal(results.length,100);
 assert.equal(peak,3);
 for(let i=0;i<50;i++)assert.ok(order.indexOf(i)<order.indexOf(i+50));
});
test('switching scope stops queued models and drains already-started work',async()=>{
 let current=true,release;const gate=new Promise(r=>release=r),started=[];
 const pending=runBoundedTasks([1,2,3,4,5],async id=>{started.push(id);await gate;},{concurrency:2,isCurrent:()=>current});
 await new Promise(r=>setImmediate(r));current=false;release();await pending;
 assert.deepEqual(started,[1,2]);
});
