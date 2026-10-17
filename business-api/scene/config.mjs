import {loadConfig as loadReadConfig} from '../src/config.mjs';
export function loadSceneConfig(env=process.env){
 if(env.PGUSER!=='village_scene_login'||env.PGDATABASE!=='village_scene_validation'||env.STORAGE_READ_ENABLED!==undefined)throw Error('INVALID_SCENE_CONFIGURATION');
 const config=loadReadConfig({...env,PGUSER:'village_api_login',PGDATABASE:'village_copy'});
 config.database={...config.database,user:env.PGUSER,database:env.PGDATABASE,maxConnections:2};return config;
}
