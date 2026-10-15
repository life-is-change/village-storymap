import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const m=await import('../src/config.mjs').catch(()=>({}));
test('configuration refuses missing example secrets remote auth origin and privileged DB roles',()=>{
 assert.equal(typeof m.loadConfig,'function','configuration is missing');
 const folder=mkdtempSync(join(tmpdir(),'village-api-'));const file=join(folder,'password');
 try{
  writeFileSync(file,'random-private-password-0123456789\n',{mode:0o600});
  const env={SUPABASE_AUTH_ORIGIN:'https://rzmbmwauomzwiyenafha.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',PGHOST:'db',PGPORT:'5432',PGDATABASE:'village_copy',PGUSER:'village_api_login',PGPASSWORD_FILE:file,PORT:'8080'};
  assert.equal(m.loadConfig(env).database.user,'village_api_login');
  for(const changes of [{PGUSER:'postgres'},{PGPASSWORD_FILE:''},{SUPABASE_AUTH_ORIGIN:'http://localhost'},{SUPABASE_PUBLISHABLE_KEY:'sb_secret_key'},{PORT:'0'},{PGPORT:'wrong'},{PGHOST:'db/other'}]) assert.throws(()=>m.loadConfig({...env,...changes}));
  writeFileSync(file,'change-me');assert.throws(()=>m.loadConfig(env));
  if(process.platform!=='win32'){writeFileSync(file,'random-private-password-0123456789');chmodSync(file,0o644);assert.throws(()=>m.loadConfig(env));}
 } finally{rmSync(folder,{recursive:true,force:true});}
});
