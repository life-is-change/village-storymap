"""Deterministic entrance support; all dimensions are explicit design priors.

Kept independent of Blender so threshold/landing relations can be verified.
Upper-floor doors never acquire a staircase from ground by default.
"""
import math


def plan_entrances(openings, balconies, floor_height):
    result=[]
    for o in openings:
        if o['kind']!='door':continue
        z=o['bottom']
        balcony=next((b for b in balconies if b['x']-b['width']/2<=o['x']<=b['x']+b['width']/2
                      and max(0,min(b['x']+b['width']/2,o['x']+o['width']/2)-max(b['x']-b['width']/2,o['x']-o['width']/2))>=o['width']*.95
                      and -.10<=z-b['base']<=floor_height*.23),None)
        if balcony is not None:kind='balcony'
        elif z<=floor_height*.40:kind='entrance'
        else:kind='unresolved-upper'
        result.append({'opening_id':o['id'],'mass':o['mass'],'x':o['x'],'width':o['width']+.35,
                       'level':z,'kind':kind,'source':'threshold-support-design-prior','measured':False})
    return result


def entrance_boxes(plan,masses,structure):
    if plan['kind']!='entrance':return []
    m=next(m for m in masses if m['id']==plan['mass']);x=plan['x'];z=plan['level']
    recess=max([p['recess'] for p in structure.get('porches',[])
        if p['mass']==m['id'] and p['x0']<=x<=p['x1'] and p['bottom']<=z<=p['top']],default=0)
    back=m['front']+recess;landing_depth=.65+recess
    front=back-landing_depth
    result=[{'name':'Entrance_Landing','center':[x,back-landing_depth/2,z/2],
             'size':[plan['width'],landing_depth,z]}]
    # Tread blocks sit on the ground, reducing one riser on each outward step.
    count=max(1,math.ceil(z/.18));riser=z/count;tread=.28
    for i in range(1,count):
        h=z-i*riser
        result.append({'name':'Entrance_Step','center':[x,front-(i-.5)*tread,h/2],
                       'size':[plan['width'],tread,h]})
    return result
