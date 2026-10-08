(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyActivityModelModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const BADGES = Object.freeze([
    { key: "issue", flag: "unresolvedIssue", label: "!", title: "存在未解决问题" },
    { key: "geometry", flag: "geometryChanged", label: "◇", title: "几何已修改" },
    { key: "photo", flag: "hasPhoto", label: "▣", title: "已有照片" },
    { key: "discussion", flag: "hasDiscussion", label: "○", title: "已有讨论" },
    { key: "attribute", flag: "attributeEdited", label: "✎", title: "属性已修改" }
  ]);

  function value(row, camel, snake) {
    return row?.[camel] ?? row?.[snake];
  }

  function layerFromObjectType(row) {
    const objectType = String(value(row, "objectType", "object_type") || "").trim().toLowerCase();
    if (/^buildings?(?:__|$)/.test(objectType)) return "building";
    if (/^roads?(?:__|$)/.test(objectType)) return "road";
    if (/^waters?(?:__|$)/.test(objectType)) return "water";
    return "";
  }

  function objectKey(row, layerCamel = "surveyLayerKey", layerSnake = "survey_layer_key", codeCamel = "objectCode", codeSnake = "object_code") {
    const layer = String(value(row, layerCamel, layerSnake) || row?.layer_key || row?.layerKey || layerFromObjectType(row)).trim();
    const code = String(value(row, codeCamel, codeSnake) || "").trim();
    return layer && code ? `${layer}:${code}` : "";
  }

  function ensure(result, key) {
    if (!result.has(key)) result.set(key, {
      geometryChanged: false,
      attributeEdited: false,
      hasPhoto: false,
      hasDiscussion: false,
      unresolvedIssue: false
    });
    return result.get(key);
  }

  function buildActivityFlags({ reviews = [], edits = [], photos = [], comments = [], tasks = [] } = {}) {
    const result = new Map();
    for (const row of reviews) {
      const key = objectKey(row);
      const status = String(value(row, "geometryStatus", "geometry_status") || "");
      if (key && ["modified", "added"].includes(status)) ensure(result, key).geometryChanged = true;
    }
    for (const row of edits) {
      const key = objectKey(row);
      if (key) ensure(result, key).attributeEdited = true;
    }
    for (const row of photos) {
      const key = objectKey(row);
      if (key) ensure(result, key).hasPhoto = true;
    }
    for (const row of comments) {
      const key = objectKey(row);
      if (key) ensure(result, key).hasDiscussion = true;
    }
    for (const row of tasks) {
      const key = objectKey(row, "targetLayerKey", "target_layer_key", "targetObjectCode", "target_object_code");
      const status = String(value(row, "status", "status") || "open").toLowerCase();
      if (key && !["resolved", "verified", "archived", "closed"].includes(status)) ensure(result, key).unresolvedIssue = true;
    }
    return result;
  }

  function getVisibleBadges(flags = {}, { farZoom = false, max = 3 } = {}) {
    const selected = BADGES.filter((badge) => Boolean(flags[badge.flag]));
    const visible = farZoom ? selected.filter((badge) => badge.key === "issue") : selected.slice(0, Math.max(0, max));
    const remaining = farZoom ? 0 : selected.length - visible.length;
    return remaining > 0 ? [...visible, { key: "more", label: `+${remaining}`, title: `另有 ${remaining} 项记录` }] : visible;
  }

  function matchesActivityFilter(flags = {}, filter = "all") {
    const rules = {
      all: () => true,
      geometry: () => Boolean(flags.geometryChanged),
      photo: () => Boolean(flags.hasPhoto),
      discussion: () => Boolean(flags.hasDiscussion),
      incomplete: () => Boolean(flags.unresolvedIssue)
    };
    return (rules[filter] || rules.all)();
  }

  return { BADGES, buildActivityFlags, getVisibleBadges, matchesActivityFilter };
});
