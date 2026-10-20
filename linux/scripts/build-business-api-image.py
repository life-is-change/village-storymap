#!/usr/bin/env python3
"""Assemble an offline Docker archive from a verified official Node base (no registry push)."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

BASE='sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562'
BASE_CONFIG='sha256:d0a16be756b6ec6658aecb8b7bcf87fa6c7d0d7fcc6ca53ad14bb49a4c90bdd7'
BASE_LAYERS=[('7fd1ebe418b5079d4aa36f416af9b143d127bc75b0155d71cb5fd559b5e04d39',28249323),('f0400f4b55b0ad346bf6167a1b64a258e4d73db608c457798ce35e4ffeebfaaf',3313),('d22c69a95cf463f4cb74462bd2899597ce505d82bd4c01ceddf7845e12f13856',49837030),('2cfab517365cfc6b4bd1f8c4cb01754884ef75bc38758b3c41e291c696f019f5',1713011),('a8de9fa052209313d8e45435a8486e29b20eebaa820e2e7f63a7c3c94b4fa567',448)]
ROOT=Path(__file__).resolve().parents[2]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,separators=(',',':'),sort_keys=True).encode()
def code_digest(root,*,include_scene=False,include_scene_files=False):
    h=hashlib.sha256()
    files=[Path(root)/'package.json',Path(root)/'package-lock.json',*sorted((Path(root)/'src').rglob('*.mjs')),*sorted((Path(root)/'auth').rglob('*.mjs'))]
    if include_scene:files+=sorted((Path(root)/'scene').rglob('*.mjs'))
    if include_scene_files:files+=sorted((Path(root)/'scene-files').rglob('*.mjs'))
    for p in files:
        if p.is_symlink():raise ValueError('Linked runtime file.')
        # Git converts text newlines between Windows development and Linux deploy.
        h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes().replace(b'\r\n',b'\n')+b'\0')
    return h.hexdigest()
def validate_base(path,descriptor=None):
    if descriptor is not None and descriptor.get('config',{}).get('digest')!=BASE_CONFIG:raise ValueError('Unverified base descriptor.')
    try:
        with tarfile.open(path) as t:
            manifests=json.load(t.extractfile('manifest.json'))
            if len(manifests)!=1:raise ValueError('Exactly one base image required.')
            m=manifests[0];raw=t.extractfile(m['Config']).read();config=json.loads(raw)
            if 'sha256:'+sha(raw)!=BASE_CONFIG or (config['os'],config['architecture'])!=('linux','amd64') or len(m['Layers'])!=5:raise ValueError('Base config/platform mismatch.')
            layers=[]
            for i,(name,(digest,size)) in enumerate(zip(m['Layers'],BASE_LAYERS)):
                blob=t.extractfile(name).read()
                if len(blob)!=size or sha(blob)!=digest:raise ValueError('Base layer checksum mismatch.')
                unpacked=gzip.decompress(blob)
                if 'sha256:'+sha(unpacked)!=config['rootfs']['diff_ids'][i]:raise ValueError('Base layer uncompressed checksum mismatch.')
                layers.append((name,blob,len(unpacked),sha(unpacked)))
            return config,layers
    except tarfile.TarError as e:raise ValueError('Invalid base archive.') from e
def add(t,name,raw):
    info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;info.mtime=0;t.addfile(info,io.BytesIO(raw))
def manifest_image_ids(cbytes,layers):
    """Derive config and import-manifest IDs from exact archive bytes."""
    configsha=sha(cbytes);ids=['sha256:'+configsha]
    for media in ('docker','oci'):
        types=('application/vnd.docker.distribution.manifest.v2+json','application/vnd.docker.container.image.v1+json','application/vnd.docker.image.rootfs.diff.tar') if media=='docker' else ('application/vnd.oci.image.manifest.v1+json','application/vnd.oci.image.config.v1+json','application/vnd.oci.image.layer.v1.tar')
        # Retain identities emitted by the earlier builder metadata.
        legacy={'schemaVersion':2,'mediaType':types[0],'config':{'mediaType':types[1],'size':len(cbytes),'digest':'sha256:'+configsha},'layers':[{'mediaType':types[2],'size':size,'digest':'sha256:'+diff} for _,_,size,diff in layers]}
        ids.append('sha256:'+sha(json.dumps(legacy,separators=(',',':')).encode()))
        for compressed in (False,True):
            # Go registry descriptors serialize mediaType,digest,size. Docker's
            # containerd image store may retain the compressed layer descriptors.
            suffix=('.gzip' if media=='docker' else '+gzip') if compressed else ''
            desc={'schemaVersion':2,'mediaType':types[0],
                  'config':{'mediaType':types[1],'digest':'sha256:'+configsha,'size':len(cbytes)},
                  'layers':[{'mediaType':types[2]+suffix,
                             'digest':'sha256:'+(sha(blob) if compressed else diff),
                             'size':len(blob) if compressed else size}
                            for _,blob,size,diff in layers]}
            ids.append('sha256:'+sha(json.dumps(desc,separators=(',',':')).encode()))
    return list(dict.fromkeys(ids))

def metadata_filename(image):
    names={'village-business-api:stage-a1':'business-api-image.json','village-business-api:stage-b2-read':'storage-read-image.json','village-business-api:stage-c1-scene':'scene-write-image.json','village-business-api:stage-c2a-scene-files':'scene-files-image.json'}
    if image not in names:raise ValueError('Unsupported candidate image tag.')
    return names[image]

def build(base,output,api_root,*,image='village-business-api:stage-a1'):
    metadata_filename(image);scene_files=image.endswith(':stage-c2a-scene-files');scene=image.endswith(':stage-c1-scene') or scene_files
    output=Path(output)
    if output.exists():raise ValueError('Output already exists; choose a new archive name.')
    config,layers=validate_base(base);api_root=Path(api_root)
    if not (api_root/'node_modules/pg/package.json').is_file():raise ValueError('Run npm ci --omit=dev in business-api first.')
    # pg is pure JS here. Native modules need a Linux build instead of host copying.
    runtime=[api_root/'package.json',api_root/'package-lock.json',*sorted((api_root/'src').rglob('*')),*sorted((api_root/'auth').rglob('*')),*sorted((api_root/'node_modules').rglob('*'))]
    if scene:runtime+=sorted((api_root/'scene').rglob('*'))
    if scene_files:runtime+=sorted((api_root/'scene-files').rglob('*'))
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w') as t:
        for p in runtime:
            if p.is_symlink() or p.suffix.lower() in ('.node','.dll','.exe'):raise ValueError('Native/linked runtime dependency requires a Linux build.')
            if p.is_file():add(t,'app/'+p.relative_to(api_root).as_posix(),p.read_bytes())
    raw=stream.getvalue();blob=gzip.compress(raw,mtime=0);digest=code_digest(api_root,include_scene=scene,include_scene_files=scene_files)
    layers.append((sha(blob)+'.tar.gz',blob,len(raw),sha(raw)))
    config['rootfs']['diff_ids'].append('sha256:'+sha(raw))
    config['config'].update({'WorkingDir':'/app','User':'1000:1000','Entrypoint':None,'Cmd':['node','scene-files/main.mjs' if scene_files else 'scene/main.mjs' if scene else 'src/main.mjs']})
    config['config'].setdefault('Labels',{}).update({'village.api.code-sha256':digest,'org.opencontainers.image.source':'https://github.com/life-is-change/village-storymap'})
    config.setdefault('history',[]).append({'created':'2026-10-15T00:00:00Z','created_by':'verified Node base + npm ci pure JS runtime'})
    cbytes=encoded(config);configsha=sha(cbytes);manifest=[{'Config':configsha+'.json','RepoTags':[image],'Layers':[x[0] for x in layers]}]
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('xb') as target,gzip.GzipFile(fileobj=target,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|') as t:
        add(t,configsha+'.json',cbytes);add(t,'manifest.json',encoded(manifest))
        for name,blob,_,_ in layers:add(t,name,blob)
    ids=manifest_image_ids(cbytes,layers)
    meta={'image':image,'base_manifest':BASE,'base_source':'public.ecr.aws/docker/library/node',
          'code_sha256':digest,'accepted_image_ids':ids,'os':'linux','architecture':'amd64',
          'archive_filename':output.name,'archive_bytes':output.stat().st_size,'archive_sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),
          'runtime_execution':'pending_linux_container_smoke_test'}
    return meta
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-archive',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--image',choices=['village-business-api:stage-a1','village-business-api:stage-b2-read','village-business-api:stage-c1-scene','village-business-api:stage-c2a-scene-files'],default='village-business-api:stage-a1')
    args=p.parse_args();meta=build(args.base_archive,args.output,ROOT/'business-api',image=args.image)
    name=metadata_filename(args.image)
    (ROOT/'linux'/name).write_text(json.dumps(meta,indent=2)+'\n')
    print('Verified offline image assembled:',args.output);print('Archive SHA-256:',meta['archive_sha256'])
if __name__=='__main__':main()
