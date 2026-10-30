#!/usr/bin/env bash
# Body of the SSM document `lai-django-deploy-<env>` (ADR-037). The stack embeds this file in the
# document at synth time (infra/lib/djangoEc2Stack.ts), so the instance runs only this fixed code
# with the document's pattern-checked parameters; nothing from the caller is executed as a command.
#
# Expects, from the document: LAI_REQ_IMAGE, LAI_REQ_GIT_SHA, LAI_REQ_COMMIT_EPOCH, LAI_REQ_RUN_URL,
# LAI_REQ_ALLOW_OLDER (true|false), LAI_REQ_ALLOW_DESTRUCTIVE (true|false).
#
# It pulls the image by digest with the instance role, copies the deploy bundle (scripts/aws and
# deploy/ec2, see lai/Dockerfile) out of that same image into /opt/lai/releases/<digest>/, and runs
# that bundle's deploy-django.sh. The release logic therefore always matches the image it deploys,
# and the instance needs no source checkout.
set -Eeuo pipefail
LAI_ROOT=${LAI_ROOT:-/opt/lai}
LAI_CONF=${LAI_CONF:-/etc/lai/deploy.conf}

say() { printf '%s [ssm-entry] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
fail() { say "ERROR: $2"; exit "$1"; }

[ -r "$LAI_CONF" ] || fail 30 "missing $LAI_CONF; the instance was not set up (setup-ec2.sh)"
# shellcheck source=/dev/null
. "$LAI_CONF"

image=${LAI_REQ_IMAGE:-}
[[ $image =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9][a-z0-9/_.-]*@sha256:[a-f0-9]{64}$ ]] ||
    fail 10 "the image must be an ECR reference pinned by digest"
[ "${image%@*}" = "$LAI_ECR_REPOSITORY_URI" ] || fail 11 "the image is not from $LAI_ECR_REPOSITORY_URI"
digest=${image##*@sha256:}
release_dir="$LAI_ROOT/releases/$digest"

say "pulling $image"
registry=${LAI_ECR_REPOSITORY_URI%%/*}
aws ecr get-login-password --region "$AWS_REGION" |
    docker login --username AWS --password-stdin "$registry" >/dev/null ||
    fail 20 "ECR login failed (instance role)"
docker pull --quiet "$image" >/dev/null || fail 20 "docker pull failed for $image"

if [ ! -f "$release_dir/scripts/aws/deploy-django.sh" ]; then
    mkdir -p "$LAI_ROOT/releases"
    staging=$(mktemp -d "$LAI_ROOT/releases/.staging.XXXXXX")
    cid=$(docker create "$image")
    trap 'docker rm -f "$cid" >/dev/null 2>&1 || true; rm -rf "$staging"' EXIT
    docker cp "$cid:/app/deploy/." "$staging/" || fail 12 "the image has no deploy bundle at /app/deploy"
    [ -f "$staging/scripts/aws/deploy-django.sh" ] || fail 12 "the image's deploy bundle is incomplete"
    chmod -R go-w "$staging"
    mv -T "$staging" "$release_dir"
fi

args=(--image "$image" --git-sha "${LAI_REQ_GIT_SHA:-}" --commit-epoch "${LAI_REQ_COMMIT_EPOCH:-}")
[ -n "${LAI_REQ_RUN_URL:-}" ] && args+=(--run-url "$LAI_REQ_RUN_URL")
[ "${LAI_REQ_ALLOW_OLDER:-false}" = true ] && args+=(--allow-older)
[ "${LAI_REQ_ALLOW_DESTRUCTIVE:-false}" = true ] && args+=(--allow-destructive-migrations)
exec bash "$release_dir/scripts/aws/deploy-django.sh" "${args[@]}"
