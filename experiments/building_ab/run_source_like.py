"""Run a high-recall source-like profile on the corrected strict pipeline."""

from run_balanced import (
    configure_compatible_image_reader,
    configure_source_like_module,
    load_strict_module,
)


def main() -> None:
    module = load_strict_module()
    configure_compatible_image_reader(module)
    configure_source_like_module(module)
    module.main()


if __name__ == "__main__":
    main()
