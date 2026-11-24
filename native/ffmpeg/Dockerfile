# Reproducible build environment matching the Lambda provided.al2023 / python3.12 runtime libc.
# Optional local helper only (no Docker is needed on any deployed host). Build and run:
#
#   docker build --platform linux/arm64 -t lai-ffmpeg-build native/ffmpeg
#   docker run --rm --platform linux/arm64 -v "$PWD:/src:ro" -v "$PWD/build/ffmpeg:/out" \
#       lai-ffmpeg-build
#
# See native/ffmpeg/README.md. The base image is pinned by tag here; pin it by digest in CI.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023
# nasm is REQUIRED for x86_64 (FFmpeg's assembly; the build fails without it) and not used on arm64
# (FFmpeg uses GNU as there), so the image is the same every time for a given architecture.
ARG TARGETARCH
RUN dnf -y install gcc gcc-c++ make xz tar gzip bzip2 python3 diffutils perl findutils \
        binutils pkgconf-pkg-config file which patchelf \
    && if [ "${TARGETARCH:-$(uname -m)}" = "amd64" ] || [ "${TARGETARCH:-$(uname -m)}" = "x86_64" ]; then dnf -y install nasm; fi \
    && dnf clean all
ENV SOURCE_DATE_EPOCH=1763424000 LC_ALL=C TZ=UTC
ENTRYPOINT ["python3", "/src/native/ffmpeg/build.py", "--work", "/tmp/work", "--out", "/out"]
