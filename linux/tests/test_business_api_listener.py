import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
import pytest

S=Path(__file__).resolve().parents[1]/'scripts/deploy-business-api-validation.py'

def module():
    spec=importlib.util.spec_from_file_location('listener_deploy',S)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def setup_candidate(tmp_path,m):
    state=tmp_path/'candidate';state.mkdir();backup=tmp_path/'backup';backup.mkdir()
    (state/'db/data').mkdir(parents=True);(state/'db/data/keep').write_text('original data')
    new=m.runtime_compose(state,backup,uid=1001,gid=1001,publishable_key='public')
    old=json.loads(json.dumps(new))
    if old['services']['db']['command'][-2:]==['-c','listen_addresses=*']:
        old['services']['db']['command']=old['services']['db']['command'][:-2]
    for name,value in [('runtime-compose.json',old),('deployment-checkpoint.json',{'source_archive_sha256':'archive'}),
                       ('db/archive-snapshot-counts.json',{'rows':{'public.profiles':4},'sequences':{}}),
                       ('candidate-verification.json',{'status':'old proof'}),('verification-attempt.json',{'status':'passed'}),
                       ('api-acceptance.json',{'status':'old proof'})]:
        path=state/name;path.write_text(json.dumps(value));path.chmod(0o600)
    return state,backup,old,new

class Docker:
    def __init__(self,state,m,*,hba_good=True,tcp_good=True):
        self.state=state;self.m=m;self.calls=[];self.hba_good=hba_good;self.tcp_good=tcp_good;self.changed=False
    def run(self,args,**kwargs):
        self.calls.append(args)
        if args[:2]==['network','inspect']:
            return json.dumps([{'Internal':True,'IPAM':{'Config':[{'Subnet':'172.30.0.0/24'}]}}])
        if args[0]=='compose':
            assert args==['compose','-f',str(self.state/'runtime-compose.json'),'up','-d','--no-deps','--force-recreate','--pull','never','--wait','--wait-timeout','120','db']
            self.changed=True;return ''
        if args[:3]==['exec','-i',self.m.API]:
            assert args[3:6]==['node','--input-type=module','-e']
            if not self.tcp_good:raise RuntimeError('TCP unavailable')
            return 'API_DATABASE_TCP_OK\n'
        raise AssertionError(args)
    def sql(self,sql):
        if 'current_setting' in sql:return json.dumps({'listen_addresses':'*' if self.changed else 'localhost','port':'5432'})
        assert sql=='SELECT count(*) FROM "public"."profiles";'
        return '4\n'
    def exec(self,*args,**kwargs):
        assert args==('cat','/var/lib/postgresql/data/pg_hba.conf')
        return ('local all all trust\nhost village_copy village_api_login 172.30.0.0/24 scram-sha-256\n'
                'host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n') if self.hba_good else 'host all all all trust\n'

@pytest.mark.parametrize('bad',['none','hba','backup','tcp','runtime'])
def test_listener_repair_preserves_data_and_requires_restricted_hba(tmp_path,bad,capsys):
    m=module();state,backup,old,new=setup_candidate(tmp_path,m);docker=Docker(state,m,hba_good=bad!='hba',tcp_good=bad!='tcp')
    def validate(docker_arg,state_arg,backup_arg,*,legacy_listener=False):
        assert (docker_arg,state_arg,backup_arg)==(docker,state,backup)
        assert json.loads((state/'runtime-compose.json').read_text())==(old if legacy_listener else new)
        if bad=='runtime':raise ValueError('Unsafe container')
    with patch.object(m,'validate_runtime',side_effect=validate),patch.object(m.os,'geteuid',return_value=1001,create=True),patch.object(m.os,'getegid',return_value=1001,create=True),patch.object(m,'read_public_key',return_value='public'),patch.object(m.rd,'verify_backup',return_value={'files':{'database.dump':{'sha256':'different' if bad=='backup' else 'archive'}}}):
        if bad=='none':
            m.repair_db_listener(backup,state,docker)
            # A second call validates the repaired environment without recreating again.
            m.repair_db_listener(backup,state,docker)
        else:
            with pytest.raises((ValueError,RuntimeError)):m.repair_db_listener(backup,state,docker)
    assert (state/'db/data/keep').read_text()=='original data'
    changed=bad in ('none','tcp')
    assert json.loads((state/'runtime-compose.json').read_text())==(new if changed else old)
    if changed:
        saved=list(state.glob('runtime-compose.before-listener-*.json'));assert len(saved)==1
        assert json.loads(saved[0].read_text())==old
        assert not (state/'candidate-verification.json').exists()
        assert not (state/'api-acceptance.json').exists()
        assert not (state/'verification-attempt.json').exists()
        assert list(state.glob('candidate-verification.before-listener-*.json'))
        assert docker.changed
        assert len([c for c in docker.calls if c[0]=='compose'])==1
    else:
        assert (state/'candidate-verification.json').exists()
        assert not docker.changed
    assert ('CANDIDATE_DB_LISTENER_REPAIRED_NOT_ACCEPTED' in capsys.readouterr().out)==(bad=='none')

def test_api_tcp_probe_refuses_unreachable_database():
    m=module()
    class Bad:
        def run(self,args,**kwargs):raise RuntimeError('database unreachable')
    with pytest.raises(RuntimeError):m.verify_api_database_connection(Bad())
