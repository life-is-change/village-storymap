"""Constrained component relations inferred from pixels/boxes and local prototypes."""
import copy
import cv2
import numpy as np


def intersection(a,b):
    return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))


def merge_balconies(values):
    result=[]
    for b in sorted(copy.deepcopy(values),key=lambda x:x['width'],reverse=True):
        lo,hi=b['x']-b['width']/2,b['x']+b['width']/2
        duplicate=next((q for q in result if abs(q['base']-b['base'])<.45 and
            max(0,min(hi,q['x']+q['width']/2)-max(lo,q['x']-q['width']/2))/min(b['width'],q['width'])>.65),None)
        if duplicate:
            a=min(lo,duplicate['x']-duplicate['width']/2);c=max(hi,duplicate['x']+duplicate['width']/2)
            duplicate['x']=(a+c)/2;duplicate['width']=c-a
        else:result.append(b)
    return sorted(result,key=lambda x:(x['base'],x['x']))


def accepted_traits(retrieval,region,box=None):
    rows=[r for r in retrieval.get('regions',[]) if r['region']==region and r['match'].get('accepted')]
    if box is not None:rows.sort(key=lambda r:intersection(r['box'],box),reverse=True)
    if not rows:return {},None
    row=rows[0]
    if box is not None and intersection(row['box'],box)<=0:return {},None
    return row['match']['best']['traits'],row['match']['best']['id']


def roof_components(rgb,crop,width,height,detections,retrieval):
    H,W=rgb.shape[:2];x0,y0,x1,y1=crop
    traits,source=accepted_traits(retrieval,'roof')
    result={'type':traits.get('shape'),'eave_curve':.16 if traits.get('curved_eaves') else 0,
            'texture':traits.get('surface'),'details':[],'source':source,'measured_depth':False}
    # Fit the broad main roof band, excluding a narrow cap above it.
    a,c=max(0,int(x0*W)),min(W,int(x1*W));b=max(0,int((y0-.35)*H));e=max(b+1,int(y0*H))
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY);patch=gray[b:e,a:c]
    if patch.size:
        coverage=(patch<195).mean(axis=1);ys=np.where(coverage>.50)[0]
        if len(ys)>4:
            result['rise']=float(np.clip((ys[-1]-ys[0]+1)/H/(y1-y0)*height,.35,3))
    candidates=[d for d in detections if d['kind']=='roof_vent' and d['box'][3]<=y0+.025 and d['box'][2]-d['box'][0]<.35]
    if not candidates and patch.size:
        mask=((patch<155).astype('uint8'))
        n,labels,stats,centers=cv2.connectedComponentsWithStats(mask)
        for i in range(1,n):
            x,y,w,h,area=stats[i];cx,cy=centers[i]
            if .3*(c-a)<cx<.7*(c-a) and .035*(c-a)<w<.28*(c-a) and h>3 and area>25 and y+h<patch.shape[0]*.75:
                candidates.append({'box':[(a+x)/W,(b+y)/H,(a+x+w)/W,(b+y+h)/H],'score':.35,'source':'roof-silhouette-component'})
    if candidates:
        d=max(candidates,key=lambda d:d.get('score',0));a,b,c,e=d['box']
        result['details']=[{'kind':'ridge_vent','x':((a+c)/2-x0)/(x1-x0)*width-width/2,
                            'width':float(np.clip((c-a)/(x1-x0)*width,.35,3)),
                            'height':float(np.clip((e-b)/(y1-y0)*height,.25,1.2)),
                            'depth':.65,'source':d.get('source','detector'),'measured':False}]
    return result


