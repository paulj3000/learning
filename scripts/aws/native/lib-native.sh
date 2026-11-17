# shellcheck shell=bash
# shellcheck disable=SC2034 # constants are used by the scripts that source this file
# Shared functions for the native (no Docker) dev release scripts. Sourced, never executed.
# Every path and external command can be overridden, so tests/deploy/test_native_*.py run these
# scripts against a temporary directory with fake aws, systemctl, nginx, curl and python.
#
# On the instance (written by setup-native.sh, then by each release):
#   /etc/lai/native.conf               settings from the stack (no secrets)
#   /opt/lai/releases/<git sha>/       extracted artifact + venv/ + static (lai/staticfiles)
#   /opt/lai/current -> releases/..    the release that is serving
#   /opt/lai/runtime/django.env        runtime settings and secrets, root:lai 0640
#   /opt/lai/state/releases.jsonl      release history (append only); current.json the healthy one
#   /var/log/lai/deploy.log            every line these scripts print (shipped to CloudWatch)

LAI_ROOT=${LAI_ROOT:-/opt/lai}
LAI_CONF=${LAI_CONF:-/etc/lai/native.conf}
LAI_LOG_DIR=${LAI_LOG_DIR:-/var/log/lai}
LAI_LOCK_FILE=${LAI_LOCK_FILE:-/run/lock/lai-native-deploy.lock}
LAI_LOCK_WAIT_SECONDS=${LAI_LOCK_WAIT_SECONDS:-600}
LAI_KEEP_RELEASES=${LAI_KEEP_RELEASES:-3}
LAI_ETC_DIR=${LAI_ETC_DIR:-/etc/lai}
LAI_SYSTEMD_DIR=${LAI_SYSTEMD_DIR:-/etc/systemd/system}
LAI_NGINX_CONF=${LAI_NGINX_CONF:-/etc/nginx/conf.d/lai.conf}
LAI_RDS_CA=${LAI_RDS_CA:-/etc/lai/certs/rds-global-bundle.pem}
# The interpreter that builds each release's venv (AL2023 package python3.12).
LAI_PYTHON=${LAI_PYTHON:-python3.12}
# How Django commands drop to the `lai` user. Empty runs them as the caller (tests only).
LAI_RUN_AS=${LAI_RUN_AS-setpriv --reuid=lai --regid=lai --init-groups --}
# Group that may read django.env. Empty skips chgrp (tests only).
LAI_ENV_GROUP=${LAI_ENV_GROUP-lai}

# Exit codes (the SSM documents and the GitHub workflow report these as application failures).
readonly E_USAGE=2
readonly E_INVALID=10
readonly E_ARTIFACT=20
readonly E_CONFIG=30
readonly E_PREFLIGHT=40
readonly E_DESTRUCTIVE=45
readonly E_MIGRATE=50
readonly E_HEALTH_ROLLED_BACK=60
readonly E_HEALTH_NO_PREVIOUS=61
readonly E_ROLLBACK_FAILED=62
readonly E_NOTHING_TO_ROLL_BACK=63
readonly E_LOCK=70
readonly E_POWER=75

readonly GIT_SHA_PATTERN='^[a-f0-9]{40}$'
readonly ARTIFACT_SHA_PATTERN='^[a-f0-9]{64}$'
readonly EPOCH_PATTERN='^[0-9]{9,11}$'
readonly RUN_URL_PATTERN='^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$'

LAI_STATE_DIR="$LAI_ROOT/state"
LAI_RELEASES_DIR="$LAI_ROOT/releases"
LAI_RUNTIME_DIR="$LAI_ROOT/runtime"
LAI_HISTORY="$LAI_STATE_DIR/releases.jsonl"
LAI_CURRENT="$LAI_STATE_DIR/current.json"
# The processing services (lai-jobs-dispatch, lai-jobs-completions) skip themselves through
# ExecCondition unless LAI_PROCESSING_BACKEND is sqs (deploy/native/systemd).
LAI_UNITS=(lai-gunicorn.service lai-jobs-consumer.service lai-jobs-dispatch.service
    lai-jobs-completions.service)
