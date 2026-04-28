(function () {
  function dedupePayloadRows(deps, payloadRaw) {
    const dedupedMap = new Map();
    payloadRaw.forEach((item) => {
      const key = `${item.space_id}::${item.layer_key}::${deps.normalizeCode(item.object_code)}`;
      dedupedMap.set(key, item);
    });
    return Array.from(dedupedMap.values());
  }

  async function upsertInChunks(supabaseClient, tableName, payload, chunkSize = 200) {
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabaseClient
        .from(tableName)
        .upsert(chunk, {
          onConflict: "space_id,layer_key,object_code"
        });
      if (error) throw error;
    }
  }

  async function fetchBaseSpaceDbRows(deps, spaceId, layerKey) {
    const supabaseClient = deps.getSupabaseClient();
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from(deps.PLANNING_FEATURES_TABLE)
      .select("*")
      .eq("space_id", spaceId)
      .eq("layer_key", layerKey)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .order("object_code", { ascending: true });
    if (error) {
      console.warn(`读取现状空间 ${layerKey} 数据库数据失败：`, error);
      return [];
    }
    return data || [];
  }

  const api = {
    makeBuildingRawFeatureToDbPayload(deps, rawFeature, row, spaceId) {
      const sourceCode = deps.normalizeCode(deps.getFeatureCode(rawFeature, "building"));
      if (!sourceCode) return null;

      const propsFromGeoJSON = deps.cloneJson(deps.getFeatureProperties(rawFeature) || {});
      const propsFromCSV = deps.cloneJson(row || {});
      const mergedProps = {
        ...propsFromGeoJSON,
        ...propsFromCSV
      };

      mergedProps.房屋编码 =
        mergedProps.房屋编码 ||
        mergedProps.编码 ||
        mergedProps.CODE ||
        sourceCode;

      mergedProps.房屋名称 =
        mergedProps.房屋名称 ||
        mergedProps.名称 ||
        mergedProps.name ||
        mergedProps.NAME ||
        sourceCode;

      return {
        space_id: spaceId,
        layer_key: "building",
        object_code: sourceCode,
        object_name: mergedProps.房屋名称 || sourceCode,
        geom: deps.cloneJson(deps.getFeatureGeometry(rawFeature)),
        props: mergedProps,
        is_deleted: false
      };
    },

    makeRoadRawFeatureToDbPayload(deps, rawFeature, row, spaceId) {
      const sourceCode = deps.normalizeCode(deps.getFeatureCode(rawFeature, "road"));
      if (!sourceCode) return null;

      const propsFromGeoJSON = deps.cloneJson(deps.getFeatureProperties(rawFeature) || {});
      const propsFromCSV = deps.cloneJson(row || {});
      const mergedProps = {
        ...propsFromGeoJSON,
        ...propsFromCSV
      };

      mergedProps.道路编码 =
        mergedProps.道路编码 ||
        mergedProps.编码 ||
        mergedProps.CODE ||
        mergedProps["閬撹矾缂栵拷"] ||
        sourceCode;

      mergedProps.道路名称 =
        mergedProps.道路名称 ||
        mergedProps.名称 ||
        mergedProps.name ||
        mergedProps.NAME ||
        sourceCode;

      if (!mergedProps.道路宽度) {
        mergedProps.道路宽度 =
          mergedProps.width ||
          mergedProps.宽度 ||
          mergedProps.road_width ||
          mergedProps.WIDTH ||
          mergedProps["閬撹矾瀹斤拷"] ||
          deps.ROAD_DEFAULT_WIDTH;
      }

      return {
        space_id: spaceId,
        layer_key: "road",
        object_code: sourceCode,
        object_name: mergedProps.道路名称 || sourceCode,
        geom: deps.cloneJson(deps.getFeatureGeometry(rawFeature)),
        props: mergedProps,
        is_deleted: false
      };
    },

    async seedBuildingsForCopySpace(deps, spaceId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("未配置 Supabase，无法初始化空间建筑。");
      }

      if (!spaceId) return;

      const existed = await deps.hasAnyBuildingFeaturesInDb(spaceId);
      if (existed) return;

      // 复制空间优先从数据库读取现状空间最新数据作为基底
      if (!deps.isBaseSpace(spaceId) && deps.BASE_SPACE_ID) {
        const baseRows = await fetchBaseSpaceDbRows(deps, deps.BASE_SPACE_ID, "building");
        if (baseRows.length > 0) {
          const payload = baseRows.map((row) => ({
            space_id: spaceId,
            layer_key: "building",
            object_code: row.object_code,
            object_name: row.object_name,
            geom: deps.cloneJson(row.geom),
            props: deps.cloneJson(row.props),
            is_deleted: false
          }));
          await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);
          console.log(`空间 ${spaceId} 建筑已从现状空间数据库复制，共 ${payload.length} 条。`);
          return;
        }
      }

      const buildingCache = await deps.ensureLayerLoaded("building");
      const rawFeatures = buildingCache?.features || [];
      const rowIndex = buildingCache?.rowIndex || new Map();

      if (!rawFeatures.length) {
        console.warn("building geojson 为空，跳过空间初始化。");
        return;
      }

      const payloadRaw = rawFeatures
        .map((rawFeature) => {
          const code = deps.normalizeCode(deps.getFeatureCode(rawFeature, "building"));
          const row = rowIndex.get(code) || null;
          return api.makeBuildingRawFeatureToDbPayload(deps, rawFeature, row, spaceId);
        })
        .filter(Boolean);

      const payload = dedupePayloadRows(deps, payloadRaw);

      if (!payload.length) {
        console.warn("没有可初始化入库的建筑要素。");
        return;
      }

      if (payload.length !== payloadRaw.length) {
        console.warn(`building 初始化检测到重复编码，已自动去重：${payloadRaw.length - payload.length} 条`);
      }

      await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);

      console.log(`空间 ${spaceId} 建筑初始化完成，共 ${payload.length} 条。`);
    },

    async seedRoadsForCopySpace(deps, spaceId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("未配置 Supabase，无法初始化空间道路。");
      }

      if (!spaceId) return;

      const existed = await deps.hasAnyRoadFeaturesInDb(spaceId);
      if (existed) return;

      // 复制空间优先从数据库读取现状空间最新数据作为基底
      if (!deps.isBaseSpace(spaceId) && deps.BASE_SPACE_ID) {
        const baseRows = await fetchBaseSpaceDbRows(deps, deps.BASE_SPACE_ID, "road");
        if (baseRows.length > 0) {
          const payload = baseRows.map((row) => ({
            space_id: spaceId,
            layer_key: "road",
            object_code: row.object_code,
            object_name: row.object_name,
            geom: deps.cloneJson(row.geom),
            props: deps.cloneJson(row.props),
            is_deleted: false
          }));
          await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);
          deps.invalidateRoadDbCache(spaceId);
          console.log(`空间 ${spaceId} 道路已从现状空间数据库复制，共 ${payload.length} 条。`);
          return;
        }
      }

      const roadCache = await deps.ensureLayerLoaded("road");
      const rawFeatures = roadCache?.features || [];
      const rowIndex = roadCache?.rowIndex || new Map();

      if (!rawFeatures.length) {
        console.warn("road geojson 为空，跳过空间初始化。");
        return;
      }

      const payloadRaw = rawFeatures
        .map((rawFeature) => {
          const code = deps.normalizeCode(deps.getFeatureCode(rawFeature, "road"));
          const row = rowIndex.get(code) || null;
          return api.makeRoadRawFeatureToDbPayload(deps, rawFeature, row, spaceId);
        })
        .filter(Boolean);

      const payload = dedupePayloadRows(deps, payloadRaw);

      if (!payload.length) {
        console.warn("没有可初始化入库的道路要素。");
        return;
      }

      if (payload.length !== payloadRaw.length) {
        console.warn(`road 初始化检测到重复编码，已自动去重：${payloadRaw.length - payload.length} 条`);
      }

      await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);

      deps.invalidateRoadDbCache(spaceId);
      console.log(`空间 ${spaceId} 道路初始化完成，共 ${payload.length} 条。`);
    },

    makeLayerRawFeatureToDbPayload(deps, rawFeature, row, spaceId, layerKey, codeFields, nameFields) {
      const sourceCode = deps.normalizeCode(deps.getFeatureCode(rawFeature, layerKey));
      if (!sourceCode) return null;

      const propsFromGeoJSON = deps.cloneJson(deps.getFeatureProperties(rawFeature) || {});
      const propsFromCSV = deps.cloneJson(row || {});
      const mergedProps = { ...propsFromGeoJSON, ...propsFromCSV };

      // 尝试从各种可能的字段名中提取编码
      const codeField = codeFields.find((f) => mergedProps[f] != null) || codeFields[0];
      mergedProps[codeField] = mergedProps[codeField] || sourceCode;

      // 尝试从各种可能的字段名中提取名称
      const nameField = nameFields.find((f) => mergedProps[f] != null) || nameFields[0];
      mergedProps[nameField] = mergedProps[nameField] || sourceCode;

      return {
        space_id: spaceId,
        layer_key: layerKey,
        object_code: sourceCode,
        object_name: mergedProps[nameField] || sourceCode,
        geom: deps.cloneJson(deps.getFeatureGeometry(rawFeature)),
        props: mergedProps,
        is_deleted: false
      };
    },

    async seedLayerForCopySpace(deps, spaceId, layerKey, label, hasAnyFn, invalidateFn) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error(`未配置 Supabase，无法初始化空间${label}。`);
      }

      if (!spaceId) return;

      const existed = await hasAnyFn(spaceId);
      if (existed) return;

      // 复制空间优先从数据库读取现状空间最新数据作为基底
      if (!deps.isBaseSpace(spaceId) && deps.BASE_SPACE_ID) {
        const baseRows = await fetchBaseSpaceDbRows(deps, deps.BASE_SPACE_ID, layerKey);
        if (baseRows.length > 0) {
          const payload = baseRows.map((row) => ({
            space_id: spaceId,
            layer_key: layerKey,
            object_code: row.object_code,
            object_name: row.object_name,
            geom: deps.cloneJson(row.geom),
            props: deps.cloneJson(row.props),
            is_deleted: false
          }));
          await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);
          if (invalidateFn) invalidateFn(spaceId);
          console.log(`空间 ${spaceId} ${label}已从现状空间数据库复制，共 ${payload.length} 条。`);
          return;
        }
      }

      const cache = await deps.ensureLayerLoaded(layerKey);
      const rawFeatures = cache?.features || [];
      const rowIndex = cache?.rowIndex || new Map();

      if (!rawFeatures.length) {
        console.warn(`${layerKey} geojson 为空，跳过空间初始化。`);
        return;
      }

      const config = deps.getLayerConfigs?.()[layerKey] || {};
      const codeFields = config.codeFields || ["编码", "CODE", "code", "ID", "id"];
      const nameFields = config.nameFields || ["名称", "name", "NAME"];

      const payloadRaw = rawFeatures
        .map((rawFeature) => {
          const code = deps.normalizeCode(deps.getFeatureCode(rawFeature, layerKey));
          const row = rowIndex.get(code) || null;
          return api.makeLayerRawFeatureToDbPayload(deps, rawFeature, row, spaceId, layerKey, codeFields, nameFields);
        })
        .filter(Boolean);

      const payload = dedupePayloadRows(deps, payloadRaw);

      if (!payload.length) {
        console.warn(`没有可初始化入库的${label}要素。`);
        return;
      }

      if (payload.length !== payloadRaw.length) {
        console.warn(`${layerKey} 初始化检测到重复编码，已自动去重：${payloadRaw.length - payload.length} 条`);
      }

      await upsertInChunks(supabaseClient, deps.PLANNING_FEATURES_TABLE, payload);

      if (invalidateFn) invalidateFn(spaceId);
      console.log(`空间 ${spaceId} ${label}初始化完成，共 ${payload.length} 条。`);
    },

    async seedCroplandsForCopySpace(deps, spaceId) {
      return api.seedLayerForCopySpace(
        deps, spaceId, "cropland", "农田",
        (sid) => deps.hasAnyCroplandFeaturesInDb(sid),
        (sid) => deps.invalidateCroplandDbCache(sid)
      );
    },

    async seedOpenSpacesForCopySpace(deps, spaceId) {
      return api.seedLayerForCopySpace(
        deps, spaceId, "openSpace", "公共空间",
        (sid) => deps.hasAnyOpenSpaceFeaturesInDb(sid),
        (sid) => deps.invalidateOpenSpaceDbCache(sid)
      );
    },

    async seedWaterForCopySpace(deps, spaceId) {
      return api.seedLayerForCopySpace(
        deps, spaceId, "water", "水体",
        (sid) => deps.hasAnyWaterFeaturesInDb(sid),
        (sid) => deps.invalidateWaterDbCache(sid)
      );
    }
  };

  window.CopySpaceSeedModule = api;
})();
