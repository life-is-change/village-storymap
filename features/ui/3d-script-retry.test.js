const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
function harness(failId){
 const elements=new Map(),loads=[],window={},document={getElementById:id=>elements.get(id),createElement:()=>{
  const listeners={};return {dataset:{},addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),
   remove(){elements.delete(this.id);},dispatch(name){this['on'+name]?.();for(const fn of listeners[name]||[])fn();}};
 }};
 let failed=false;
 document.head={appendChild(node){elements.set(node.id,node);}};
 document.body={appendChild(node){elements.set(node.id,node);loads.push(node.id);queueMicrotask(()=>{
  if(node.id===failId&&!failed){failed=true;node.dispatch('error');return;}
  if(node.id==='cesium-runtime-script')window.Cesium={};
  if(node.id==='village-3d-script')window.Village3D={enter:async()=>{}};
  node.dispatch('load');
 });}};
 const context={window,document};vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('let village3DLoadPromise = null;'),app.indexOf('\nfunction getSceneStudioActiveView()'))+';this.load=ensureVillage3DLoaded;this.script=loadScriptOnce;',context);
 return {context,loads,window,elements};
}
for(const failed of ['cesium-runtime-script','village-3d-script'])test('3D entry recovers after one failed '+failed,async()=>{
 const h=harness(failed);await assert.rejects(h.context.load(),/脚本加载失败/);
 const api=await h.context.load();assert.equal(api,h.window.Village3D);
 assert.equal(h.loads.filter(id=>id===failed).length,2);
 if(failed==='village-3d-script')assert.equal(h.loads.filter(id=>id==='cesium-runtime-script').length,1);
});
test('simultaneous first 3D entries share each script request',async()=>{
 const h=harness();const [a,b]=await Promise.all([h.context.load(),h.context.load()]);
 assert.equal(a,b);assert.equal(h.loads.length,4);assert.equal(new Set(h.loads).size,4);
});
