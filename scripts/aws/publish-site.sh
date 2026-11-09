#!/usr/bin/env bash
# Publish the React build to the LaiFrontend-<env> bucket, or roll the site back (LAI-INFRA-004,
# docs/infrastructure/deployment-design.md). Run by .github/workflows/deploy-site.yml; writes to
# AWS, so only for an approved environment.
#
#   scripts/aws/publish-site.sh publish <dist-dir> <bucket> <distribution-id> <git-sha>
#   scripts/aws/publish-site.sh rollback <bucket> <distribution-id> <git-sha>
#
# Order matters. Content-hashed files go first and are never deleted, so a browser still running
# the previous release (or a rollback) can always load its scripts. The HTML shells (index.html,
# and game/index.html once the Android game runtime exists) go last, so no shell ever names a
# file that is not there yet. Each release also keeps its shells under _releases/<sha>/: a rollback
# copies them back and invalidates, with no rebuild. The bucket is versioned as a second net.
#
# Cache-Control (CloudFront's CachingOptimized policy honours it):
#   assets/*        public, max-age=31536000, immutable   (Vite output: hashed names)
#   HTML shells     no-cache                              (always revalidated)
#   everything else public, max-age=3600                  (react/public: stable names)
set -Eeuo pipefail

export AWS_REGION=${AWS_REGION:-us-east-1}
SHELLS=(index.html game/index.html)
IMMUTABLE='public, max-age=31536000, immutable'
STABLE='public, max-age=3600'

usage() {
    sed -n '6,7p' "$0" >&2
    exit 2
}

check_sha() {
    [[ $1 =~ ^[a-f0-9]{40}$ ]] || { echo "git sha must be 40 hex characters, got '$1'" >&2; exit 2; }
}

invalidate() { # invalidate <distribution-id> <path>...
    local distribution=$1
    shift
    local id
    id=$(aws cloudfront create-invalidation --distribution-id "$distribution" --paths "$@" \
        --query Invalidation.Id --output text)
    echo "invalidation $id: $*"
    aws cloudfront wait invalidation-completed --distribution-id "$distribution" --id "$id"
}

publish() {
    [ "$#" -eq 4 ] || usage
    local dist=$1 bucket=$2 distribution=$3 sha=$4
    check_sha "$sha"
    [ -f "$dist/index.html" ] || { echo "no index.html in $dist" >&2; exit 2; }

    if [ -d "$dist/assets" ]; then
        aws s3 sync "$dist/assets/" "s3://$bucket/assets/" \
            --cache-control "$IMMUTABLE" --only-show-errors
    fi
    local excludes=(--exclude 'assets/*' --exclude '_releases/*')
    local shell
    for shell in "${SHELLS[@]}"; do excludes+=(--exclude "$shell"); done
    aws s3 sync "$dist/" "s3://$bucket/" "${excludes[@]}" \
        --cache-control "$STABLE" --only-show-errors

    local paths=()
    for shell in "${SHELLS[@]}"; do
        [ -f "$dist/$shell" ] || continue
        aws s3 cp "$dist/$shell" "s3://$bucket/_releases/$sha/$shell" \
            --cache-control no-cache --content-type 'text/html; charset=utf-8' --only-show-errors
        aws s3 cp "$dist/$shell" "s3://$bucket/$shell" \
            --cache-control no-cache --content-type 'text/html; charset=utf-8' --only-show-errors
        paths+=("/$shell")
    done
    invalidate "$distribution" "${paths[@]}"
    echo "published $sha to s3://$bucket"
}

rollback() {
    [ "$#" -eq 3 ] || usage
    local bucket=$1 distribution=$2 sha=$3
    check_sha "$sha"
    aws s3api head-object --bucket "$bucket" --key "_releases/$sha/index.html" >/dev/null 2>&1 ||
        { echo "no release $sha in s3://$bucket/_releases/ (only published releases can be restored)" >&2; exit 1; }

    local paths=() shell
    for shell in "${SHELLS[@]}"; do
        aws s3api head-object --bucket "$bucket" --key "_releases/$sha/$shell" >/dev/null 2>&1 ||
            continue
        aws s3 cp "s3://$bucket/_releases/$sha/$shell" "s3://$bucket/$shell" \
            --cache-control no-cache --content-type 'text/html; charset=utf-8' \
            --metadata-directive REPLACE --only-show-errors
        paths+=("/$shell")
    done
    invalidate "$distribution" "${paths[@]}"
    echo "rolled s3://$bucket back to $sha"
}

case "${1:-}" in
    publish) shift; publish "$@" ;;
    rollback) shift; rollback "$@" ;;
    *) usage ;;
esac
