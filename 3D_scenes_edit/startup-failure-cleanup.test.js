const test=require('node:test'),assert=require('node:assert/strict');
const Studio=require('./index'),Document=require('./domain/scene-document');
test('failed initial 3D readiness releases studio layers, interactions and panel handlers before retry',async()=>{
 const listeners=new Map(),counts={mounted:0,disposed:0,interaction:0,preview:0};
 const root={innerHTML:'',dataset:{},setAttribute(){},focus(){},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const context={userId:'u',teachingProjectId:'p',courseId:'c',villageId:'v',groupId:'g',spaceId:'s',baselineRevision:1,baselineFeatures:[],projectId:'existing',seedAssets:[]};
 const document=Document.create({projectId:'existing',villageId:'v',groupId:'g',spaceId:'s',baselineRevision:1});
 const options={root,context,services:{
 client:{loadProject:async()=>({ok:true,data:document}),saveDraft:async()=>({ok:true,data:{}})},
 localStore:{read:()=>null,write(){},remove(){}},
 adapter:{mount(){counts.mounted++;},render(){},dispose(){counts.disposed++;}},
 preview:{render:async()=>{},dispose(){counts.preview++;}},
 interactions:{activate(){},dispose(){counts.interaction++;}}
 },onModeChange:async()=>{throw Error('3D unavailable');}};
 await assert.rejects(Studio.create(options),/3D unavailable/);
 assert.equal(counts.disposed,1);assert.equal(counts.interaction,1);assert.equal(counts.preview,1);assert.equal(listeners.size,0);
 const retry=await Studio.create({...options,onModeChange:async()=>{}});
 assert.equal(retry.ok,true);retry.dispose();assert.equal(counts.mounted,2);assert.equal(counts.disposed,2);assert.equal(listeners.size,0);
});
