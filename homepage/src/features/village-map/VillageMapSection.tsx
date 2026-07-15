import { useEffect, useId, useRef, useState } from 'react';
import { Expand, LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { HOME_REGION, VILLAGES, DEFAULT_VILLAGE_ID, getVillageById } from './village-data.js';
import { MAP_CONTROL_LAYOUT, returnToHomeRegion, toggleMapFullscreen, zoomMap } from './map-controls.js';

const TDT_TOKEN = 'a2a034ff8616a35957abf8951339fedb';
const TDT_SCRIPT_ID = 'tianditu-javascript-api';
const DEFAULT_VILLAGE = getVillageById(DEFAULT_VILLAGE_ID);

type TianDiTuMap = {
  addLayer: (layer: unknown) => void;
  centerAndZoom: (point: unknown, zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

type TianDiTuApi = {
  Map: new (elementId: string) => TianDiTuMap;
  LngLat: new (longitude: number, latitude: number) => unknown;
  TileLayer: new (url: string, options: { minZoom: number; maxZoom: number }) => unknown;
};

declare global {
  interface Window {
    T?: TianDiTuApi;
  }
}

let tianDiTuScript: Promise<TianDiTuApi> | undefined;

function loadTianDiTuApi() {
  if (window.T) return Promise.resolve(window.T);
  if (tianDiTuScript) return tianDiTuScript;

  tianDiTuScript = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(TDT_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript ?? document.createElement('script');

    const handleLoad = () => (window.T ? resolve(window.T) : reject(new Error('天地图 SDK 未能初始化')));
    const handleError = () => reject(new Error('天地图 SDK 加载失败'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.id = TDT_SCRIPT_ID;
      script.src = `https://api.tianditu.gov.cn/api?v=4.0&tk=${TDT_TOKEN}`;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return tianDiTuScript;
}

function tileUrl(layer: 'img' | 'cia') {
  return `https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TOKEN}`;
}

type VillageMapSectionProps = {
  selectedVillageId: string;
  onVillageChange: (villageId: string) => void;
};

export function VillageMapSection({ selectedVillageId, onVillageChange }: VillageMapSectionProps) {
  const mapElementId = `village-map-${useId().replaceAll(':', '')}`;
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TianDiTuMap | null>(null);
  const apiRef = useRef<TianDiTuApi | null>(null);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const selectedVillage = getVillageById(selectedVillageId);

  useEffect(() => {
    let isActive = true;

    loadTianDiTuApi()
      .then((api) => {
        if (!isActive) return;

        const map = new api.Map(mapElementId);
        map.addLayer(new api.TileLayer(tileUrl('img'), { minZoom: 1, maxZoom: 18 }));
        map.addLayer(new api.TileLayer(tileUrl('cia'), { minZoom: 1, maxZoom: 18 }));
        map.centerAndZoom(new api.LngLat(DEFAULT_VILLAGE.longitude, DEFAULT_VILLAGE.latitude), DEFAULT_VILLAGE.zoom);
        apiRef.current = api;
        mapRef.current = map;
        setMapStatus('ready');
      })
      .catch(() => {
        if (isActive) setMapStatus('error');
      });

    return () => {
      isActive = false;
      mapRef.current = null;
      apiRef.current = null;
    };
  }, [mapElementId]);

  useEffect(() => {
    const map = mapRef.current;
    const api = apiRef.current;
    if (!map || !api) return;

    map.centerAndZoom(new api.LngLat(selectedVillage.longitude, selectedVillage.latitude), selectedVillage.zoom);
  }, [selectedVillage]);

  const returnHome = () => {
    if (!apiRef.current) return;
    returnToHomeRegion(mapRef.current, HOME_REGION, (longitude, latitude) => new apiRef.current!.LngLat(longitude, latitude));
  };

  return (
    <div className="mt-12 overflow-hidden rounded-3xl border border-emerald-100 bg-emerald-50/70 shadow-xl shadow-emerald-900/5">
      <div className="grid lg:grid-cols-[minmax(17rem,0.52fr)_minmax(0,1.48fr)]">
        <article className="flex min-h-[29rem] flex-col bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 text-slate-700 sm:p-7">
          <div className="mb-6">
            <label htmlFor="village-selector" className="mb-2 block text-sm font-semibold text-emerald-800">选择村庄</label>
            <div className="relative">
              <select
                id="village-selector"
                aria-label="选择村庄"
                value={selectedVillageId}
                onChange={(event) => onVillageChange(event.target.value)}
                className="w-full appearance-none rounded-xl border border-emerald-200 bg-white px-4 py-3 pr-10 text-base font-semibold text-emerald-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              >
                {VILLAGES.map((village) => <option key={village.id} value={village.id} className="text-slate-900">{village.name}</option>)}
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-700">⌄</span>
            </div>
          </div>

          <div className="mb-5 flex items-center gap-2 text-emerald-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100"><MapPin className="h-4 w-4" /></span>
            <span className="text-sm font-medium">{selectedVillage.location}</span>
          </div>
          <h3 className="mb-2 text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">{selectedVillage.name}</h3>
          <p className="mb-5 text-base font-medium text-emerald-700">{selectedVillage.tagline}</p>
          <p className="max-w-md text-sm leading-7 text-slate-600">{selectedVillage.description}</p>
          <p className="mt-6 border-t border-emerald-100 pt-4 text-xs leading-5 text-emerald-700/80">新增村庄时，在配置中补充名称、简介与中心点即可。</p>
        </article>

        <div ref={hostRef} className="relative isolate min-h-[29rem] bg-slate-100" aria-label="村庄位置地图">
          <div id={mapElementId} className="absolute inset-0 z-0" />
          {mapStatus !== 'ready' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100/90 px-6 text-center text-slate-600">
              {mapStatus === 'loading' ? '正在加载天地图…' : '地图暂时无法加载，请稍后重试。'}
            </div>
          )}
          <div className={MAP_CONTROL_LAYOUT.fullscreen} style={{ zIndex: 1000 }}>
            <button type="button" aria-label="全屏地图" title="全屏地图" onClick={() => void toggleMapFullscreen(hostRef.current)} className="map-control-button"><Expand className="h-5 w-5" /></button>
          </div>
          <div className={MAP_CONTROL_LAYOUT.navigation} style={{ zIndex: 1000 }}>
            <button type="button" aria-label="放大地图" title="放大地图" onClick={() => zoomMap(mapRef.current, 'in')} className="map-control-button"><Plus className="h-5 w-5" /></button>
            <button type="button" aria-label="缩小地图" title="缩小地图" onClick={() => zoomMap(mapRef.current, 'out')} className="map-control-button"><Minus className="h-5 w-5" /></button>
            <button type="button" aria-label="返回主区域" title="返回主区域" onClick={returnHome} className="map-control-button"><LocateFixed className="h-5 w-5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
