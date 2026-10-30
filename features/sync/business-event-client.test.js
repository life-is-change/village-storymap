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

test('overlapping starts open only the latest context and intentional stops are idle',async()=>{
 const requests=[],states=[];
 const client=api.createBusinessEventClient({origin:'https://example.org',getAccessToken:async()=> 'token',onConnectionChange:s=>states.push(s),fetchImpl:async(url)=>{
  requests.push(JSON.parse(new URL(url).searchParams.get('contexts'))[0]);
  return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({})};
 }});
 await Promise.all([client.start({spaceId:'A'}),client.start({spaceId:'B'})]);await new Promise(r=>setImmediate(r));
 assert.deepEqual(requests,[{spaceId:'B'}]);
 await client.stop();assert.equal(states.at(-1),'idle');assert.ok(!states.includes('disconnected'));
});

test('an expired event token retries with refreshed authentication instead of staying disconnected',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let requests=0,tokenCalls=0;const states=[];
 const client=api.createBusinessEventClient({origin:'https://example.org',getAccessToken:async()=>{tokenCalls++;return tokenCalls===1?'expired':'renewed';},onConnectionChange:s=>states.push(s),fetchImpl:async(_url,options)=>{
  requests++;if(requests===1)return {ok:false,status:401};
  assert.equal(options.headers.Authorization,'Bearer renewed');return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({})};
 }});
 await client.start({spaceId:'A'});await new Promise(r=>setImmediate(r));t.mock.timers.tick(2000);await new Promise(r=>setImmediate(r));
 assert.equal(requests,2);assert.equal(states.at(-1),'connected');await client.stop();
});

test('a failed initial facts refresh closes its event stream before retrying',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});const signals=[];let refreshes=0;
 const client=api.createBusinessEventClient({origin:'https://example.org',getAccessToken:async()=> 'token',onInvalidate:async()=>{if(++refreshes===1)throw Error('SHARED_REFRESH_FAILED');},fetchImpl:async(_url,options)=>{
  signals.push(options.signal);return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({})};
 }});
 await client.start({spaceId:'A'});await new Promise(r=>setImmediate(r));
 assert.equal(signals[0].aborted,true,'failed refresh must not leave a live, unread stream');
 t.mock.timers.tick(2000);await new Promise(r=>setImmediate(r));assert.equal(signals.length,2);assert.equal(signals[1].aborted,false);await client.stop();
});
