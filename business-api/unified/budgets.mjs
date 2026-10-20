import {fault} from './contracts.mjs';
import {measure} from './metrics.mjs';
export function createFileBudget({reads=4,writes=1}={}){
 if(!Number.isInteger(reads)||reads<1||reads>4||!Number.isInteger(writes)||writes<1||writes>2)throw fault('INVALID_INPUT');
 const active={read:0,write:0};
 function take(kind){if(active[kind]>=(kind==='read'?reads:writes))throw fault('FILE_BUSY');active[kind]++;let released=false;return ()=>{if(!released){released=true;active[kind]--;}};}
 function wrap(store){return Object.freeze({...store,
  ...(store.stage?{async stage(input){const release=take('write');try{return await measure('file',()=>store.stage(input));}finally{release();}}}:{}),
  async open(...args){const release=take('read');try{const opened=await measure('file',()=>store.open(...args));return {...opened,async close(){try{await measure('file',()=>opened.close());}finally{release();}}};}catch(e){release();throw e;}}
 });}
 return {wrap,diagnostics:()=>({...active})};
}
