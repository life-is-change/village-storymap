const test=require('node:test'),assert=require('node:assert/strict');
const {createCourseService}=require('../course/course-service.js');
const {createVillageClient}=require('../villages/village-client.js');

test('real platform entry context is projected onto the strict local listSpaces contract',async()=>{
 const {parseOperation}=await import('../../business-api/unified/contracts.mjs');
 const project='a0000000-0000-4000-8000-000000000001',village='b0000000-0000-4000-8000-000000000001';
 const calls=[];const client=createVillageClient({services:{catalog:{async execute(action,input){parseOperation(action,input);calls.push(input);return [];}}}});
 await client.listSpaces({teachingProjectId:project,villageId:village,villageRole:'practice',courseId:'course',spaceType:'practice_personal',readonly:false});
 assert.deepEqual(calls,[{teachingProjectId:project,villageId:village}]);
});
test('local course operations await server authority and never mirror or claim offline success',async()=>{
 const calls=[];const services={catalog:{async execute(action,input){calls.push([action,input]);if(action==='catalog.listGroups')return [];throw Object.assign(Error('DB_UNAVAILABLE'),{code:'DB_UNAVAILABLE'});}}};
 const service=createCourseService({services,course:{id:'course'},supabaseClient:{from(){throw Error('SOURCE_TOUCHED');}},storage:{getItem(){return '[]';},setItem(){throw Error('LOCAL_SUCCESS_WRITTEN');}},uuid:()=> 'a0000000-0000-4000-8000-000000000001'});
 assert.deepEqual(await service.listGroups(),[]);await assert.rejects(service.createGroup('Test'),{code:'DB_UNAVAILABLE'});
 assert.equal(calls[0][0],'catalog.listGroups');assert.equal(calls[1][1].name,'Test');assert.equal(Object.hasOwn(calls[1][1],'student_key'),false);
});
test('local village client uses explicit actions and local role for catalog actor',async()=>{
 const calls=[];const c=createVillageClient({services:{catalog:{async execute(action,input){calls.push([action,input]);return action==='catalog.listVillages'?[{id:'v',name:'Village'}]:{id:'new'};}}},uuid:()=> 'a0000000-0000-4000-8000-000000000001',supabaseClient:{from(){throw Error('SOURCE_TOUCHED');},rpc(){throw Error('SOURCE_TOUCHED');}}});
 assert.equal((await c.listVillages())[0].name,'Village');await c.createDraft({name:'New'});assert.equal(calls[1][0],'admin.createVillage');
});

test('local activity strips actor claims and never queues a source write',async()=>{
 const {createActivityLogger}=require('../course/activity-logger.js');const calls=[];
 const logger=createActivityLogger({services:{catalog:{async execute(a,p){calls.push([a,p]);return {event_id:p.requestId};}}},getContext:()=>({courseId:'course',teachingProjectId:'project',villageId:'village',spaceId:'space',actor:{name:'Forged',studentKey:'forged'}}),uuid:()=> 'request',storage:{getItem(){return null;},setItem(){throw Error('UNSCOPED_CACHE');}},supabaseClient:{from(){throw Error('SOURCE_TOUCHED');}}});
 await logger.record('view',{type:'building',id:'B1'},{count:1});await logger.flush();assert.equal(calls.length,1);assert.equal(calls[0][1].action,'view');assert.equal(Object.hasOwn(calls[0][1],'studentKey'),false);
});
test('local group administration routes catalog commands without source RPC',async()=>{
 const {createGroupPlanAdminController}=require('../admin/group-plan-admin.js');const calls=[];
 const controller=createGroupPlanAdminController({services:{catalog:{async execute(a,p){calls.push([a,p]);return [];}}},uuid:()=> 'request'});
 await controller.ensureSpace({teachingProjectId:'project',villageId:'village',groupId:'group',snapshotId:'snapshot'});
 assert.equal(calls[0][0],'admin.ensureGroupSpace');assert.equal(calls[0][1].snapshotId,'snapshot');
});
