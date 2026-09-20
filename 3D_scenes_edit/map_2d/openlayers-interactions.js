(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneOpenLayersInteractionsModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createOpenLayersInteractions(options) {
    const ol = options.ol;
    const map = options.map;
    const source = options.source;
    const layer = options.layer;
    const projection = options.projection || "EPSG:3857";
    const onSelect = options.onSelect || function () {};
    const onCreate = options.onCreate || function () {};
    const onGeometryChange = options.onGeometryChange || function () {};
    const onMeasure = options.onMeasure || function () {};
    const active = [];
    const geojson = new ol.format.GeoJSON();

    function value(feature, key) {
      return typeof feature.get === "function" ? feature.get(key) : feature.values?.[key];
    }

    function geometryObject(feature) {
      return geojson.writeGeometryObject(feature.getGeometry(), { dataProjection: "EPSG:4326", featureProjection: projection });
    }

    function removeActive() {
      while (active.length) map.removeInteraction(active.pop());
    }

    function add(interaction) {
      active.push(interaction);
      map.addInteraction(interaction);
      return interaction;
    }

    function selectedObjectFeatures(collection) {
      const seen = new Set();
      return (collection?.getArray?.() || []).filter((feature) => {
        const id = value(feature, "sceneObjectId");
        const role = value(feature, "sceneRole");
        if (!id || (role && role !== "geometry") || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    function activateSelect(tool) {
      const select = add(new ol.interaction.Select({ layers: [layer], hitTolerance: 7, multi: true }));
      select.on("select", () => onSelect(selectedObjectFeatures(select.getFeatures()).map((feature) => value(feature, "sceneObjectId"))));
      if (tool === "move") {
        const translate = add(new ol.interaction.Translate({ features: select.getFeatures() }));
        translate.on("translateend", () => {
          for (const feature of selectedObjectFeatures(select.getFeatures())) onGeometryChange(value(feature, "sceneObjectId"), geometryObject(feature));
        });
      } else if (tool === "edit-nodes") {
        const modify = add(new ol.interaction.Modify({ features: select.getFeatures() }));
        modify.on("modifyend", () => {
          for (const feature of selectedObjectFeatures(select.getFeatures())) onGeometryChange(value(feature, "sceneObjectId"), geometryObject(feature));
        });
      }
      if ((tool === "move" || tool === "edit-nodes") && ol.interaction.Snap) add(new ol.interaction.Snap({ source }));
    }

    function activateBoxSelect() {
      if (!ol.interaction.DragBox) return activateSelect("select");
      const box = add(new ol.interaction.DragBox());
      box.on("boxend", () => {
        const extent = box.getGeometry().getExtent();
        const ids = [];
        source.forEachFeatureIntersectingExtent(extent, (feature) => {
          const id = value(feature, "sceneObjectId");
          if (id && value(feature, "sceneRole") !== "footprint") ids.push(id);
        });
        onSelect([...new Set(ids)]);
      });
    }

    function activateDraw(tool) {
      const types = { "draw-line": "LineString", "draw-surface": "Polygon", "draw-rectangle": "Circle", "place-asset": "Point", measure: "LineString" };
      const drawOptions = { source, type: types[tool] };
      if (tool === "draw-rectangle") drawOptions.geometryFunction = ol.interaction.Draw.createBox();
      const draw = add(new ol.interaction.Draw(drawOptions));
      draw.on("drawend", (event) => {
        const geometry = geometryObject(event.feature);
        source.removeFeature?.(event.feature);
        if (tool === "measure") onMeasure(geometry);
        else onCreate(tool, geometry);
      });
      if (ol.interaction.Snap) add(new ol.interaction.Snap({ source }));
    }

    return {
      activate(tool) {
        removeActive();
        if (tool === "select" || tool === "move" || tool === "edit-nodes" || tool === "rotate" || tool === "scale") activateSelect(tool);
        else if (tool === "box-select") activateBoxSelect();
        else if (["draw-line", "draw-surface", "draw-rectangle", "place-asset", "measure"].includes(tool)) activateDraw(tool);
        return active.slice();
      },
      deactivate: removeActive,
      dispose: removeActive
    };
  }

  return { createOpenLayersInteractions };
});
