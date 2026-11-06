// Run: node tools/import-curated-scene-assets.cjs E:/GLB_model
// Original files stay untouched. Explicit target dimensions are design defaults, not survey measurements.
const fs = require('node:fs');
const path = require('node:path');
const Glb = require('../features/models/glb-normalization');
const source = path.resolve(process.argv[2] || 'E:/GLB_model');
const out = path.resolve(__dirname, '../3D_scenes_edit/assets/curated');
const definitions = `木扶手座椅|bench|0.85
软垫座椅|bench|0.85
圆形休闲桌|table|0.75
室内垃圾桶|bin|0.8
弯臂路灯|light|4
施工护栏|sculpture|0.9
公园长椅|bench|0.85
公园入口牌架|sign|3
饮品售卖亭|stall|2.6
食品售卖亭|stall|2.6
咨询服务亭|sign|2.6
公共卫生间亭|sculpture|2.8
圆形景观喷泉|sculpture|0.8
方形景观喷泉|sculpture|0.8
木栅栏段|sculpture|1.1
木栅栏门|sculpture|1.1
庭院灯笼|light|2.5
石阶与扶手|sculpture|1.2
绿色棚摊|stall|2.4
红色棚摊|stall|2.4
摊位长凳|bench|0.45
手推车|sculpture|0.9
儿童滑梯|play-equipment|2.7
儿童秋千|play-equipment|2.7
圆背椅|bench|0.85
软垫单椅|bench|0.85
交叉脚桌|table|0.75
桌布餐桌|table|0.75
休闲躺椅|bench|0.8
边桌|table|0.65
小型盆栽甲|shrub|0.7
小型盆栽乙|shrub|0.7
圆形落地灯|light|1.7
壁灯|light|0.25
方形路灯|light|4
双弯臂路灯|light|4
施工警示灯|light|0.9
小型桥面|sculpture|1.2
道路交叉铺装块|sculpture|0.08
矮木围栏|sculpture|0.6
长木围栏|sculpture|0.9
短石板步道块|sculpture|0.08
长石板步道块|sculpture|0.08
不规则石板步道块|sculpture|0.08
户外花箱|sculpture|0.6
大乔木|tree|6
小乔木|tree|4
排队入口栏|sign|1.2
活动入口牌架|sign|2.6
站台围栏|sculpture|1.1
户外垃圾桶|bin|0.9
花卉种植箱|shrub|0.45
直线绿篱|shrub|0.8
转角绿篱|shrub|0.8
绿篱门洞|shrub|1
高绿篱|shrub|1.5
宽石阶与扶手|sculpture|1.2
木阶与扶手|sculpture|1.2
简式圆形喷泉|sculpture|0.6
摊位小凳|bench|0.45
高架手推车|sculpture|1.2
圆冠乔木|tree|5
八角木亭|pavilion|3.5
木廊架|pergola|2.8
儿童攀爬架|play-equipment|2.8
双座秋千架|play-equipment|2.7
篮球架|fitness|4
户外双杠|fitness|1.23
户外单杠|fitness|2.7
儿童摇摇马|play-equipment|1
隔离柱|sculpture|0.9
灌木花箱|shrub|1.12
户外遮阳伞|pergola|2.5
公园废物箱|bin|1
现代路灯|light|5
铁艺围栏|sculpture|1.2
铁丝网围栏|sculpture|1.8
出入口道闸|sculpture|1.04
交通锥|sculpture|0.65
大型垃圾收集箱|bin|1.4
活动音箱|sculpture|1.2
小型音箱|sculpture|0.6
小型雨棚|pergola|1
宽幅雨棚|pergola|1
活动帐篷|pavilion|2.8
长形活动帐篷|pavilion|2.8
双顶帐篷|pavilion|2.8
木质活动平台|stage|0.6
架高活动平台|stage|0.8
多向木质导视牌|sign|1.8
单向导视牌|sign|1.8
滨水木桥|sculpture|1.2
石拱步桥|sculpture|1.2
大型户外花盆|sculpture|0.6
小型户外花盆|sculpture|0.6
街角休闲长椅|bench|0.85
街边小遮阳棚|pergola|0.9
街边宽遮阳棚|pergola|0.9
绿色文化旗幡|sign|2
红色文化旗幡|sign|2`.split('\n').map(row => row.split('|'));
const catalog = JSON.parse(fs.readFileSync(path.join(source, 'catalog/asset_catalog.json'), 'utf8'));
const templates = JSON.parse(fs.readFileSync(path.join(source, 'templates/scene_combinations.json'), 'utf8')).templates;
if (definitions.length !== 100 || catalog.assets.length !== 100) throw Error('Unexpected source catalog');
fs.mkdirSync(path.join(out, 'models'), { recursive: true });
const report = [];
const structures = new Set(['stall','pavilion','pergola','stage','play-equipment']);
const assets = catalog.assets.map(a => {
  const [label, category, height] = definitions[Number(a.id.slice(-3)) - 1];
  let bytes = fs.readFileSync(path.join(source, a.path));
  const parsed = Glb.readGlb(bytes);
  for (const image of parsed.json.images || []) {
    if (!image.uri || image.uri.startsWith('data:')) continue;
    const local = path.resolve(source, path.dirname(a.path), image.uri);
    const cache = path.join(out, 'source-textures', a.path.split('/')[2], path.basename(image.uri));
    const texture = fs.readFileSync(fs.existsSync(local) ? local : cache);
    image.uri = `data:image/${path.extname(image.uri).toLowerCase() === '.jpg' ? 'jpeg' : 'png'};base64,${texture.toString('base64')}`;
  }
  bytes = Glb.writeGlb(parsed.json, parsed.binary);
  const before = Glb.inspectGlb(bytes);
  // Scale the complete scene uniformly, then anchor at ground; never distort individual axes.
  const unit = Number(height) / before.bounds.size[1];
  const normalized = Glb.normalizeGlb(bytes, { metersPerUnit: unit });
  const size = normalized.inspection.bounds.size;
  const file = `${a.id}.glb`;
  fs.writeFileSync(path.join(out, 'models', file), Buffer.from(normalized.buffer));
  report.push({ id:a.id, label, originalSize:before.bounds.size, metersPerUnit:unit, sizeM:size, triangles:before.triangleCount });
  const url = `3D_scenes_edit/assets/curated/models/${file}?v=20261105`;
  const catalogCategory=({'boundaries':'boundary-fixture','waterfront':'bridge','paving':'paving-module','traffic':'traffic-fixture','culture-display':'culture-display','event':'event-equipment','planters':'planter-fixture','landscape':'landscape-fixture'})[a.category] || (a.category==='market-event'&&category!=='stall'?'market-equipment':category);
  return { id:`seed:curated:${a.id}`, kind:structures.has(category)?'structure':'asset', category, catalogCategory, label,
    footprintM:[size[0],size[2]], defaultHeightM:size[1], renderer:'glb', fileType:'glb', url, lowUrl:url, status:'published',
    metadata:{ source:a.source, sourceUrl:a.sourceUrl || null, license:a.license, originalLabel:a.label, originalPath:a.path,
      attributionUrl:'3D_scenes_edit/assets/curated/ATTRIBUTION.md', calibration:{metersPerUnit:unit, targetHeightM:Number(height)} } };
});
const byId = new Map(assets.map(a => [a.id.replace('seed:curated:',''), a]));
function extent(a, degrees, scale) {
  const angle = degrees*Math.PI/180, c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  return [(a.footprintM[0]*c+a.footprintM[1]*s)*scale,(a.footprintM[0]*s+a.footprintM[1]*c)*scale];
}
const overlapAllowed = new Set(['pavilion','pergola','tree','shrub','stage']);
for (const t of templates) {
  let spread=1;
  // Preserve the template layout but increase spacing when calibrated furniture would overlap.
  for(let i=0;i<t.objects.length;i++)for(let j=i+1;j<t.objects.length;j++){
    const x=t.objects[i],y=t.objects[j],a=byId.get(x.assetId),b=byId.get(y.assetId);
    if(overlapAllowed.has(a.category)||overlapAllowed.has(b.category))continue;
    const ea=extent(a,x.rotationYDeg||0,x.scale||1),eb=extent(b,y.rotationYDeg||0,y.scale||1);
    const dx=Math.abs(x.position[0]-y.position[0]),dy=Math.abs(x.position[2]-y.position[2]);
    if(dx+dy<0.001)continue;
    const need=Math.min(dx?((ea[0]+eb[0])/2+.4)/dx:Infinity,dy?((ea[1]+eb[1])/2+.4)/dy:Infinity);
    spread=Math.max(spread,need);
  }
  const children=t.objects.map(o=>({assetRef:byId.get(o.assetId).id,offsetM:[o.position[0]*spread,-o.position[2]*spread],headingDeg:-(o.rotationYDeg||0),scale:o.scale||1,heightOffsetM:o.position[1]||0}));
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const o of children){const a=assets.find(a=>a.id===o.assetRef),e=extent(a,o.headingDeg,o.scale);for(let k=0;k<2;k++){bounds[k]=Math.min(bounds[k],o.offsetM[k]-e[k]/2);bounds[k+2]=Math.max(bounds[k+2],o.offsetM[k]+e[k]/2);}}
  const center=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];children.forEach(o=>o.offsetM=o.offsetM.map((n,k)=>n-center[k]));
  assets.push({id:`seed:curated:${t.id}`,kind:'group',category:'composite',label:t.label,children,footprintM:[bounds[2]-bounds[0],bounds[3]-bounds[1]],defaultHeightM:Math.max(...children.map(o=>assets.find(a=>a.id===o.assetRef).defaultHeightM*o.scale+o.heightOffsetM)),metadata:{source:'Curated scene combinations',layoutSpread:spread,attributionUrl:'3D_scenes_edit/assets/curated/ATTRIBUTION.md'}});
}
fs.copyFileSync(path.join(source,'ATTRIBUTION.md'),path.join(out,'ATTRIBUTION.md'));
fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify({schemaVersion:1,assets},null,2)+'\n');
fs.writeFileSync(path.join(out,'calibration-report.json'),JSON.stringify({note:'Design defaults in metres, uniformly scaled; source geometry retained.',models:report},null,2)+'\n');
console.log(`Imported ${catalog.assets.length} calibrated GLBs and ${templates.length} editable combinations.`);
