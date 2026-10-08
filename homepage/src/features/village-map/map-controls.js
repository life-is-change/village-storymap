export const MAP_CONTROL_LAYOUT = {
  fullscreen: 'absolute right-4 top-4 z-[1000] pointer-events-auto',
  navigation: 'absolute bottom-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-auto',
};

/**
 * @param {{ zoomIn?: () => void, zoomOut?: () => void } | null} map
 * @param {'in' | 'out'} direction
 */
export function zoomMap(map, direction) {
  if (!map) return;

  if (direction === 'in') {
    map.zoomIn?.();
    return;
  }

  map.zoomOut?.();
}

/**
 * @param {{ centerAndZoom?: (point: unknown, zoom: number) => void } | null} map
 * @param {{ longitude: number, latitude: number, zoom: number }} homeRegion
 * @param {(longitude: number, latitude: number) => unknown} createPoint
 */
export function returnToHomeRegion(map, homeRegion, createPoint) {
  map?.centerAndZoom?.(createPoint(homeRegion.longitude, homeRegion.latitude), homeRegion.zoom);
}

/**
 * @param {HTMLElement | null} host
 */
export async function toggleMapFullscreen(host) {
  if (!host) return;

  if (document.fullscreenElement) {
    await document.exitFullscreen?.();
    return;
  }

  await host.requestFullscreen?.();
}
