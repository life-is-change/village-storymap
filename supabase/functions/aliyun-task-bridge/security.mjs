export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export const fail=code=>Object.assign(Error(code),{code});
export async function authorized(request,token){
 if(typeof token!=='string'||token.length<32||token.length>256||/\s/.test(token))return false;
 const supplied=request.headers.get('authorization')??'';
 if(supplied.length>300)return false;
 const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [a,b]=await Promise.all([digest(supplied),digest('Bearer '+token)]);let difference=0;for(let i=0;i<32;i++)difference|=a[i]^b[i];return difference===0;
}
export async function readBounded(request,max){
 const reader=request.body?.getReader();if(!reader)throw fail('INVALID_INPUT');const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>max)throw fail('PAYLOAD_TOO_LARGE');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const p of parts){result.set(p,offset);offset+=p.byteLength;}return result;
}
export async function readJSON(request,max=2048){try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(request,max)));if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>['__proto__','prototype','constructor'].includes(k)))throw Error();return v;}catch(e){throw fail(e?.code==='PAYLOAD_TOO_LARGE'?e.code:'INVALID_INPUT');}}
export function checkedRequest(value,fields){if(Object.keys(value).some(k=>!fields.includes(k))||!UUID.test(value.ownerId??'')||!UUID.test(value.requestId??''))throw fail('INVALID_INPUT');return {ownerId:value.ownerId,requestId:value.requestId};}
