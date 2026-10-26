import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/component_frontend_patch.py'
spec = importlib.util.spec_from_file_location('component_frontend_patch_test', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    state = tmp_path / 'cloud'
    (state / 'web/rural_house_generator').mkdir(parents=True)
    (state / 'code').mkdir()
    (state / 'operator.py').write_bytes(b'verified parent')
    monkeypatch.setattr(m, 'PARENT_OPERATOR_SHA256', m.sha(b'verified parent'))
    for name in m.FILES:
        (state / 'web' / name).write_bytes(('before ' + name).encode())
    (state / 'web/unrelated.txt').write_bytes(b'keep')
    (state / 'code/api.js').write_bytes(b'api unchanged')
    parent = {'phase': 'complete', 'commit': m.COMMIT, 'kind': 'cloud',
              'operator_sha256': m.PARENT_OPERATOR_SHA256, 'after': {'api': 'id1', 'web': 'id2'},
              'api_hashes': {'api.js': m.sha(b'api unchanged')}, 'web_sha256': m.tree_digest(state / 'web')}
    m.write_json(state / 'receipt.json', parent)
    values = {name: ('after ' + name).encode() for name in m.FILES}
    return state, parent, values


def invoke(state, values, **kwargs):
    return m.patch(state, values, inspect=lambda *_: None, served=lambda *_: None, **kwargs)


def test_check_is_read_only(deployment):
    state, parent, values = deployment
    result = invoke(state, values)
    assert result['status'].endswith('preflight_passed')
    assert m.read_json(state / 'receipt.json') == parent
    assert not (state / m.PATCH).exists()


def test_apply_keeps_api_identity_and_original_backups_and_is_repeatable(deployment):
    state, parent, values = deployment
    invoke(state, values, apply=True)
    after = m.read_json(state / 'receipt.json')
    assert after['after'] == parent['after']
    assert after['api_hashes'] == parent['api_hashes']
    assert after['web_sha256'] == m.tree_digest(state / 'web')
    for name, data in values.items():
        assert (state / 'web' / name).read_bytes() == data
        assert (state / m.PATCH / name).read_bytes() == ('before ' + name).encode()
    invoke(state, values, apply=True)


def test_failed_http_verification_preserves_parent_receipt_and_can_resume(deployment):
    state, parent, values = deployment
    def fail(*_):
        raise ValueError('SERVED_GENERATOR_FILE_DIFFERS')
    with pytest.raises(ValueError, match='SERVED_GENERATOR_FILE_DIFFERS'):
        m.patch(state, values, apply=True, inspect=lambda *_: None, served=fail)
    assert m.read_json(state / 'receipt.json') == parent
    assert m.read_json(state / m.PATCH / 'receipt.json')['phase'] == 'prepared'
    invoke(state, values, apply=True)
    assert m.read_json(state / m.PATCH / 'receipt.json')['phase'] == 'served_verified'


def test_interrupted_asset_replace_keeps_partial_file_outside_web_and_resumes(deployment, monkeypatch):
    state, parent, values = deployment
    replace = m.os.replace
    def interrupt(source, target):
        if Path(target).parent == state / 'web/rural_house_generator':
            raise OSError('simulated interruption before replace')
        return replace(source, target)
    monkeypatch.setattr(m.os, 'replace', interrupt)
    with pytest.raises(OSError, match='simulated interruption'):
        invoke(state, values, apply=True)
    assert not list((state / 'web').rglob('*.patch-part'))
    assert list((state / m.PATCH / 'staging').glob('*.patch-part'))
    assert m.read_json(state / 'receipt.json') == parent
    monkeypatch.setattr(m.os, 'replace', replace)
    invoke(state, values, apply=True)


def test_unknown_web_change_is_not_overwritten(deployment):
    state, _, values = deployment
    (state / 'web/unrelated.txt').write_bytes(b'another deployment')
    with pytest.raises(ValueError, match='DEPLOYED_WEB_CHANGED'):
        invoke(state, values, apply=True)
    assert not (state / m.PATCH).exists()


def test_resuming_refuses_changes_outside_the_five_files(deployment):
    state, _, values = deployment
    invoke(state, values, apply=True)
    (state / 'web/unrelated.txt').write_bytes(b'edited later')
    with pytest.raises(ValueError, match='UNRELATED_WEB_CHANGED'):
        invoke(state, values, apply=True)


def test_original_api_change_prevents_writing(deployment):
    state, _, values = deployment
    (state / 'code/api.js').write_bytes(b'changed')
    with pytest.raises(ValueError, match='DEPLOYED_API_CHANGED'):
        invoke(state, values, apply=True)


def test_release_builder_embeds_exactly_the_five_current_assets(tmp_path):
    builder_path = SCRIPT.with_name('build_component_frontend_patch.py')
    build_spec = importlib.util.spec_from_file_location('frontend_builder_test', builder_path)
    builder = importlib.util.module_from_spec(build_spec)
    build_spec.loader.exec_module(builder)
    output = tmp_path / 'standalone.py'
    builder.build(output)
    release_spec = importlib.util.spec_from_file_location('standalone_frontend_test', output)
    release = importlib.util.module_from_spec(release_spec)
    release_spec.loader.exec_module(release)
    assert release.payload() == {name: (builder.ROOT / name).read_bytes().replace(b'\r\n', b'\n') for name in m.FILES}
