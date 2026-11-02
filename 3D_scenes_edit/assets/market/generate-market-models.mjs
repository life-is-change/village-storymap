// Original metre-scale geometry. Input Z-up, GLB Y-up. No external assets.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const colors={frame:[.18,.23,.21,1],canvas:[.92,.88,.71,1],stripe:[.23,.48,.31,1],wood:[.48,.29,.12,1],crate:[.62,.4,.19,1],scale:[.66,.72,.7,1],bag:[.79,.65,.4,1],sign:[.06,.15,.13,1],chalk:[.96,.93,.8,1], 'produce-leaf':[.18,.52,.12,1],'produce-stem':[.39,.66,.14,1],'produce-carrot':[1,.35,.03,1],'produce-tomato':[.86,.1,.035,1],'produce-eggplant':[.25,.07,.32,1],'produce-apple':[.77,.15,.06,1],'produce-orange':[1,.51,.02,1],'produce-tofu':[.94,.88,.64,1],'produce-mushroom':[.36,.22,.13,1]};
function model(kind,style='canopy'){
 const batches=new Map();
 const to=([x,y,z])=>[x,z,-y];
 function triangle(a,b,c,color){
  if(style!=='canopy'&&[a,b,c].some(p=>p[2]>1.7))return;
  if(style==='ground')[a,b,c]=[a,b,c].map(p=>[p[0],p[1],p[2]*.25]);
  if(!batches.has(color))batches.set(color,{p:[],n:[],i:[]});const batch=batches.get(color),base=batch.p.length/3;
  const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;
  for(const p of [a,b,c]){batch.p.push(...to(p));batch.n.push(...to(n.map(x=>x/length)));}batch.i.push(base,base+1,base+2);
 }
 function quad(a,b,c,d,color){triangle(a,b,c,color);triangle(a,c,d,color);}
 function box(center,size,color){const [x,y,z]=center,[w,d,h]=size.map(v=>v/2),p=[[-w,-d,-h],[w,-d,-h],[w,d,-h],[-w,d,-h],[-w,-d,h],[w,-d,h],[w,d,h],[-w,d,h]].map(a=>a.map((v,i)=>v+center[i]));for(const f of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]])quad(...f.map(i=>p[i]),color);}
 function ellipsoid(center,radii,color,slices=10,rings=6){
  const point=(i,j)=>{const t=Math.PI*i/rings,a=2*Math.PI*j/slices;return [Math.sin(t)*Math.cos(a),Math.sin(t)*Math.sin(a),Math.cos(t)].map((v,k)=>center[k]+v*radii[k]);};
  for(let i=0;i<rings;i++)for(let j=0;j<slices;j++){if(i>0)triangle(point(i,j),point(i,j+1),point(i+1,j+1),color);if(i<rings-1)triangle(point(i,j),point(i+1,j+1),point(i+1,j),color);}
 }
 function rod(a,b,r,color,sides=8){const u=b.map((v,i)=>v-a[i]),len=Math.hypot(...u),axis=u.map(v=>v/len),ref=Math.abs(axis[2])<.9?[0,0,1]:[0,1,0],x=[axis[1]*ref[2]-axis[2]*ref[1],axis[2]*ref[0]-axis[0]*ref[2],axis[0]*ref[1]-axis[1]*ref[0]],l=Math.hypot(...x);x.forEach((v,i)=>x[i]=v/l);const y=[axis[1]*x[2]-axis[2]*x[1],axis[2]*x[0]-axis[0]*x[2],axis[0]*x[1]-axis[1]*x[0]],p=(c,j)=>c.map((v,i)=>v+r*(x[i]*Math.cos(j*2*Math.PI/sides)+y[i]*Math.sin(j*2*Math.PI/sides)));for(let j=0;j<sides;j++){quad(p(a,j),p(a,j+1),p(b,j+1),p(b,j),color);triangle(a,p(a,j+1),p(a,j),color);triangle(b,p(b,j),p(b,j+1),color);}}
 // Feet, posts, roof ridge and cross braces, open sides keep the produce visible.
 for(const x of [-1.48,1.48])for(const y of [-1.05,1.05]){box([x,y,.03],[.18,.18,.06],'frame');rod([x,y,.06],[x,y,2.38],.035,'frame');}
 for(const y of [-1.05,1.05])rod([-1.48,y,2.36],[1.48,y,2.36],.03,'frame');
 for(const x of [-1.48,1.48]){rod([x,-1.05,2.36],[x,0,2.86],.03,'frame');rod([x,0,2.86],[x,1.05,2.36],.03,'frame');rod([x,.1,2.36],[x,1.05,1.68],.018,'frame');}
 rod([-1.62,0,2.86],[1.62,0,2.86],.035,'frame');
 // Striped pitched fabric and individual scalloped valance panels.
 for(let j=0;j<12;j++){const a=-1.65+j*.275,b=a+.275,c=j%2?'canvas':'stripe';for(const sign of [-1,1]){quad([a,0,2.89],[b,0,2.89],[b,sign*1.22,2.36],[a,sign*1.22,2.36],c);const y=sign*1.22;for(let t=0;t<4;t++){const x0=a+(b-a)*t/4,x1=a+(b-a)*(t+1)/4,z0=2.22-.045*Math.sin(Math.PI*t/4),z1=2.22-.045*Math.sin(Math.PI*(t+1)/4);quad([x0,y,2.36],[x1,y,2.36],[x1,y,z1],[x0,y,z0],c);}}}
 box([0,-.35,.88],[2.95,.92,.12],'wood');for(const x of [-1.27,1.27])for(const y of [-.65,-.05])box([x,y,.43],[.08,.08,.86],'frame');box([0,-.35,.25],[2.7,.68,.07],'wood');
 function crate(x,y,z,w=.8,d=.63){box([x,y,z],[w,d,.04],'crate');for(const sign of [-1,1])for(let row=0;row<3;row++){box([x,y+sign*d/2,z+.045+row*.05],[w,.035,.035],'crate');box([x+sign*w/2,y,z+.045+row*.05],[.035,d,.035],'crate');}for(const xx of [-1,1])for(const yy of [-1,1])box([x+xx*w/2,y+yy*d/2,z+.08],[.04,.04,.19],'wood');}
 for(const x of [-.98,0,.98])crate(x,-.35,.97);
 for(const x of [-.75,.2])crate(x,.1,.04,.7,.55);
 const goods=[];
 for(let col=0;col<3;col++)for(let row=0;row<3;row++)for(let n=0;n<4;n++){
  const x=(col-1)*.98+(n%2-.5)*.23,y=-.57+row*.18,z=1.09+Math.floor(n/2)*.13;
  if(kind==='vegetables'){
   if(col===0){ellipsoid([x,y,z],[.12,.09,.12],'produce-leaf');for(let leaf=0;leaf<3;leaf++)ellipsoid([x+(leaf-1)*.045,y,z+.11],[.045,.07,.14],'produce-stem',8,4);}
   if(col===1){ellipsoid([x,y,z],[.065,.14,.045],'produce-carrot');rod([x,y+.1,z],[x,y+.2,z+.05],.018,'produce-stem',6);}
   if(col===2){ellipsoid([x,y,z],[.1,.07,.095],'produce-tomato');rod([x,y,z+.08],[x+.02,y,z+.13],.014,'produce-stem',6);}
  }else if(kind==='fruit'){ellipsoid([x,y,z],[.095,.09,.1],col===1?'produce-orange':'produce-apple');rod([x,y,z+.09],[x+.01,y,z+.14],.008,'wood',6);}
  else if(col<2){box([x,y,z],[.17,.13,.12],'produce-tofu');box([x,y,z+.062],[.12,.09,.004],'canvas');}
  else{rod([x,y,z-.03],[x,y,z+.04],.025,'produce-tofu',6);ellipsoid([x,y,z+.04],[.08,.08,.04],'produce-mushroom',8,4);}
 }
 // Scale, front display, calibration keys and pan, plus paper bags and handles.
 box([1.12,-.21,1.22],[.3,.24,.08],'scale');box([1.12,-.21,1.28],[.26,.2,.02],'frame');rod([1.12,-.13,1.24],[1.12,-.13,1.55],.018,'scale');box([1.12,-.13,1.58],[.22,.04,.11],'scale');box([1.12,-.155,1.58],[.17,.008,.065],'sign');
 for(let i=0;i<3;i++)box([1.05+i*.06,-.161,1.58],[.025,.003,.035],'chalk');
 for(let i=0;i<3;i++){const x=-1.3+i*.12;box([x,.43,1.08],[.1,.09,.27],'bag');for(const dx of [-.025,.025])rod([x+dx,.43,1.21],[x+dx,.43,1.28],.008,'bag');rod([x-.025,.43,1.28],[x+.025,.43,1.28],.008,'bag');}
 // Hanging chalkboard. Price-like chalk strokes are geometry, not external font assets.
 box([0,-1.235,2.09],[.82,.045,.3],'wood');box([0,-1.262,2.09],[.75,.012,.24],'sign');for(let j=0;j<4;j++){box([-.27+j*.16,-1.272,2.12],[.09,.005,.012],'chalk');box([-.27+j*.16,-1.272,2.055],[.07,.005,.01],'chalk');}
 const chunks=[],views=[],accessors=[],primitives=[],materials=[];let offset=0;
 function append(array,target){const data=Buffer.from(array.buffer);const id=views.length;views.push({buffer:0,byteOffset:offset,byteLength:data.length,target});chunks.push(data);offset+=data.length;while(offset%4){chunks.push(Buffer.alloc(1));offset++;}return id;}
 for(const [name,b] of batches){const min=[0,1,2].map(i=>Math.min(...b.p.filter((_,j)=>j%3===i))),max=[0,1,2].map(i=>Math.max(...b.p.filter((_,j)=>j%3===i)));
  const p=accessors.push({bufferView:append(new Float32Array(b.p),34962),componentType:5126,count:b.p.length/3,type:'VEC3',min,max})-1,n=accessors.push({bufferView:append(new Float32Array(b.n),34962),componentType:5126,count:b.n.length/3,type:'VEC3'})-1,i=accessors.push({bufferView:append(new Uint32Array(b.i),34963),componentType:5125,count:b.i.length,type:'SCALAR'})-1;
  const material=materials.length;materials.push({name,doubleSided:name==='canvas'||name==='stripe',pbrMetallicRoughness:{baseColorFactor:colors[name],metallicFactor:name==='scale'?.45:0,roughnessFactor:.83}});primitives.push({attributes:{POSITION:p,NORMAL:n},indices:i,material});
 }
 const gltf={asset:{version:'2.0',generator:'Village original detailed morning-market geometry v1'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:kind+' market stall',rotation:[0,-Math.SQRT1_2,0,Math.SQRT1_2]}],meshes:[{primitives}],materials,accessors,bufferViews:views,buffers:[{byteLength:offset}]};
 const source=Buffer.from(JSON.stringify(gltf)),json=Buffer.concat([source,Buffer.alloc((4-source.length%4)%4,32)]),binary=Buffer.concat(chunks),header=Buffer.alloc(20),bin=Buffer.alloc(8);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bin.writeUInt32LE(binary.length,0);bin.writeUInt32LE(0x004e4942,4);
 return {buffer:Buffer.concat([header,json,bin,binary]),triangles:[...batches.values()].reduce((n,b)=>n+b.i.length/3,0),drawCalls:batches.size};
}
for(const kind of ['vegetables','fruit','tofu'])for(const style of ['canopy','table','ground']){const result=model(kind,style);fs.writeFileSync(fileURLToPath(new URL('../models/market-'+kind+(style==='canopy'?'':'-'+style)+'.glb',import.meta.url)),result.buffer);console.log(kind,JSON.stringify({triangles:result.triangles,drawCalls:result.drawCalls,bytes:result.buffer.length}));}
