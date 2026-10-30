(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGeometryRulesModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EARTH_RADIUS_M = 6371008.8;
  const RAD = Math.PI / 180;

  function toLocalMeters(position, origin) {
    const latitude = Number(origin[1]) * RAD;
    return [
      (Number(position[0]) - Number(origin[0])) * RAD * EARTH_RADIUS_M * Math.cos(latitude),
      (Number(position[1]) - Number(origin[1])) * RAD * EARTH_RADIUS_M
    ];
  }

  function fromLocalMeters(point, origin) {
    const latitude = Number(origin[1]) * RAD;
    return [
      Number(origin[0]) + Number(point[0]) / (RAD * EARTH_RADIUS_M * Math.cos(latitude)),
      Number(origin[1]) + Number(point[1]) / (RAD * EARTH_RADIUS_M)
    ];
  }

  function geometryOrigin(geometry) {
    let first = geometry?.coordinates;
    while (Array.isArray(first) && Array.isArray(first[0])) first = first[0];
    return Array.isArray(first) ? first : [0, 0];
  }

  function measureLengthM(line) {
    const coordinates = line?.coordinates || [];
    if (coordinates.length < 2) return 0;
    const origin = coordinates[0];
    const points = coordinates.map((position) => toLocalMeters(position, origin));
    let total = 0;
    for (let index = 1; index < points.length; index += 1) total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    return total;
  }

  function ringArea(points) {
    let twice = 0;
    for (let index = 0; index < points.length - 1; index += 1) twice += points[index][0] * points[index + 1][1] - points[index + 1][0] * points[index][1];
    return twice / 2;
  }

  function measureAreaM2(polygon) {
    const rings = polygon?.coordinates || [];
    if (!rings.length) return 0;
    const origin = rings[0][0];
    const areas = rings.map((ring) => Math.abs(ringArea(ring.map((position) => toLocalMeters(position, origin)))));
    return Math.max(0, areas[0] - areas.slice(1).reduce((sum, area) => sum + area, 0));
  }

  function snapCoordinate(position, options) {
    const origin = options?.origin || position;
    const gridM = Math.max(0.001, Number(options?.gridM) || 0.5);
    const local = toLocalMeters(position, origin);
    return fromLocalMeters(local.map((value) => Math.round(value / gridM) * gridM), origin);
  }

  function rotatedFootprint(center, size, headingDeg) {
    const halfWidth = Math.max(0, Number(size?.widthM) || 0) / 2;
    const halfDepth = Math.max(0, Number(size?.depthM) || 0) / 2;
    const angle = (Number(headingDeg) || 0) * RAD;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners = [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
    const positions = corners.map(([x, y]) => fromLocalMeters([x * cos - y * sin, x * sin + y * cos], center));
    positions.push(positions[0].slice());
    return { type: "Polygon", coordinates: [positions] };
  }

  function pointOnSegment(point, a, b, epsilon = 1e-10) {
    const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) > epsilon) return false;
    return point[0] >= Math.min(a[0], b[0]) - epsilon && point[0] <= Math.max(a[0], b[0]) + epsilon && point[1] >= Math.min(a[1], b[1]) - epsilon && point[1] <= Math.max(a[1], b[1]) + epsilon;
  }

  function pointInRing(point, ring) {
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
      const a = ring[current];
      const b = ring[previous];
      if (pointOnSegment(point, a, b)) return true;
      const crosses = ((a[1] > point[1]) !== (b[1] > point[1])) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, polygon) {
    const rings = polygon?.coordinates || [];
    if (!rings.length || !pointInRing(point, rings[0])) return false;
    return !rings.slice(1).some((ring) => pointInRing(point, ring));
  }

  function vertices(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Point") return [geometry.coordinates];
    if (geometry.type === "LineString") return geometry.coordinates || [];
    if (geometry.type === "Polygon") return (geometry.coordinates || []).flat();
    return [];
  }

  function segments(geometry) {
    const lines = geometry?.type === "Polygon" ? geometry.coordinates || [] : geometry?.type === "LineString" ? [geometry.coordinates || []] : [];
    const result = [];
    for (const line of lines) for (let index = 1; index < line.length; index += 1) result.push([line[index - 1], line[index]]);
    return result;
  }

  function orientation(a, b, c) {
    const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if (Math.abs(value) < 1e-12) return 0;
    return value > 0 ? 1 : 2;
  }

  function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && pointOnSegment(c, a, b)) || (o2 === 0 && pointOnSegment(d, a, b)) || (o3 === 0 && pointOnSegment(a, c, d)) || (o4 === 0 && pointOnSegment(b, c, d));
  }

  function containsGeometry(boundary, geometry) {
    if (['LineString','Polygon'].includes(geometry?.type)) {
      const polygons = boundary?.type === 'Polygon' ? [boundary] : boundary?.type === 'MultiPolygon' ? boundary.coordinates.map(coordinates => ({ type: 'Polygon', coordinates })) : [];
      const inside = p => polygons.some(polygon => pointInPolygon(p, polygon) || (geometry.type==='Polygon' && segments(polygon).some(([a,b])=>pointOnSegment(p,a,b))));
      if (!polygons.length || !geometry.coordinates?.length || !vertices(geometry).every(inside)) return false;
      const edges = polygons.flatMap(polygon => segments(polygon));
      const edgesInside = segments(geometry).every(([a,b]) => {
        const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,cuts=[0,1];
        for (const [c,d] of edges) {
          const ux=d[0]-c[0],uy=d[1]-c[1],cross=dx*uy-dy*ux;
          if (Math.abs(cross)>1e-20) {
            const t=((c[0]-a[0])*uy-(c[1]-a[1])*ux)/cross,u=((c[0]-a[0])*dy-(c[1]-a[1])*dx)/cross;
            if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
          } else if(length) for(const p of [c,d])if(pointOnSegment(p,a,b))cuts.push(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length);
        }
        cuts.sort((x,y)=>x-y);
        return cuts.slice(1).every((t,i)=>inside([a[0]+dx*(t+cuts[i])/2,a[1]+dy*(t+cuts[i])/2]));
      });
      if (!edgesInside) return false;
      if (geometry.type==='Polygon') {
        // A filled polygon must not cover an excluded island even if all its edges fit.
        for (const polygon of polygons) for (const hole of polygon.coordinates.slice(1)) {
          const ys=[...new Set(hole.map(p=>p[1]))].sort((a,b)=>a-b);
          for (let row=1;row<ys.length;row++) {
            const y=(ys[row-1]+ys[row])/2,xs=[];
            for (const [a,b] of segments({type:'LineString',coordinates:hole})) if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
            xs.sort((a,b)=>a-b);
            for(let column=1;column<xs.length;column+=2){const p=[(xs[column-1]+xs[column])/2,y];if(pointInPolygon(p,geometry)&&!polygons.some(area=>pointInPolygon(p,area)))return false;}
          }
        }
      }
      return true;
    }
    if (boundary?.type !== "Polygon") return false;
    return vertices(geometry).every((point) => pointInPolygon(point, boundary));
  }

  function geometriesIntersect(a, b) {
    if (a?.type === "Point") return b?.type === "Polygon" ? pointInPolygon(a.coordinates, b) : false;
    if (b?.type === "Point") return a?.type === "Polygon" ? pointInPolygon(b.coordinates, a) : false;
    for (const [a1, a2] of segments(a)) for (const [b1, b2] of segments(b)) if (segmentsIntersect(a1, a2, b1, b2)) return true;
    if (a?.type === "Polygon" && vertices(b).some((point) => pointInPolygon(point, a))) return true;
    if (b?.type === "Polygon" && vertices(a).some((point) => pointInPolygon(point, b))) return true;
    return false;
  }

  function intersectsAny(geometry, candidates) {
    return (candidates || []).some((candidate) => geometriesIntersect(geometry, candidate));
  }

  function isSelfIntersecting(polygon) {
    const ring = polygon?.coordinates?.[0] || [];
    const edges = segments({ type: "LineString", coordinates: ring });
    for (let first = 0; first < edges.length; first += 1) {
      for (let second = first + 1; second < edges.length; second += 1) {
        if (Math.abs(first - second) <= 1 || (first === 0 && second === edges.length - 1)) continue;
        if (segmentsIntersect(edges[first][0], edges[first][1], edges[second][0], edges[second][1])) return true;
      }
    }
    return false;
  }

  function minimumBoundingDimensionM(polygon) {
    const origin = geometryOrigin(polygon);
    const points = vertices(polygon).map((position) => toLocalMeters(position, origin));
    if (!points.length) return 0;
    const width = Math.max(...points.map((point) => point[0])) - Math.min(...points.map((point) => point[0]));
    const height = Math.max(...points.map((point) => point[1])) - Math.min(...points.map((point) => point[1]));
    return Math.min(width, height);
  }

  function validateSelectionBoundary(boundary, options) {
    const errors = [];
    const warnings = [];
    const areaM2 = measureAreaM2(boundary);
    if (boundary?.type !== "Polygon" || !boundary.coordinates?.[0]?.length) errors.push("selection boundary must be a polygon");
    else if (isSelfIntersecting(boundary)) errors.push("selection boundary is self-intersecting");
    if (options?.villageBoundary && !containsGeometry(options.villageBoundary, boundary)) errors.push("selection boundary must stay inside the village boundary");
    if (intersectsAny(boundary, options?.baselineBuildings || [])) errors.push("selection boundary intersects a baseline building");
    if (boundary?.type === "Polygon" && minimumBoundingDimensionM(boundary) < 0.8) warnings.push("selection has less than 0.8 m clear width");
    return { ok: errors.length === 0, errors, warnings, measurements: { areaM2 } };
  }

  return {
    toLocalMeters,
    fromLocalMeters,
    measureLengthM,
    measureAreaM2,
    snapCoordinate,
    rotatedFootprint,
    containsGeometry,
    intersectsAny,
    isSelfIntersecting,
    validateSelectionBoundary
  };
});
