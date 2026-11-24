#!/usr/bin/env bash
# Fetch the pinned GLB optimization tools (LAI-LAMBDA-010, ADR-070) into a gitignored build dir.
#
#   native/gltf/fetch-tools.sh [--arch x86_64|arm64] [--out build/native/gltf]
#
# What it does, and nothing more:
#   - downloads the pinned release archives listed in native/gltf/tools.lock (exact URL and
#     SHA-256 per architecture), verifies each SHA-256 before extracting anything, and extracts
#     into <out>/<arch>/;
#   - prints the tool paths to export for the optional real-tool tests and the benchmark
#     (LAI_GLTFPACK_PATH, LAI_TOKTX_PATH, LAI_KTX_PATH, LAI_KTX_LIBRARY_PATH).
# It never commits, installs system packages, runs sudo, or touches the repository tree outside
# <out>. Binaries are build outputs and are never committed (`/build/` is gitignored).
#
# arm64: KTX-Software publishes a Linux arm64 tarball (pinned). meshoptimizer publishes no Linux
# arm64 gltfpack binary, so on arm64 this script stops after KTX and prints the from-source
# recipe (native/gltf/README.md, "arm64 gltfpack"), which needs CMake and is not run here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ARCH="$(uname -m)"
OUT="$ROOT/build/native/gltf"

while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ARCH" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $ARCH" >&2; exit 2 ;;
esac

DEST="$OUT/$ARCH"
DL="$OUT/downloads"
mkdir -p "$DEST" "$DL"

# tools.lock rows: name arch url sha256 (whitespace separated; '#' comments).
pinned() {
  awk -v n="$1" -v a="$ARCH" '$1==n && $2==a {print $3, $4}' "$HERE/tools.lock"
}

# Download (or reuse) and verify one pinned archive. Exits non-zero, with a clear message, on a
# download failure or a SHA-256 mismatch: a bad pin is never treated as "no pin".
fetch() {
  local name="$1" url sha file
  read -r url sha < <(pinned "$name")
  file="$DL/$(basename "$url")"
  if [ ! -f "$file" ] || ! echo "$sha  $file" | sha256sum -c --status; then
    if ! curl -fsSL --retry 2 -m 300 -o "$file.part" "$url"; then
      echo "ERROR: download failed for $name ($url)" >&2
      exit 4
    fi
    mv "$file.part" "$file"
  fi
  if ! echo "$sha  $file" | sha256sum -c --status; then
    echo "ERROR: SHA-256 mismatch for $name ($(basename "$file")); expected $sha. Refusing to extract." >&2
    rm -f "$file"
    exit 3
  fi
  FETCHED="$file"
}

GLTFPACK=""
if [ -n "$(pinned gltfpack)" ]; then
  fetch gltfpack
  mkdir -p "$DEST/gltfpack"
  unzip -o -q "$FETCHED" -d "$DEST/gltfpack"
  chmod 0755 "$DEST/gltfpack/gltfpack"
  GLTFPACK="$DEST/gltfpack/gltfpack"
else
  echo "no pinned gltfpack binary for $ARCH: meshoptimizer publishes none for Linux arm64; see native/gltf/README.md" >&2
fi

fetch ktx-software
mkdir -p "$DEST/ktx"
tar -xjf "$FETCHED" -C "$DEST/ktx"
KTX_DIR="$(find "$DEST/ktx" -maxdepth 1 -type d -name 'KTX-Software-*' | sort | tail -n 1)"

cat <<EOF
# Pinned GLB optimization tools for $ARCH (see native/gltf/tools.lock). Export to enable the
# real-tool tests and the benchmark:
export LAI_GLTFPACK_PATH="${GLTFPACK}"
export LAI_TOKTX_PATH="$KTX_DIR/bin/toktx"
export LAI_KTX_PATH="$KTX_DIR/bin/ktx"
export LAI_KTX_LIBRARY_PATH="$KTX_DIR/lib"   # passed to toktx by lai_native.runtime (extra_env)
export LD_LIBRARY_PATH="$KTX_DIR/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"   # for running ktx by hand
EOF
