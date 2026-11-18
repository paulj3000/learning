"""Offline image conversion benchmark for LAI-LAMBDA-013 (feasibility only).

Measures decode, orientation, thumbnailing and encode time and peak memory for synthetic images
at and below the Asset Library limits (`MAX_IMAGE_SIDE` 4096 and `MAX_IMAGE_PIXELS` 16,000,000,
`lai/apps/assets/validation_media.py:26-27`). It uses whatever imaging library is already
importable in the interpreter that runs it (Pillow); it never installs one, and Pillow is not a
product dependency.

    python3 scripts/processing/bench/image_bench.py            # plan only, nothing runs
    python3 scripts/processing/bench/image_bench.py --run      # run every case, print JSON
    python3 scripts/processing/bench/image_bench.py --run --quick --repeat 1

For each case one child process generates the encoded source image and a second, fresh child
(`sys.executable -I`) reads it from stdin and processes it, so the reported peak resident set
size (`ru_maxrss`) covers the interpreter, the library and the processing only, not the
synthesis. Nothing is read from or written to disk; nothing touches the network or AWS.

Results describe the machine that ran them. An x86 laptop is not an arm64 Lambda: treat timings
as relative until the same script runs on the target (a Graviton instance, or the Lambda itself
after an approved deployment).
"""

from __future__ import annotations

import argparse
import io
import json
import platform
import resource
import subprocess
import sys
import time
from pathlib import Path

# The pure metadata scanner is standard library only; the bench uses it to prove outputs carry no
# metadata (the same check the worker's post-condition would make).
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "processing"))

MAX_IMAGE_SIDE = 4096  # lai/apps/assets/validation_media.py:26
MAX_IMAGE_PIXELS = 16_000_000  # lai/apps/assets/validation_media.py:27
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # validation_media.max_image_bytes() default
THUMBNAIL_SIDES = (256, 512)

# (label, width, height, source format, alpha)
CASES = (
    ("1024-png-rgba", 1024, 1024, "png", True),
    ("2048-jpeg-rgb", 2048, 2048, "jpeg", False),
    ("2048-png-rgba", 2048, 2048, "png", True),
    ("4096x3900-jpeg-rgb", 4096, 3900, "jpeg", False),  # 15,974,400 px: at the pixel limit
    ("4096x3900-png-rgba", 4096, 3900, "png", True),
    ("4096x3900-webp-rgba", 4096, 3900, "webp", True),
    # EXIF orientation 6 plus a GPS IFD (synthesised at run time): sources of metadata removal
    ("2048-jpeg-exif-gps", 2048, 2048, "jpeg", False, True),
)
QUICK = {"1024-png-rgba", "2048-jpeg-rgb", "2048-jpeg-exif-gps"}
# Extra fixtures made at run time (no committed binaries): a JPEG with EXIF orientation 6 and a
# GPS IFD, and a PNG with a text chunk, to exercise orientation, metadata removal and the scanner.


def _peak_rss_mib() -> float:
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)  # Linux: KiB


def _synthetic_exif(orientation: int = 6) -> bytes:
    """EXIF with an orientation tag and a GPS IFD holding latitude and longitude tags (zeros)."""
    from PIL import Image  # noqa: PLC0415 - optional

    exif = Image.Exif()
    exif[0x0112] = orientation
    gps = exif.get_ifd(0x8825)
    gps[0x0001], gps[0x0002] = "N", (0.0, 0.0, 0.0)
    gps[0x0003], gps[0x0004] = "E", (0.0, 0.0, 0.0)
    return exif.tobytes()


