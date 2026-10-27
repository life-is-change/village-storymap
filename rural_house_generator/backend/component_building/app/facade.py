"""Validated, data-driven front elevation. No photo-specific building template."""
import math
from .domain import number
from .completion import hidden_openings


def normalize_facade(building, payload):
    f = payload.get('facade')
    if not isinstance(f, dict):
        raise ValueError('缺少标准立面结构')
    floors = number(payload.get('floors', 3), 1, 6, '层数', True)
    fh = number(payload.get('floor_height', 3.4), 2.4, 5, '层高')
    h = floors * fh
    width = number(f.get('width'), 3, 40, '设计宽度')
    depth = number(f.get('depth', 8), 2, 30, '设计进深')
    roof = dict(f.get('roof', {}))
    if roof.get('type') not in ('flat', 'hip', 'gable'):
        raise ValueError('屋顶形式无效')
    roof['rise'] = number(roof.get('rise', 1.5), .15, 6, '屋顶升高')
    roof['overhang'] = number(roof.get('overhang', .38), 0, .8, '出檐')
    roof['palette'] = roof.get('palette', 'red')
    if roof['palette'] not in ('red','gray'): raise ValueError('屋顶材质类型无效')
    raw_masses = f.get('masses', [])
    if not isinstance(raw_masses, list) or not 1 <= len(raw_masses) <= 3:
        raise ValueError('首版支持一至三个连续体块')
    masses = []
    for i, m in enumerate(raw_masses):
        x0 = number(m.get('x0'), -width/2, width/2, '体块起点')
        x1 = number(m.get('x1'), -width/2, width/2, '体块终点')
        front = number(m.get('front', 0), -3, 3, '立面进退')
        if x1 - x0 < 1: raise ValueError('体块过窄')
        if depth-front<1.2:raise ValueError('体块前沿超出后墙或进深过短')
        masses.append({'id': str(m.get('id', f'mass-{i}')), 'x0': x0, 'x1': x1,
                       'front': front})
    if len({m['id'] for m in masses}) != len(masses): raise ValueError('体块编号重复')
    masses.sort(key=lambda m: m['x0'])
    if abs(masses[0]['x0']+width/2) > .001 or abs(masses[-1]['x1']-width/2) > .001:
        raise ValueError('体块未覆盖设计宽度')
    if any(abs(a['x1']-b['x0']) > .001 for a, b in zip(masses, masses[1:])):
        raise ValueError('体块不能重叠或留缝')
    openings = []
    for i, o in enumerate(f.get('openings', [])):
        if i >= 150: raise ValueError('门窗数量超过上限')
        mass = next((m for m in masses if m['id'] == o.get('mass')), None)
        if mass is None: raise ValueError('门窗缺少所属体块')
        x = number(o.get('x'), -width/2, width/2, '门窗横向位置')
        w = number(o.get('width'), .2, min(12, width), '门窗宽度')
        z = number(o.get('bottom'), .02, h-.2, '窗底')
        height = number(o.get('height'), .2, h, '门窗高度')
        if x-w/2 < mass['x0']+.02-1e-6 or x+w/2 > mass['x1']-.02+1e-6 or z+height > h-.03:
            raise ValueError('门窗超出所属体块墙面，需调整体块分界或门窗')
        shape = o.get('shape', 'rect'); kind = o.get('kind', 'window')
        if shape not in ('rect', 'arched') or kind not in ('window', 'door'):
            raise ValueError('门窗类型无效')
        rise = number(o.get('arch_rise', min(w*.4, height*.23)), .02,
                      min(height*.7, w), '拱顶升高') if shape == 'arched' else 0
        for q in openings:
            if abs(q['x']-x) < (q['width']+w)/2-.01 and z < q['bottom']+q['height']-.01 and z+height > q['bottom']+.01:
                raise ValueError('门窗重叠')
        openings.append({'id': f'opening-{i}', 'mass': mass['id'], 'x': x,
            'width': w, 'bottom': z, 'height': height, 'kind': kind, 'shape': shape,
            'arch_rise': rise, 'evidence_box': o.get('evidence_box'),
            'confidence': number(o.get('confidence', 0), 0, 1, '检测置信度'),
            'subtype':o.get('subtype') if o.get('subtype') in ('shutter','passage','glazed_door') else None})
    if not openings: raise ValueError('没有可用门窗；请调整识别或更换标准正立面图')
    balconies = []
    for b in f.get('balconies', []):
        if len(balconies) >= 12: raise ValueError('阳台数量超过上限')
        x = number(b.get('x'), -width/2, width/2, '阳台横向位置')
        w = number(b.get('width'), .5, width, '阳台宽度')
        z = number(b.get('base'), .5, h-.4, '阳台底高')
        d = number(b.get('depth', .9), .3, 2.5, '阳台深度')
        if x-w/2 < -width/2 or x+w/2 > width/2: raise ValueError('阳台超出立面')
        rail=b.get('railing',{});style=rail.get('style','unknown')
        if style not in ('stone','metal','solid','unknown'):raise ValueError('栏杆类别无效')
        balconies.append({'x':x,'width':w,'base':z,'depth':d,
            'rail_height':number(b.get('rail_height',.9),.5,1.3,'栏杆高度'),
            'railing':{'style':style,'confidence':number(rail.get('confidence',0),0,1,'栏杆置信度'),
                'source':str(rail.get('source','legacy-style-default'))[:80],
                'ornament':'medallion' if rail.get('ornament')=='medallion' else 'none'}})
    accessories=[]
    for item in f.get('accessories',[])[:20]:
        if item.get('kind')!='air_conditioner':raise ValueError('附属构件类别无效')
        mass=next((m for m in masses if m['id']==item.get('mass')),None)
        if mass is None:raise ValueError('空调缺少所属体块')
        x=number(item.get('x'),-width/2,width/2,'空调横向位置')
        w=number(item.get('width'),.2,3,'空调宽度');z=number(item.get('bottom'),.05,h-.2,'空调底高')
        ht=number(item.get('height'),.15,2,'空调高度')
        if x-w/2<mass['x0'] or x+w/2>mass['x1'] or z+ht>h:raise ValueError('空调超出墙身')
        accessories.append({'kind':'air_conditioner','mass':mass['id'],'x':x,'width':w,'bottom':z,'height':ht,
            'depth':number(item.get('depth',.32),.15,.8,'空调进深'),
            'confidence':number(item.get('confidence',0),0,1,'空调置信度'),
            'evidence_box':item.get('evidence_box'),'source':'photo-detection'})
    appearance={}
    if f.get('appearance'):
        raw=f['appearance']
        for key in ('wall_srgb','roof_srgb'):
            rgb=raw.get(key)
            if not isinstance(rgb,list) or len(rgb)!=3:raise ValueError('材质颜色无效')
            appearance[key]=[number(v,0,1,'材质颜色') for v in rgb]
        appearance.update(source=str(raw.get('source','photo-color'))[:80],measured_albedo=False)
        zones={}
        for key,rgb in raw.get('zones',{}).items():
            if key=='socle_srgb' and isinstance(rgb,list) and len(rgb)==3:zones[key]=[number(v,0,1,'分区颜色') for v in rgb]
        appearance['zones']=zones
    dep=f.get('depth_evidence',{})
    depth_evidence={'status':str(dep.get('status','unavailable'))[:30],'source':str(dep.get('source','none'))[:100],
        'applied':False,'measured':False,'relation':str(dep.get('relation','unknown'))[:30]}
    for key in ('reason','band_differences'):
        if key in dep:depth_evidence[key]=dep[key]
    ring = building['local_rings'][0]
    front = number(payload.get('front_edge', 0), 0, len(ring)-2, '朝向边', True)
    a, b = ring[front:front+2];length = math.dist(a, b)
    ex, ey = (b[0]-a[0])/length, (b[1]-a[1])/length
    center = [(a[0]+b[0])/2, (a[1]+b[1])/2]
    def xy(x,y): return [center[0]+ex*x-ey*y, center[1]+ey*x+ex*y]
    outline = [xy(-width/2,0),xy(width/2,0),xy(width/2,depth),xy(-width/2,depth),xy(-width/2,0)]
    assumptions = [str(x)[:500].replace('侧背面保留素墙','侧背面按规则补门窗（非识别）') for x in payload.get('assumptions', [])][:30]
    completion=hidden_openings(masses,depth,floors,fh,f.get('complete_hidden',True) is True)
    if completion['enabled'] and not any('侧背面规则补全' in x for x in assumptions):
        assumptions.append('侧背面规则补全：背面一扇门，侧背面按层布置窗；均为设计假设，非照片识别。')
    profile=f.get('render_profile','v3-natural')
    from .structure import normalize_structure
    structure=normalize_structure(f.get('structure'),masses,width,h,depth)
    relation_ids={str(o.get('id',f'opening-{i}')):openings[i]['id'] for i,o in enumerate(f.get('openings',[]))}
    structure['balcony_relations']=[{**r,'opening_id':relation_ids[r['opening_id']]}
        for r in structure.get('balcony_relations',[]) if r.get('opening_id') in relation_ids]
    roof['texture']=roof.get('texture','gray_wave_tile' if roof['palette']=='gray' else 'clay_tiles')
    if roof['texture'] not in ('gray_wave_tile','clay_tiles','metal_sheet'):raise ValueError('瓦面类型无效')
    roof['eave_curve']=number(roof.get('eave_curve',0),0,.35,'檐角起翘')
    details=[]
    for item in roof.get('details',[])[:3]:
        if item.get('kind')!='ridge_vent':raise ValueError('屋顶附属构件无效')
        details.append({'kind':'ridge_vent','x':number(item.get('x',0),-width/2,width/2,'屋脊构件横向位置'),
            'width':number(item.get('width',1),.2,4,'屋脊构件宽度'),'height':number(item.get('height',.4),.15,1.5,'屋脊构件高度'),
            'depth':number(item.get('depth',.65),.2,1.5,'屋脊构件进深'),'measured':False})
    roof['details']=details
    from .entrance import plan_entrances
    support_version=number(f.get('entrance_support_version',0),0,1,'入口支承版本',True)
    entrances=plan_entrances(openings,balconies,fh) if support_version else []
    note='检测到缺少阳台/平台支承的高位门；未自动生成跨层台阶，请核对构件关系。'
    if any(e['kind']=='unresolved-upper' for e in entrances) and note not in assumptions:
        assumptions.append(note)
    if profile not in ('v3-natural','v3-original','rural-realistic'):raise ValueError('渲染材质方案无效')
    if profile=='rural-realistic':
        assumptions=[x for x in assumptions if '窗框、套线、瓦片和栏杆截面复用' not in x]
        assumptions=[x for x in assumptions if '墙漆、陶瓦贴图和黑色金属栏杆是写实外观预设' not in x]
        note='材质颜色和栏杆类别优先取照片证据；贴图、构件截面和不可见部分仍为设计预设，并非逐项实测。'
        if note not in assumptions:assumptions.append(note)
    return {'schema_version': 2, 'engine': 'facade-v2', 'generator_version': 'facade-v2.1',
        'building_uuid': building['id'], 'source_geometry_revision': building['geometry_revision'],
        'floors': floors, 'floor_height': fh, 'front_edge': front,
        'footprint_source': building['local_rings'], 'footprint_model': [outline],
        'local_frame': {'origin': building['origin'], 'axes': 'east,north,up', 'unit': 'm',
            'anchor': 'source-origin', 'front_midpoint': center, 'front_tangent': [ex,ey]},
        'facade': {'width': width, 'depth': depth, 'masses': masses, 'openings': openings,
            'balconies': balconies, 'roof': roof,'entrance_support_version':support_version,'entrances':entrances,'accessories':accessories,
            'appearance':appearance,'depth_evidence':depth_evidence,
            'feature_version':number(f.get('feature_version',0),0,3,'解析版本',True),
            'structure':structure,'component_retrieval':f.get('component_retrieval',{}),
            'completion':completion,'complete_hidden':completion['enabled'],
            'side_openings':[o for o in completion['openings'] if o['face']!='rear'],
            'render_profile':profile,
            'wall_joints': f.get('wall_joints', True) is True},
        'roof': roof, 'metrics': {'wall_height': h, 'total_height': h+roof['rise'], 'area_m2': width*depth},
        'assumptions': assumptions, 'warnings': assumptions,
        'evidence': payload.get('evidence', []), 'detail_level': 'fine'}
