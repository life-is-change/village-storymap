"""Validate graph components independently of legacy facade normalization."""
from .domain import number


def normalize_structure(raw,masses,width,height,depth):
    if not raw:return {'version':1,'layout':'unknown','porches':[],'columns':[]}
    result={'version':1,'layout':str(raw.get('layout','unknown'))[:60],
            'layout_source':str(raw.get('layout_source',''))[:100],'porches':[],'columns':[],
            'metric_depth_measured':False,'balcony_relations':[dict(r) for r in raw.get('balcony_relations',[])[:12]]}
    for kind in ['porches','columns']:
        values=raw.get(kind,[])
        if not isinstance(values,list) or len(values)>20:raise ValueError('结构构件数量无效')
        for value in values:
            mass=next((m for m in masses if m['id']==value.get('mass')),None)
            if mass is None:raise ValueError('结构构件所属体块无效')
            b=number(value.get('bottom',0),0,height-.1,'构件底高')
            item={'mass':mass['id'],'bottom':b,'source':str(value.get('source','design-prior'))[:120],
                  'confidence':number(value.get('confidence',0),0,1,'结构置信度'),'measured':False}
            if kind=='porches':
                a=number(value.get('x0'),mass['x0'],mass['x1'],'门廊左端');c=number(value.get('x1'),a+.1,mass['x1'],'门廊右端')
                item.update(x0=a,x1=c,top=number(value.get('top'),b+.1,height,'门廊顶高'),
                            recess=number(value.get('recess'),.15,min(2,depth-mass['front']-1.2),'门廊后退'))
            else:
                item.update(x=number(value.get('x'),mass['x0'],mass['x1'],'柱位'),
                            height=number(value.get('height'),.2,height-b,'柱高'),width=number(value.get('width',.25),.12,.8,'柱宽'),
                            depth=number(value.get('depth',.30),.12,.8,'柱深'))
            result[kind].append(item)
    return result
