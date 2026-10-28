const test = require('node:test');
const assert = require('node:assert/strict');
const {createCourseService} = require('./course-service.js');

test('business group operations resolve the live semester instead of the template default', async () => {
  const calls = [];
  let current = 'project-a';
  const service = createCourseService({
    getTeachingProjectId: () => current,
    uuid: () => 'request',
    services: {catalog: {execute: async (action, input) => {
      calls.push({action,input});
      if (action.endsWith('getActiveContext')) return {project:{id:current,course_id:'mibu-village-planning'}};
      if (action.endsWith('getCourseContext')) return {group:null,membership:null};
      if (action.endsWith('listGroups')) return [];
      if (action.endsWith('groupRoster')) return {memberships:[],progress:[]};
      return {id:'group',name:'Group'};
    }}}
  });
  await service.createGroup('First','A101');
  current = 'project-b';
  await service.joinGroup(' B101 ',{});
  await service.listGroups();
  await service.getGroupRoster();
  const create = calls.find(c => c.action==='catalog.createGroup').input;
  assert.equal(create.teachingProjectId,'project-a');
  assert.equal(create.code,'A101');
  assert.equal(calls.find(c=>c.action==='catalog.joinGroup').input.teachingProjectId,'project-b');
  assert.equal(calls.find(c=>c.action==='catalog.listGroups').input.teachingProjectId,'project-b');
  assert.equal(calls.find(c=>c.action==='catalog.groupRoster').input.teachingProjectId,'project-b');
});

test('business group actions fail closed without a current semester', async () => {
  const service=createCourseService({getTeachingProjectId:()=>null,services:{catalog:{execute:async()=>{throw Error('must not send unscoped writes');}}}});
  await assert.rejects(service.createGroup('Unscoped'),{code:'TEACHING_PROJECT_REQUIRED'});
});

test('dynamic project metadata carries a nondefault course template together with its semester',async()=>{
  const calls=[];
  const service=createCourseService({getTeachingProject:()=>({id:'project-other',courseId:'another-course'}),services:{catalog:{execute:async(a,p)=>{calls.push(p);return [];}}}});
  await service.listGroups();
  assert.deepEqual(calls,[{courseId:'another-course',teachingProjectId:'project-other'}]);
});
