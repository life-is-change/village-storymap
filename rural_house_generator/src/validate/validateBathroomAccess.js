import { bfsReachable } from '../utils/graph.js';

function mapAdjacency(rooms) {
  const m = new Map();
  rooms.forEach(r => m.set(r.id, new Set(r.adjacent || [])));
  return m;
}

export function validateBathroomAccess(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    const rooms = f.rooms;
    const baths = rooms.filter(r => r.type === 'bathroom');
    if (!baths.length) return;
    const adjacency = mapAdjacency(rooms);
    const roots = rooms.filter(r => ['living_room', 'lounge', 'entrance', 'corridor'].includes(r.type)).map(r => r.id);
    if (!roots.length) return;

    const roomById = new Map(rooms.map(r => [r.id, r]));
    const reachAll = bfsReachable(roots, adjacency);
    const kitchenIds = new Set(rooms.filter(r => r.type === 'kitchen').map(r => r.id));
    const reachWithoutKitchen = bfsReachable(roots, adjacency, kitchenIds);

    baths.forEach(b => {
      if (!reachAll.has(b.id)) {
        hardViolations.push({ code: 'BATH_UNREACHABLE', floor: f.index, roomId: b.id, message: '卫生间不可达' });
        return;
      }
      if (!reachWithoutKitchen.has(b.id)) {
        hardViolations.push({ code: 'BATH_ONLY_VIA_KITCHEN', floor: f.index, roomId: b.id, message: '卫生间只能经厨房到达' });
      }
      const neighbors = Array.from(adjacency.get(b.id) || []).map(id => roomById.get(id));
      const legalNeighbor = neighbors.some(n => n && ['living_room', 'lounge', 'entrance', 'corridor', 'bedroom', 'storage'].includes(n.type));
      if (!legalNeighbor) {
        hardViolations.push({ code: 'BATH_DOOR_PRIORITY_FAIL', floor: f.index, roomId: b.id, message: '卫生间缺少优先交通邻接面' });
      }
    });
  });

  return { hardViolations, softPenalties: [] };
}

