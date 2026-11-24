#!/usr/bin/env python3
"""Reproducible LGPL FFmpeg audio layer build (LAI-LAMBDA-008b, ADR-067).

    python3 native/ffmpeg/build.py --work /tmp/ffwork --out build/ffmpeg \
        [--downloads DIR] [--jobs 2]

Builds, from the pinned and checksum-verified sources in `sources.lock.json`:

* LAME (LGPL) and libopus (BSD-3) as shared libraries,
* a minimal FFmpeg 7.1 (LGPL, no --enable-gpl, --enable-nonfree or --enable-version3) as shared
  libraries plus one `ffmpeg` executable (no ffprobe, no ffplay, no devices, no network),

with `$ORIGIN`-relative runpaths, stripped, and packages a Lambda layer zip whose layout is

    bin/ffmpeg   lib/*.so.N
    share/lai-ffmpeg/{NOTICE.txt,licenses/*,sbom.cdx.json,build-record.json}

Lambda extracts a layer to /opt, so the executable is /opt/bin/ffmpeg. Nothing is downloaded
without a pinned SHA-256, and a mismatch stops the build. The layer zip is deterministic given the
same binaries (sorted entries, fixed timestamps). Bit-identical binaries across hosts are not
claimed: build in the Docker image (`native/ffmpeg/Dockerfile`) for a controlled toolchain.

Standard library only; runs on the python3.9 that Amazon Linux 2023 ships.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCK = HERE / "sources.lock.json"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
LAYER_PREFIX = "/opt"

#: FFmpeg configure flags. Review against `./configure --list-*` when bumping the version.
#: Nothing here enables GPL, nonfree or version3 code: the result is LGPL v2.1 or later.
FFMPEG_FLAGS = [
    "--disable-autodetect",
    "--disable-everything",
    "--disable-doc",
    "--disable-debug",
    "--disable-programs",
    "--enable-ffmpeg",
    "--disable-avdevice",
    "--disable-swscale",
    "--disable-postproc",
    "--disable-network",
    "--disable-protocols",
    "--enable-protocol=file,pipe",
    "--disable-hwaccels",
    "--disable-indevs",
    "--disable-outdevs",
    "--enable-shared",
    "--disable-static",
    "--enable-libopus",
    "--enable-libmp3lame",
    # Decoders: PCM (WAV), MP3, Ogg Vorbis, Opus, FLAC.
    "--enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_u8,mp3,mp3float,vorbis,opus,flac",
    # Encoders: Opus and MP3 outputs, 16-bit PCM for WAV and the measuring null sink.
    "--enable-encoder=libopus,libmp3lame,pcm_s16le",
    "--enable-demuxer=wav,mp3,ogg,flac",
    "--enable-muxer=ogg,opus,mp3,wav,null",
    "--enable-parser=mpegaudio,vorbis,opus,flac",
    "--enable-filter=loudnorm,ebur128,aresample,aformat,volume,alimiter,astats,volumedetect,"
    "anull,atrim,asetpts,apad,aloop,pan",
]

EXPECTED_SHARED = ("libavcodec", "libavfilter", "libavformat", "libavutil", "libswresample")


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run(argv, cwd, env, log):
    log(f"$ {' '.join(argv)}  (in {cwd})")
    done = subprocess.run(  # noqa: S603 - fixed argv
        argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False
    )
    tail = done.stdout.decode("utf-8", "replace")
    if done.returncode != 0:
        raise BuildError(
            f"command failed ({done.returncode}): {' '.join(argv[:3])}\n{tail[-3000:]}"
        )
    return tail


def fetch(component: dict, downloads: Path, log) -> Path:
    target = downloads / component["filename"]
    if not target.exists():
        log(f"download {component['url']}")
        tmp = target.with_suffix(target.suffix + ".part")
        if not component["url"].startswith("https://"):
            raise BuildError(f"refusing a non-HTTPS source URL for {component['filename']}")
        request = urllib.request.Request(  # noqa: S310 - pinned HTTPS URL, checked above
            component["url"], headers={"User-Agent": "lai-native-build/1"}
        )
        with urllib.request.urlopen(request, timeout=120) as response, open(tmp, "wb") as out:  # noqa: S310
            shutil.copyfileobj(response, out)
        tmp.rename(target)
    actual = sha256_file(target)
    if actual != component["sha256"]:
        target.unlink()
        raise BuildError(f"checksum mismatch for {component['filename']}: got {actual}")
    return target


def extract(archive: Path, dest: Path) -> Path:
    """Extract a tarball refusing absolute paths, `..`, links out of the tree and devices."""
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        for member in members:
            target = (root / member.name).resolve()
            if root != target and root not in target.parents:
                raise BuildError("unsafe path in archive")
            if member.isdev() or member.isfifo():
                raise BuildError("device entry in archive")
            if member.issym() or member.islnk():
                link = (target.parent / member.linkname).resolve()
                if member.islnk():
                    link = (root / member.linkname).resolve()
                if root != link and root not in link.parents:
                    raise BuildError("link leaves the archive tree")
        tar.extractall(root, members=members)  # noqa: S202 - members validated above
    tops = {m.name.split("/")[0] for m in members}
    if len(tops) != 1:
        raise BuildError("archive must have one top directory")
    return root / tops.pop()


def build_env(stage: Path, epoch: str) -> dict:
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LC_ALL": "C",
        "TZ": "UTC",
        "SOURCE_DATE_EPOCH": epoch,
        "HOME": str(stage.parent),
    }


def soname_libs(libdir: Path):
    """Real files for each `lib*.so.<major>` name (symlink chains resolved to bytes)."""
    out = {}
    for entry in sorted(libdir.iterdir()):
        name = entry.name
        stem, _, major = name.partition(".so.")
        if not stem.startswith("lib") or not major or not major.isdigit():
            continue
        out[name] = entry.resolve()
    return out


def run_checked_version(binary: Path, env: dict) -> tuple[str, str]:
    version = subprocess.run(  # noqa: S603
        [str(binary), "-hide_banner", "-version"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
        timeout=30,
    ).stdout.decode()
    licence = subprocess.run(  # noqa: S603
        [str(binary), "-hide_banner", "-L"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
        timeout=30,
    ).stdout.decode()
    return version, licence


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--downloads", type=Path, default=None)
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--arch-label", default=None, help="override platform.machine() in names")
    args = parser.parse_args(argv)

    def log(message: str) -> None:
        print(message, flush=True)

    lock = json.loads(LOCK.read_text())
    components = {c["name"]: c for c in lock["components"]}
    arch = args.arch_label or platform.machine()
    epoch = os.environ.get("SOURCE_DATE_EPOCH", "1763424000")
    work = args.work.resolve()
    downloads = (args.downloads or work / "dl").resolve()
    stage = work / "stage"
    src = work / "src"
    for directory in (downloads, src):
        directory.mkdir(parents=True, exist_ok=True)
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    env = build_env(stage, epoch)
    jobs = f"-j{max(1, args.jobs)}"
    # Staged install root; the layer lands at /opt, but the rpath is $ORIGIN-relative.
    prefix_dir = stage / LAYER_PREFIX.lstrip("/")
    libdir = prefix_dir / "lib"

    trees = {}
    for name, component in components.items():
        archive = fetch(component, downloads, log)
        trees[name] = extract(archive, src / name)

    cflags = f"-O2 -ffile-prefix-map={work}=. -fstack-protector-strong -D_FORTIFY_SOURCE=2"

    # --- LAME ---
    lame_env = dict(env, CFLAGS=cflags, LDFLAGS="-Wl,-z,relro -Wl,-z,now")
    run(
        [
            "./configure",
            f"--prefix={LAYER_PREFIX}",
            "--enable-shared",
            "--disable-static",
            "--disable-frontend",
            "--disable-gtktest",
            "--disable-decoder",
            "--disable-dependency-tracking",
        ],
        trees["lame"],
        lame_env,
        log,
    )
    run(["make", jobs], trees["lame"], lame_env, log)
    run(["make", "install", f"DESTDIR={stage}"], trees["lame"], lame_env, log)

    # --- Opus ---
    opus_env = dict(env, CFLAGS=cflags, LDFLAGS="-Wl,-z,relro -Wl,-z,now")
    run(
        [
            "./configure",
            f"--prefix={LAYER_PREFIX}",
            "--enable-shared",
            "--disable-static",
            "--disable-doc",
            "--disable-extra-programs",
            "--disable-dependency-tracking",
        ],
        trees["opus"],
        opus_env,
        log,
    )
    run(["make", jobs], trees["opus"], opus_env, log)
    run(["make", "install", f"DESTDIR={stage}"], trees["opus"], opus_env, log)

    # --- FFmpeg ---
    # Point FFmpeg at the staged LAME and Opus (pkg-config for Opus, plain flags for LAME).
    pc_dir = libdir / "pkgconfig"
    pc_env = dict(
        env,
        PKG_CONFIG_PATH=str(pc_dir),
        PKG_CONFIG_SYSROOT_DIR=str(stage),
    )
    configure = [
        "./configure",
        f"--prefix={LAYER_PREFIX}",
        *FFMPEG_FLAGS,
        f"--extra-cflags=-I{stage}{LAYER_PREFIX}/include {cflags}",
        f"--extra-ldflags=-L{libdir} -Wl,-z,relro -Wl,-z,now",
        "--disable-stripping",
    ]
    if arch in ("x86_64", "AMD64") and shutil.which("nasm") is None:
        if os.environ.get("LAI_FFMPEG_ALLOW_NO_NASM") != "1":
            raise BuildError(
                "nasm is required for x86_64 "
                "(set LAI_FFMPEG_ALLOW_NO_NASM=1 to build slow, assembly-free code)"
            )
        configure.append("--disable-x86asm")
        log("nasm not found: building without x86 assembly (slower, x86 only)")
    run(configure, trees["ffmpeg"], pc_env, log)
    config_h = (trees["ffmpeg"] / "config.h").read_text()
    for bad in ("CONFIG_GPL 1", "CONFIG_NONFREE 1", "CONFIG_VERSION3 1"):
        if f"#define {bad}" in config_h:
            raise BuildError(f"configure enabled {bad.split()[0]}; refusing")
    run(["make", jobs], trees["ffmpeg"], pc_env, log)
    run(["make", "install", f"DESTDIR={stage}"], trees["ffmpeg"], pc_env, log)

    # --- Assemble the layer tree ---
    layer = work / "layer"
    if layer.exists():
        shutil.rmtree(layer)
    (layer / "bin").mkdir(parents=True)
    (layer / "lib").mkdir()
    share = layer / "share" / "lai-ffmpeg"
    (share / "licenses").mkdir(parents=True)
    shutil.copy2(prefix_dir / "bin" / "ffmpeg", layer / "bin" / "ffmpeg")
    libs = soname_libs(libdir)
    shipped = []
    for name, real in libs.items():
        stem = name.split(".so.")[0]
        if stem in EXPECTED_SHARED or stem in ("libopus", "libmp3lame"):
            shutil.copy2(real, layer / "lib" / name)
            shipped.append(name)
    missing = [s for s in EXPECTED_SHARED if not any(n.startswith(s + ".so.") for n in shipped)]
    if missing:
        raise BuildError(f"expected shared libraries missing: {missing}")
    strip = shutil.which("strip")
    if strip:
        for path in [layer / "bin" / "ffmpeg", *(layer / "lib").iterdir()]:
            run([strip, "--strip-unneeded", str(path)], layer, env, log)
    # Relocatable runpaths: the executable finds ../lib, the libraries find their siblings. Set
    # with patchelf (argv, no shell) because `$ORIGIN` does not survive configure and make quoting.
    patchelf = shutil.which("patchelf")
    if not patchelf:
        raise BuildError("patchelf is required (dnf install patchelf)")
    run([patchelf, "--set-rpath", "$ORIGIN/../lib", str(layer / "bin" / "ffmpeg")], layer, env, log)
    for path in sorted((layer / "lib").iterdir()):
        run([patchelf, "--set-rpath", "$ORIGIN", str(path)], layer, env, log)
    for path in [layer / "bin" / "ffmpeg", *(layer / "lib").iterdir()]:
        os.chmod(path, 0o755)  # noqa: S103 - the layer's binary and libraries must be executable

    readelf = shutil.which("readelf")
    if readelf:
        dynamic = run([readelf, "-d", str(layer / "bin" / "ffmpeg")], layer, env, log)
        if "$ORIGIN/../lib" not in dynamic:
            raise BuildError("ffmpeg has no $ORIGIN/../lib runpath:\n" + dynamic[-1500:])

    # Smoke test and the licence the binary itself reports.
    version_text, licence_text = run_checked_version(layer / "bin" / "ffmpeg", {"PATH": "/usr/bin"})
    if (
        "--enable-gpl" in version_text
        or "--enable-nonfree" in version_text
        or "--enable-version3" in version_text
    ):
        raise BuildError("built binary reports a non-LGPL configuration")

    # --- Licences, notice, SBOM, build record ---
    for name, component in components.items():
        for license_file in component["license_files"]:
            source = trees[name] / license_file
            if source.exists():
                shutil.copy2(source, share / "licenses" / f"{name}-{license_file}")
    notice = render_notice(lock, version_text)
    (share / "NOTICE.txt").write_text(notice, encoding="utf-8")

    hashes = {
        "bin/ffmpeg": sha256_file(layer / "bin" / "ffmpeg"),
        **{f"lib/{n}": sha256_file(layer / "lib" / n) for n in sorted(shipped)},
    }
    sbom = render_sbom(lock, hashes, arch, epoch)
    (share / "sbom.cdx.json").write_text(json.dumps(sbom, indent=2, sort_keys=True) + "\n")
    record = {
        "schema": 1,
        "arch": arch,
        "source_date_epoch": epoch,
        "ffmpeg_version_line": version_text.splitlines()[0] if version_text else "",
        "ffmpeg_configuration": next(
            (line for line in version_text.splitlines() if line.startswith("configuration:")), ""
        ),
        "ffmpeg_license_reported": licence_text.strip().splitlines()[:3],
        "files_sha256": hashes,
        "configure_flags": FFMPEG_FLAGS,
    }
    (share / "build-record.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")

    # --- Zip ---
    args.out.mkdir(parents=True, exist_ok=True)
    zip_path = args.out / f"lai-ffmpeg-layer-{arch}.zip"
    write_layer_zip(layer, zip_path)
    digest = sha256_file(zip_path)
    (args.out / f"lai-ffmpeg-layer-{arch}.zip.sha256").write_text(f"{digest}  {zip_path.name}\n")
    log(f"layer: {zip_path} {zip_path.stat().st_size} bytes sha256={digest}")
    log(f"unzipped bytes: {sum(p.stat().st_size for p in layer.rglob('*') if p.is_file())}")
    log(version_text.splitlines()[0])
    return 0


def render_notice(lock: dict, version_text: str) -> str:
    lines = [
        "Learning Adventure Island audio transcoding layer: third-party notices",
        "",
        "This layer contains FFmpeg built WITHOUT --enable-gpl, --enable-nonfree and",
        "--enable-version3, so it is licensed under the GNU Lesser General Public License,",
        "version 2.1 or later. It also contains libopus (BSD 3-clause) and LAME "
        "(LGPL 2.0 or later).",
        "",
        "FFmpeg, libavcodec, libavformat, libavfilter, libavutil, libswresample and LAME are",
        "shipped as shared libraries under lib/ so that you can replace them with your own",
        "modified builds (LGPL section 6). The complete corresponding source is the pinned,",
        "checksum-verified upstream release listed below, plus the build script and configure",
        "flags in native/ffmpeg/ of the project repository (build-record.json lists the flags).",
        "The full licence texts are in licenses/. No patches are applied to any component.",
        "",
        "Components:",
    ]
    for c in lock["components"]:
        lines += [
            f"  {c['name']} {c['version']}  licence {c['license']}",
            f"    source {c['url']}",
            f"    sha256 {c['sha256']}",
        ]
    lines += ["", "The ffmpeg executable reports:", ""]
    lines += ["  " + line for line in version_text.splitlines()[:3]]
    return "\n".join(lines) + "\n"


def render_sbom(lock: dict, hashes: dict, arch: str, epoch: str) -> dict:
    components = []
    for c in lock["components"]:
        components.append(
            {
                "type": "library",
                "bom-ref": f"{c['name']}@{c['version']}",
                "name": c["name"],
                "version": c["version"],
                "licenses": [{"license": {"id": spdx(c["license"])}}],
                "externalReferences": [
                    {"type": "distribution", "url": c["url"]},
                    {"type": "website", "url": c["homepage"]},
                ],
                "hashes": [{"alg": "SHA-256", "content": c["sha256"]}],
                "description": c["role"] + " (hash is the source tarball SHA-256)",
            }
        )
    for path, digest in sorted(hashes.items()):
        components.append(
            {
                "type": "file",
                "bom-ref": f"file:{path}",
                "name": path,
                "version": arch,
                "hashes": [{"alg": "SHA-256", "content": digest}],
                "description": "built artifact in this layer",
            }
        )
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "component": {"type": "application", "name": "lai-ffmpeg-layer", "version": arch},
            "properties": [{"name": "source_date_epoch", "value": epoch}],
        },
        "components": components,
    }


def spdx(licence: str) -> str:
    return {
        "LGPL-2.1-or-later": "LGPL-2.1-or-later",
        "LGPL-2.0-or-later": "LGPL-2.0-or-later",
        "BSD-3-Clause": "BSD-3-Clause",
    }[licence]


def write_layer_zip(root: Path, target: Path) -> None:
    paths = sorted(p for p in root.rglob("*") if p.is_file())
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in paths:
            relative = path.relative_to(root).as_posix()
            info = zipfile.ZipInfo(relative, FIXED_TIME)
            executable = relative.startswith(("bin/", "lib/"))
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            archive.writestr(info, path.read_bytes(), compresslevel=9)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as error:
        print(f"BUILD FAILED: {error}", file=sys.stderr)
        sys.exit(2)
