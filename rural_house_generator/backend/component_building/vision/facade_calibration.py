"""Associate detections with one building before estimating an elevation frame.

This is a 2D design calibration, not camera recovery or metric reconstruction.
Roof boxes often contain white gables and neighbour roofs; their union is not a
wall-top measurement. Keep the evidence and flag those cases for prototype fit.
"""
import cv2
import numpy as np


def area(b):
    return max(0,b[2]-b[0])*max(0,b[3]-b[1])


def intersection(a,b):
    return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))


def calibrate(analysis, detections, manual_crop=None):
    box=list(analysis.get('building_box',[0,0,1,1]));bw=box[2]-box[0];bh=box[3]-box[1]
    buildings=[d for d in detections if d['kind']=='building']
    primary=max(buildings,key=lambda d:intersection(d['box'],box)/max(area(d['box'])+area(box)-intersection(d['box'],box),1e-6),default={})
    contour=np.asarray(primary.get('mask_contour',[]),dtype=np.float32)
    has_mask=(manual_crop is None and contour.ndim==2 and contour.shape[1:]==(2,) and len(contour)>=4
              and np.isfinite(contour).all() and abs(cv2.contourArea(contour))>area(box)*.25)
    def belongs(d):
        a,b,c,e=d['box']
        region=manual_crop if manual_crop is not None else box
        if intersection(d['box'],region)/max(area(d['box']),1e-6)<.55:return False
        if not has_mask:return True
        inside=sum(cv2.pointPolygonTest(contour,(float(a+(c-a)*x),float(b+(e-b)*y)),False)>=0
                   for x in (.2,.5,.8) for y in (.2,.5,.8))
        return inside>=5
    outside=0;filtered=[]
    for d in detections:
        if d['kind'] in ('window','door','air_conditioner','column') and not belongs(d):
            outside+=1;continue
        filtered.append(d)
    all_roofs=[d for d in detections if d['kind']=='roof']
    associated=[d for d in all_roofs if d['box'][2]-d['box'][0]>=bw*.22
                and box[0]-.04<=(d['box'][0]+d['box'][2])/2<=box[2]+.04
                and d['box'][1]<box[1]+bh*.62
                and max(0,min(box[2],d['box'][2])-max(box[0],d['box'][0]))/(d['box'][2]-d['box'][0])>.65]
    # Main roof is a roof candidate with its peak near the top of the building.
    # Lower porch roofs are retained as evidence, but never set the whole wall top.
    top=[d for d in associated if d['box'][1]<=box[1]+bh*.20]
    main=max(top,key=lambda d:d.get('score',0)*(d['box'][2]-d['box'][0]),default=None)
    roofs=sorted(top,key=lambda d:d.get('score',0)*(d['box'][2]-d['box'][0]),reverse=True)
    crop=list(manual_crop or box);preserved=False
    if manual_crop is None and main:
        crop[1]=main['box'][3]
        upper=[d['box'][1] for d in filtered if d['kind'] in ('window','door')
               and d.get('score',0)>=.27 and d['box'][3]>box[1]+bh*.15]
        if upper and min(upper)<crop[1]-.008:
            crop[1]=max(box[1],min(upper)-bh*.025);preserved=True
    notes=[]
    if preserved:notes.append('屋顶框覆盖上层门窗，已保留门窗；山墙/交错屋顶须原型拟合，当前等高体块不能准确还原。')
    lower=[d for d in associated if main and d['box'][1]>main['box'][1]+bh*.24]
    if lower:notes.append('检测到不同高度的屋顶候选；当前主屋顶参数没有表达全部低层屋顶。')
    if outside:notes.append(f'主体分割/范围排除了 {outside} 个外部构件候选；不把邻房构件作为本栋门窗。')
    record={'version':1,'source':'user-crop' if manual_crop is not None else 'associated-roof-and-opening-envelope',
            'building_box':box,'crop':crop,'main_mask_used':bool(has_mask),
            'excluded_roofs':len(all_roofs)-len(associated),'outside_main_mask':outside,
            'upper_openings_preserved':preserved,'lower_roof_candidates':len(lower),
            'requires_prototype_fit':bool(preserved or lower),'metric_measured':False,'notes':notes}
    return crop,filtered,roofs,record
