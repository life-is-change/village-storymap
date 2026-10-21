import {fault} from '../scene-files/contracts.mjs';

// Bound both open streams and waiting work. Bursts wait briefly instead of
// failing immediately, while slow readers cannot consume unlimited resources.
export function createReadSlots({activeLimit=4,waitLimit=28,timeoutMs=3000}={}){
 if(!Number.isInteger(activeLimit)||activeLimit<1||activeLimit>4||!Number.isInteger(waitLimit)||waitLimit<0||waitLimit>28||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3000)throw Error('INVALID_READ_LIMIT');
 let active=0;const waiters=[];
 function releaseSlot(){
  let used=false;
  return ()=>{if(used)return;used=true;
   const next=waiters.shift();
   if(next){clearTimeout(next.timer);next.resolve(releaseSlot());}
   else active--;
  };
 }
 return async()=>{
  if(active<activeLimit){active++;return releaseSlot();}
  if(waiters.length>=waitLimit)throw fault('FILE_BUSY');
  return new Promise((resolve,reject)=>{
   const row={resolve,timer:null};
   row.timer=setTimeout(()=>{const index=waiters.indexOf(row);if(index>=0){waiters.splice(index,1);reject(fault('FILE_BUSY'));}},timeoutMs);
   waiters.push(row);
  });
 };
}
