(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ProjectSwitcherModule = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function createProjectSwitcher({
    mount = null,
    loadTarget = async (entry) => entry,
    unloadTarget = async () => {},
    hasUnsavedChanges = () => false,
    resolveUnsaved = async () => "cancel",
    commitContext = () => {},
    rollbackContext = () => {},
    getContext = () => null
  } = {}) {
    let entries = [];
    let changing = false;
    let queuedEntry = null;
    let queuedPromise = null;
    let resolveQueued = null;
    let rejectQueued = null;

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    }

    function option(entry) {
      const value = encodeURIComponent(JSON.stringify({
        teachingProjectId: entry.teachingProjectId,
        villageId: entry.villageId,
        villageRole: entry.villageRole || entry.role
      }));
      const disabled = entry.disabled ? " disabled" : "";
      return `<option value="${value}"${disabled}>${escapeHtml(entry.label || entry.villageName || "村庄")}</option>`;
    }

    function render() {
      if (!mount) return;
      const formal = entries.filter((entry) => (entry.villageRole || entry.role) === "formal");
      const practice = entries.filter((entry) => (entry.villageRole || entry.role) === "practice");
      mount.innerHTML = `<select data-project-switcher aria-label="当前村庄项目">
        ${formal.length ? `<optgroup label="正式村庄">${formal.map(option).join("")}</optgroup>` : ""}
        ${practice.length ? `<optgroup label="练习村庄">${practice.map(option).join("")}</optgroup>` : ""}
      </select>`;
      const select = mount.querySelector("[data-project-switcher]");
      const current = getContext();
      const selected = entries.find((entry) => entry.villageId === current?.villageId);
      if (selected) select.value = encodeURIComponent(JSON.stringify({
        teachingProjectId: selected.teachingProjectId,
        villageId: selected.villageId,
        villageRole: selected.villageRole || selected.role
      }));
      select.addEventListener("change", async () => {
        try {
          await api.switchTo(JSON.parse(decodeURIComponent(select.value)));
        } catch (_) {
          render();
        }
      });
    }

    const api = {
      mount(context = {}) {
        entries = Array.isArray(context.entries) ? [...context.entries] : entries;
        render();
      },
      refresh(nextEntries = entries) {
        entries = Array.isArray(nextEntries) ? [...nextEntries] : [];
        render();
      },
      async switchTo(entry) {
        if (!entry) return false;
        if (changing) {
          queuedEntry = entry;
          if (!queuedPromise) queuedPromise = new Promise((resolve, reject) => {
            resolveQueued = resolve;
            rejectQueued = reject;
          });
          return queuedPromise;
        }
        const previous = getContext();
        if (entry.villageId === previous?.villageId && entry.teachingProjectId === previous?.teachingProjectId) return true;
        if (hasUnsavedChanges()) {
          const decision = await resolveUnsaved(previous, entry);
          if (decision === "cancel") return false;
        }
        changing = true;
        try {
          const prepared = await loadTarget(entry, previous);
          await unloadTarget(previous, prepared);
          await commitContext(prepared || entry, previous);
          render();
          return true;
        } catch (error) {
          await rollbackContext(previous, entry, error);
          render();
          throw error;
        } finally {
          changing = false;
          if (queuedEntry) {
            const next = queuedEntry;
            const resolve = resolveQueued;
            const reject = rejectQueued;
            queuedEntry = null;
            queuedPromise = null;
            resolveQueued = null;
            rejectQueued = null;
            api.switchTo(next).then(resolve, reject);
          }
        }
      }
    };
    return api;
  }

  return { createProjectSwitcher };
});
