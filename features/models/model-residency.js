(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ModelResidencyModule = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * Event-driven GLB residency. Budget counts models, including pending loads.
   * load(entry) resolves one owned resource; unload(resource, entry) must dispose
   * it synchronously. setVisible(resource, visible, entry) controls scene/proxy
   * visibility (resource is null for a white/proxy fallback). Descriptor fields
   * are forwarded, with key, variant and the selected asset URL added.
   */
  function createModelResidencyManager(options = {}) {
    if (typeof options.load !== 'function' || typeof options.unload !== 'function') {
      throw new TypeError('Model residency requires load and unload callbacks');
    }
    const records = new Map();
    const pending = new Set();
    let view = new Map();
    let desired = [];
    let revision = 0;
    let destroyed = false;
    let pumping = false;
    let loaded = 0;
    let freed = 0;
    let failed = 0;

    function report(error, entry) {
      if (typeof options.onError === 'function') {
        try { options.onError(error, entry); } catch (_) { /* Keep cleanup progressing. */ }
      }
    }
    function limit() {
      const value = Number(options.getBudget ? options.getBudget() : 12);
      return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 12;
    }
    function threshold() {
      const value = Number(options.getDetailPixels ? options.getDetailPixels() : 100);
      return Number.isFinite(value) ? Math.max(0, value) : 100;
    }
    function entryFor(record, variant) {
      return { ...record.descriptor, key: record.key, variant,
        url: variant === 'low' ? record.descriptor.lowUrl : record.descriptor.url };
    }
    function visible(record, value, force = false) {
      if (!force && record.visible === value) return;
      record.visible = value;
      if (typeof options.setVisible === 'function') {
        try {
          options.setVisible(record.resource || null, value,
            record.resourceEntry || entryFor(record, record.wanted || 'detail'));
        } catch (error) { report(error, record.resourceEntry || record.descriptor); }
      }
    }
    function dispose(resource, entry) {
      if (resource == null) return;
      freed++;
      try { options.unload(resource, entry); } catch (error) { report(error, entry); }
    }
    function release(record) {
      if (record.resource == null) return;
      visible(record, false);
      const resource = record.resource;
      const entry = record.resourceEntry;
      record.resource = null;
      record.resourceEntry = null;
      dispose(resource, entry);
    }
    function residents() {
      return [...records.values()].filter(record => record.resource != null);
    }
    function invalidate(record) {
      if (record.pending) record.pending.stale = true;
      record.wanted = null;
    }
    function isCurrent(token) {
      return !destroyed && !token.stale && records.get(token.record.key) === token.record &&
        token.record.wanted === token.entry.variant &&
        entryFor(token.record, token.entry.variant).url === token.entry.url;
    }
    function settle(token, resource, error) {
      // Even invalid requests retain capacity until their results are disposed.
      const current = isCurrent(token);
      pending.delete(token);
      if (token.record.pending === token) token.record.pending = null;
      if (error) {
        if (current) {
          token.record.failedRevision = revision;
          failed++;
          report(error, token.entry);
          visible(token.record, false, true);
        }
      } else if (!current || resource == null) {
        dispose(resource, token.entry);
        if (current && resource == null) {
          token.record.failedRevision = revision;
          failed++;
          report(new Error('Model loader returned no resource'), token.entry);
        }
      } else {
        loaded++;
        token.record.resource = resource;
        token.record.resourceEntry = token.entry;
        const candidate = view.get(token.record.key);
        visible(token.record, !!candidate && candidate.inView !== false, true);
      }
      pump();
    }
    function pump() {
      if (pumping || destroyed) return;
      pumping = true;
      try {
        for (const record of desired) {
          if (pending.size >= 2 || residents().length + pending.size >= limit()) break;
          if (record.resource != null || record.pending || record.failedRevision === revision) continue;
          const token = { record, entry: entryFor(record, record.wanted), stale: false };
          record.pending = token;
          pending.add(token);
          try {
            Promise.resolve(options.load(token.entry)).then(
              resource => settle(token, resource, null), error => settle(token, null, error));
          } catch (error) { settle(token, null, error); }
        }
      } finally { pumping = false; }
    }
    function reconcile() {
      const budget = limit();
      const detailPixels = threshold();
      const candidates = [];
      for (const record of records.values()) {
        const candidate = view.get(record.key);
        let variant = null;
        if (candidate && (candidate.selected || candidate.inView !== false)) {
          const previous=record.wanted||record.resourceEntry?.variant;
          // A small dead band prevents camera jitter from repeatedly reallocating both LODs.
          const switchPixels=previous==='detail'?detailPixels*.85:previous==='low'?detailPixels*1.15:detailPixels;
          if ((candidate.selected && !record.descriptor.lowUrl) || candidate.pixels >= switchPixels) variant = 'detail';
          else if (record.descriptor.lowUrl) variant = 'low';
        }
        if (variant && entryFor(record, variant).url) candidates.push({ record, candidate, variant });
      }
      candidates.sort((a, b) => Number(!!b.candidate.selected) - Number(!!a.candidate.selected) ||
        b.candidate.pixels - a.candidate.pixels ||
        (String(a.record.key) < String(b.record.key) ? -1 : String(a.record.key) > String(b.record.key) ? 1 : 0));
      const chosen = candidates.slice(0, budget);
      const wanted = new Map(chosen.map(item => [item.record, item.variant]));
      desired = chosen.map(item => item.record);
      // Retain only out-of-view residents in unused slots, newest use first.
      const cache = residents().filter(record => !wanted.has(record) &&
        (!view.has(record.key) || view.get(record.key).inView === false))
        .sort((a, b) => b.lastUsed - a.lastUsed);
      const keepCache = new Set(cache.slice(0, Math.max(0, budget - chosen.length - pending.size)));
      for (const record of records.values()) {
        const next = wanted.get(record) || null;
        if (record.pending && (record.pending.entry.variant !== next ||
          record.pending.entry.url !== (next && entryFor(record, next).url))) record.pending.stale = true;
        record.wanted = next;
        if (next) {
          record.lastUsed = revision;
          if (record.resourceEntry && (record.resourceEntry.variant !== next ||
            record.resourceEntry.url !== entryFor(record, next).url)) release(record);
          if (record.resource != null) {
            const candidate = view.get(record.key);
            visible(record, !!candidate && candidate.inView !== false);
          } else visible(record, false, true);
        } else {
          if (keepCache.has(record)) visible(record, false);
          else release(record);
          if (record.resource == null) visible(record, false, true);
        }
      }
      // A smaller budget may leave uncancellable old requests. Free residents
      // first, then wait for those requests before starting replacement loads.
      for (const record of residents().sort((a, b) => {
        const ai = desired.indexOf(a), bi = desired.indexOf(b);
        return (bi < 0 ? Infinity : bi) - (ai < 0 ? Infinity : ai);
      })) {
        if (residents().length + pending.size <= budget) break;
        release(record);
      }
      pump();
    }
    function register(key, descriptor) {
      if (destroyed) return;
      if (!descriptor || !descriptor.url) throw new TypeError('Model descriptor requires a URL');
      const previous = records.get(key);
      if (previous && previous.descriptor.url === descriptor.url &&
          previous.descriptor.lowUrl === descriptor.lowUrl && previous.descriptor.revision === descriptor.revision) {
        previous.descriptor = { ...descriptor };
      } else {
        if (previous) { invalidate(previous); release(previous); }
        records.set(key, { key, descriptor: { ...descriptor }, resource: null,
          resourceEntry: null, pending: null, wanted: null, visible: false,
          lastUsed: revision, failedRevision: -1 });
      }
      reconcile();
    }
    function unregister(key) {
      const record = records.get(key);
      if (!record) return;
      invalidate(record); release(record);
      records.delete(key); view.delete(key);
      reconcile();
    }
    function fail(key,error) {
      const record=records.get(key);if(!record||destroyed)return;
      const entry=record.resourceEntry||entryFor(record,record.wanted||'detail');
      invalidate(record);release(record);record.failedRevision=revision;failed++;
      options.onError?.(error,entry);pump();
    }
    function update(items = []) {
      if (destroyed) return;
      revision++;
      view = new Map(items.map(item => [item.key, { ...item,
        pixels: Math.max(0, Number(item.pixels) || 0) }]));
      reconcile();
    }
    function clear() {
      for (const record of records.values()) { invalidate(record); release(record); }
      records.clear(); view.clear(); desired = [];
      revision++;
    }
    function destroy() { destroyed = true; clear(); }
    function getState(key) {
      const record = records.get(key);
      if (!record) return null;
      const entry = record.resourceEntry || (record.wanted ? entryFor(record, record.wanted) : null);
      return { key, url: entry ? entry.url : null, variant: entry ? entry.variant : null,
        visible: record.visible, resident: record.resource != null, inFlight: !!record.pending,
        wanted: record.wanted, status: record.resource != null ? 'resident' :
          record.pending ? 'loading' : record.failedRevision === revision ? 'error' :
          record.wanted ? 'queued' : 'fallback' };
    }
    function getStats() {
      const resident = residents();
      return { registered: records.size, resident: resident.length,
        visible: resident.filter(record => record.visible).length,
        cached: resident.filter(record => !record.visible).length,
        inFlight: pending.size, queued: desired.filter(record => record.resource == null &&
          !record.pending && record.failedRevision !== revision).length,
        budget: limit(), loaded, freed, failed, destroyed };
    }
    return { register, unregister, fail, update, clear, destroy, getState, getStats };
  }
  return { createModelResidencyManager };
});
