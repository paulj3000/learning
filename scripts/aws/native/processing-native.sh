#!/usr/bin/env bash
# Report the processing backlog of the current release (native dev). Read only; counts only.
#
#   processing-native.sh backlog [--stuck-minutes M]
#
# Runs `manage.py jobs_reconcile --dry-run` with the current release's runtime settings, as the
# `lai` user, and prints one JSON line on stdout:
#   {"backend": "<LAI_PROCESSING_BACKEND>", "dryRun": true, "expired_due": n, "expired": 0,
#    "stuck_outbox": n}
# `expired_due` is the number of open jobs past expires_at that the next reconciliation expires;
# `stuck_outbox` the outbox rows unsent for more than M minutes (default 15). Used by
# power-native.sh verify; also safe to run by hand. Never changes a row and takes no lock.
# Exit 0 with a report, 1 when the report failed (database, settings), 2 usage, 3 when the
# release has no jobs_reconcile command or no runtime settings (nothing to report).
set -Eeuo pipefail
LAI_SCRIPT=processing
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"
LAI_LOG_DIR=/nonexistent # read only: never append to the deploy log

usage() { echo "usage: $0 backlog [--stuck-minutes M]" >&2; exit "$E_USAGE"; }
[ "${1:-}" = backlog ] || usage
shift
stuck=15
while [ "$#" -gt 0 ]; do
    case "$1" in
        --stuck-minutes) stuck=${2:-}; shift 2 ;;
        *) usage ;;
    esac
done
[[ $stuck =~ ^[0-9]{1,4}$ ]] || usage

load_conf
release_dir=$(readlink -f "$LAI_ROOT/current" 2>/dev/null || true)
if [ -z "$release_dir" ] || [ ! -d "$release_dir" ] || [ ! -s "$LAI_RUNTIME_DIR/django.env" ]; then
    log "no current release or runtime settings; no backlog to report"
    exit 3
fi
if ! compgen -G "$release_dir/lai/apps/*/management/commands/jobs_reconcile.py" >/dev/null; then
    log "this release has no jobs_reconcile command; no backlog to report"
    exit 3
fi
backend=$(sed -n 's/^LAI_PROCESSING_BACKEND=//p' "$LAI_RUNTIME_DIR/django.env" | tail -n 1)
if ! output=$(manage "$release_dir" "$(basename "$release_dir")" jobs_reconcile --dry-run \
    --stuck-minutes "$stuck" 2>/dev/null); then
    log "the backlog report failed (database or settings)"
    exit 1
fi
# The command prints one JSON object of counts; anything else is refused rather than echoed.
if ! report=$(jq -ce --arg backend "${backend:-disabled}" \
    'select(type == "object" and (.expired_due | type) == "number"
        and (.stuck_outbox | type) == "number")
     | {backend: $backend, dryRun, expired_due, expired, stuck_outbox}' <<<"$(tail -n 1 <<<"$output")" \
    2>/dev/null); then
    log "the backlog report was not the expected JSON"
    exit 1
fi
printf '%s\n' "$report"
