from pathlib import Path
import importlib.util
import yaml

ROOT = Path(__file__).resolve().parents[2]

def test_six_services_keep_workers_private_and_existing_paths_configurable():
    doc = yaml.safe_load((ROOT / 'linux/compose.gpu.yaml').read_text('utf-8'))
    services = doc['services']
    assert set(services) == {'web', 'building', 'geo-worker', 'facade-ml', 'facade-lama', 'facade-worker'}
    assert services['web']['ports'] == ['${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}:80']
    assert 'env_file' not in services['web']
    for name, service in services.items():
        assert service['restart'] == 'unless-stopped'
        assert (ROOT / service['build']['dockerfile']).is_file()
        if name != 'web':
            assert 'ports' not in service
            for mount in service.get('volumes', []):
                assert mount['source'].startswith('${')
                assert mount['bind']['create_host_path'] is False
    for name in ('geo-worker', 'facade-worker'):
        assert services[name]['env_file'] == ['${WORKER_ENV_FILE:-/etc/village-platform/worker.env}']
    for name in ('building', 'facade-ml'):
        assert services[name]['deploy']['resources']['reservations']['devices'][0]['capabilities'] == ['gpu']

def test_web_staging_excludes_secrets_and_includes_cesium_and_csv(tmp_path):
    spec = importlib.util.spec_from_file_location('stage_web', ROOT / 'linux/scripts/stage-web.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source, target = tmp_path / 'source', tmp_path / 'public'
    files = ['index.html', 'app.js', 'homepage/dist/index.html', 'features/auth/config.js',
             'data/houses.csv', 'assets/vendor/cesium-1.118.0/Assets/Textures/NaturalEarthII/tilemapresource.xml',
             '.env', 'server/.env', 'homepage/dist/.env', 'features/auth/config.test.js',
             'rural_house_generator/backend/app/main.py', 'assets/private.key', 'data/customer.csv']
    for name in files:
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('sample')
    module.stage(source, target)
    for name in files[:6]:
        assert (target / name).is_file(), name
    for name in files[6:]:
        assert not (target / name).exists(), name
