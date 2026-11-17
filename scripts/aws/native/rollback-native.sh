#!/usr/bin/env bash
# Roll the native dev instance back to an earlier healthy Django release.
#
#   rollback-native.sh                 # the last healthy release before the running one
#   rollback-native.sh --to <git sha>  # a specific earlier release that was healthy here
#
# Started by the SSM document `lai-dev-native-rollback` or by an operator on the instance. It
# reinstalls that release's units and nginx configuration, points /opt/lai/current at it, restarts
# and checks health, and records a `rollback` event. It never reverses a database migration: if
# releases after the target applied any, it says so and marks the record manual_db_review_required.
# Exit codes: 0 healthy, 2 usage, 10 invalid --to, 62 rollback failed, 63 nothing to roll back,
# 70 lock busy.
set -Eeuo pipefail
LAI_SCRIPT=rollback
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"

to_sha=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --to) to_sha=${2:-}; shift 2 ;;
        *) echo "usage: $0 [--to <git sha>]" >&2; exit "$E_USAGE" ;;
    esac
done
if [ -n "$to_sha" ] && ! [[ $to_sha =~ $GIT_SHA_PATTERN ]]; then
    die "$E_INVALID" "--to must be a full 40-character commit"
fi

load_conf
ensure_dirs
acquire_lock

current=$(current_record)
current_sha=$(jq -r '.git_sha // empty' <<<"$current")
[ -s "$LAI_HISTORY" ] || die "$E_NOTHING_TO_ROLL_BACK" "no release history on this instance"

# The newest healthy deploy record that is not the running release (or that matches --to), whose
# release directory is still complete on disk.
target=""
while IFS= read -r candidate; do
    sha=$(jq -r '.git_sha' <<<"$candidate")
    [ "$sha" != "$current_sha" ] || continue
    [ -z "$to_sha" ] || [ "$sha" = "$to_sha" ] || continue
    release_ready "$(release_dir_for "$sha")" || continue
    target=$candidate
    break
done < <(jq -c 'select(.event == "deploy" and .status == "healthy")' "$LAI_HISTORY" | tac)

if [ -z "$target" ]; then
    die "$E_NOTHING_TO_ROLL_BACK" "no earlier healthy release${to_sha:+ for $to_sha} is available on this instance"
fi

if rollback_to "$target" manual "$current"; then
    exit 0
fi
exit "$E_ROLLBACK_FAILED"
