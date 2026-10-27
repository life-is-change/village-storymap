#!/usr/bin/env python3
"""Complete the pinned quality rollout for an already running candidate only.

Corrects order-only environment comparison on private copies. The original
operator, checkpoint identity, image, containers and Compose files stay intact.
"""
import copy
import hashlib
import importlib.util
from pathlib import Path
import re
import sys

BASE=Path('/media/gpu332/newapply/village-platform/deploy/components')
ORIGINAL_SHA='51294854b024360ec6f3a2543906a13792d17c2c343f70b77e998bab00e53677'


def canonical_environment(values):
    keys=set()
    for value in values:
        if not isinstance(value,str) or '=' not in value:
            raise ValueError('INVALID_WORKER_ENVIRONMENT')
        key=value.split('=',1)[0]
        if not key or key in keys:raise ValueError('DUPLICATE_OR_EMPTY_ENVIRONMENT_KEY')
        keys.add(key)
    return sorted(values)


def install_completion_guard(module):
    original=module.validate_live
    def validate(api,parent,rows,progress):
        if not progress or progress.get('phase') not in ('replacing','complete'):
            raise ValueError('RUNNING_QUALITY_CHECKPOINT_REQUIRED')
        row=rows[module.WORKER];state=row['State']
        if (not progress.get('new_container_id') or row['Id']!=progress['new_container_id']
                or row['Image']!=progress['image'] or row['Image']==module.BASE_IMAGE
                or not state.get('Running') or state.get('Restarting') or state.get('Pid',0)<=0):
            raise ValueError('EXISTING_RUNNING_QUALITY_CANDIDATE_REQUIRED')
        private_rows=copy.deepcopy(rows);private_progress=copy.deepcopy(progress)
        for candidate in (private_rows[module.WORKER],private_progress['worker_before']):
            candidate['Config']['Env']=canonical_environment(candidate['Config']['Env'])
        original(api,parent,private_rows,private_progress)
    module.validate_live=validate


def main():
    path=BASE/'operators/component-quality-worker-20261027.py'
    try:
        if any(p.is_symlink() for p in (path,*path.parents)):
            raise ValueError('PINNED_OPERATOR_PATH_REQUIRED')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=ORIGINAL_SHA:
            raise ValueError('PINNED_ORIGINAL_QUALITY_OPERATOR_REQUIRED')
        spec=importlib.util.spec_from_file_location('pinned_quality_completion',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        install_completion_guard(module)
        sys.argv[0]=str(path)
        return module.main()
    except (OSError,ValueError) as error:
        code=str(error) if re.fullmatch('[A-Z_]{1,100}',str(error)) else type(error).__name__
        print('STOP: COMPONENT_QUALITY_COMPLETION '+code+
              '. Preserve checkpoints and private logs.')
        return 1


if __name__=='__main__':raise SystemExit(main())
