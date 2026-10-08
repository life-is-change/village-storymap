import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTheoryPracticeMessage,
  getTheoryTaskStatus,
  resolveTheoryPracticeOpened
} from './theory-practice.js';

test('practice message carries the exact lesson and task identity', () => {
  assert.deepEqual(
    buildTheoryPracticeMessage({
      lessonId: 'lesson05',
      lessonTitle: '第五讲：乡村设计',
      stepId: 'large_scale',
      taskTitle: '从山水格局和地形环境看村庄',
      mapTask: 'large_scale_design'
    }),
    {
      type: 'village-theory-practice',
      payload: {
        lessonId: 'lesson05',
        lessonTitle: '第五讲：乡村设计',
        stepId: 'large_scale',
        taskTitle: '从山水格局和地形环境看村庄',
        mapTask: 'large_scale_design',
        villageId: 'mibu'
      }
    }
  );
});

test('task status requires launch, written evidence, and every check for completion', () => {
  assert.equal(getTheoryTaskStatus({ launched: false, note: '', checks: [false, false] }), 'not_started');
  assert.equal(getTheoryTaskStatus({ launched: true, note: '', checks: [false, false] }), 'entered');
  assert.equal(getTheoryTaskStatus({ launched: true, note: '观察到沿河布局', checks: [true, false] }), 'recorded');
  assert.equal(getTheoryTaskStatus({ launched: true, note: '观察到沿河布局', checks: [true, true] }), 'completed');
});

test('blank notes cannot complete a task', () => {
  assert.equal(getTheoryTaskStatus({ launched: true, note: '   ', checks: [true] }), 'entered');
});

test('launch is recorded only from a valid parent success acknowledgement', () => {
  assert.deepEqual(
    resolveTheoryPracticeOpened({
      type: 'village-theory-practice-opened',
      payload: {
        lessonId: 'lesson05',
        stepId: 'large_scale',
        mapTask: 'large_scale_design'
      }
    }),
    {
      lessonId: 'lesson05',
      stepId: 'large_scale',
      mapTask: 'large_scale_design'
    }
  );
  assert.equal(resolveTheoryPracticeOpened({ type: 'village-theory-practice-opened', payload: {} }), null);
  assert.equal(resolveTheoryPracticeOpened({ type: 'village-theory-practice', payload: {} }), null);
});
