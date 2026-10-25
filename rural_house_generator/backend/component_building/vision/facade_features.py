"""Image evidence kept separate from metric design assumptions. No per-house coordinates."""
import cv2
import numpy as np


def patch(rgb,box):
    h,w=rgb.shape[:2];a,b,c,e=box
    return rgb[max(0,int(b*h)):min(h,max(int(e*h),int(b*h)+1)),
               max(0,int(a*w)):min(w,max(int(c*w),int(a*w)+1))]


def image_arch(rgb,d):
    """Compare an elliptical upper boundary against a straight/sloped lintel.

    SAM may select just the dark central panes and underestimate the shoulders.
    This second measurement uses connected dark frame/glass pixels in the photo.
    """
    roi=patch(rgb,d['box']);h,w=roi.shape[:2];best={'rise':0.,'confidence':0.,'source':'image-boundary'}
    if min(h,w)<10:return best
    gray=cv2.cvtColor(roi,cv2.COLOR_RGB2GRAY)
    for threshold in (60,85,110,135):
        mask=(gray<threshold).astype('uint8')
        n,labels,stats,_=cv2.connectedComponentsWithStats(mask)
        if n<2:continue
        k=max(range(1,n),key=lambda k:stats[k,cv2.CC_STAT_AREA])
        if stats[k,cv2.CC_STAT_AREA]<w*h*.22:continue
        xy=[]
        for x in range(w):
            ys=np.where(labels[:,x]==k)[0]
            if len(ys) and ys[0]<h*.32:xy.append((x,float(ys[0])))
        if len(xy)<w*.7:continue
        p=np.asarray(xy);lo,hi=p[:,0].min(),p[:,0].max()
        if hi-lo<w*.7:continue
        u=(p[:,0]-(lo+hi)/2)/((hi-lo)/2)
        keep=np.abs(u)<.96;u=u[keep];y=p[keep,1]
        ellipse=np.sqrt(np.maximum(0,1-u*u))
        A=np.column_stack([np.ones(len(u)),u,-ellipse])
        intercept,tilt,rise=np.linalg.lstsq(A,y,rcond=None)[0]
        line=np.column_stack([np.ones(len(u)),u]);flat=line@np.linalg.lstsq(line,y,rcond=None)[0]
        err=np.sqrt(np.mean((A@[intercept,tilt,rise]-y)**2));flat_err=np.sqrt(np.mean((flat-y)**2))
        if not max(1.4,w*.035)<rise<min(w*.55,h*.4):continue
        if err>max(.9,rise*.18) or err>flat_err*.72 or abs(tilt)>rise*.65:continue
        confidence=float(np.clip(1-err/max(flat_err,.1),0,1))
        if confidence>best['confidence']:
            best={'rise':float(rise)/rgb.shape[0],'confidence':confidence,'source':'image-boundary'}
    return best


def overlap(a,b):
    x=max(0,min(a[2],b[2])-max(a[0],b[0]));y=max(0,min(a[3],b[3])-max(a[1],b[1]))
    return x*y/max(1e-8,min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1])))


def railing_evidence(rgb,box,detections,visible_balconies):
    candidates=[d for d in detections if d['kind']=='railing' and d.get('style') in ('stone','metal')]
    local=[d for d in candidates if overlap(d['box'],box)>.45]
    # Exclude ground fences from the building-style fallback.
    shared=[d for d in candidates if any(overlap(d['box'],b)>.45 for b in visible_balconies)]
    matches=local or shared
    if matches:
        d=max(matches,key=lambda d:d.get('score',0));style=d['style'];confidence=d.get('score',0)*(1 if local else .6)
        source='detected-railing' if local else 'other-visible-balcony'
    else:style='unknown';confidence=0.;source='no-style-evidence'
    hsv=cv2.cvtColor(patch(rgb,box),cv2.COLOR_RGB2HSV)
    gold=float(((hsv[:,:,0]>12)&(hsv[:,:,0]<40)&(hsv[:,:,1]>40)&(hsv[:,:,2]>85)).mean())
    return {'style':style,'confidence':round(confidence,4),'source':source,
            'ornament':'medallion' if style=='metal' and gold>.008 else 'none'}


