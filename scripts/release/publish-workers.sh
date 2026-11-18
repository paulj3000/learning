#!/usr/bin/env bash
# Publish or roll back processing worker artifacts by release manifest (ADR-071). Run by
# .github/workflows/release-prod-workers.yml with the lai-github-workers-prod role; never by a push.
#
#   publish-workers.sh publish MANIFEST DIST [--upload-only]
#   publish-workers.sh rollback MANIFEST_KEY
#
# publish: verify every artifact against the manifest, upload each create-only (If-None-Match: *;
# an existing key with the same SHA-256 is accepted, a different one refused), store the manifest
# the same way (it is deterministic, so a re-dispatch of the same commit finds it identical), then
# point each existing function at its zip and check the deployed CodeSha256.
#   --upload-only   upload and store only, update no function: the first release, before the
#                   stack has created the functions (their Enable* parameter needs the code key,
#                   which this upload provides; then a change set creates them from it).
# A function that does not exist (its worker is disabled) is skipped with a notice; the others are
# still updated. The FFmpeg layer and every executable pin are stack parameters (the release role
# cannot change function configuration): the job prints them (`stack-parameters`) for the owner's
# provision.sh change set.
#
# Settings: BUCKET (the environment's artifacts bucket), AWS_REGION.
# Exit codes: 0 done, 1 verification or AWS failure, 2 usage.
set -Eeuo pipefail
tool() { python3 -I "$(dirname "${BASH_SOURCE[0]}")/processing_release.py" "$@"; }
die() { echo "::error::$*" >&2; exit 1; }
usage() { echo "usage: $0 publish MANIFEST DIST [--upload-only] | rollback MANIFEST_KEY" >&2; exit 2; }
command=${1:-}
[ -n "$command" ] || usage
[ -n "${BUCKET:-}" ] || die "BUCKET is not set"
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
    aws s3api get-object --bucket "$BUCKET" --key "$key" "$work/existing" >/dev/null ||
        die "cannot read the existing $key"
    [ "$(sha256sum "$work/existing" | cut -d' ' -f1)" = "$sha" ] || die "$key exists with other content"
    echo "kept $key (identical)"
}

# Point every existing function of the manifest at its zip and check the deployed CodeSha256.
update_functions() {
    local manifest=$1 function key sha deployed updated=0 skipped=0
    while read -r function key sha; do
        if ! aws lambda get-function --function-name "$function" >/dev/null 2>"$work/get.err"; then
            grep -q ResourceNotFoundException "$work/get.err" || die "cannot read $function"
            echo "::notice::$function does not exist (its worker is disabled); skipped"
            skipped=$((skipped + 1))
            continue
        fi
        aws lambda update-function-code --function-name "$function" --s3-bucket "$BUCKET" \
            --s3-key "$key" >/dev/null || die "update of $function failed"
        aws lambda wait function-updated-v2 --function-name "$function"
        deployed=$(aws lambda get-function-configuration --function-name "$function" --query CodeSha256 --output text)
        [ "$deployed" = "$(b64sha "$sha")" ] || die "$function runs $deployed, not the manifest's $key"
        echo "$function -> $key"
        updated=$((updated + 1))
    done < <(jq -r '.artifacts[] | select(.type == "function-zip") | .key as $k | .sha256 as $s | .functions[] | "\(.) \($k) \($s)"' "$manifest")
    echo "functions updated: $updated, skipped (absent): $skipped"
}

stack_notice() {
    echo "::notice::stack parameters for this release (owner change set, scripts/aws/provision.sh):"
    tool stack-parameters "$1"
}

case "$command" in
publish)
    [ $# -ge 3 ] && [ $# -le 4 ] || usage
    manifest=$2 dist=$3 upload_only=false
    [ $# -eq 3 ] || { [ "$4" = --upload-only ] || usage; upload_only=true; }
    tool manifest verify "$manifest" --dist "$dist"
    while read -r file key sha; do
        put_once "$dist/$file" "$key" "$sha"
    done < <(jq -r '.artifacts[] | "\(.file) \(.key) \(.sha256)"' "$manifest")
    put_once "$manifest" "$(jq -r .manifest_key "$manifest")" "$(sha256sum "$manifest" | cut -d' ' -f1)"
    if [ "$upload_only" = true ]; then
        echo "upload only: no function updated"
    else
        update_functions "$manifest"
    fi
    stack_notice "$manifest"
    ;;
rollback)
    [ $# -eq 2 ] || usage
    [[ "$2" =~ ^releases/processing/[a-f0-9]{40}\.json$ ]] || die "bad manifest key"
    aws s3api get-object --bucket "$BUCKET" --key "$2" "$work/manifest.json" >/dev/null || die "no manifest $2"
    tool manifest validate "$work/manifest.json"
    # The workflow's typed confirmation states every processing control is off (F4).
    tool rollback-plan --target "$work/manifest.json" --controls-off >/dev/null
    while read -r file key; do
        mkdir -p "$work/dist/$(dirname "$file")"
        aws s3api get-object --bucket "$BUCKET" --key "$key" "$work/dist/$file" >/dev/null || die "artifact $key is gone"
    done < <(jq -r '.artifacts[] | "\(.file) \(.key)"' "$work/manifest.json")
    tool manifest verify "$work/manifest.json" --dist "$work/dist"
    update_functions "$work/manifest.json"
    stack_notice "$work/manifest.json"
    ;;
*) usage ;;
esac
