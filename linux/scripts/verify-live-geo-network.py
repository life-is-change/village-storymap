#!/usr/bin/env python3
"""Check the live Geo Worker container, not a one-off Compose test container."""

import json
import subprocess
import sys


GEO = "village-platform-geo-worker-1"
BUILDING = "village-platform-building-1"


def verify_live_geo_network(run=subprocess.run):
    inspected = run(["docker", "inspect", GEO, BUILDING], check=True,
                    capture_output=True, text=True, timeout=30)
    containers = {item["Name"].lstrip("/"): item for item in json.loads(inspected.stdout)}
    geo = containers[GEO]
    building = containers[BUILDING]
    if geo["State"]["Status"] != "running" or building["State"]["Status"] != "running":
        raise RuntimeError("Geo Worker and building containers must both be running")
    geo_networks = set(geo["NetworkSettings"]["Networks"])
    building_networks = set(building["NetworkSettings"]["Networks"])
    backend = {name for name in building_networks if name.endswith("_backend")}
    if not backend or not backend.issubset(geo_networks):
        raise RuntimeError("Geo Worker is not connected to the building backend network")
    if not any(name.endswith("_egress") for name in geo_networks):
        raise RuntimeError("Geo Worker has no egress network for Supabase")

    probe = run(["docker", "exec", GEO, "python", "-c",
                 "import httpx; r=httpx.get('http://building:8021/ready', timeout=20, trust_env=False); "
                 "r.raise_for_status(); print('building ready:', r.status_code)"],
                check=True, capture_output=True, text=True, timeout=30)
    return probe.stdout.strip()


if __name__ == "__main__":
    try:
        print(verify_live_geo_network())
    except (KeyError, ValueError, RuntimeError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as exc:
        print(f"LIVE_GEO_NETWORK_FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
