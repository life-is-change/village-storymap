import { bfsReachable } from '../utils/graph.js';

function mapAdjacency(rooms) {
  const m = new Map();
  rooms.forEach(r => m.set(r.id, new Set(r.adjacent || [])));
  return m;
}

export function validateConnectivity(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    const adjacency = mapAdjacency(f.rooms);
    const roots = f.rooms.filter(r => ['entrance', 'living_room', 'lounge', 'corridor'].includes(r.type)).map(r => r.id);
    if (!roots.length) {
      hardViolations.push({ code: 'NO_CIRCULATION_ROOT', floor: f.index, message: '缺少主交通根空间' });
      return;
    }
    const reachable = bfsReachable(roots, adjacency);
    const disconnected = f.rooms.filter(r => r.type !== 'terrace' && !reachable.has(r.id));
    if (disconnected.length > 0) {
      hardViolations.push({
        code: 'DISCONNECTED_ROOMS',
        floor: f.index,
        message: `存在不可达房间: ${disconnected.map(r => r.label).join('、')}`
      });
    }
  });
  return { hardViolations, softPenalties: [] };
}

