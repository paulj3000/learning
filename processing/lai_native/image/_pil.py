"""The one place Pillow is imported and configured.

Importing this module without Pillow raises `ImageError("pillow_unavailable")`. Configuration is
process wide (Pillow keeps it in module globals), which is fine in a function that does nothing
else: the pixel limit equals the upload limit, the bomb warning is an error where images are
opened (`decode.py`), truncated files are never accepted and PNG text is bounded.
"""

from .errors import ImageError
from .limits import MAX_IMAGE_PIXELS, MAX_PNG_TEXT_CHUNK, MAX_PNG_TEXT_MEMORY

try:
    from PIL import Image, ImageCms, ImageFile, ImageOps, PngImagePlugin
except ImportError as error:  # pragma: no cover - exercised only without Pillow
    raise ImageError("pillow_unavailable") from error

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
ImageFile.LOAD_TRUNCATED_IMAGES = False
PngImagePlugin.MAX_TEXT_CHUNK = MAX_PNG_TEXT_CHUNK
PngImagePlugin.MAX_TEXT_MEMORY = MAX_PNG_TEXT_MEMORY

__all__ = ["Image", "ImageCms", "ImageFile", "ImageOps", "PngImagePlugin"]
