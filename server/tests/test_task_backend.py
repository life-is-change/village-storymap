import builtins
import importlib
from uuid import uuid4

import pytest


def api():
    try:
        return importlib.import_module('village_processing.task_backend')
    except ImportError:
        pytest.fail('explicit task backend selection is missing')


def test_local_backend_never_imports_supabase_and_requires_its_own_private_key(tmp_path, monkeypatch):
    path = tmp_path/'worker-key'
    path.write_text('village_worker_'+str(uuid4())+'.'+'A'*43)
    path.chmod(0o600)
    original = builtins.__import__

    def checked(name, *args, **kwargs):
        if name == 'supabase' or name.startswith('supabase.'):
            pytest.fail('local backend imported source SDK')
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', checked)
    env = {'VILLAGE_TASK_BACKEND':'aliyun', 'VILLAGE_WORKER_KEY_FILE':str(path), 'SUPABASE_URL':'https://source.invalid', 'SUPABASE_SERVICE_ROLE_KEY':'must-not-be-used'}
    gateway = api().build_gateway('geo', env)
    assert gateway.kind == 'geo'
    gateway.http.close()
    with pytest.raises(ValueError, match='INVALID_LOCAL_GATEWAY'):
        api().build_gateway('facade', {**env, 'VILLAGE_LOCAL_ORIGIN':'http://8.148.248.237'})
    for value in ('ALIYUN', '', 'fallback'):
        with pytest.raises(ValueError, match='INVALID_TASK_BACKEND'):
            api().backend({'VILLAGE_TASK_BACKEND':value})
    assert api().backend({}) == 'supabase'


def test_local_facade_cli_does_not_require_source_keys_and_stops_on_failed_health(monkeypatch):
    from village_processing import __main__ as cli
    monkeypatch.setenv('VILLAGE_TASK_BACKEND','aliyun')
    monkeypatch.delenv('SUPABASE_URL',raising=False)
    monkeypatch.delenv('SUPABASE_SERVICE_ROLE_KEY',raising=False)
    monkeypatch.setattr(cli,'run_facade_health_checks',lambda:1)
    with pytest.raises(SystemExit,match='Facade worker health checks failed'):
        cli.main(['facade-worker'])


def test_local_health_does_not_even_import_source_sdk(monkeypatch):
    import httpx
    from village_processing import health
    monkeypatch.setenv('VILLAGE_TASK_BACKEND','aliyun')
    monkeypatch.setattr(health,'_local_gateway_health',lambda *_:True)
    monkeypatch.setattr(httpx,'get',lambda *_args,**_kwargs:type('Response',(),{'status_code':200})())
    original=builtins.__import__
    def checked(name,*args,**kwargs):
        if name=='supabase':
            pytest.fail('local health imported source SDK')
        return original(name,*args,**kwargs)
    monkeypatch.setattr(builtins,'__import__',checked)
    health.run_health_checks(check_remote=True)
