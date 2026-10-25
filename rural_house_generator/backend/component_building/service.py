"""Runs only in the workstation Worker, with its configured Blender executable."""
import json
import os
from pathlib import Path
import subprocess
import time
import logging

from .adapter import build_spec
from .assets import optimize_web_glb


def generate_components(image_path, job_dir, options, blender, *, check_canceled=lambda: None):
    from ..app.facade.model_client import LocalModelClient
    from ..app.facade.job_processor import GenerationArtifacts
    folder = Path(job_dir) / 'artifacts'
    folder.mkdir(parents=True, exist_ok=True)
    analysis = LocalModelClient().analyze_components(image_path, folder / 'components')
    check_canceled()
    try:
        plan = build_spec(image_path, analysis, options)
    except ValueError as error:
        logging.getLogger(__name__).warning('Component plan rejected: %s', error)
        text = str(error)
        code = 'COMPONENT_FOOTPRINT_UNSUPPORTED' if '占地' in text else 'COMPONENT_SCALE_INVALID' if '层高' in text else 'COMPONENT_DETECTION_FAILED'
        raise ValueError(code) from error
    spec = plan['spec']
    output = (folder / 'building.glb').resolve()
    config = folder / 'component_job.json'
    config.write_text(json.dumps({'spec': spec, 'output': str(output), 'web_compression': True,
                                  'render': False, 'presentation': False}, ensure_ascii=False), encoding='utf8')
    script = Path(__file__).parent / 'modeling/generate_facade.py'
    env = dict(os.environ, RURAL_COMPONENT_CACHE=str(folder / 'material-cache'))
    started = time.monotonic()
    with (folder / 'component-blender.log').open('wb') as log:
        child = subprocess.Popen([str(blender.executable), '--background', '--factory-startup', '--python-exit-code', '1',
                                  '--python', str(script.resolve()), '--', str(config.resolve())],
                                  stdout=log, stderr=subprocess.STDOUT, cwd=job_dir, env=env,
                                  creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            while child.poll() is None:
                check_canceled()
                if time.monotonic()-started > max(blender.timeout_seconds, 240):
                    raise RuntimeError('COMPONENT_BLENDER_TIMEOUT')
                time.sleep(.2)
            if child.returncode:
                raise RuntimeError('COMPONENT_BLENDER_FAILED')
        finally:
            if child.poll() is None:
                child.kill(); child.wait()
    if not output.is_file() or output.read_bytes()[:4] != b'glTF':
        raise ValueError('GENERATED_GLB_INVALID')
    metrics = json.loads((folder / 'manifest.json').read_text('utf8'))
    if metrics.get('opening_center_wall_hits') or metrics.get('roof_nonmanifold_edges'):
        raise ValueError('COMPONENT_GEOMETRY_INVALID')
    metrics['web_optimization'] = optimize_web_glb(output)
    metrics['bytes'] = output.stat().st_size
    building = {'width': spec['facade']['width'], 'depth': spec['facade']['depth'],
                'wall_height': spec['metrics']['wall_height'], 'roof_height': spec['roof']['rise']}
    manifest = folder / 'model_manifest.json'
    manifest.write_text(json.dumps({'building': building, 'platform': spec['platform'], 'metrics': metrics,
                                   'warnings': plan['warnings'], 'spec': spec,
                                   'elapsed_seconds': round(time.monotonic()-started, 2)}, ensure_ascii=False), encoding='utf8')
    return GenerationArtifacts(Path(image_path), output, manifest, building)
