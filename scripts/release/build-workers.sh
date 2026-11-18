#!/usr/bin/env bash
# Build every processing worker artifact of this commit into DIR (ADR-071), one directory each:
#
#   scripts/release/build-workers.sh DIR
#
#   DIR/jobs-worker/jobs-worker-<hash16>.zip   scripts/aws/package-lambda.sh (always)
#   DIR/<name>/<one>.zip                       a native builder, when this commit has it:
#       audio-worker   lambda/audio_worker/build.py   (Workstream C)
#       ffmpeg-layer   native/ffmpeg/build.py         (Workstream C, LGPL build)
#       image-worker   native/pillow/build.py         (Workstream D)
#       optimize-worker native/gltf/build.py          (Workstream F; released only with its flag)
#
# Builder contract: `python3 -I <builder> --out <DIR>/<name>` writes exactly one .zip there and
# nothing else that matters; the bytes must be reproducible from the commit. A missing builder
# means the artifact is not part of this release (the pre-enable check then refuses its control).
# Build outputs are never committed. No AWS call.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: $0 DIR" >&2; exit 2; }
out=$1
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python_bin="${PYTHON:-python3}"
mkdir -p "$out/jobs-worker"
"$repo_root/scripts/aws/package-lambda.sh" --out "$out/jobs-worker" >/dev/null
# The kinds the jobs worker zip accepts on its two queues (ai, media), from the vendored envelope
# (lai/apps/jobs/core is standard library only); the release manifest records them.
"$python_bin" -I - "$repo_root/lai/apps/jobs/core/envelope.py" >"$out/jobs-worker/kinds.json" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("envelope", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(sorted(k for k, q in module.KIND_QUEUE.items() if q in ("ai", "media"))))
PY
declare -A builders=(
    [audio-worker]=lambda/audio_worker/build.py
    [ffmpeg-layer]=native/ffmpeg/build.py
    [image-worker]=native/pillow/build.py
    [optimize-worker]=native/gltf/build.py
)
for name in audio-worker ffmpeg-layer image-worker optimize-worker; do
    builder="$repo_root/${builders[$name]}"
    if [ "$name" = optimize-worker ] && [ "${LAI_OPTIMIZE_WORKER:-false}" != true ]; then
        echo "skip $name (optimize worker flag off)"
        continue
    fi
    if [ ! -f "$builder" ]; then
        echo "skip $name (no ${builders[$name]} in this commit)"
        continue
    fi
    mkdir -p "$out/$name"
    "$python_bin" -I "$builder" --out "$out/$name"
    count=$(find "$out/$name" -maxdepth 1 -name '*.zip' | wc -l)
    [ "$count" -eq 1 ] || { echo "$name: expected one zip, got $count" >&2; exit 1; }
    echo "built $name"
done
