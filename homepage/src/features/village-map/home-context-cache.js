const CACHE_KEY = 'village_home_context_v1';

function normalizeContext(value) {
  if (!value || !Array.isArray(value.villages) || value.villages.length === 0) return null;
  const villages = value.villages.filter((village) => village && String(village.id || '').trim());
  if (!villages.length) return null;
  const preferredId = String(value.selectedVillageId || '');
  return {
    villages,
    selectedVillageId: villages.some((village) => String(village.id) === preferredId)
      ? preferredId
      : String(villages[0].id)
  };
}

export function readHomeContext(storage = globalThis.localStorage) {
  try {
    return normalizeContext(JSON.parse(storage?.getItem?.(CACHE_KEY) || 'null'));
  } catch (_) {
    return null;
  }
}

export function writeHomeContext(storage = globalThis.localStorage, value) {
  const context = normalizeContext(value);
  if (!context) return false;
  try {
    storage?.setItem?.(CACHE_KEY, JSON.stringify(context));
    return true;
  } catch (_) {
    return false;
  }
}

export { CACHE_KEY };
