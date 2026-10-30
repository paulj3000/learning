#!/usr/bin/env bash
# Roll this instance back to an earlier healthy Django release (ADR-037).
#
#   rollback-django.sh                 # the last healthy release before the running one
#   rollback-django.sh --to <git sha>  # a specific earlier release that was healthy here
#
# Started by the SSM document `lai-django-rollback-<env>` (the GitHub workflow's rollback action)
# or by an operator on the instance. It restores the earlier image with that release's own compose
# file, starts it, checks health and records a `rollback` event. It never reverses a database
# migration: if releases after the target applied any, it says so and marks the record
# `manual_db_review_required`, because the old code may not work against the newer schema.
set -Eeuo pipefail
LAI_SCRIPT=rollback
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

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
current_digest=$(jq -r '.image_digest // empty' <<<"$current")
[ -s "$LAI_HISTORY" ] || die "$E_NOTHING_TO_ROLL_BACK" "no release history on this instance"

# The newest healthy deploy record that is not the running image (or that matches --to), whose
# bundle is still on disk.
target=""
while IFS= read -r candidate; do
    digest=$(jq -r '.image_digest' <<<"$candidate")
    [ "$digest" != "$current_digest" ] || continue
    if [ -n "$to_sha" ] && [ "$(jq -r '.git_sha' <<<"$candidate")" != "$to_sha" ]; then
        continue
    fi
    [ -f "$(release_dir_for "$(jq -r '.image' <<<"$candidate")")/deploy/ec2/docker-compose.yml" ] || continue
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
