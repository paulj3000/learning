#!/usr/bin/env bash
# Daily housekeeping for the native dev instance (lai-maintenance.timer). Runs, with the current
# release and its existing runtime settings:
#   speech_cleanup   expired speech utterances and clips
#   ai_retention     report only (no --apply: deleting needs an approved retention period, G9)
#   jobs_sweep       stale async jobs marked failed (when the release has the command)
# Each failure is logged, never fatal. A no-op without a release, and skipped while a deploy holds
# the lock. Always exits 0. Logs to /var/log/lai/maintenance.log.
set -Eeuo pipefail
LAI_SCRIPT=maintenance
LAI_LOG_FILE=maintenance.log
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"

load_conf
if [ ! -e "$LAI_ROOT/current" ] || [ ! -s "$LAI_RUNTIME_DIR/django.env" ]; then
    log "no current release; nothing to do"
    exit 0
fi
release_dir=$(readlink -f "$LAI_ROOT/current")
git_sha=$(basename "$release_dir")
mkdir -p "$(dirname "$LAI_LOCK_FILE")"
exec 9>"$LAI_LOCK_FILE"
if ! flock -n 9; then
    log "a release is in progress; skipping this run"
    exit 0
fi

has_command() { compgen -G "$release_dir/lai/apps/*/management/commands/$1.py" >/dev/null; }

for task in speech_cleanup ai_retention jobs_sweep; do
    if ! has_command "$task"; then
        log "skipping $task (not in this release)"
        continue
    fi
    if output=$(manage "$release_dir" "$git_sha" "$task" 2>&1); then
        log "$task: ok"
    else
        log "WARNING: $task failed"
    fi
    # Counts only: these commands never print child data.
    printf '%s\n' "$output" | tail -n 5 | sed "s/^/    [$task] /" >&2
    [ ! -w "$LAI_LOG_DIR" ] || printf '%s\n' "$output" | tail -n 5 | sed "s/^/    [$task] /" >>"$LAI_LOG_DIR/$LAI_LOG_FILE"
done
exit 0
