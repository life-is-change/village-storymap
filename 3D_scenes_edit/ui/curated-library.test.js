const test=require('node:test'),assert=require('node:assert/strict');
const Panel=require('./scene-studio-panel'),Toolbar=require('./scene-studio-toolbar');
const catalog=require('../assets/curated/catalog.json').assets;
test('market group uses one site folder without duplicate nested group summaries',()=>{
 const group={id:'mg',name:'market',objectIds:['market','stall']};
 const objects=[{id:'market',groupId:'mg',kind:'surface',category:'activity-field',properties:{displayName:'market'}},{id:'stall',groupId:'mg',kind:'asset',category:'stall',properties:{siteId:'market',displayName:'stall'}}];
 const root={innerHTML:'',setAttribute(){},addEventListener(){},removeEventListener(){}};
 Panel.createSceneStudioPanel({root}).render(Panel.buildViewModel({phase:'editing',groups:[group],objects}));
 assert.doesNotMatch(root.innerHTML,/data-branch-id="group:mg"/);
 assert.match(root.innerHTML,/data-action="select-group" data-value="mg"/);
 assert.equal((root.innerHTML.match(/data-action="select-object" data-value="stall"/g)||[]).length,1);
});
function libraryCards(grouped) {
 const first=Panel.renderAssets(grouped,'all','','site');
 const groups=[...first.matchAll(/data-action="asset-group" data-value="([^"]+)"/g)].map(match=>match[1]);
 return groups.flatMap(group=>[...Panel.renderAssets(grouped,'all','',group).matchAll(/data-action="choose-asset" data-value="([^"]+)"/g)].map(match=>({id:match[1],group})));
}
test('each available asset has one home across the merged component sections',()=>{
 const assets=[...catalog,{id:'market-stall',category:'stall'}, {id:'meadow',category:'grass'}, {id:'water',category:'water'}, {id:'tree',category:'tree'}];
 const cards=libraryCards(Panel.groupAssets([...assets,assets[0]]));
 const ids=cards.map(card=>card.id);
 assert.equal(new Set(ids).size,ids.length,'an asset must not repeat across sections or duplicate input records');
 assert.deepEqual([...ids].sort(),assets.filter(asset=>asset.catalogCategory!=='paving-module').map(asset=>asset.id).sort());
 assert.equal(cards.find(card=>card.id==='market-stall').group,'market');
 assert.equal(cards.find(card=>card.id==='meadow').group,cards.find(card=>card.id==='tree').group);
 assert.doesNotMatch(Panel.renderAssets(Panel.groupAssets(assets),'all','','site'),/data-action="asset-group" data-value="planting"/);
});
test('road and paving templates stay out of the add library without mutating saved scene objects or source assets',()=>{
 const roads=['path','paving','paving-module','curb'].map(category=>({id:'hidden-'+category,category,kind:'asset'}));
 roads.push({id:'hidden-road',category:'path',catalogCategory:'market-equipment',kind:'line'});
 const original=JSON.stringify(roads);
 const model=Panel.buildViewModel({phase:'editing',assets:[...catalog,...roads],objects:roads,selectedIds:['hidden-path']});
 const ids=libraryCards(model.sections.assets).map(card=>card.id);
 for(const road of roads)assert.ok(!ids.includes(road.id),road.id+' must be hidden');
 assert.ok(!ids.some(id=>catalog.find(asset=>asset.id===id)?.catalogCategory==='paving-module'));
 assert.equal(JSON.stringify(roads),original);
 assert.equal(model.sections.objects,roads);
 assert.equal(model.properties,roads[0]);
});
test('an empty scene opens component placement and choosing a combination never requests a range',()=>{
 const listeners={},actions=[];
 const root={innerHTML:'',setAttribute(){},addEventListener(name,listener){listeners[name]=listener;},removeEventListener(){}};
 const panel=Panel.createSceneStudioPanel({root,onAction(action){actions.push(action);}});
 const model=Panel.buildViewModel({phase:'editing',mode:'3d',objects:[],assets:catalog});
 panel.render(model);
 assert.match(root.innerHTML,/data-action="design-tool" data-value="components" aria-pressed="true"/);
 assert.match(root.innerHTML,/<option value="" selected>独立组件/);
 assert.match(root.innerHTML,/选择组件或场景组合，再点击地图放置/);
 listeners.click({target:{closest:()=>({dataset:{action:'asset-group',value:'combinations'}})}});
 const combo=catalog.find(asset=>asset.kind==='group');
 assert.match(root.innerHTML,new RegExp('data-action="choose-asset" data-value="'+combo.id+'"'));
 listeners.click({target:{closest:()=>({dataset:{action:'choose-asset',value:combo.id}})}});
 assert.deepEqual(actions.map(action=>({type:action.type,value:action.value})),[{type:'choose-asset',value:combo.id}]);
 assert.equal(model.placementSiteId,null);
});
test('library exposes scene combinations with child count, dimensions, attribution and separate expandable group rows',()=>{
 const grouped=Panel.groupAssets(catalog),html=Panel.renderAssets(grouped,'all','','combinations');
 assert.match(html,/老年活动角/);assert.match(html,/7 个组件/);assert.match(html,/素材来源与许可/);assert.match(html,/米/);
 const model=Panel.buildViewModel({phase:'editing',groups:[{id:'g',name:'测试组合',objectIds:['a','b']}],objects:[{id:'a',groupId:'g',kind:'asset',category:'bench',properties:{siteId:null}},{id:'b',groupId:'g',kind:'asset',category:'bench',properties:{siteId:null}}],selectedIds:['a','b']});
 const root={innerHTML:'',setAttribute(){},addEventListener(){},removeEventListener(){}};
 Panel.createSceneStudioPanel({root}).render(model);
 assert.match(root.innerHTML,/data-action="select-group"/);assert.match(root.innerHTML,/data-branch-id="group:g"/);
 assert.match(Toolbar.renderToolbarHtml(model),/data-action="ungroup"/);assert.match(Toolbar.renderToolbarHtml(model),/data-action="rotate-geometry"/);
});
