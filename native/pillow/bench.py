"""Time and peak memory of image conversion at realistic limits (local, informational).

    python native/pillow/bench.py [--repeat 3]          # needs Pillow; run in the image venv

Each case runs in a fresh child process so `ru_maxrss` is that case's own peak (it includes the
interpreter and Pillow, about 30 MiB). Numbers are for THIS machine; label them with its CPU
architecture. They are not Lambda numbers: no Lambda function exists or is called.
Note: 4096 x 4096 is 16,777,216 pixels, over the 16,000,000 pixel upload limit, so the largest
square that converts is 4000 x 4000; the largest at full side is 4096 x 3906.
"""

import argparse
import io
import json
import os
import platform
import resource
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES = [
    ("jpeg", 2048, 2048),
    ("jpeg", 4000, 4000),
    ("jpeg", 4096, 3906),
    ("png", 4000, 4000),
    ("webp", 4000, 4000),
]
PROFILE_SETS = {
    "thumbnails 128/256/512": ["thumbnail-128", "thumbnail-256", "thumbnail-512"],
    "convert-webp": ["convert-webp"],
    "convert-png": ["convert-png"],
    "convert-jpeg": ["convert-jpeg"],
    "texture-data-png": ["texture-data-png"],
}


def make_source(fmt: str, width: int, height: int) -> bytes:
    from PIL import Image, ImageFilter

    seed = Image.effect_noise((256, 256), 40).convert("RGB")
    base = seed.resize((width, height), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(2))
    gradient = Image.linear_gradient("L").resize((width, height))
    image = Image.composite(base, Image.new("RGB", (width, height), (30, 90, 160)), gradient)
    buffer = io.BytesIO()
    options = {"jpeg": {"quality": 85}, "png": {"compress_level": 6}, "webp": {"quality": 85}}[fmt]
    image.save(buffer, fmt.upper(), **options)
    return buffer.getvalue()


CHILD = """
import json, resource, sys, time
sys.path.insert(0, {processing!r})
from lai_native.image import convert_many, get_profile
data = open({path!r}, 'rb').read()
profiles = [get_profile(n) for n in {names!r}]
times = []
for _ in range({repeat}):
    start = time.perf_counter()
    report = convert_many(data, profiles)
    times.append(time.perf_counter() - start)
print(json.dumps({{
    'seconds': times,
    'peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
    'outputs': [[o.image.width, o.image.height, o.image.size_bytes] for o in report.outputs],
}}))
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repeat", type=int, default=3)
    args = parser.parse_args()
    import PIL

    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for fmt, width, height in CASES:
            data = make_source(fmt, width, height)
            path = Path(tmp) / f"{fmt}-{width}x{height}"
            path.write_bytes(data)
            for label, names in PROFILE_SETS.items():
                script = CHILD.format(
                    processing=str(ROOT / "processing"), path=str(path), names=names, repeat=args.repeat
                )
                out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
                result = json.loads(out.stdout)
                rows.append(
                    {
                        "source": f"{fmt} {width}x{height} ({len(data) / 1e6:.1f} MB)",
                        "profiles": label,
                        "best_s": round(min(result["seconds"]), 3),
                        "median_s": round(sorted(result["seconds"])[len(result["seconds"]) // 2], 3),
                        "peak_rss_mib": round(result["peak_rss_mib"], 1),
                        "outputs": result["outputs"],
                    }
                )
    machine = {
        "machine": platform.machine(),
        "python": platform.python_version(),
        "pillow": PIL.__version__,
        "cpus": os.cpu_count(),
        "loadavg": os.getloadavg(),
        "label": "local workstation, not Lambda",
    }
    print(json.dumps({"machine": machine, "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
