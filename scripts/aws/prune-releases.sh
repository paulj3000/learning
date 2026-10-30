#!/usr/bin/env bash
# Remove old release bundles and their images, keeping the newest $LAI_KEEP_RELEASES healthy ones
# and always the current one (ADR-037). Never removes volumes, the data directory, the runtime
# configuration or the release history. Called after a successful deploy; safe to run any time.
set -Eeuo pipefail
LAI_SCRIPT=prune
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

load_conf
[ -s "$LAI_HISTORY" ] || exit 0

current_id=$(jq -r '.image_digest // empty' <<<"$(current_record)")
current_id=${current_id#sha256:}
mapfile -t keep < <(jq -r 'select(.status == "healthy") | .image_digest' "$LAI_HISTORY" |
    tac | awk '!seen[$0]++' | head -n "$LAI_KEEP_RELEASES" | sed 's/^sha256://')
keep+=("$current_id")

for dir in "$LAI_RELEASES_DIR"/*/; do
    [ -d "$dir" ] || continue
    id=$(basename "$dir")
    [[ $id =~ ^[a-f0-9]{64}$ ]] || continue
    if printf '%s\n' "${keep[@]}" | grep -qx "$id"; then
        continue
    fi
    image=$(grep -m1 '^LAI_IMAGE=' "$dir/release.env" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$image" ]; then
        docker image rm "$image" >/dev/null 2>&1 || true
    fi
    rm -rf -- "$dir"
    log "pruned release $id"
done
docker image prune --force >/dev/null 2>&1 || true
