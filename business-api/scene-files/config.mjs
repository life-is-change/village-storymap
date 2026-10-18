import {isAbsolute,resolve,relative,sep} from 'node:path';import {loadConfig} from '../src/config.mjs';
function within(a,b){const r=relative(resolve(a),resolve(b));return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);}
export function loadSceneFilesConfig(env=process.env){
 if(env.PGUSER!=='village_scene_files_login'||env.PGDATABASE!=='village_scene_files_validation'||env.STORAGE_READ_ENABLED!==undefined||!env.SCENE_FILES_ROOT||!isAbsolute(env.SCENE_FILES_ROOT))throw Error('INVALID_FILES_CONFIGURATION');
 const config=loadConfig({...env,PGUSER:'village_api_login',PGDATABASE:'village_copy'});config.database={...config.database,user:env.PGUSER,database:env.PGDATABASE,maxConnections:2};config.filesRoot=resolve(env.SCENE_FILES_ROOT);
 if(Boolean(env.SCENE_LEGACY_ROOT)!==Boolean(env.SCENE_LEGACY_INDEX))throw Error('INVALID_FILES_CONFIGURATION');if(env.SCENE_LEGACY_ROOT){if(!isAbsolute(env.SCENE_LEGACY_ROOT)||!isAbsolute(env.SCENE_LEGACY_INDEX)||within(env.SCENE_LEGACY_ROOT,config.filesRoot)||within(config.filesRoot,env.SCENE_LEGACY_ROOT)||within(config.filesRoot,env.SCENE_LEGACY_INDEX))throw Error('INVALID_FILES_CONFIGURATION');config.legacy={root:env.SCENE_LEGACY_ROOT,indexPath:env.SCENE_LEGACY_INDEX};}return config;
}
