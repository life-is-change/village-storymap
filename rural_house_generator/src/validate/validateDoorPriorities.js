export function validateDoorPriorities(plan) {
  const softPenalties = [];
  plan.floors.forEach(f => {
    if (!Array.isArray(f.doors) || f.doors.length === 0) {
      softPenalties.push({
        code: 'DOOR_MODEL_EMPTY',
        floor: f.index,
        penalty: 3,
        message: '统一 Plan JSON 的 doors 仍为空，尚未接入优先级门洞生成器'
      });
    }
  });
  return { hardViolations: [], softPenalties };
}

