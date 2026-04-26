export function validateKitchenExterior(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    f.rooms.filter(r => r.type === 'kitchen').forEach(k => {
      if (!k.touchesExterior) {
        hardViolations.push({
          code: 'KITCHEN_NOT_EXTERIOR',
          floor: f.index,
          roomId: k.id,
          message: '厨房未贴外墙，采光排烟风险'
        });
      }
    });
  });
  return { hardViolations, softPenalties: [] };
}

