export function buildTheoryPracticeMessage({ lessonId, lessonTitle, stepId, taskTitle, mapTask }) {
  return {
    type: 'village-theory-practice',
    payload: {
      lessonId: String(lessonId || '').trim(),
      lessonTitle: String(lessonTitle || '').trim(),
      stepId: String(stepId || '').trim(),
      taskTitle: String(taskTitle || '').trim(),
      mapTask: String(mapTask || '').trim(),
      villageId: 'mibu'
    }
  };
}

export function getTheoryTaskStatus({ launched, note, checks }) {
  const hasEvidence = Boolean(String(note || '').trim());
  const checklist = Array.isArray(checks) ? checks : [];
  const allChecked = checklist.length > 0 && checklist.every(Boolean);
  if (launched && hasEvidence && allChecked) return 'completed';
  if (launched && hasEvidence) return 'recorded';
  if (launched) return 'entered';
  return 'not_started';
}

export function resolveTheoryPracticeOpened(message) {
  if (!message || message.type !== 'village-theory-practice-opened') return null;
  const lessonId = String(message.payload?.lessonId || '').trim();
  const stepId = String(message.payload?.stepId || '').trim();
  const mapTask = String(message.payload?.mapTask || '').trim();
  if (!lessonId || !stepId || !mapTask) return null;
  return { lessonId, stepId, mapTask };
}
