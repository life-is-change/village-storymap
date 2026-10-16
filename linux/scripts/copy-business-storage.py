#!/usr/bin/env python3
"""Copy selected private files; never change live URLs, source files or GPU channels."""
import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import warnings
from business_storage_copy import copy_inventory,verify_copy,private_path,SourceFailure

def require_server():
    if sys.platform!='linux' or os.geteuid()==0:
        raise RuntimeError('STORAGE_SERVER_LINUX_REQUIRED')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-dir',type=Path,default=Path.home()/'village-storage-copy/stage-b1')
    mode=p.add_mutually_exclusive_group();mode.add_argument('--resume',action='store_true');mode.add_argument('--verify-only',action='store_true')
    p.add_argument('--key-file',type=Path,help='Optional existing private server-key file; default is hidden terminal input.')
    a=p.parse_args();os.umask(0o077)
    try:
        require_server()
        if a.verify_only:report=verify_copy(a.run_dir)
        else:
            root=private_path(a.run_dir,directory=True)
            if (root/'copy-manifest.json').exists() and not a.resume:
                print('STOP: existing transfer retained; use --resume or --verify-only.',file=sys.stderr);return 1
            if a.key_file:key=private_path(a.key_file).read_text(encoding='utf-8').strip()
            else:
                with warnings.catch_warnings():
                    warnings.simplefilter('error',getpass.GetPassWarning)
                    key=getpass.getpass('Supabase SERVER Secret key (hidden; NOT database password): ')
            print('STORAGE_COPY_STARTED - source metadata and private files only; this may take several minutes.',flush=True)
            copy_inventory(root/'inventory.json',root,key);key=None
            report=verify_copy(root)
        print(json.dumps(report))
        if report['status']=='private_copy_verified_not_cut_over':
            print('STORAGE_PRIVATE_COPY_VERIFIED_NOT_CUT_OVER');return 0
        print('STORAGE_PRIVATE_COPY_INCOMPLETE - retain files and manifest; no website cutover.');return 2
    except SourceFailure as error:
        print('STOP: '+str(error)+'. Retain private files and manifest; do not paste credentials.',file=sys.stderr);return 1
    except getpass.GetPassWarning:
        print('STOP: STORAGE_HIDDEN_INPUT_UNAVAILABLE. Use an interactive server terminal or an existing private key file.',file=sys.stderr);return 1
    except RuntimeError as error:
        code=str(error) if str(error) in ('STORAGE_DISK_RESERVE_REQUIRED','STORAGE_TRANSFER_LOCKED','STORAGE_SERVER_LINUX_REQUIRED') else 'STORAGE_TRANSFER_STOPPED'
        print('STOP: '+code+'. Retain private state; no source changes.',file=sys.stderr);return 1
    except (ValueError,OSError,KeyError,TypeError):
        print('STOP: private transfer state, credential format or integrity check failed. Retain files; do not paste keys or private rows.',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
