const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const scripts=['features/models/glb-normalization.js','features/models/model-residency.js','features/models/model-view-metrics.js','features/3d/render-quality.js',
 ...[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script defer src="(3D_scenes_edit\/[^"?]+)(?:\?[^"]*)?"/g)].map(m=>m[1])];
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><base href="/"><title>模型与组合 · 本地校验</title>
<link rel="stylesheet" href="assets/vendor/cesium-1.118.0/Widgets/widgets.css"><link rel="stylesheet" href="assets/vendor/openlayers-10.8.0/ol.css"><link rel="stylesheet" href="3D_scenes_edit/style.css">
<style>body{margin:0}.scene-studio-canvas{position:relative}#preview-map,#preview-globe{position:absolute;inset:0}#preview-checks{position:fixed;bottom:45px;left:12px;z-index:1500;background:white;padding:6px;border-radius:6px;font:12px system-ui;pointer-events:none}.cesium-viewer-bottom{display:none}</style>
<script>window.CESIUM_BASE_URL='/assets/vendor/cesium-1.118.0/';</script><script src="assets/vendor/cesium-1.118.0/Cesium.js"></script><script src="assets/vendor/openlayers-10.8.0/ol.js"></script>
${scripts.map(s=>`<script src="${s}"></script>`).join('\n')}</head><body><div id="studio" class="scene-studio-host"></div><output id="preview-checks">载入本地素材…</output><div id="preview-map"></div><div id="preview-globe"></div>
<button id="qa-oblique" style="position:fixed;bottom:44px;left:340px;z-index:1500">斜视检查模型</button><script>
(async()=>{
const origin=[113.5,23.1],G=SceneGeometryRulesModule,polygon={type:'Polygon',coordinates:[[[-55,-55],[55,-55],[55,55],[-55,55],[-55,-55]].map(p=>G.fromLocalMeters(p,origin))]};
const mapElement=document.getElementById('preview-map'),globeElement=document.getElementById('preview-globe');
const viewer=new Cesium.Viewer(globeElement,{baseLayer:false,terrainProvider:new Cesium.EllipsoidTerrainProvider(),animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,requestRenderMode:true});
viewer.scene.globe.baseColor=Cesium.Color.fromCssColorString('#e1e9df');viewer.scene.globe.enableLighting=false;
viewer.entities.add({polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(polygon.coordinates[0].flat()),material:Cesium.Color.fromCssColorString('#a7c9ae').withAlpha(.4),height:0}});
viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(origin[0],origin[1]-.0006,95),orientation:{heading:0,pitch:Cesium.Math.toRadians(-55),roll:0}});
const map=new ol.Map({target:mapElement,layers:[],view:new ol.View({center:ol.proj.fromLonLat(origin),zoom:19})});
const context={userId:'local-review',teachingProjectId:'local-review',courseId:'local-review',villageId:'20000000-0000-4000-8000-000000000001',groupId:'local-review',spaceId:'local-review',baselineRevision:0,baselineFeatures:[],villageBoundary:polygon,selectionBoundary:polygon,title:'模型与组合 · 本地校验'};
const key='curated-preview-document',project='10000000-0000-4000-8000-000000000001';
const client={async createProject(){return {ok:true,data:{id:project,revision:0}}},async loadProject(){return {ok:true,data:JSON.parse(localStorage.getItem(key))}},async findActiveProject(){return {ok:true,data:localStorage.getItem(key)?{id:project}:null}},async saveDraft(d){const copy=structuredClone(d);copy.revision++;localStorage.setItem(key,JSON.stringify(copy));return {ok:true,data:copy}},async listAssets(){return {ok:true,data:[]}},async listVersions(){return {ok:true,data:[]}}};
const previews={mapElement,globeElement};let currentMode='3d';
const app=await SceneEditStudio.create({root:document.getElementById('studio'),context,map,ol,ensure3D:async()=>({viewer,Cesium}),services:{client},
onPanelRender(model,root){const canvas=root.querySelector('.scene-studio-canvas');canvas.prepend(currentMode==='3d'?globeElement:mapElement);const other=currentMode==='3d'?mapElement:globeElement;other.style.display='none';(currentMode==='3d'?globeElement:mapElement).style.display='block';viewer.resize();map.updateSize();const groups=model.groups.length;document.getElementById('preview-checks').textContent='本地校验 · '+model.sections.objects.length+' 个对象 · '+groups+' 个组合 · '+model.save.label;},
onModeChange(mode){currentMode=mode},onStatus(s){document.getElementById('preview-checks').textContent=s.message||s.code;}});
if(!app.ok)throw Error(JSON.stringify(app));
document.getElementById('qa-oblique').onclick=()=>{const objects=app.getDocument().objects.filter(o=>o.geometry.type==='Point');const center=objects.length?[0,1].map(k=>objects.reduce((s,o)=>s+o.geometry.coordinates[k],0)/objects.length):origin;viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(...center,1),new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35),Cesium.Math.toRadians(-35),18));viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);viewer.scene.requestRender();};
})().catch(e=>{document.getElementById('preview-checks').textContent=e.stack;});
</script></body></html>`;
fs.mkdirSync(path.join(root,'tmp'),{recursive:true});fs.writeFileSync(path.join(root,'tmp/curated-preview.html'),html);console.log('Preview: http://127.0.0.1:5512/tmp/curated-preview.html');