def appearance_evidence(rgb,crop,detections,roof_box):
    h,w=rgb.shape[:2];mask=np.zeros((h,w),bool);a,b,c,e=crop
    mask[int((b+.02)*h):int((e-.02)*h),int((a+.02)*w):int((c-.02)*w)]=True
    for d in detections:
        if d['kind'] not in ('window','door','balcony','air_conditioner','railing'):continue
        x,y,z,t=d['box'];mask[max(0,int(y*h)-2):min(h,int(t*h)+2),max(0,int(x*w)-2):min(w,int(z*w)+2)]=False
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    # Coloured paint is valid evidence too. Remove dark holes/glare, then use
    # the dominant coarse colour cluster rather than preferring low saturation.
    values=rgb[mask&(hsv[:,:,2]>65)&(hsv[:,:,2]<250)]
    if len(values)>15:
        bins=(values//32).astype(int);keys=bins[:,0]*64+bins[:,1]*8+bins[:,2]
        dominant=np.bincount(keys,minlength=512).argmax();values=values[keys==dominant]
        wall=np.median(values,axis=0)/255
    else:wall=np.array([.84,.83,.80])
    r=patch(rgb,roof_box) if roof_box else np.empty((0,0,3),dtype='uint8')
    pixels=r.reshape(-1,3);pixels=pixels[(pixels.max(axis=1)<240)&(pixels.min(axis=1)>35)]
    red=pixels[(pixels[:,0]>pixels[:,1]*1.15)&(pixels[:,0]>pixels[:,2]*1.15)]
    if len(red)>max(15,len(pixels)*.12):pixels=red
    roof=np.median(pixels,axis=0)/255 if len(pixels)>15 else np.array([.58,.30,.20])
    bottom=rgb[max(0,int((e-.055)*h)):min(h,int(e*h)),max(0,int(a*w)):min(w,int(c*w))]
    zones={}
    if bottom.size:
        pixels_bottom=bottom.reshape(-1,3);dark=pixels_bottom[(pixels_bottom.mean(axis=1)>20)&(pixels_bottom.mean(axis=1)<130)]
        if len(dark)>20:zones['socle_srgb']=[round(float(v)/255,4) for v in np.median(dark,axis=0)]
    return {'wall_srgb':[round(float(v),4) for v in wall],
            'roof_srgb':[round(float(v),4) for v in roof],
            'source':'visible-unoccluded-color-sampling','zones':zones,'measured_albedo':False}


def depth_evidence(analysis,crop,detections):
    result={'status':'unavailable','source':analysis.get('relative_depth',{}).get('source','none'),
            'applied':False,'measured':False,'relation':'unknown'}
    grid=analysis.get('relative_depth',{}).get('grid')
    if grid is None:return result
    z=np.asarray(grid,float)
    if z.ndim!=2 or min(z.shape)<10 or not np.isfinite(z).all():return result
    h,w=z.shape;mask=np.ones_like(z,dtype=bool)
    for d in detections:
        if d['kind'] not in ('window','door','balcony','air_conditioner'):continue
        a,b,c,e=d['box'];mask[max(0,int(b*h)-1):min(h,int(e*h)+1),max(0,int(a*w)-1):min(w,int(c*w)+1)]=False
    a,b,c,e=crop;differences=[];scatter=[]
    for floor in range(3):
        ys=slice(int((b+(e-b)*(floor/3+.045))*h),int((b+(e-b)*((floor+1)/3-.045))*h));groups=[]
        for lo,hi in ((.06,.36),(.46,.94)):
            xs=slice(int((a+(c-a)*lo)*w),int((a+(c-a)*hi)*w));v=z[ys,xs][mask[ys,xs]]
            if len(v)<8:break
            groups.append((np.median(v),np.percentile(v,75)-np.percentile(v,25)))
        if len(groups)==2:differences.append(float(groups[1][0]-groups[0][0]));scatter.append(float(max(groups[0][1],groups[1][1],.015)))
    scale=max(float(np.percentile(z,95)-np.percentile(z,5)),.1)
    strong=len(differences)==3 and (all(d>.04*scale for d in differences) or all(d<-.04*scale for d in differences)) and all(abs(d)>s*1.2 for d,s in zip(differences,scatter))
    result.update(status='candidate' if strong else 'uncertain',band_differences=[round(d/scale,4) for d in differences],
                  relation=('left_farther' if np.median(differences)>0 else 'right_farther') if strong else 'unknown',
                  reason='相对深度候选没有米制标定，未改写体块。' if strong else '各楼层深度差异不足或不一致，不能可靠确认整片墙体退进。')
    return result
