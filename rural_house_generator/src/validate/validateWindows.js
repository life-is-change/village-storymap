export function validateWindows(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    f.rooms.forEach(r => {
      if (!r.windowsRequired) return;
      if (!r.touchesExterior) {
        hardViolations.push({
          code: 'WINDOW_REQUIRED_NO_EXTERIOR',
          floor: f.index,
          roomId: r.id,
          message: `${r.label} 需要外窗但未贴外墙`
        });
      }
    });
  });
  return { hardViolations, softPenalties: [] };
}

