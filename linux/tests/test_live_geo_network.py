import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify-live-geo-network.py"
SPEC = importlib.util.spec_from_file_location("verify_live_geo_network", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def inspect_payload(geo_networks, building_networks):
    return json.dumps([
        {"Name": "village-platform-geo-worker-1", "State": {"Status": "running"},
         "NetworkSettings": {"Networks": {name: {} for name in geo_networks}}},
        {"Name": "village-platform-building-1", "State": {"Status": "running"},
         "NetworkSettings": {"Networks": {name: {} for name in building_networks}}},
    ])


def test_running_geo_worker_must_share_backend_with_building():
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if args[1] == "inspect":
            return subprocess.CompletedProcess(args, 0, inspect_payload(
                ["village-platform_egress"], ["village-platform_backend"]), "")
        raise AssertionError("Ready probe must not run with a disconnected worker")

    with pytest.raises(RuntimeError, match="backend"):
        MODULE.verify_live_geo_network(run=run)
    assert len(calls) == 1


def test_running_geo_worker_checks_building_ready_from_its_own_network_namespace():
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if args[1] == "inspect":
            return subprocess.CompletedProcess(args, 0, inspect_payload(
                ["village-platform_backend", "village-platform_egress"],
                ["village-platform_backend"]), "")
        return subprocess.CompletedProcess(args, 0, "building ready: 200\n", "")

    assert MODULE.verify_live_geo_network(run=run) == "building ready: 200"
    assert calls[1][0:3] == ["docker", "exec", "village-platform-geo-worker-1"]
    assert "http://building:8021/ready" in calls[1][-1]
