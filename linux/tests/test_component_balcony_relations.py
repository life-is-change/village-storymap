import numpy as np
import pytest
from rural_house_generator.backend.component_building.vision.balcony_relations import relate_balconies


def opening(bottom=3.55, height=2.5):
    return {'id':'door-candidate','mass':'m','x':1.,'width':2.,'bottom':bottom,'height':height,
            'kind':'window','shape':'rect','arch_rise':0.,'confidence':.8}


def run(op, rgb=None):
    return relate_balconies(rgb if rgb is not None else np.full((300,300,3),220,np.uint8),
        [.1,.1,.9,.9],10,10.2,3.4,[{'id':'m','x0':-5,'x1':5,'front':0}],
        [op],[{'x':1.,'width':3.,'base':3.4,'depth':.9,'rail_height':1.,'railing':{'style':'metal'}}],[])


def test_tall_opening_at_balcony_floor_becomes_glazed_access_preserving_top():
    op=opening();ops,porches,relations=run(op)
    assert ops[0]['subtype']=='glazed_door'
    assert ops[0]['kind']=='door'
    assert ops[0]['bottom']==pytest.approx(3.45)
    assert ops[0]['bottom']+ops[0]['height']==pytest.approx(op['bottom']+op['height'])
    assert relations[0]['depth_measured'] is False
    assert op['kind']=='window'
    assert not porches  # No recess invented from a railing alone.


def test_high_sill_or_short_window_is_not_forced_to_be_a_door():
    ops,_,_=run(opening(4.4,1.4))
    assert ops[0]['kind']=='window'
    assert ops[0].get('subtype') is None
    ops,_,_=run(opening(4.4,2.2))
    assert ops[0]['kind']=='window'


def test_arched_opening_keeps_its_shape_and_is_not_a_generic_glass_door():
    value=opening();value.update(shape='arched',arch_rise=.3)
    ops,_,_=run(value)
    assert ops[0]['shape']=='arched' and ops[0]['kind']=='window'


def test_an_already_detected_opaque_door_does_not_become_glass_by_location_alone():
    value=opening();value['kind']='door'
    ops,_,relations=run(value)
    assert ops[0].get('subtype') is None
    assert ops[0]['bottom']==value['bottom']
    assert relations[0]['access_kind']=='door'


def test_shaded_side_returns_support_shallow_recess_but_depth_remains_a_prior():
    rgb=np.full((300,300,3),220,np.uint8)
    # Balcony occupies x [.46,.70], upper-floor side returns flank the opening.
    rgb[110:190,138:149]=100;rgb[110:190,198:210]=100
    _,porches,relations=run(opening(),rgb)
    assert len(porches)==1
    assert porches[0]['recess']==pytest.approx(1.0)
    assert porches[0]['measured'] is False
    assert relations[0]['placement']=='recessed-prior'
    assert relations[0]['clear_depth']==1.5
    assert relations[0]['depth_version']==1


def test_upper_balcony_does_not_deepen_ground_floor_colonnade():
    porch={'mass':'m','x0':-5,'x1':5,'bottom':0,'top':10.2,'recess':.9,'source':'structure-prior'}
    _,zones,relations=relate_balconies(np.full((300,300,3),220,np.uint8),[.1,.1,.9,.9],10,10.2,3.4,
        [{'id':'m','x0':-5,'x1':5,'front':0}],[opening()],
        [{'x':1.,'width':3.,'base':3.4,'depth':.9,'rail_height':1.}], [porch])
    assert zones[0]==porch
    assert zones[1]['bottom']==3.4 and zones[1]['top']==6.8
    assert zones[1]['x0']==-.5 and zones[1]['x1']==2.5
    assert zones[1]['recess']==1.
    assert relations[0]['clear_depth']==1.5


def test_deep_existing_porch_is_not_flattened_to_standard_balcony():
    porch={'mass':'m','x0':-5,'x1':5,'bottom':0,'top':10.2,'recess':1.8}
    _,zones,relations=relate_balconies(np.full((300,300,3),220,np.uint8),[.1,.1,.9,.9],10,10.2,3.4,
        [{'id':'m','x0':-5,'x1':5,'front':0}],[opening()],
        [{'x':1.,'width':3.,'base':3.4,'depth':.9,'rail_height':1.}], [porch])
    assert zones==[porch]
    assert 'clear_depth' not in relations[0]
