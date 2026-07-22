from uuid import uuid4

from village_processing.queue.gateway import SupabaseGateway


RUN_ID = str(uuid4())
OWNER_ID = str(uuid4())
AOI = {"type": "Polygon", "coordinates": [[[113.66, 23.67], [113.67, 23.67], [113.67, 23.68], [113.66, 23.68], [113.66, 23.67]]]}


class Result:
    def __init__(self, data):
        self.data = data


class FakeCall:
    def __init__(self, client, name, payload):
        self.client, self.name, self.payload = client, name, payload

    def execute(self):
        self.client.calls.append((self.name, self.payload))
        return Result(self.client.rpc_results.get(self.name, []))


class FakeSupabase:
    def __init__(self):
        self.calls = []
        self.rpc_results = {}

    def rpc(self, name, payload):
        return FakeCall(self, name, payload)


def test_claim_maps_rpc_payload_to_queued_run():
    client = FakeSupabase()
    client.rpc_results["claim_next_geoprocessing_run"] = [{
        "id": RUN_ID,
        "owner_id": OWNER_ID,
        "village_id": "mibu",
        "requested_steps": ["contours"],
        "aoi": AOI,
        "parameters": {"contour_interval": 5, "contour_smoothing": 1},
    }]

    run = SupabaseGateway(client).claim("win11-pilot")

    assert run.run_id == RUN_ID
    assert run.owner_id == OWNER_ID
    assert run.village_id == "mibu"


def test_fail_redacts_local_paths_and_urls():
    client = FakeSupabase()

    SupabaseGateway(client).fail(
        RUN_ID,
        "win11-pilot",
        "SOURCE_RASTER_INVALID",
        r"E:\secret\dem.tif failed at https://example.supabase.co/path",
    )

    name, payload = client.calls[-1]
    assert name == "set_geoprocessing_run_state"
    assert "E:\\" not in payload["p_error_message"]
    assert "https://" not in payload["p_error_message"]
