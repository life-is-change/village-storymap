"""Publish a path-free snapshot of locally available inputs."""


def publish_source_statuses(catalog, gateway, worker_id: str) -> None:
    village_ids = set(catalog.village_ids())
    village_ids.update(gateway.list_published_village_ids())
    for village_id in sorted(village_ids):
        code = catalog.status(village_id)
        ready = code == "ready"
        bounds = catalog.bounds(village_id) if ready else None
        gateway.publish_source_status(
            village_id, ready, None if ready else code, worker_id,
            list(bounds) if bounds else None,
        )
