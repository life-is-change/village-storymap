// Read-only, loopback-only asset QA server. No API proxy, authentication or production data.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=fs.realpathSync(path.join(__dirname,'..')),port=Number(process.argv[2]||5512);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.jpg':'image/jpeg','.gif':'image/gif','.md':'text/plain'};
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port),route=decodeURIComponent(url.pathname);
 if(!['GET','HEAD'].includes(req.method)||route.includes('..')||route.includes('\\')||!(/^\/(assets\/vendor\/|3D_scenes_edit\/|features\/(models|3d)\/)/.test(route)||route==='/tmp/curated-preview.html'))return res.writeHead(404).end();
 const file=await fs.promises.realpath(path.join(root,route));if(!file.startsWith(root+path.sep))return res.writeHead(404).end();
 const type=types[path.extname(file)];if(!type)return res.writeHead(404).end();
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
 }catch{res.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log('Asset QA: http://127.0.0.1:'+port+'/tmp/curated-preview.html'));
