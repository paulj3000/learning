# LGPL FFmpeg audio layer (ADR-067)

Reproducible build of the Lambda layer that holds `/opt/bin/ffmpeg` for the audio transcoding
function (`lambda/audio_worker`). Build output goes to `build/` (gitignored); nothing built is
committed.

## What is built

| Component                                                                          | Version | Licence                                                                        | Linked                               |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| FFmpeg (libavcodec, libavformat, libavfilter, libavutil, libswresample + `ffmpeg`) | 7.1.5   | LGPL-2.1-or-later (no `--enable-gpl`, `--enable-nonfree`, `--enable-version3`) | shared, `$ORIGIN` runpath            |
| libopus                                                                            | 1.6.1   | BSD-3-Clause                                                                   | shared                               |
| LAME (libmp3lame)                                                                  | 3.100   | LGPL-2.0-or-later                                                              | shared, replaceable (LGPL section 6) |

Sources and SHA-256 are pinned in `sources.lock.json`; a mismatch stops the build. The FFmpeg
tarball was also verified against the detached GPG signature (release key fingerprint
`FCF986EA15E6E293A5644F10B4322F04D67658D8`), Opus against the vendor `SHA256SUMS.txt`. No patches.

Configuration (see `FFMPEG_FLAGS` in `build.py`, also recorded in the layer's
`share/lai-ffmpeg/build-record.json`): `--disable-everything` then only the decoders for WAV PCM,
MP3, Vorbis, Opus and FLAC, encoders `libopus`, `libmp3lame` and `pcm_s16le` (for the measuring null
sink), demuxers wav/mp3/ogg/flac, muxers ogg/opus/mp3/wav/null, filters loudnorm, ebur128,
aresample, aformat, pan, volume, alimiter, astats, volumedetect and a few helpers;
`--disable-network --disable-protocols --enable-protocol=file,pipe`, no devices, no ffprobe, no
ffplay, no autodetected libraries. Full-source, no-patch, shared-library delivery is the
LGPL-compliance basis (`share/lai-ffmpeg/NOTICE.txt` and `licenses/` ship in the layer).

## Layer layout (extracts to /opt)

```
bin/ffmpeg
lib/libavcodec.so.61 libavfilter.so.10 libavformat.so.61 libavutil.so.59 libswresample.so.5
    libopus.so.0 libmp3lame.so.0
share/lai-ffmpeg/{NOTICE.txt, licenses/*, sbom.cdx.json, build-record.json}
```

`sbom.cdx.json` is CycloneDX 1.5 (component, version, licence, source SHA-256, and the SHA-256 of
every built file). `build-record.json` holds `ffmpeg -version` configuration, the licence the
binary reports, and file hashes: pin `LAI_FFMPEG_SHA256` to `files_sha256["bin/ffmpeg"]`.

## Building

Build inside Amazon Linux 2023 so the glibc matches the Lambda `provided.al2023` and
`python3.12` runtimes (a binary built on a newer host can fail to load there):

```
docker build --platform linux/arm64 -t lai-ffmpeg-build native/ffmpeg
docker run --rm --platform linux/arm64 --user "$(id -u):$(id -g)" \
    -v "$PWD:/src:ro" -v "$PWD/build/ffmpeg-dl:/dl" -v "$PWD/build/ffmpeg:/out" \
    lai-ffmpeg-build --downloads /dl --jobs 2
python3 lambda/audio_worker/build.py --layer build/ffmpeg/lai-ffmpeg-layer-aarch64.zip
```

Use `--platform linux/amd64` for a local x86_64 build (what was measured on the workstation).
Needs network for the three source downloads (checksum verified) and, for the image, the AL2023
base and `dnf` packages. `python3 native/ffmpeg/build.py --work DIR --out DIR` also works directly
on an AL2023 host with gcc, make, nasm (x86 only), pkgconf and patchelf.

### ARM64 (the Lambda target) and CI

The development workstation is x86_64 without binfmt/qemu for arm64 (`docker run --platform
linux/arm64 alpine uname -m` fails with `exec format error`), so no arm64 binary was built or run
in this change; only the x86_64 build was. Two supported ways to produce the arm64 layer
(for Workstream G to wire; no workflow is added here):

1. A GitHub Actions job on a hosted arm64 runner (`ubuntu-24.04-arm`): checkout, `docker build
native/ffmpeg` and `docker run` exactly as above (native arm64, no emulation), then
   `python3 lambda/audio_worker/build.py --layer ...`, upload `lai-ffmpeg-layer-aarch64.zip`, its
   `.sha256` and `build-record.json` as workflow artifacts. Pin the base image by digest. Run
   `tests/processing_native/test_audio_ffmpeg_integration.py` against the extracted layer on the
   same runner (`LAI_FFMPEG_BIN=.../bin/ffmpeg`) before publishing anything.
2. Local: enable qemu binfmt (`docker run --privileged --rm tonistiigi/binfmt --install arm64`,
   a host change that was not made here), then the commands above with `--platform linux/arm64`
   (slow under emulation; do not time it).

Publishing the layer to Lambda is deployment and needs explicit owner approval.

## Vulnerability review (2026-11-18, from web search only, not authoritative)

Limits: no scanner (no Grype/Trivy/OSV run), no vendor advisory feed access beyond search; results
are distro trackers and aggregators. Re-check against the FFmpeg security page and NVD before any
deployment, and on every version bump.

- FFmpeg 7.1.5 is the newest 7.1.x release on ffmpeg.org (the current upstream line is 9.x). Distro
  trackers show 2026 CVEs fixed in the 7.1.x series (for example CVE-2026-8461 fixed at 7.1.5) and
  some still open for 7.1.5 (CVE-2026-75144, heap overflow, fixed upstream in 9.0.1; CVE-2026-18393,
  TDSC cursor loader, fixed in 8.1.1 and 9.0). All reported 2026 issues found concern demuxers,
  decoders and filters that are **not compiled in** (TDSC, DNN/TensorFlow, network protocols and the
  like) unless stated otherwise; this was not verified CVE by CVE. The minimal `--disable-everything`
  build is the main mitigation, plus the runner limits (no network, RLIMIT_AS/CPU/FSIZE, private
  workspace, staff-authored input only).
- libopus 1.6.1: no CVE found for this release; older CVEs (2017) predate it.
- LAME 3.100: released as the fix for CVE-2015-9101 and CVE-2017-9869..9872 and similar; the status
  of CVE-2017-15019 is unclear in trackers. LAME is used only as an encoder (the decoder and
  frontend are disabled); inputs are PCM produced by FFmpeg's own decoders.
- Residual: FFmpeg 7.1.x receives backports slowly; the owner may prefer a newer major (8.x or 9.x)
  after re-measurement. That is an open decision in ADR-067.
