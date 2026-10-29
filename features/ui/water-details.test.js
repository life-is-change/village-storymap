const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('water details show only stable id, name and source while retaining raw metadata',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8');
 const start=text.indexOf('function buildEditableDetailHtml('),end=text.indexOf('\nasync function handlePhotoUpload',start);
 const ctx={escapeHtml:String,getEditableFields:()=>[]};vm.createContext(ctx);vm.runInContext(text.slice(start,end)+';this.render=buildEditableDetailHtml;',ctx);
 const row={osm_id:12,name:'长洲湾',source:'osm',other_tags:'unused',attribution:'OSM',type:'multipolygon'};
 const html=ctx.render(row,'water',false);
 assert.match(html,/id：/);assert.match(html,/name：/);assert.match(html,/source：/);assert.doesNotMatch(html,/other_tags|attribution|multipolygon/);
 assert.equal(row.other_tags,'unused');
});
