export function validateCorridorNeed(plan) {
  const hardViolations = [];
  const softPenalties = [];
  const depth = plan.building?.width || 0;
  plan.floors.forEach(f => {
    const bedCount = f.rooms.filter(r => r.type === 'bedroom').length;
    const hasCorridor = f.rooms.some(r => r.type === 'corridor');
    if (depth >= 10 && bedCount >= 3 && !hasCorridor) {
      hardViolations.push({
        code: 'CORRIDOR_REQUIRED',
        floor: f.index,
        message: '大进深多卧室楼层缺少 corridor'
      });
    } else if (depth >= 9.5 && bedCount >= 2 && !hasCorridor) {
      softPenalties.push({
        code: 'CORRIDOR_RECOMMENDED',
        floor: f.index,
        penalty: 4,
        message: '建议引入 corridor 提升交通质量'
      });
    }
  });
  return { hardViolations, softPenalties };
}

