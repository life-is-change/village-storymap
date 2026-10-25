"""Advertise component support only when the workstation stack is compatible."""
import re
import subprocess

from ..app.facade.model_client import LocalModelClient


def compatible(blender):
    try:
        result = subprocess.run([str(blender.executable), '--version'], capture_output=True, text=True, timeout=15)
        version = re.search(r'Blender (\d+)\.(\d+)', result.stdout)
        if result.returncode or not version or tuple(map(int, version.groups())) != (3, 6):
            return False
        return LocalModelClient(timeout_seconds=5).health().get('components_version') == 1
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return False
