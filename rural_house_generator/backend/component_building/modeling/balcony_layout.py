"""Metric balcony coordinates; positive Y goes into the house.

New hybrid depth is measured from outer glass to inner front railing surface.
Legacy JSON deliberately keeps the original center-line placement.
"""
import math


def balcony_layout(mass_front,wall,depth,style,clear_depth=None,wall_thickness=.23):
    glass=wall-.045/2  # glazed_door's .045m rect_skin outer face
    half={'metal':.026,'stone':.085,'solid':.10}[style]
    if clear_depth is None:
        rear=wall-.15
        front=mass_front-.08 if rear>mass_front+.1 else rear-depth
        slab_front,slab_back=front-.075,rear+.075
        side_end=rear
    else:
        if not math.isfinite(clear_depth) or not .6<=clear_depth<=2.5 or wall<=mass_front+.1:
            raise ValueError('HYBRID_BALCONY_DEPTH_INVALID')
        front=glass-clear_depth-half
        side_end=wall-wall_thickness/2-.01
        slab_front,slab_back=front-half-.05,wall+.05
    return {'rail_front':front,'side_end':side_end,'slab_front':slab_front,'slab_back':slab_back,
            'glass_face':glass,'clear_depth':glass-front-half,
            'recess':wall-mass_front,'projection':max(0,mass_front-front-half),
            'depth_measured':False,'depth_version':1 if clear_depth is not None else 0}
