# shellcheck shell=bash
# shellcheck disable=SC2034 # constants and patterns are used by the scripts that source this file
# Shared functions for the EC2 release scripts (ADR-037, docs/platform/DJANGO_EC2_DEPLOYMENT.md).
# Sourced, never executed. Every path can be overridden so the tests can run against a temporary
# directory with fake `docker`, `aws` and `curl` commands (scripts/aws/tests/).
#
# On the instance:
#   /etc/lai/deploy.conf            written by setup-ec2.sh from the stack's values (no secrets)
#   /opt/lai/releases/<digest>/     one directory per image: the deploy bundle copied out of it
#   /opt/lai/current -> releases/.. the release that last passed its health check
#   /opt/lai/runtime/django.env     runtime configuration and secrets, mode 0600, rebuilt each release
#   /opt/lai/state/releases.jsonl   the release history (append only)
#   /opt/lai/state/current.json     the record of the running, healthy release
#   /var/log/lai/deploy.log         every line these scripts print (shipped to CloudWatch)

LAI_ROOT=${LAI_ROOT:-/opt/lai}
LAI_CONF=${LAI_CONF:-/etc/lai/deploy.conf}
LAI_LOG_DIR=${LAI_LOG_DIR:-/var/log/lai}
LAI_LOCK_FILE=${LAI_LOCK_FILE:-/run/lock/lai-deploy.lock}
LAI_LOCK_WAIT_SECONDS=${LAI_LOCK_WAIT_SECONDS:-600}
LAI_KEEP_RELEASES=${LAI_KEEP_RELEASES:-5}
LAI_COMPOSE_PROJECT=lai

# Exit codes. The GitHub workflow reports any of these as an application deployment failure and
# anything else (SSM delivery, timeouts) as a transport failure.
readonly E_USAGE=2
readonly E_INVALID=10
readonly E_REPOSITORY=11
readonly E_IMAGE_LABEL=12
readonly E_OLDER=15
readonly E_PULL=20
readonly E_CONFIG=30
readonly E_PREFLIGHT=40
readonly E_DESTRUCTIVE=45
readonly E_SNAPSHOT=48
readonly E_MIGRATE=50
readonly E_HEALTH_ROLLED_BACK=60
readonly E_HEALTH_NO_PREVIOUS=61
readonly E_ROLLBACK_FAILED=62
readonly E_NOTHING_TO_ROLL_BACK=63
readonly E_LOCK=70

# The patterns the SSM documents enforce too (infra/lib/djangoEc2Stack.ts).
readonly IMAGE_URI_PATTERN='^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9][a-z0-9/_.-]*@sha256:[a-f0-9]{64}$'
readonly GIT_SHA_PATTERN='^[a-f0-9]{40}$'
readonly EPOCH_PATTERN='^[0-9]{9,11}$'
readonly RUN_URL_PATTERN='^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$'

LAI_STATE_DIR="$LAI_ROOT/state"
LAI_RELEASES_DIR="$LAI_ROOT/releases"
LAI_RUNTIME_DIR="$LAI_ROOT/runtime"
LAI_HISTORY="$LAI_STATE_DIR/releases.jsonl"
LAI_CURRENT="$LAI_STATE_DIR/current.json"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
    local line
    line="$(now_iso) [${LAI_SCRIPT:-lai}] $*"
    # stderr, so a function's captured stdout (a JSON record) is never mixed with log lines.
    printf '%s\n' "$line" >&2
    if [ -d "$LAI_LOG_DIR" ] && [ -w "$LAI_LOG_DIR" ]; then
        printf '%s\n' "$line" >>"$LAI_LOG_DIR/deploy.log"
    fi
}

die() {
    local code=$1
    shift
    log "ERROR: $*"
    exit "$code"
}

load_conf() {
    [ -r "$LAI_CONF" ] || die "$E_CONFIG" "missing $LAI_CONF (run setup-ec2.sh first)"
    # shellcheck source=/dev/null
    . "$LAI_CONF"
    local name
    for name in LAI_ENV AWS_REGION LAI_ECR_REPOSITORY_URI LAI_PARAM_PREFIX LAI_DB_MODE LAI_API_HOST \
        LAI_APP_LOG_GROUP; do
        [ -n "${!name:-}" ] || die "$E_CONFIG" "$name is not set in $LAI_CONF"
    done
    case "$LAI_ENV" in dev | prod) ;; *) die "$E_CONFIG" "LAI_ENV must be dev or prod" ;; esac
    case "$LAI_DB_MODE" in
        rds) [ -n "${LAI_DB_SECRET_ARN:-}" ] || die "$E_CONFIG" "LAI_DB_SECRET_ARN is required for rds" ;;
        container) [ "$LAI_ENV" = dev ] || die "$E_CONFIG" "the container database is for dev only" ;;
        *) die "$E_CONFIG" "LAI_DB_MODE must be rds or container" ;;
    esac
    LAI_DATA_DIR=${LAI_DATA_DIR:-/var/lib/lai-data}
    LAI_CERTS_DIR=${LAI_CERTS_DIR:-$LAI_ROOT/certs}
    export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
}

