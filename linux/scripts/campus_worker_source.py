"""Verify a small, immutable code-only campus handoff without changing its old Git checkout."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess


def allowed(name):
    p=PurePosixPath(name)
    return (not p.is_absolute() and '..' not in p.parts and '\\' not in name
            and (name=='linux/Dockerfile.worker-local-overlay'
                 or name.startswith('linux/scripts/') and p.suffix=='.py'
                 or name.startswith('server/src/village_processing/') and p.suffix=='.py'))


def verify(root):
    root=Path(root)
    for p in (root,*root.parents):
        if p.is_symlink():raise ValueError('WORKER_SOURCE_SYMLINK_REJECTED')
    manifest=root/'worker-source.json'
    if not manifest.exists():
        if subprocess.check_output(['git','status','--porcelain'],cwd=root).strip():raise ValueError('CLEAN_WORKER_CODE_REQUIRED')
        commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
        if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('WORKER_SOURCE_COMMIT_REQUIRED')
        return commit
    if manifest.is_symlink() or manifest.stat().st_nlink!=1:raise ValueError('WORKER_SOURCE_MANIFEST_REQUIRED')
    doc=json.loads(manifest.read_text(encoding='utf-8'))
    files=doc.get('files',{})
    if doc.get('version')!=1 or doc.get('kind')!='campus-worker-code' or not re.fullmatch('[a-f0-9]{40}',doc.get('commit','')) or not files:
        raise ValueError('WORKER_SOURCE_MANIFEST_REQUIRED')
    expected=set(files)|{'worker-source.json'}
    actual=set()
    for p in root.rglob('*'):
        if p.is_symlink():raise ValueError('WORKER_SOURCE_SYMLINK_REJECTED')
        if p.is_file():actual.add(p.relative_to(root).as_posix())
    if actual!=expected:raise ValueError('WORKER_SOURCE_FILE_SET_CHANGED')
    for name,digest in files.items():
        if not allowed(name) or not re.fullmatch('[a-f0-9]{64}',digest):raise ValueError('WORKER_SOURCE_PATH_REJECTED')
        p=root/name
        if p.stat().st_nlink!=1 or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise ValueError('WORKER_SOURCE_DIGEST_CHANGED')
    return doc['commit']
