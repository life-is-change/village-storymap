import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage(),empty=()=>({authMs:0,sqlMs:0,fileMs:0});
export const requestMetrics=fn=>context.run(empty(),fn);
export async function measure(kind,fn){
 const state=context.getStore(),key={auth:'authMs',sql:'sqlMs',file:'fileMs'}[kind];
 if(!key)throw Error('INVALID_METRIC');const start=performance.now();
 try{return await fn();}finally{if(state)state[key]+=performance.now()-start;}
}
export const snapshot=()=>Object.fromEntries(Object.entries(context.getStore()??empty()).map(([k,v])=>[k,Math.round(v*100)/100]));
export const serverTiming=(value=snapshot())=>['auth','sql','file'].map(k=>k+';dur='+value[k+'Ms']).join(', ');
