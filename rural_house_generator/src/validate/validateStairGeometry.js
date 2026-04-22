export function validateStairGeometry(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    const s = f.stairs;
    if (!s) return;
    const w = s.box?.w || 0;
    const h = s.box?.h || 0;
    if (w < 2.4 - 0.05 || h < 3.6 - 0.05) {
      hardViolations.push({
        code: 'STAIR_BOX_MIN',
        floor: f.index,
        stairId: s.id,
        message: `楼梯盒尺寸不足(${w.toFixed(2)} x ${h.toFixed(2)})`
      });
    }
  });
  return { hardViolations, softPenalties: [] };
}

