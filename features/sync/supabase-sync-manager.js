(function () {
  const DEFAULT_DELAY_MS = 900;
  const DEFAULT_LOCAL_TTL_MS = 3500;
  const timers = new Map();
  const localWrites = new Map();

  function now() {
    return Date.now();
  }

  function cleanupLocalWrites() {
    const time = now();
    for (const [key, expiresAt] of localWrites.entries()) {
      if (expiresAt <= time) localWrites.delete(key);
    }
  }

  function normalizeKeyPart(value) {
    return String(value || "*").trim() || "*";
  }

  function buildWriteKey(table, spaceId, objectCode) {
    return [normalizeKeyPart(table), normalizeKeyPart(spaceId), normalizeKeyPart(objectCode)].join("|");
  }

  function schedule(key, fn, delayMs = DEFAULT_DELAY_MS) {
    const scheduleKey = normalizeKeyPart(key);
    if (timers.has(scheduleKey)) {
      clearTimeout(timers.get(scheduleKey));
    }
    timers.set(scheduleKey, setTimeout(async () => {
      timers.delete(scheduleKey);
      try {
        await fn();
      } catch (error) {
        console.warn(`[SupabaseSyncManager] ${scheduleKey} 刷新失败：`, error);
      }
    }, delayMs));
  }

  function markLocalWrite(table, options = {}) {
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_LOCAL_TTL_MS;
    const expiresAt = now() + ttlMs;
    const spaceId = options.spaceId || options.space_id || "*";
    const objectCodes = Array.isArray(options.objectCodes)
      ? options.objectCodes
      : (Array.isArray(options.object_codes) ? options.object_codes : []);

    cleanupLocalWrites();
    localWrites.set(buildWriteKey(table, spaceId, "*"), expiresAt);
    if (!objectCodes.length) {
      localWrites.set(buildWriteKey(table, "*", "*"), expiresAt);
      return;
    }
    objectCodes.forEach((code) => {
      localWrites.set(buildWriteKey(table, spaceId, code), expiresAt);
      localWrites.set(buildWriteKey(table, "*", code), expiresAt);
    });
  }

  function shouldSkipRealtime(table, payload = {}) {
    cleanupLocalWrites();
    const row = payload.new || payload.old || {};
    const spaceId = row.space_id || row.id || payload.space_id || "*";
    const objectCode = row.object_code || payload.object_code || "*";
    const candidates = [
      buildWriteKey(table, spaceId, objectCode),
      buildWriteKey(table, spaceId, "*"),
      buildWriteKey(table, "*", objectCode),
      buildWriteKey(table, "*", "*")
    ];
    const time = now();
    return candidates.some((key) => (localWrites.get(key) || 0) > time);
  }

  function debounce(fn, delayMs = DEFAULT_DELAY_MS) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    };
  }

  window.SupabaseSyncManager = {
    schedule,
    debounce,
    markLocalWrite,
    shouldSkipRealtime,
    cleanupLocalWrites
  };
})();
