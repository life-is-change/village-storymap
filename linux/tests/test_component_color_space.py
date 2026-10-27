import numpy as np
from rural_house_generator.backend.component_building.modeling.color_space import tint_linear_pixels


def test_photo_srgb_is_converted_to_linear_before_baking():
    pixels=np.ones((16,4),dtype=np.float32)*.5;pixels[:,3]=1
    result=tint_linear_pixels(pixels,[.5,.5,.5])
    np.testing.assert_allclose(result[:,:3],.21404114,rtol=1e-5)
    np.testing.assert_equal(result[:,3],1)
    assert np.all(pixels[:,:3]==.5)


def test_neutral_roof_tint_preserves_brightness_without_blue_or_yellow_patches():
    pixels=np.array([[.2,.5,.8,1],[.4,.5,.6,1]]*8,dtype=np.float32)
    result=tint_linear_pixels(pixels,[.6,.3,.15],neutralize=True)
    np.testing.assert_allclose(result[:,0]/result[:,1],result[0,0]/result[0,1])
    assert not np.allclose(result[0,:3],result[1,:3])
