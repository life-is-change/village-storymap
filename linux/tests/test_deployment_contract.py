from pathlib import Path
import re

import yaml


ROOT = Path(__file__).resolve().parents[2]
LINUX_ROOT = ROOT / "linux"
EXPECTED_FILES = {
    "README.md",
    "compose.yaml",
    "Dockerfile.geo",
    "Dockerfile.geo.dockerignore",
    "Dockerfile.building",
    "Dockerfile.building.dockerignore",
    "requirements-building.txt",
    "Dockerfile.facade-worker",
    "Dockerfile.facade-ml",
    "Dockerfile.facade-lama",
    "requirements-facade-worker.txt",
    "requirements-facade-ml.txt",
    "requirements-facade-lama.txt",
    ".env.example",
    "scripts/check-host.sh",
    "scripts/verify-deployment.sh",
    "systemd/village-platform.service",
}


def read(relative: str) -> str:
    return (LINUX_ROOT / relative).read_text("utf-8")


def load_compose() -> dict:
    return yaml.safe_load(read("compose.yaml"))


def volume_map(service: dict) -> dict[str, dict]:
    return {item["target"]: item for item in service["volumes"]}


def test_linux_deployment_package_contains_every_operator_artifact():
    missing = sorted(name for name in EXPECTED_FILES if not (LINUX_ROOT / name).is_file())
    assert not missing, f"missing Linux deployment files: {missing}"


def test_compose_keeps_building_private_and_worker_outbound_only():
    compose = load_compose()
    building = compose["services"]["building"]
    worker = compose["services"]["geo-worker"]

    assert set(compose["services"]) == {
        "building", "geo-worker", "facade-worker", "facade-ml", "facade-lama"
    }
    assert compose["services"]["building"]["image"].startswith(
        "village-building-worker:${IMAGE_TAG:?")
    assert compose["services"]["geo-worker"]["image"].startswith(
        "village-geo-worker:${IMAGE_TAG:?")
    assert "linux-20260723" not in read("compose.yaml")
    assert "ports" not in building
    assert "ports" not in worker
    assert building["restart"] == "unless-stopped"
    assert worker["restart"] == "unless-stopped"
    assert compose["networks"]["backend"]["internal"] is True
    assert building["networks"] == ["backend"]
    assert worker["networks"] == ["backend", "egress"]
    assert worker["depends_on"]["building"]["condition"] == "service_healthy"
    assert "/ready" in building["healthcheck"]["test"][-1]
    assert "timeout=170" in building["healthcheck"]["test"][-1]
    assert building["healthcheck"]["timeout"] == "180s"
    assert "env_file" not in building
    assert worker["env_file"] == ["/etc/village-platform/worker.env"]


def test_facade_services_are_private_least_privilege_and_share_work():
    compose = load_compose()
    services = compose["services"]
    worker = services["facade-worker"]
    model = services["facade-ml"]
    lama = services["facade-lama"]

    assert "ports" not in worker
    assert "ports" not in model
    assert "ports" not in lama
    assert worker["environment"]["BLENDER_EXECUTABLE"] == "/usr/bin/blender"
    assert worker["environment"]["PLATFORM_GPU_LOCK_PATH"] == "/work/.locks/gpu-0.lock"
    assert model["environment"]["PLATFORM_GPU_LOCK_PATH"] == "/work/.locks/gpu-0.lock"
    assert worker["networks"] == ["facade-internal", "egress"]
    assert model["networks"] == ["facade-internal"]
    assert lama["networks"] == ["facade-internal"]
    assert compose["networks"]["facade-internal"]["internal"] is True
    assert worker["depends_on"]["facade-ml"]["condition"] == "service_healthy"
    assert worker["depends_on"]["facade-lama"]["condition"] == "service_healthy"

    mounts = [volume_map(service) for service in (worker, model, lama)]
    assert all(item["/work"]["source"] == "/var/lib/village-platform/runtime" for item in mounts)
    assert mounts[1]["/models"]["read_only"] is True
    assert mounts[2]["/models"]["read_only"] is True
    assert "SUPABASE_SERVICE_ROLE_KEY" not in str(model)
    assert "SUPABASE_SERVICE_ROLE_KEY" not in str(lama)
    assert worker["env_file"] == ["/etc/village-platform/worker.env"]
    assert "env_file" not in model
    assert "env_file" not in lama
    assert "network_mode" not in worker
    assert "network_mode" not in model
    assert "network_mode" not in lama


def test_facade_images_pin_blender_and_model_runtimes():
    worker = read("Dockerfile.facade-worker")
    model = read("Dockerfile.facade-ml")
    lama = read("Dockerfile.facade-lama")

    assert "blender=3.0.1+dfsg-7" in worker
    assert "BLENDER_EXECUTABLE=/usr/bin/blender" in worker
    assert "python -m village_processing facade-worker" in worker
    assert "torch==2.5.1" in read("requirements-facade-ml.txt")
    assert "torchvision==0.20.1" in read("requirements-facade-ml.txt")
    assert "simple-lama-inpainting==0.1.2" in read("requirements-facade-lama.txt")
    for dockerfile in (worker, model, lama):
        assert "USER 10001:10001" in dockerfile
        assert "COPY . " not in dockerfile
        assert "COPY server/.env" not in dockerfile


