"""Orthographic facade parsing using detector boxes, contour fitting and rules.

No language model, per-image Python generation, or reference-house coordinates.
Depth and hidden roof topology remain explicit design assumptions.
"""
import math
import cv2
import numpy as np
from PIL import Image
from ..app.domain import number
from ..app.facade import normalize_facade
from .facade_features import image_arch,railing_evidence,appearance_evidence,depth_evidence,overlap


def valid_box(box):
    return (isinstance(box, (list,tuple)) and len(box)==4 and
            all(isinstance(x,(int,float)) and math.isfinite(x) and 0<=x<=1 for x in box)
            and box[2]-box[0]>.01 and box[3]-box[1]>.01)


def fit_arch(d):
    """Fit an elliptical top using contour shoulders, never floor bands."""
    a,b,c,e=d['box'];pts=d.get('mask_contour', [])
    if len(pts)<5:return 0.
    p=np.asarray(pts,dtype=float)
    if p.ndim!=2 or p.shape[1]!=2 or not np.isfinite(p).all():return 0.
    upper=p[p[:,1]<b+(e-b)*.35]
    if len(upper)<3:return 0.
    left=upper[upper[:,0]<a+(c-a)*.25];right=upper[upper[:,0]>c-(c-a)*.25]
    central=upper[(upper[:,0]>a+(c-a)*.3)&(upper[:,0]<c-(c-a)*.3)]
    if not len(left) or not len(right) or not len(central):return 0.
    rise=min(float(np.max(left[:,1])),float(np.max(right[:,1])))-float(np.min(central[:,1]))
    if rise < max(.006,(e-b)*.025):return 0.
    return min(rise,(e-b)*.3)


def roof_profile(path, box):
    """Conservative red-tile silhouette peaks; not a full 3D roof estimator."""
    with Image.open(path) as im: rgb=np.array(im.convert('RGB'))
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    mask=(((hsv[:,:,0]<24)|(hsv[:,:,0]>170))&(hsv[:,:,1]>65)&(hsv[:,:,2]>65)).astype('uint8')
    H,W=mask.shape;a,b,c,e=box
    roi=mask[int(b*H):max(int(e*H),int(b*H)+1),int(a*W):int(c*W)]
    if roi.size==0 or roi.mean()<.12:return {'count':1,'split':.5,'confidence':'low','reason':'屋顶色彩/轮廓不足，先使用一个屋顶'}
    # Top envelope followed by a light median filter; valleys divide roof masses.
    valid=roi.any(axis=0);top=roi.argmax(axis=0).astype('float32')
    top[~valid]=roi.shape[0]
    top=cv2.medianBlur(top.reshape(1,-1),5).ravel()
    n=len(top);best=None
    for x in range(int(n*.25),int(n*.75)):
        lo=max(0,x-int(n*.22));hi=min(n,x+int(n*.22))
        left=float(np.min(top[lo:x]));right=float(np.min(top[x+1:hi]))
        prominence=float(top[x])-max(left,right)
        if prominence>=max(2,roi.shape[0]*.10) and (best is None or prominence>best[0]):best=(prominence,x)
    if best:return {'count':2,'split':best[1]/n,'confidence':'low','reason':'红瓦上轮廓出现分峰；双屋顶仅为候选，需要检查'}
    return {'count':1,'split':.5,'confidence':'low','reason':'单张正立面不能唯一确认屋顶组合，默认一个屋顶'}


def roof_palette(path, box):
    with Image.open(path) as im:
        w,h=im.size;a,b,c,e=box
        pixels=np.asarray(im.convert('RGB').crop((int(a*w),int(b*h),max(int(c*w),int(a*w)+1),max(int(e*h),int(b*h)+1)))).reshape(-1,3)
    pixels=pixels[(pixels.min(axis=1)>25)&(pixels.max(axis=1)<245)]
    if not len(pixels):return 'red'
    r,g,b=np.median(pixels,axis=0)
    return 'red' if r>g*1.15 and r>b*1.15 else 'gray'


