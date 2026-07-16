(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseAdminModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function filterActivityEvents(events, filters = {}) {
    const groupId = normalize(filters.groupId);
    const student = normalize(filters.student);
    const action = normalize(filters.action);
    const taskId = normalize(filters.taskId);
    const dateFrom = String(filters.dateFrom || "").slice(0, 10);
    const dateTo = String(filters.dateTo || "").slice(0, 10);
    return (Array.isArray(events) ? events : []).filter((event) => {
      if (groupId && normalize(event.group_id || event.groupId) !== groupId) return false;
      if (student && !normalize(event.student_name || event.studentName).includes(student)) return false;
      if (action && normalize(event.action) !== action) return false;
      if (taskId && normalize(event.task_id || event.taskId) !== taskId) return false;
      const eventDate = String(event.occurred_at || event.occurredAt || "").slice(0, 10);
      if (dateFrom && (!eventDate || eventDate < dateFrom)) return false;
      if (dateTo && (!eventDate || eventDate > dateTo)) return false;
      return true;
    });
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? `"${text}"` : text;
  }

  function exportEventsCsv(events) {
    const headers = ["操作时间", "学生", "小组", "任务", "操作类型", "对象类型", "对象编号", "视图", "空间编号"];
    const rows = (Array.isArray(events) ? events : []).map((event) => [
      event.occurred_at || event.occurredAt || "",
      event.student_name || event.studentName || "",
      event.group_id || event.groupId || "",
      event.task_id || event.taskId || "",
      event.action || "",
      event.target_type || event.targetType || "",
      event.target_id || event.targetId || "",
      event.view_mode || event.viewMode || "",
      event.space_id || event.spaceId || ""
    ]);
    return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  }

  function summarizeGroups(groups, memberships, progressRows) {
    const members = Array.isArray(memberships) ? memberships : [];
    const progress = Array.isArray(progressRows) ? progressRows : [];
    return (Array.isArray(groups) ? groups : []).map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: members.filter((row) => (row.group_id || row.groupId) === group.id).length,
      completedCount: new Set(progress
        .filter((row) => (row.group_id || row.groupId) === group.id && row.completed)
        .map((row) => row.student_key || row.studentKey)
        .filter(Boolean)).size
    }));
  }

  return { filterActivityEvents, exportEventsCsv, summarizeGroups };
});
