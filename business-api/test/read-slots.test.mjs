import test from 'node:test';import assert from 'node:assert/strict';
import {createBusinessFilesService} from '../unified/files.mjs';
import {createReadSlots} from '../unified/read-slots.mjs';

test('ordinary photo bursts wait without opening more than four files or losing a reader slot',async()=>{
 let active=0,maximum=0,authorized=0;
 const id='91000000-0000-4000-8000-000000000009';
 const database={withIdentity:async(identity,fn)=>fn({query:async()=>{authorized++;return {rows:[{data:{id,size:1,sha256:'a'.repeat(64),mime:'image/png',extension:'png'}}]};}})};
 const store={open:async()=>{maximum=Math.max(maximum,++active);return {size:1,async close(){active--;}};}};
 const service=createBusinessFilesService({database,store});
 const first=await Promise.all(Array.from({length:4},()=>service.read({},id)));
 const fifth=service.read({},id);fifth.catch(()=>{});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(authorized,4);
 await first[0].close();const extra=await fifth;
 assert.equal(maximum,4);assert.equal(authorized,5);
 await Promise.all([...first.slice(1),extra].map(handle=>handle.close()));assert.equal(active,0);
});

test('reader waiters are bounded, expire safely and never acquire a released slot twice',async()=>{
 const acquire=createReadSlots({activeLimit:1,waitLimit:1,timeoutMs:20});
 const release=await acquire();const waiting=acquire();waiting.catch(()=>{});
 await assert.rejects(acquire(),{code:'FILE_BUSY'});
 await assert.rejects(waiting,{code:'FILE_BUSY'});
 release();release();const next=await acquire();next();
 const again=await acquire();const queued=acquire();again();const last=await queued;last();
});
