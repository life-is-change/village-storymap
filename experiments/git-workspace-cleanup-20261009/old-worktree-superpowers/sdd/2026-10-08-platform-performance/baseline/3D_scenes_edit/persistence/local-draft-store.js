(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneLocalDraftStoreModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function requirePart(identity, key) {
    const value = identity?.[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Draft identity requires ${key}`);
    return value.trim();
  }

  function buildDraftKey(identity) {
    const scope = identity?.scopeKind === "admin_sandbox"
      ? `admin_sandbox:${requirePart(identity, "ownerId")}`
      : requirePart(identity, "groupId");
    return `scene-edit:${requirePart(identity, "userId")}:${scope}:${requirePart(identity, "spaceId")}:${requirePart(identity, "projectId")}`;
  }

  function createLocalDraftStore(storage) {
    const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!target) throw new Error("Local draft storage is unavailable");
    return {
      read(identity) {
        const key = buildDraftKey(identity);
        const raw = target.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
          target.removeItem(key);
          return null;
        }
      },
      write(identity, record) {
        target.setItem(buildDraftKey(identity), JSON.stringify(record));
        return record;
      },
      remove(identity, revision) {
        const key = buildDraftKey(identity);
        if (revision !== undefined) {
          const raw = target.getItem(key);
          if (raw) {
            try {
              const current = JSON.parse(raw);
              if (current?.revision !== revision) return false;
            } catch (_error) {
              // Broken records are safe to discard.
            }
          }
        }
        target.removeItem(key);
        return true;
      }
    };
  }

  return { buildDraftKey, createLocalDraftStore };
});
