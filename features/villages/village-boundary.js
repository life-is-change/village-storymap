(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VillageBoundaryModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function boundaryError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function polygonsFromGeoJson(value) {
    if (!value) throw boundaryError("BOUNDARY_EMPTY");
    if (value.type === "FeatureCollection") {
      if (!Array.isArray(value.features) || value.features.length === 0) {
        throw boundaryError("BOUNDARY_EMPTY");
      }
      return value.features.flatMap((feature) => polygonsFromGeoJson(feature));
    }
    if (value.type === "Feature") return polygonsFromGeoJson(value.geometry);
    if (value.type === "Polygon") return [value.coordinates];
    if (value.type === "MultiPolygon") return Array.isArray(value.coordinates) ? value.coordinates : [];
    throw boundaryError("BOUNDARY_POLYGON_REQUIRED");
  }

  function normalizeRing(ring) {
    if (!Array.isArray(ring) || ring.length < 4) throw boundaryError("BOUNDARY_RING_INVALID");
    const normalized = ring.map((position) => {
      if (!Array.isArray(position) || position.length < 2) throw boundaryError("BOUNDARY_COORDINATE_INVALID");
      const longitude = Number(position[0]);
      const latitude = Number(position[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw boundaryError("BOUNDARY_COORDINATE_INVALID");
      }
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw boundaryError("BOUNDARY_COORDINATE_OUT_OF_RANGE");
      }
      return [longitude, latitude];
    });
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) normalized.push([...first]);
    return normalized;
  }

  function normalizePolygon(polygon) {
    if (!Array.isArray(polygon) || polygon.length === 0) throw boundaryError("BOUNDARY_EMPTY");
    return polygon.map(normalizeRing);
  }

  function summarizeBoundary(geometry) {
    const polygons = polygonsFromGeoJson(geometry).map(normalizePolygon);
    if (polygons.length === 0) throw boundaryError("BOUNDARY_EMPTY");
    const positions = polygons.flat(2);
    const longitudes = positions.map((position) => position[0]);
    const latitudes = positions.map((position) => position[1]);
    return {
      bounds: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
      polygonCount: polygons.length,
      vertexCount: positions.length
    };
  }

  function normalizeGeoJsonBoundary(value) {
    const coordinates = polygonsFromGeoJson(value).map(normalizePolygon);
    if (coordinates.length === 0) throw boundaryError("BOUNDARY_EMPTY");
    const geometry = { type: "MultiPolygon", coordinates };
    return { geometry, ...summarizeBoundary(geometry) };
  }

  function createBoundaryController({ map = null, ol = null, uploadShapefile = null } = {}) {
    let current = null;
    let source = null;
    let layer = null;
    let draw = null;

    if (map && ol) {
      const VectorSource = ol.VectorSource || ol.source?.Vector;
      const VectorLayer = ol.VectorLayer || ol.layer?.Vector;
      if (VectorSource && VectorLayer) {
        source = new VectorSource();
        layer = new VectorLayer({ source, zIndex: 1001 });
        map.addLayer(layer);
      }
    }

    function setBoundary(value) {
      current = normalizeGeoJsonBoundary(value);
      return current;
    }

    function stopDrawing() {
      if (draw && map) map.removeInteraction(draw);
      draw = null;
    }

    return {
      setBoundary,
      getBoundary() {
        return current;
      },
      async loadFile(file) {
        const name = String(file?.name || "").toLowerCase();
        if (name.endsWith(".zip")) {
          if (typeof uploadShapefile !== "function") throw boundaryError("BOUNDARY_SHAPEFILE_UPLOADER_REQUIRED");
          return setBoundary(await uploadShapefile(file));
        }
        if (!name.endsWith(".geojson") && !name.endsWith(".json")) {
          throw boundaryError("BOUNDARY_FILE_TYPE_UNSUPPORTED");
        }
        try {
          return setBoundary(JSON.parse(await file.text()));
        } catch (error) {
          if (error?.code) throw error;
          throw boundaryError("BOUNDARY_GEOJSON_INVALID");
        }
      },
      startDrawing() {
        const Draw = ol?.Draw || ol?.interaction?.Draw;
        const GeoJSON = ol?.GeoJSON || ol?.format?.GeoJSON;
        if (!map || !source || !Draw || !GeoJSON) throw boundaryError("BOUNDARY_MAP_REQUIRED");
        stopDrawing();
        source.clear();
        draw = new Draw({ source, type: "Polygon" });
        draw.on("drawend", (event) => {
          const value = new GeoJSON().writeGeometryObject(event.feature.getGeometry(), {
            featureProjection: map.getView().getProjection(),
            dataProjection: "EPSG:4326"
          });
          setBoundary(value);
          stopDrawing();
        });
        map.addInteraction(draw);
      },
      clear() {
        stopDrawing();
        source?.clear();
        current = null;
      },
      destroy() {
        this.clear();
        if (layer && map) map.removeLayer(layer);
      }
    };
  }

  return { createBoundaryController, normalizeGeoJsonBoundary, summarizeBoundary };
});
