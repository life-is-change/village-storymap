import { getRoomRule } from '../config/roomRules.js';
import { buildAdjacency } from '../utils/graph.js';

function roomPolygon(room) {
  return [
    [room.x, room.y],
    [room.x + room.w, room.y],
    [room.x + room.w, room.y + room.h],
    [room.x, room.y + room.h]
  ];
}

function touchesExterior(room, outline) {
  const eps = 0.06;
  const maxX = outline.width;
  const maxY = outline.depth;
  return room.x <= eps ||
    room.y <= eps ||
    room.x + room.w >= maxX - eps ||
    room.y + room.h >= maxY - eps;
}

function inferStairMeta(room, floor, config) {
  if (!room) return null;
  const runWidth = Math.max(0.9, Math.min(room.w, room.h) * 0.42);
  const landingDepth = Math.max(1.1, Math.max(room.w, room.h) * 0.34);
  const stepRise = 0.165;
  const stepGoing = 0.26;
  const flightSteps = Math.max(7, Math.round((config.floorHeight || 3.3) / stepRise / 2));
  return {
    id: `stair-f${floor}`,
    floor,
    box: { x: room.x, y: room.y, w: room.w, h: room.h },
    type: 'u_shape',
    runWidth,
    landingDepth,
    stepRise,
    stepGoing,
    flight1Steps: flightSteps,
    flight2Steps: flightSteps,
    entryEdge: 'left',
    exitEdge: 'right',
    connectsFromRoom: null,
    connectsToFloor: floor + 1,
    anchor: { x: room.x, y: room.y, w: room.w, h: room.h }
  };
}

export function createPlanModel(result) {
  const building = {
    length: result.config.length,
    width: result.config.width,
    floors: result.config.floors,
    wallThickness: 0.24,
    slabThickness: 0.12,
    floorHeight: result.config.floorHeight,
    roofType: result.config.roofType
  };

  const floors = (result.floorPlans || []).map(plan => {
    const outline = { type: 'rectangle', x: 0, y: 0, width: building.length, depth: building.width };
    const rooms = (plan.rooms || []).map((r, idx) => {
      const id = `f${plan.floor}-r${idx + 1}-${r.type}`;
      const rule = getRoomRule(r.type);
      return {
        id,
        type: r.type,
        label: r.label,
        floor: plan.floor,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        area: r.area,
        polygon: roomPolygon(r),
        adjacent: [],
        mustTouchExterior: Boolean(rule?.mustTouchExterior),
        isCirculation: ['entrance', 'living_room', 'lounge', 'corridor', 'stairs'].includes(r.type),
        windowsRequired: Boolean(rule?.windowRequired),
        preferTouchExterior: Boolean(rule?.preferTouchExterior),
        touchesExterior: touchesExterior(r, outline)
      };
    });

    const adjacency = buildAdjacency(rooms);
    rooms.forEach(room => {
      room.adjacent = Array.from(adjacency.get(room.id) || []);
    });

    const stairRoom = rooms.find(r => r.type === 'stairs');
    const stairs = inferStairMeta(stairRoom, plan.floor, result.config);
    if (stairs) {
      const stairAdj = adjacency.get(stairRoom.id) || new Set();
      const first = Array.from(stairAdj)[0] || null;
      stairs.connectsFromRoom = first;
    }

    return {
      index: plan.floor,
      elevation: (plan.floor - 1) * building.floorHeight,
      outline,
      rooms,
      doors: [],
      windows: [],
      stairs,
      terraces: rooms.filter(r => r.type === 'terrace').map(r => ({ roomId: r.id })),
      balconies: [],
      shafts: []
    };
  });

  return { building, floors, meta: { source: 'legacy-layout-adapter' } };
}

