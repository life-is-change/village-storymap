import {setTimeout as delay} from 'node:timers/promises';
import {parseOperation,fault} from './contracts.mjs';
const POLL_MS=15000,MAX_IDLE_MS=30000;
const kinds=new Set(['catalog','survey','planning','community','photos','models','scene','personal','tasks']);
function contextsInput(contexts){
 if(!Array.isArray(contexts)||!contexts.length||contexts.length>8)throw fault('INVALID_INPUT');
 return contexts.map(c=>parseOperation('catalog.getSpace',c).input);
}
function cursorInput(cursor){if(cursor!==null&&cursor!==undefined&&(typeof cursor!=='string'||!/^\d{1,19}$/.test(cursor)||BigInt(cursor)>9223372036854775807n))throw fault('INVALID_INPUT');return cursor??null;}
export function createEventService({database,now=Date.now,wait=(ms,signal)=>delay(ms,undefined,{signal})}){
 const streams=new Set();let closed=false;
 async function read(identity,contexts,cursor){return database.withIdentity(identity,async client=>(await client.query('SELECT api_private.event_read($1::jsonb,$2::bigint) AS data',[JSON.stringify(contexts),cursor])).rows[0].data,{readOnly:true});}
 return {
  async appendInTransaction(client,event){
   if(!kinds.has(event?.kind)||Object.keys(event).some(k=>!['kind','context'].includes(k)))throw fault('INVALID_INPUT');
   const context=contextsInput([event.context])[0];
   await client.query('SELECT api_private.event_append($1,$2::jsonb)',[event.kind,JSON.stringify(context)]);
  },
  async open(identity,contexts,cursor=null){
   const selected=contextsInput(contexts);cursor=cursorInput(cursor);
   if(closed)throw fault('DB_UNAVAILABLE');
   if(streams.size>=32||[...streams].filter(s=>s.userId===identity?.userId).length>=4)throw fault('RATE_LIMITED');
   const controller=new AbortController();const state={userId:identity?.userId,stop:()=>controller.abort()};streams.add(state);
   let initial;try{initial=await read(identity,selected,cursor);}catch(e){streams.delete(state);throw e;}
   let lastConsumed=now(),lastRead=now(),queue=[],ended=false,busy=false;
   function fill(data){
    cursor=data.cursor;
    if(data.refresh)queue.push({event:'refresh',id:cursor,data:{kind:'refresh',cursor}});
    else for(const e of data.events)queue.push({event:'invalidate',id:e.cursor,data:e});
    if(!queue.length)queue.push({event:'heartbeat',id:cursor,data:{cursor}});
   }
   fill(initial);
   async function finish(){if(!ended){ended=true;controller.abort();streams.delete(state);}return {done:true};}
   const stream={
    async next(){
     if(busy)throw fault('INVALID_INPUT');busy=true;
     try{
      if(ended||controller.signal.aborted||identity.expiry*1000<=now()||now()-lastConsumed>MAX_IDLE_MS)return finish();
      // A queued batch is small and cannot postpone permission checks indefinitely.
      if(now()-lastRead>=POLL_MS){if(queue.length)cursor=null;queue=[];fill(await read(identity,selected,cursor));lastRead=now();}
      if(!queue.length){
       try{await wait(Math.max(1,POLL_MS-(now()-lastRead)),controller.signal);}catch(e){if(controller.signal.aborted)return finish();throw e;}
       if(controller.signal.aborted||identity.expiry*1000<=now())return finish();
       fill(await read(identity,selected,cursor));lastRead=now();
      }
      lastConsumed=now();return {done:false,value:queue.shift()};
     }catch(e){await finish();throw e;}finally{busy=false;}
    },
    return:finish,[Symbol.asyncIterator](){return this;}
   };
   return stream;
  },
  async close(){closed=true;for(const s of streams)s.stop();streams.clear();}
 };
}