acquire_lock() {
    mkdir -p "$(dirname "$LAI_LOCK_FILE")"
    exec 9>"$LAI_LOCK_FILE"
    if ! flock -w "$LAI_LOCK_WAIT_SECONDS" 9; then
        die "$E_LOCK" "another release is still running (lock $LAI_LOCK_FILE)"
    fi
    # Released when the process exits, however it exits.
}

ensure_dirs() {
    mkdir -p "$LAI_STATE_DIR" "$LAI_RELEASES_DIR" "$LAI_RUNTIME_DIR"
    chmod 0700 "$LAI_RUNTIME_DIR"
}

# The release id is the image digest's hex: one directory per immutable image.
release_id_for() { local image=$1; printf '%s' "${image##*@sha256:}"; }
release_dir_for() { printf '%s/%s' "$LAI_RELEASES_DIR" "$(release_id_for "$1")"; }

current_record() { [ -s "$LAI_CURRENT" ] && cat "$LAI_CURRENT" || printf '{}'; }

# Append one JSON object (one line) to the history.
append_history() {
    local record=$1
    printf '%s\n' "$(jq -c . <<<"$record")" >>"$LAI_HISTORY"
}

set_current() {
    local record=$1 release_dir=$2
    jq -c . <<<"$record" >"$LAI_CURRENT.tmp"
    mv -f "$LAI_CURRENT.tmp" "$LAI_CURRENT"
    ln -sfn "$release_dir" "$LAI_ROOT/current.tmp"
    mv -Tf "$LAI_ROOT/current.tmp" "$LAI_ROOT/current"
}

# Mirror the latest release record into a versioned SSM parameter (Parameter Store keeps the last
# 100 versions), so the history survives the instance. Best effort: a failure is logged, not fatal.
publish_record() {
    local record=$1
    [ -n "${LAI_RELEASE_PARAM:-}" ] || return 0
    if ! aws ssm put-parameter --name "$LAI_RELEASE_PARAM" --type String --overwrite \
        --value "$(jq -c '{event,status,git_sha,image_digest,finished_at,previous_git_sha,health,manual_db_review_required}' <<<"$record")" \
        >/dev/null 2>&1; then
        log "WARNING: could not record the release in SSM parameter $LAI_RELEASE_PARAM"
    fi
}

# docker compose for one release directory (its compose file and its release.env).
compose_for() {
    local release_dir=$1
    shift
    local profile=()
    [ "$LAI_DB_MODE" = container ] && profile=(--profile container-db)
    docker compose -p "$LAI_COMPOSE_PROJECT" \
        -f "$release_dir/deploy/ec2/docker-compose.yml" \
        --env-file "$release_dir/release.env" "${profile[@]}" "$@"
}

# Values compose interpolates into the compose file. None is secret.
write_release_env() {
    local release_dir=$1 image=$2 git_sha=$3
    cat >"$release_dir/release.env.tmp" <<EOF
LAI_IMAGE=$image
LAI_GIT_SHA=$git_sha
LAI_ENV=$LAI_ENV
AWS_REGION=$AWS_REGION
LAI_API_HOST=$LAI_API_HOST
LAI_APP_LOG_GROUP=$LAI_APP_LOG_GROUP
LAI_RUNTIME_DIR=$LAI_RUNTIME_DIR
LAI_DATA_DIR=$LAI_DATA_DIR
LAI_CERTS_DIR=$LAI_CERTS_DIR
EOF
    mv -f "$release_dir/release.env.tmp" "$release_dir/release.env"
}

