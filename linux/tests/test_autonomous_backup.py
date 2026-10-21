import sys
from pathlib import Path
import importlib.util
import pytest
import json
from unittest.mock import patch

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'backup-autonomous.py';assert path.is_file()
    spec=importlib.util.spec_from_file_location('autonomous_backup_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_quiesced_backup_restarts_only_originally_running_exact_ids_even_on_failure():
    m=module();calls=[]
    class Docker:
        def own_container(self,name,release):
            return {'Id':name+'-id','Image':'sha256:'+('a' if name.endswith('api') else 'b')*64,'State':{'Running':name.endswith('api')}}
        def run(self,*args):calls.append(args)
    meta={'releaseId':'fixture','accepted_image_ids':['sha256:'+'a'*64],'auth_image_id':'sha256:'+'b'*64}
    with pytest.raises(RuntimeError,match='fixture-backup-failed'):
        with m.quiesce(Docker(),meta):raise RuntimeError('fixture-backup-failed')
    assert calls==[('stop','--time','30','village-autonomous-api-id'),('start','village-autonomous-api-id')]


def test_changed_container_after_backup_is_never_restarted():
    m=module();calls=[]
    class Docker:
        changed=False
        def own_container(self,name,release):return {'Id':name+('-changed' if self.changed else '-id'),'Image':'sha256:'+'a'*64,'State':{'Running':True}}
        def run(self,*args):calls.append(args)
    d=Docker();meta={'releaseId':'fixture','accepted_image_ids':['sha256:'+'a'*64],'auth_image_id':'sha256:'+'a'*64}
    with pytest.raises(ValueError,match='QUIESCED_CONTAINER_CHANGED'):
        with m.quiesce(d,meta):d.changed=True
    assert not any(c[0]=='start' for c in calls)


def test_backup_file_set_includes_private_keys_and_blobs_but_excludes_live_pgdata(tmp_path):
    m=module();state=tmp_path/'state';state.mkdir(mode=0o700)
    meta={'releaseId':'autonomous-'+'a'*12}
    for relative in m.required_paths(meta):
        path=state/relative
        if Path(relative).suffix or relative in ('storage-index.json','compose.json','release.json','nginx.conf'):
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
        else:path.mkdir(parents=True,exist_ok=True)
    secret=state/'secrets/auth-jwt';secret.write_bytes(b'fixture key')
    blob=state/'files/blob';blob.write_bytes(b'fixture blob')
    (state/'data').mkdir();(state/'data/live').write_bytes(b'never filesystem copy PGDATA')
    files=m.backup_files(state,meta)
    assert 'secrets/auth-jwt' in files and 'files/blob' in files
    assert not any(p.startswith('data/') for p in files)
    assert all('/../' not in name for name in files)


def test_streamed_private_backup_retains_partial_on_size_limit_and_never_overwrites(tmp_path):
    m=module();output=tmp_path/'archive.dump'
    m.stream_command([sys.executable,'-c','import sys;sys.stdout.buffer.write(b"x"*5000)'],output,maximum=6000,reserve=0)
    assert output.read_bytes()==b'x'*5000
    with pytest.raises(ValueError):m.stream_command([sys.executable,'-c','print("overwrite")'],output,maximum=6000,reserve=0)
    partial=tmp_path/'partial.dump'
    with pytest.raises(ValueError,match='BACKUP_STREAM_SIZE_LIMIT'):
        m.stream_command([sys.executable,'-c','import sys;sys.stdout.buffer.write(b"x"*5000)'],partial,maximum=4000,reserve=0)
    assert partial.exists()


def test_stream_timeout_kills_a_child_that_never_writes_stdout(tmp_path):
    m=module()
    with pytest.raises(ValueError,match='BACKUP_STREAM_TIMEOUT'):
        m.stream_command([sys.executable,'-c','import time;time.sleep(10)'],tmp_path/'stalled.dump',maximum=4000,reserve=0,timeout=.2)


def test_archive_input_is_streamed_from_file_without_putting_bytes_in_arguments(tmp_path):
    m=module();source=tmp_path/'source.dump';source.write_bytes(b'fixture archive'*1000);source.chmod(0o600)
    target=tmp_path/'decoded.sql'
    m.stream_command([sys.executable,'-c','import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'],target,
                     maximum=20000,reserve=0,input_path=source)
    assert target.read_bytes()==source.read_bytes()


def test_busy_gpu_or_provider_prevents_backup_and_daily_timer_uses_private_operator_command():
    m=module()
    class Docker:
        def sql(self,query):
            assert 'lease_until' in query and 'local_cloud_jobs' in query
            return '1'
    with pytest.raises(ValueError,match='AUTONOMOUS_TASKS_BUSY'):m.require_idle(Docker())
    service,timer=m.backup_units('admin')
    assert 'User=admin' in service and '/home/admin/village-autonomous/control/backup-autonomous.py' in service
    assert 'OnCalendar=*-*-* 04:15:00 Asia/Shanghai' in timer and 'Persistent=true' in timer
    assert 'RestartSec=15min' in service


def test_own_backup_grants_map_to_new_fresh_restore_bootstrap_without_changing_archive():
    m=module();source='CREATE ROLE village_restore_admin;\nGRANT authenticated TO village_unified_login WITH INHERIT TRUE GRANTED BY village_restore_admin;\n'
    mapped=m.recovery_roles_sql(source,'village_backup_check_admin')
    assert 'GRANTED BY "village_backup_check_admin";' in mapped
    assert 'CREATE ROLE village_restore_admin;' in mapped
    assert source.endswith('GRANTED BY village_restore_admin;\n')
    with pytest.raises(ValueError):m.recovery_roles_sql(source.replace('GRANTED BY village_restore_admin','GRANTED BY unreviewed_role'),'village_backup_check_admin')
