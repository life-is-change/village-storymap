export const DEFAULT_FARMHOUSE_RULES = {
  building: {
    length: { min: 8, max: 18 },
    width: { min: 8, max: 14 },
    floors: [1, 2, 3],
    floor_height: { min: 2.8, max: 3.6 },
    wall_thickness: 0.24,
    slab_thickness: 0.12
  },
  geometry: {
    fill_rate_target: 0.98,
    fill_rate_hard_min: 0.965,
    max_blank_area: 3.5,
    corridor_auto_if: {
      min_width: 10,
      min_bedrooms: 2
    }
  },
  rooms: {
    entrance: { label: '门厅', min_area: 3, max_area: 10, min_w: 1.2, min_d: 1.5, max_aspect: 3, must_touch_exterior: true, window_required: false, circulation_priority: 10 },
    living_room: { label: '客厅', min_area: 18, max_area: 45, min_w: 3.9, min_d: 4.5, max_aspect: 3, prefer_touch_exterior: true, window_required: true, circulation_priority: 10 },
    dining: { label: '餐厅', min_area: 6, max_area: 22, min_w: 2.4, min_d: 2.5, max_aspect: 3, circulation_priority: 7 },
    kitchen: { label: '厨房', min_area: 6, max_area: 16, min_w: 2.1, min_d: 2.8, max_aspect: 3, must_touch_exterior: true, window_required: true, circulation_priority: 5 },
    bathroom: { label: '卫生间', min_area: 4, max_area: 10, min_w: 1.8, min_d: 2.2, max_aspect: 2.5, prefer_touch_exterior: true, avoid_only_access_from: ['kitchen'], circulation_priority: 6 },
    bedroom: { label: '卧室', min_area: 9, max_area: 25, min_w: 3.0, min_d: 3.6, max_aspect: 3, must_touch_exterior: true, window_required: true, circulation_priority: 3 },
    stairs: { label: '楼梯', min_area: 8.64, max_area: 15, min_w: 2.4, min_d: 3.6, max_aspect: 2, must_connect_to: ['living_room', 'lounge', 'corridor', 'entrance'], avoid_only_access_from: ['bedroom'], circulation_priority: 10 },
    corridor: { label: '过道', min_area: 2, max_area: 8, min_w: 0.9, min_d: 2.0, max_aspect: 5, circulation_priority: 9 },
    storage: { label: '储藏间', min_area: 3, max_area: 8, min_w: 1.8, min_d: 2.0, max_aspect: 3, circulation_priority: 2 },
    lounge: { label: '起居厅', min_area: 15, max_area: 35, min_w: 3.6, min_d: 4.2, max_aspect: 3, window_required: true, circulation_priority: 10 },
    terrace: { label: '露台', min_area: 6, max_area: 25, min_w: 2.0, min_d: 3.0, max_aspect: 4, must_touch_exterior: true, circulation_priority: 1 }
  }
};

