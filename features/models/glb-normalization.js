(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.GlbNormalizationModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const scriptUrl=typeof document!=='undefined'?document.currentScript?.src:null;
  function bytes(value){if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);throw new Error('INVALID_GLB_BYTES');}
  function readGlb(value){
    const input=bytes(value);if(input.length<20)throw new Error('INVALID_GLB_HEADER');const v=new DataView(input.buffer,input.byteOffset,input.byteLength);
    if(v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==input.length)throw new Error('INVALID_GLB_HEADER');
    let offset=12,json=null,binary=new Uint8Array();
    while(offset<input.length){if(offset+8>input.length)throw new Error('INVALID_GLB_CHUNK');const length=v.getUint32(offset,true),type=v.getUint32(offset+4,true);offset+=8;
      if(length%4||offset+length>input.length)throw new Error('INVALID_GLB_CHUNK');
      if(type===0x4e4f534a){if(json)throw new Error('INVALID_GLB_JSON');json=JSON.parse(new TextDecoder().decode(input.subarray(offset,offset+length)).replace(/[\s\0]+$/g,''));}
      else if(type===0x004e4942)binary=input.slice(offset,offset+length);
      else throw new Error('UNSUPPORTED_GLB_CHUNK');offset+=length;
    }
    if(!json||json.asset?.version!=='2.0')throw new Error('INVALID_GLB_JSON');return {json,binary};
  }
  function writeGlb(json,binary){
    const data=new TextEncoder().encode(JSON.stringify(json)),n=(data.length+3)&~3,bin=binary?bytes(binary):new Uint8Array(),b=(bin.length+3)&~3;
    const out=new Uint8Array(12+8+n+(b?8+b:0)),v=new DataView(out.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+n);out.set(data,20);
    if(b){v.setUint32(20+n,b,true);v.setUint32(24+n,0x004e4942,true);out.set(bin,28+n);}return out.buffer;
  }
  function multiply(a,b){return Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);let s=0;for(let k=0;k<4;k++)s+=a[r+4*k]*b[k+4*c];return s;});}
  function vector(value, fallback, length){const a=value===undefined?fallback:value;if(!Array.isArray(a)||a.length!==length||a.some(x=>typeof x!=='number'||!Number.isFinite(x)))throw new Error('INVALID_NODE_TRANSFORM');return a;}
  function matrix(node){
    if(node.matrix)return vector(node.matrix,IDENTITY,16);const t=vector(node.translation,[0,0,0],3),s=vector(node.scale,[1,1,1],3),q=vector(node.rotation,[0,0,0,1],4);
    const norm=Math.hypot(...q);if(norm<1e-12)throw new Error('INVALID_NODE_TRANSFORM');const [x,y,z,w]=q.map(n=>n/norm);
    return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
  }
  function accessorReader(json,binary,accessorIndex,components) {
    const a=json.accessors?.[accessorIndex];if(!a||a.type!==(components===3?'VEC3':'SCALAR')||!Number.isSafeInteger(a.count)||a.count<1)throw new Error('INVALID_POSITION_ACCESSOR');
    const formats={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};const format=formats[a.componentType];if(!format)throw new Error('UNSUPPORTED_ACCESSOR_COMPONENT');
    const data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
    function location(id,offset,count,width){const view=json.bufferViews?.[id];if(!view||view.buffer!==0||view.extensions?.EXT_meshopt_compression)throw new Error('压缩或外部模型请先使用 CPU 模型处理工具解码。');
      const start=(view.byteOffset||0)+(offset||0),stride=view.byteStride||width;
      if(start<0||stride<width||start+(count-1)*stride+width>(view.byteOffset||0)+view.byteLength||start+(count-1)*stride+width>binary.length)throw new Error('INVALID_ACCESSOR_BOUNDS');return {start,stride};}
    const base=a.bufferView===undefined?null:location(a.bufferView,a.byteOffset,a.count,format[0]*components);
    const sparse=new Map();if(a.sparse){const s=a.sparse,indexFormat=formats[s.indices.componentType];if(![5121,5123,5125].includes(s.indices.componentType)||s.count>a.count)throw new Error('INVALID_SPARSE_ACCESSOR');
      const ids=location(s.indices.bufferView,s.indices.byteOffset,s.count,indexFormat[0]),values=location(s.values.bufferView,s.values.byteOffset,s.count,format[0]*components);
      for(let i=0;i<s.count;i++){const id=data[indexFormat[1]](ids.start+i*ids.stride,true);if(id>=a.count)throw new Error('INVALID_SPARSE_INDEX');sparse.set(id,values.start+i*values.stride);}}
    if(!base&&!a.sparse)throw new Error('压缩或缺少顶点数据的模型请先使用 CPU 模型处理工具解码。');
    return {count:a.count,get(index,component=0){if(!Number.isSafeInteger(index)||index<0||index>=a.count)throw new Error('INVALID_VERTEX_INDEX');const offset=sparse.has(index)?sparse.get(index):(base?base.start+index*base.stride:null);
      let n=offset===null?0:data[format[1]](offset+component*format[0],true);if(a.normalized&&a.componentType!==5126){const divisor={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[a.componentType];n=Math.max(-1,n/divisor);}if(!Number.isFinite(n))throw new Error('INVALID_POSITION_VALUE');return n;}};
  }
  function inspectGlb(value){
    const {json,binary}=readGlb(value),scene=json.scenes?.[json.scene??0];if(!scene)throw new Error('GLB 缺少活动场景边界');
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangleCount=0,primitiveCount=0;
    function visit(id,parent,ancestors){
      if(ancestors.has(id))throw new Error('GLB node cycle / 节点循环');const node=json.nodes?.[id];if(!node)throw new Error('INVALID_NODE');if(node.skin!==undefined)throw new Error('蒙皮 skin 模型请先导出静态姿态，再进行贴地处理。');const path=new Set(ancestors);path.add(id);const m=multiply(parent,matrix(node));
      for(const primitive of json.meshes?.[node.mesh]?.primitives||[]){const pos=json.accessors?.[primitive.attributes?.POSITION];if(!pos)continue;
        if(primitive.targets?.some(target=>target.POSITION!==undefined))throw new Error('带 POSITION morph 形变的模型请先导出静态姿态。');
        const points=accessorReader(json,binary,primitive.attributes.POSITION,3),indices=primitive.indices===undefined?null:accessorReader(json,binary,primitive.indices,1);
        for(let i=0;i<(indices?.count||points.count);i++){const index=indices?indices.get(i):i;const x=points.get(index,0),y=points.get(index,1),z=points.get(index,2);for(let r=0;r<3;r++){const n=m[r]*x+m[r+4]*y+m[r+8]*z+m[r+12];min[r]=Math.min(min[r],n);max[r]=Math.max(max[r],n);}}
        primitiveCount++;const count=json.accessors?.[primitive.indices]?.count??pos.count??0;const mode=primitive.mode??4;triangleCount+=mode===4?Math.floor(count/3):([5,6].includes(mode)?Math.max(0,count-2):0);
      }
      for(const child of node.children||[])visit(child,m,path);
    }
    for(const id of scene.nodes||[])visit(id,IDENTITY,new Set());
    if(!min.every(Number.isFinite)||!max.every(Number.isFinite))throw new Error('无法计算模型边界 bounds，请先导出包含 POSITION 边界的 GLB。');
    return {bounds:{min,max,size:max.map((n,i)=>n-min[i])},triangleCount,primitiveCount,textureCount:(json.images||[]).length,normalized:json.extras?.villageModel?.normalized===true,anchor:json.extras?.villageModel?.anchor||null,normalization:json.extras?.villageModel||null};
  }
  function normalizeGlb(value,options={}){
    const parsed=readGlb(value),inspection=inspectGlb(value);if(inspection.normalized)return {buffer:bytes(value).slice().buffer,inspection};
    const unit=options.metersPerUnit??1;if(typeof unit!=='number'||!Number.isFinite(unit)||unit<=0||unit>1000)throw new Error('INVALID_MODEL_UNIT_SCALE');
    const {min,max}=inspection.bounds;const center=[(min[0]+max[0])/2,min[1],(min[2]+max[2])/2];const {json,binary}=parsed;const scene=json.scenes[json.scene??0];
    const wrapper={name:'Village bottom-center anchor',children:[...(scene.nodes||[])],translation:center.map(n=>-n*unit),scale:[unit,unit,unit]};
    scene.nodes=[json.nodes.length];json.nodes.push(wrapper);json.extras={...(json.extras||{}),villageModel:{schemaVersion:1,normalized:true,anchor:'bottom-center',metersPerUnit:unit,originalBounds:inspection.bounds,originalCenter:center}};
    const buffer=writeGlb(json,binary);return {buffer,inspection:inspectGlb(buffer)};
  }
  async function processAsync(operation,value,options={}) {
    if(typeof Worker!=='function'||!scriptUrl)return operation==='inspect'?inspectGlb(value):normalizeGlb(value,options);
    const input=bytes(value).slice().buffer;
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('glb-normalization-worker.js',scriptUrl));
      const finish=(result,error)=>{worker.terminate();error?reject(new Error(error)):resolve(result);};
      worker.onmessage=event=>finish(event.data.result,event.data.error);
      worker.onerror=event=>finish(null,event.message||'模型处理线程失败，请检查文件后重试。');
      try {worker.postMessage({operation,buffer:input,options},[input]);}catch(error){finish(null,error.message);}
    });
  }
  const normalizeGlbAsync=(value,options)=>processAsync('normalize',value,options);
  const inspectGlbAsync=value=>processAsync('inspect',value);
  async function createModelVariantsAsync(value,options={}) {
    const input=bytes(value).slice().buffer;
    if(typeof Worker!=='function'||!scriptUrl){
      if(typeof module==='object'&&module.exports){
        const engine=await import('../../tools/model-processor/browser-variants.mjs');
        return engine.createModelVariants(input,options);
      }
      throw new Error('浏览器缺少模型后台处理能力，请使用最新版 Chrome 或 Edge。');
    }
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../../assets/vendor/model-optimizer/automatic-model-worker.js?v=20261013-auto-lod',scriptUrl));
      let finished=false;
      const finish=(result,error)=>{if(finished)return;finished=true;clearTimeout(timer);worker.terminate();error?reject(new Error(error)):resolve(result);};
      const timer=setTimeout(()=>finish(null,'模型处理超时，请精简模型或贴图后重试。'),180000);
      worker.onmessage=event=>finish(event.data.result,event.data.error);
      worker.onerror=event=>finish(null,event.message||'模型后台处理失败，请刷新后重试。');
      try{worker.postMessage({buffer:input,options:{metersPerUnit:options.metersPerUnit??1}},[input]);}catch(error){finish(null,error.message);}
    });
  }
  return {readGlb,writeGlb,inspectGlb,normalizeGlb,normalizeGlbAsync,inspectGlbAsync,createModelVariantsAsync};
});
