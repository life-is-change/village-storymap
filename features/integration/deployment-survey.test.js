const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={teachingProjectId:'p',villageId:'v',spaceId:'s',spaceType:'formal_shared'};
const deps=services=>({services,getContext:()=>context,getClient(){throw Error('SOURCE_TOUCHED');},getSupabaseClient(){throw Error('SOURCE_TOUCHED');},uuid:()=> 'request'});
test('local comments ignore display-name actor claims including likes and replies',async()=>{
 const comments=require('../object-collaboration/object-comments.js'),calls=[],d=deps({survey:{async execute(a,p){calls.push([a,p]);return [];}}});
 await comments.create(d,{objectCode:'B1',objectType:'building',authorName:'Forged',content:'Hello',layerKey:'building'});await comments.like(d,7,'Forged');await comments.reply(d,7,'Forged','Reply');
 assert.deepEqual(calls.map(x=>x[0]),['survey.addComment','survey.likeComment','survey.replyComment']);assert.ok(calls.every(x=>!JSON.stringify(x[1]).includes('Forged')));
});
test('local data service reads restricted file references rather than source URLs',async()=>{
 const window={},sandbox={window,console};vm.runInNewContext(fs.readFileSync('features/data/data-service.js','utf8'),sandbox);const calls=[];
 const d=deps({survey:{async execute(a,p){calls.push([a,p]);return a==='survey.listPhotos'?[{id:7,fileId:'file',uploaded_by:'Local'}]:{};}},files:{async resolveFileUrl(id){assert.equal(id,'file');return 'blob:local';}}});
 const photos=await window.DataServiceModule.fetchObjectPhotos(d,'B1','building');assert.equal(photos[0].photo_url,'blob:local');await window.DataServiceModule.deleteObjectPhoto(d,{id:7});assert.equal(calls[1][0],'survey.deletePhoto');
});
test('local survey review confirmation preserves the lock token',async()=>{
 const {createSurveyReviewClient}=require('../survey/survey-review-client.js');const calls=[];
 const client=createSurveyReviewClient({...deps({survey:{async execute(a,p){calls.push([a,p]);return {};}}}),getContext:()=>context});
 await client.confirmGeometry({layerKey:'building',objectCode:'B1',expectedRevision:2,lockToken:'token'});assert.equal(calls[0][0],'survey.confirmGeometry');assert.equal(calls[0][1].lockToken,'token');assert.equal(calls[0][1].revision,2);
});

test('local community replies, likes and lifecycle never accept display-name authority',async()=>{
 const window={},sandbox={window,console};vm.runInNewContext(fs.readFileSync('community-tasks.js','utf8'),sandbox);const calls=[];
 const d={...deps({community:{async execute(a,p){calls.push([a,p]);return [];}}}),invalidateCommunityTaskCache(){},getCurrentSpaceId:()=>context.spaceId};
 await window.CommunityTasksModule.createCommunityTask(d,{reporterName:'Forged',description:'Hello',lng:113,lat:23});
 await window.CommunityTasksModule.toggleMessageLike(d,{messageId:7,likerName:'Forged'});await window.CommunityTasksModule.addMessageReply(d,{messageId:7,authorName:'Forged',content:'Reply'});
 assert.deepEqual(calls.map(x=>x[0]),['community.createTask','community.react','community.addReply']);assert.ok(calls.every(x=>!JSON.stringify(x[1]).includes('Forged')));
});
test('local survey admin uses contextual restore revision instead of source tables',async()=>{
 const {createSurveyAdminController}=require('../admin/survey-admin.js'),calls=[];const client=createSurveyAdminController({services:{survey:{async execute(a,p){calls.push([a,p]);return [];}}},uuid:()=> 'request'});
 await client.restoreVersion({...context,layerKey:'building',objectCode:'B1',featureVersionId:'version',expectedRevision:4});await client.loadHistory({...context,layerKey:'building',objectCode:'B1'});
 assert.equal(calls[0][0],'survey.restoreVersion');assert.equal(calls[0][1].revision,4);assert.equal(calls[1][0],'survey.history');
});
