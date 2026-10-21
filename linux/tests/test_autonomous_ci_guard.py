import os
from pathlib import Path
import subprocess
import sys


def test_complete_coordinator_fixture_refuses_non_github_environment_before_any_engine_call():
    script=Path(__file__).resolve().parents[1]/'scripts/test-autonomous-deployment-ci.py'
    assert script.is_file()
    env={**os.environ,'GITHUB_ACTIONS':'false','VILLAGE_TEST_AUTONOMOUS_RUNTIME':'0'}
    result=subprocess.run([sys.executable,str(script)],env=env,capture_output=True,text=True,timeout=5)
    assert result.returncode!=0
    assert 'DISPOSABLE_AUTONOMOUS_COORDINATOR_REQUIRED' in result.stderr+result.stdout
