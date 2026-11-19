#!/usr/bin/env bash
# Package the background jobs worker (lambda/jobs_worker) as a deterministic zip.
#
#   scripts/aws/package-lambda.sh [--out DIR]      # default DIR: build/lambda
#
# Prints the zip path, DIR/jobs-worker-<first 16 hex of its sha256>.zip. The same sources always
# produce the same bytes (sorted entries, fixed timestamps and permissions), so the name changes
# only when the code does. The zip vendors lai/apps/jobs/core and the Bedrock adapter
# (lai/apps/ai/providers/{base,bedrock}.py); the build refuses if a vendored file imports Django.
# Uploading it (s3://<artifacts>/lambda/<name>) is the deploy workflow's job, not this script's.
set -euo pipefail

usage() {
  echo "usage: $0 [--out DIR]" >&2
  exit 2
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="${repo_root}/build/lambda"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -ge 2 && -n "$2" ]] || usage
      out_dir="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    *) usage ;;
  esac
done

python_bin="${PYTHON:-python3}"
command -v "${python_bin}" >/dev/null 2>&1 || {
  echo "package-lambda: ${python_bin} not found" >&2
  exit 2
}
# -I: isolated mode, so nothing from the caller's environment or working directory is imported.
exec "${python_bin}" -I "${repo_root}/lambda/build.py" --out "${out_dir}"
