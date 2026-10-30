const test=require('node:test'),assert=require('node:assert/strict');
const Workspace=require('./workspace'),Adapter=require('./plan-adapter'),{fixture}=require('./tests/fixtures');

test('workflow starts with a separate simulation range and bottom palette requires a selected object',()=>{
 const f=fixture();const flow=Workspace.workflow(f.cfg,'area');
 assert.match(flow,/模拟范围/);assert.match(flow,/data-step="roads"/);assert.match(flow,/data-step="people"/);
 assert.match(Workspace.palette('living','',f.cfg),/disabled/);
 const cards=Workspace.palette('living','baseline:house',f.cfg);assert.match(cards,/data-type="home"/);assert.match(cards,/村民住宅/);assert.match(cards,/<svg/);
});

test('connection report identifies the reason and exposes per-facility location and entrance actions',()=>{
 const f=fixture();f.context.baselineFeatures[0].geometry=require('./tests/fixtures').polygon(113,23.0005);
 const report=Adapter.compile(f.document,f.context,f.cfg),html=Workspace.connectionReport(report);
 assert.match(html,/距离过远/);assert.match(html,/26米/);assert.match(html,/data-connection-focus="baseline:house"/);
 assert.match(html,/data-connection-entry="baseline:house"/);assert.match(html,/虚线/);
});
test('the empty-component design boundary has an explicit overall park action and startup instructions',()=>{
 const f=fixture();f.document.objects=[];f.document.selectionBoundary={type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23.001],[113,23]]]};
 const items=Adapter.catalog(f.document,f.context),html=Workspace.facilityForm(f.cfg,items,'','living');
 assert.match(html,/data-do="boundary-park"/);assert.match(html,/不需要先放置组件/);
 const guide=Workspace.startupGuide(f.cfg,items,null,true);assert.match(guide,/村口/);assert.match(guide,/6位居民/);assert.match(guide,/检查并进入运行/);
});
test('defining the boundary preserves building uses and check-to-run never starts with a missing entry',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),f=fixture(),events={};
 f.document.selectionBoundary=require('./tests/fixtures').polygon(113.00045,23.00012,.0004,.0003);
 f.cfg.entry=null;f.document.metadata.simulation=f.cfg;const oldHome=JSON.stringify(f.cfg.assignments[0]);let saves=0;
 const host={innerHTML:'',scrollTop:0,setAttribute(){},addEventListener(k,fn){events[k]=fn;},querySelector:()=>({}),querySelectorAll:()=>[],remove(){}};
 const overlay={setSources(){},setPlan(){},cancelPick(){},dispose(){},clear(){}};
 const sandbox={VillagePlanAdapter:Adapter,VillagePlanSession:require('./session'),VillagePlanOverlay:{create:()=>overlay},VillageScene:require('../domain/scene'),VillageCatalog:require('../views/catalog'),document:{createElement:()=>host,body:{appendChild(){}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./workspace'),'utf8'),sandbox);
 const workspace=sandbox.VillageSimulationWorkspace.open({readDocument:()=>f.document,context:f.context,environment:{},writeConfig:c=>f.document.metadata.simulation=c,save:async()=>{saves++;return {ok:true};}});
 assert.match(host.innerHTML,/aria-label="准备模拟的五个步骤"/);
 const click=action=>events.click({target:{closest:()=>({dataset:{do:action}})}});
 await click('start');assert.equal(saves,0);assert.match(host.innerHTML,/请先划定模拟范围/);
 const scoped=workspace.session.state().config;scoped.area=require('./tests/fixtures').polygon(112.9998,22.9999,.0014,.0007);scoped.entryMode='manual';workspace.session.update(scoped);
 await click('boundary-park');assert.equal(JSON.stringify(workspace.session.state().config.assignments[0]),oldHome);assert.equal(workspace.session.state().config.assignments.find(a=>a.key==='boundary:selection').type,'park');
 await click('check-run');assert.equal(workspace.session.state().snapshot,null);assert.equal(saves,0);assert.match(host.innerHTML,/请在地图上设置村口/);
 const c=workspace.session.state().config;c.entry=[112.9999,23];workspace.session.update(c);
 await click('check-run');assert.match(host.innerHTML,/data-tab="run" aria-pressed="true"/);assert.equal(workspace.session.state().snapshot,null);
 await click('start');assert.equal(saves,1);assert.ok(workspace.session.state().snapshot);workspace.dispose();
});
test('checking a valid plan leaves its entrances and connectivity overlay visible until input changes',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),f=fixture(),events={},paint=[],focused=[],picks=[];f.document.metadata.simulation=f.cfg;let edits=0,writes=0;
 f.document.objects.push({id:'alley',kind:'line',category:'path',geometry:{type:'LineString',coordinates:[[113,23],[113,23.0001]]},properties:{}});
 const host={innerHTML:'',scrollTop:0,setAttribute(){},addEventListener(k,fn){events[k]=fn;},querySelector:()=>({}),querySelectorAll:()=>[],remove(){}};
 const overlay={setSources(){paint.push('sources');},setPlan(){paint.push('plan');},focus(item){focused.push(item);},pick(key){picks.push(key);},cancelPick(){},dispose(){},clear(){}};
 const sandbox={VillagePlanAdapter:Adapter,VillagePlanSession:require('./session'),VillagePlanOverlay:{create:()=>overlay},VillageScene:require('../domain/scene'),VillageCatalog:require('../views/catalog'),document:{createElement:()=>host,body:{appendChild(){}}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./workspace'),'utf8'),sandbox);
 const workspace=sandbox.VillageSimulationWorkspace.open({readDocument:()=>f.document,context:f.context,environment:{},writeConfig(){writes++;},save:async()=>({ok:true}),onEditRoad(){edits++;}});
 assert.equal(writes,0);assert.ok(!workspace.session.state().config.roads.includes('object:alley'));
 await events.click({target:{closest:()=>({dataset:{step:'roads'}})}});
 assert.match(host.innerHTML,/data-do="add-paths"/);
 await events.click({target:{closest:()=>({dataset:{do:'add-paths'}})}});
 assert.ok(workspace.session.state().config.roads.includes('object:alley'));
 assert.match(host.innerHTML,/data-do="entry-focus"/);
 await events.click({target:{closest:()=>({dataset:{do:'entry-focus'}})}});
 assert.deepEqual(Array.from(focused[0].geometry.coordinates),f.cfg.entry);assert.equal(focused[0].geometry.type,'Point');
 await events.click({target:{closest:()=>({dataset:{do:'check'}})}});
 assert.equal(paint.at(-1),'plan');
 await events.click({target:{closest:()=>({dataset:{connectionFocus:'baseline:house'}})}});
 assert.equal(focused.at(-1).geometry.type,'Point');
 await events.click({target:{closest:()=>({dataset:{connectionEntry:'baseline:house'}})}});
 assert.equal(picks.at(-1),'baseline:house');
 await events.click({target:{closest:()=>({dataset:{do:'draw-road'}})}});assert.equal(edits,1);workspace.dispose();
});
test('empty source catalog disables assignment instead of creating an empty source key',()=>{
 const f=fixture(),html=Workspace.facilityForm(f.cfg,[],'','living');
 assert.match(html,/尚未识别到建筑/);assert.doesNotMatch(html,/data-type=/);
 assert.doesNotMatch(html,/data-field="type"/);
});
test('function editor uses the same categorized icons and previews as the virtual village',()=>{
 const f=fixture(),html=Workspace.facilityForm(f.cfg,Adapter.catalog(f.document,f.context),'baseline:house','care');
 assert.match(html,/data-category="care"/);assert.match(html,/data-type="kindergarten"/);
 assert.match(html,/<svg/);assert.match(html,/地图点选/);assert.match(html,/现有建筑/);
});
test('unmatched saved facility references remain visible and can be explicitly removed',()=>{
 const f=fixture();f.cfg.assignments[0].key='baseline:deleted';
 const html=Workspace.facilityForm(f.cfg,Adapter.catalog(f.document,f.context),'','living');
 assert.match(html,/待校核的旧设施/);assert.match(html,/data-remove-key="baseline:deleted"/);
});
test('deleting the last design boundary still permits removal of its stale park assignment',()=>{
 const f=fixture();f.document.objects=[];f.context.baselineFeatures=f.context.baselineFeatures.filter(i=>i.layerKey==='road');
 f.cfg.settings.population=0;f.cfg.assignments=[Adapter.assignment('boundary:selection','park')];
 const html=Workspace.facilityForm(f.cfg,Adapter.catalog(f.document,f.context),'','public');
 assert.match(html,/尚未识别到建筑/);assert.match(html,/data-remove-key="boundary:selection"/);
});
