const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-3d.js','utf8');
const body=source.slice(source.indexOf('  function getWorldFileUrl('),source.indexOf('  async function ensureBasemapGeorefResolved('));
for(const url of ['blob:https://8.148.248.237/10000000-0000-4000-8000-000000000001','data:image/png;base64,AA=='])test(`opaque image URLs never produce a guessed world file: ${url.split(':')[0]}`,async()=>{
 let fetches=0,images=0;const s={fetch:async()=>{fetches++;throw Error('unsupported world file');},Image:function(){images++;},console:{warn(){}}};
 const resolve=vm.runInNewContext(body+';tryResolveBasemapGeorefFromWorldFile',s);
 assert.equal(await resolve(url),null);assert.equal(fetches,0);assert.equal(images,0);
});
test('ordinary relative orthophoto URLs retain their world-file lookup',()=>{
 const world=vm.runInNewContext(body+';getWorldFileUrl',{});assert.equal(world('data/orthophoto.png'),'data/orthophoto.pgw');
});
