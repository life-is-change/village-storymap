#!/usr/bin/env python3
"""Package committed component rollout source, never host env/data/weights."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path,PurePosixPath
import subprocess
import tarfile


def allowed(name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or any(v.startswith('.') for v in p.parts) and not name.endswith('.dockerignore'):return False
    if p.suffix in ('.pt','.pth','.ckpt','.safetensors','.pyc') or 'tests' in p.parts or name.endswith('.test.js'):return False
    return (name.startswith('linux/scripts/') and p.suffix=='.py'
        or name.startswith('linux/sql/') and p.suffix=='.sql'
        or p.parent==PurePosixPath('linux') and (p.suffix=='.json' or p.name.startswith('Dockerfile.component-'))
        or name.startswith('server/src/village_processing/') and p.suffix=='.py'
        or name.startswith('rural_house_generator/backend/') and p.suffix in ('.py','.json','.jpg','.hdr','.md'))


def prepare(root,output):
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    baseline=json.loads(subprocess.check_output(['git','show',commit+':linux/component-baseline.json'],cwd=root))
    names=subprocess.check_output(['git','ls-tree','-r','--name-only',commit],cwd=root,text=True).splitlines()
    names=sorted({n for n in names if allowed(n)}|set(baseline['api_files'])|set(baseline['web_files']))
    values={n:subprocess.check_output(['git','show',commit+':'+n],cwd=root) for n in names}
    doc={'kind':'component-rollout','commit':commit,'files':{n:hashlib.sha256(v).hexdigest() for n,v in values.items()}}
    values['component-source.json']=(json.dumps(doc,sort_keys=True)+'\n').encode()
    prefix='village-components-'+commit[:12];folders={prefix}
    for n in values:folders.update(str(p) for p in (PurePosixPath(prefix)/n).parents if str(p)!='.')
    with output.open('xb') as stream,gzip.GzipFile(fileobj=stream,mode='wb',filename='',mtime=0) as zipped,tarfile.open(fileobj=zipped,mode='w') as archive:
        for n in sorted(folders):
            info=tarfile.TarInfo(n);info.type=tarfile.DIRTYPE;info.mode=0o755;archive.addfile(info)
        for n,v in sorted(values.items()):
            info=tarfile.TarInfo(prefix+'/'+n);info.mode=0o644;info.size=len(v);archive.addfile(info,io.BytesIO(v))
    return {'source_commit':commit,'directory':prefix,'filename':output.name,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    print(json.dumps(prepare(Path(__file__).resolve().parents[2],args.output)))
