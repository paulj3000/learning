#!/usr/bin/env bash
# Publish or roll back processing worker artifacts by release manifest (ADR-071). Run by
# .github/workflows/release-prod-workers.yml with the lai-github-workers-prod role; never by a push.
#
#   publish-workers.sh publish MANIFEST DIST   # verify, upload create-only, update functions
#   publish-workers.sh rollback MANIFEST_KEY   # verify an earlier manifest's objects, update functions
#
# Settings: BUCKET (the environment's artifacts bucket), AWS_REGION. Every object is written with
# If-None-Match: * (an existing key with the same SHA-256 is accepted, a different one refused).
# Functions are updated only to a zip whose SHA-256 matches the manifest, and the deployed
# CodeSha256 is checked afterwards. The FFmpeg layer is uploaded but never published here: the
# audio function's layer changes only through the stack parameter AudioLayerKey (owner change set).
# Exit codes: 0 done, 1 verification or AWS failure, 2 usage.
set -Eeuo pipefail
tool() { python3 -I "$(dirname "${BASH_SOURCE[0]}")/processing_release.py" "$@"; }
die() { echo "::error::$*" >&2; exit 1; }
[ -n "${BUCKET:-}" ] || die "BUCKET is not set"
command=${1:-}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

b64sha() { python3 -I -c 'import base64,sys;print(base64.b64encode(bytes.fromhex(sys.argv[1])).decode())' "$1"; }

# Upload $1 to key $2 create-only; accept an identical existing object.
put_once() {
    local file=$1 key=$2 sha=$3
    if aws s3api put-object --bucket "$BUCKET" --key "$key" --body "$file" --if-none-match '*' \
        --metadata "sha256=$sha" >/dev/null 2>"$work/put.err"; then
        echo "uploaded $key"
        return 0
    fi
    grep -q PreconditionFailed "$work/put.err" || die "upload of $key failed"
    aws s3api get-object --bucket "$BUCKET" --key "$key" "$work/existing" >/dev/null
    [ "$(sha256sum "$work/existing" | cut -d' ' -f1)" = "$sha" ] || die "$key exists with other content"
    echo "kept $key (identical)"
}

# Point every function of the manifest at its zip and check the deployed CodeSha256.
update_functions() {
    local manifest=$1
    jq -r '.artifacts[] | select(.type == "function-zip") | .key as $k | .sha256 as $s | .functions[] | "\(.) \($k) \($s)"' "$manifest" |
        while read -r function key sha; do
            aws lambda update-function-code --function-name "$function" --s3-bucket "$BUCKET" \
                --s3-key "$key" >/dev/null || die "update of $function failed"
            aws lambda wait function-updated-v2 --function-name "$function"
            deployed=$(aws lambda get-function-configuration --function-name "$function" --query CodeSha256 --output text)
            [ "$deployed" = "$(b64sha "$sha")" ] || die "$function runs $deployed, not the manifest's $key"
            echo "$function -> $key"
        done
    if jq -e '.artifacts[] | select(.type == "layer-zip")' "$manifest" >/dev/null; then
        echo "::notice::ffmpeg layer $(jq -r '.artifacts[] | select(.type == "layer-zip") | .key' "$manifest"): set the stack parameter AudioLayerKey to change the audio function's layer"
    fi
}

case "$command" in
publish)
    [ $# -eq 3 ] || { echo "usage: $0 publish MANIFEST DIST" >&2; exit 2; }
    manifest=$2 dist=$3
    tool manifest verify "$manifest" --dist "$dist"
    jq -r '.artifacts[] | "\(.file) \(.key) \(.sha256)"' "$manifest" | while read -r file key sha; do
        put_once "$dist/$file" "$key" "$sha"
    done
    key=$(jq -r .manifest_key "$manifest")
    put_once "$manifest" "$key" "$(sha256sum "$manifest" | cut -d' ' -f1)"
    update_functions "$manifest"
    ;;
rollback)
    [ $# -eq 2 ] || { echo "usage: $0 rollback MANIFEST_KEY" >&2; exit 2; }
    [[ "$2" =~ ^releases/processing/[a-f0-9]{40}\.json$ ]] || die "bad manifest key"
    aws s3api get-object --bucket "$BUCKET" --key "$2" "$work/manifest.json" >/dev/null || die "no manifest $2"
    tool manifest validate "$work/manifest.json"
    jq -r '.artifacts[] | "\(.file) \(.key)"' "$work/manifest.json" | while read -r file key; do
        mkdir -p "$work/dist/$(dirname "$file")"
        aws s3api get-object --bucket "$BUCKET" --key "$key" "$work/dist/$file" >/dev/null || die "artifact $key is gone"
    done
    tool manifest verify "$work/manifest.json" --dist "$work/dist"
    update_functions "$work/manifest.json"
    ;;
*)
    echo "usage: $0 publish MANIFEST DIST | rollback MANIFEST_KEY" >&2
    exit 2
    ;;
esac
