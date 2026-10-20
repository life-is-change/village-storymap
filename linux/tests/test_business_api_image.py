import importlib.util
import hashlib
from pathlib import Path
import pytest
S=Path(__file__).resolve().parents[1]/'scripts/build-business-api-image.py'
def module():
    assert S.is_file(), 'Offline image builder missing'
    spec=importlib.util.spec_from_file_location('api_image',S);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def test_code_digest_detects_runtime_changes_but_not_test_files(tmp_path):
    m=module();root=tmp_path/'business-api';(root/'src').mkdir(parents=True);(root/'test').mkdir()
    for f in ('package.json','package-lock.json'): (root/f).write_text('{}')
    (root/'src/main.mjs').write_text('runtime');(root/'test/unit.mjs').write_text('test')
    before=m.code_digest(root);(root/'test/unit.mjs').write_text('changed test');assert m.code_digest(root)==before
    (root/'src/main.mjs').write_text('changed runtime');assert m.code_digest(root)!=before

def test_code_identity_survives_git_windows_linux_newline_conversion(tmp_path):
    m=module();root=tmp_path/'api';(root/'src').mkdir(parents=True)
    for f in ('package.json','package-lock.json','src/main.mjs'):(root/f).write_bytes(b'line1\nline2\n')
    expected=m.code_digest(root)
    for f in ('package.json','package-lock.json','src/main.mjs'):(root/f).write_bytes(b'line1\r\nline2\r\n')
    assert m.code_digest(root)==expected

def test_auth_policy_is_part_of_image_identity(tmp_path):
    m=module();root=tmp_path/'api';(root/'src').mkdir(parents=True);(root/'auth').mkdir()
    for f in ('package.json','package-lock.json','src/main.mjs'):(root/f).write_text('{}')
    policy=root/'auth/policy.mjs';policy.write_text('source only')
    before=m.code_digest(root);policy.write_text('source and local')
    assert m.code_digest(root)!=before

def test_unified_runtime_includes_verifier_auth_dependencies(tmp_path):
    spec=importlib.util.spec_from_file_location('unified_release',S.with_name('build-unified-release.py'))
    release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
    # Enumeration must work in the Python-only CI job as well; dependency
    # execution belongs to the Node/native jobs, not this archive layout test.
    root=tmp_path/'repo'
    for name in ['business-api/package.json','business-api/package-lock.json','business-api/node_modules/pg/package.json','business-api/auth/policy.mjs','business-api/local-tasks/service.mjs','features/mc/mc-bridge.js','features/admin/village-package.js']:
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('{}')
    paths={name for name,_ in release.runtime_files(root)}
    assert 'business-api/auth/policy.mjs' in paths
    assert 'business-api/local-tasks/service.mjs' in paths
def test_builder_rejects_unverified_base_and_source_links(tmp_path):
    m=module();bad=tmp_path/'base.tar';bad.write_bytes(b'not an image')
    with pytest.raises(ValueError):m.validate_base(bad,{'config':{'digest':'sha256:untrusted'},'layers':[]})
    with pytest.raises(ValueError):m.validate_base(bad)

@pytest.mark.parametrize('media', ['docker', 'oci'])
def test_import_identity_includes_compressed_layer_manifest_in_go_descriptor_order(media):
    # Docker/containerd imports can identify the compressed manifest, not config.
    # Literal descriptor order is the registry Go serializer's mediaType,digest,size.
    m=module();config=b'{}';blob=b'compressed-layer'
    config_hash=hashlib.sha256(config).hexdigest()
    layer_hash=hashlib.sha256(blob).hexdigest()
    types=('application/vnd.docker.distribution.manifest.v2+json',
           'application/vnd.docker.container.image.v1+json',
           'application/vnd.docker.image.rootfs.diff.tar.gzip') if media=='docker' else (
           'application/vnd.oci.image.manifest.v1+json',
           'application/vnd.oci.image.config.v1+json',
           'application/vnd.oci.image.layer.v1.tar+gzip')
    literal=('{{"schemaVersion":2,"mediaType":"{}","config":{{"mediaType":"{}",'
             '"digest":"sha256:{}","size":2}},"layers":[{{"mediaType":"{}",'
             '"digest":"sha256:{}","size":16}}]}}').format(
             types[0],types[1],config_hash,types[2],layer_hash).encode()
    expected='sha256:'+hashlib.sha256(literal).hexdigest()
    layers=[('layer.tar.gz',blob,100,'a'*64)]
    assert expected in m.manifest_image_ids(config,layers)
    assert expected not in m.manifest_image_ids(config,[('layer.tar.gz',b'changed',100,'a'*64)])
