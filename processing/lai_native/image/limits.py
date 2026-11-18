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
#: PNG chunk limits applied to Pillow's parser. `MAX_TEXT_CHUNK` bounds the inflated size of any
#: one compressed chunk, including `iCCP`, so it must admit a largest allowed profile
#: (`MAX_ICC_BYTES`); the total of all text chunks is bounded separately, and tighter, by
#: `MAX_TEXT_MEMORY` (Pillow's defaults are 1 MiB and 64 MiB).
MAX_PNG_TEXT_CHUNK = MAX_ICC_BYTES
MAX_PNG_TEXT_MEMORY = 256 * 1024
#: Most scans a JPEG may have. Pillow decodes in process and cannot be interrupted, and every
#: scan of a progressive JPEG is another pass over the coefficients, so a file of thousands of
#: tiny scans fits the byte and pixel limits yet runs to the Lambda timeout. Ordinary progressive
#: files have about 10 scans (libjpeg's default script) and the largest common scripts 15 to 20.
MAX_JPEG_SCANS = 32
#: Most marker segments the JPEG walk will read before giving up.
MAX_JPEG_SEGMENTS = 20_000
