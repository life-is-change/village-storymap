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
