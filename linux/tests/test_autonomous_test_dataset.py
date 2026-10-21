import importlib.util,sys
from pathlib import Path
S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))

def module():
 p=S/'repair-autonomous-test-dataset.py'
 assert p.is_file(), 'missing scoped TEST dataset repair'
 spec=importlib.util.spec_from_file_location('test_dataset_repair',p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_repair_sql_requires_fixed_test_scope_and_retains_not_null_constraints():
 m=module();sql=m.repair_sql()
 assert 'AUTONOMOUS_TEST_SCOPE_REQUIRED' in sql
 assert 'AUTONOMOUS_TEST_DATASET_COLLISION' in sql
 assert 'unified-test-autonomous-20261021' in sql
 assert 'base_dataset_id IS NULL' in sql
 assert 'UPDATE public.planning_spaces SET base_dataset_id=' in sql
 assert 'INSERT INTO public.village_datasets' in sql
 assert 'ALTER TABLE' not in sql and 'DROP' not in sql
 assert 'COMMIT;' in sql and 'FOR UPDATE' in sql

def test_public_switch_is_rejected_before_runtime_or_sql(tmp_path,monkeypatch):
 import contextlib,pytest
 m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
 (state/'public-switch.json').write_text('{}')
 monkeypatch.setattr(m,'operation_lock',lambda state:contextlib.nullcontext())
 monkeypatch.setattr(m,'load_script',lambda name:pytest.fail('must stop before any runtime query'))
 with pytest.raises(ValueError,match='PRE_SWITCH_TEST_REPAIR_ONLY'):m.repair(state)

def test_new_release_context_creates_baseline_in_same_transaction():
 from autonomous_bundle import load_script
 builder=load_script('build-autonomous-release');sql=builder.test_context_template(S.parents[1])
 assert 'INSERT INTO public.village_datasets' in sql
 assert sql.count('BEGIN;')==1 and sql.count('COMMIT;')==1
 assert sql.index('INSERT INTO public.village_datasets')<sql.index("SELECT json_build_object('status',CASE")
