from village_processing.facade.models import FacadeRun


def test_completed_facade_run_accepts_a_detached_source_photo():
    run = FacadeRun.from_row({
        "id": "run-1",
        "owner_id": "user-1",
        "photo_id": None,
        "object_code": "B-1",
        "space_id": "current",
        "status": "completed",
        "generation_revision": 2,
        "source_photo_path": "project/village/current/building/B-1_source.jpg",
    })

    assert run.photo_id is None
    assert run.source_photo_path == "project/village/current/building/B-1_source.jpg"
