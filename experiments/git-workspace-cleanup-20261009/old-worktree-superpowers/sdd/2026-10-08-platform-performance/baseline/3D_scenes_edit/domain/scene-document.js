(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneDocumentModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const KINDS = Object.freeze(["surface", "line", "asset", "structure", "group"]);
  const CATEGORIES = Object.freeze({
    surface: ["paving", "grass", "water", "planter", "planting", "activity-field"],
    line: ["path", "curb", "low-wall", "fence", "hedge", "drainage"],
    asset: ["tree", "shrub", "bench", "table", "light", "bin", "sign", "sculpture", "fitness"],
    structure: ["pavilion", "pergola", "bus-stop", "stall", "stage", "play-equipment"],
    group: ["composite"]
  });

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function create(options) {
    const source = options || {};
    const now = source.now || new Date().toISOString();
    return {
      schemaVersion: 1,
      projectId: source.projectId || null,
      villageId: source.villageId || null,
      groupId: source.groupId || null,
      baselineRef: {
        spaceId: source.spaceId || null,
        revision: Number.isInteger(source.baselineRevision) ? source.baselineRevision : 0
      },
      revision: Number.isInteger(source.revision) ? source.revision : 0,
      updatedAt: now,
      selectionBoundary: source.selectionBoundary ? clone(source.selectionBoundary) : null,
      layers: [{ id: "design", name: "方案要素", visible: true, locked: false, order: 0 }],
      objects: [],
      groups: [],
      assetRefs: [],
      metadata: {
        scopeKind: source.scopeKind || "group",
        ownerId: source.ownerId || null
      }
    };
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function validatePosition(position, path, errors) {
    if (!Array.isArray(position) || position.length < 2 || !isFiniteNumber(position[0]) || !isFiniteNumber(position[1])) {
      errors.push(`${path} must be a longitude/latitude position`);
      return;
    }
    if (position[0] < -180 || position[0] > 180) errors.push(`${path} longitude is out of range`);
    if (position[1] < -90 || position[1] > 90) errors.push(`${path} latitude is out of range`);
  }

  function positionsEqual(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1];
  }

  function validateGeometry(geometry, expectedType, errors) {
    if (!geometry || typeof geometry !== "object") {
      errors.push("geometry is required");
      return;
    }
    if (geometry.type !== expectedType) errors.push(`geometry type must be ${expectedType}`);
    const coordinates = geometry.coordinates;
    if (geometry.type === "Point") {
      validatePosition(coordinates, "geometry", errors);
    } else if (geometry.type === "LineString") {
      if (!Array.isArray(coordinates) || coordinates.length < 2) errors.push("LineString requires at least two positions");
      else coordinates.forEach((position, index) => validatePosition(position, `geometry[${index}]`, errors));
    } else if (geometry.type === "Polygon") {
      if (!Array.isArray(coordinates) || !coordinates.length) {
        errors.push("Polygon requires at least one ring");
      } else {
        coordinates.forEach((ring, ringIndex) => {
          if (!Array.isArray(ring) || ring.length < 4) {
            errors.push(`Polygon ring ${ringIndex} requires at least four positions`);
            return;
          }
          ring.forEach((position, index) => validatePosition(position, `geometry[${ringIndex}][${index}]`, errors));
          if (!positionsEqual(ring[0], ring[ring.length - 1])) errors.push(`Polygon ring ${ringIndex} must be closed`);
        });
      }
    }
  }

  function validateTransform(transform, errors) {
    if (!transform || typeof transform !== "object") {
      errors.push("transform is required for placeable objects");
      return;
    }
    for (const key of ["headingDeg", "pitchDeg", "rollDeg", "heightOffsetM"]) {
      if (!isFiniteNumber(transform[key])) errors.push(`transform.${key} must be finite`);
    }
    if (!Array.isArray(transform.scale) || transform.scale.length !== 3 || transform.scale.some((value) => !isFiniteNumber(value) || value <= 0)) {
      errors.push("transform.scale must contain three positive numbers");
    }
  }

  function validateObject(object) {
    const errors = [];
    if (!object || typeof object !== "object") return { ok: false, errors: ["object is required"] };
    if (typeof object.id !== "string" || !object.id.trim()) errors.push("object id is required");
    if (!KINDS.includes(object.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
    if (object.kind && CATEGORIES[object.kind] && !CATEGORIES[object.kind].includes(object.category)) {
      errors.push(`category is not valid for kind ${object.kind}`);
    }
    const geometryType = object.kind === "surface" ? "Polygon" : object.kind === "line" ? "LineString" : object.kind === "group" ? null : "Point";
    if (geometryType) validateGeometry(object.geometry, geometryType, errors);
    if (object.kind === "asset" || object.kind === "structure") validateTransform(object.transform, errors);
    if (typeof object.layerId !== "string" || !object.layerId.trim()) errors.push("layerId is required");
    return { ok: errors.length === 0, errors };
  }

  function validate(document) {
    const errors = [];
    if (!document || typeof document !== "object") return { ok: false, errors: ["document is required"] };
    for (const key of ["projectId", "villageId"]) {
      if (typeof document[key] !== "string" || !document[key].trim()) errors.push(`${key} is required`);
    }
    const scopeKind = document.metadata?.scopeKind || "group";
    if (!['group', 'admin_sandbox'].includes(scopeKind)) errors.push("metadata.scopeKind is invalid");
    if (scopeKind === "group" && (typeof document.groupId !== "string" || !document.groupId.trim())) errors.push("groupId is required");
    if (scopeKind === "admin_sandbox" && document.groupId !== null) errors.push("groupId must be null for admin sandbox");
    if (scopeKind === "admin_sandbox" && (typeof document.metadata?.ownerId !== "string" || !document.metadata.ownerId.trim())) errors.push("metadata.ownerId is required for admin sandbox");
    if (!document.baselineRef || typeof document.baselineRef.spaceId !== "string" || !document.baselineRef.spaceId.trim()) {
      errors.push("baselineRef.spaceId is required");
    }
    if (!Number.isInteger(document.baselineRef?.revision) || document.baselineRef.revision < 0) {
      errors.push("baselineRef.revision must be a non-negative integer");
    }
    const layers = Array.isArray(document.layers) ? document.layers : [];
    const layerIds = new Set(layers.map((layer) => layer.id));
    const groups = Array.isArray(document.groups) ? document.groups : [];
    const groupIds = new Set(groups.map((group) => group.id));
    const seen = new Set();
    for (const object of Array.isArray(document.objects) ? document.objects : []) {
      const result = validateObject(object);
      errors.push(...result.errors.map((error) => `${object?.id || "object"}: ${error}`));
      if (seen.has(object.id)) errors.push(`duplicate object id: ${object.id}`);
      seen.add(object.id);
      if (object.layerId && !layerIds.has(object.layerId)) errors.push(`${object.id}: unknown layer ${object.layerId}`);
      if (object.groupId && !groupIds.has(object.groupId)) errors.push(`${object.id}: unknown group ${object.groupId}`);
    }
    return { ok: errors.length === 0, errors };
  }

  return { KINDS, CATEGORIES, create, clone, validate, validateObject };
});
