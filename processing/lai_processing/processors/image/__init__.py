"""Image metadata inspection (LAI-LAMBDA-013), standard library only.

`metadata` scans PNG, JPEG and WebP bytes for embedded metadata (EXIF, GPS, XMP, ICC, text,
comments, IPTC) and the EXIF orientation, without decoding a pixel and without ever returning a
metadata value. See `docs/processing/feasibility/LAI-LAMBDA-013-image-conversion-contract.md`.
"""

from .metadata import ImageMetadataFacts, scan_image_metadata, scan_image_metadata_bytes

__all__ = ["ImageMetadataFacts", "scan_image_metadata", "scan_image_metadata_bytes"]
