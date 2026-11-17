#!/usr/bin/env bash
# Release one Django build on the native dev instance (no Docker).
#
#   deploy-native.sh --git-sha <40 hex> --artifact-sha256 <64 hex> --commit-epoch <unix seconds> \
#       [--run-url <GitHub run URL>] [--allow-older] [--allow-destructive-migrations]
#
# Started by ssm-native-entry.sh (SSM document `lai-dev-native-deploy`), from the release directory
# /opt/lai/releases/<sha>/ it extracted. Steps:
#    1. lock; read the running release        8. migration plan and destructive-operation guard
#    2. validate; refuse an older commit       9. migrate
#    3. render the runtime configuration      10. collectstatic into the release
#    4. venv from the bundled wheels          11. switch /opt/lai/current atomically
#       (lai-processing included)
#    5. install units, gunicorn and nginx     12. restart gunicorn and the jobs services, reload nginx
#       config (`nginx -t`)                    13. health check (live and ready over 127.0.0.1:8080)
#    6. database connectivity                 14. record it; prune old releases
#    7. manage.py check --deploy
# An unhealthy release is rolled back to the previous healthy one. Migrations are never reversed:
# when the failed release applied any, the record says a person must review the database.
# Exit codes are in lib-native.sh.
set -Eeuo pipefail
LAI_SCRIPT=deploy
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"
LAI_BUNDLE_DIR=$(cd "$LAI_SCRIPTS_DIR/../../.." && pwd -P)

usage() {
    sed -n '4,5p' "$0" >&2
    exit "$E_USAGE"
}

git_sha="" artifact_sha="" commit_epoch="" run_url="" allow_older=false allow_destructive=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --git-sha) git_sha=${2:-}; shift 2 ;;
        --artifact-sha256) artifact_sha=${2:-}; shift 2 ;;
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
config_installed=false
previous=$(current_record)
previous_sha=$(jq -r '.git_sha // empty' <<<"$previous")
previous_epoch=$(jq -r '.commit_epoch // 0' <<<"$previous")
previous_dir=""
[ -z "$previous_sha" ] || previous_dir=$(release_dir_for "$previous_sha")

finish() {
    local status=$1 health=$2 code=$3 review=false record
    [ "${#migrations_applied[@]}" -gt 0 ] && [ "$status" != healthy ] && review=true
    record=$(jq -n --arg status "$status" --arg stage "$stage" --arg git_sha "$git_sha" \
        --arg artifact "$artifact_sha" --argjson epoch "${commit_epoch:-0}" --arg run_url "$run_url" \
        --arg started "$started" --arg finished "$(now_iso)" --arg health "$health" \
        --arg prev_sha "$previous_sha" --argjson review "$review" --argjson code "$code" \
        --arg environment "$LAI_ENV" \
        --arg migrations "$(printf '%s\n' "${migrations_applied[@]}" | paste -sd, -)" \
        '{event:"deploy", status:$status, failed_stage:(if $status == "healthy" then null else $stage end),
          git_sha:$git_sha, artifact_sha256:$artifact, commit_epoch:$epoch, run_url:$run_url,
          started_at:$started, finished_at:$finished, health:$health, exit_code:$code,
          previous_git_sha:$prev_sha,
          migrations_applied:($migrations | split(",") | map(select(. != ""))),
          manual_db_review_required:$review, environment:$environment}')
    append_history "$record"
    publish_record "$record"
    printf '%s' "$record"
}

# Before the switch the previous release keeps serving; put its configuration back if ours is in.
fail() {
    local code=$1
    shift
    log "ERROR at stage $stage: $*"
    if [ "$config_installed" = true ] && [ -n "$previous_dir" ] && release_ready "$previous_dir"; then
        install_release_config "$previous_dir" || log "WARNING: could not reinstall the previous configuration"
    fi
    finish failed not_run "$code" >/dev/null
    exit "$code"
}

# --- 2. validate ---------------------------------------------------------------------------------
[[ $git_sha =~ $GIT_SHA_PATTERN ]] || fail "$E_INVALID" "--git-sha must be a full 40-character commit"
[[ $artifact_sha =~ $ARTIFACT_SHA_PATTERN ]] || fail "$E_INVALID" "--artifact-sha256 must be 64 hex characters"
[[ $commit_epoch =~ $EPOCH_PATTERN ]] || fail "$E_INVALID" "--commit-epoch must be unix seconds"
[ -z "$run_url" ] || [[ $run_url =~ $RUN_URL_PATTERN ]] || fail "$E_INVALID" "--run-url is not a GitHub Actions run URL"
release_dir=$(release_dir_for "$git_sha")
if [ "$(cd "$release_dir" 2>/dev/null && pwd -P)" != "$(cd "$LAI_BUNDLE_DIR" && pwd -P)" ]; then
    fail "$E_INVALID" "this script must run from the release it deploys ($release_dir)"
fi
[ "$(jq -r '.git_sha // empty' "$release_dir/RELEASE.json" 2>/dev/null)" = "$git_sha" ] ||
    fail "$E_INVALID" "RELEASE.json does not name $git_sha"
[ "$(cat "$release_dir/ARTIFACT_SHA256" 2>/dev/null)" = "$artifact_sha" ] ||
    fail "$E_INVALID" "the release directory was not extracted from artifact $artifact_sha"
if [ "$commit_epoch" -lt "$previous_epoch" ] && [ "$allow_older" != true ]; then
    fail "$E_INVALID" "$git_sha is older than the running release $previous_sha; refusing an out-of-order" \
        "release (use the rollback, or dispatch with allow_older)"
fi
log "deploying $git_sha to $LAI_ENV; running: ${previous_sha:-nothing}"

