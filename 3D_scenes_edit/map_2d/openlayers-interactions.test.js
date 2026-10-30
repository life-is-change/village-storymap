const test = require("node:test");
const assert = require("node:assert/strict");

const Interactions = require("./openlayers-interactions");

test('width changes and undo keep 2D road editing bound to the visible current geometry',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ctx={setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../assets/vendor/openlayers-10.8.0/ol.js'),'utf8'),ctx);const ol=ctx.ol;
 const added=[],map={isRendered:()=>false,getView:()=>({getProjection:()=>ol.proj.get('EPSG:4326')}),addInteraction(i){added.push(i);i.getMap=()=>map;},removeInteraction(){}};
 const adapter=require('./scene-layer-adapter').createSceneLayerAdapter({ol,map,projection:'EPSG:4326'}),doc=require('../domain/scene-document').create({projectId:'p'});
 doc.objects=[{id:'road',kind:'line',category:'path',layerId:'design',geometry:{type:'LineString',coordinates:[[114,23],[114.001,23],[114.002,23]]},properties:{widthM:4}}];
 const c=require('./scene-editor-controller').createSceneEditorController({adapter,history:require('../domain/scene-commands').createHistory(doc),geometryRules:require('../domain/geometry-rules'),idFactory:()=> 'x'});c.select(['road']);
 const bridge=Interactions.createOpenLayersInteractions({ol,map,source:adapter.getSource(),layer:adapter.getLayer(),projection:'EPSG:4326',getSelectedIds:()=>c.getState().selectedIds,onGeometryChange(id,geometry){c.select([id]);return c.updateSelection({geometry});}});bridge.activate('edit-nodes');const held=added[0].getFeatures().getArray()[0];
 c.updateSelection({geometry:{type:'LineString',coordinates:[[114,23],[114.001,23.001],[114.002,23]]}});c.updateSelection({properties:{widthM:8}});
 assert.equal(held,adapter.getSource().getFeatures()[0]);assert.equal(held.get('sceneWidthM'),8);c.undo();c.undo();assert.equal(held.getGeometry().getCoordinates()[1][1],23);
 const coordinates=held.getGeometry().getCoordinates();coordinates[2][1]=23.0002;held.getGeometry().setCoordinates(coordinates);added[1].dispatchEvent({type:'modifyend',features:added[0].getFeatures()});
 assert.equal(c.getState().document.objects[0].geometry.coordinates[1][1],23);assert.equal(c.getState().document.objects[0].geometry.coordinates[2][1],23.0002);bridge.dispose();
});

test('rejected 2D drawings keep their vertices with the actual bundled OpenLayers implementation',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ctx={setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../assets/vendor/openlayers-10.8.0/ol.js'),'utf8'),ctx);
 const ol=ctx.ol,added=[],map={getView:()=>({getProjection:()=>ol.proj.get('EPSG:4326')}),addInteraction(i){added.push(i);i.getMap=()=>map;},removeInteraction(){}};
 const bridge=Interactions.createOpenLayersInteractions({ol,map,source:new ol.source.Vector(),layer:{},projection:'EPSG:4326',onCreate:()=>({ok:false,code:'OUTSIDE_BOUNDARY'})});
 bridge.activate('draw-line');const draw=added[0];draw.appendCoordinates([[114,30],[114.001,30]]);
 assert.equal(bridge.finishDrawing(),false);assert.ok(draw.getOverlay().getSource().getFeatures().length>0,'the failed sketch remains visible');bridge.dispose();
});

class Interaction {
  constructor(options) { this.options = options; this.listeners = {}; }
  on(name, listener) { this.listeners[name] = listener; }
  emit(name, event) { this.listeners[name]?.(event); }
}

