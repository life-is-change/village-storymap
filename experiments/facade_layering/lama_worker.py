from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def _restore_original_size(result: Image.Image, original_size: tuple[int, int]) -> Image.Image:
    original_width, original_height = original_size
    if result.width < original_width or result.height < original_height:
        raise ValueError("LaMa output is smaller than the original image")
    if result.size == original_size:
        return result
    return result.crop((0, 0, original_width, original_height))


def main() -> int:
    from simple_lama_inpainting import SimpleLama

    parser = argparse.ArgumentParser(description="Run one local LaMa inpainting job")
    parser.add_argument("image", type=Path)
    parser.add_argument("mask", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    image = Image.open(args.image).convert("RGB")
    mask = Image.open(args.mask).convert("L")
    if image.size != mask.size:
        raise ValueError("Image and mask dimensions must match")

    model = SimpleLama()
    result = _restore_original_size(model(image, mask), image.size)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output)

    try:
        import torch

        print(f"torch={torch.__version__}; cuda={torch.cuda.is_available()}")
    except Exception:
        print("torch status unavailable")
    print(f"output={args.output}; size={result.size[0]}x{result.size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
