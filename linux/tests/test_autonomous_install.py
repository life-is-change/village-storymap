import importlib.util
from pathlib import Path
import sys

S=Path(__file__).resolve().parents[1]/'scripts';sys.path.insert(0,str(S))


def test_single_flow_has_real_hidden_probe_before_gated_public_switch():
    path=S/'install-autonomous-handoff.py';spec=importlib.util.spec_from_file_location('single_install_test',path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    steps=m.steps(Path('/private/received'),{'archive_filename':'village-autonomous-fixture.tar.gz'})
    assert len(steps)==8
    assert steps[-2][0].name=='probe-autonomous.py'
    assert steps[-1][0].name=='deploy-autonomous.py' and steps[-1][-1]=='--apply'
    assert '--issue' in steps[2] and '--deploy' in steps[4] and '--verify' in steps[5]
    assert all('supabase' not in ' '.join(map(str,row)) for row in steps)
