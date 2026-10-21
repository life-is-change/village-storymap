import sys
import importlib.util
from pathlib import Path
import pytest
import json

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))
ROOT=S.parents[1]


def module():
    path=S/'build-autonomous-release.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_release_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_autonomous_stage_has_same_origin_auth_and_preserves_github_source_configuration(tmp_path):
    m=module();source=(ROOT/'deployment-config.js').read_bytes()
    result=m.stage_autonomous(ROOT,tmp_path/'web',release_id='autonomous-'+'a'*12)
    assert result['mode']=='aliyun' and result['instanceId']=='aliyun-village'
    assert result['auth']=={'version':1,'mode':'local','path':'/auth/v1','publicKey':'village-local-public-v1'}
    assert (ROOT/'deployment-config.js').read_bytes()==source
    script=(tmp_path/'web/deployment-config.js').read_text()
    assert 'supabase.co' not in script and 'bridge' not in script.lower()
    assert b'\r\n' not in (tmp_path/'web/index.html').read_bytes()


def test_package_schema_version_and_runtime_contract_are_explicitly_distinct():
    m=module();release={'schemaVersion':2,'kind':'autonomous','releaseId':'autonomous-'+'a'*12,'instanceId':'aliyun-village',
                       'code_sha256':'a'*64,'schema_sha256':'b'*64}
    runtime=m.api_release(release)
    assert runtime['schemaVersion']==1 and runtime['authMode']=='local'
    assert runtime['releaseId']==release['releaseId']
    assert release['schemaVersion']==2


def test_release_build_refuses_without_the_complete_frozen_control_set(tmp_path):
    m=module()
    with pytest.raises(ValueError,match='COMPLETE_AUTONOMOUS_CONTROLS_REQUIRED'):m.control_files(tmp_path)
    assert 'deploy-autonomous.py' in m.CONTROLS and 'reset-local-password.py' in m.CONTROLS
    assert 'prepare-unified-cutover.py' not in m.CONTROLS