def safe_split(openings, width, target):
    intervals=sorted([(o['x']-o['width']/2-.055,o['x']+o['width']/2+.055) for o in openings])
    merged=[]
    for a,b in intervals:
        if merged and a<=merged[-1][1]:merged[-1][1]=max(b,merged[-1][1])
        else:merged.append([a,b])
    edges=[[-width/2,-width/2]]+merged+[[width/2,width/2]]
    options=[]
    for a,b in zip(edges,edges[1:]):
        lo=max(a[1],-width/2+1.1);hi=min(b[0],width/2-1.1)
        if hi>lo:options.append(max(lo,min(hi,target)))
    if not options:raise ValueError('门窗之间没有安全体块分界，请使用一个屋顶或调整门窗范围')
    return min(options,key=lambda x:abs(x-target))


def facade_draft(building, analysis, photo_path, params, photo_id):
    floors=number(params.get('floors',3),1,6,'层数',True)
    fh=number(params.get('floor_height',3.4),2.4,5,'层高');height=floors*fh
    ds=[d for d in analysis.get('detections',[]) if valid_box(d.get('box'))]
    box=analysis.get('building_box',[0,0,1,1])
    if not valid_box(box):raise ValueError('建筑识别范围无效')
    if params.get('crop') is not None and not valid_box(params['crop']):
        raise ValueError('请框选完整墙身（不含屋顶）')
    from .facade_calibration import calibrate
    crop,ds,roofs,calibration=calibrate(analysis,ds,params.get('crop'))
    if not valid_box(crop):raise ValueError('请框选完整墙身（不含屋顶）')
    x0,y0,x1,y1=crop
    with Image.open(photo_path) as im:aspect=im.width/im.height;rgb=np.asarray(im.convert('RGB'))
    width=number(params.get('width') or height*(x1-x0)*aspect/(y1-y0),3,40,'设计宽度')
    depth=number(params.get('depth') or 8.8,2,30,'进深')
    openings=[];rejected=0
    for i,d in enumerate(sorted(ds,key=lambda d:d.get('score',0),reverse=True)):
        if d['kind'] not in ('window','door'):continue
        a,b,c,e=d['box']
        if a<x0-.015 or c>x1+.015 or b<y0-.015 or e>y1+.015:continue
        a=max(a,x0+.004);c=min(c,x1-.004);b=max(b,y0+.004);e=min(e,y1-.004)
        x=((a+c)/2-x0)/(x1-x0)*width-width/2
        w=(c-a)/(x1-x0)*width;z=max(.04,(y1-e)/(y1-y0)*height)
        h=(e-b)/(y1-y0)*height
        if w<.23 or h<.25:continue
        if any(abs(x-q['x'])<(w+q['width'])/2-.01 and z<q['bottom']+q['height']-.01 and z+h>q['bottom']+.01 for q in openings):
            rejected+=1;continue
        fit=image_arch(rgb,d) if d['kind']=='window' else {'rise':0,'confidence':0}
        arch=(fit['rise'] if fit['confidence']>.6 else fit_arch(d))/(y1-y0)*height if d['kind']=='window' else 0
        openings.append({'id':f'photo-{i}','mass':'mass-0','x':x,'width':w,'bottom':z,
            'height':min(h,height-.04-z),'kind':d['kind'],'shape':'arched' if arch else 'rect',
            'arch_rise':min(max(.03,arch),h*.6,w) if arch else 0,
            'evidence_box':d['box'],'confidence':d.get('score',0)})
    if not openings:raise ValueError('没有可用门窗；本次停止生成，请换标准正立面图或调整墙身框选')
    balconies=[];fences=0
    for d in sorted(ds,key=lambda d:d.get('score',0),reverse=True):
        if d['kind']!='balcony':continue
        a,b,c,e=d['box']
        if (y1-e)/(y1-y0)<.13:fences+=1;continue
        if b<y0 or e>y1 or a>x1 or c<x0:continue
        a=max(a,x0+.01);c=min(c,x1-.01)
        w=(c-a)/(x1-x0)*width;x=((a+c)/2-x0)/(x1-x0)*width-width/2
        z=(y1-e)/(y1-y0)*height
        near=round(z/fh)*fh
        if .5<near<height-.5 and abs(near-z)<fh*.23:z=near
        if z<.5 or z>height-.6 or w<.5:continue
        duplicate=next((q for q in balconies if abs(q['base']-z)<.35 and abs(q['x']-x)<min(q['width'],w)*.45),None)
        if duplicate:continue
        balconies.append({'x':x,'width':w,'base':z,'depth':.9,
                           'rail_height':max(.65,min(1.1,(e-b)/(y1-y0)*height))})
    boxes=[d['box'] for d in ds if d['kind']=='balcony' and (y1-d['box'][3])/(y1-y0)>.13]
    for b in balconies:
        left=x0+(b['x']-b['width']/2+width/2)/width*(x1-x0)
        right=x0+(b['x']+b['width']/2+width/2)/width*(x1-x0)
        bottom=y1-b['base']/height*(y1-y0)
        near=min(boxes,key=lambda box:abs((box[0]+box[2])/2-(left+right)/2)+abs(box[3]-bottom)) if boxes else crop
        b['railing']=railing_evidence(rgb,near,ds,boxes)
    profile=roof_profile(photo_path,roofs[0]['box']) if roofs else {'count':1,'split':.5,'reason':'未检测到屋顶，默认平顶'}
    count=number(params.get('roof_count') or profile['count'],1,2,'屋顶数量',True)
    split=number(params.get('roof_split',profile['split']),.2,.8,'屋顶分界比例')
    offset=number(params.get('front_offset',0),-2.5,2.5,'右体块前突')
    bounds=[-width/2,width/2]
    if count==2:bounds.insert(1,safe_split(openings,width,(split-.5)*width))
    masses=[{'id':f'mass-{i}','x0':a,'x1':b,'front':-offset if i else 0}
            for i,(a,b) in enumerate(zip(bounds,bounds[1:]))]
    for o in openings:o['mass']=next(m['id'] for m in masses if m['x0']<o['x']<m['x1'])
    accessories=[]
    for d in ds:
        if d['kind']!='air_conditioner' or d.get('score',0)<.32:continue
        a,b,c,e=d['box']
        if a<x0 or c>x1 or b<y0 or e>y1:continue
        if any(overlap(d['box'],o['evidence_box'])>.35 for o in openings):continue
        if any(overlap(d['box'],q['evidence_box'])>.6 for q in accessories):continue
        x=((a+c)/2-x0)/(x1-x0)*width-width/2;w=(c-a)/(x1-x0)*width
        z=max(.05,(y1-e)/(y1-y0)*height);ht=(e-b)/(y1-y0)*height
        mass=next((m for m in masses if m['x0']<=x-w/2 and m['x1']>=x+w/2),None)
        if mass and .2<w<3 and .15<ht<2:
            accessories.append({'kind':'air_conditioner','mass':mass['id'],'x':x,'width':w,'bottom':z,'height':ht,
                'depth':.32,'confidence':d['score'],'evidence_box':d['box']})
    dep=depth_evidence(analysis,crop,ds)
    rise=number(params.get('roof_rise') or (max(.4,min(3,(y0-box[1])/(y1-y0)*height)) if roofs else .18),.15,6,'屋顶升高')
    typ=params.get('roof_type') or ('hip' if roofs else 'flat')
    structure={}
    retrieval=analysis.get('component_retrieval',{})
    if analysis.get('feature_version',0)>=3:
        from .structure_graph import infer_components
        graph=infer_components(rgb,ds,crop,width,height,fh,masses,openings,balconies,retrieval)
        openings=graph.pop('openings');balconies=graph.pop('balconies');roof_details=graph.pop('roof');structure=graph
        if not params.get('roof_type') and roof_details.get('type'):typ=roof_details['type']
        if not params.get('roof_rise') and roof_details.get('rise'):rise=roof_details['rise']
    else:roof_details={}
    assumptions=calibration['notes']+['只解析标准正立面；未自动校正透视。',
        '入口平台/台阶按门槛候选自动支承；尺度是设计假设，非照片实测。',
        f'进深 {depth:.2f} m、外挑阳台默认深度 0.90 m 为设计假设；凹阳台另按结构记录。',
        '设计体块不强制匹配选中建筑的原占地；应用前需核对边界。',
        '窗框、套线、瓦片和栏杆截面复用 V3 构件样式，非逐个细节实测。',
        f'屋顶 {count} 个，类型 {typ}；'+profile['reason'],
        '体块前后进退默认 0；正立面不能确定真实深度。',
        dep.get('reason','未启用相对深度估计；前后退进未作实测。'),
        '空调位置和正面尺寸来自检测；外机厚度 0.32 m、风扇和支架为通用构件预设。']
    if params.get('roof_count'):assumptions.append('屋顶数量由用户确认。')
    if structure.get('porches'):
        recesses=' / '.join(f"{v:.2f}" for v in sorted({p['recess'] for p in structure['porches']}))
        assumptions.append(f'门廊/阳台由图像证据及构件关系推断，凹进 {recesses} m 是设计预设，不是照片测深。')
    if any(r.get('access_kind')=='glazed_door' for r in structure.get('balcony_relations',[])):
        assumptions.append('阳台后方落地开口按通行关系推定玻璃门；被栏杆遮挡的门底为规则补全。')
    if retrieval.get('available'):assumptions.append('构件检索库仅含六张开发图的区域原型；相似度不是正确率，未知样式和传统彩绘雕花仍可能缺失。')
    if sum(o['bottom']+o['height']*.5<fh*.9 for o in openings)<2 and len(openings)>=5:
        assumptions.append('底层候选较少，可能漏掉卷帘门或开敞空间；当前草案不能视为完整还原，可在照片上补画漏检。')
    ring=building['local_rings'][0]
    front=int(params.get('front_edge',max(range(len(ring)-1),key=lambda i:math.dist(ring[i],ring[i+1]))))
    spec=normalize_facade(building,{'engine':'facade-v2','floors':floors,'floor_height':fh,'front_edge':front,
        'facade':{'width':width,'depth':depth,'masses':masses,'openings':openings,'balconies':balconies,
            'accessories':accessories,'entrance_support_version':1,'feature_version':min(3,analysis.get('feature_version',0)),'appearance':appearance_evidence(rgb,crop,ds,roofs[0]['box'] if roofs else None),
            'structure':structure,'component_retrieval':retrieval,
            'depth_evidence':dep,
            'roof':{'type':typ,'rise':rise,'overhang':.38,'palette':roof_palette(photo_path,roofs[0]['box']) if roofs else 'gray',
                    **({'texture':roof_details['texture']} if roof_details.get('texture') else {}),
                    'details':roof_details.get('details',[]),'eave_curve':roof_details.get('eave_curve',0)},'wall_joints':True,
            'complete_hidden':params.get('complete_hidden',True),'render_profile':params.get('render_profile','v3-natural')},
        'assumptions':assumptions,'evidence':[{'photo_id':photo_id,'crop':crop,
            'source':'grounding-dino+sam2+contour-rules','calibration':calibration,'measured':False,'confirmed':False}]})
    return {'spec':spec,'crop':crop,'calibration':calibration,'warnings':spec['assumptions'],'summary':{
        'floors':floors,'photo_openings':len(openings),'rule_openings':0,
        'arched_openings':sum(o['shape']=='arched' for o in openings),
        'roof_count':count,'roof':typ,'balcony_count':len(balconies),
        'ground_fences_rejected':fences,'overlap_rejected':rejected,
        'air_conditioners':len(accessories),'depth_status':dep['status'],
        'columns':len(structure.get('columns',[])),'porches':len(structure.get('porches',[])),
        'solid_parapets':sum(b.get('railing',{}).get('style')=='solid' for b in balconies),
        'shutters':sum(o.get('subtype')=='shutter' for o in openings),
        'roof_details':len(roof_details.get('details',[])),
        'roof_split':(bounds[1]/width+.5) if count==2 else .5}}
