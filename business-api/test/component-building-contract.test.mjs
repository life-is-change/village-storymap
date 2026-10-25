import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleInput,parseOperation} from '../unified/contracts.mjs';

test('facade task carries component mode and purpose through strict API contract',()=>{
 const base=exampleInput('tasks.submitFacade');
 const input={...base,generationMethod:'components',modelPurpose:'existing',buildingWidth:12,buildingDepth:8,footprintRectangularity:1};
 assert.equal(parseOperation('tasks.submitFacade',input).input.generationMethod,'components');
 assert.throws(()=>parseOperation('tasks.submitFacade',{...input,generationMethod:'python'}));
 const {buildingWidth:unused,...missingWidth}=input;
 assert.throws(()=>parseOperation('tasks.submitFacade',missingWidth));
 assert.throws(()=>parseOperation('tasks.submitFacade',{...input,kind:'cloud-facade'}));
});
test('generation accepts bounded component parameters without changing legacy crop contract',()=>{
 const base=exampleInput('tasks.confirmCrop');
 assert.equal(parseOperation('tasks.confirmCrop',base).input.cropTop,base.cropTop);
 const value=parseOperation('tasks.confirmCrop',{...base,floors:3,roofCount:2}).input;
 assert.equal(value.roofCount,2);
 assert.throws(()=>parseOperation('tasks.confirmCrop',{...base,floors:100}));
});
