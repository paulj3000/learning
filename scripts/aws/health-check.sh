#!/usr/bin/env bash
# Check the running Django release on this instance (ADR-037).
#
#   health-check.sh [--expect-image <uri@sha256:...>] [--attempts N] [--interval S]
#
# Passes only when, within the attempts:
#   * the proxy answers GET /api/v1/health/ (liveness) with 200 and status "ok", and
#   * GET /api/v1/health/ready/ (database answers, no pending migration) with 200 and status "ok",
#   * and, with --expect-image, the running django container is that exact image.
# It calls the instance-local proxy on 127.0.0.1:8080, the port the load balancer uses, so it
# checks nginx and gunicorn together. Exit 0 healthy, 1 unhealthy.
set -Eeuo pipefail
LAI_SCRIPT="health-check"
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

expect_image=""
attempts=${LAI_HEALTH_ATTEMPTS:-20}
interval=${LAI_HEALTH_INTERVAL:-3}
base=${LAI_HEALTH_BASE_URL:-http://127.0.0.1:8080}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --expect-image) expect_image=$2; shift 2 ;;
        --attempts) attempts=$2; shift 2 ;;
        --interval) interval=$2; shift 2 ;;
        *) echo "usage: $0 [--expect-image IMAGE] [--attempts N] [--interval S]" >&2; exit "$E_USAGE" ;;
    esac
done

load_conf

probe() {
    local path=$1 body
    body=$(curl --silent --show-error --fail --max-time 5 -H "Host: $LAI_API_HOST" "$base$path" 2>/dev/null) || return 1
    [ "$(jq -r '.status // empty' <<<"$body" 2>/dev/null)" = ok ]
}

running_image_matches() {
    [ -n "$expect_image" ] || return 0
    local release_dir=${LAI_HEALTH_RELEASE_DIR:-$LAI_ROOT/current} cid want got
    cid=$(compose_for "$release_dir" ps -q django 2>/dev/null | head -n1)
    [ -n "$cid" ] || return 1
    got=$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null) || return 1
    want=$(docker image inspect --format '{{.Id}}' "$expect_image" 2>/dev/null) || return 1
    [ "$got" = "$want" ]
}

for ((n = 1; n <= attempts; n++)); do
    if probe /api/v1/health/ && probe /api/v1/health/ready/; then
        if running_image_matches; then
            log "healthy (live and ready) after $n attempt(s)"
            exit 0
        fi
        log "ready, but the running django container is not $expect_image"
    fi
    [ "$n" -lt "$attempts" ] && sleep "$interval"
done
log "UNHEALTHY after $attempts attempt(s)"
exit 1
