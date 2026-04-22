function overlapArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

export function validateTerraceOverlap(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    const terraces = f.rooms.filter(r => r.type === 'terrace');
    terraces.forEach(t => {
      f.rooms.filter(r => r.id !== t.id && r.type !== 'terrace').forEach(r => {
        if (overlapArea(t, r) > 0.01) {
          hardViolations.push({
            code: 'TERRACE_OVERLAP_ROOM',
            floor: f.index,
            roomId: t.id,
            message: `露台与${r.label}重叠`
          });
        }
      });
    });
  });
  return { hardViolations, softPenalties: [] };
}

