#!/usr/bin/env bash
# Show the state of the Django release on this instance (ADR-037). Read only; prints no secret.
#
#   status.sh [--history N]
#
# Prints the current release record, the last N history entries (default 10), the containers,
# a live health check, disk and memory use. Run on the instance, or remotely through the SSM
# document `lai-django-status-<env>` (scripts/aws/remote.sh status <env>).
set -Eeuo pipefail
LAI_SCRIPT=status
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

history=10
if [ "${1:-}" = --history ]; then history=${2:-10}; fi
[[ $history =~ ^[0-9]{1,3}$ ]] || { echo "usage: $0 [--history N]" >&2; exit "$E_USAGE"; }

load_conf
echo "== environment: $LAI_ENV ($AWS_REGION), API host $LAI_API_HOST, database mode $LAI_DB_MODE"
echo "== current release"
jq . <<<"$(current_record)"
echo "== last $history release events"
if [ -s "$LAI_HISTORY" ]; then
    tail -n "$history" "$LAI_HISTORY" | jq -r '[.finished_at, .event, .status, (.git_sha[0:12]),
        (.image_digest[7:19]), ("health=" + (.health // "?")),
        (if .manual_db_review_required then "MANUAL-DB-REVIEW" else "" end)] | join("  ")'
else
    echo "(none)"
fi
echo "== containers"
if [ -e "$LAI_ROOT/current" ]; then
    compose_for "$LAI_ROOT/current" ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' || true
else
    echo "(no current release)"
fi
echo "== health"
LAI_HEALTH_ATTEMPTS=1 "$LAI_SCRIPTS_DIR/health-check.sh" 2>&1 || true
echo "== disk"
disks=(/)
[ -d "$LAI_DATA_DIR" ] && disks+=("$LAI_DATA_DIR") # the dev database volume, when there is one
df -h "${disks[@]}" | awk '!seen[$0]++' || true
echo "== memory"
free -m || true
