from pathlib import Path
import yaml

ROOT=Path(__file__).resolve().parents[2]


def test_autonomous_overlay_only_changes_the_two_workers_and_keeps_gpu_services_and_egress():
    path=ROOT/'linux/compose.gpu.aliyun.yaml'
    assert path.is_file()
    overlay=yaml.safe_load(path.read_text('utf-8'))
    base=yaml.safe_load((ROOT/'linux/compose.gpu.yaml').read_text('utf-8'))
    assert set(overlay['services'])=={'geo-worker','facade-worker'}
    for name,service in overlay['services'].items():
        assert not set(service)&{'ports','networks','depends_on','command','user','deploy'}
        assert 'egress' in base['services'][name]['networks']
        assert service['environment']['VILLAGE_TASK_BACKEND']=='aliyun'
        assert service['environment']['VILLAGE_LOCAL_ORIGIN']=='https://8.148.248.237'
        assert service['environment']['SUPABASE_URL']==''
        assert service['environment']['SUPABASE_SERVICE_ROLE_KEY']==''
        assert service['build']['dockerfile']=='linux/Dockerfile.worker-local-overlay'
        assert set(service['build']['args'])=={'BASE_IMAGE'}
        mounts=service['volumes']
        assert len(mounts)==1 and mounts[0]['read_only'] is True
        assert mounts[0]['bind']['create_host_path'] is False
        assert mounts[0]['target']=='/run/secrets/aliyun-worker-key'
    docker=(ROOT/'linux/Dockerfile.worker-local-overlay').read_text('utf-8')
    assert 'COPY server/src/village_processing ' in docker
    assert 'pip install' not in docker and 'apt-get' not in docker and 'RUN ' not in docker
