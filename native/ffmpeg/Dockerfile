# Reproducible build environment matching the Lambda provided.al2023 / python3.12 runtime libc.
# Optional local helper only (no Docker is needed on any deployed host). Build and run:
#
#   docker build --platform linux/arm64 -t lai-ffmpeg-build native/ffmpeg
#   docker run --rm --platform linux/arm64 -v "$PWD:/src:ro" -v "$PWD/build/ffmpeg:/out" \
#       lai-ffmpeg-build
#
# See native/ffmpeg/README.md. The base image is pinned by tag here; pin it by digest in CI.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023
RUN dnf -y install gcc gcc-c++ make xz tar gzip bzip2 python3 diffutils perl findutils \
        binutils pkgconf-pkg-config file which patchelf \
    && (dnf -y install nasm || true) \
    && dnf clean all
ENV SOURCE_DATE_EPOCH=1763424000 LC_ALL=C TZ=UTC
ENTRYPOINT ["python3", "/src/native/ffmpeg/build.py", "--work", "/tmp/work", "--out", "/out"]