def test_compose_uses_identical_work_mounts_and_read_only_data_mounts():
    services = load_compose()["services"]
    building_volumes = volume_map(services["building"])
    worker_volumes = volume_map(services["geo-worker"])

    for volumes in (building_volumes, worker_volumes):
        assert volumes["/data"]["source"] == "/srv/village-platform/data"
        assert volumes["/data"]["read_only"] is True
        assert volumes["/work"]["source"] == "/var/lib/village-platform/runtime"
    assert building_volumes["/work"] == worker_volumes["/work"]


def test_only_building_service_reserves_one_gpu():
    services = load_compose()["services"]
    devices = services["building"]["deploy"]["resources"]["reservations"]["devices"]

    assert devices == [{"driver": "nvidia", "count": 1, "capabilities": ["gpu"]}]
    assert "deploy" not in services["geo-worker"]


def test_containers_are_unprivileged_read_only_and_log_bounded():
    services = load_compose()["services"]

    for service in services.values():
        assert service["user"] == "10001:10001"
        assert service["read_only"] is True
        assert service["cap_drop"] == ["ALL"]
        assert service["security_opt"] == ["no-new-privileges:true"]
        assert any(item.startswith("/tmp:") for item in service["tmpfs"])
        assert service["logging"] == {
            "driver": "local",
            "options": {"max-size": "20m", "max-file": "5"},
        }


def test_dockerfiles_pin_linux_runtime_and_copy_only_server_package_inputs():
    building = read("Dockerfile.building")
    geo = read("Dockerfile.geo")
    building_requirements = read("requirements-building.txt")

    assert building.startswith("FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04")
    for required in (
        "torch==2.0.1",
        "torchvision==0.15.2",
        "mmcv-full==1.7.2",
        "https://download.pytorch.org/whl/cu118",
        "https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html",
        "USER 10001:10001",
    ):
        assert required in building

    assert geo.startswith("FROM ubuntu:22.04")
    assert "Miniforge3-26.3.2-2-Linux-x86_64.sh" in geo
    assert "42260ffe3830fb953d5eee1bbb32229ff06aa7c3833c1ed7a9a0420a95685d94" in geo
    assert "server/environment/platform_geo_worker.yml" in geo
    assert "USER 10001:10001" in geo

    for dockerfile in (building, geo):
        assert "COPY . " not in dockerfile
        assert "COPY server/.env" not in dockerfile
        assert "COPY server/runtime" not in dockerfile
        assert "HOME=/tmp/village-home" in dockerfile
        assert "XDG_CACHE_HOME=/tmp/village-cache" in dockerfile

    assert "opencv-python==4.8.1.78" in building_requirements
    assert "opencv-python-headless" not in building_requirements
    assert "python3 -m pip check" in building


def test_dockerignore_files_exclude_secrets_data_models_and_runtime():
    for name in ("Dockerfile.geo.dockerignore", "Dockerfile.building.dockerignore"):
        ignored = read(name)
        for required in (
            ".git",
            "**/.env",
            "server/runtime",
            "*.pth",
            "*.pbf",
            "*.tif",
            "*.tif.ovr",
            "node_modules",
        ):
            assert required in ignored


def test_environment_template_uses_container_paths_and_no_real_secret():
    template = read(".env.example")

    for required in (
        "PLATFORM_DATA_ROOT=/data",
        "PLATFORM_WORK_ROOT=/work",
        "PLATFORM_CATALOG=/app/server/config/villages.yaml",
        "BUILDING_SERVICE_URL=http://building:8021",
        "WORKER_ID=linux-rtx4090-01",
        "IMAGE_TAG=replace-with-full-git-commit",
        "SUPABASE_URL=https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=replace-on-server",
    ):
        assert required in template
    assert not re.search(r"SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ", template)
    assert not re.search(r"(?i)\b[a-z]:\\", template)