def generate(width: int, height: int, fmt: str, alpha: bool, with_metadata: bool = False) -> bytes:
    """Texture-like content: low-resolution noise upscaled (compressible, not flat)."""
    from PIL import Image  # noqa: PLC0415 - optional

    mode = "RGBA" if alpha else "RGB"
    small = Image.effect_noise((max(width // 8, 1), max(height // 8, 1)), 48).convert(mode)
    image = small.resize((width, height), Image.Resampling.BICUBIC)
    out = io.BytesIO()
    options = {"png": {"compress_level": 6}, "jpeg": {"quality": 90}, "webp": {"quality": 90}}
    extra = {"exif": _synthetic_exif()} if with_metadata and fmt != "png" else {}
    image.save(out, format=fmt.upper(), **options[fmt], **extra)
    return out.getvalue()


def process(encoded: bytes, repeat: int) -> dict:
    from PIL import Image, ImageOps  # noqa: PLC0415 - optional

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS  # bomb guard: above 2x this Pillow raises
    timings: dict[str, float] = {}
    outputs: dict[str, int] = {}

    def best(name, fn):
        values = []
        result = None
        for _ in range(repeat):
            start = time.perf_counter()
            result = fn()
            values.append((time.perf_counter() - start) * 1000)
        timings[name] = round(min(values), 1)
        return result

    def header_only():
        with Image.open(io.BytesIO(encoded)) as image:
            return image.size  # parses the header; no pixel decode

    best("header_ms", header_only)

    def decode():
        image = Image.open(io.BytesIO(encoded))
        if max(image.size) > MAX_IMAGE_SIDE or image.width * image.height > MAX_IMAGE_PIXELS:
            raise ValueError("over the Asset Library limits")
        image.load()
        return image

    image = best("decode_ms", decode)
    image = best("exif_transpose_ms", lambda: ImageOps.exif_transpose(image))

    def thumbnail(side):
        copy = image.copy()
        copy.thumbnail((side, side), Image.Resampling.LANCZOS, reducing_gap=2.0)
        out = io.BytesIO()
        copy.save(out, format="WEBP", quality=80, method=4)
        return out.getbuffer().nbytes

    def draft_thumbnail(side):
        # JPEG only: decode at 1/2, 1/4 or 1/8 scale (DCT scaling) before resampling.
        with Image.open(io.BytesIO(encoded)) as source:
            source.draft("RGB", (side * 2, side * 2))
            source.thumbnail((side, side), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            source.save(out, format="WEBP", quality=80, method=4)
            return out.getbuffer().nbytes

    for side in THUMBNAIL_SIDES:
        outputs[f"thumb{side}_webp_bytes"] = best(
            f"thumb{side}_webp_ms", lambda s=side: thumbnail(s)
        )
    if image.format == "JPEG" or encoded[:3] == b"\xff\xd8\xff":
        outputs["thumb256_draft_webp_bytes"] = best(
            "thumb256_draft_webp_ms", lambda: draft_thumbnail(256)
        )

    def reencode(target):
        out = io.BytesIO()
        source = image.convert("RGB") if target == "JPEG" else image
        options = {"WEBP": {"quality": 85, "method": 4}, "PNG": {}, "JPEG": {"quality": 85}}
        source.save(out, format=target, **options[target])
        return out.getbuffer().nbytes

    for target in ("WEBP", "PNG", "JPEG"):
        outputs[f"full_{target.lower()}_bytes"] = best(
            f"full_{target.lower()}_ms", lambda t=target: reencode(t)
        )
    outputs.update(conversion_steps(encoded, image, best, timings))
    return {"timings_ms": timings, "outputs": outputs, "peak_rss_mib": _peak_rss_mib()}


def conversion_steps(encoded, image, best, timings) -> dict:
    """The steps of the proposed conversion profile: colour, premultiplied resize, strip, verify."""
    from PIL import Image, ImageCms  # noqa: PLC0415 - optional

    from lai_processing.processors.image import scan_image_metadata_bytes  # noqa: PLC0415

    facts: dict = {}
    srgb = ImageCms.createProfile("sRGB")
    rgb = image.convert("RGB")

    def colour():
        # sRGB to sRGB with built-in profiles: the cost of one ImageCms transform, not of a
        # particular source profile (no ICC profile file is committed).
        return ImageCms.profileToProfile(rgb, srgb, srgb, outputMode="RGB")

    best("icc_transform_ms", colour)

    def premultiplied_resize():
        rgba = image.convert("RGBA")
        small = rgba.convert("RGBa").resize(
            (max(image.width // 2, 1), max(image.height // 2, 1)), Image.Resampling.LANCZOS
        )
        return small.convert("RGBA")

    resized = best("premultiplied_half_resize_ms", premultiplied_resize)
    facts["half_size"] = list(resized.size)

    def strip_encode():
        # A fresh image from pixel data only: no info, exif or icc_profile can be carried over.
        fresh = Image.frombytes(rgb.mode, rgb.size, rgb.tobytes())
        out = io.BytesIO()
        fresh.save(out, format="WEBP", quality=85, method=4, exif=b"", icc_profile=None)
        return out.getvalue()

    stripped = best("strip_reencode_webp_ms", strip_encode)
    after = scan_image_metadata_bytes(stripped)
    facts["stripped_webp_bytes"] = len(stripped)
    facts["stripped_has_metadata"] = after.any_metadata or after.location_possible
    before = scan_image_metadata_bytes(encoded)
    facts["source_metadata_flags"] = before.as_flags()
    facts["source_orientation_applied_size"] = None
    try:
        from PIL import ImageOps  # noqa: PLC0415

        fixed = ImageOps.exif_transpose(Image.open(io.BytesIO(encoded)))
        facts["source_orientation_applied_size"] = list(fixed.size)
    except Exception as error:  # noqa: BLE001 - bench only
        facts["orientation_error"] = type(error).__name__
    return facts


def host() -> dict:
    info = {"machine": platform.machine(), "python": platform.python_version()}
    try:
        import PIL  # noqa: PLC0415

        info["pillow"] = PIL.__version__
    except ImportError:
        info["pillow"] = None
    try:
        info["load_average"] = [round(x, 2) for x in __import__("os").getloadavg()]
    except OSError:
        pass
    return info


def _child(argv: list[str], data: bytes | None = None) -> bytes:
    return subprocess.run(  # noqa: S603 - this script, fixed argv, no shell
        [sys.executable, "-I", __file__, *argv],
        input=data,
        check=True,
        capture_output=True,
        timeout=900,
    ).stdout


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", action="store_true", help="run the cases (default: plan only)")
    parser.add_argument("--quick", action="store_true", help="only the two small cases")
    parser.add_argument("--repeat", type=int, default=3, help="runs per step; the minimum is kept")
    parser.add_argument(
        "--import-time", action="store_true", help="time `import PIL.Image` in a fresh process"
    )
    parser.add_argument("--import-probe", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--generate", help=argparse.SUPPRESS)
    parser.add_argument("--process", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.import_probe:
        start = time.perf_counter()
        import PIL.Image  # noqa: F401, PLC0415

        print(json.dumps({"import_pil_image_ms": round((time.perf_counter() - start) * 1000, 1)}))
        return 0
    if args.generate:
        width, height, fmt, alpha, *rest = json.loads(args.generate)
        sys.stdout.buffer.write(generate(width, height, fmt, alpha, bool(rest and rest[0])))
        return 0
    if args.process:
        print(json.dumps(process(sys.stdin.buffer.read(), args.repeat)))
        return 0
    cases = [c for c in CASES if not args.quick or c[0] in QUICK]
    if not args.run and not args.import_time:
        print(json.dumps({"plan": [c[0] for c in cases], "host": host()}, indent=2))
        return 0
    if host()["pillow"] is None:
        print(json.dumps({"skipped": "Pillow is not importable in this interpreter"}))
        return 0
    if args.import_time:
        print(_child(["--import-probe"]).decode())
        return 0
    results = []
    for label, width, height, fmt, alpha, *meta in cases:
        encoded = _child(["--generate", json.dumps([width, height, fmt, alpha, *meta])])
        measured = json.loads(_child(["--process", "--repeat", str(args.repeat)], encoded))
        results.append(
            {
                "case": label,
                "source_bytes": len(encoded),
                "source_within_upload_limit": len(encoded) <= MAX_IMAGE_BYTES,
                **measured,
            }
        )
    print(json.dumps({"host": host(), "repeat": args.repeat, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