ecr_login() {
    local registry=${LAI_ECR_REPOSITORY_URI%%/*}
    aws ecr get-login-password --region "$AWS_REGION" |
        docker login --username AWS --password-stdin "$registry" >/dev/null
}

# Pull the image unless it is already present (pulling by digest is idempotent anyway).
ensure_image() {
    local image=$1
    if docker image inspect "$image" >/dev/null 2>&1; then
        return 0
    fi
    ecr_login && docker pull --quiet "$image" >/dev/null
}

# Run the health check against whatever is running now. $1: the image that must be serving.
verify_health() {
    local image=$1 release_dir=$2
    LAI_HEALTH_RELEASE_DIR="$release_dir" "$LAI_SCRIPTS_DIR/health-check.sh" --expect-image "$image"
}

# Start a release that is already prepared (image present, release.env written, migrations done)
# and check it. Returns 0 when healthy.
activate_release() {
    local release_dir=$1 image=$2
    if ! compose_for "$release_dir" up -d --wait --wait-timeout "${LAI_START_TIMEOUT:-180}" --remove-orphans; then
        log "the containers did not become healthy within the start timeout"
        return 1
    fi
    verify_health "$image" "$release_dir"
}

# Migrations recorded as applied by healthy or failed releases after the given digest. They are
# never reversed automatically, so a rollback past them needs a person to check compatibility.
migrations_after() {
    local digest=$1
    [ -s "$LAI_HISTORY" ] || return 0
    jq -rs --arg d "$digest" '
        (map(.image_digest) | rindex($d)) as $i
        | if $i == null then .[] else .[$i + 1:][] end
        | select(.event == "deploy") | (.migrations_applied // [])[]' "$LAI_HISTORY" | sort -u
}

# Roll back to a record from the history. Used by rollback-django.sh and by a failed deploy.
# Prints the outcome and returns 0 when the target release is healthy again.
rollback_to() {
    local target=$1 trigger=$2 from_record=$3
    local image git_sha release_dir started from_digest migrations status health review
    image=$(jq -r '.image' <<<"$target")
    git_sha=$(jq -r '.git_sha' <<<"$target")
    from_digest=$(jq -r '.image_digest // empty' <<<"$from_record")
    release_dir=$(release_dir_for "$image")
    started=$(now_iso)
    log "rolling back to $git_sha ($image), trigger: $trigger"

    if [ ! -f "$release_dir/deploy/ec2/docker-compose.yml" ]; then
        log "the release directory for $git_sha is gone; cannot roll back to it"
        return 1
    fi
    migrations=$(migrations_after "$(jq -r '.image_digest' <<<"$target")" | paste -sd, -)
    if [ -n "$from_digest" ] && [ -z "$migrations" ]; then
        migrations=$(jq -r '(.migrations_applied // []) | join(",")' <<<"$from_record")
    fi

    status=rollback_failed
    health=fail
    if ensure_image "$image" &&
        "$LAI_SCRIPTS_DIR/render-env.sh" &&
        write_release_env "$release_dir" "$image" "$git_sha" &&
        activate_release "$release_dir" "$image"; then
        status=healthy
        health=pass
    fi
    review=false
    if [ -n "$migrations" ]; then
        review=true
        log "MANUAL DATABASE REVIEW REQUIRED: these migrations were applied after $git_sha and were" \
            "NOT reversed: $migrations. The rolled-back code must tolerate them, or the database" \
            "must be recovered by hand (docs/platform/DJANGO_EC2_DEPLOYMENT.md, 'Rollback')."
    fi
    local record
    record=$(jq -n --arg event rollback --arg trigger "$trigger" --arg status "$status" \
        --arg image "$image" --arg digest "$(jq -r '.image_digest' <<<"$target")" \
        --arg git_sha "$git_sha" --argjson epoch "$(jq '.commit_epoch // 0' <<<"$target")" \
        --arg started "$started" --arg finished "$(now_iso)" --arg health "$health" \
        --arg prev_sha "$(jq -r '.git_sha // empty' <<<"$from_record")" --arg prev_digest "$from_digest" \
        --arg migrations "$migrations" --argjson review "$review" \
        '{event:$event, trigger:$trigger, status:$status, image:$image, image_digest:$digest,
          git_sha:$git_sha, commit_epoch:$epoch, started_at:$started, finished_at:$finished,
          health:$health, previous_git_sha:$prev_sha, previous_image_digest:$prev_digest,
          migrations_not_reversed:($migrations | split(",") | map(select(. != ""))),
          manual_db_review_required:$review}')
    append_history "$record"
    publish_record "$record"
    if [ "$status" = healthy ]; then
        # The target's own record (it passed its health check when it was deployed) is current again.
        set_current "$target" "$release_dir"
        log "rollback to $git_sha is healthy"
        return 0
    fi
    log "rollback to $git_sha FAILED its health check"
    return 1
}
