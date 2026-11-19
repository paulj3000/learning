#!/usr/bin/env bash
# Check the Django release serving on this instance (native dev).
#
#   health-native.sh [--attempts N] [--interval S] [--db]
#
# Passes when, within the attempts, nginx's local server on 127.0.0.1:8080 (which presents the API
# host name to Django) answers GET /api/v1/health/ (liveness) and /api/v1/health/ready/ (database
# answers, no pending migration) with 200 and status "ok". It checks nginx and gunicorn together.
# --db also opens a database connection with the current release's settings first.
# Exit 0 healthy, 1 unhealthy, 2 usage.
set -Eeuo pipefail
LAI_SCRIPT=health
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"

attempts=${LAI_HEALTH_ATTEMPTS:-20}
interval=${LAI_HEALTH_INTERVAL:-3}
base=${LAI_HEALTH_BASE_URL:-http://127.0.0.1:8080}
check_db=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --attempts) attempts=${2:-}; shift 2 ;;
        --interval) interval=${2:-}; shift 2 ;;
        --db) check_db=true; shift ;;
        *) echo "usage: $0 [--attempts N] [--interval S] [--db]" >&2; exit "$E_USAGE" ;;
    esac
done
[[ $attempts =~ ^[0-9]{1,3}$ && $interval =~ ^[0-9]{1,3}$ ]] || { echo "bad --attempts/--interval" >&2; exit "$E_USAGE"; }

load_conf

if [ "$check_db" = true ]; then
    current=$(readlink -f "$LAI_ROOT/current" 2>/dev/null || true)
    if [ -z "$current" ] || [ ! -d "$current" ]; then
        log "UNHEALTHY: no current release"
        exit 1
    fi
    if ! db_check "$current" "$(basename "$current")" >/dev/null 2>&1; then
        log "UNHEALTHY: the database is not reachable with the current settings"
        exit 1
    fi
fi

probe() {
    local body
    body=$(curl --silent --show-error --fail --max-time 5 -H "Host: $LAI_API_HOST" "$base$1" 2>/dev/null) || return 1
    [ "$(jq -r '.status // empty' <<<"$body" 2>/dev/null)" = ok ]
}

for ((n = 1; n <= attempts; n++)); do
    if probe /api/v1/health/ && probe /api/v1/health/ready/; then
        log "healthy (live and ready) after $n attempt(s)"
        exit 0
    fi
    [ "$n" -lt "$attempts" ] && sleep "$interval"
done
log "UNHEALTHY after $attempts attempt(s)"
exit 1
