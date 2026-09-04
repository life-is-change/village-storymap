(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ActivityLoggerModule = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const STORAGE_KEY = "village_activity_events_v1";

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readEvents(storage) {
    try {
      const raw = storage?.getItem?.(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeEvents(storage, events) {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(events));
  }

  function createActivityLogger(deps = {}) {
    const storage = deps.storage || root?.localStorage;
    const now = deps.now || (() => new Date().toISOString());
    const uuid =
      deps.uuid ||
      (() => root?.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const getContext = deps.getContext || (() => ({}));
    const remote = deps.remote || null;
    const supabaseClient = deps.supabaseClient || null;

    function requireContext(context) {
      if (!context?.teachingProjectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
      if (!context?.villageId) throw new Error("VILLAGE_CONTEXT_REQUIRED");
      if (!context?.spaceId) throw new Error("SPACE_CONTEXT_REQUIRED");
      return context;
    }

    async function insertRemote(event) {
      if (remote?.insert) {
        return remote.insert(clone(event));
      }
      if (!supabaseClient?.from) {
        throw new Error("remote_not_configured");
      }
      const payload = {
        event_id: event.eventId,
        client_event_id: event.clientEventId,
        occurred_at: event.occurredAt,
        student_key: event.studentKey || null,
        student_name: event.studentName || null,
        course_id: event.courseId || null,
        teaching_project_id: event.teachingProjectId,
        village_id: event.villageId,
        group_id: event.groupId || null,
        task_id: event.taskId || null,
        space_id: event.spaceId || null,
        action: event.action,
        target_type: event.targetType || null,
        target_id: event.targetId || null,
        view_mode: event.viewMode || null,
        metadata: event.metadata || {}
      };
      const response = await supabaseClient
        .from("activity_events")
        .upsert(payload, { onConflict: "client_event_id", ignoreDuplicates: true });
      if (response?.error) throw response.error;
      return event.clientEventId;
    }

    async function record(action, target = {}, metadata = {}) {
      const context = requireContext((await getContext()) || {});
      const actor = context.actor || {};
      const clientEventId = String(uuid());
      const event = {
        eventId: clientEventId,
        clientEventId,
        occurredAt: now(),
        studentKey: actor.studentKey || context.studentKey || "",
        studentName: actor.name || context.studentName || "",
        courseId: context.courseId || "",
        teachingProjectId: context.teachingProjectId,
        villageId: context.villageId,
        groupId: context.groupId || "",
        taskId: context.taskId || "",
        spaceId: context.spaceId || "",
        action: String(action || "").trim(),
        targetType: String(target.type || "").trim(),
        targetId: String(target.id || "").trim(),
        viewMode: String(metadata.viewMode || context.viewMode || "").trim(),
        metadata: clone(metadata || {}),
        syncStatus: "pending"
      };
      const events = readEvents(storage);
      events.push(event);
      writeEvents(storage, events);
      return clone(event);
    }

    async function flush() {
      const events = readEvents(storage);
      let changed = false;
      for (const event of events) {
        if (event.syncStatus === "synced") continue;
        try {
          await insertRemote(event);
          event.syncStatus = "synced";
          delete event.syncError;
          changed = true;
        } catch (error) {
          event.syncStatus = "pending";
          event.syncError = error?.message || "sync_failed";
          changed = true;
        }
      }
      if (changed) writeEvents(storage, events);
      return clone(events);
    }

    function listLocalEvents(filters = {}) {
      return readEvents(storage)
        .filter((event) => !filters.action || event.action === filters.action)
        .filter((event) => !filters.groupId || event.groupId === filters.groupId)
        .filter((event) => !filters.studentKey || event.studentKey === filters.studentKey)
        .filter((event) => !filters.taskId || event.taskId === filters.taskId)
        .map(clone);
    }

    return {
      record,
      flush,
      listLocalEvents
    };
  }

  return {
    createActivityLogger,
    STORAGE_KEY
  };
});
