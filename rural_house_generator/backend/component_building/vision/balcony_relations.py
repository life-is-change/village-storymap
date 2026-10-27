"""Conservative balcony/access relations, with pixel-supported design recesses.

A railing alone cannot distinguish a projecting from an inset balcony. Recess
depths here are design priors; no image pixel is converted to measured depth.
"""
import copy
import numpy as np


def relate_balconies(rgb,crop,width,height,fh,masses,openings,balconies,porches):
    ops=copy.deepcopy(openings);zones=copy.deepcopy(porches);relations=[]
    x0,y0,x1,y1=crop
    def luminance(a,c,bottom,top):
        h,w=rgb.shape[:2]
        left=round((x0+(a+width/2)/width*(x1-x0))*w)
        right=round((x0+(c+width/2)/width*(x1-x0))*w)
        upper=round((y1-top/height*(y1-y0))*h)
        lower=round((y1-bottom/height*(y1-y0))*h)
        patch=rgb[max(0,upper):min(h,lower),max(0,left):min(w,right)]
        return float(np.median(patch.mean(axis=2))) if patch.size>=18 else None
    for i,b in enumerate(balconies):
        lo,hi=b['x']-b['width']/2,b['x']+b['width']/2
        candidates=[o for o in ops if o['shape']=='rect' and o.get('subtype') not in ('shutter','passage')
            and lo+.04<=o['x']-o['width']/2 and o['x']+o['width']/2<=hi-.04
            and -.08<=o['bottom']-b['base']<=min(b['rail_height']+.10,fh*.27)
            and o['height']>=fh*.53 and o['width']>=.75]
        if not candidates:continue
        o=max(candidates,key=lambda item:item['width']*item['height'])
        mass=next((m for m in masses if m['id']==o['mass'] and m['x0']<=lo and hi<=m['x1']),None)
        if mass is None:continue
        top=o['bottom']+o['height'];bottom=b['base']+.05
        # Extending an occluded opening must never cut through a second opening.
        if any(q is not o and abs(q['x']-o['x'])<(q['width']+o['width'])/2-.01
               and bottom<q['bottom']+q['height']-.01 and top>q['bottom']+.01 for q in ops):continue
        if o['kind']=='window':
            o.update(kind='door',subtype='glazed_door',bottom=bottom,height=top-bottom,
                     subtype_source='balcony-floor-access-design-prior')
        relation={'balcony':i,'opening_id':o['id'],'placement':'projected-prior',
                  'access_kind':'glazed_door' if o.get('subtype')=='glazed_door' else 'door',
                  'depth_measured':False,'source':'balcony-floor-opening-relation'}
        existing=next((p for p in zones if p['mass']==mass['id'] and p['x0']<=o['x']<=p['x1']
                       and p['bottom']<=b['base']+.1<p['top']),None)
        left,right=o['x']-o['width']/2,o['x']+o['width']/2
        z0,z1=b['base']+b['rail_height']+.05,min(b['base']+fh-.15,height-.1)
        inside=[luminance(a,c,z0,z1) for a,c in [(lo+.03,left-.05),(right+.05,hi-.03)] if c-a>=.12]
        outside=[luminance(a,c,z0,z1) for a,c in [(max(mass['x0']+.05,lo-.5),lo-.1),
                                                (hi+.1,min(mass['x1']-.05,hi+.5))] if c-a>=.12]
        inside=[v for v in inside if v is not None];outside=[v for v in outside if v is not None]
        # Require both side returns to be appreciably darker than adjacent wall.
        supported=len(inside)==2 and outside and max(inside)<np.median(outside)*.78
        straddles=any(q['mass']==mass['id'] and q['bottom']<b['base']+fh and q['bottom']+q['height']>b['base']
                      and any(q['x']-q['width']/2+.02<x<q['x']+q['width']/2-.02 for x in (lo,hi)) for q in ops)
        if not existing and supported and not straddles:
            existing={'mass':mass['id'],'x0':lo,'x1':hi,'bottom':b['base'],
                      'top':min(height,b['base']+fh),'recess':1.0,
                      'source':'shaded-side-returns-design-prior','confidence':.5,'measured':False}
            zones.append(existing)
        if existing:
            relation.update(placement='recessed-prior',recess=existing['recess'])
            if existing['recess']<=1.0 and existing['x0']<=lo and hi<=existing['x1']:
                # A whole-height colonnade must keep its original ground floor.
                # Add only this balcony's local override; wall_front uses max.
                if existing['recess']<1.0:
                    zones.append({'mass':mass['id'],'x0':lo,'x1':hi,'bottom':b['base'],
                        'top':min(height,b['base']+fh),'recess':1.0,
                        'source':'hybrid-balcony-depth-design-prior','confidence':.5,'measured':False})
                relation.update(recess=1.0,clear_depth=1.5,depth_version=1)
        relations.append(relation)
    return ops,zones,relations