test('move and node editing inherit the current range selection before a drag',()=>{
 const features=[],added=[],feature={get:key=>key==='sceneObjectId'?'selection-boundary':'geometry'};
 class Select extends Interaction{getFeatures(){return {push:f=>features.push(f),getArray:()=>features};}}
 const ol={interaction:{Select,Translate:Interaction,Modify:Interaction},format:{GeoJSON:class{}}};
 const bridge=Interactions.createOpenLayersInteractions({ol,map:{addInteraction:i=>added.push(i),removeInteraction(){}},source:{getFeatures:()=>[feature]},layer:{},getSelectedIds:()=>['selection-boundary']});
 bridge.activate('move');assert.equal(features[0],feature);assert.equal(added[1].options.features.getArray()[0],feature);
});

test("activates draw tools and returns WGS84 geometry without retaining temporary features", () => {
  const added = [];
  const removed = [];
  const created = [];
  const source = { removeFeature: (feature) => removed.push(feature) };
  const map = { addInteraction: (value) => added.push(value), removeInteraction: (value) => removed.push(value) };
  const ol = { interaction: { Draw: Interaction, Snap: Interaction }, geom: {}, format: { GeoJSON: class { writeGeometryObject() { return { type: "LineString", coordinates: [[114, 30], [114.1, 30.1]] }; } } } };
  ol.interaction.Draw.createBox = () => "box";
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source, layer: {}, projection: "EPSG:3857", onCreate: (tool, geometry) => created.push([tool, geometry]) });
  bridge.activate("draw-line");
  assert.equal(added[0].options.source,undefined,'temporary draw features must not be inserted after canonical document rendering');
  added[0].emit("drawend", { feature: { getGeometry: () => ({}) } });
  assert.equal(added[1] instanceof Interaction, true);
  assert.deepEqual(created, [["draw-line", { type: "LineString", coordinates: [[114, 30], [114.1, 30.1]] }]]);
  assert.equal(removed.length, 1);
  bridge.activate("draw-rectangle");
  assert.equal(added[2].options.geometryFunction, "box");
  bridge.dispose();
  assert.equal(removed.includes(added[2]), true);
});

test("select and translate emit canonical object ids and updated geometry", () => {
  const added = [];
  const selections = [];
  const changes = [];
  const collection = { getArray: () => [{ get: (key) => key === "sceneObjectId" ? "o1" : "geometry", getGeometry: () => ({}) }] };
  class Select extends Interaction { getFeatures() { return collection; } }
  const map = { addInteraction: (value) => added.push(value), removeInteraction() {} };
  const ol = {
    interaction: { Select, Translate: Interaction, Modify: Interaction },
    format: { GeoJSON: class { writeGeometryObject() { return { type: "Point", coordinates: [114, 30] }; } } }
  };
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source: {}, layer: {}, onSelect: (ids) => selections.push(ids), onGeometryChange: (id, geometry) => changes.push([id, geometry]) });
  bridge.activate("move");
  added[0].emit("select", {});
  added[1].emit("translateend", {});
  assert.deepEqual(selections, [["o1"]]);
  assert.deepEqual(changes, [["o1", { type: "Point", coordinates: [114, 30] }]]);
});

test("geometry edits use the projection reported by the map view", () => {
  const added = [];
  let writeOptions = null;
  const collection = { getArray: () => [{ get: (key) => key === "sceneObjectId" ? "o1" : "geometry", getGeometry: () => ({}) }] };
  class Select extends Interaction { getFeatures() { return collection; } }
  const map = {
    addInteraction: (value) => added.push(value), removeInteraction() {},
    getView() { return { getProjection: () => ({ getCode: () => "EPSG:4326" }) }; }
  };
  const ol = {
    interaction: { Select, Translate: Interaction },
    format: { GeoJSON: class {
      writeGeometryObject(_geometry, options) {
        writeOptions = options;
        return { type: "Point", coordinates: [114, 30] };
      }
    } }
  };
  const bridge = Interactions.createOpenLayersInteractions({ ol, map, source: {}, layer: {}, onGeometryChange() {} });
  bridge.activate("move");
  added[1].emit("translateend", {});
  assert.deepEqual(writeOptions, { dataProjection: "EPSG:4326", featureProjection: "EPSG:4326" });
});
