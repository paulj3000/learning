#!/usr/bin/env bash
# First-time Django tasks for the native dev environment, run with the current release. One
# allowlisted task per call (SSM document `lai-dev-native-bootstrap`, operators only):
#
#   bootstrap-native.sh check                       # manage.py check --deploy, showmigrations
#   bootstrap-native.sh migrate                     # normally done by every deploy; for recovery
#   bootstrap-native.sh create-admin <username>     # superuser; password from SSM, never argv
#   bootstrap-native.sh ensure-roles                # every ensure_*_roles command the release has
#   bootstrap-native.sh load-content                # the versioned content export (ADR-033)
#   bootstrap-native.sh seed-content                # Treasure Cove, voices, Pip and Quill (create-only)
#   bootstrap-native.sh publish-seed-content        # publish_treasure_rush (dev only)
#   bootstrap-native.sh import-assets [--dry-run]   # npc-pip, treasure-chest, ground-tile
#
# None of these runs on a normal deploy. Exit codes: 0 ok, 1 the command failed, 2 usage,
# 30 configuration, 70 lock busy.
set -Eeuo pipefail
LAI_SCRIPT=bootstrap
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"

TREASURE_RUSH_ASSETS=npc-pip,treasure-chest,ground-tile
ROLE_COMMANDS=(ensure_asset_roles ensure_content_roles ensure_npc_roles ensure_sound_roles ensure_speech_roles)
# Create-only and safe to rerun. Voices come before the characters that use them.
SEED_COMMANDS=(seed_treasure_rush seed_speech_voices seed_npc_pip seed_npc_quill)

usage() {
    sed -n '5,12p' "$0" >&2
    exit "$E_USAGE"
}

task=${1:-}
argument=${2:-}
[ "$#" -le 2 ] || usage
case "$task" in
    check | migrate | ensure-roles | load-content | seed-content | publish-seed-content)
        [ -z "$argument" ] || usage ;;
    create-admin)
        [[ $argument =~ ^[a-z][a-z0-9_.-]{2,29}$ ]] || die "$E_USAGE" "username must be 3 to 30 of a-z 0-9 _ . -" ;;
    import-assets)
        [ -z "$argument" ] || [ "$argument" = --dry-run ] || usage ;;
    *) usage ;;
esac

load_conf
[ -e "$LAI_ROOT/current" ] || die "$E_CONFIG" "no current release; deploy one first"
release_dir=$(readlink -f "$LAI_ROOT/current")
git_sha=$(basename "$release_dir")
acquire_lock
"$LAI_SCRIPTS_DIR/render-env-native.sh"

has_command() { compgen -G "$release_dir/lai/apps/*/management/commands/$1.py" >/dev/null; }
run() { manage "$release_dir" "$git_sha" "$@"; }

case "$task" in
    check)
        run check --deploy --fail-level ERROR
        run showmigrations --plan | tail -n 20
        ;;
    migrate)
        run migrate --noinput
        ;;
    create-admin)
        param="${LAI_BOOTSTRAP_PREFIX:-/lai/$LAI_ENV/bootstrap}/DJANGO_ADMIN_PASSWORD"
        password=$(aws ssm get-parameter --name "$param" --with-decryption \
            --query Parameter.Value --output text 2>/dev/null) || die "$E_CONFIG" "parameter $param is missing"
        [ -n "$password" ] || die "$E_CONFIG" "parameter $param is empty"
        # By environment only: never in argv, the log or the history.
        DJANGO_ADMIN_PASSWORD=$password LAI_PASS_VARS=DJANGO_ADMIN_PASSWORD \
            run create_admin_account "$argument" --superuser --no-input
        unset password
        log "admin account $argument created; delete $param now (aws ssm delete-parameter)"
        ;;
    ensure-roles)
        for command in "${ROLE_COMMANDS[@]}"; do
            if has_command "$command"; then run "$command"; else log "skipping $command (not in this release)"; fi
        done
        ;;
    load-content)
        run load_content
        ;;
    seed-content)
        for command in "${SEED_COMMANDS[@]}"; do
            if has_command "$command"; then run "$command"; else log "skipping $command (not in this release)"; fi
        done
        ;;
    publish-seed-content)
        # A development bootstrap only. The command itself also refuses unless its own guard passes.
        [ "$LAI_ENV" = dev ] || die "$E_CONFIG" "publish-seed-content is for the dev environment only"
        # Waives only the command's local-machine guard, for this one process (ADR-055); every
        # content validation still runs. Production settings refuse the flag outside dev.
        LAI_DEV_BOOTSTRAP_PUBLISH=true LAI_ENVIRONMENT=dev \
            LAI_PASS_VARS="LAI_DEV_BOOTSTRAP_PUBLISH LAI_ENVIRONMENT" run publish_treasure_rush
        ;;
    import-assets)
        dry_run=()
        [ "$argument" != --dry-run ] || dry_run=(--dry-run)
        run import_assets --from-bundled --ids "$TREASURE_RUSH_ASSETS" "${dry_run[@]}"
        ;;
esac
log "bootstrap task $task finished"
