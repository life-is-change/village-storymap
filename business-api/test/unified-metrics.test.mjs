import test from 'node:test';import assert from 'node:assert/strict';
let metrics;try{metrics=await import('../unified/metrics.mjs');}catch{metrics={};}
test('request timing is isolated across concurrent identities and records failures without private data',async()=>{
 assert.equal(typeof metrics.requestMetrics,'function');
 let a,b;const wait=ms=>new Promise(r=>setTimeout(r,ms));
 await Promise.all([metrics.requestMetrics(async()=>{await metrics.measure('auth',()=>wait(15));await metrics.measure('sql',()=>wait(5));a=metrics.snapshot();}),metrics.requestMetrics(async()=>{await assert.rejects(metrics.measure('file',async()=>{await wait(2);throw Error('private-token');}));b=metrics.snapshot();})]);
 assert.ok(a.authMs>=10);assert.ok(a.sqlMs>=1);assert.equal(a.fileMs,0);assert.ok(b.fileMs>=1);assert.equal(b.authMs,0);assert.equal(b.sqlMs,0);assert.deepEqual(metrics.snapshot(),{authMs:0,sqlMs:0,fileMs:0});
 assert.match(metrics.serverTiming(a),/^auth;dur=\d+(\.\d+)?, sql;dur=/);assert.ok(!JSON.stringify([a,b]).includes('private-token'));
});
