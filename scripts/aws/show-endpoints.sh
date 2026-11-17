#!/usr/bin/env bash
# Print the native DEV environment's endpoints and live state (read only). Works while the
# environment is stopped: the URLs come from the stack outputs, the rest from live reads.
#
#   show-endpoints.sh [--profile P] [--region R] [--json]
#
# Output:
#   Learning Adventure Island - DEV
#
#   Environment:      dev
#   Region:           us-west-1
#   EC2:              running (i-0123456789abcdef0, t4g.small)
#   RDS:              available (lai-dev)
#   Django:           ready
#   Nightly shutdown: enabled
#   CloudFront:       https://d111111abcdef8.cloudfront.net
#   Game:             https://lai.pauldimitriu.com/
#   API:              https://api.pauldimitriu.com
#   Admin:            https://ladm.pauldimitriu.com/admin/
#   Shutdown:         00:00 America/Los_Angeles (next 2026-11-17 00:00 PST)
#   Startup:          07:35 America/Los_Angeles, available by 08:00 (next 2026-11-17 07:35 PST)
#
# Exit codes: 0 printed; 2 usage; 3 AWS failure; 4 refused by the dev guard; 8 not provisioned.
set -Eeuo pipefail
# shellcheck source=scripts/aws/lib-dev.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-dev.sh"

json=false
while [ "$#" -gt 0 ]; do
    consumed=0
    dev_common_flag "$@" || consumed=$?
    if [ "$consumed" -gt 0 ]; then shift "$consumed"; continue; fi
    case "$1" in
        --json) json=true; shift ;;
        *) sed -n '5p' "$0" >&2; exit "$EX_USAGE" ;;
    esac
done

dev_init
dev_require_platform
status=$(dev_status_json)
if [ "$json" = true ]; then
    printf '%s\n' "$status"
    exit 0
fi

jq -r '
  def django:
    if .ec2.state != "running" then "stopped (EC2 \(.ec2.state))"
    elif .readiness.status == "ready" then "ready"
    else "not ready (HTTP \(.readiness.http_code))" end;
  def nightly:
    if .schedule.shutdown.state != "ENABLED" then "disabled"
    elif .schedule.paused == "true" then "paused"
    elif .schedule.hold_until != "none" and .schedule.hold_until != "" then "enabled, held until \(.schedule.hold_until)"
    else "enabled" end;
  def next($n): if $n == "" then "" else " (next \($n))" end;
  def orunknown: if . == "" or . == null then "(not deployed)" else . end;
  "Learning Adventure Island - DEV",
  "",
  "Environment:      \(.environment)",
  "Region:           \(.region)",
  "EC2:              \(.ec2.state) (\(.ec2.instance_id), \(.ec2.instance_type))",
  "RDS:              \(.rds.state) (\(.rds.identifier))",
  "Django:           \(django)",
  "Nightly shutdown: \(nightly)",
  "CloudFront:       \(.urls.cloudfront | orunknown)",
  "Game:             \(.urls.game | orunknown)",
  "API:              \(.urls.api | orunknown)",
  "Admin:            \(.urls.admin | orunknown)",
  "Shutdown:         \(.schedule.shutdown.time) \(.schedule.timezone)\(next(.schedule.shutdown.next))",
  "Startup:          \(.schedule.startup.time) \(.schedule.timezone), available by \(.schedule.startup.available_by)\(next(.schedule.startup.next))"
' <<<"$status"
