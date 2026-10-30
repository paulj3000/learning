#!/usr/bin/env bash
# Release one Django image on this instance (ADR-037, docs/platform/DJANGO_EC2_DEPLOYMENT.md).
#
#   deploy-django.sh --image <account>.dkr.ecr.<region>.amazonaws.com/<repo>@sha256:<digest> \
#       --git-sha <40 hex> --commit-epoch <unix seconds> [--run-url <GitHub run URL>] \
#       [--allow-older] [--allow-destructive-migrations]
#
# Normally started by the SSM document `lai-django-deploy-<env>` (ssm-release-entry.sh), which
# pulls the image and runs this script from the bundle inside that same image. Steps:
#    1. take the deployment lock            8. snapshot RDS first (prod, when migrations are pending)
#    2. read the running release            9. migrate with the new image
#    3. validate the request and ordering  10. start the new release (short interruption)
#    4. pull the image (ECR, instance role) 11. health check: live, ready, right image
#    5. check the image's release labels   12. record it, point /opt/lai/current at it
#    6. render the runtime configuration   13. prune old images and bundles (never volumes)
#    7. preflight: compose config, `check --deploy`, migration plan and destructive-operation guard
# Static files are collected when the image is built (lai/Dockerfile), so there is no collectstatic
# step here. If the new release is unhealthy it rolls back to the previous healthy one
# automatically. Migrations are never reversed: when the failed release applied any, the record
# and the output say a person must review the database. Exit codes are in lib.sh.
set -Eeuo pipefail
LAI_SCRIPT=deploy
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"
LAI_BUNDLE_DIR=$(cd "$LAI_SCRIPTS_DIR/../.." && pwd)

usage() {
    sed -n '4,6p' "$0" >&2
    exit "$E_USAGE"
}

image="" git_sha="" commit_epoch="" run_url="" allow_older=false allow_destructive=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --image) image=${2:-}; shift 2 ;;
        --git-sha) git_sha=${2:-}; shift 2 ;;
        --commit-epoch) commit_epoch=${2:-}; shift 2 ;;
        --run-url) run_url=${2:-}; shift 2 ;;
        --allow-older) allow_older=true; shift ;;
        --allow-destructive-migrations) allow_destructive=true; shift ;;
        *) usage ;;
    esac
done

load_conf
ensure_dirs
acquire_lock

started=$(now_iso)
stage=validate
migrations_applied=()
previous=$(current_record)
previous_sha=$(jq -r '.git_sha // empty' <<<"$previous")
previous_digest=$(jq -r '.image_digest // empty' <<<"$previous")
previous_epoch=$(jq -r '.commit_epoch // 0' <<<"$previous")

# Record the attempt's outcome (and anything it changed) before exiting.
finish() {
    local status=$1 health=$2 code=$3 review=false
    [ "${#migrations_applied[@]}" -gt 0 ] && [ "$status" != healthy ] && review=true
    local record
    record=$(jq -n --arg status "$status" --arg stage "$stage" --arg image "$image" \
        --arg digest "${image##*@}" --arg git_sha "$git_sha" --argjson epoch "${commit_epoch:-0}" \
        --arg run_url "$run_url" --arg started "$started" --arg finished "$(now_iso)" \
        --arg health "$health" --arg prev_sha "$previous_sha" --arg prev_digest "$previous_digest" \
        --argjson review "$review" --argjson code "$code" --arg environment "$LAI_ENV" \
        --arg migrations "$(printf '%s\n' "${migrations_applied[@]}" | paste -sd, -)" \
        '{event:"deploy", status:$status, failed_stage:(if $status == "healthy" then null else $stage end),
          image:$image, image_digest:$digest, git_sha:$git_sha, commit_epoch:$epoch, run_url:$run_url,
          started_at:$started, finished_at:$finished, health:$health, exit_code:$code,
          previous_git_sha:$prev_sha, previous_image_digest:$prev_digest,
          migrations_applied:($migrations | split(",") | map(select(. != ""))),
          manual_db_review_required:$review, environment:$environment}')
    append_history "$record"
    publish_record "$record"
    printf '%s' "$record"
}

fail() {
    local code=$1
    shift
    log "ERROR at stage $stage: $*"
    finish failed not_run "$code" >/dev/null
    exit "$code"
}

# --- 3. validate ---------------------------------------------------------------------------------
[[ $image =~ $IMAGE_URI_PATTERN ]] || fail "$E_INVALID" "--image must be an ECR image pinned by digest"
[[ $git_sha =~ $GIT_SHA_PATTERN ]] || fail "$E_INVALID" "--git-sha must be a full 40-character commit"
[[ $commit_epoch =~ $EPOCH_PATTERN ]] || fail "$E_INVALID" "--commit-epoch must be unix seconds"
[ -z "$run_url" ] || [[ $run_url =~ $RUN_URL_PATTERN ]] || fail "$E_INVALID" "--run-url is not a GitHub Actions run URL"
[ "${image%@*}" = "$LAI_ECR_REPOSITORY_URI" ] ||
    fail "$E_REPOSITORY" "the image is not from this environment's repository ($LAI_ECR_REPOSITORY_URI)"
if [ "$commit_epoch" -lt "$previous_epoch" ] && [ "$allow_older" != true ]; then
    fail "$E_OLDER" "$git_sha is older than the running release $previous_sha; refusing an out-of-order" \
        "release (use the rollback, or dispatch with allow_older)"
