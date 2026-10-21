#!/usr/bin/env python3
"""One operator flow: verified images, IP TLS, candidate, hidden login probe and gated switch."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import business_storage_copy as storage
from autonomous_bundle import load_script
from autonomous_operator import clean_environment


def steps(root,meta):
    root=Path(root);scripts=Path(__file__).parent
    common=['--image-archive',str(root/'images'/meta['archive_filename']),'--backup-dir',str(root/'backup'),'--storage-dir',str(root/'storage')]
    return [
        [scripts/'prepare-ip-tls.py','--check'],[scripts/'prepare-ip-tls.py','--staging'],[scripts/'prepare-ip-tls.py','--issue'],
        [scripts/'deploy-autonomous.py','--check',*common],[scripts/'deploy-autonomous.py','--deploy',*common],
        [scripts/'deploy-autonomous.py','--verify'],[scripts/'probe-autonomous.py'],[scripts/'deploy-autonomous.py','--apply']]


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--received',required=True,type=Path);a=p.parse_args()
    try:
        if sys.platform!='linux' or os.geteuid()==0:raise ValueError('LINUX_NON_ROOT_OPERATOR_REQUIRED')
        os.umask(0o077);root=storage.private_path(a.received,directory=True)
        meta=storage.read_private_json(root/'release/autonomous-release.json')
        current=json.loads((Path(__file__).resolve().parents[1]/'autonomous-release.json').read_text())
        if meta!=current:raise ValueError('HANDOFF_RELEASE_DIFFERS_FROM_CHECKED_OUT_METADATA')
        state=Path.home()/'village-autonomous'
        if (state/'public-switch.json').exists():raise ValueError('PUBLIC_SWITCH_ALREADY_ATTEMPTED_REQUIRES_EXPLICIT_RECOVERY')
        load_script('prepare-autonomous-handoff').load_images(root)
        for index,command in enumerate(steps(root,meta)):
            print('AUTONOMOUS_INSTALL_STEP '+str(index+1)+'/8',flush=True)
            # Preserve the real terminal for getpass. No shell, password argv,
            # piped echo fallback, automatic reset or repeated paid operations.
            result=subprocess.run([sys.executable,*map(str,command)],env=clean_environment())
            if result.returncode:return result.returncode
        print('AUTONOMOUS_PUBLIC_CORE_INSTALLED_BROWSER_AND_REAL_GPU_ACCEPTANCE_PENDING');return 0
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        print('STOP: AUTONOMOUS_INSTALL_FAILED. Retain private handoff/state/logs; do not run legacy cutover or reset data.');return 1


if __name__=='__main__':raise SystemExit(main())
