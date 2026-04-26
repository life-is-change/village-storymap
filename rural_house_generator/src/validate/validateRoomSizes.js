import { getRoomRule } from '../config/roomRules.js';

export function validateRoomSizes(plan) {
  const hardViolations = [];
  plan.floors.forEach(f => {
    f.rooms.forEach(room => {
      const rule = getRoomRule(room.type);
      if (!rule) return;
      const short = Math.min(room.w, room.h);
      const long = Math.max(room.w, room.h);
      const ar = long / Math.max(0.01, short);
      if (room.area < rule.minArea - 0.2) {
        hardViolations.push({ code: 'SIZE_AREA_MIN', floor: f.index, roomId: room.id, message: `${room.label} 面积低于最小值` });
      }
      if (short < rule.minWidth - 0.05) {
        hardViolations.push({ code: 'SIZE_WIDTH_MIN', floor: f.index, roomId: room.id, message: `${room.label} 净宽不足` });
      }
      if (long < rule.minDepth - 0.05) {
        hardViolations.push({ code: 'SIZE_DEPTH_MIN', floor: f.index, roomId: room.id, message: `${room.label} 净深不足` });
      }
      if (ar > rule.maxAspectRatio + 0.1) {
        hardViolations.push({ code: 'SIZE_ASPECT_MAX', floor: f.index, roomId: room.id, message: `${room.label} 长宽比超限` });
      }
    });
  });
  return { hardViolations, softPenalties: [] };
}