# Processing reconciliation (LAI-LAMBDA-006): a oneshot service without [Install], started by its
# timer. Installed when the release has them (older releases do not); only the timer is enabled.
# A schedule drop-in (lai-jobs-reconcile.timer.d/) is never touched.
LAI_TIMER_UNITS=(lai-jobs-reconcile.service lai-jobs-reconcile.timer)
LAI_TIMERS=(lai-jobs-reconcile.timer)

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
    local line
    line="$(now_iso) [${LAI_SCRIPT:-lai}] $*"
    # stderr, so a function's captured stdout (a JSON record) never mixes with log lines.
    printf '%s\n' "$line" >&2
    if [ -d "$LAI_LOG_DIR" ] && [ -w "$LAI_LOG_DIR" ]; then
        printf '%s\n' "$line" >>"$LAI_LOG_DIR/${LAI_LOG_FILE:-deploy.log}"
    fi
}

die() {
    local code=$1
    shift
    log "ERROR: $*"
    exit "$code"
}

load_conf() {
    [ -r "$LAI_CONF" ] || die "$E_CONFIG" "missing $LAI_CONF (run setup-native.sh first)"
    # shellcheck source=/dev/null
    . "$LAI_CONF"
    local name
    for name in LAI_ENV AWS_REGION LAI_API_HOST LAI_ADMIN_HOST LAI_DB_SECRET_ARN LAI_ARTIFACT_BUCKET \
        LAI_PARAM_PREFIX LAI_POWER_PREFIX LAI_DEPLOY_PREFIX; do
        [ -n "${!name:-}" ] || die "$E_CONFIG" "$name is not set in $LAI_CONF"
    done
    [ "$LAI_ENV" = dev ] || die "$E_CONFIG" "the native release scripts are for the dev environment only"
    export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
}

acquire_lock() {
    mkdir -p "$(dirname "$LAI_LOCK_FILE")"
    exec 9>"$LAI_LOCK_FILE"
    if ! flock -w "$LAI_LOCK_WAIT_SECONDS" 9; then
        die "$E_LOCK" "another release is still running (lock $LAI_LOCK_FILE)"
    fi
}

ensure_dirs() {
    mkdir -p "$LAI_STATE_DIR" "$LAI_RELEASES_DIR" "$LAI_RUNTIME_DIR"
    chmod 0750 "$LAI_RUNTIME_DIR"
    [ -z "$LAI_ENV_GROUP" ] || chgrp "$LAI_ENV_GROUP" "$LAI_RUNTIME_DIR"
}

release_dir_for() { printf '%s/%s' "$LAI_RELEASES_DIR" "$1"; }
current_record() { [ -s "$LAI_CURRENT" ] && cat "$LAI_CURRENT" || printf '{}'; }

append_history() { printf '%s\n' "$(jq -c . <<<"$1")" >>"$LAI_HISTORY"; }

# Point /opt/lai/current at a release directory, atomically.
switch_current() {
    ln -sfn "$1" "$LAI_ROOT/current.tmp"
    mv -Tf "$LAI_ROOT/current.tmp" "$LAI_ROOT/current"
}

set_current_record() {
    jq -c . <<<"$1" >"$LAI_CURRENT.tmp"
    mv -f "$LAI_CURRENT.tmp" "$LAI_CURRENT"
}

# Mirror the latest record into /lai/dev/deploy/last-release. Best effort.
publish_record() {
    if ! aws ssm put-parameter --name "${LAI_DEPLOY_PREFIX%/}/last-release" --type String --overwrite \
        --value "$(jq -c '{event,status,git_sha,commit_epoch,finished_at,previous_git_sha,health,manual_db_review_required}' <<<"$1")" \
        >/dev/null 2>&1; then
        log "WARNING: could not record the release in ${LAI_DEPLOY_PREFIX%/}/last-release"
    fi
}

# A release directory that is complete enough to run: bundle, venv and collected static files.
release_ready() {
    [ -f "$1/scripts/aws/native/deploy-native.sh" ] && [ -f "$1/venv/.lai-complete" ] &&
        [ -d "$1/lai/staticfiles" ]
}

