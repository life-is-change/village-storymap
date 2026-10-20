const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('page assembly keeps source default and loads fixed adapters before application scripts',()=>{
 for(const [path,entry] of [['index.html','app.js'],['admin.html','admin.js']]){
  const html=fs.readFileSync(path,'utf8'),scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1].split('?')[0]);
  assert.ok(scripts.indexOf('deployment-config.js')>=0);assert.ok(scripts.indexOf('deployment-config.js')<scripts.indexOf(entry));assert.ok(scripts.indexOf('features/data/platform-services.js')<scripts.indexOf(entry));
  assert.equal(scripts.filter(path=>path==='features/data/platform-services.js').length,1);
 }
 const config=require('node:vm').runInNewContext(fs.readFileSync('deployment-config.js','utf8')+';VILLAGE_DEPLOYMENT');assert.equal(config.mode,'source');assert.equal(config.apiBase,null);
});
test('machine probe route inventory exactly matches frontend fixed routes',()=>{
 const {ROUTES}=require('../data/unified-operation-routes.js');assert.deepEqual(JSON.parse(fs.readFileSync('linux/unified-operation-routes.json','utf8')),ROUTES);
});
