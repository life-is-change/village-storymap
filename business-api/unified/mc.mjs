import {createRequire} from 'node:module';
import {parseOperation,fault,MAX_JSON_BYTES} from './contracts.mjs';
const math=createRequire(import.meta.url)('../../features/mc/mc-bridge.js');
export function buildMcPayload(context,config,features){
 const fields=['min_lon','max_lon','min_lat','max_lat','mc_origin_x','mc_origin_y','mc_origin_z','mc_width','mc_depth'];
 if(!config||fields.some(k=>!Number.isFinite(config[k]))||config.max_lon<=config.min_lon||config.max_lat<=config.min_lat||config.mc_width<=0||config.mc_depth<=0)throw fault('INVALID_INPUT');
 if(!Array.isArray(features)||features.length>1000)throw fault('PAYLOAD_TOO_LARGE');let cells=0,work=0;
 const result=features.map(row=>{
  const ring=math.getPolygonOuterRing(row.geom);if(ring.length<4||ring.length>10000||ring.some(p=>!Array.isArray(p)||p.length<2||p.some(v=>!Number.isFinite(v))))throw fault('INVALID_INPUT');
  const points=ring.map(p=>math.lonLatToMcXZ(p[0],p[1],config)),xs=points.map(p=>p.x),zs=points.map(p=>p.z);
  const area=(Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...zs)-Math.min(...zs)+1);cells+=area;work+=area*ring.length;if(!Number.isSafeInteger(cells)||work>2000000||cells>100000)throw fault('PAYLOAD_TOO_LARGE');
  const footprint=math.polygonRingToMcFootprintBlocks(ring,config);const fx=footprint.map(p=>p.x),fz=footprint.map(p=>p.z);
  return {village_id:context.villageId,space_id:context.spaceId,object_code:row.object_code,object_name:row.object_name||row.object_code,source:'web',footprint_blocks:footprint,bbox:footprint.length?{minX:Math.min(...fx),maxX:Math.max(...fx),minZ:Math.min(...fz),maxZ:Math.max(...fz)}:null,base_y:config.mc_origin_y||64,height_blocks:Math.min(4096,math.inferHeightBlocksFromProps(row.props||{})),block_type:'minecraft:white_concrete',geom:row.geom,props:row.props||{}};
 });if(Buffer.byteLength(JSON.stringify(result))>MAX_JSON_BYTES)throw fault('PAYLOAD_TOO_LARGE');return result;
}
export function createMcService({database}){
 const getConfig=(identity,input)=>{const {input:p}=parseOperation('mc.getConfig',input);return database.withIdentity(identity,async c=>(await c.query('SELECT api_private.mc_context($1::jsonb,false) AS data',[JSON.stringify(p)])).rows[0]?.data?.config,{readOnly:true});};
 const exportBuildings=async(identity,input)=>{const {input:p}=parseOperation('mc.exportBuildings',input);return database.withIdentity(identity,async c=>{
  const data=(await c.query('SELECT api_private.mc_context($1::jsonb,true) AS data',[JSON.stringify(p)])).rows[0]?.data;
  const payload=buildMcPayload(p,data?.config,data?.features);
  return (await c.query('SELECT api_private.mc_export($1::jsonb,$2::jsonb) AS data',[JSON.stringify(p),JSON.stringify(payload)])).rows[0]?.data;
 });};
 return {getConfig,exportBuildings,execute(identity,action,input){if(action==='mc.getConfig')return getConfig(identity,input);if(action==='mc.exportBuildings')return exportBuildings(identity,input);throw fault('NOT_FOUND');}};
}
