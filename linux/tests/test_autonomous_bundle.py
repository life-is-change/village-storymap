import importlib.util
from pathlib import Path
import sys
import json
import datetime as dt
import pytest

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def module():
    path=S/'autonomous_bundle.py';assert path.is_file(),'full snapshot bundle inspector missing'
    spec=importlib.util.spec_from_file_location('autonomous_bundle_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def test_offline_inventory_uses_archive_storage_rows_and_preserves_copy_escaping():
    m=module()
    sql=['COPY storage.buckets (id, name, public) FROM stdin;','group-models\tgroup-models\tf',r'\.',
         'COPY storage.objects (id, bucket_id, name, metadata, updated_at, version) FROM stdin;',
         'id-1\tgroup-models\tspace/model.glb\t{"size":3,"eTag":"v1"}\t2026-10-21 01:00:00+00\t\\N',r'\.']
    doc=m.inventory_from_copy(sql,archive_sha256='a'*64,generated_at='2026-10-21T02:00:00+00:00')
    assert doc['objects'][0]['snapshot_updated_at']=='2026-10-21T01:00:00.000000Z'
    assert doc['objects'][0]['declared_size']==3 and doc['objects'][0]['snapshot_version'] is None
    assert doc['source_archive_sha256']=='a'*64 and doc['buckets']==[{'id':'group-models','public':False}]
    assert m.decode_copy(r'a\\b\t\n')=='a\\b\t\n'
    assert m.decode_copy(r'\N') is None


def test_storage_copy_truncation_duplicate_tables_and_unsupported_records_fail():
    m=module()
    for sql in [[],['COPY storage.buckets (id, public) FROM stdin;','private\tf'],
        ['COPY storage.buckets (id, public) FROM stdin;',r'\.', 'COPY storage.buckets (id, public) FROM stdin;',r'\.'],
        ['COPY storage.buckets (id, public) FROM stdin;','private\tf',r'\.','COPY storage.objects (id, bucket_id, name, metadata, updated_at) FROM stdin;','bad\tprivate\tx\t[]\t2026-10-21',r'\.']]:
        with pytest.raises(ValueError):m.inventory_from_copy(sql,archive_sha256='a'*64,generated_at='2026-10-21')


def test_fresh_snapshot_gate_rejects_older_than_one_day_and_wrong_source():
    m=module();now=dt.datetime(2026,10,21,12,tzinfo=dt.timezone.utc)
    manifest={'source':{'host':'aws-1-ap-northeast-1.pooler.supabase.com','database':'postgres','user':'postgres.rzmbmwauomzwiyenafha'},
              'started_at_utc':(now-dt.timedelta(hours=2)).isoformat(),'completed_at_utc':(now-dt.timedelta(hours=1)).isoformat()}
    assert m.validate_fresh_snapshot(manifest,now=now)['snapshot_age_hours']==2
    for update in [{'started_at_utc':(now-dt.timedelta(days=2)).isoformat()},
                   {'completed_at_utc':(now+dt.timedelta(hours=1)).isoformat()}, {'source':{'host':'other'}}]:
        with pytest.raises(ValueError):m.validate_fresh_snapshot({**manifest,**update},now=now)


def test_offline_decode_container_has_no_network_and_never_starts_postgres(tmp_path):
    m=module();cmd=m.offline_restore_command(tmp_path/'backup',image_id='sha256:'+'a'*64,schema='storage',tables=('buckets','objects'),uid=1000,gid=1000)
    assert cmd[:5]==['sudo','-n','docker','--context','default']
    assert ['--network','none']==cmd[cmd.index('--network'):cmd.index('--network')+2]
    assert '--entrypoint' in cmd and 'pg_restore' in cmd and '--file=-' in cmd
    assert not any(arg in ('postgres','--privileged','-p') for arg in cmd)
    with pytest.raises(ValueError):m.offline_restore_command(tmp_path,image_id='postgres:latest',schema='storage',tables=('objects',),uid=1000,gid=1000)
