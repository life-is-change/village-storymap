import { DEFAULT_FARMHOUSE_RULES } from './defaultFarmhouseRules.js';

function normRoomRule(room = {}, fallback = {}) {
  return {
    label: room.label || fallback.label || '',
    minArea: Number(room.min_area ?? fallback.min_area ?? 4),
    maxArea: Number(room.max_area ?? fallback.max_area ?? 40),
    minWidth: Number(room.min_w ?? fallback.min_w ?? 1.8),
    minDepth: Number(room.min_d ?? fallback.min_d ?? 2.0),
    maxAspectRatio: Number(room.max_aspect ?? fallback.max_aspect ?? 4),
    mustTouchExterior: Boolean(room.must_touch_exterior ?? fallback.must_touch_exterior ?? false),
    preferTouchExterior: Boolean(room.prefer_touch_exterior ?? fallback.prefer_touch_exterior ?? false),
    windowRequired: Boolean(room.window_required ?? fallback.window_required ?? false),
    circulationPriority: Number(room.circulation_priority ?? fallback.circulation_priority ?? 0),
    mustConnectTo: room.must_connect_to || fallback.must_connect_to || [],
    avoidOnlyAccessFrom: room.avoid_only_access_from || fallback.avoid_only_access_from || []
  };
}

export function mapRuleConfigToRuntime(rawRules = null) {
  const rules = rawRules || DEFAULT_FARMHOUSE_RULES;
  const merged = {
    ...DEFAULT_FARMHOUSE_RULES,
    ...rules,
    geometry: {
      ...DEFAULT_FARMHOUSE_RULES.geometry,
      ...(rules.geometry || {})
    },
    rooms: {
      ...DEFAULT_FARMHOUSE_RULES.rooms,
      ...(rules.rooms || {})
    }
  };

  const roomRules = {};
  Object.keys(merged.rooms || {}).forEach(type => {
    roomRules[type] = normRoomRule(merged.rooms[type], DEFAULT_FARMHOUSE_RULES.rooms[type] || {});
  });

  return {
    building: merged.building || DEFAULT_FARMHOUSE_RULES.building,
    roomRules,
    geometry: {
      fillRateTarget: Number(merged.geometry.fill_rate_target ?? 0.98),
      fillRateHardMin: Number(merged.geometry.fill_rate_hard_min ?? 0.965),
      maxBlankArea: Number(merged.geometry.max_blank_area ?? 3.5),
      corridorAutoIf: {
        minWidth: Number(merged.geometry?.corridor_auto_if?.min_width ?? 10),
        minBedrooms: Number(merged.geometry?.corridor_auto_if?.min_bedrooms ?? 2)
      }
    }
  };
}

export function buildRuleMappingTable(runtimeRules) {
  return {
    roomRules: 'ROOM_RULES[type] merged from YAML rooms.*',
    fillRateTarget: `allocateRoomAreas.maxTotalRatio <= geometry.fillRateTarget (${runtimeRules.geometry.fillRateTarget})`,
    maxBlankArea: `validateHardConstraints.R4 threshold uses geometry.maxBlankArea (${runtimeRules.geometry.maxBlankArea})`,
    fillRateHardMin: `validateHardConstraints.R5 net area cap uses geometry.fillRateTarget (${runtimeRules.geometry.fillRateTarget})`,
    corridorAutoIf: `expandRooms auto corridor when width>=${runtimeRules.geometry.corridorAutoIf.minWidth} and bedrooms>=${runtimeRules.geometry.corridorAutoIf.minBedrooms}`
  };
}

