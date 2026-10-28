import copy
import importlib.util
import sys
from pathlib import Path, PurePosixPath
import pytest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'linux/scripts'))


def module():
    spec=importlib.util.spec_from_file_location('semester_rollout',ROOT/'linux/scripts/repair-autonomous-semester-groups.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_targeted_replacements_preserve_unrelated_live_updates_and_reject_unknown_content():
    m=module()
    edits=[{'before':'old group code','after':'new semester code'}]
    assert m.apply_edits(b'independent photo fix\nold group code\n',edits)==b'independent photo fix\nnew semester code\n'
    assert m.apply_edits(b'independent photo fix\nnew semester code\n',edits)==b'independent photo fix\nnew semester code\n'
    with pytest.raises(ValueError,match='SEMESTER_WEB_BASELINE_CHANGED'):m.apply_edits(b'unknown group code',edits)
    with pytest.raises(ValueError):m.apply_edits(b'old group code\nold group code',edits)


def test_overlay_replaces_only_exact_web_and_contract_mounts():
    m=module()
    old={'services':{'web':{'image':'pinned-web','volumes':[{'type':'bind','source':'/old/web','target':'/srv/village-web','read_only':True},{'source':'/tls','target':'/etc/tls','read_only':True}]},
      'api':{'image':'pinned-api','volumes':[{'source':'/files','target':'/files'},{'source':'/components/contracts.mjs','target':'/opt/village/business-api/unified/contracts.mjs','read_only':True}]},
      'auth':{'image':'auth'},'postgres':{'image':'pg'}}}
    before=copy.deepcopy(old)
    result=m.overlay_compose(old,PurePosixPath('/new'))
    assert old==before
    assert result['services']['web']['volumes'][0]['source']=='/new/web'
    assert result['services']['api']['volumes'][0]==old['services']['api']['volumes'][0]
    assert result['services']['api']['volumes'][1]['source']=='/new/contracts.mjs'
    assert result['services']['auth']==old['services']['auth']
    assert result['services']['postgres']==old['services']['postgres']


def test_preparation_recovers_a_partial_file_and_an_already_promoted_tree(tmp_path):
    m=module();original=tmp_path/'original';original.mkdir();(original/'index.html').write_bytes(b'old')
    root=tmp_path/'patch';stage=root/'web-preparing';stage.mkdir(parents=True)
    (stage/'index.html.semester-part').write_bytes(b'n')
    first=m.prepare_files(original,root,{'index.html':b'new'},b'contract')
    assert (root/'web/index.html').read_bytes()==b'new'
    assert m.prepare_files(original,root,{'index.html':b'new'},b'contract')==first
    (root/'web/index.html').write_bytes(b'unknown')
    with pytest.raises(ValueError,match='SEMESTER_PREPARED_BYTES_CHANGED'):
        m.prepare_files(original,root,{'index.html':b'new'},b'contract')
