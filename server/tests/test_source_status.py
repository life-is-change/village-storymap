from village_processing.source_status import publish_source_statuses


class Catalog:
    def village_ids(self):
        return ("mibu-id",)

    def status(self, village_id):
        return "ready" if village_id == "mibu-id" else "LOCAL_SOURCE_NOT_REGISTERED"

    def bounds(self, village_id):
        return (113.0, 23.0, 114.0, 24.0) if village_id == "mibu-id" else None


class Gateway:
    def __init__(self):
        self.published = []

    def list_published_village_ids(self):
        return ("mibu-id", "hongxing-id")

    def publish_source_status(self, village_id, ready, code, worker_id, bounds):
        self.published.append((village_id, ready, code, worker_id, bounds))


def test_publishes_local_and_unregistered_villages_without_paths():
    gateway = Gateway()
    publish_source_statuses(Catalog(), gateway, "worker-1")
    assert gateway.published == [
        ("hongxing-id", False, "LOCAL_SOURCE_NOT_REGISTERED", "worker-1", None),
        ("mibu-id", True, None, "worker-1", [113.0, 23.0, 114.0, 24.0]),
    ]
