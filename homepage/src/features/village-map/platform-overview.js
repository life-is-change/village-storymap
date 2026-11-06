export function overviewStats(stats) {
 const count=(key)=>Number.isFinite(stats?.[key])?Number(stats[key]).toLocaleString('zh-CN'):'—';
 const area=stats?.measuredVillages>0&&stats?.areaSquareMeters>0
  ? `约${Math.round(stats.areaSquareMeters/2000*3).toLocaleString('zh-CN')}亩`:'待核算';
 return [{label:'本学期村庄',value:count('villageCount')},{label:'参与用户',value:count('registeredUsers')},
  {label:'规划方案',value:count('villageCount')},{label:'覆盖面积',value:area}];
}
export const CASE_STUDIES=[
 {title:'广州横岗村：实用性村庄规划',source:'广州市规划和自然资源局 · 2026',tag:'空间统筹',description:'参考用地布局、村民需求与岭南风貌如何在同一份规划中落实。',url:'https://ghzyj.gz.gov.cn/xwzx/gzdt/content/post_10971472.html'},
 {title:'厦门双岭村：生态、产业与文化协同',source:'福建省自然资源厅 · 2026',tag:'产业与公共空间',description:'参考道路、游憩节点、古厝活化与生态修复如何形成实施项目。',url:'https://zrzyt.fujian.gov.cn/ztzl/sxzygwzxsqzx/zyzxzx/202601/t20260126_7084997.htm'},
 {title:'浙江松阳：传统村落保护与利用',source:'财政部 · 2015',tag:'传统村落保护',description:'参考保护资金、产权协作与专业人才如何支持传统村落持续运营。',url:'https://www.mof.gov.cn/zhengwuxinxi/xinwenlianbo/zhejiangcaizhengxinxilianbo/201510/t20151009_1493706.htm'}
];
