"""Texture GPU memory estimates (calculated, never measured on a GPU).

Formulas, with a full mip chain counted as 4/3 of the base level:

- PNG or JPEG: the browser uploads RGBA8, 32 bits per pixel.
- KTX2 ETC1S: transcoded to ETC1/ETC2 RGB or BC1 (4 bpp) when the texture has no alpha, or to a
  8 bpp format (ETC2 RGBA, BC3, BC7, ASTC 4x4) with alpha; the estimate uses 8 bpp as the upper
  bound the device picks.
- KTX2 UASTC: transcoded to ASTC 4x4, BC7 or ETC2 RGBA, 8 bpp.
- Any KTX2 on a device with no compressed format exposed: RGBA8 fallback, 32 bpp. Reported as
  `fallback_bytes` because `KTX2Loader.detectSupport` decides at run time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .signature import ModelSignature

__all__ = ["gpu_bytes", "texture_memory"]


def gpu_bytes(width: int, height: int, bits_per_pixel: int, mipmapped: bool = True) -> int:
    base = width * height * bits_per_pixel // 8
    return base * 4 // 3 if mipmapped else base


def texture_memory(signature: ModelSignature) -> dict[str, Any]:
    images = []
    total = 0
    for image in signature.images:
        width, height = image.get("width"), image.get("height")
        entry: dict[str, Any] = {
            "mime_type": image.get("mime_type"),
            "bytes": image.get("bytes"),
            "width": width,
            "height": height,
        }
        if isinstance(width, int) and isinstance(height, int):
            bpp = 8 if image.get("mime_type") == "image/ktx2" else 32
            estimate = gpu_bytes(width, height, bpp)
            entry["gpu_bytes_estimate"] = estimate
            if bpp != 32:
                entry["fallback_bytes"] = gpu_bytes(width, height, 32)
            total += estimate
        images.append(entry)
    return {"images": images, "gpu_bytes_estimate": total, "basis": "calculated"}
