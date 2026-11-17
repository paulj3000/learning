#!/usr/bin/env bash
# Build the native dev release artifact (run in CI or on a workstation; never on the instance).
#
#   package-release.sh --git-sha <40 hex> --commit-epoch <unix seconds> [--run-url URL] --out DIR
#       [--skip-wheels] [--source REPO_DIR]
#
# Writes DIR/<sha>.tar.gz and DIR/<sha>.json and prints both paths, one per line. The tarball holds
# lai/, content/, react/public/models/, requirements.txt, wheels/ (aarch64 CPython 3.12 wheels from
# `pip download`, so the instance installs with --no-index, plus the pure-Python lai-processing
# wheel built from processing/ with `pip wheel --no-deps`), deploy/native/, scripts/aws/native/
# and RELEASE.json. It is deterministic: files sorted by name, mtime set to the commit time, owner
# root, gzip without a timestamp; the same inputs give the same SHA-256. Files come from
# `git ls-files` (tracked plus untracked, not ignored) when the source is a git checkout, so local
# caches and ignored files never ship. --skip-wheels leaves wheels/ empty (tests only). The
# processing wheel is built with SOURCE_DATE_EPOCH set to the commit time, so it is reproducible.
# Exit codes: 0 ok, 2 usage, 10 invalid, 20 packaging failed.
set -Eeuo pipefail

say() { printf '%s [package] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
fail() { say "ERROR: $2"; exit "$1"; }
usage() { sed -n '4,5p' "$0" >&2; exit 2; }

git_sha="" epoch="" run_url="" out="" skip_wheels=false
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)
while [ "$#" -gt 0 ]; do
    case "$1" in
        --git-sha) git_sha=${2:-}; shift 2 ;;
        --commit-epoch) epoch=${2:-}; shift 2 ;;
        --run-url) run_url=${2:-}; shift 2 ;;
        --out) out=${2:-}; shift 2 ;;
        --source) source_dir=${2:-}; shift 2 ;;
        --skip-wheels) skip_wheels=true; shift ;;
        *) usage ;;
    esac
done
[ -n "$out" ] || usage
[[ $git_sha =~ ^[a-f0-9]{40}$ ]] || fail 10 "--git-sha must be a full 40-character commit"
[[ $epoch =~ ^[0-9]{9,11}$ ]] || fail 10 "--commit-epoch must be unix seconds"
if [ -n "$run_url" ] && ! [[ $run_url =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$ ]]; then
    fail 10 "--run-url is not a GitHub Actions run URL"
fi
[ -f "$source_dir/requirements.txt" ] || fail 10 "$source_dir has no requirements.txt"

PATHS=(lai content react/public/models requirements.txt deploy/native scripts/aws/native)
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tree="$work/tree"
mkdir -p "$tree/wheels"

# The file list: git when available, else a walk that drops caches.
if git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$source_dir" ls-files -z --cached --others --exclude-standard -- "${PATHS[@]}" >"$work/files"
else
    (cd "$source_dir" && find "${PATHS[@]}" -type f -print0) >"$work/files"
fi
# Drop caches and files deleted from the working tree, then copy keeping modes.
grep -zvE '(^|/)(__pycache__|\.pytest_cache|node_modules|staticfiles)/|\.py[co]$' "$work/files" |
    (cd "$source_dir" && while IFS= read -r -d '' file; do if [ -f "$file" ]; then printf '%s\0' "$file"; fi; done) |
    (cd "$source_dir" && xargs -0 -r cp -p --parents -t "$tree") || fail 20 "copying the source failed"
[ -f "$tree/scripts/aws/native/deploy-native.sh" ] || fail 20 "scripts/aws/native/deploy-native.sh is missing"
[ -f "$tree/lai/manage.py" ] || fail 20 "lai/manage.py is missing"
chmod 0755 "$tree"/scripts/aws/native/*.sh

if [ "$skip_wheels" != true ]; then
    say "downloading linux/arm64 CPython 3.12 wheels"
    # Every manylinux tag Amazon Linux 2023 (glibc 2.34) satisfies, listed explicitly so pip never
    # depends on its own tag expansion: 2014 (= 2_17), 2_28 (psycopg-binary) and 2_34.
    "${LAI_PACKAGE_PYTHON:-python3}" -m pip download --quiet --disable-pip-version-check \
        --only-binary=:all: --platform manylinux2014_aarch64 --platform manylinux_2_17_aarch64 \
        --platform manylinux_2_28_aarch64 --platform manylinux_2_34_aarch64 \
        --implementation cp --python-version 3.12 -r "$tree/requirements.txt" -d "$tree/wheels" ||
        fail 20 "pip download failed (every requirement needs an aarch64 cp312 or pure-Python wheel)"
    # Django imports lai_processing and lai_processing_runtime (docs/processing/WAVE2_INTERFACES.md
    # section 8). Pure Python with no dependencies, so the instance installs it with --no-deps.
    [ -f "$source_dir/processing/pyproject.toml" ] || fail 10 "$source_dir has no processing/pyproject.toml"
    say "building the lai-processing wheel from processing/"
    # From a copy, so the in-tree build (build/, *.egg-info) never touches the checkout.
    cp -R "$source_dir/processing" "$work/processing-src" || fail 20 "copying processing/ failed"
    SOURCE_DATE_EPOCH=$epoch "${LAI_PACKAGE_PYTHON:-python3}" -m pip wheel --quiet --no-deps \
        --disable-pip-version-check --no-cache-dir "$work/processing-src" -w "$tree/wheels" ||
        fail 20 "pip wheel ./processing failed"
    ls "$tree"/wheels/lai_processing-*-py3-none-any.whl >/dev/null 2>&1 ||
        fail 20 "the lai-processing wheel is missing or not pure Python"
fi

jq -n --arg sha "$git_sha" --argjson epoch "$epoch" --arg run_url "$run_url" \
    '{schema:1, git_sha:$sha, commit_epoch:$epoch, run_url:$run_url, python_version:"3.12",
      platform:"linux/arm64"}' >"$tree/RELEASE.json"

tarball="$out/$git_sha.tar.gz"
manifest="$out/$git_sha.json"
(cd "$tree" && tar --sort=name --format=gnu --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
    --mode='u+rwX,go+rX,go-w' -cf - .) | gzip -n -9 >"$tarball.tmp" || fail 20 "tar failed"
mv -f "$tarball.tmp" "$tarball"
artifact_sha=$(sha256sum "$tarball" | cut -d' ' -f1)
jq -n --arg sha "$git_sha" --argjson epoch "$epoch" --arg run_url "$run_url" \
    --arg built "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg artifact "$artifact_sha" \
    '{schema:1, git_sha:$sha, commit_epoch:$epoch, run_url:$run_url, built_at:$built,
      artifact_sha256:$artifact, python_version:"3.12", platform:"linux/arm64"}' >"$manifest"
say "built $tarball ($artifact_sha)"
printf '%s\n%s\n' "$tarball" "$manifest"
