import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareSurvey} from './fixtures/survey.mjs';
let api,community,dbAPI;try{api=await import('../unified/survey.mjs');community=await import('../unified/community.mjs');dbAPI=await import('../unified/database.mjs');}catch{api={};}
test('native survey gate, UUID ownership, revisions, tombstones and cross-space separation',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareSurvey(setup);
  await install();await setup.query(await readFile(new URL('../../linux/sql/unified/catalog.sql',import.meta.url),'utf8'));await setup.query(await readFile(new URL('../../linux/sql/unified/survey.sql',import.meta.url),'utf8'));
  const db=dbAPI.createUnifiedDatabase(config),service=api.createSurveyService({database:db,files:{},taskReferences:{async assertPhotoMutable(){}}}),social=community.createCommunityService({database:db});
  const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',objectCode:'B1',objectType:'building'},context={teachingProjectId:c.teachingProjectId,villageId:c.villageId,spaceId:c.spaceId};let seq=0;
  const write=(action,input,user=USERS.student)=>service.execute(testIdentity(user),action,{...input,requestId:'c0000000-0000-4000-8000-'+String(++seq).padStart(12,'0')});
  try{
   await assert.rejects(service.execute(testIdentity(USERS.other),'survey.getAttributes',c),{code:'FORBIDDEN'},'shared space still requires course membership');
   await assert.rejects(write('survey.saveAttributes',{...c,objectType:'building_3d__A',data:{height:10}}),{code:'FORBIDDEN'},'3D object namespaces cannot bypass an unconfirmed survey review');
   await setup.query("INSERT INTO group_memberships(course_id,group_id,student_key,student_name,student_id) VALUES('course','group-a','b::B','B','b')");
   await assert.rejects(write('survey.saveAttributes',{...c,surveyLayerKey:'building',data:{name:'Blocked'}}),{code:'FORBIDDEN'});

   await assert.rejects(write('survey.confirmGeometry',{...context,layerKey:'building',objectCode:'B1',revision:0,lockToken:'e0000000-0000-4000-8000-000000000001'}),{code:'FORBIDDEN'});
   await setup.query("INSERT INTO feature_edit_locks(space_id,layer_key,object_code,editor_name,editor_user_id,lock_token,expires_at,teaching_project_id,village_id) VALUES('A','building','B1','A','10000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',now()+interval '1 minute','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001')");
   const confirmed=await write('survey.confirmGeometry',{...context,layerKey:'building',objectCode:'B1',revision:0,lockToken:'e0000000-0000-4000-8000-000000000001'});assert.equal(confirmed.geometry_revision,1);assert.equal((await setup.query('SELECT count(*) n FROM feature_edit_locks')).rows[0].n,'0');

   await write('survey.saveAttributes',{...c,surveyLayerKey:'building',data:{name:'Local'}});assert.equal((await service.execute(testIdentity(),'survey.getAttributes',c)).name,'Local');
   await assert.rejects(service.execute(testIdentity(),'survey.getAttributes',{...c,spaceId:'B'}),{code:'FORBIDDEN'});

   const legacy=await service.execute(testIdentity(),'survey.listComments',{...c,objectCode:'B2'});assert.equal(legacy[0].interaction.replies[0].author,'Legacy reply');assert.deepEqual(legacy[0].interaction.likes.sort(),['A','Unknown legacy']);
   assert.equal((await social.execute(testIdentity(),'community.stats',context)).total_points,17);
   const comment=await write('survey.addComment',{...c,surveyLayerKey:'building',body:'My comment'});assert.equal(comment.author_name,'A');
   await assert.rejects(write('survey.editComment',{commentId:comment.id,body:'Forged'},USERS.other),{code:'FORBIDDEN'});
   await write('survey.likeComment',{...context,commentId:comment.id},USERS.other);await write('survey.replyComment',{...context,commentId:comment.id,body:'Reply'},USERS.other);
   const comments=await service.execute(testIdentity(),'survey.listComments',c);assert.equal(comments[0].interaction.likes[0],'B');assert.equal(comments[0].interaction.replies[0].author,'B');
   const message=await social.execute(testIdentity(),'community.createTask',{...context,body:'Local issue',requestId:'d0000000-0000-4000-8000-000000000001'});
   await assert.rejects(social.execute(testIdentity(USERS.other),'community.updateTask',{...context,id:message.id,body:'Forged',revision:0,requestId:'d0000000-0000-4000-8000-000000000002'}),{code:'FORBIDDEN'});
   await social.execute(testIdentity(),'community.updateTask',{...context,id:message.id,body:'Updated',revision:0,requestId:'d0000000-0000-4000-8000-000000000003'});
   await assert.rejects(social.execute(testIdentity(),'community.updateTask',{...context,id:message.id,body:'Stale',revision:0,requestId:'d0000000-0000-4000-8000-000000000004'}),{code:'REVISION_CONFLICT'});
   await write('survey.deleteComment',{commentId:comment.id});assert.equal((await service.execute(testIdentity(),'survey.listComments',c)).length,0);
   assert.equal((await setup.query('SELECT count(*) n FROM object_comments')).rows[0].n,'2','deleted history retained');

   assert.equal((await setup.query('SELECT count(*) n FROM api_private.community_history')).rows[0].n,'2');
   await social.execute(testIdentity(),'community.transition',{...context,id:message.id,status:'resolved',requestId:'d0000000-0000-4000-8000-000000000005'});
   assert.equal((await social.execute(testIdentity(),'community.stats',context)).total_points,20);
   const activity=await service.execute(testIdentity(),'survey.activity',context);assert.equal(activity.length,4);
   const {createCatalogService}=await import('../unified/catalog.mjs');const catalog=createCatalogService({database:db});
   await assert.rejects(catalog.execute(testIdentity(),'admin.listPhotos',{}),{code:'FORBIDDEN'});
   assert.ok(Array.isArray(await catalog.execute(testIdentity(USERS.admin),'admin.listPhotos',{})));
   assert.ok(Array.isArray(await catalog.execute(testIdentity(USERS.admin),'admin.listMessages',{})));

  }finally{await db.close();}
 });
});
