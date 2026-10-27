from PIL import Image
import pytest
from rural_house_generator.backend.component_building import adapter


def test_near_rectangle_keeps_source_dimensions_and_discloses_approximation(tmp_path,monkeypatch):
    image=tmp_path/'front.png';Image.new('RGB',(100,90),'white').save(image)
    monkeypatch.setattr(adapter,'calibrate',lambda *_:([.1,.1,.9,.9],[],[],{}))
    monkeypatch.setattr(adapter,'facade_draft',lambda b,a,i,p,photo:{'spec':{'facade':{'width':p['width'],'depth':p['depth']},'assumptions':[]},'warnings':[]})
    options={'generationMethod':'components','modelPurpose':'existing','buildingWidth':10,'buildingDepth':8,
             'sourceBuildingWidth':10,'sourceBuildingDepth':8,'footprintRectangularity':.9692395268270527,'floors':3}
    result=adapter.build_spec(image,{'detections':[]},options)
    assert result['spec']['platform']['footprint_approximation'] is True
    assert result['spec']['facade']=={'width':10,'depth':8}
    assert any('近似' in line for line in result['warnings'])


@pytest.mark.parametrize('ratio',[0,.7,.89])
def test_major_concavity_or_courtyard_is_not_filled_by_rectangle(tmp_path,ratio):
    with pytest.raises(ValueError,match='占地'):
        adapter.build_spec(tmp_path/'unused.png',{},dict(generationMethod='components',modelPurpose='existing',
            buildingWidth=10,buildingDepth=8,footprintRectangularity=ratio))
