from __future__ import annotations

from PIL import Image

from experiments.facade_layering.lama_worker import _restore_original_size


def test_restore_original_size_crops_model_padding_from_bottom_and_right():
    """Catches LaMa modulo-eight padding changing the facade texture dimensions."""
    padded = Image.new("RGB", (1200, 1504), color=(20, 40, 60))

    restored = _restore_original_size(padded, (1200, 1500))

    assert restored.size == (1200, 1500)
    assert restored.getpixel((1199, 1499)) == (20, 40, 60)
