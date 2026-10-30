(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SurveyRealtimeControllerModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createSurveyRealtimeController({ client, services, loadLatest, onConnectionChange, debounceMs = 160 } = {}) {
    if (services?.events) return services.events.createClient({ onInvalidate: () => loadLatest?.(), onConnectionChange });
    if (!client) throw new Error("REALTIME_CLIENT_REQUIRED");
    let channel = null;
    let context = null;
    let timer = null;
    let generation = 0;

    function payloadMatches(payload) {
      const row = payload?.new || payload?.old || {};
      return (!row.teaching_project_id || row.teaching_project_id === context?.teachingProjectId)
        && (!row.village_id || row.village_id === context?.villageId);
    }

    function scheduleReload(payload) {
      if (!payloadMatches(payload)) return;
      clearTimeout(timer);
      const epoch = generation;
      timer = setTimeout(() => { void refreshAfterReconnect(epoch); }, debounceMs);
    }

    async function refreshAfterReconnect(epoch = generation) {
      try {
        await loadLatest?.();
        if (epoch === generation) onConnectionChange?.("connected");
      } catch (error) {
        if (epoch === generation) onConnectionChange?.("disconnected", { code: error?.message });
      }
    }

    async function stop() {
      generation++;
      clearTimeout(timer);
      timer = null;
      const previous = channel;
      channel = null;
      context = null;
      if (previous) await client.removeChannel?.(previous);
    }

    async function start(nextContext) {
      const stopping = stop(), epoch = generation;
      await stopping;
      if (epoch !== generation) return null;
      context = { ...nextContext };
      onConnectionChange?.("connecting");
      channel = client.channel(`survey-review:${context.spaceId}`)
        .on("postgres_changes", {
          event: "*", schema: "public", table: "survey_feature_reviews",
          filter: `space_id=eq.${context.spaceId}`
        }, (payload) => { if (epoch === generation) scheduleReload(payload); })
        .on("postgres_changes", {
          event: "*", schema: "public", table: "feature_edit_locks",
          filter: `space_id=eq.${context.spaceId}`
        }, (payload) => { if (epoch === generation) scheduleReload(payload); })
        .subscribe(async (status) => {
          if (epoch !== generation) return;
          if (status === "SUBSCRIBED") await refreshAfterReconnect(epoch);
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
