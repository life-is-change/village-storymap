function within(a, b, eps = 0.06) {
  return Math.abs(a - b) <= eps;
}

export function validateVerticalAlignment(plan) {
  const hardViolations = [];
  const base = plan.floors.find(f => f.index === 1);
  if (!base) return { hardViolations, softPenalties: [] };

  const baseStair = base.stairs?.box || null;
  const baseBath = base.rooms.find(r => r.type === 'bathroom') || null;

  plan.floors.filter(f => f.index > 1).forEach(f => {
    if (baseStair && f.stairs?.box) {
      const s = f.stairs.box;
      if (!within(s.x, baseStair.x) || !within(s.y, baseStair.y) || !within(s.w, baseStair.w) || !within(s.h, baseStair.h)) {
        hardViolations.push({ code: 'VERT_STAIR_MISALIGN', floor: f.index, message: '上下层楼梯盒未对齐' });
      }
    }
    if (baseBath) {
      f.rooms.filter(r => r.type === 'bathroom').forEach(b => {
        const inside = b.x >= baseBath.x - 0.06 &&
          b.y >= baseBath.y - 0.06 &&
          (b.x + b.w) <= (baseBath.x + baseBath.w + 0.06) &&
          (b.y + b.h) <= (baseBath.y + baseBath.h + 0.06);
        if (!inside) {
          hardViolations.push({ code: 'VERT_BATH_MISALIGN', floor: f.index, roomId: b.id, message: '上层卫生间未落入一层卫生间投影' });
        }
      });
    }
  });

  return { hardViolations, softPenalties: [] };
}