def infer_components(rgb,ds,crop,width,height,fh,masses,openings,balconies,retrieval):
    x0,y0,x1,y1=crop;layout,source=accepted_traits(retrieval,'layout');name=layout.get('layout','unknown')
    openings=copy.deepcopy(openings);balconies=merge_balconies(balconies)
    for b in balconies:
        a=x0+(b['x']-b['width']/2+width/2)/width*(x1-x0);c=x0+(b['x']+b['width']/2+width/2)/width*(x1-x0)
        e=y1-b['base']/height*(y1-y0);top=e-b['rail_height']/height*(y1-y0);box=[a,top,c,e]
        rail,prototype=accepted_traits(retrieval,'railing',box)
        # The detector often calls the slab below an open rail a parapet.
        # Conflicting retrieved open-rail evidence needs a much stronger label.
        minimum=.65 if rail.get('style') in ('metal','stone') else .60
        solid=any(d['kind']=='parapet' and d.get('score',0)>minimum and intersection(d['box'],box)/max((c-a)*(e-top),1e-5)>.55 for d in ds)
        if solid or (rail.get('style')=='solid' and name=='recessed_corridor'):
            b['railing']={'style':'solid','confidence':.7,'source':'parapet-pixels-and-retrieval','ornament':'none'}
        elif prototype and rail.get('style') in ('stone','metal'):
            b['railing']={'style':rail['style'],'confidence':.6,'source':'component-retrieval:'+prototype,'ornament':b.get('railing',{}).get('ornament','none')}
    columns=[]
    for d in sorted(ds,key=lambda d:d.get('score',0),reverse=True):
        if d['kind']!='column' or d.get('score',0)<.3:continue
        a,b,c,e=d['box']
        if (e-b)/(c-a)<2 or a<x0-.02 or c>x1+.02 or e<=y0:continue
        x=((a+c)/2-x0)/(x1-x0)*width-width/2
        if any(abs(x-q['x'])<.35 for q in columns):continue
        if any(o['x']-o['width']*.35<x<o['x']+o['width']*.35 for o in openings):continue
        mass=next((m for m in masses if m['x0']<=x<=m['x1']),None)
        if mass:columns.append({'mass':mass['id'],'x':x,'bottom':0.,'height':height,
                               'width':float(np.clip((c-a)/(x1-x0)*width,.18,.55)),'depth':.30,
                               'source':'photo-column-detection','confidence':d['score'],'measured':False})
    porches=[]
    supported=name in ('front_colonnade','recessed_corridor','recessed_balcony')
    if supported or len(columns)>=2:
        for m in masses:
            if name=='recessed_balcony':
                zones=[(max(m['x0'],b['x']-b['width']/2),min(m['x1'],b['x']+b['width']/2),b['base'],min(height,b['base']+fh)) for b in balconies]
            else:zones=[(m['x0'],m['x1'],fh if name=='recessed_corridor' else 0,height)]
            for a,c,z,t in zones:
                if c-a<.8 or t-z<.5:continue
                porches.append({'mass':m['id'],'x0':a,'x1':c,'bottom':z,'top':t,'recess':.9,
                                 'source':'layout-and-column-prior','confidence':.55,'measured':False})
        if not columns and name in ('front_colonnade','recessed_corridor'):
            for m in masses:
                row=sorted([o for o in openings if o['mass']==m['id'] and fh*.15<o['bottom']+o['height']/2<fh*.95],key=lambda o:o['x'])
                positions=[m['x0']+.13,m['x1']-.13]+[(a['x']+a['width']/2+b['x']-b['width']/2)/2 for a,b in zip(row,row[1:]) if b['x']-b['width']/2-a['x']-a['width']/2>.3]
                for x in positions[:8]:columns.append({'mass':m['id'],'x':x,'bottom':fh if name=='recessed_corridor' else 0,
                    'height':height-(fh if name=='recessed_corridor' else 0),'width':.25,'depth':.30,
                    'source':'retrieved-layout-gap-prior','confidence':.35,'measured':False})
    for o in openings:
        box=o.get('evidence_box')
        if not box:continue
        for d in ds:
            if d['kind'] not in ('shutter','passage'):continue
            if d['kind']=='shutter' and (o['kind']!='door' or o['bottom']>fh*.25 or d.get('score',0)<.50):continue
            if d['kind']=='passage' and (o['kind']!='door' or d.get('score',0)<.55):continue
            ratio=intersection(box,d['box'])/max((box[2]-box[0])*(box[3]-box[1]),1e-5)
            if ratio>.6:
                o['subtype']=d['kind'];o['subtype_source']='photo-structure-detection'
                if d['kind']=='shutter':o['kind']='door'
    from .balcony_relations import relate_balconies
    openings,porches,relations=relate_balconies(rgb,crop,width,height,fh,masses,openings,balconies,porches)
    return {'version':1,'layout':name,'layout_source':source,'columns':columns[:16],'porches':porches[:12],'balcony_relations':relations,
            'openings':openings,'balconies':balconies,'roof':roof_components(rgb,crop,width,height,ds,retrieval),
            'metric_depth_measured':False}
