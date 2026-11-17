#!/usr/bin/env bash
# Show the state of the native dev instance. Read only; prints no secret.
#
#   status-native.sh [--history N]
#
# Prints the current release record, the last N history events (default 10), the systemd units,
# a one-attempt health check, the TLS certificate's expiry, disk and memory. Run on the instance or
# through the SSM document `lai-dev-native-status`.
set -Eeuo pipefail
LAI_SCRIPT=status
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"
LAI_LOG_DIR=/nonexistent # read only: never append to the deploy log

history=10
if [ "${1:-}" = --history ]; then history=${2:-10}; fi
[[ $history =~ ^[0-9]{1,3}$ ]] || { echo "usage: $0 [--history N]" >&2; exit "$E_USAGE"; }

load_conf
echo "== environment: $LAI_ENV ($AWS_REGION), API host $LAI_API_HOST, admin host $LAI_ADMIN_HOST"
echo "== current release ($(readlink "$LAI_ROOT/current" 2>/dev/null || echo none))"
jq . <<<"$(current_record)"
echo "== last $history release events"
if [ -s "$LAI_HISTORY" ]; then
    tail -n "$history" "$LAI_HISTORY" | jq -r '[.finished_at, .event, .status, (.git_sha[0:12]),
        ("health=" + (.health // "?")),
        (if .manual_db_review_required then "MANUAL-DB-REVIEW" else "" end)] | join("  ")'
else
    echo "(none)"
fi
echo "== services"
for unit in nginx.service "${LAI_UNITS[@]}" "${LAI_TIMERS[@]}" lai-maintenance.timer \
    lai-certbot-renew.timer; do
    printf '%-28s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
done
echo "== health"
LAI_HEALTH_ATTEMPTS=1 "$LAI_SCRIPTS_DIR/health-native.sh" 2>&1 || true
echo "== certificate"
cert=${LAI_TLS_CERT:-/etc/letsencrypt/live/lai-dev/fullchain.pem}
if [ -r "$cert" ]; then
    openssl x509 -noout -issuer -enddate -in "$cert" 2>/dev/null || echo "(unreadable)"
else
    echo "(none)"
fi
echo "== disk"
df -h / "$LAI_ROOT" 2>/dev/null | awk '!seen[$0]++' || true
echo "== memory"
free -m 2>/dev/null || true
