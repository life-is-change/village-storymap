(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BusinessEventClientModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function createBusinessEventClient({getAccessToken,onInvalidate,onConnectionChange,origin=globalThis.location?.origin,fetchImpl=globalThis.fetch}){
  const base=new URL(origin);if(base.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('HTTPS_REQUIRED');
  let generation=0,controller=null,retry=null,cursor=null;
  async function stop(){generation++;clearTimeout(retry);retry=null;controller?.abort();controller=null;cursor=null;onConnectionChange?.('disconnected');}
  async function start(context){
   await stop();const epoch=generation,selected={teachingProjectId:context.teachingProjectId,villageId:context.villageId,spaceId:context.spaceId};
   function active(){return epoch===generation;}
   async function connect(){
    if(!active())return;controller=new AbortController();onConnectionChange?.('connecting');
    try{
     const token=await getAccessToken();if(!active())return;if(!token)throw Error('UNAUTHORIZED');
     const url=new URL('/api/v1/events',base);url.searchParams.set('contexts',JSON.stringify([selected]));if(cursor!==null)url.searchParams.set('cursor',cursor);
     const response=await fetchImpl(url.href,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
     if(!response.ok){const error=Object.assign(Error('EVENTS_UNAVAILABLE'),{status:response.status});throw error;}
     if(!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw Error('INVALID_EVENT_STREAM');
     if(!active())return;await onInvalidate?.({kind:'refresh',context:selected});if(!active())return;onConnectionChange?.('connected');
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
     try{for(;;){const {value,done}=await reader.read();if(!active())return;if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>65536)throw Error('EVENT_BUFFER_LIMIT');
      let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const fields={};for(const line of block.split('\n')){const i=line.indexOf(':');if(i>=0)fields[line.slice(0,i)]=line.slice(i+1).trimStart();}
       if(fields.event==='heartbeat'){if(/^\d{1,19}$/.test(fields.id))cursor=fields.id;continue;}
       if(!['refresh','invalidate'].includes(fields.event)||!/^\d{1,19}$/.test(fields.id))throw Error('INVALID_EVENT');const data=JSON.parse(fields.data);if(!active())return;
       if(fields.event==='invalidate'&&data.context&&Object.keys(selected).some(k=>data.context[k]!==selected[k]))continue;
       cursor=fields.id;await onInvalidate?.({...data,context:data.context??selected});
      }
     }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }catch(e){if(!active())return;onConnectionChange?.('disconnected');if([401,403].includes(e.status))return;}
    if(active()){onConnectionChange?.('disconnected');retry=setTimeout(connect,2000);retry.unref?.();}
   }
   void connect();return {stop};
  }
  return {start,stop};
 }
 return {createBusinessEventClient};
});
