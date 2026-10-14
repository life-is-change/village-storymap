import { createModelVariants } from './browser-variants.mjs';
self.onmessage=async event=>{
 try{
  const result=await createModelVariants(event.data.buffer,event.data.options);
  self.postMessage({result},[result.buffer,result.lowBuffer]);
 }catch(error){self.postMessage({error:String(error.message||error)});}
};
