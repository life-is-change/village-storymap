from ..local_task_gateway import LocalGateway
from .models import FacadeRun


class LocalFacadeGateway(LocalGateway):
    def __init__(self, http):
        super().__init__(http, 'facade')

    def claim(self, worker_id):
        row = self._claim(worker_id)
        if row is None:
            return None
        value, photo, crop = row['input'], row.get('photo'), row.get('crop') or {}
        if not isinstance(photo, dict) or self._lease(row['id'])['phase'] not in ('rectification', 'generation'):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        return FacadeRun.from_row({**row, 'photo_id': value.get('photoId'), 'object_code': value['objectCode'], 'space_id': value['spaceId'],
                                  'source_photo_path': photo['fileId'], 'source_photo_url': None, 'source_photo_bucket': 'local',
                                  'origin_instance_id': 'aliyun-local', 'source_photo_sha256': photo['sha256'], 'source_photo_size': photo['size'], 'source_photo_mime': photo['mime'],
                                  'crop_top': crop.get('cropTop'), 'roof_type': crop.get('roofType'), 'building_width': crop.get('buildingWidth'), 'building_depth': crop.get('buildingDepth')})

    def set_state(self, run_id, worker_id, status, *, stage=None, progress=None, error_code=None, error_message=None):
        self._worker(worker_id)
        if status not in ('rectifying', 'generating'):
            raise ValueError('INVALID_WORKER_STATE')
        self._call(run_id, 'progress', {'state': status, 'stage': stage, 'progress': min(99, max(1, progress or 1))})

    def download_photo(self, run, destination):
        lease = self._lease(run.run_id)
        return self.http.download(run.run_id, lease['token'], 'input', destination, expected_sha=run.source_photo_sha256, expected_size=run.source_photo_size)

    def download_artifact(self, run, artifact_type, destination):
        lease = self._lease(run.run_id)
        return self.http.download(run.run_id, lease['token'], artifact_type, destination)

    def upload_artifact(self, run, worker_id, phase, artifact_type, source_path, content_type, source):
        self._worker(worker_id)
        lease = self._lease(run.run_id)
        if phase != lease['phase'] or run.owner_id != lease['row']['owner_id']:
            raise ValueError('ARTIFACT_SCOPE_MISMATCH')
        return self.http.upload(run.run_id, lease['token'], artifact_type, source_path, content_type)['fileId']

    def publish_rectification(self, run_id, worker_id, artifacts):
        self._worker(worker_id)
        return self._finish(run_id, 'publish-rectification', {})

    def complete_generation(self, run, worker_id, model_path, source):
        self._worker(worker_id)
        lease = self._lease(run.run_id)
        if lease['phase'] != 'generation':
            raise ValueError('ARTIFACT_SCOPE_MISMATCH')
        result = self.http.upload(run.run_id, lease['token'], 'building_glb', model_path, 'model/gltf-binary')
        self._finish(run.run_id, 'complete', {})
        return result['fileId']
