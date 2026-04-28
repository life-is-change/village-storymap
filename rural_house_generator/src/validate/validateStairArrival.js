export function validateStairArrival(plan) {
  const hardViolations = [];
  const roomByIdForFloor = f => new Map(f.rooms.map(r => [r.id, r]));
  plan.floors.forEach(f => {
    const s = f.stairs;
    if (!s) return;
    const stairRoom = f.rooms.find(r => r.type === 'stairs');
    if (!stairRoom) return;
    const map = roomByIdForFloor(f);
    const neighbors = (stairRoom.adjacent || []).map(id => map.get(id)).filter(Boolean);
    const firstLegal = neighbors.some(r => ['living_room', 'lounge', 'corridor', 'entrance'].includes(r.type));
    const onlyBedroom = neighbors.length > 0 && neighbors.every(r => r.type === 'bedroom');
    if (!firstLegal || onlyBedroom) {
      hardViolations.push({
        code: 'STAIR_ARRIVAL_INVALID',
        floor: f.index,
        stairId: s.id,
        message: '楼梯首达空间不合法（需优先连接客厅/起居/过道/门厅）'
      });
    }
  });
  return { hardViolations, softPenalties: [] };
}

