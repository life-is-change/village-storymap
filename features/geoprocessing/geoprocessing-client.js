(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GeoprocessingClientModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function assertNoError(response) {
    if (response?.error) throw response.error;
    return response?.data ?? null;
  }

  function normalizeParameters(parameters = {}) {
    return {
      building_threshold: Number(parameters.building_threshold ?? parameters.building_score_threshold ?? 0.35),
      contour_interval: Number(parameters.contour_interval ?? parameters.contour_interval_m ?? 5),
      contour_smoothing: Number(parameters.contour_smoothing ?? parameters.smoothing_sigma ?? 1)
    };
  }

  function createGeoprocessingClient({ supabaseClient, fetchImpl = globalThis.fetch }) {
    if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
    const artifactLayerMap = Object.freeze({
      buildings: "building",
      roads: "road",
      waterways: "water",
      water_areas: "water",
      contours: "contours"
    });
    return {
      async getVillage(villageId) {
        return assertNoError(await supabaseClient.from("geoprocessing_villages")
          .select("village_id,display_name,bounds,max_aoi_sq_km,active")
          .eq("village_id", villageId).eq("active", true).single());
      },
      async submit(payload) {
        const args = {
          p_course_id: String(payload.courseId),
          p_village_id: String(payload.villageId),
          p_requested_steps: Array.from(payload.requestedSteps || []),
          p_aoi: payload.aoi,
          p_parameters: normalizeParameters(payload.parameters)
        };
        return assertNoError(await supabaseClient.rpc("submit_geoprocessing_run", args));
      },
      async getAvailability() {
        const data = assertNoError(await supabaseClient.rpc("get_worker_availability", {}));
        return Array.isArray(data) ? (data[0] || { state: "offline" }) : (data || { state: "offline" });
      },
      async getRun(runId) {
        return assertNoError(await supabaseClient.from("geoprocessing_runs")
          .select("*").eq("id", runId).single());
      },
      async listMine(villageId) {
        return assertNoError(await supabaseClient.from("geoprocessing_runs")
          .select("*").eq("village_id", villageId).order("created_at", { ascending: false }));
      },
      subscribe(runId, onChange) {
        const channel = supabaseClient.channel(`geoprocessing-run-${runId}`)
          .on("postgres_changes", {
            event: "UPDATE", schema: "public", table: "geoprocessing_runs", filter: `id=eq.${runId}`
          }, (event) => onChange(event.new))
          .subscribe();
        const timer = setInterval(async () => {
          try { onChange(await this.getRun(runId)); } catch (_) { /* keep polling */ }
        }, 10000);
        timer.unref?.();
        return () => {
          clearInterval(timer);
          supabaseClient.removeChannel(channel);
        };
      },
      async cancel(runId) {
        return assertNoError(await supabaseClient.rpc("request_geoprocessing_cancel", { p_run_id: runId }));
      },
      async listArtifacts(runId) {
        return assertNoError(await supabaseClient.from("geoprocessing_artifacts")
          .select("*").eq("run_id", runId).order("artifact_type"));
      },
      async isRunImported(runId) {
        const rows = assertNoError(await supabaseClient.from("personal_result_bundles")
          .select("id").eq("source_run_id", String(runId)).limit(1));
        return Array.isArray(rows) && rows.length > 0;
      },
      async createArtifactUrl(path) {
        return assertNoError(await supabaseClient.storage.from("geoprocessing-results")
          .createSignedUrl(path, 300));
      },
      async importRun(runId, providedArtifacts = null) {
        if (typeof fetchImpl !== "function") throw new Error("FETCH_REQUIRED");
        const artifacts = Array.isArray(providedArtifacts)
          ? providedArtifacts
          : await this.listArtifacts(runId);
        const layers = {};
        for (const artifact of artifacts) {
          const layerKey = artifactLayerMap[artifact?.artifact_type];
          if (!layerKey) continue;
          const signed = await this.createArtifactUrl(artifact.storage_path);
          const url = signed?.signedUrl || signed?.signedURL;
          if (!url) throw new Error("ARTIFACT_SIGNED_URL_REQUIRED");
          const response = await fetchImpl(url);
          if (!response?.ok) throw new Error(`ARTIFACT_DOWNLOAD_${response?.status || "FAILED"}`);
          const geojson = await response.json();
          if (geojson?.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
            throw new Error("INVALID_ARTIFACT_GEOJSON");
          }
          if (!layers[layerKey]) layers[layerKey] = { type: "FeatureCollection", features: [] };
          layers[layerKey].features.push(...geojson.features);
        }
        if (!Object.keys(layers).length) throw new Error("NO_IMPORTABLE_ARTIFACTS");
        return assertNoError(await supabaseClient.rpc("import_geoprocessing_result", {
          p_run_id: String(runId),
          p_layers: layers
        }));
      }
    };
  }

  return { createGeoprocessingClient, normalizeParameters };
});