# Run a command in a release with only PATH, the runtime settings and the variables named in
# LAI_PASS_VARS in its environment, as the `lai` user. Values are exported one line at a time,
# never evaluated and never on a command line.
run_django() {
    local release_dir=$1 git_sha=$2
    shift 2
    local runas=() env_file="$LAI_RUNTIME_DIR/django.env"
    read -ra runas <<<"$LAI_RUN_AS"
    (
        local name line keep=" PATH ${LAI_PASS_VARS:-} "
        for name in $(compgen -e); do
            [[ $keep == *" $name "* ]] || unset "$name" 2>/dev/null || true
        done
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then export "${line?}"; fi
        done <"$env_file"
        export HOME=/tmp LANG=C.UTF-8 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
            DJANGO_SETTINGS_MODULE=config.settings.production DJANGO_TRUST_PROXY_SSL_HEADER=true \
            LAI_RELEASE_SHA="$git_sha"
        cd "$release_dir/lai" && exec "${runas[@]}" "$@"
    )
}

manage() {
    local release_dir=$1 git_sha=$2
    shift 2
    run_django "$release_dir" "$git_sha" "$release_dir/venv/bin/python" manage.py "$@"
}

db_check() {
    run_django "$1" "$2" "$1/venv/bin/python" -c \
        'import os, psycopg; psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=10).close()'
}

# Install a release's units, gunicorn config and rendered nginx config; `nginx -t` must pass, or
# the previous nginx config is put back and this returns 1.
install_release_config() {
    local release_dir=$1 unit backup
    for unit in "${LAI_UNITS[@]}"; do
        install -m 0644 "$release_dir/deploy/native/systemd/$unit" "$LAI_SYSTEMD_DIR/$unit"
    done
    for unit in "${LAI_TIMER_UNITS[@]}"; do
        [ ! -f "$release_dir/deploy/native/systemd/$unit" ] ||
            install -m 0644 "$release_dir/deploy/native/systemd/$unit" "$LAI_SYSTEMD_DIR/$unit"
    done
    install -m 0644 "$release_dir/deploy/native/gunicorn.conf.py" "$LAI_ETC_DIR/gunicorn.conf.py"
    backup="$LAI_NGINX_CONF.previous"
    [ ! -f "$LAI_NGINX_CONF" ] || cp -f "$LAI_NGINX_CONF" "$backup"
    # shellcheck disable=SC2016 # the names envsubst may replace, not expansions
    LAI_API_HOST=$LAI_API_HOST LAI_ADMIN_HOST=$LAI_ADMIN_HOST \
        envsubst '${LAI_API_HOST} ${LAI_ADMIN_HOST}' \
        <"$release_dir/deploy/native/nginx.conf.template" >"$LAI_NGINX_CONF.tmp"
    mv -f "$LAI_NGINX_CONF.tmp" "$LAI_NGINX_CONF"
    if ! nginx -t -q >/dev/null 2>&1; then
        log "nginx rejected the release's configuration; restoring the previous one"
        [ ! -f "$backup" ] || mv -f "$backup" "$LAI_NGINX_CONF"
        return 1
    fi
    systemctl daemon-reload
    systemctl enable "${LAI_UNITS[@]}" >/dev/null 2>&1 || log "WARNING: could not enable the lai units"
    if [ -f "$LAI_SYSTEMD_DIR/lai-jobs-reconcile.timer" ]; then
        systemctl enable "${LAI_TIMERS[@]}" >/dev/null 2>&1 || log "WARNING: could not enable the lai timers"
    fi
}

# Restart the application on whatever /opt/lai/current points at. 0 when gunicorn restarted.
restart_services() {
    systemctl restart lai-gunicorn.service || return 1
    systemctl restart lai-jobs-consumer.service || log "WARNING: lai-jobs-consumer did not restart"
    systemctl restart lai-jobs-completions.service || log "WARNING: lai-jobs-completions did not restart"
    systemctl restart lai-jobs-dispatch.service || log "WARNING: lai-jobs-dispatch did not restart"
    if [ -f "$LAI_SYSTEMD_DIR/lai-jobs-reconcile.timer" ]; then
        # Re-arms the schedule with the new unit files; the service skips itself unless sqs.
        systemctl restart lai-jobs-reconcile.timer || log "WARNING: lai-jobs-reconcile.timer did not restart"
    fi
    if systemctl is-active --quiet nginx.service; then
        systemctl reload nginx.service || return 1
    else
        systemctl start nginx.service || return 1
    fi
}

