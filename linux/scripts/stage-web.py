"""Stage browser assets only; never copy the repository wholesale to Nginx."""
from pathlib import Path
import shutil
import sys
import os
import re

EXTENSIONS = {'.html', '.js', '.css', '.json', '.geojson', '.png', '.jpg', '.jpeg',
              '.webp', '.svg', '.gif', '.glb', '.gltf', '.bin', '.b3dm', '.woff',
              '.woff2', '.ttf', '.ico', '.wasm', '.czml', '.mp4', '.webm'}
PUBLIC_CSV = {'houses.csv', 'roads.csv', 'water.csv', 'contours.csv', 'elevation_bands.csv'}

def public(name):
    p = Path(name)
    if any(part.startswith('.') or part in {'backend', 'tests', 'node_modules', 'runtime_storage', '__pycache__'}
           for part in p.parts) or '.test.' in p.name:
        return False
    if p.parts[:2] == ('3D_scenes_edit', 'legacy'):
        return False
    if p.suffix.lower() == '.pdf':
        return len(p.parts)==3 and p.parts[:2]==('assets','lessons') and re.fullmatch(r'lesson0[1-7]\.pdf',p.name) is not None
    if len(p.parts) == 1:
        return p.suffix in {'.html', '.js', '.css', '.ico'}
    if p.parts[0] == 'data' and p.suffix == '.csv':
        return len(p.parts) == 2 and p.name in PUBLIC_CSV
    if p.parts[:3] == ('assets', 'vendor', 'cesium-1.118.0') and p.name in {'tilemapresource.xml', 'LICENSE.md', 'README.md'}:
        return True
    allowed = p.parts[0] in {'assets', 'data', 'features', '3D_scenes_edit', 'rural_house_generator', 'village_game'} or p.parts[:2] == ('homepage', 'dist')
    return allowed and p.suffix.lower() in EXTENSIONS

def stage(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('Source and output must be separate directories')
    for directory, dirs, files in os.walk(source, followlinks=False):
        base=Path(directory);relative=base.relative_to(source)
        dirs[:]=[name for name in dirs if not name.startswith('.') and name not in {'backend','tests','node_modules','runtime_storage','__pycache__'} and not (base/name).is_symlink()]
        if base == source:
            dirs[:]=[name for name in dirs if name in {'assets','data','features','3D_scenes_edit','rural_house_generator','homepage','village_game'}]
        elif relative == Path('homepage'):
            dirs[:]=[name for name in dirs if name == 'dist']
        elif relative == Path('3D_scenes_edit'):
            dirs[:]=[name for name in dirs if name != 'legacy']
        for filename in files:
            file=base/filename
            if file.is_symlink() or not file.is_file():continue
            name = file.relative_to(source)
            if public(name):
                output = target / name
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, output)
    if not (target / 'index.html').is_file() or not (target / 'homepage/dist/index.html').is_file():
        raise ValueError('Root entry and built homepage/dist/index.html are required')

if __name__ == '__main__':
    stage(*sys.argv[1:])
