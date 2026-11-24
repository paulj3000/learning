"""The image function zip: determinism, pinned wheel, size budget, licences, pruning.

Needs the pinned wheels in `build/image/wheels/<arch>/` (gitignored; fetch with
`python3 native/pillow/build.py --arch <arch>`), or `LAI_PILLOW_WHEEL_DIRS=aarch64=DIR,x86_64=DIR`.
Skips when a wheel is not present, so a clean checkout without network stays green.
"""

import importlib.util
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load_build():
    spec = importlib.util.spec_from_file_location(
        "lai_pillow_build", ROOT / "native" / "pillow" / "build.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build = load_build()


def wheel_dir(arch: str) -> Path | None:
    override = dict(
        item.split("=", 1)
        for item in os.environ.get("LAI_PILLOW_WHEEL_DIRS", "").split(",")
        if item
    )
    path = Path(override.get(arch) or ROOT / "build" / "image" / "wheels" / arch)
    return path if list(path.glob("pillow-*.whl")) else None


def need(arch: str) -> Path:
    path = wheel_dir(arch)
    if path is None:
        pytest.skip(f"no pinned {arch} wheel available")
    return path


@pytest.fixture(scope="module", params=["aarch64", "x86_64"])
def built(request, tmp_path_factory):
    arch = request.param
    wheels = need(arch)
    out = tmp_path_factory.mktemp(f"zip-{arch}")
    path, facts = build.build(arch, out, wheels, out)
    return arch, path, facts


def test_wheel_digest_is_the_pinned_one(built):
    arch, _path, facts = built
    assert facts["wheelSha256"] in build.requirement_hashes(build.ARCHES[arch]["requirements"])
    assert facts["wheelName"].startswith("pillow-13.0.0-cp312-cp312-manylinux")


def test_a_different_wheel_is_refused(tmp_path):
    wheels = need("x86_64")
    original = next(wheels.glob("pillow-*.whl"))
    tampered = tmp_path / original.name
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(tampered, "w") as target:
        for item in source.infolist():
            target.writestr(item, source.read(item))
        target.writestr("PIL/extra.py", b"print('x')\n")
    with pytest.raises(build.BuildError, match="pinned"):
        build.collect("x86_64", tampered)


def test_the_zip_is_deterministic(built, tmp_path):
    arch, path, facts = built
    again, facts2 = build.build(arch, tmp_path, need(arch), tmp_path)
    assert again.name == path.name
    assert again.read_bytes() == path.read_bytes()
    assert facts2["zipSha256"] == facts["zipSha256"]
    with zipfile.ZipFile(path) as archive:
        names = [item.filename for item in archive.infolist()]
        assert names == sorted(names)
        assert {item.date_time for item in archive.infolist()} == {(1980, 1, 1, 0, 0, 0)}
        assert {item.compress_type for item in archive.infolist()} == {zipfile.ZIP_STORED}


def test_size_is_inside_the_documented_budget(built):
    _arch, path, facts = built
    assert path.stat().st_size == facts["zipStoredBytes"]
    assert facts["budgetBytes"] == 24 * 1024 * 1024
    assert facts["zipStoredBytes"] <= facts["budgetBytes"]
    # the pruned build leaves real headroom; a regression that re-adds the removed libraries fails
    assert facts["zipStoredBytes"] < 16 * 1024 * 1024
    # informational: deflate is smaller, but is not what the budget (or the hash) is measured on
    assert facts["zipDeflatedBytesInformational"] < facts["zipStoredBytes"]


def test_contents_licences_and_pruning(built):
    arch, path, _facts = built
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
    assert "image_worker/handler.py" in names
    assert "jobs_worker/handler.py" in names  # the canonical plumbing is reused
    assert "lai_processing/contracts/jobs.py" in names
    assert "lai_native/image/convert.py" in names
    assert "pillow-13.0.0.dist-info/licenses/LICENSE" in names
    assert "licenses/THIRD_PARTY_NOTICES.md" in names
    assert any(n.startswith("pillow-13.0.0.dist-info/sboms/") for n in names)
    assert "PIL/Image.py" in names and "PIL/ImageCms.py" in names
    for forbidden in (
        "libimagequant",
        "libfribidi",
        "libavif",
        "libfreetype",
        "libharfbuzz",
        "_avif",
        "_imagingft",
        "ImageTk",
    ):
        assert not any(forbidden in n for n in names), forbidden
    assert not any(n.endswith(".pyi") or "__pycache__" in n for n in names)
    assert not any(n.startswith("lai_native/audio") or "lai_native/optimize" in n for n in names)
    assert not any(n.startswith(("lai/", "django")) for n in names)
    tag = build.ARCHES[arch]["so_tag"]
    assert all(tag in n for n in names if n.startswith("PIL/_") and n.endswith(".so"))


def test_every_kept_library_finds_its_dependencies(built):
    _arch, path, _facts = built
    with zipfile.ZipFile(path) as archive:
        files = {n: archive.read(n) for n in archive.namelist() if ".so" in n}
    build.check_dependencies(files)  # raises if a kept library lost a dependency
    needed = {dep for data in files.values() for dep in build.elf_needed(data)}
    assert any(dep.startswith("libwebp") for dep in needed)
    assert any(dep.startswith("libsharpyuv") for dep in needed)  # libwebp needs it: kept
    assert not any(dep.startswith(("libavif", "libfreetype")) for dep in needed)


def test_executable_bits_on_shared_objects_only(built):
    _arch, path, _facts = built
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            mode = item.external_attr >> 16
            expected = 0o100755 if ".so" in item.filename else 0o100644
            assert mode == expected, item.filename


def test_pruning_a_needed_library_is_caught():
    wheels = need("x86_64")
    kept, _ = build.wheel_entries(next(wheels.glob("pillow-*.whl")), "x86_64")
    broken = {n: d for n, d in kept.items() if "libsharpyuv" not in n}
    with pytest.raises(build.BuildError, match="neither kept"):
        build.check_dependencies(broken)


def test_the_unpacked_x86_zip_runs_and_matches_in_process_output(tmp_path_factory):
    pytest.importorskip("PIL")
    wheels = need("x86_64")
    out = tmp_path_factory.mktemp("run")
    path, _ = build.build("x86_64", out, wheels, out)
    root = out / "tree"
    with zipfile.ZipFile(path) as archive:
        archive.extractall(root)
    script = (
        "import sys, hashlib, io\n"
        f"sys.path.insert(0, {str(root)!r})\n"
        "import PIL, lai_native.image as im\n"
        f"assert PIL.__file__.startswith({str(root)!r}), PIL.__file__\n"
        "from PIL import Image\n"
        "src = Image.new('RGB', (300, 200), (10, 120, 200)); b = io.BytesIO(); src.save(b, 'PNG')\n"
        "o = im.convert_image(b.getvalue(), im.get_profile('thumbnail-128'))\n"
        "print(o.image.sha256, o.image.width, o.image.height)\n"
        "import image_worker.handler\n"
        "import PIL.features as f\n"
        "print(f.check_module('webp'), f.check_module('littlecms2'), f.check_module('freetype2'))\n"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-c", script], capture_output=True, text=True, check=True
    )
    digest, width, height = result.stdout.splitlines()[0].split()
    assert (int(width), int(height)) == (128, 85)
    assert (
        result.stdout.splitlines()[1] == "True True False"
    )  # fonts were pruned, webp and lcms work
    sys.path.insert(0, str(ROOT / "processing"))
    import io

    from PIL import Image

    from lai_native.image import convert_image, get_profile

    buffer = io.BytesIO()
    Image.new("RGB", (300, 200), (10, 120, 200)).save(buffer, "PNG")
    assert convert_image(buffer.getvalue(), get_profile("thumbnail-128")).image.sha256 == digest


def test_committed_sbom_matches_the_build():
    arch = "aarch64"
    wheels = need(arch)
    files, facts = build.collect(arch, next(wheels.glob("pillow-*.whl")))
    committed = json.loads((ROOT / "native" / "pillow" / f"sbom-{arch}.cdx.json").read_text())
    assert committed == json.loads(json.dumps(build.sbom(files, facts), sort_keys=True))
    names = {c["name"] for c in committed["components"]}
    assert {"Pillow", "libjpeg-turbo", "libwebp", "Little CMS 2"} <= names
    assert not names & {"libimagequant", "FriBiDi", "FreeType", "libavif"}
