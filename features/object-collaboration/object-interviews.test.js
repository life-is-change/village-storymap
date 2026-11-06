const test=require('node:test');
const assert=require('node:assert/strict');
const interviews=require('./object-interviews.js');
test('interviews require a vector and the three requested fields',()=>{
 const input={objectCode:'B1',layerKey:'building',interviewedAt:'2026-11-04T09:30:00+08:00',interviewee:' 村民 ',content:' 买菜不方便。\n希望增加摊位。 '};
 assert.equal(interviews.validate(input).interviewee,'村民');
 assert.equal(interviews.validate(input).interviewedAt,'2026-11-04T01:30:00.000Z');
 for(const key of ['objectCode','layerKey','interviewedAt','interviewee','content'])assert.throws(()=>interviews.validate({...input,[key]:''}));
});
test('interview records escape user content and omit internal identifiers',()=>{
 const html=interviews.render({records:[{id:'secret-record',object_code:'B-N-secret',interviewee:'<script>',content:'<img onerror=x>',interviewed_at:'2026-11-04T01:30:00Z',author_name:'同学甲'}],canSubmit:true});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img onerror=x&gt;'));
 assert.ok(!html.includes('secret-record'));assert.ok(!html.includes('B-N-secret'));
 assert.equal((html.match(/name="/g)||[]).length,3);
});
