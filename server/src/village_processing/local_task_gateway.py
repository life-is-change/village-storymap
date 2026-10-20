"""Pipeline-neutral local lease bookkeeping, never a source queue bridge."""
from datetime import datetime, timezone
import re
from threading import RLock
import time
from uuid import uuid4

from .local_task_http import uuid


def safe_code(value, fallback='PROCESSING_FAILED'):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z0-9_]{1,80}', value) else fallback


class LocalGateway:
    def __init__(self, http, kind):
        if http.kind != kind:
            raise ValueError('WORKER_KIND_MISMATCH')
        self.http, self.worker_id, self.kind = http, http.worker_id, kind
        self._lock, self._leases, self._lost, self._finished = RLock(), {}, set(), {}

    def _worker(self, worker_id):
        if worker_id != self.worker_id:
            raise ValueError('WORKER_ID_MISMATCH')

    @staticmethod
    def _deadline(value):
        try:
            until = datetime.fromisoformat(value.replace('Z', '+00:00'))
            remaining = (until - datetime.now(timezone.utc)).total_seconds()
            if remaining <= 0:
                raise ValueError()
            return time.monotonic() + min(120, remaining)
        except (ValueError, TypeError, AttributeError):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE') from None

    def _claim(self, worker_id):
        self._worker(worker_id)
        result = self.http.call('claim', {'requestId': str(uuid4())})
        if result.get('run') is None:
            return None
        row = result['run']
        if result.get('kind') != self.kind or not isinstance(row, dict) or not uuid(row.get('id')) or not uuid(row.get('owner_id')) or not uuid(result.get('leaseToken')) or not isinstance(row.get('input'), dict):
            raise RuntimeError('INVALID_GATEWAY_RESPONSE')
        lease = {'token': result['leaseToken'], 'deadline': self._deadline(result.get('leaseUntil')), 'row': row, 'phase': result.get('phase')}
        with self._lock:
            self._leases[row['id']] = lease
            self._lost.discard(row['id'])
            self._finished.pop(row['id'], None)
        return row

    def _lease(self, run_id):
        with self._lock:
            lease = self._leases.get(run_id)
            if run_id in self._lost or not lease or lease['deadline'] <= time.monotonic():
                self._lost.add(run_id)
                raise RuntimeError('LEASE_LOST')
            return lease

    def assert_lease(self, run_id):
        self._lease(run_id)

    def _call(self, run_id, action, payload=None):
        lease = self._lease(run_id)
        try:
            return self.http.run_call(run_id, lease['token'], action, payload)
        except RuntimeError as error:
            if str(error) in ('LEASE_LOST', 'UNAUTHORIZED', 'FORBIDDEN'):
                with self._lock:
                    self._lost.add(run_id)
            raise

    def renew(self, run_id, worker_id):
        self._worker(worker_id)
        with self._lock:
            if run_id in self._finished:
                return
        result = self._call(run_id, 'renew', {})
        deadline = self._deadline(result.get('leaseUntil'))
        with self._lock:
            self._leases[run_id]['deadline'] = deadline

    def heartbeat(self, worker_id, state, version):
        self._worker(worker_id)
        mapped = {'available': 'idle', 'idle': 'idle', 'busy': 'busy', 'error': 'error', 'starting': 'starting'}.get(state)
        if mapped is None:
            raise ValueError('INVALID_WORKER_STATE')
        self.http.call('heartbeat', {'protocol': self.kind+'-aliyun-local-v1', 'state': mapped})

    def is_cancel_requested(self, run_id):
        return self._call(run_id, 'cancel-status', {}).get('cancelRequested') is True

    def _finish(self, run_id, action, payload):
        with self._lock:
            if self._finished.get(run_id) == action:
                return {'ok': True}
        result = self._call(run_id, action, payload)
        with self._lock:
            self._finished[run_id] = action
        return result

    def cancel(self, run_id, worker_id):
        self._worker(worker_id)
        return self._finish(run_id, 'cancel', {})

    def fail(self, run_id, worker_id, error_code, message):
        self._worker(worker_id)
        return self._finish(run_id, 'fail', {'errorCode': safe_code(error_code)})

    def retry_or_fail(self, run_id, worker_id, code, message):
        self._worker(worker_id)
        return self._finish(run_id, 'retry-failure', {'errorCode': safe_code(code)}).get('status', '')
