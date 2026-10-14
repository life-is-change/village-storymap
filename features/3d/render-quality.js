(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RenderQualityModule = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const STORAGE_KEY = 'village:render-quality';
  const MB = 1024 * 1024;
  function profile(mode, resolutionScale, modelBudget, detailPixels, cacheBytes, error, shadowMapSize) {
    return Object.freeze({
      mode, resolutionScale, modelBudget, detailPixels, shadows: mode === 'high',
      inset: Object.freeze({
        resolutionScale, cacheBytes, maximumScreenSpaceError: error,
        dynamicScreenSpaceError: mode !== 'high', preloadFlightDestinations: mode === 'high'
      }),
      thumbnail: Object.freeze({
        pixelRatio: resolutionScale, shadows: mode === 'high', shadowMapSize
      })
    });
  }
  const PROFILES = Object.freeze({
    low: profile('low', 0.75, 12, 140, 128 * MB, 16, 512),
    balanced: profile('balanced', 1, 24, 100, 256 * MB, 8, 1024),
    high: profile('high', 1.5, 48, 70, 384 * MB, 4, 2048)
  });
  const subscribers = new Set();
  const normalizeMode = mode => Object.prototype.hasOwnProperty.call(PROFILES, mode) ? mode : 'balanced';
  let mode = 'balanced';
  try { mode = normalizeMode(root.localStorage?.getItem(STORAGE_KEY)); } catch (_) {}

  function getMode() { return mode; }
  function getProfile(candidate) { return PROFILES[normalizeMode(candidate === undefined ? mode : candidate)]; }
  function notify() {
    subscribers.forEach(callback => {
      try { callback(mode, getProfile()); } catch (_) {}
    });
  }
  function setMode(candidate) {
    const next = normalizeMode(candidate);
    try { root.localStorage?.setItem(STORAGE_KEY, next); } catch (_) {}
    if (next !== mode) { mode = next; notify(); }
    return getProfile();
  }
  function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }
  function applyViewer(viewer, candidate) {
    const selected = getProfile(candidate);
    if (!viewer || viewer.isDestroyed?.()) return selected;
    viewer.resolutionScale = selected.resolutionScale;
    if ('shadows' in viewer) viewer.shadows = selected.shadows;
    viewer.scene?.requestRender?.();
    return selected;
  }
  root.addEventListener?.('storage', event => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const next = normalizeMode(event.newValue);
    if (next !== mode) { mode = next; notify(); }
  });
  return Object.freeze({ STORAGE_KEY, PROFILES, getMode, getProfile, setMode, subscribe, applyViewer });
});
