(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyRealtimeControllerModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createSurveyRealtimeController({ client, loadLatest, onConnectionChange, debounceMs = 160 } = {}) {
    if (!client) throw new Error("REALTIME_CLIENT_REQUIRED");
    let channel = null;
    let context = null;
    let timer = null;

    function payloadMatches(payload) {
      const row = payload?.new || payload?.old || {};
      return (!row.teaching_project_id || row.teaching_project_id === context?.teachingProjectId)
        && (!row.village_id || row.village_id === context?.villageId);
    }

    function scheduleReload(payload) {
      if (!payloadMatches(payload)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void loadLatest?.(); }, debounceMs);
    }

    async function refreshAfterReconnect() {
      await loadLatest?.();
      onConnectionChange?.("connected");
    }

    async function stop() {
      clearTimeout(timer);
      timer = null;
      if (channel) await client.removeChannel?.(channel);
      channel = null;
      context = null;
    }

    async function start(nextContext) {
      await stop();
      context = { ...nextContext };
      onConnectionChange?.("connecting");
      channel = client.channel(`survey-review:${context.spaceId}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "survey_feature_reviews",
          filter: `space_id=eq.${context.spaceId}`
        }, scheduleReload)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "feature_edit_locks",
          filter: `space_id=eq.${context.spaceId}`
        }, scheduleReload)
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") await refreshAfterReconnect();
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            onConnectionChange?.("disconnected");
          }
        });
      return channel;
    }

    return { start, stop, refreshAfterReconnect };
  }

  return { createSurveyRealtimeController };
});
