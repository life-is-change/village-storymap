export function validateBedroomPassThrough(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    const rooms = f.rooms;
    const roomById = new Map(rooms.map(r => [r.id, r]));
    const bedrooms = rooms.filter(r => r.type === 'bedroom');
    bedrooms.forEach(b => {
      const neighbors = (b.adjacent || []).map(id => roomById.get(id)).filter(Boolean);
      const circulationNeighbors = neighbors.filter(r => ['living_room', 'lounge', 'corridor', 'entrance', 'stairs'].includes(r.type));
      if (circulationNeighbors.length === 0 && neighbors.length > 0) {
        hardViolations.push({
          code: 'BEDROOM_PASSTHROUGH_RISK',
          floor: f.index,
          roomId: b.id,
          message: '卧室未连接主交通空间，疑似卧室串联'
        });
      }
    });
  });
  return { hardViolations, softPenalties: [] };
}

