#!/usr/bin/env python3
"""Export private object metadata from the accepted local candidate, read-only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
from business_storage_copy import export_inventory

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-dir',type=Path,default=Path.home()/'village-storage-copy/stage-b1')
    args=p.parse_args();os.umask(0o077)
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('Run as the normal server admin user.')
        s=importlib.util.spec_from_file_location('storage_deploy',Path(__file__).with_name('deploy-business-api-validation.py'))
        deploy=importlib.util.module_from_spec(s);s.loader.exec_module(deploy)
        state=Path.home()/'village-api-validation';docker=deploy.rd.LocalDocker(state,target=deploy.TARGET)
        print(json.dumps(export_inventory(docker,state,args.run_dir,deploy)))
        print('STORAGE_INVENTORY_EXPORTED_NOT_COPIED')
        return 0
    except (ValueError,RuntimeError,OSError,KeyError,TypeError):
        print('STOP: inventory export failed; retain candidate and private state. No files copied or source changes.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