def test_shell_scripts_are_strict_and_never_dump_the_secret_file():
    check_host = read("scripts/check-host.sh")
    verify = read("scripts/verify-deployment.sh")

    for script in (check_host, verify):
        assert script.startswith("#!/usr/bin/env bash\nset -Eeuo pipefail")
        assert "cat /etc/village-platform/worker.env" not in script
        assert "printenv" not in script
        assert "env |" not in script

    for required in (
        "docker compose version",
        "nvidia-smi",
        "nvidia/cuda:11.8.0-base-ubuntu22.04",
        "geoprocessing-results",
        "广东省_哥白尼DEM.tif.ovr",
        "guangdong-260721.osm.pbf",
    ):
        assert required in check_host
    assert "DATA_ROOT=/srv/village-platform/data" in check_host
    assert "WORK_ROOT=/var/lib/village-platform/runtime" in check_host
    assert "DATA_ROOT=${DATA_ROOT:-" not in check_host
    assert "WORK_ROOT=${WORK_ROOT:-" not in check_host
    assert 'docker compose --env-file "${ENV_FILE}"' in check_host
    assert 'docker compose --env-file "${ENV_FILE}"' in verify
    assert "--user 10001:10001" in check_host
    assert '--volume "${WORK_ROOT}:/work"' in check_host
    assert 'mktemp "${WORK_ROOT}/.preflight.' not in check_host
    assert 'git -C "${REPO_ROOT}" rev-parse HEAD' in check_host
    assert 'git -C "${REPO_ROOT}" status --porcelain' in check_host
    assert 'configured_image_tag' in check_host

    for required in (
        "compose ps",
        "village_processing health",
        "village_processing osm",
        "roads.geojson",
        "torch.cuda.is_available()",
        "from mmcv.ops import nms",
        "httpx.post",
        "http://building:8021/process",
        'payload.get("type") != "FeatureCollection"',
        'if not payload["features"]',
    ):
        assert required in verify
    assert "compose run --rm --no-deps" in verify
    assert "compose exec -T geo-worker" not in verify
    assert "village_processing.building.smoke" not in verify


def test_systemd_unit_controls_the_fixed_compose_project():
    unit = read("systemd/village-platform.service")

    for required in (
        "Requires=docker.service",
        "After=docker.service network-online.target",
        "Type=oneshot",
        "RemainAfterExit=yes",
        "WorkingDirectory=/opt/village-storymap/linux",
        "ExecStart=/usr/bin/docker compose --env-file /etc/village-platform/worker.env up -d --remove-orphans",
        "ExecStop=/usr/bin/docker compose --env-file /etc/village-platform/worker.env stop",
        "WantedBy=multi-user.target",
    ):
        assert required in unit


def test_readme_covers_install_cutover_operations_and_rollback():
    readme = read("README.md")

    for heading in (
        "## Architecture",
        "## Prerequisites",
        "## Create Host Directories",
        "## Transfer and Verify Data",
        "## Configure Secrets",
        "## Build and Start",
        "## Verify the Deployment",
        "## Supabase Canary",
        "## Zero-Loss Cutover",
        "## Routine Operations",
        "## Upgrade",
        "## Roll Back to Windows",
        "## Troubleshooting",
    ):
        assert heading in readme

    assert "Do not publish port `8021`" in readme
    assert "Do not commit" in readme
    assert "service-role" in readme
    assert "pause" in readme.lower()
    assert "drain" in readme.lower()
    assert "canary" in readme.lower()
    assert "select public.set_geoprocessing_queue_paused(true);" in readme
    assert "select public.set_geoprocessing_queue_paused(false);" in readme
    assert "sudo git clone --branch codex/facade-linux-worker" in readme
    assert "IMAGE_TAG" in readme
    assert "--env-file /etc/village-platform/worker.env" in readme
    build_section = readme.split("## Build and Start", 1)[1].split("## Verify the Deployment", 1)[0]
    assert "up -d building" in build_section
    assert "up -d --remove-orphans" not in build_section
    assert "systemctl enable --now" not in build_section
    assert readme.index("systemctl enable --now") > readme.index("## Zero-Loss Cutover")
    canary_section = readme.split("## Supabase Canary", 1)[1].split("## Zero-Loss Cutover", 1)[0]
    assert canary_section.index("set_geoprocessing_queue_paused(true)") < canary_section.index(
        "where status in")


def test_facade_operations_are_installable_verifiable_and_reversible():
    combined = "\n".join([
        read("README.md"),
        read("scripts/check-host.sh"),
        read("scripts/verify-deployment.sh"),
        (ROOT / "server/docs/supabase-worker-operations.md").read_text("utf-8"),
    ])
    for required in (
        "codex/facade-linux-worker",
        "/srv/village-platform/models",
        "/var/lib/village-platform/runtime",
        "/etc/village-platform/worker.env",
        "Facade Generation Worker Queue.sql",
        "docker compose",
        "build",
        "up -d",
        "Blender 3.0.1",
        "awaiting_crop",
        "rollback",
    ):
        assert required in combined

    check_host = read("scripts/check-host.sh")
    for required in ("RTX 4090", "facade-generation", "house-photos", "sam2.1_hiera_large.pt"):
        assert required in check_host
    verify = read("scripts/verify-deployment.sh")
    for required in ("facade-worker", "facade-ml", "facade-lama", "Blender 3.0.1"):
        assert required in verify


def test_deployment_sources_contain_no_embedded_secret_or_windows_path():
    for relative in EXPECTED_FILES:
        text = read(relative)
        assert not re.search(r"\beyJ[A-Za-z0-9_.-]{20,}\b", text), relative
        assert not re.search(r"(?i)\b[a-z]:\\", text), relative
        assert "SUPABASE_SERVICE_ROLE_KEY=replace-locally" not in text
        assert "COPY . " not in text
