export type VillageProfile = {
  id: string;
  name: string;
  location: string;
  tagline: string;
  description: string;
  statusItems: Array<{ title: string; desc: string }>;
  issueItems: Array<{ title: string; desc: string }>;
  longitude: number;
  latitude: number;
  zoom: number;
};

export const VILLAGES: VillageProfile[];
export const DEFAULT_VILLAGE_ID: string;
export const HOME_REGION: Pick<VillageProfile, 'name' | 'longitude' | 'latitude' | 'zoom'>;
export function getVillageById(id: string): VillageProfile;
