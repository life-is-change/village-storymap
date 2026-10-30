const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const Scene=require('./scene');const Editor=fs.existsSync(__dirname+'/editor.js')?require('./editor'):{};
test('editing, undo and redo restore spatial changes while revisions increase',()=>{
  assert.equal(typeof Editor.createEditor,'function');const editor=Editor.createEditor(Scene.createVillage());
  editor.apply({type:'update-building',id:'home-1',patch:{name:'我的民宿',type:'inn'}});
  assert.equal(editor.scene.buildings[0].type,'inn');assert.equal(editor.scene.revision,1);
  editor.undo();assert.equal(editor.scene.buildings[0].type,'home');assert.equal(editor.scene.revision,2);
  editor.redo();assert.equal(editor.scene.buildings[0].type,'inn');assert.equal(editor.scene.revision,3);
});
test('overlap, water and out-of-bound placement do not mutate the design',()=>{
  assert.equal(typeof Editor.createEditor,'function');const editor=Editor.createEditor(Scene.createVillage());
  for(const [x,y] of [[65,82],[452,180],[-10,20],[150,110]]){
    assert.throws(()=>editor.apply({type:'add-building',building:Scene.createBuilding('inn',x,y,'new')}));
    assert.equal(editor.scene.revision,0);
  }
  editor.apply({type:'add-building',building:Scene.createBuilding('inn',90,45,'new')});
  assert.ok(editor.scene.buildings.some(b=>b.id==='new'));
});
test('road removal and undo restore actual routing objects',()=>{
  assert.equal(typeof Editor.createEditor,'function');const editor=Editor.createEditor(Scene.createVillage());
  editor.apply({type:'remove-road',id:'road-main'});assert.equal(editor.scene.roads.length,4);
  editor.undo();assert.equal(editor.scene.roads.length,5);
});
test('a road cannot cross water just because both endpoints are on land',()=>{
  const scene=Scene.createVillage();scene.zones=[{id:'pond',kind:'water',name:'池塘',points:[[195,40],[220,40],[220,65],[195,65]]}];
  const editor=Editor.createEditor(scene);
  assert.throws(()=>editor.apply({type:'add-road',road:{id:'cross',kind:'path',width:3,points:[[175,52],[240,52]]}}));
});
