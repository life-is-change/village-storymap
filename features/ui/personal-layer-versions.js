(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PersonalLayerVersionsModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const LAYER_KEYS = Object.freeze(["building", "road", "water", "contours"]);

  function resolveCurrentVersions(selections = []) {
    const result = {};
    (Array.isArray(selections) ? selections : []).forEach((selection) => {
      if (LAYER_KEYS.includes(selection?.layer_key) && selection?.current_version_id) {
        result[selection.layer_key] = selection.current_version_id;
      }
    });
    return result;
  }

  function resolveFigureGroundLayerKeys() {
    return [...LAYER_KEYS];
  }

  function shouldRefreshLiveFigureGround(space = {}) {
    return space?.spaceType === "course_personal" &&
      Array.isArray(space?.selectedLayers) &&
      space.selectedLayers.includes("figureGround");
  }

  function canEditPersonalLayer(layerKey, action = "") {
    if (String(layerKey) === "contours") return String(action) === "delete";
    return ["building", "road", "water"].includes(String(layerKey));
  }

  function groupVersionsByLayer(versions = []) {
    const grouped = Object.fromEntries(LAYER_KEYS.map((key) => [key, []]));
    (Array.isArray(versions) ? versions : []).forEach((version) => {
      if (grouped[version?.layer_key]) grouped[version.layer_key].push(version);
    });
    LAYER_KEYS.forEach((key) => grouped[key].sort(
      (first, second) => Number(second.version_number || 0) - Number(first.version_number || 0)
    ));
    return grouped;
  }

  function buildRawFeatureFromPersonalRow(row = {}) {
    return {
      type: "Feature",
      id: row.object_code,
      properties: {
        ...(row.props || {}),
        object_code: row.object_code,
        name: row.object_name || row.object_code
      },
      geometry: row.geom
    };
  }

  const LAYER_LABELS = Object.freeze({
    building: "建筑",
    road: "道路",
    water: "水系",
    contours: "等高线"
  });

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderPersonalVersionManager({ versions = [], selections = [] } = {}) {
    const grouped = groupVersionsByLayer(versions);
    const current = resolveCurrentVersions(selections);
    return LAYER_KEYS.map((layerKey) => {
      const items = grouped[layerKey];
      if (!items.length) {
        return `<section class="personal-version-group"><strong>${LAYER_LABELS[layerKey]}</strong><span>尚无成果版本</span></section>`;
      }
      const currentId = current[layerKey] || items[0].id;
      const options = items.map((item) => `
        <option value="${escapeHtml(item.id)}" ${item.id === currentId ? "selected" : ""}>
          V${Number(item.version_number || 0)} · ${Number(item.feature_count || 0)} 个要素
        </option>`).join("");
      const history = items.filter((item) => item.id !== currentId).map((item) => `
        <div class="personal-version-history-row">
          <span>V${Number(item.version_number || 0)} · ${Number(item.feature_count || 0)} 个要素</span>
          <button type="button" data-personal-version-compare="${escapeHtml(item.id)}" data-layer-key="${layerKey}">对比</button>
          <button type="button" class="is-danger" data-personal-version-delete="${escapeHtml(item.id)}">删除</button>
        </div>`).join("");
      return `<section class="personal-version-group" data-personal-layer-version="${layerKey}">
        <label><strong>${LAYER_LABELS[layerKey]}</strong>${layerKey === "contours" ? "（仅可删除）" : ""}
          <select data-personal-version-select="${layerKey}">${options}</select>
        </label>
        ${history || '<span class="personal-version-only">当前仅有一个版本</span>'}
      </section>`;
    }).join("") + '<button type="button" data-personal-version-compare-clear>结束版本对比</button>';
  }

  function createPersonalVersionCompare({ map, ol }) {
    if (!map || !ol?.VectorSource || !ol?.VectorLayer || !ol?.GeoJSON) {
      throw new Error("PERSONAL_VERSION_COMPARE_DEPENDENCIES_REQUIRED");
    }
    const source = new ol.VectorSource();
    const layer = new ol.VectorLayer({ source });
    layer.setZIndex?.(1050);
    layer.setOpacity?.(0.55);
    map.addLayer(layer);
    return {
      show(rows = []) {
        source.clear();
        const collection = {
          type: "FeatureCollection",
          features: rows.map(buildRawFeatureFromPersonalRow)
        };
        const features = new ol.GeoJSON().readFeatures(collection, {
          dataProjection: "EPSG:4326",
          featureProjection: map.getView?.().getProjection?.()
        });
        source.addFeatures(features);
      },
      clear() { source.clear(); },
      destroy() { source.clear(); map.removeLayer(layer); }
    };
  }

  function renderPersonalResultHistory(versions = [], applied = {}) {
    const bundles = new Map();
    for (const version of versions || []) {
      if (!version.bundle_id || !LAYER_KEYS.includes(version.layer_key)) continue;
      if (!bundles.has(version.bundle_id)) bundles.set(version.bundle_id,[]);
      bundles.get(version.bundle_id).push(version);
    }
    if (!bundles.size) return '<div class="version-manager-empty">尚无已保存的图底成果。生成后可预览并应用到此空间。</div>';
    return '<strong>图底成果历史</strong><p>应用仅替换该成果包含的图层，其他图层保留。</p>' + [...bundles].map(([id,items]) => {
      const pending = items.some(item => item.applicable === false);
      const current = items.every(item => applied[item.layer_key] === item.id);
      const layers = items.map(item => `${LAYER_LABELS[item.layer_key]} V${Number(item.version_number) || 1} · ${Number(item.feature_count) || 0} 个要素`).join('；');
      return `<div class="version-record-card"><span>${escapeHtml(layers)}</span><button type="button" data-personal-bundle-apply="${escapeHtml(id)}" ${pending || current ? 'disabled' : ''}>${pending ? '成果尚未完整保存' : current ? '已应用' : '应用到个人体验空间'}</button></div>`;
    }).join('');
  }

  return {
    LAYER_KEYS,
    resolveCurrentVersions,
    resolveFigureGroundLayerKeys,
    shouldRefreshLiveFigureGround,
    canEditPersonalLayer,
    groupVersionsByLayer,
    buildRawFeatureFromPersonalRow,
    renderPersonalVersionManager,
    renderPersonalResultHistory,
    createPersonalVersionCompare
  };
});
