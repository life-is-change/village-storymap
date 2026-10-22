const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('one denied or unmapped photo remains a visible row without failing the entire admin list',async()=>{
 const source=fs.readFileSync('admin.js','utf8');const fn=source.slice(source.indexOf('  async function localPhotos('),source.indexOf('  let isDeletingUser'));
 const calls=[];const ctx={services:{files:{async resolveFileUrl(id){calls.push(id);if(id==='denied')throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});return 'blob:allowed';}}}};
 vm.runInNewContext(fn+';this.run=localPhotos;',ctx);
 const rows=await ctx.run([{id:1,fileId:'allowed'},{id:2,fileId:'denied'},{id:3,fileId:null}]);
 assert.equal(rows.length,3);assert.equal(rows[0].photo_url,'blob:allowed');assert.equal(rows[1].photo_url,'');assert.equal(rows[1].photo_load_error,'FORBIDDEN');assert.equal(rows[2].photo_load_error,'INVALID_FILE_ID');
 assert.deepEqual(calls,['allowed','denied']);
});
