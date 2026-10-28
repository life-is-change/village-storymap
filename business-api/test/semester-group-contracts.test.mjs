import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperation} from '../unified/contracts.mjs';
const teachingProjectId='a0000000-0000-4000-8000-000000000001';
const requestId='c0000000-0000-4000-8000-000000000001';
test('semester DTO accepts project and a normal custom code while rejecting privileged fields',()=>{
 const input={courseId:'course',teachingProjectId,name:'Group',code:'SJ101',requestId};
 assert.equal(parseOperation('catalog.createGroup',input).input.teachingProjectId,teachingProjectId);
 assert.throws(()=>parseOperation('catalog.createGroup',{...input,scopeKind:'lab'}),{code:'INVALID_INPUT'});
 assert.equal(parseOperation('catalog.groupRoster',{courseId:'course',teachingProjectId}).readOnly,true);
 assert.equal(parseOperation('catalog.lockGroup',{groupId:'g',locked:true,teachingProjectId,requestId}).input.teachingProjectId,teachingProjectId);
});
