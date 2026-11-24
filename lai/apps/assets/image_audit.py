"""Read-only audit of embedded metadata in stored image versions (image privacy baseline).

Published image bytes are delivered unchanged, so a phone photo uploaded as an asset would deliver
its GPS position, device, owner, comment or embedded thumbnail. `audit_image_metadata()` scans every
stored PNG, JPEG and WebP version with the bounded standard-library scanner
(`lai_processing.processors.image.metadata`, presence flags only: it never returns a value) and
reports which versions carry what. It changes nothing: no row, no object, no status. It does not
sanitize anything, and a version it reports clean was only scanned for the listed categories.

Remediation is a staff decision, never a silent rewrite (docs/ASSET_LIBRARY.md, "Image privacy").
Logs and output carry asset ids, version numbers and category names only.
"""

from collections.abc import Iterator
from typing import Any

from lai_processing.processors.image.metadata import scan_image_metadata

from .models import AssetVersion, FileFormat
from .storage import AssetStorage, StorageError, get_storage

IMAGE_FORMATS = (FileFormat.PNG, FileFormat.JPEG, FileFormat.WEBP)
#: Category name -> `ImageMetadataFacts` attribute.
CATEGORIES = {
    "location": "location_possible",
    "device": "device_present",
    "owner": "owner_present",
    "comment": "comment_present",
    "thumbnail": "thumbnail_present",
    "xmp": "xmp_present",
    "iptc": "iptc_present",
    "text": "text_present",
}


def _reader(stream):
    def read(offset: int, length: int) -> bytes:
        stream.seek(offset)
        return stream.read(length)

    return read


def audit_image_metadata(
    *, statuses: list[str] | None = None, storage: AssetStorage | None = None
) -> Iterator[dict[str, Any]]:
    """One row per stored image version (oldest first), optionally limited to `statuses`.

    A row: `asset_id`, `version`, `status`, `format`, `state` (`scanned`, `missing` or
    `unreadable`), `categories` (sorted names from `CATEGORIES`), `sensitive` (bool) and, when the
    scanner could not fully read the structure, `incomplete`. Never a metadata value."""
    storage = storage if storage is not None else get_storage()
    versions = AssetVersion.objects.filter(format__in=IMAGE_FORMATS).select_related("asset")
    if statuses:
        versions = versions.filter(status__in=statuses)
    for version in versions.order_by("created_at", "pk").iterator():
        row: dict[str, Any] = {
            "asset_id": version.asset.asset_id,
            "version": version.number,
            "status": version.status,
            "format": version.format,
            "state": "scanned",
            "categories": [],
            "sensitive": False,
            "incomplete": False,
        }
        try:
            with storage.open(version.storage_key) as stream:
                facts = scan_image_metadata(_reader(stream), version.size_bytes)
        except StorageError:
            row["state"] = "missing"
            yield row
            continue
        except (OSError, ValueError):
            row["state"] = "unreadable"
            yield row
            continue
        row["categories"] = sorted(
            name for name, attr in CATEGORIES.items() if getattr(facts, attr)
        )
        row["sensitive"] = facts.sensitive_present
        row["incomplete"] = facts.truncated or facts.exif_unparsable
        yield row
