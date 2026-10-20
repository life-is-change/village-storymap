from ..local_task_gateway import LocalGateway, safe_code
from ..local_task_http import hash_file
from .models import QueuedRun


class LocalGeoGateway(LocalGateway):
    def __init__(self, http):
        super().__init__(http, 'geo')
        self._published = set()

    def claim(self, worker_id):
        row = self._claim(worker_id)
        if row is None:
            return None
        value = row['input']
        if self._lease(row['id'])['phase'] != 'geo' or not isinstance(row.get('village_id'), str) or not isinstance(value.get('requestedSteps'), list):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        return QueuedRun.from_row({**row, 'requested_steps': value['requestedSteps'], 'aoi': value['aoi'], 'parameters': value.get('parameters', {})})

    def set_running(self, run_id, worker_id):
        self.set_stage(run_id, worker_id, 'starting', 1)

    def set_stage(self, run_id, worker_id, stage, progress):
        self._worker(worker_id)
        self._call(run_id, 'progress', {'state': 'running', 'stage': stage, 'progress': min(99, max(1, progress))})

    def complete(self, run_id, worker_id, warnings):
        self._worker(worker_id)
        self._finish(run_id, 'complete', {'warnings': [safe_code(w, 'PROCESSING_WARNING') for w in warnings[:20]]})

    def upload_artifact(self, owner_id, run_id, worker_id, summary):
        self._worker(worker_id)
        lease = self._lease(run_id)
        if lease['row']['owner_id'] != owner_id or summary.artifact_type not in ('buildings', 'roads', 'waterways', 'water_areas', 'contours'):
            raise ValueError('ARTIFACT_SCOPE_MISMATCH')
        if hash_file(summary.path)[1] != summary.sha256:
            raise ValueError('RESULT_FILE_CHANGED')
        return self.http.upload(run_id, lease['token'], summary.artifact_type, summary.path, 'application/geo+json')['fileId']

    def list_published_village_ids(self):
        rows = self.http.call('sources').get('villages')
        if not isinstance(rows, list) or len(rows)>10000 or any(not isinstance(r, dict) or not isinstance(r.get('workerVillageId'), str) for r in rows):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        self._published = {row['workerVillageId'] for row in rows}
        return tuple(sorted(self._published))

    def publish_source_status(self, village_id, ready, code, worker_id, bounds):
        self._worker(worker_id)
        if village_id not in self._published:
            return  # Do not disclose unconfigured campus datasets.
        self.http.call('source-status', {'villageId': village_id, 'ready': ready, 'errorCode': None if ready else safe_code(str(code).upper(), 'SOURCE_NOT_READY'), 'bounds': bounds})
