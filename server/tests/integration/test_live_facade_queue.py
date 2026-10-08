import os
import time

import pytest


pytestmark = pytest.mark.live_supabase


REQUIRED = (
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "LIVE_FACADE_EMAIL",
    "LIVE_FACADE_PASSWORD",
    "LIVE_FACADE_COURSE_ID",
    "LIVE_FACADE_SPACE_ID",
    "LIVE_FACADE_OBJECT_CODE",
    "LIVE_FACADE_PHOTO_ID",
)


def _clients():
    if os.environ.get("RUN_LIVE_FACADE") != "1":
        pytest.skip("set RUN_LIVE_FACADE=1 for the live facade acceptance test")
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        pytest.skip("missing explicit live facade variables: " + ", ".join(missing))
    from supabase import create_client

    user = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_PUBLISHABLE_KEY"])
    user.auth.sign_in_with_password({
        "email": os.environ["LIVE_FACADE_EMAIL"],
        "password": os.environ["LIVE_FACADE_PASSWORD"],
    })
    service = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    return user, service


def _wait_for(client, run_id: str, statuses: set[str], timeout: float):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        row = (
            client.table("facade_generation_runs")
            .select("*")
            .eq("id", run_id)
            .single()
            .execute()
            .data
        )
        if row["status"] in statuses:
            return row
        time.sleep(2)
    raise AssertionError(f"facade run {run_id} did not reach {sorted(statuses)}")


def test_real_historical_photo_completes_two_stage_facade_queue():
    user, service = _clients()
    run_id = None
    try:
        result = user.rpc("submit_facade_run", {
            "p_course_id": os.environ["LIVE_FACADE_COURSE_ID"],
            "p_space_id": os.environ["LIVE_FACADE_SPACE_ID"],
            "p_object_code": os.environ["LIVE_FACADE_OBJECT_CODE"],
            "p_photo_id": int(os.environ["LIVE_FACADE_PHOTO_ID"]),
        }).execute()
        run_id = str(result.data)
        rectified = _wait_for(user, run_id, {"awaiting_crop", "failed"}, 600)
        assert rectified["status"] == "awaiting_crop", rectified.get("error_code")

        artifacts = (
            user.table("facade_generation_artifacts")
            .select("artifact_type,storage_path")
            .eq("run_id", run_id)
            .execute()
            .data
        )
        preview = next(item for item in artifacts if item["artifact_type"] == "rectified_preview")
        signed = user.storage.from_("facade-generation").create_signed_url(
            preview["storage_path"], 300
        )
        assert signed.get("signedURL") or signed.get("signedUrl")

        user.rpc("confirm_facade_crop", {
            "p_run_id": run_id,
            "p_crop_top": 0.18,
            "p_roof_type": "gable",
            "p_building_width": 10.0,
            "p_building_depth": 8.0,
        }).execute()
        completed = _wait_for(user, run_id, {"completed", "failed"}, 600)
        assert completed["status"] == "completed", completed.get("error_code")
        artifacts = (
            user.table("facade_generation_artifacts")
            .select("artifact_type,storage_path,size_bytes")
            .eq("run_id", run_id)
            .execute()
            .data
        )
        glb = next(item for item in artifacts if item["artifact_type"] == "building_glb")
        assert glb["size_bytes"] >= 12
        signed = user.storage.from_("facade-generation").create_signed_url(glb["storage_path"], 300)
        assert signed.get("signedURL") or signed.get("signedUrl")
    finally:
        if run_id:
            try:
                user.rpc("request_facade_cancel", {"p_run_id": run_id}).execute()
            except Exception:
                pass
            rows = (
                service.table("facade_generation_artifacts")
                .select("storage_path")
                .eq("run_id", run_id)
                .execute()
                .data
                or []
            )
            paths = [row["storage_path"] for row in rows]
            if paths:
                service.storage.from_("facade-generation").remove(paths)
            service.table("facade_generation_artifacts").delete().eq("run_id", run_id).execute()
            service.table("facade_generation_runs").delete().eq("id", run_id).execute()
        try:
            user.auth.sign_out()
        except Exception:
            pass
