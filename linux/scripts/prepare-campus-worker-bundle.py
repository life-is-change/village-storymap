#!/usr/bin/env python3
"""Export committed Python transport code only; no models, dotenv or credentials."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path,PurePosixPath
import subprocess
import tarfile
from campus_worker_source import allowed


def prepare(root,output):
    root=Path(root);output=Path(output)
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    names=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
    names=sorted(n for n in names if allowed(n))
    files={n:subprocess.check_output(['git','show',commit+':'+n],cwd=root) for n in names}
    required={'linux/scripts/install-autonomous-workers.py','linux/scripts/campus_worker_source.py','linux/Dockerfile.worker-local-overlay','server/src/village_processing/local_task_http.py'}
    if not required<=set(files):raise ValueError('COMMITTED_WORKER_SOURCE_REQUIRED')
    doc={'version':1,'kind':'campus-worker-code','commit':commit,'files':{n:hashlib.sha256(v).hexdigest() for n,v in files.items()}}
    files['worker-source.json']=(json.dumps(doc,sort_keys=True)+'\n').encode()
    prefix='village-campus-worker-'+commit[:12]
    directories={prefix}
    for n in files:
        directories.update(str(p) for p in (PurePosixPath(prefix)/n).parents if str(p)!='.')
    with output.open('xb') as out,gzip.GzipFile(fileobj=out,mode='wb',filename='',mtime=0) as compressed,tarfile.open(fileobj=compressed,mode='w') as archive:
        for n in sorted(directories):
            item=tarfile.TarInfo(n);item.type=tarfile.DIRTYPE;item.mode=0o700;archive.addfile(item)
        for n,data in sorted(files.items()):
            item=tarfile.TarInfo(prefix+'/'+n);item.size=len(data);item.mode=0o600;archive.addfile(item,io.BytesIO(data))
    return {'source_commit':commit,'archive_filename':output.name,'directory':prefix,'archive_bytes':output.stat().st_size,'archive_sha256':hashlib.sha256(output.read_bytes()).hexdigest()}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    print(json.dumps(prepare(Path(__file__).resolve().parents[2],args.output)))
