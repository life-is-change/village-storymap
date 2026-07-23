(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingAoiModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function polygonAreaSqKm(ring) {
    const meanLatitude = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    const xScale = 111320 * Math.cos(meanLatitude * Math.PI / 180);
    const yScale = 110540;
    let twiceArea = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const first = ring[index];
      const second = ring[index + 1];
      twiceArea += (first[0] * xScale) * (second[1] * yScale)
        - (second[0] * xScale) * (first[1] * yScale);
    }
    return Math.abs(twiceArea) / 2 / 1e6;
  }

  function validateAoi(geometry, bounds, maxAreaSqKm = 2) {
    if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates?.[0])) {
      return { ok: false, code: "AOI_INVALID" };
    }
    const ring = geometry.coordinates[0].map((point) => [Number(point[0]), Number(point[1])]);
    if (ring.length < 4 || ring.length > 500 || ring.some((point) => !point.every(Number.isFinite))) {
      return { ok: false, code: ring.length > 500 ? "AOI_TOO_MANY_VERTICES" : "AOI_INVALID" };
    }
    if (ring.some(([x, y]) => x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3])) {
      return { ok: false, code: "AOI_OUT_OF_BOUNDS" };
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    const areaSqKm = polygonAreaSqKm(ring);
    if (!(areaSqKm > 0)) return { ok: false, code: "AOI_INVALID" };
    if (areaSqKm > maxAreaSqKm) return { ok: false, code: "AOI_TOO_LARGE" };
    return { ok: true, geometry: { type: "Polygon", coordinates: [ring] }, areaSqKm };
  }

  function createAoiController({ map, ol, villageBounds, maxAreaSqKm = 2 }) {
    const VectorSource = ol.VectorSource || ol.source?.Vector;
    const VectorLayer = ol.VectorLayer || ol.layer?.Vector;
    const Draw = ol.Draw || ol.interaction?.Draw;
    const GeoJSON = ol.GeoJSON || ol.format?.GeoJSON;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, zIndex: 1000 });
    map.addLayer(layer);
    let draw = null;
    let activeVillageBounds = Array.isArray(villageBounds) ? [...villageBounds] : null;
    function clearInteraction() {
      if (draw) map.removeInteraction(draw);
      draw = null;
    }
    return {
      start() {
        clearInteraction();
        source.clear();
        draw = new Draw({ source, type: "Polygon" });
        draw.on("drawstart", () => source.clear());
        draw.on("drawend", () => {
          const completedDraw = draw;
          draw = null;
          map.removeInteraction(completedDraw);
        });
        map.addInteraction(draw);
      },
      clear() {
        clearInteraction();
        source.clear();
      },
      getGeoJSON() {
        const feature = source.getFeatures()[0];
        if (!feature) return null;
        return new GeoJSON().writeGeometryObject(feature.getGeometry(), {
          featureProjection: map.getView().getProjection(), dataProjection: "EPSG:4326"
        });
      },
      validate() {
        if (!activeVillageBounds) return { ok: false, code: "AOI_BOUNDS_REQUIRED" };
        return validateAoi(this.getGeoJSON(), activeVillageBounds, maxAreaSqKm);
      },
      setVillageBounds(bounds) {
        if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(Number(value)))) {
          throw new Error("AOI_BOUNDS_INVALID");
        }
        activeVillageBounds = bounds.map(Number);
      },
      destroy() {
        this.clear();
        map.removeLayer(layer);
      }
    };
  }

  return { createAoiController, polygonAreaSqKm, validateAoi };
});
