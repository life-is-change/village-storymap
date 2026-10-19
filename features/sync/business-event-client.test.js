const test=require('node:test'),assert=require('node:assert/strict');let api;try{api=require('./business-event-client.js');}catch{api={};}
test('local events use authenticated same-origin fetch, full refresh on reconnect and ignore old-context delivery',async()=>{
 assert.equal(typeof api.createBusinessEventClient,'function');const requests=[],invalidations=[],states=[];let release;
 const client=api.createBusinessEventClient({origin:'https://example.org',getAccessToken:async()=> 'opaque',onInvalidate:e=>invalidations.push(e),onConnectionChange:s=>states.push(s),fetchImpl:async(url,options)=>{
  requests.push([url,options]);return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(controller){release=()=>{try{controller.enqueue(new TextEncoder().encode('event: invalidate\nid: 4\ndata: {"kind":"planning","context":{"spaceId":"A"},"cursor":"4"}\n\n'));controller.close();}catch{}};}})};
 }});
 await client.start({teachingProjectId:'p',villageId:'v',spaceId:'A'});await new Promise(r=>setImmediate(r));
 assert.equal(requests[0][1].headers.Authorization,'Bearer opaque');assert.equal(requests[0][1].credentials,'omit');assert.equal(invalidations[0].kind,'refresh');
 const old=release;await client.stop();old();await new Promise(r=>setImmediate(r));assert.equal(invalidations.length,1);assert.ok(states.includes('connected'));
});
