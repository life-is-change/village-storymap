import importlib.util
from pathlib import Path
import sys
import pytest
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))
ROOT=S.parents[1]


def test_personal_context_patch_accepts_only_exact_legacy_or_fixed_body_and_keeps_owner_guards():
    from workspace_context import body_pair,patch_sql
    old=(ROOT/'linux/sql/autonomous-personal-context-compat.sql').read_text(encoding='utf8')
    fixed=(ROOT/'linux/sql/workspace-personal-context.sql').read_text(encoding='utf8')
    before,after=body_pair(old,fixed)
    assert before!=after
    assert 'village.is_practice' in after and 'village.status' in after
    assert 'v_project.formal_project_open' in after and 'v_project.formal_village_id' in after
    assert 'PERSONAL_SPACE_PROJECT_CONFLICT' in after and 'auth.uid()' in after
    assert 'geoprocessing_villages' not in after
    sql=patch_sql(old,fixed)
    assert 'WORKSPACE_PERSONAL_FUNCTION_CHANGED' in sql
    assert "'public.ensure_course_personal_space(text,uuid,text,text,text)'::regprocedure" in sql
    assert 'GRANT ' not in sql and 'UPDATE public.' not in sql
    assert 'EXECUTE' not in patch_sql(old,fixed,apply=False)
    with pytest.raises(ValueError):body_pair('unrecognized source',fixed)


def test_native_history_fixture_reconstructs_exact_deployed_files():
    import hashlib,json
    fixture=json.loads((ROOT/'linux/tests/workspace-legacy-web.json').read_text(encoding='utf8'))
    baseline=json.loads((ROOT/'linux/workspace-repair-baseline.json').read_text())
    assert fixture['baselineCommit']==baseline['sourceCommit']
    for name,changes in fixture['files'].items():
        from baseline_web_fixture import previous_source_bytes
        text=previous_source_bytes(ROOT,name).decode('utf8')
        for change in reversed(changes):
            assert text.count(change['new'])==1
            text=text.replace(change['new'],change['old'],1)
        assert hashlib.sha256(text.encode()).hexdigest()==baseline['files'][name]


def test_new_overlay_requires_all_deployed_baseline_files_without_printing_contents(tmp_path):
    import json
    spec=importlib.util.spec_from_file_location('workspace_repair',S/'repair-autonomous-workspace.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    values=m.browser.inputs(ROOT)
    fixture=json.loads((ROOT/'linux/tests/workspace-legacy-web.json').read_text(encoding='utf8'))['files']
    for name in m.BASELINE:
        from baseline_web_fixture import previous_source_bytes
        value=previous_source_bytes(ROOT,name).decode('utf8')
        for change in reversed(fixture.get(name,[])):value=value.replace(change['new'],change['old'],1)
        patch=m.entry.PATCH if name in ('app-3d.js','features/data/unified-api-client.js') else m.locks.PATCH
        path=tmp_path/'files'/patch/'web'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(value.encode())
    data=m.previous_data(tmp_path,ROOT)
    assert m.digest(data['app.js'])==m.BASELINE['app.js']
    path=tmp_path/'files'/m.entry.PATCH/'web/app-3d.js';path.write_bytes(b'unknown')
    with pytest.raises(ValueError,match='WORKSPACE_BASELINE_CHANGED'):m.previous_data(tmp_path,ROOT)
