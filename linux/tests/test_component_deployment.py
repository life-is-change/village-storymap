import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def test_component_overlay_imports_new_backend_instead_of_inherited_app(tmp_path):
    for name in ('component-worker', 'component-ml'):
        text = (ROOT/'linux'/('Dockerfile.'+name)).read_text()
        assert 'WORKDIR /opt/village-components' in text
    # Actual Python namespace/regular package precedence of the inherited image.
    for label in ('old', 'new'):
        root = tmp_path/label/'rural_house_generator/backend'; root.mkdir(parents=True)
        (root/'__init__.py').write_text('')
        (root/'ml_worker.py').write_text(f'VERSION="{label}"')
    env = dict(os.environ, PYTHONPATH=str(tmp_path/'new'))
    code='from rural_house_generator.backend.ml_worker import VERSION;print(VERSION)'
    assert subprocess.check_output([sys.executable, '-c', code], cwd=tmp_path/'old', env=env, text=True).strip() == 'old'
    assert subprocess.check_output([sys.executable, '-c', code], cwd=tmp_path/'new', env=env, text=True).strip() == 'new'


def test_existing_database_patch_matches_the_installed_function_sources():
    migration=(ROOT/'linux/sql/component-building.sql').read_text()
    for file,names in [('unified/tasks.sql',['task_public','task_artifact_manage','task_finish']),
                       ('local-tasks.sql',['local_gpu_sync','local_gpu_public','local_worker_call','local_task_control']),
                       ('local-task-files.sql',['local_worker_file'])]:
        source=(ROOT/'linux/sql'/file).read_text()
        for name in names:
            definition=re.search(r'CREATE FUNCTION api_private\.'+name+r'\([^\n]*[\s\S]*?\$\$;',source).group()
            assert definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1) in migration
    assert 'DROP TABLE' not in migration
