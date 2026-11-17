#!/usr/bin/env bash
# Body of the SSM document `lai-dev-native-power`, run by the lai-dev-power state machine.
# Self-contained (no lib). LAI_REQ_ACTION (from the document, or $1):
#
#   quiesce   before the instance stops: wait briefly for a running release to finish, then stop
#             lai-jobs-reconcile.timer and any running reconciliation (no expiry runs while
#             services stop), lai-jobs-dispatch (no new work leaves), lai-jobs-completions,
#             lai-jobs-consumer and lai-gunicorn. Always exits 0 unless the action is invalid. The
#             Lambda workers keep running; their completions wait in SQS until verify starts the
#             consumers again.
#   verify    after the instance starts (the state machine starts RDS first and waits for it):
#             nginx and lai-gunicorn active, then the database reachable with the current
#             release's settings and readiness 200 (health-native.sh --db, bounded by
#             LAI_VERIFY_ATTEMPTS x LAI_VERIFY_INTERVAL); only then start lai-jobs-consumer,
#             lai-jobs-completions (drains the overnight backlog), run one reconciliation
#             (lai-jobs-reconcile.service, synchronous; it expires overdue jobs and cancels their
#             outbox rows before the relay resumes), start lai-jobs-dispatch and
#             lai-jobs-reconcile.timer, and print the processing backlog
#             (processing-native.sh backlog: jobs_reconcile --dry-run counts). Then, when
#             /lai/dev/deploy/apply-pending-on-start is true, apply the release recorded in
#             /lai/dev/deploy/pending and set it to `none` once that succeeds. Ends with one
#             `health:` line. Exits 0 when the instance ends healthy, 1 when it does not; the
#             processing steps only warn (the backend may be disabled or the release older).
# Exit 2 for an unknown action, 30 when the instance was never set up.
set -Eeuo pipefail
LAI_ROOT=${LAI_ROOT:-/opt/lai}
LAI_CONF=${LAI_CONF:-/etc/lai/native.conf}
LAI_LOCK_FILE=${LAI_LOCK_FILE:-/run/lock/lai-native-deploy.lock}
LAI_QUIESCE_LOCK_WAIT=${LAI_QUIESCE_LOCK_WAIT:-240}
LAI_VERIFY_ATTEMPTS=${LAI_VERIFY_ATTEMPTS:-40}
LAI_VERIFY_INTERVAL=${LAI_VERIFY_INTERVAL:-5}

say() { printf '%s [power] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

action=${LAI_REQ_ACTION:-${1:-}}
case "$action" in quiesce | verify) ;; *) say "ERROR: action must be quiesce or verify"; exit 2 ;; esac
[ -r "$LAI_CONF" ] || { say "ERROR: missing $LAI_CONF (setup-native.sh)"; exit 30; }
# shellcheck source=/dev/null
. "$LAI_CONF"
export AWS_REGION AWS_DEFAULT_REGION="${AWS_REGION:-}"
deploy_prefix=${LAI_DEPLOY_PREFIX:-/lai/${LAI_ENV:-dev}/deploy}
scripts=${LAI_NATIVE_SCRIPTS_DIR:-$LAI_ROOT/current/scripts/aws/native}
systemd_dir=${LAI_SYSTEMD_DIR:-/etc/systemd/system}

if [ "$action" = quiesce ]; then
    mkdir -p "$(dirname "$LAI_LOCK_FILE")"
    exec 9>"$LAI_LOCK_FILE"
    flock -w "$LAI_QUIESCE_LOCK_WAIT" 9 || say "WARNING: a release still holds the lock; stopping anyway"
    # The timer first, so no reconciliation starts while the others stop; a running one is
    # stopped too (each expiry is its own transaction, so a stop leaves no half-done job).
    if [ -f "$systemd_dir/lai-jobs-reconcile.timer" ]; then
        systemctl stop lai-jobs-reconcile.timer || say "WARNING: could not stop lai-jobs-reconcile.timer"
        systemctl stop lai-jobs-reconcile.service || say "WARNING: could not stop lai-jobs-reconcile"
    fi
    systemctl stop lai-jobs-dispatch.service || say "WARNING: could not stop lai-jobs-dispatch"
    systemctl stop lai-jobs-completions.service || say "WARNING: could not stop lai-jobs-completions"
    systemctl stop lai-jobs-consumer.service || say "WARNING: could not stop lai-jobs-consumer"
    systemctl stop lai-gunicorn.service || say "WARNING: could not stop lai-gunicorn"
    say "quiesced"
    exit 0
fi

# --- verify --------------------------------------------------------------------------------------
reconcile=not-installed
backlog=not-reported
healthy() {
    [ -x "$scripts/health-native.sh" ] || return 1
    LAI_HEALTH_ATTEMPTS=$1 LAI_HEALTH_INTERVAL=$LAI_VERIFY_INTERVAL "$scripts/health-native.sh" --db
}

