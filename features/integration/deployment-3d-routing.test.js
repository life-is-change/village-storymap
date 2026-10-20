const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-3d.js','utf8');
function fn(name,sandbox){const start=source.indexOf('  async function '+name+'('),end=source.indexOf('\n  function ',start+10),asyncEnd=source.indexOf('\n  async function ',start+10);return vm.runInNewContext(source.slice(start,Math.min(...[end,asyncEnd].filter(v=>v>=0)))+';'+name,sandbox);}
test('real 3D building reader uses local resolved geometry without source query',async()=>{
 const calls=[],scope={teachingProjectId:'p',villageId:'v'};const sandbox={window:{VillageBusinessServices:{planning:{execute:async(a,p)=>(calls.push([a,p]),[{object_code:'B'}])}}},supabaseClient:{from(){throw Error('SOURCE_QUERY');}},getActualLinkedSpaceIdFor3D:()=> 's',getActiveVillage3DContext:()=>scope,getLinked2DSpaceFor3D:()=>({spaceType:'formal_shared'})};
 assert.equal((await fn('list3DBuildingsFromDb',sandbox)())[0].object_code,'B');assert.equal(calls[0][0],'planning.listFeatures');assert.equal(calls[0][1].layerKey,'building');
});
