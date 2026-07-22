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
