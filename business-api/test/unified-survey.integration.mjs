import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareCatalog} from './fixtures/catalog.mjs';
let api,community,dbAPI;try{api=await import('../unified/survey.mjs');community=await import('../unified/community.mjs');dbAPI=await import('../unified/database.mjs');}catch{api={};}
test('native survey gate, UUID ownership, revisions, tombstones and cross-space separation',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareCatalog(setup);
  for(const [file,tables] of [['Community Tasks, Photos, Edits & Points Schema.sql',['community_tasks','object_photos','object_attribute_edits']],['Object Comments for Multi-Identity Replies.sql',['object_comments']]]){
   const source=await readFile(new URL('../../supabase_SQL/'+file,import.meta.url),'utf8');
   for(const table of tables){const ddl=source.match(new RegExp('create table if not exists (?:public\\.)?'+table+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
  }
  for(const table of ['object_photos','object_attribute_edits','object_comments','community_tasks'])await setup.query(`ALTER TABLE ${table} ADD teaching_project_id uuid,ADD village_id uuid${table==='community_tasks'?'':',ADD space_id text'}`);
  await setup.query("ALTER TABLE community_tasks ADD target_layer_key text,ADD target_object_code text;ALTER TABLE object_photos ADD survey_layer_key text,ADD photo_path text;ALTER TABLE object_comments ADD survey_layer_key text;ALTER TABLE object_attribute_edits ADD survey_layer_key text;ALTER TABLE object_attribute_edits DROP CONSTRAINT object_attribute_edits_object_code_object_type_key;ALTER TABLE object_attribute_edits ADD UNIQUE(teaching_project_id,village_id,space_id,object_code,object_type)");
  await setup.query(`CREATE TABLE survey_feature_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),teaching_project_id uuid,village_id uuid,space_id text,layer_key text,object_code text,geometry_status text,geometry_revision bigint DEFAULT 0,is_deleted boolean DEFAULT false);
   UPDATE planning_spaces SET teaching_project_id='a0000000-0000-4000-8000-000000000001',village_id='b0000000-0000-4000-8000-000000000001',space_type='formal_shared' WHERE id='A';
   INSERT INTO survey_feature_reviews(teaching_project_id,village_id,space_id,layer_key,object_code,geometry_status) VALUES('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','A','building','B1','pending');`);
  await install();await setup.query(await readFile(new URL('../../linux/sql/unified/catalog.sql',import.meta.url),'utf8'));await setup.query(await readFile(new URL('../../linux/sql/unified/survey.sql',import.meta.url),'utf8'));
  const db=dbAPI.createUnifiedDatabase(config),service=api.createSurveyService({database:db,files:{},taskReferences:{async assertPhotoMutable(){}}}),social=community.createCommunityService({database:db});
  const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',objectCode:'B1',objectType:'building'},context={teachingProjectId:c.teachingProjectId,villageId:c.villageId,spaceId:c.spaceId};let seq=0;
  const write=(action,input,user=USERS.student)=>service.execute(testIdentity(user),action,{...input,requestId:'c0000000-0000-4000-8000-'+String(++seq).padStart(12,'0')});
  try{
   await assert.rejects(service.execute(testIdentity(USERS.other),'survey.getAttributes',c),{code:'FORBIDDEN'},'shared space still requires course membership');
   await setup.query("INSERT INTO group_memberships(course_id,group_id,student_key,student_name,student_id) VALUES('course','group-a','b::B','B','b')");
   await assert.rejects(write('survey.saveAttributes',{...c,surveyLayerKey:'building',data:{name:'Blocked'}}),{code:'FORBIDDEN'});
   await setup.query("UPDATE survey_feature_reviews SET geometry_status='confirmed_unchanged'");
   await write('survey.saveAttributes',{...c,surveyLayerKey:'building',data:{name:'Local'}});assert.equal((await service.execute(testIdentity(),'survey.getAttributes',c)).name,'Local');
   await assert.rejects(service.execute(testIdentity(),'survey.getAttributes',{...c,spaceId:'B'}),{code:'FORBIDDEN'});
   const comment=await write('survey.addComment',{...c,surveyLayerKey:'building',body:'My comment'});assert.equal(comment.author_name,'A');
   await assert.rejects(write('survey.editComment',{commentId:comment.id,body:'Forged'},USERS.other),{code:'FORBIDDEN'});
   await write('survey.likeComment',{...context,commentId:comment.id},USERS.other);await write('survey.replyComment',{...context,commentId:comment.id,body:'Reply'},USERS.other);
   const comments=await service.execute(testIdentity(),'survey.listComments',c);assert.equal(comments[0].interaction.likes[0],'B');assert.equal(comments[0].interaction.replies[0].author,'B');
   const message=await social.execute(testIdentity(),'community.createTask',{...context,body:'Local issue',requestId:'d0000000-0000-4000-8000-000000000001'});
   await assert.rejects(social.execute(testIdentity(USERS.other),'community.updateTask',{...context,id:message.id,body:'Forged',revision:0,requestId:'d0000000-0000-4000-8000-000000000002'}),{code:'FORBIDDEN'});
   await social.execute(testIdentity(),'community.updateTask',{...context,id:message.id,body:'Updated',revision:0,requestId:'d0000000-0000-4000-8000-000000000003'});
   await assert.rejects(social.execute(testIdentity(),'community.updateTask',{...context,id:message.id,body:'Stale',revision:0,requestId:'d0000000-0000-4000-8000-000000000004'}),{code:'REVISION_CONFLICT'});
   await write('survey.deleteComment',{commentId:comment.id});assert.equal((await service.execute(testIdentity(),'survey.listComments',c)).length,0);
   assert.equal((await setup.query('SELECT count(*) n FROM object_comments')).rows[0].n,'1','deleted history retained');
   assert.equal((await setup.query('SELECT count(*) n FROM api_private.community_history')).rows[0].n,'2');
  }finally{await db.close();}
 });
});
