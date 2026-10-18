import importlib.util
from pathlib import Path
import pytest
P=Path(__file__).resolve().parents[1]/'scripts/probe-scene-files.py'
def load():
 if not P.exists():return None
 spec=importlib.util.spec_from_file_location('scene_files_probe',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def test_scene_files_probe_reports_missing_membership_before_any_upload():
 m=load();assert m is not None
 with pytest.raises(m.ContextFailure,match='CONTEXT_MEMBERSHIP_REQUIRED'):m.check_context({'profile':True,'membership':None,'context':{'scopeKind':'admin_sandbox'}})
def test_scene_files_probe_phase_has_no_private_output():
 m=load();assert m is not None
 value=m.failure_message('upload',m.base.ResponseFailure('http',403,'FORBIDDEN'));assert 'phase=upload' in value and 'http_status=403' in value
 assert 'secret' not in m.failure_message('save',ValueError('private password secret SQL'))
def test_scene_files_probe_synthetic_files_have_no_external_dependencies():
 m=load();assert m is not None
 glb,png=m.synthetic_files();assert glb[:4]==b'glTF';assert png[:8]==b'\x89PNG\r\n\x1a\n';assert b'https:' not in glb
