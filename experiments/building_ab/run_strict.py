"""Run the existing strict desktop pipeline with stable batch size one."""

from run_balanced import (
    configure_compatible_image_reader,
    configure_strict_module,
    load_strict_module,
)


def main() -> None:
    module = load_strict_module()
    configure_compatible_image_reader(module)
    configure_strict_module(module)
    module.main()


if __name__ == "__main__":
    main()
