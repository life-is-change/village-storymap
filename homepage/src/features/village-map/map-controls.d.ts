export const MAP_CONTROL_LAYOUT: {
  fullscreen: string;
  navigation: string;
};
export function zoomMap(map: { zoomIn?: () => void; zoomOut?: () => void } | null, direction: 'in' | 'out'): void;
export function returnToHomeRegion(
  map: { centerAndZoom?: (point: unknown, zoom: number) => void } | null,
  homeRegion: { longitude: number; latitude: number; zoom: number },
  createPoint: (longitude: number, latitude: number) => unknown,
): void;
export function toggleMapFullscreen(host: HTMLElement | null): Promise<void>;
