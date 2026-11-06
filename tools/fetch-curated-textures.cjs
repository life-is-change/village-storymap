// Recover only missing textures from the same public Kenney source recorded by the original library.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Glb=require('../features/models/glb-normalization');
async function main(){
 const root=path.resolve(process.argv[2]||'E:/GLB_model'),out=path.resolve(__dirname,'../3D_scenes_edit/assets/curated/source-textures');
 const tasks=new Map();
 for(const a of JSON.parse(fs.readFileSync(path.join(root,'catalog/asset_catalog.json'))).assets){
  for(const image of Glb.readGlb(fs.readFileSync(path.join(root,a.path))).json.images||[]){
   if(!image.uri||image.uri.startsWith('data:'))continue;
   if(!a.path.startsWith('models/kenney/')||!/^Textures\/[\w-]+\.png$/.test(image.uri))throw Error('Unexpected texture source');
   const kit=a.path.split('/')[2],key=`${kit}/${path.basename(image.uri)}`;
   tasks.set(key,`https://raw.githubusercontent.com/shorepine/kenney/main/3d/${kit}/${image.uri}`);
  }
 }
 const sources=[];
 for(const [key,url] of tasks){const p=path.join(out,key);let b;
  if(fs.existsSync(p))b=fs.readFileSync(p);else{const res=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error(`${res.status} ${url}`);b=Buffer.from(await res.arrayBuffer());if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}
  sources.push({file:key,url,sha256:crypto.createHash('sha256').update(b).digest('hex')});console.log(key+' OK');
 }
 fs.writeFileSync(path.join(out,'sources.json'),JSON.stringify({license:'CC0 1.0',creator:'Kenney',textures:sources},null,2)+'\n');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
