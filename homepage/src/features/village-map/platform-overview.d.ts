export interface PlatformStatistics { registeredUsers:number; villageCount:number; areaSquareMeters:number; measuredVillages:number }
export function overviewStats(stats:PlatformStatistics|null):{label:string;value:string}[];
export const CASE_STUDIES:{title:string;source:string;tag:string;description:string;url:string}[];
