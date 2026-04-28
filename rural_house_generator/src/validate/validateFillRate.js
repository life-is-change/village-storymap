export function validateFillRate(plan) {
  const hardViolations = [];
  const softPenalties = [];
  plan.floors.forEach(f => {
    const floorArea = f.outline.width * f.outline.depth;
    const used = f.rooms.reduce((s, r) => s + (r.area || 0), 0);
    const gap = floorArea - used;
    const hardGap = Math.max(3.5, floorArea * 0.02);
    if (gap > hardGap) {
      hardViolations.push({ code: 'FILL_GAP_TOO_LARGE', floor: f.index, message: `空白面积 ${gap.toFixed(2)}㎡ 超阈值` });
    } else if (gap > floorArea * 0.01) {
      softPenalties.push({ code: 'FILL_GAP_WARN', floor: f.index, penalty: 4, message: `空白面积 ${gap.toFixed(2)}㎡` });
    }
  });
  return { hardViolations, softPenalties };
}

