"""Explicit deployment selection. Failure in Aliyun mode never selects source."""
import os


def backend(env=None):
    env = os.environ if env is None else env
    value = env.get('VILLAGE_TASK_BACKEND', 'supabase')
    if value not in ('supabase', 'aliyun'):
        raise ValueError('INVALID_TASK_BACKEND')
    return value


def build_gateway(kind, env=None):
    env = os.environ if env is None else env
    mode = backend(env)
    if kind not in ('geo', 'facade'):
        raise ValueError('INVALID_WORKER_KIND')
    if mode == 'aliyun':
        from .local_task_http import LocalTaskHTTP, ORIGIN
        http = LocalTaskHTTP(kind=kind, key_file=env.get('VILLAGE_WORKER_KEY_FILE', ''), origin=env.get('VILLAGE_LOCAL_ORIGIN', ORIGIN))
        if kind == 'geo':
            from .queue.local_gateway import LocalGeoGateway
            return LocalGeoGateway(http)
        from .facade.local_gateway import LocalFacadeGateway
        return LocalFacadeGateway(http)
    from supabase import create_client
    client = create_client(env['SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
    if kind == 'geo':
        from .queue.gateway import SupabaseGateway
        return SupabaseGateway(client)
    from .facade.gateway import FacadeGateway
    return FacadeGateway(client)
