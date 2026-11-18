"""Input limits, equal to the Asset Library upload limits.

`lai/apps/assets/validation_media.py` owns `MAX_IMAGE_SIDE` and `MAX_IMAGE_PIXELS` and imports
Django settings, so the worker cannot import it. These values are the same numbers, and a test
(`tests/native_image/test_limits_parity.py`) fails if either side changes alone.
"""

MAX_IMAGE_SIDE = 4096
MAX_IMAGE_PIXELS = 16_000_000
#: `LAI_ASSET_MAX_IMAGE_BYTES` default: an upload (and so a conversion input or output) fits it.
MAX_IMAGE_BYTES = 10 * 1024 * 1024
#: An embedded ICC profile larger than this is refused (real display profiles are 0.5 to 600 KiB).
MAX_ICC_BYTES = 1024 * 1024
#: PNG text chunk limits applied to Pillow's parser (defaults are 1 MiB and 64 MiB).
MAX_PNG_TEXT_CHUNK = 64 * 1024
MAX_PNG_TEXT_MEMORY = 256 * 1024
