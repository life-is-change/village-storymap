"""Stage browser assets only; never copy the repository wholesale to Nginx."""
from pathlib import Path
import shutil
import sys

EXTENSIONS = {'.html', '.js', '.css', '.json', '.geojson', '.png', '.jpg', '.jpeg',
              '.webp', '.svg', '.gif', '.glb', '.gltf', '.bin', '.b3dm', '.woff',
              '.woff2', '.ttf', '.ico', '.wasm', '.czml', '.mp4', '.webm'}
PUBLIC_CSV = {'houses.csv', 'roads.csv', 'water.csv', 'contours.csv', 'elevation_bands.csv'}

def public(name):
    p = Path(name)
    if any(part.startswith('.') or part in {'backend', 'tests', 'node_modules', 'runtime_storage', '__pycache__'}
           for part in p.parts) or '.test.' in p.name:
        return False
    if len(p.parts) == 1:
        return p.suffix in {'.html', '.js', '.css', '.ico'}
    if p.parts[0] == 'data' and p.suffix == '.csv':
        return len(p.parts) == 2 and p.name in PUBLIC_CSV
    if p.parts[:3] == ('assets', 'vendor', 'cesium-1.118.0') and p.name in {'tilemapresource.xml', 'LICENSE.md', 'README.md'}:
        return True
    allowed = p.parts[0] in {'assets', 'data', 'features', '3D_scenes_edit', 'rural_house_generator'} or p.parts[:2] == ('homepage', 'dist')
    return allowed and p.suffix.lower() in EXTENSIONS

def stage(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('Source and output must be separate directories')
    for file in source.rglob('*'):
        if file.is_symlink() or not file.is_file():
            continue
        name = file.relative_to(source)
        if public(name):
            output = target / name
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, output)
    if not (target / 'index.html').is_file() or not (target / 'homepage/dist/index.html').is_file():
        raise ValueError('Root entry and built homepage/dist/index.html are required')

if __name__ == '__main__':
    stage(*sys.argv[1:])
