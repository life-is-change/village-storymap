import {parseOperation,fault} from './contracts.mjs';
const admin=new Set(['listPhotos','listMessages','listUsers','disableUser','createVillage','createTeachingProject','archiveTeachingProject','previewVillageRemoval','archiveVillage','restoreVillage','deleteVillage','saveDataset','publishDataset','bindFormalVillage','saveRealityModel','publishRealityModel','groupDashboard','groupContext','ensureGroupSpace']);
export function createCatalogService({database}){
 return {
  async execute(identity,action,input){
   if(!action.startsWith('catalog.')&&!(action.startsWith('admin.')&&admin.has(action.slice(6))))throw fault('NOT_FOUND');
   const parsed=parseOperation(action,input);
   return database.withIdentity(identity,async c=>{
    const sql=parsed.readOnly?'SELECT api_private.catalog_read($1,$2::jsonb) AS data':'SELECT api_private.catalog_write($1,$2::jsonb) AS data';
    return (await c.query(sql,[action,JSON.stringify(parsed.input)])).rows[0]?.data;
   },{readOnly:parsed.readOnly});
  },
  bootstrap(identity){return database.withIdentity(identity,async c=>(await c.query('SELECT api_private.catalog_bootstrap() AS data')).rows[0]?.data,{readOnly:true});}
 };
}
