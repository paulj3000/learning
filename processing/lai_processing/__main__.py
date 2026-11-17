"""Entry point for `python -m lai_processing`. Importing this module runs nothing."""

from .cli.main import main

if __name__ == "__main__":
    raise SystemExit(main())
