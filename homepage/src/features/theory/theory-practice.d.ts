export type TheoryTaskStatus = 'not_started' | 'entered' | 'recorded' | 'completed';

export function buildTheoryPracticeMessage(input: {
  lessonId: string;
  lessonTitle: string;
  stepId: string;
  taskTitle: string;
  mapTask: string;
}): {
  type: 'village-theory-practice';
  payload: {
    lessonId: string;
    lessonTitle: string;
    stepId: string;
    taskTitle: string;
    mapTask: string;
    villageId: 'mibu';
  };
};

export function getTheoryTaskStatus(input: {
  launched: boolean;
  note: string;
  checks: boolean[];
}): TheoryTaskStatus;

export function resolveTheoryPracticeOpened(message: unknown): {
  lessonId: string;
  stepId: string;
  mapTask: string;
} | null;
