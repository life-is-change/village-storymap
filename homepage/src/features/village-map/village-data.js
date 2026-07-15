/**
 * @typedef {Object} VillageProfile
 * @property {string} id
 * @property {string} name
 * @property {string} location
 * @property {string} tagline
 * @property {string} description
 * @property {{title: string, desc: string}[]} statusItems
 * @property {{title: string, desc: string}[]} issueItems
 * @property {number} longitude
 * @property {number} latitude
 * @property {number} zoom
 */

/** @type {VillageProfile[]} */
export const VILLAGES = [
  {
    id: 'mibu-village',
    name: '米埗村',
    location: '广州市从化区良口镇',
    tagline: '山水相依的岭南乡村',
    description:
      '米埗村位于从化区良口镇南部，毗邻流溪河。村庄依托优美的自然环境，持续推进人居环境整治、基础设施完善和岭南风貌营造，并发展特色民宿等乡村生态产业。',
    statusItems: [
      { title: '人口与村落', desc: '村落沿流溪河及主要道路分布，保留岭南乡村聚落肌理。' },
      { title: '产业发展', desc: '依托山水资源发展特色民宿、休闲农业与乡村生态旅游。' },
      { title: '公共设施', desc: '持续推进道路、人居环境和公共服务设施的完善提升。' },
    ],
    issueItems: [
      { title: '产业联动不足', desc: '现有业态之间仍需加强联动，延伸乡村旅游消费链条。' },
      { title: '风貌协调压力', desc: '新增建设与传统岭南村落风貌之间需要形成更清晰的管控。' },
      { title: '公共空间品质', desc: '滨水、街巷与村民活动空间仍有进一步整合提升的需求。' },
      { title: '生态保护平衡', desc: '旅游发展、人居改善与流溪河沿岸生态保护需要统筹推进。' },
    ],
    longitude: 113.796,
    latitude: 23.713,
    zoom: 14,
  },
];

export const DEFAULT_VILLAGE_ID = 'mibu-village';

export const HOME_REGION = {
  name: '中山大学广州校区东校园',
  longitude: 113.397,
  latitude: 23.055,
  zoom: 15,
};

/**
 * @param {string} id
 * @returns {VillageProfile}
 */
export function getVillageById(id) {
  return VILLAGES.find((village) => village.id === id) ?? VILLAGES[0];
}