# --- 3. configuration ----------------------------------------------------------------------------
stage=config
"$LAI_SCRIPTS_DIR/render-env-native.sh" || fail "$E_CONFIG" "runtime configuration is incomplete"
printf 'LAI_RELEASE_SHA=%s\n' "$git_sha" >"$release_dir/release.env"

# --- 4. venv -------------------------------------------------------------------------------------
stage=venv
if [ ! -f "$release_dir/venv/.lai-complete" ]; then
    rm -rf "$release_dir/venv"
    log "creating the release venv from the bundled wheels"
    "$LAI_PYTHON" -m venv "$release_dir/venv" || fail "$E_PREFLIGHT" "could not create the venv"
    "$release_dir/venv/bin/python" -m pip install --quiet --no-index --disable-pip-version-check \
        --find-links "$release_dir/wheels" -r "$release_dir/requirements.txt" ||
        fail "$E_PREFLIGHT" "pip could not install the bundled wheels"
    # lai_processing and lai_processing_runtime (processing/, LAI-LAMBDA-005): one pure-Python
    # wheel that package-release.sh builds; it has no dependencies of its own.
    processing_wheels=("$release_dir"/wheels/lai_processing-*.whl)
    if [ -f "${processing_wheels[0]}" ]; then
        "$release_dir/venv/bin/python" -m pip install --quiet --no-index --no-deps \
            --disable-pip-version-check "${processing_wheels[@]}" ||
            fail "$E_PREFLIGHT" "pip could not install the lai-processing wheel"
    else
        log "WARNING: this release has no lai-processing wheel (built with --skip-wheels?)"
    fi
    touch "$release_dir/venv/.lai-complete"
fi

# --- 5. units, gunicorn and nginx configuration -------------------------------------------------
stage=install
config_installed=true
install_release_config "$release_dir" || fail "$E_CONFIG" "the release's nginx configuration failed nginx -t"

# --- 6 to 8. preflight ---------------------------------------------------------------------------
stage=preflight
db_check "$release_dir" "$git_sha" >/dev/null 2>&1 || fail "$E_PREFLIGHT" "cannot connect to the database"
manage "$release_dir" "$git_sha" check --deploy --fail-level ERROR >/dev/null ||
    fail "$E_PREFLIGHT" "manage.py check --deploy failed"
plan=$(manage "$release_dir" "$git_sha" migrate --plan --noinput) ||
    fail "$E_PREFLIGHT" "could not read the migration plan"
mapfile -t pending < <(grep -E '^[[:space:]]*[a-z_]+\.[0-9]{4}_' <<<"$plan" | awk '{print $1}')
log "pending migrations: ${#pending[@]}${pending:+ (${pending[*]})}"
# Operations that break the release still running beside the database, or a rollback to it.
destructive=$(grep -E '^[[:space:]]+(Remove field|Delete model|Rename field|Rename model|Raw SQL operation)' <<<"$plan" || true)
# An empty database has no release that could depend on it, and Django's own history contains
# such operations (contenttypes.0002 removes a field).
if printf '%s\n' "${pending[@]}" | grep -qx 'contenttypes.0001_initial'; then
    [ -z "$destructive" ] || log "new database: applying the full migration history"
    destructive=""
fi
if [ -n "$destructive" ] && [ "$allow_destructive" != true ]; then
    log "the plan contains operations the previous release cannot run against:"
    printf '%s\n' "$destructive" | sed 's/^[[:space:]]*/    /' >&2
    fail "$E_DESTRUCTIVE" "refusing destructive migrations; ship them as a separate, approved release" \
        "(dispatch with allow_destructive_migrations) after the code no longer uses them"
fi

# --- 9. migrate ----------------------------------------------------------------------------------
if [ "${#pending[@]}" -gt 0 ]; then
    stage=migrate
    if ! manage "$release_dir" "$git_sha" migrate --noinput; then
        migrations_applied=("${pending[@]}")
        log "migration failed; the previous release keeps running. Some of these may be applied:" \
            "${pending[*]}. MANUAL DATABASE REVIEW REQUIRED."
        fail "$E_MIGRATE" "manage.py migrate failed"
    fi
    migrations_applied=("${pending[@]}")
fi

# --- 10. static files (no database, no secrets) ---------------------------------------------------
stage=collectstatic
if [ ! -d "$release_dir/lai/staticfiles" ]; then
    (cd "$release_dir/lai" && env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 PYTHONDONTWRITEBYTECODE=1 \
        DJANGO_SETTINGS_MODULE=config.settings.static_build \
        "$release_dir/venv/bin/python" manage.py collectstatic --noinput >/dev/null) ||
        { rm -rf "$release_dir/lai/staticfiles"; fail "$E_PREFLIGHT" "collectstatic failed"; }
fi
ln -sfn lai/staticfiles "$release_dir/static"

# --- 11 to 13. switch, restart and check -----------------------------------------------------------
stage=start
switch_current "$release_dir"
if restart_services && verify_health; then
    record=$(finish healthy pass 0)
    set_current_record "$record"
    log "release $git_sha is healthy and current"
    prune_releases || log "WARNING: pruning old releases failed (harmless)"
    exit 0
fi

stage=health
log "release $git_sha is UNHEALTHY"
tail -n 40 "$LAI_LOG_DIR/django.log" 2>/dev/null | sed 's/^/    /' >&2 || true
if [ -z "$previous_sha" ]; then
    finish failed fail "$E_HEALTH_NO_PREVIOUS" >/dev/null
    log "there is no previous healthy release to roll back to"
    exit "$E_HEALTH_NO_PREVIOUS"
fi
attempt=$(finish failed fail "$E_HEALTH_ROLLED_BACK")
if rollback_to "$previous" automatic "$attempt"; then
    exit "$E_HEALTH_ROLLED_BACK"
fi
exit "$E_ROLLBACK_FAILED"
