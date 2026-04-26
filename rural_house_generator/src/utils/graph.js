export function buildAdjacency(rooms, overlapMin = 0.45, eps = 0.06) {
  const adjacency = new Map();
  rooms.forEach(r => adjacency.set(r.id, new Set()));

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];

      const verticalTouch = Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps;
      if (verticalTouch) {
        const y1 = Math.max(a.y, b.y);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        if (y2 - y1 > overlapMin) {
          adjacency.get(a.id)?.add(b.id);
          adjacency.get(b.id)?.add(a.id);
          continue;
        }
      }

      const horizontalTouch = Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps;
      if (horizontalTouch) {
        const x1 = Math.max(a.x, b.x);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        if (x2 - x1 > overlapMin) {
          adjacency.get(a.id)?.add(b.id);
          adjacency.get(b.id)?.add(a.id);
        }
      }
    }
  }

  return adjacency;
}

export function bfsReachable(startIds, adjacency, blockedIds = new Set()) {
  const queue = [];
  const visited = new Set();
  startIds.forEach(id => {
    if (!blockedIds.has(id)) {
      queue.push(id);
      visited.add(id);
    }
  });

  while (queue.length > 0) {
    const cur = queue.shift();
    (adjacency.get(cur) || []).forEach(nxt => {
      if (!visited.has(nxt) && !blockedIds.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    });
  }
  return visited;
}

