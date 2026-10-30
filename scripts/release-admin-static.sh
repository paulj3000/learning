#!/bin/sh
# Upload Django Admin's static files from a built image to the admin's S3 bucket (LAI-0404).
#
#   scripts/release-admin-static.sh <image> <bucket> [--dry-run]
#   e.g. scripts/release-admin-static.sh lai-django:3292aba lai-admin-static-dev
#
# Release order: build the image, run this, then roll the Django service to the same image. The
# files come out of the image itself, so their hashed names always match the manifest that image
# serves (lai/config/settings/static_build.py). Old files are never deleted: during a rollout or a
# rollback older containers still reference them. Every name is content-hashed, so the files are
# cached as immutable and no CloudFront invalidation is needed.
#
# Needs Docker and the AWS CLI with credentials allowed to write the bucket (s3:PutObject,
# s3:ListBucket). This writes to AWS: run it only for an approved environment.
set -eu

if [ "$#" -lt 2 ]; then
    echo "usage: $0 <image> <bucket> [--dry-run]" >&2
    exit 2
fi
image=$1
bucket=$2
dry_run=${3:-}

workdir=$(mktemp -d)
container=$(docker create "$image")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

docker cp "$container:/app/lai/staticfiles/." "$workdir/"
test -f "$workdir/staticfiles.json" || { echo "no manifest in $image" >&2; exit 1; }

# The manifest stays in the image (Django reads it); pre-compressed copies are left out because
# CloudFront compresses on its own and S3 would serve them with the wrong Content-Type.
aws s3 sync "$workdir/" "s3://$bucket/static/" \
    --exclude "staticfiles.json" --exclude "*.gz" --exclude "*.br" \
    --cache-control "public, max-age=31536000, immutable" \
    --only-show-errors $dry_run

echo "Uploaded static files from $image to s3://$bucket/static/"
