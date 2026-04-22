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
        throw new Error("未配置 Supabase，无法初始化复制空间建筑。");
      }

      if (!spaceId || deps.isBaseSpace(spaceId)) return;

      const existed = await deps.hasAnyBuildingFeaturesInDb(spaceId);
      if (existed) return;

      const buildingCache = await deps.ensureLayerLoaded("building");
      const rawFeatures = buildingCache?.features || [];
      const rowIndex = buildingCache?.rowIndex || new Map();

      if (!rawFeatures.length) {
        console.warn("building geojson 为空，跳过复制空间初始化。");
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

      console.log(`复制空间 ${spaceId} 建筑初始化完成，共 ${payload.length} 条。`);
    },

    async seedRoadsForCopySpace(deps, spaceId) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("未配置 Supabase，无法初始化复制空间道路。");
      }

      if (!spaceId || deps.isBaseSpace(spaceId)) return;

      const existed = await deps.hasAnyRoadFeaturesInDb(spaceId);
      if (existed) return;

      const roadCache = await deps.ensureLayerLoaded("road");
      const rawFeatures = roadCache?.features || [];
      const rowIndex = roadCache?.rowIndex || new Map();

      if (!rawFeatures.length) {
        console.warn("road geojson 为空，跳过复制空间初始化。");
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
      console.log(`复制空间 ${spaceId} 道路初始化完成，共 ${payload.length} 条。`);
    }
  };

  window.CopySpaceSeedModule = api;
})();
