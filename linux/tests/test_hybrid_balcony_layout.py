import pytest
from rural_house_generator.backend.component_building.modeling.balcony_layout import balcony_layout


@pytest.mark.parametrize('style,half',[('metal',.026),('stone',.085),('solid',.10)])
def test_hybrid_balcony_glass_to_inside_rail_is_150cm(style,half):
    result=balcony_layout(0,1,.9,style,1.5)
    assert result['glass_face']-(result['rail_front']+half)==pytest.approx(1.5)
    assert result['recess']==1
    assert .5<result['projection']<.65
    assert result['slab_back']>=1
    assert result['slab_front']<result['rail_front']
    assert result['side_end']>.8


def test_local_coordinate_offset_does_not_change_depth():
    a=balcony_layout(0,1,.9,'metal',1.5)
    b=balcony_layout(2.7,3.7,.9,'metal',1.5)
    for key in ('rail_front','glass_face','slab_back','slab_front','side_end'):
        assert b[key]-a[key]==pytest.approx(2.7)
    assert a['clear_depth']==pytest.approx(b['clear_depth'])


def test_old_json_keeps_previous_projecting_and_recessed_positions():
    a=balcony_layout(0,0,.9,'metal',None)
    assert a['rail_front']==pytest.approx(-1.05)
    b=balcony_layout(0,.65,.9,'metal',None)
    assert b['rail_front']==pytest.approx(-.08)


def test_target_requires_a_recess_and_is_finite():
    for wall,target in [(0,1.5),(1,float('nan')),(1,-1)]:
        with pytest.raises(ValueError):balcony_layout(0,wall,.9,'metal',target)
