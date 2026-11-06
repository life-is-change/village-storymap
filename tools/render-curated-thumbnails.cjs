// Offline CPU rendering; uses the model processor's existing dependencies, no browser/CDN/GPU required.
const fs=require('node:fs'),path=require('node:path');
const {NodeIO}=require('./model-processor/node_modules/@gltf-transform/core');
const {ALL_EXTENSIONS}=require('./model-processor/node_modules/@gltf-transform/extensions');
const sharp=require('./model-processor/node_modules/sharp');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'3D_scenes_edit/assets/curated');
const catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'))),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),meshes=new Map();
function point(m,p){return [0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]);}
async function mesh(asset){
 const doc=await io.read(path.join(root,asset.url.split('?')[0])),textures=new Map(),faces=[];
 for(const tex of doc.getRoot().listTextures())if(tex.getImage())textures.set(tex,await sharp(tex.getImage()).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
 for(const node of doc.getRoot().listNodes()){
  const m=node.getWorldMatrix();for(const primitive of node.getMesh()?.listPrimitives()||[]){
   const pos=primitive.getAttribute('POSITION'),uv=primitive.getAttribute('TEXCOORD_0'),index=primitive.getIndices(),material=primitive.getMaterial();if(!pos)continue;
   const color=material?.getBaseColorFactor()||[.55,.65,.5,1],texture=textures.get(material?.getBaseColorTexture());
   const count=index?.getCount()||pos.getCount();
   for(let i=0;i+2<count;i+=3){
    const ids=[0,1,2].map(k=>index?index.getScalar(i+k):i+k),vertices=ids.map(id=>point(m,pos.getElement(id,[])));
    let rgb=color.slice(0,3).map(n=>n*255);
    if(texture&&uv){const coords=ids.map(id=>uv.getElement(id,[]));const u=coords.reduce((s,p)=>s+p[0],0)/3,v=coords.reduce((s,p)=>s+p[1],0)/3;
     const x=Math.min(texture.info.width-1,Math.max(0,Math.floor(u*texture.info.width))),y=Math.min(texture.info.height-1,Math.max(0,Math.floor(v*texture.info.height))),at=(y*texture.info.width+x)*4;
     rgb=rgb.map((n,k)=>n*texture.data[at+k]/255);
    }
    faces.push({vertices,rgb});
   }
  }
 }
 return faces;
}
async function render(faces,file,top=false){
 const project=([x,y,z])=>top?[x,z]:[(x-z)*.707,(x+z)*.354-y*.866];
 const projected=faces.map(f=>({...f,points:f.vertices.map(project),depth:f.vertices.reduce((s,p)=>s+(top?p[1]:p[0]+p[1]+p[2]),0)/3})).sort((a,b)=>a.depth-b.depth);
 const points=projected.flatMap(f=>f.points),min=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1].map(k=>Math.max(...points.map(p=>p[k])));
 const w=160,h=top?160:128,scale=Math.min((w-16)/(max[0]-min[0]||1),(h-16)/(max[1]-min[1]||1));
 const polygons=projected.map(f=>{
  const [a,b,c]=f.vertices,u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1;
  const shade=top?1:.7+.3*Math.abs((normal[0]*.3+normal[1]*.8+normal[2]*.5)/length);
  const color=`rgb(${f.rgb.map(n=>Math.round(Math.max(0,Math.min(255,n*shade)))).join(',')})`;
  return `<polygon points="${f.points.map(p=>p.map((n,k)=>((n-(min[k]+max[k])/2)*scale+(k?h:w)/2).toFixed(2)).join(',')).join(' ')}" fill="${color}" stroke="${color}" stroke-width=".2"/>`;
 }).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${polygons}</svg>`;
 await sharp(Buffer.from(svg)).png().toFile(file);
}
async function main(){
 fs.mkdirSync(path.join(dir,'thumbnails'),{recursive:true});
 for(const a of catalog.assets.filter(a=>a.kind!=='group'))meshes.set(a.id,await mesh(a));
 for(const a of catalog.assets){
  const key=a.id.replace('seed:curated:','');let faces=meshes.get(a.id);
  if(a.kind==='group')faces=a.children.flatMap(child=>{
   const angle=-child.headingDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
   return meshes.get(child.assetRef).map(f=>({...f,vertices:f.vertices.map(([x,y,z])=>[child.offsetM[0]+child.scale*(c*x+s*z),child.heightOffsetM+child.scale*y,-child.offsetM[1]+child.scale*(-s*x+c*z)])}));
  });
  await render(faces,path.join(dir,'thumbnails',`${key}.png`));
  a.thumbnailUrl=`3D_scenes_edit/assets/curated/thumbnails/${key}.png?v=20261105`;
  if(a.kind!=='group'){await render(faces,path.join(dir,'thumbnails',`${key}-top.png`),true);a.topViewUrl=`3D_scenes_edit/assets/curated/thumbnails/${key}-top.png?v=20261105`;}
 }
 fs.writeFileSync(path.join(dir,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
 console.log(`Rendered ${catalog.assets.length} thumbnails and 100 top views.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
