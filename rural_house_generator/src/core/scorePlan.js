export function scorePlan(plan, validationResult) {
  if (!validationResult.passed) return -Infinity;
  const base = validationResult.scoreBase ?? 100;
  const softLoss = (validationResult.softPenalties || []).reduce((s, p) => s + (p.penalty || 0), 0);

  let bonus = 0;
  plan.floors.forEach(f => {
    const total = f.outline.width * f.outline.depth;
    const used = f.rooms.reduce((s, r) => s + (r.area || 0), 0);
    const efficiency = used / Math.max(1, total);
    bonus += Math.max(0, Math.min(6, (efficiency - 0.94) * 40));
    if (f.rooms.some(r => r.type === 'corridor')) bonus += 1.5;
  });

  return Math.max(0, base - softLoss + bonus);
}

