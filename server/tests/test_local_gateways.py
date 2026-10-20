import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest


def module(name):
    try:
        return importlib.import_module('village_processing.' + name)
    except ImportError:
        pytest.fail('local gateway adapter is missing: ' + name)


class HTTP:
    def __init__(self, kind):
        self.kind, self.worker_id = kind, str(uuid4())
        self.rid, self.lease, self.owner = str(uuid4()), str(uuid4()), str(uuid4())
        self.calls, self.lost = [], False
        self.phase = 'geo' if kind == 'geo' else 'rectification'

    def call(self, action, payload=None):
        self.calls.append((action, payload))
        if action == 'sources':
            return {'villages': [{'workerVillageId': 'mibu'}]}
        if action == 'claim':
            return {'kind': self.kind, 'phase': self.phase, 'leaseToken': self.lease,
                    'leaseUntil': (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat(),
                    'run': {'id': self.rid, 'owner_id': self.owner, 'village_id': 'mibu', 'status': 'claimed' if self.kind == 'geo' else 'claimed_'+self.phase, 'generation_revision': 0,
                            'input': {'requestedSteps': ['buildings'], 'aoi': {'type': 'Polygon'}, 'parameters': {}, 'objectCode': 'B1', 'spaceId': 'A', 'photoId': 1},
                            'photo': {'fileId': str(uuid4()), 'sha256': 'a'*64, 'size': 10, 'mime': 'image/png'}}}
        return {'ok': True}

    def run_call(self, rid, lease, action, payload=None):
        assert (rid, lease) == (self.rid, self.lease)
        self.calls.append((action, payload))
        if self.lost:
            raise RuntimeError('LEASE_LOST')
        return {'cancelRequested': False, 'status': 'queued_rectification'}

    def upload(self, rid, lease, kind, path, mime):
        assert (rid, lease) == (self.rid, self.lease)
        self.calls.append(('upload', kind))
        return {'fileId': str(uuid4()), 'state': 'ready'}

    def download(self, rid, lease, name, dest, **kwargs):
        assert (rid, lease) == (self.rid, self.lease)
        self.calls.append(('download', (name, kwargs)))
        return dest


def test_geo_pipeline_contract_stays_local_and_uses_kind_protocol():
    http = HTTP('geo')
    gateway = module('queue.local_gateway').LocalGeoGateway(http)
    run = gateway.claim(http.worker_id)
    assert run.run_id == http.rid and run.village_id == 'mibu'
    assert run.requested_steps == ('buildings',)
    gateway.heartbeat(http.worker_id, 'available', 'legacy-ignored')
    assert http.calls[-1] == ('heartbeat', {'protocol': 'geo-aliyun-local-v1', 'state': 'idle'})
    gateway.set_running(run.run_id, http.worker_id)
    gateway.set_stage(run.run_id, http.worker_id, 'buildings', 50)
    assert gateway.is_cancel_requested(run.run_id) is False
    assert gateway.list_published_village_ids() == ('mibu',)
    gateway.publish_source_status('not-published', True, None, http.worker_id, [1, 2, 3, 4])
    assert http.calls[-1][0] == 'sources'
    gateway.complete(run.run_id, http.worker_id, ())


def test_facade_pipeline_methods_preserve_photo_and_artifact_identity(tmp_path):
    http = HTTP('facade')
    gateway = module('facade.local_gateway').LocalFacadeGateway(http)
    run = gateway.claim(http.worker_id)
    assert run.phase == 'rectification' and run.object_code == 'B1'
    gateway.set_state(run.run_id, http.worker_id, 'rectifying', stage='downloading_photo', progress=2)
    gateway.download_photo(run, tmp_path/'photo.png')
    assert http.calls[-1][1][1] == {'expected_sha': 'a'*64, 'expected_size': 10}
    gateway.upload_artifact(run, http.worker_id, 'rectification', 'diagnostics', tmp_path/'diagnostics.json', 'application/json', {})
    gateway.publish_rectification(run.run_id, http.worker_id, [])
    with pytest.raises(ValueError, match='ARTIFACT_SCOPE_MISMATCH'):
        gateway.complete_generation(run, http.worker_id, tmp_path/'model.glb', {})
    http.phase, http.lease = 'generation', str(uuid4())
    run = gateway.claim(http.worker_id)
    gateway.download_artifact(run, 'building_mask', tmp_path/'mask.png')
    http.lost = True
    with pytest.raises(RuntimeError, match='LEASE_LOST'):
        gateway.renew(run.run_id, http.worker_id)
    before = len(http.calls)
    with pytest.raises(RuntimeError, match='LEASE_LOST'):
        gateway.assert_lease(run.run_id)
    assert len(http.calls) == before
    http.lost, http.lease = False, str(uuid4())
    run = gateway.claim(http.worker_id)
    gateway.complete_generation(run, http.worker_id, tmp_path/'model.glb', {})
    assert http.calls[-1][0] == 'complete'
