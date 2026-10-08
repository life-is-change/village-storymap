import os

import pytest


pytestmark = pytest.mark.live_supabase


def live_client():
    if os.environ.get("RUN_LIVE_SUPABASE") != "1":
        pytest.skip("set RUN_LIVE_SUPABASE=1 for the live project contract test")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("live Supabase URL and service-role key are not configured")
    from supabase import create_client

    return create_client(url, key)


def test_live_queue_rpc_and_private_bucket_exist():
    client = live_client()

    availability = client.rpc("get_worker_availability", {}).execute().data
    bucket = client.storage.get_bucket("geoprocessing-results")

    assert availability is not None
    assert bucket is not None
    assert getattr(bucket, "public", False) is False


def test_live_local_source_status_rpc_is_available():
    client = live_client()
    village_id = os.environ.get("LIVE_MIBU_VILLAGE_ID", "00000000-0000-4000-8000-000000000001")
    rows = client.rpc("get_geoprocessing_source_status", {"p_village_id": village_id}).execute().data
    status = rows[0] if isinstance(rows, list) and rows else rows
    assert status is not None
    assert status["state"] in ("ready", "missing", "stale", "offline")
    assert status["max_aoi_sq_km"] == 2
    assert "path" not in status
