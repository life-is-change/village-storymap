import {lstatSync,readFileSync} from 'node:fs';import {isAbsolute,resolve,relative,sep} from 'node:path';import {AUTH_ORIGIN} from '../src/config.mjs';import {poolOptions} from './database.mjs';
export function privateSecret(path){
 if(typeof path!=='string'||!isAbsolute(path))throw Error('INVALID_CONFIGURATION');
 const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.size>4096||process.platform==='linux'&&(stat.mode&0o077||stat.uid!==process.getuid()))throw Error('INVALID_CONFIGURATION');
 const text=readFileSync(path,'utf8').trim();if(text.length<24||text.length>256||/\s/.test(text))throw Error('INVALID_CONFIGURATION');return text;
}
export function loadUnifiedConfig(env=process.env,{readSecret=privateSecret}={}){
 const fail=()=>{throw Error('INVALID_CONFIGURATION');};
 if(env.PGPASSWORD!==undefined||env.BRIDGE_TOKEN!==undefined||env.SUPABASE_SECRET_KEY!==undefined||env.SUPABASE_AUTH_ORIGIN!==AUTH_ORIGIN||!env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')||!/^aliyun-[a-zA-Z0-9_-]{1,92}$/.test(env.UNIFIED_INSTANCE_ID??''))fail();
 const number=(value,fallback)=>{const text=value??String(fallback);if(!/^\d+$/.test(text)||Number(text)<1||Number(text)>65535)fail();return Number(text);};
 const path=name=>{if(!isAbsolute(env[name]??''))fail();return resolve(env[name]);};
 const filesRoot=path('UNIFIED_FILES_ROOT'),sceneRoot=path('UNIFIED_SCENE_ROOT'),legacyRoot=path('UNIFIED_LEGACY_ROOT'),indexPath=path('UNIFIED_LEGACY_INDEX'),releaseFile=path('UNIFIED_RELEASE_FILE');
 const within=(a,b)=>{const r=relative(a,b);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
 for(const a of [filesRoot,sceneRoot,legacyRoot])for(const b of [filesRoot,sceneRoot,legacyRoot])if(a!==b&&within(a,b))fail();if(new Set([filesRoot,sceneRoot,legacyRoot]).size!==3||[filesRoot,sceneRoot].some(root=>within(root,indexPath)||within(root,releaseFile)))fail();
 const database={host:env.PGHOST,port:number(env.PGPORT,5432),database:env.PGDATABASE,user:env.PGUSER,password:readSecret(env.PGPASSWORD_FILE)};poolOptions(database);
 if(env.BRIDGE_ENABLED!==undefined&&!['true','false'].includes(env.BRIDGE_ENABLED))fail();const enabled=env.BRIDGE_ENABLED==='true';if(enabled&&!env.BRIDGE_TOKEN_FILE)fail();
 return Object.freeze({authOrigin:AUTH_ORIGIN,publishableKey:env.SUPABASE_PUBLISHABLE_KEY,port:number(env.PORT,8080),instanceId:env.UNIFIED_INSTANCE_ID,database,filesRoot,sceneRoot,legacy:{root:legacyRoot,indexPath},releaseFile,bridge:{enabled,...(enabled?{token:readSecret(env.BRIDGE_TOKEN_FILE)}:{})}});
}
