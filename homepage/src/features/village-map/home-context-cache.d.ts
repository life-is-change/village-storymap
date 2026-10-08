export type HomeVillage = {
  id: string;
  name?: string;
  [key: string]: unknown;
};

export type HomeContext = {
  villages: HomeVillage[];
  selectedVillageId: string;
};

export declare const CACHE_KEY: string;
export declare function readHomeContext(storage?: Storage): HomeContext | null;
export declare function writeHomeContext(storage: Storage | undefined, value: HomeContext): boolean;
