import {lstatSync,readFileSync} from 'node:fs';
export const AUTH_ORIGIN='https://rzmbmwauomzwiyenafha.supabase.co';
export function loadConfig(env=process.env){
  const fail=()=>{throw new Error('INVALID_CONFIGURATION');};
  const integer=(name,fallback)=>{const s=env[name]??String(fallback);if(!/^\d+$/.test(s)||Number(s)<1||Number(s)>65535)fail();return Number(s);};
  if(env.SUPABASE_AUTH_ORIGIN!==AUTH_ORIGIN||!env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_'))fail();
  const key=env.SUPABASE_PUBLISHABLE_KEY;
  if(!key.startsWith('sb_publishable_')){try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role!=='anon')fail();}catch{fail();}}
  if(env.PGUSER!=='village_api_login'||env.PGDATABASE!=='village_copy'||!env.PGHOST||!/^[a-zA-Z0-9.-]+$/.test(env.PGHOST))fail();
  let password;
  try{const st=lstatSync(env.PGPASSWORD_FILE);if(!st.isFile()||st.isSymbolicLink()||(process.platform!=='win32'&&(st.mode&0o077)))fail();password=readFileSync(env.PGPASSWORD_FILE,'utf8').trim();}catch{fail();}
  if(password.length<24||password.length>256||/\s/.test(password)||/change.?me|example|password123/i.test(password))fail();
  return {authOrigin:AUTH_ORIGIN,publishableKey:key,port:integer('PORT',8080),database:{host:env.PGHOST,port:integer('PGPORT',5432),database:env.PGDATABASE,user:env.PGUSER,password}};
}
