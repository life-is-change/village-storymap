import {createHash} from 'node:crypto';
const fault=code=>Object.assign(Error(code),{code});
const MAX=10*1024**2;
const prompt='把建筑实拍图转换为规整正立面投影，保持原门窗、层数、色彩和材质，不增加构件，背景为浅灰。';
async function json(response){
 if(!response.ok||!response.body)throw fault('PROVIDER_UNAVAILABLE');const reader=response.body.getReader(),parts=[];let count=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((count+=value.length)>512*1024)throw fault('PROVIDER_UNAVAILABLE');parts.push(value);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw fault('PROVIDER_UNAVAILABLE');}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function outputURL(text){
 let url;try{url=new URL(text);}catch{throw fault('PROVIDER_OUTPUT_INVALID');}
 if(typeof text!=='string'||text.length>4096||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!/^dashscope-result-[a-z0-9-]{1,40}\.oss-(?:cn-beijing|cn-wulanchabu|cn-hangzhou|ap-southeast-1)\.aliyuncs\.com$/.test(url.hostname))throw fault('PROVIDER_OUTPUT_INVALID');return url.href;
}
export function createDashScopeProvider({enabled=false,key='',workspace='',region='cn-beijing',fetchImpl=fetch}){
 if(typeof enabled!=='boolean'||!['cn-beijing','ap-southeast-1'].includes(region)||enabled&&(!/^[a-zA-Z0-9-]{1,100}$/.test(workspace)||typeof key!=='string'||key.length<24||key.length>256||/\s/.test(key)))throw Error('INVALID_CONFIGURATION');
 const base=`https://${workspace}.${region}.maas.aliyuncs.com/api/v1`,available=enabled;
 async function request(path,options){if(!available)throw fault('CLOUD_FACADE_NOT_CONFIGURED');let response;try{response=await fetchImpl(base+path,{...options,redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+key,...options.headers}});}catch{throw fault('PROVIDER_UNAVAILABLE');}return json(response);}
 return {available,capability:()=>({available,provider:'dashscope',model:available?'qwen-image-3.0':'',reason:available?'':'not_configured'}),
  async submit({image}){
   if(!available)throw fault('CLOUD_FACADE_NOT_CONFIGURED');if(!image||!Number.isSafeInteger(image.size)||image.size<1||image.size>MAX||!['image/png','image/jpeg'].includes(image.mime)||!/^[a-f0-9]{64}$/.test(image.sha256??''))throw fault('INVALID_FILE');
   const parts=[],hash=createHash('sha256');let count=0;for await(const part of image.stream()){if((count+=part.length)>image.size)throw fault('INVALID_FILE');hash.update(part);parts.push(part);}if(count!==image.size||hash.digest('hex')!==image.sha256)throw fault('INVALID_FILE');
   const body=await request('/services/aigc/image-generation/generation',{method:'POST',headers:{'Content-Type':'application/json','X-DashScope-Async':'enable'},body:JSON.stringify({model:'qwen-image-3.0',input:{messages:[{role:'user',content:[{image:`data:${image.mime};base64,${Buffer.concat(parts).toString('base64')}`},{text:prompt}]}]},parameters:{n:1,prompt_extend:true,watermark:false}})});
   const jobId=body?.output?.task_id;if(typeof jobId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(jobId))throw fault('PROVIDER_UNAVAILABLE');return {jobId};
  },
  async poll(jobId){
   if(typeof jobId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(jobId))throw fault('INVALID_INPUT');const body=await request('/tasks/'+jobId,{method:'GET'}),state=body?.output?.task_status;
   const status={PENDING:'queued',RUNNING:'running',SUCCEEDED:'succeeded',FAILED:'failed',CANCELED:'failed'}[state];if(!status)throw fault('PROVIDER_UNAVAILABLE');
   const content=body?.output?.choices?.[0]?.message?.content??[],output=content.find(v=>typeof v?.image==='string')?.image??body?.output?.results?.[0]?.url??body?.output?.task_result?.images?.[0]?.url;
   return {status,...(status==='succeeded'?{output:outputURL(output)}:{})};
  },
  async openOutput(text){
   if(!available)throw fault('CLOUD_FACADE_NOT_CONFIGURED');const url=outputURL(text);let response;try{response=await fetchImpl(url,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(45000)});}catch{throw fault('PROVIDER_UNAVAILABLE');}
   const size=Number(response.headers.get('content-length')),mime=response.headers.get('content-type')?.split(';')[0];
   if(!response.ok||!response.body||!Number.isSafeInteger(size)||size<1||size>MAX||!['image/png','image/jpeg'].includes(mime)||response.headers.get('content-encoding')&&response.headers.get('content-encoding')!=='identity'){await response.body?.cancel().catch(()=>{});throw fault('PROVIDER_OUTPUT_INVALID');}
   return {size,mime,stream:response.body};
  }
 };
}
