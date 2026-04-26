(function () {
  function isPointInPolygon2D(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const zi = polygon[i].z;
      const xj = polygon[j].x;
      const zj = polygon[j].z;

      const intersect =
        ((zi > point.z) !== (zj > point.z)) &&
        (point.x < ((xj - xi) * (point.z - zi)) / ((zj - zi) || 1e-9) + xi);

      if (intersect) inside = !inside;
    }
    return inside;
  }

  const api = {
    isPointInPolygon2D(point, polygon) {
      return isPointInPolygon2D(point, polygon);
    },

    getPolygonOuterRing(geom) {
      if (!geom) return [];
      if (geom.type === "Polygon") {
        return Array.isArray(geom.coordinates?.[0]) ? geom.coordinates[0] : [];
      }
      if (geom.type === "MultiPolygon") {
        return Array.isArray(geom.coordinates?.[0]?.[0]) ? geom.coordinates[0][0] : [];
      }
      return [];
    },

    lonLatToMcXZ(lon, lat, config) {
      const {
        min_lon,
        min_lat,
        max_lon,
        max_lat,
        mc_origin_x,
        mc_origin_z,
        mc_width,
        mc_depth
      } = config;

      const lonSpan = max_lon - min_lon;
      const latSpan = max_lat - min_lat;

      if (!lonSpan || !latSpan) {
        throw new Error("mc_sync_config 经纬度范围无效。");
      }

      const nx = (lon - min_lon) / lonSpan;
      const nz = (lat - min_lat) / latSpan;

      const x = Math.round(mc_origin_x + nx * mc_width);
      const z = Math.round(mc_origin_z + (1 - nz) * mc_depth);

      return { x, z };
    },

    polygonRingToMcFootprintBlocks(ring, config) {
      const blocks = [];
      if (!Array.isArray(ring) || ring.length < 4) return blocks;

      const mcPoints = ring.map(([lon, lat]) => api.lonLatToMcXZ(lon, lat, config));

      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      mcPoints.forEach((p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      });

      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (api.isPointInPolygon2D({ x, z }, mcPoints)) {
            blocks.push({ x, z });
          }
        }
      }

      return blocks;
    },

    inferHeightBlocksFromProps(props = {}) {
      const raw =
        props["建筑高度"] ||
        props["房屋高度"] ||
        props["height"] ||
        props["HEIGHT"] ||
        props["楼层"] ||
        props["层数"] ||
        "";

      const text = String(raw).trim();
      const num = Number(text.match(/-?\d+(\.\d+)?/)?.[0]);

      if (Number.isFinite(num)) {
        if (text.includes("层")) return Math.max(3, Math.round(num * 3));
        return Math.max(3, Math.round(num));
      }

      return 4;
    },

    async loadMcSyncConfig(deps, villageId = deps.MC_VILLAGE_ID) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) throw new Error("未配置 Supabase，无法读取 MC 配置。");

      const { data, error } = await supabaseClient
        .from(deps.MC_SYNC_CONFIG_TABLE)
        .select("*")
        .eq("village_id", villageId)
        .single();

      if (error) throw error;
      return data;
    },

    async exportCurrentSpaceBuildingsToMc(deps) {
      const supabaseClient = deps.getSupabaseClient();
      if (!supabaseClient) {
        throw new Error("未配置 Supabase，无法导出到 MC。");
      }

      const spaceId = deps.getCurrentSpaceId();
      const config = await api.loadMcSyncConfig(deps, deps.MC_VILLAGE_ID);
      const dbRows = await deps.listBuildingFeaturesFromDb(spaceId);

      if (!dbRows.length) {
        throw new Error("当前空间没有可导出的建筑。");
      }

      const payload = dbRows.map((row) => {
        const ring = api.getPolygonOuterRing(row.geom);
        const footprintBlocks = api.polygonRingToMcFootprintBlocks(ring, config);

        let bbox = null;
        if (footprintBlocks.length) {
          const xs = footprintBlocks.map((b) => b.x);
          const zs = footprintBlocks.map((b) => b.z);
          bbox = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minZ: Math.min(...zs),
            maxZ: Math.max(...zs)
          };
        }

        return {
          village_id: deps.MC_VILLAGE_ID,
          space_id: spaceId,
          object_code: row.object_code,
          object_name: row.object_name || row.object_code,
          source: "web",
          footprint_blocks: footprintBlocks,
          bbox,
          base_y: config.mc_origin_y || 64,
          height_blocks: api.inferHeightBlocksFromProps(row.props || {}),
          block_type: "minecraft:white_concrete",
          geom: row.geom,
          props: row.props || {}
        };
      });

      const chunkSize = 100;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);

        const { error } = await supabaseClient
          .from(deps.MC_BUILDING_STATE_TABLE)
          .upsert(chunk, {
            onConflict: "village_id,space_id,object_code"
          });

        if (error) throw error;
      }

      deps.invalidateBuildingDbCache(spaceId);
      return payload.length;
    },

    bindMcExportButton(deps) {
      const spaceList = deps.getSpaceList();
      if (!spaceList) return;

      spaceList.addEventListener("click", async (e) => {
        const exportBtn = e.target.closest("#exportToMcBtn");
        if (!exportBtn) return;

        exportBtn.disabled = true;
        const oldText = exportBtn.textContent;

        try {
          exportBtn.textContent = "导出中...";
          const count = await api.exportCurrentSpaceBuildingsToMc(deps);
          deps.alert(`已成功导出 ${count} 栋建筑到 MC 桥接表。`);
        } catch (error) {
          console.error(error);
          deps.alert(`导出到 MC 失败：${error.message || error}`);
        } finally {
          exportBtn.disabled = false;
          exportBtn.textContent = oldText;
        }
      });
    }
  };

  window.McBridgeModule = api;
})();