verify_health() { "$LAI_SCRIPTS_DIR/health-native.sh"; }

# Migrations recorded as applied by releases after the given commit. Never reversed automatically.
migrations_after() {
    [ -s "$LAI_HISTORY" ] || return 0
    jq -rs --arg s "$1" '
        (map(.git_sha) | rindex($s)) as $i
        | if $i == null then .[] else .[$i + 1:][] end
        | select(.event == "deploy") | (.migrations_applied // [])[]' "$LAI_HISTORY" | sort -u
}

# Make an earlier healthy release current again. Used by rollback-native.sh and a failed deploy.
rollback_to() {
    local target=$1 trigger=$2 from_record=$3
    local git_sha release_dir started migrations status=rollback_failed health=fail review=false record
    git_sha=$(jq -r '.git_sha' <<<"$target")
    release_dir=$(release_dir_for "$git_sha")
    started=$(now_iso)
    log "rolling back to $git_sha, trigger: $trigger"
    if ! release_ready "$release_dir"; then
        log "the release directory for $git_sha is gone or incomplete; cannot roll back to it"
        return 1
    fi
    migrations=$(migrations_after "$git_sha" | paste -sd, -)
    if [ -z "$migrations" ]; then
        migrations=$(jq -r '(.migrations_applied // []) | join(",")' <<<"$from_record")
    fi
    if "$LAI_SCRIPTS_DIR/render-env-native.sh" && install_release_config "$release_dir"; then
        switch_current "$release_dir"
        if restart_services && verify_health; then
            status=healthy
            health=pass
        fi
    fi
    if [ -n "$migrations" ]; then
        review=true
        log "MANUAL DATABASE REVIEW REQUIRED: these migrations were applied after $git_sha and were" \
            "NOT reversed: $migrations. The rolled-back code must tolerate them, or the database" \
            "must be recovered by hand."
    fi
    record=$(jq -n --arg trigger "$trigger" --arg status "$status" --arg git_sha "$git_sha" \
        --arg artifact "$(jq -r '.artifact_sha256 // empty' <<<"$target")" \
        --argjson epoch "$(jq '.commit_epoch // 0' <<<"$target")" \
        --arg started "$started" --arg finished "$(now_iso)" --arg health "$health" \
        --arg prev_sha "$(jq -r '.git_sha // empty' <<<"$from_record")" \
        --arg migrations "$migrations" --argjson review "$review" --arg environment "$LAI_ENV" \
        '{event:"rollback", trigger:$trigger, status:$status, git_sha:$git_sha,
          artifact_sha256:$artifact, commit_epoch:$epoch, started_at:$started, finished_at:$finished,
          health:$health, previous_git_sha:$prev_sha,
          migrations_not_reversed:($migrations | split(",") | map(select(. != ""))),
          manual_db_review_required:$review, environment:$environment}')
    append_history "$record"
    publish_record "$record"
    if [ "$status" = healthy ]; then
        set_current_record "$target"
        log "rollback to $git_sha is healthy"
        return 0
    fi
    log "rollback to $git_sha FAILED its health check"
    return 1
}

# Remove release directories, keeping the newest $LAI_KEEP_RELEASES healthy ones plus the current
# and previous release. Never touches the runtime configuration, history or the database.
prune_releases() {
    local current_sha previous_sha keep=() dir id
    current_sha=$(jq -r '.git_sha // empty' <<<"$(current_record)")
    previous_sha=$(jq -r '.previous_git_sha // empty' <<<"$(current_record)")
    if [ -s "$LAI_HISTORY" ]; then
        mapfile -t keep < <(jq -r 'select(.status == "healthy") | .git_sha' "$LAI_HISTORY" |
            tac | awk '!seen[$0]++' | head -n "$LAI_KEEP_RELEASES")
    fi
    keep+=("$current_sha" "$previous_sha")
    for dir in "$LAI_RELEASES_DIR"/*/; do
        [ -d "$dir" ] || continue
        id=$(basename "$dir")
        [[ $id =~ $GIT_SHA_PATTERN ]] || continue
        printf '%s\n' "${keep[@]}" | grep -qx "$id" && continue
        rm -rf -- "$dir"
        log "pruned release $id"
    done
}
