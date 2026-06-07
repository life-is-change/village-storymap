(function () {
  const LOCAL_FEATURES_STORAGE_KEY = "village_planning_local_features_v1";

  function canUseLocalStorage() {
    try {
      return typeof localStorage !== "undefined";
    } catch (_) {
      return false;
    }
  }

  function loadLocalFeatureRows() {
    if (!canUseLocalStorage()) return [];
    try {
      const raw = localStorage.getItem(LOCAL_FEATURES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("读取本地规划要素失败：", error);
      return [];
    }
  }

  function saveLocalFeatureRows(rows) {
    if (!canUseLocalStorage()) return;
    try {
      localStorage.setItem(LOCAL_FEATURES_STORAGE_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
    } catch (error) {
      console.warn("保存本地规划要素失败：", error);
    }
  }

  function normalizeLocalKeyPart(value) {
    return String(value ?? "").trim();
  }

  function makeLocalFeatureKey(row) {
    return [
      normalizeLocalKeyPart(row?.space_id),
      normalizeLocalKeyPart(row?.layer_key),
      normalizeLocalKeyPart(row?.object_code)
    ].join("::");
  }

  function sortFeatureRows(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const aa = String(a?.object_code || "");
      const bb = String(b?.object_code || "");
      return aa.localeCompare(bb, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    });
  }

  function listLayerFeaturesFromLocal(spaceId, layerKey, includeDeleted = false) {
    return sortFeatureRows(loadLocalFeatureRows().filter((row) => (
      row?.space_id === spaceId &&
      row?.layer_key === layerKey &&
      (includeDeleted || row?.is_deleted !== true)
    )));
  }

  function upsertLocalRows(rows) {
    const incoming = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!incoming.length) return;
    const existing = loadLocalFeatureRows();
    const map = new Map();
    existing.forEach((row) => {
      const key = makeLocalFeatureKey(row);
      if (key !== "::::") map.set(key, row);
    });
    const timestamp = new Date().toISOString();
    incoming.forEach((row) => {
      const normalized = {
        ...row,
        id: row.id || makeLocalFeatureKey(row),
        created_at: row.created_at || timestamp,
        updated_at: timestamp,
        is_deleted: row.is_deleted === true
      };
      map.set(makeLocalFeatureKey(normalized), normalized);
    });
    saveLocalFeatureRows(Array.from(map.values()));
  }

  function softDeleteLocalRow(spaceId, layerKey, objectCode, props = {}) {
    const object_code = normalizeLocalKeyPart(objectCode);
    if (!spaceId || !layerKey || !object_code) return;
    const rows = loadLocalFeatureRows();
    const targetKey = [spaceId, layerKey, object_code].join("::");
    const timestamp = new Date().toISOString();
    let found = false;
    const nextRows = rows.map((row) => {
      if (makeLocalFeatureKey(row) !== targetKey) return row;
      found = true;
      return { ...row, is_deleted: true, updated_at: timestamp };
    });
    if (!found) {
      nextRows.push({
        id: targetKey,
        space_id: spaceId,
        layer_key: layerKey,
        object_code,
        object_name: object_code,
        geom: getFallbackGeometry(layerKey),
        props,
        is_deleted: true,
        created_at: timestamp,
        updated_at: timestamp
      });
    }
    saveLocalFeatureRows(nextRows);
  }

  function listLayerFeaturesFromDb(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return Promise.resolve(listLayerFeaturesFromLocal(spaceId, layerKey));

    return supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("*")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("object_code", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.warn(`读取 ${layerKey} 数据库要素失败，已回退本地缓存：`, error);
          return listLayerFeaturesFromLocal(spaceId, layerKey);
        }
        return data || [];
      })
      .catch((error) => {
        console.warn(`读取 ${layerKey} 数据库要素异常，已回退本地缓存：`, error);
        return listLayerFeaturesFromLocal(spaceId, layerKey);
      });
  }

  function listDeletedLayerFeatureCodesFromLocal(spaceId, layerKey) {
    return listLayerFeaturesFromLocal(spaceId, layerKey, true)
      .filter((row) => row?.is_deleted === true)
      .map((row) => row.object_code)
      .filter(Boolean);
  }

  function listDeletedLayerFeatureCodesFromDb(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return Promise.resolve(listDeletedLayerFeatureCodesFromLocal(spaceId, layerKey));

    return supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("object_code")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .eq("is_deleted", true)
      .then(({ data, error }) => {
        if (error) {
          console.warn(`读取 ${layerKey} 删除标记失败，已回退本地缓存：`, error);
          return listDeletedLayerFeatureCodesFromLocal(spaceId, layerKey);
        }
        return (Array.isArray(data) ? data : [])
          .map((row) => row.object_code)
          .filter(Boolean);
      })
      .catch((error) => {
        console.warn(`读取 ${layerKey} 删除标记异常，已回退本地缓存：`, error);
        return listDeletedLayerFeatureCodesFromLocal(spaceId, layerKey);
      });
  }

  function hasAnyLayerFeaturesInDb(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return Promise.resolve(listLayerFeaturesFromLocal(spaceId, layerKey).length > 0);

    return supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("id")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          console.warn(`检查空间 ${layerKey} 是否已初始化失败，已回退本地缓存：`, error);
          return listLayerFeaturesFromLocal(spaceId, layerKey).length > 0;
        }
        return Array.isArray(data) && data.length > 0;
      })
      .catch((error) => {
        console.warn(`检查空间 ${layerKey} 是否已初始化异常，已回退本地缓存：`, error);
        return listLayerFeaturesFromLocal(spaceId, layerKey).length > 0;
      });
  }

  function invalidateSingleCache(deps, layerKey, spaceId) {
    const rowsCache = deps.getRowsCache(layerKey);
    const hasAnyCache = deps.getHasAnyCache(layerKey);
    if (!rowsCache || !hasAnyCache) return;

    if (spaceId === null || spaceId === undefined) {
      rowsCache.clear();
      hasAnyCache.clear();
      return;
    }

    const key = deps.getBuildingSpaceCacheKey(spaceId);
    rowsCache.delete(key);
    hasAnyCache.delete(key);
  }

  function getFallbackGeometry(layerKey) {
    return {
      type: layerKey === "road" ? "LineString" : "Polygon",
      coordinates: []
    };
  }

  const api = {
    __listLocalRows(spaceId, layerKey, includeDeleted = false) {
      return listLayerFeaturesFromLocal(spaceId, layerKey, includeDeleted);
    },

    __upsertLocalRows(_deps, rows) {
      upsertLocalRows(rows);
    },

    invalidateBuildingDbCache(deps, spaceId = null) {
      invalidateSingleCache(deps, "building", spaceId);
    },

    invalidateRoadDbCache(deps, spaceId = null) {
      invalidateSingleCache(deps, "road", spaceId);
    },

    invalidateCroplandDbCache(deps, spaceId = null) {
      invalidateSingleCache(deps, "cropland", spaceId);
    },

    invalidateOpenSpaceDbCache(deps, spaceId = null) {
      invalidateSingleCache(deps, "openSpace", spaceId);
    },

    invalidateWaterDbCache(deps, spaceId = null) {
      invalidateSingleCache(deps, "water", spaceId);
    },

    invalidateLayerDbCache(deps, layerKey, spaceId) {
      invalidateSingleCache(deps, layerKey, spaceId);
    },

    async listBuildingFeaturesFromDb(deps, spaceId) {
      return listLayerFeaturesFromDb(deps, spaceId, "building");
    },

    async listRoadFeaturesFromDb(deps, spaceId) {
      return listLayerFeaturesFromDb(deps, spaceId, "road");
    },

    async listCroplandFeaturesFromDb(deps, spaceId) {
      return listLayerFeaturesFromDb(deps, spaceId, "cropland");
    },

    async listOpenSpaceFeaturesFromDb(deps, spaceId) {
      return listLayerFeaturesFromDb(deps, spaceId, "openSpace");
    },

    async listWaterFeaturesFromDb(deps, spaceId) {
      return listLayerFeaturesFromDb(deps, spaceId, "water");
    },

    async listDeletedLayerFeatureCodesFromDb(deps, spaceId, layerKey) {
      return listDeletedLayerFeatureCodesFromDb(deps, spaceId, layerKey);
    },

    async listBuildingFeaturesFromDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getRowsCache("building");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const rows = await api.listBuildingFeaturesFromDb(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async listRoadFeaturesFromDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getRowsCache("road");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const rows = await api.listRoadFeaturesFromDb(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async listCroplandFeaturesFromDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getRowsCache("cropland");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const rows = await api.listCroplandFeaturesFromDb(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async listOpenSpaceFeaturesFromDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getRowsCache("openSpace");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const rows = await api.listOpenSpaceFeaturesFromDb(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async listWaterFeaturesFromDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getRowsCache("water");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const rows = await api.listWaterFeaturesFromDb(deps, spaceId);
      cache.set(key, rows);
      return rows;
    },

    async upsertBuildingFeatureToDb(deps, { spaceId, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();

      const payload = {
        space_id: spaceId,
        layer_key: "building",
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      if (!supabaseClient) {
        upsertLocalRows(payload);
        api.invalidateBuildingDbCache(deps, spaceId);
        return;
      }

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) {
        console.warn("Supabase 保存建筑失败，已保存到本地缓存：", error);
        upsertLocalRows(payload);
      }
      api.invalidateBuildingDbCache(deps, spaceId);
    },

    async upsertRoadFeatureToDb(deps, { spaceId, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();

      const payload = {
        space_id: spaceId,
        layer_key: "road",
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      if (!supabaseClient) {
        upsertLocalRows(payload);
        api.invalidateRoadDbCache(deps, spaceId);
        return;
      }

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) {
        console.warn("Supabase 保存道路失败，已保存到本地缓存：", error);
        upsertLocalRows(payload);
      }
      api.invalidateRoadDbCache(deps, spaceId);
    },

    async upsertLayerFeatureToDb(deps, { spaceId, layerKey, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();

      const payload = {
        space_id: spaceId,
        layer_key: layerKey,
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      if (!supabaseClient) {
        upsertLocalRows(payload);
        api.invalidateLayerDbCache(deps, layerKey, spaceId);
        return;
      }

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) {
        console.warn(`Supabase 保存${deps.getLayerLabel(layerKey)}失败，已保存到本地缓存：`, error);
        upsertLocalRows(payload);
      }
      api.invalidateLayerDbCache(deps, layerKey, spaceId);
    },

    async softDeleteBuildingFeatureInDb(deps, spaceId, objectCode) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        softDeleteLocalRow(spaceId, "building", objectCode, { 房屋编码: objectCode, 房屋名称: objectCode });
        api.invalidateBuildingDbCache(deps, spaceId);
        return;
      }

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", "building")
        .eq("object_code", objectCode)
        .select("id");

      if (error) {
        console.warn("Supabase 删除建筑失败，已写入本地删除标记：", error);
        softDeleteLocalRow(spaceId, "building", objectCode, { 房屋编码: objectCode, 房屋名称: objectCode });
        api.invalidateBuildingDbCache(deps, spaceId);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        api.invalidateBuildingDbCache(deps, spaceId);
        return;
      }

      const fallbackPayload = {
        space_id: spaceId,
        layer_key: "building",
        object_code: objectCode,
        object_name: objectCode,
        geom: getFallbackGeometry("building"),
        props: {
          房屋编码: objectCode,
          房屋名称: objectCode
        },
        is_deleted: true
      };

      const { error: upsertError } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(fallbackPayload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (upsertError) throw upsertError;
      api.invalidateBuildingDbCache(deps, spaceId);
    },

    async softDeleteRoadFeatureInDb(deps, spaceId, objectCode) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        softDeleteLocalRow(spaceId, "road", objectCode, { 道路编码: objectCode, 道路名称: objectCode });
        api.invalidateRoadDbCache(deps, spaceId);
        return;
      }

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", "road")
        .eq("object_code", objectCode)
        .select("id");

      if (error) {
        console.warn("Supabase 删除道路失败，已写入本地删除标记：", error);
        softDeleteLocalRow(spaceId, "road", objectCode, { 道路编码: objectCode, 道路名称: objectCode });
        api.invalidateRoadDbCache(deps, spaceId);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        api.invalidateRoadDbCache(deps, spaceId);
        return;
      }

      const fallbackPayload = {
        space_id: spaceId,
        layer_key: "road",
        object_code: objectCode,
        object_name: objectCode,
        geom: getFallbackGeometry("road"),
        props: {
          道路编码: objectCode,
          道路名称: objectCode
        },
        is_deleted: true
      };

      const { error: upsertError } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(fallbackPayload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (upsertError) throw upsertError;
      api.invalidateRoadDbCache(deps, spaceId);
    },

    async softDeleteLayerFeatureInDb(deps, spaceId, layerKey, objectCode) {
      if (layerKey === "building") return api.softDeleteBuildingFeatureInDb(deps, spaceId, objectCode);
      if (layerKey === "road") return api.softDeleteRoadFeatureInDb(deps, spaceId, objectCode);

      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        const codeKey = deps.getLayerCodeField(layerKey);
        const nameKey = deps.getLayerNameField(layerKey);
        softDeleteLocalRow(spaceId, layerKey, objectCode, { [codeKey]: objectCode, [nameKey]: objectCode });
        api.invalidateLayerDbCache(deps, layerKey, spaceId);
        return;
      }

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", layerKey)
        .eq("object_code", objectCode)
        .select("id");

      if (error) {
        console.warn(`Supabase 删除${deps.getLayerLabel(layerKey)}失败，已写入本地删除标记：`, error);
        const codeKey = deps.getLayerCodeField(layerKey);
        const nameKey = deps.getLayerNameField(layerKey);
        softDeleteLocalRow(spaceId, layerKey, objectCode, { [codeKey]: objectCode, [nameKey]: objectCode });
        api.invalidateLayerDbCache(deps, layerKey, spaceId);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        api.invalidateLayerDbCache(deps, layerKey, spaceId);
        return;
      }

      const codeKey = deps.getLayerCodeField(layerKey);
      const nameKey = deps.getLayerNameField(layerKey);
      const fallbackPayload = {
        space_id: spaceId,
        layer_key: layerKey,
        object_code: objectCode,
        object_name: objectCode,
        geom: getFallbackGeometry(layerKey),
        props: {
          [codeKey]: objectCode,
          [nameKey]: objectCode
        },
        is_deleted: true
      };

      const { error: upsertError } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(fallbackPayload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (upsertError) throw upsertError;
      api.invalidateLayerDbCache(deps, layerKey, spaceId);
    },

    async hasAnyBuildingFeaturesInDb(deps, spaceId) {
      return hasAnyLayerFeaturesInDb(deps, spaceId, "building");
    },

    async hasAnyRoadFeaturesInDb(deps, spaceId) {
      return hasAnyLayerFeaturesInDb(deps, spaceId, "road");
    },

    async hasAnyCroplandFeaturesInDb(deps, spaceId) {
      return hasAnyLayerFeaturesInDb(deps, spaceId, "cropland");
    },

    async hasAnyOpenSpaceFeaturesInDb(deps, spaceId) {
      return hasAnyLayerFeaturesInDb(deps, spaceId, "openSpace");
    },

    async hasAnyBuildingFeaturesInDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getHasAnyCache("building");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const hasAny = await api.hasAnyBuildingFeaturesInDb(deps, spaceId);
      cache.set(key, hasAny);
      return hasAny;
    },

    async hasAnyRoadFeaturesInDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getHasAnyCache("road");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const hasAny = await api.hasAnyRoadFeaturesInDb(deps, spaceId);
      cache.set(key, hasAny);
      return hasAny;
    },

    async hasAnyCroplandFeaturesInDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getHasAnyCache("cropland");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const hasAny = await api.hasAnyCroplandFeaturesInDb(deps, spaceId);
      cache.set(key, hasAny);
      return hasAny;
    },

    async hasAnyOpenSpaceFeaturesInDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getHasAnyCache("openSpace");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const hasAny = await api.hasAnyOpenSpaceFeaturesInDb(deps, spaceId);
      cache.set(key, hasAny);
      return hasAny;
    },

    async hasAnyWaterFeaturesInDb(deps, spaceId) {
      return hasAnyLayerFeaturesInDb(deps, spaceId, "water");
    },

    async hasAnyWaterFeaturesInDbCached(deps, spaceId, options = {}) {
      const { force = false } = options;
      const key = deps.getBuildingSpaceCacheKey(spaceId);
      const cache = deps.getHasAnyCache("water");
      if (!force && cache.has(key)) {
        return cache.get(key);
      }

      const hasAny = await api.hasAnyWaterFeaturesInDb(deps, spaceId);
      cache.set(key, hasAny);
      return hasAny;
    }
  };

  window.FeatureDbModule = api;
})();
