"""Platform dimensions and proportional height around the proven local compiler."""
import math
from PIL import Image

from .app.domain import number
from .vision.facade import facade_draft, valid_box
from .vision.facade_calibration import calibrate


def validate_options(value):
    method = value.get('generationMethod', 'texture')
    purpose = value.get('modelPurpose', 'existing')
    if method not in ('texture', 'components') or purpose not in ('existing', 'design'):
        raise ValueError('构件生成方式或用途无效')
    return {'generation_method': method, 'model_purpose': purpose,
            'floors': number(value.get('floors', 3), 1, 6, '层数', True),
            'roof_count': number(value['roofCount'], 1, 2, '屋顶数量', True) if value.get('roofCount') else None}


def build_spec(image_path, analysis, options):
    settings = validate_options(options)
    width = number(options.get('buildingWidth'), 3, 40, '建筑正面长度')
    depth = number(options.get('buildingDepth'), 2, 30, '建筑进深')
    if settings['model_purpose'] == 'existing':
        for key, current in [('sourceBuildingWidth', width), ('sourceBuildingDepth', depth)]:
            if options.get(key) is not None and abs(float(options[key])-current) > .001:
                raise ValueError('现状还原不能修改原白模占地尺寸。')
    if settings['model_purpose'] == 'existing' and number(options.get('footprintRectangularity', 1), 0, 1, '占地矩形程度') < .98:
        raise ValueError('当前构件生成器不能精确保持此不规则占地，请保留贴图方式或使用改建设计。')
    ds = [d for d in analysis.get('detections', []) if valid_box(d.get('box'))]
    crop, _, _, _ = calibrate(analysis, ds)
    with Image.open(image_path) as image:
        wall_height = width * (crop[3]-crop[1]) * image.height / ((crop[2]-crop[0]) * image.width)
    floors = settings['floors']
    if not 2.4 <= wall_height/floors <= 5:
        raise ValueError('按立面比例推算的层高不合理，请核对建筑正面长度、层数和主体识别范围。')
    # Centered source footprint. Orientation is preserved by the platform's existing binding.
    building = {'id': 'platform-building', 'geometry_revision': 1, 'origin': [0, 0],
                'local_rings': [[[-width/2, -depth/2], [width/2, -depth/2],
                                 [width/2, depth/2], [-width/2, depth/2], [-width/2, -depth/2]]]}
    params = {'floors': floors, 'floor_height': wall_height/floors, 'width': width, 'depth': depth,
              'front_edge': 0, 'front_offset': 0, 'render_profile': 'rural-realistic'}
    if settings['roof_count']:
        params['roof_count'] = settings['roof_count']
    result = facade_draft(building, analysis, image_path, params, options.get('photoId'))
    spec = result['spec']
    spec['platform'] = {**settings, 'height_source': 'rectified-wall-aspect', 'white_model_height_used': False,
                        'subject_width': width, 'subject_depth': depth, 'orientation': 'platform-binding'}
    spec['assumptions'] = [s for s in spec['assumptions'] if '不强制匹配' not in s or settings['model_purpose'] == 'design']
    spec['assumptions'].append('墙身高度由正面长度及立面比例估算；侧背面和构件进深为规则补全。')
    spec['warnings'] = result['warnings'] = spec['assumptions']
    return result