fi
release_dir=$(release_dir_for "$image")
if [ "$(cd "$release_dir" 2>/dev/null && pwd -P)" != "$(cd "$LAI_BUNDLE_DIR" && pwd -P)" ]; then
    fail "$E_INVALID" "this script must run from the bundle of the image it deploys ($release_dir)"
fi
log "deploying $git_sha ($image) to $LAI_ENV; running: ${previous_sha:-nothing}"

# --- 4 and 5. image ------------------------------------------------------------------------------
stage=pull
ensure_image "$image" || fail "$E_PULL" "could not pull $image"
stage=image_labels
labels=$(docker image inspect --format '{{json .Config.Labels}}' "$image")
[ "$(jq -r '."org.opencontainers.image.revision" // empty' <<<"$labels")" = "$git_sha" ] ||
    fail "$E_IMAGE_LABEL" "the image's revision label does not match $git_sha"
[ "$(jq -r '."org.learning-adventure-island.release-channel" // empty' <<<"$labels")" = release ] ||
    fail "$E_IMAGE_LABEL" "the image was not built by the release pipeline (release-channel label)"

# --- 6. configuration ----------------------------------------------------------------------------
stage=config
"$LAI_SCRIPTS_DIR/render-env.sh" || fail "$E_CONFIG" "runtime configuration is incomplete"
write_release_env "$release_dir" "$image" "$git_sha"

# --- 7. preflight --------------------------------------------------------------------------------
stage=preflight
compose_for "$release_dir" config --quiet || fail "$E_PREFLIGHT" "docker compose rejected the configuration"
if [ "$LAI_DB_MODE" = container ]; then
    compose_for "$release_dir" up -d --wait --wait-timeout 120 db ||
        fail "$E_PREFLIGHT" "the database container did not become healthy"
fi
manage() { compose_for "$release_dir" run --rm --no-deps -T django python manage.py "$@"; }
manage check --deploy --fail-level ERROR >/dev/null || fail "$E_PREFLIGHT" "manage.py check --deploy failed"
plan=$(manage migrate --plan --noinput) || fail "$E_PREFLIGHT" "could not read the migration plan (database?)"
mapfile -t pending < <(grep -E '^[[:space:]]*[a-z_]+\.[0-9]{4}_' <<<"$plan" | awk '{print $1}')
log "pending migrations: ${#pending[@]}${pending:+ (${pending[*]})}"
# Operations that break the release still running beside the database, or a rollback to it.
destructive=$(grep -E '^[[:space:]]+(Remove field|Delete model|Rename field|Rename model|Raw SQL operation)' <<<"$plan" || true)
if [ -n "$destructive" ] && [ "$allow_destructive" != true ]; then
    log "the plan contains operations the previous release cannot run against:"
    printf '%s\n' "$destructive" | sed 's/^[[:space:]]*/    /'
    fail "$E_DESTRUCTIVE" "refusing destructive migrations; ship them as a separate, approved release" \
        "(dispatch with allow_destructive_migrations) after the code no longer uses them"
fi

# --- 8. snapshot ---------------------------------------------------------------------------------
if [ "${#pending[@]}" -gt 0 ] && [ "$LAI_DB_MODE" = rds ] && [ "${LAI_PREMIGRATION_SNAPSHOT:-false}" = true ]; then
    stage=snapshot
    snapshot="lai-$LAI_ENV-pre-${git_sha:0:12}-$(date -u +%Y%m%d%H%M%S)"
    log "creating RDS snapshot $snapshot before migrating"
    if ! aws rds create-db-snapshot --db-instance-identifier "$LAI_DB_INSTANCE_ID" \
        --db-snapshot-identifier "$snapshot" >/dev/null ||
        ! aws rds wait db-snapshot-available --db-snapshot-identifier "$snapshot"; then
        fail "$E_SNAPSHOT" "the pre-migration snapshot failed; nothing was migrated"
    fi
fi

# --- 9. migrate ----------------------------------------------------------------------------------
if [ "${#pending[@]}" -gt 0 ]; then
    stage=migrate
    if ! manage migrate --noinput; then
        # Each migration runs in its own transaction on PostgreSQL: the failing one was rolled back,
        # earlier ones in the plan may be applied. The running release was not touched.
        migrations_applied=("${pending[@]}")
        log "migration failed; the previous release keeps running. Some of these may be applied:" \
            "${pending[*]}. MANUAL DATABASE REVIEW REQUIRED."
        fail "$E_MIGRATE" "manage.py migrate failed"
    fi
    migrations_applied=("${pending[@]}")
fi

# --- 10 and 11. start and check ------------------------------------------------------------------
stage=start
if activate_release "$release_dir" "$image"; then
    # --- 12. record ------------------------------------------------------------------------------
    record=$(finish healthy pass 0)
    set_current "$record" "$release_dir"
    log "release $git_sha is healthy and current"
    # --- 13. prune -------------------------------------------------------------------------------
    "$LAI_SCRIPTS_DIR/prune-releases.sh" || log "WARNING: pruning old releases failed (harmless)"
    exit 0
fi

stage=health
log "release $git_sha is UNHEALTHY"
compose_for "$release_dir" logs --no-color --tail 80 django 2>&1 | sed 's/^/    /' || true
attempt=$(finish failed fail "$E_HEALTH_ROLLED_BACK")
if [ -z "$previous_digest" ]; then
    log "there is no previous healthy release to roll back to"
    exit "$E_HEALTH_NO_PREVIOUS"
fi
if rollback_to "$previous" automatic "$attempt"; then
    exit "$E_HEALTH_ROLLED_BACK"
fi
exit "$E_ROLLBACK_FAILED"
