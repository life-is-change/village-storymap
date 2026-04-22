(function () {
  function listLayerFeaturesFromDb(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return Promise.resolve([]);

    return supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("*")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("object_code", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.warn(`读取 ${layerKey} 数据库要素失败：`, error);
          return [];
        }
        return data || [];
      });
  }

  function hasAnyLayerFeaturesInDb(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return Promise.resolve(false);

    return supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("id")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          console.warn(`检查空间 ${layerKey} 是否已初始化失败：`, error);
          return false;
        }
        return Array.isArray(data) && data.length > 0;
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

    async upsertBuildingFeatureToDb(deps, { spaceId, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) throw new Error("未配置 Supabase，无法保存建筑要素。");

      const payload = {
        space_id: spaceId,
        layer_key: "building",
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) throw error;
      api.invalidateBuildingDbCache(deps, spaceId);
    },

    async upsertRoadFeatureToDb(deps, { spaceId, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) throw new Error("未配置 Supabase，无法保存道路要素。");

      const payload = {
        space_id: spaceId,
        layer_key: "road",
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) throw error;
      api.invalidateRoadDbCache(deps, spaceId);
    },

    async upsertLayerFeatureToDb(deps, { spaceId, layerKey, objectCode, objectName, geom, props = {} }) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) throw new Error(`未配置 Supabase，无法保存${deps.getLayerLabel(layerKey)}要素。`);

      const payload = {
        space_id: spaceId,
        layer_key: layerKey,
        object_code: objectCode,
        object_name: objectName || objectCode,
        geom,
        props,
        is_deleted: false
      };

      const { error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .upsert(payload, {
          onConflict: "space_id,layer_key,object_code"
        });

      if (error) throw error;
      api.invalidateLayerDbCache(deps, layerKey, spaceId);
    },

    async softDeleteBuildingFeatureInDb(deps, spaceId, objectCode) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) throw new Error("未配置 Supabase，无法删除建筑要素。");

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", "building")
        .eq("object_code", objectCode)
        .select("id");

      if (error) throw error;

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
      if (!supabaseClient) throw new Error("未配置 Supabase，无法删除道路要素。");

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", "road")
        .eq("object_code", objectCode)
        .select("id");

      if (error) throw error;

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
      if (!supabaseClient) throw new Error(`未配置 Supabase，无法删除${deps.getLayerLabel(layerKey)}要素。`);

      const { data, error } = await supabaseClient
        .from(deps.PLANNING_FEATURES_TABLE)
        .update({ is_deleted: true })
        .eq("space_id", spaceId)
        .eq("layer_key", layerKey)
        .eq("object_code", objectCode)
        .select("id");

      if (error) throw error;

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
    }
  };

  window.FeatureDbModule = api;
})();