ok=true
if [ ! -e "$LAI_ROOT/current" ]; then
    say "no release is installed yet"
    ok=false
fi
for unit in nginx.service lai-gunicorn.service; do
    systemctl is-active --quiet "$unit" || systemctl start "$unit" || { say "ERROR: $unit did not start"; ok=false; }
done
if [ "$ok" = true ] && healthy "$LAI_VERIFY_ATTEMPTS"; then
    say "nginx, gunicorn and the database are healthy"
    systemctl start lai-jobs-consumer.service || say "WARNING: lai-jobs-consumer did not start"
    # Skipped by their ExecCondition unless LAI_PROCESSING_BACKEND is sqs.
    systemctl start lai-jobs-completions.service || say "WARNING: lai-jobs-completions did not start"
    if [ -f "$systemd_dir/lai-jobs-reconcile.service" ]; then
        # A oneshot: `start` returns when the run has finished (or was skipped by its condition).
        if systemctl start lai-jobs-reconcile.service; then
            reconcile=ok
        else
            reconcile=failed
            say "WARNING: the startup reconciliation failed (see /var/log/lai/jobs-reconcile.log)"
        fi
    fi
    systemctl start lai-jobs-dispatch.service || say "WARNING: lai-jobs-dispatch did not start"
    if [ -f "$systemd_dir/lai-jobs-reconcile.timer" ]; then
        systemctl start lai-jobs-reconcile.timer || say "WARNING: lai-jobs-reconcile.timer did not start"
    fi
    if [ -x "$scripts/processing-native.sh" ]; then
        if backlog=$("$scripts/processing-native.sh" backlog 2>/dev/null); then
            say "processing backlog: $backlog"
        else
            backlog=unavailable
            say "WARNING: the processing backlog could not be read"
        fi
    fi
else
    ok=false
    say "ERROR: the instance is not healthy after start"
fi

apply=$(aws ssm get-parameter --name "$deploy_prefix/apply-pending-on-start" --query Parameter.Value \
    --output text 2>/dev/null || echo false)
pending=$(aws ssm get-parameter --name "$deploy_prefix/pending" --query Parameter.Value --output text \
    2>/dev/null || echo none)
if [ "$apply" = true ] && [ -n "$pending" ] && [ "$pending" != none ]; then
    if ! jq -e '(.git_sha | test("^[a-f0-9]{40}$")) and (.artifact_sha256 | test("^[a-f0-9]{64}$"))
        and ((.commit_epoch | tostring) | test("^[0-9]{9,11}$"))' >/dev/null 2>&1 <<<"$pending"; then
        say "ERROR: $deploy_prefix/pending is not a valid release record; leaving it for a person"
        ok=false
    elif jq -e --argjson p "$pending" '.git_sha == $p.git_sha or ((.commit_epoch // 0) > ($p.commit_epoch | tonumber))' \
        "$LAI_ROOT/state/current.json" >/dev/null 2>&1; then
        # Already running it, or a newer release (deploy-native.sh would refuse it as out of order):
        # clear it, or it would be retried and refused at every start.
        say "pending release $(jq -r .git_sha <<<"$pending") is already applied or superseded; clearing it"
        aws ssm put-parameter --name "$deploy_prefix/pending" --type String --overwrite --value none \
            >/dev/null 2>&1 || say "WARNING: $deploy_prefix/pending could not be cleared"
    elif [ ! -f "$scripts/ssm-native-entry.sh" ]; then
        say "ERROR: no installed release to apply the pending one with; deploy it again"
        ok=false
    else
        sha=$(jq -r .git_sha <<<"$pending")
        say "applying the pending release $sha"
        code=0
        LAI_REQ_GIT_SHA=$sha LAI_REQ_ARTIFACT_SHA256=$(jq -r .artifact_sha256 <<<"$pending") \
            LAI_REQ_COMMIT_EPOCH=$(jq -r '.commit_epoch | tostring' <<<"$pending") \
            LAI_REQ_RUN_URL=$(jq -r '.run_url // ""' <<<"$pending") \
            LAI_REQ_ALLOW_OLDER=false LAI_REQ_ALLOW_DESTRUCTIVE=false \
            bash "$scripts/ssm-native-entry.sh" || code=$?
        if [ "$code" -eq 0 ]; then
            if aws ssm put-parameter --name "$deploy_prefix/pending" --type String --overwrite \
                --value none >/dev/null 2>&1; then
                say "pending release $sha applied; $deploy_prefix/pending is none"
            else
                say "WARNING: $sha applied but $deploy_prefix/pending could not be cleared"
            fi
            ok=true
        else
            say "ERROR: the pending release $sha failed (exit $code); it stays pending"
            healthy 3 || ok=false
        fi
    fi
fi

status=$([ "$ok" = true ] && echo healthy || echo unhealthy)
say "health: $status; startup reconciliation $reconcile; processing backlog $backlog"
[ "$ok" = true ] || exit 1
say "verified"
