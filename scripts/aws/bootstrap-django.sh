#!/usr/bin/env bash
# First-time Django tasks for a new environment, run in the current release's image (ADR-037,
# docs/platform/DJANGO_EC2_DEPLOYMENT.md "First release"). One allowlisted task per call:
#
#   bootstrap-django.sh check                     # manage.py check --deploy, showmigrations
#   bootstrap-django.sh migrate                   # normally done by every deploy; for recovery
#   bootstrap-django.sh create-admin <username>   # superuser; password from SSM, never argv
#   bootstrap-django.sh ensure-asset-roles        # the Asset editor / Asset publisher groups
#   bootstrap-django.sh load-content              # the versioned content export (ADR-033)
#   bootstrap-django.sh seed-treasure-rush        # Treasure Cove as DRAFT
#   bootstrap-django.sh import-assets [--dry-run] # npc-pip, treasure-chest, ground-tile
#
# Started by the SSM document `lai-django-bootstrap-<env>` (operators only; the GitHub deploy
# role cannot run it) or on the instance. None of these runs on a normal deploy: importing and
# publishing assets are explicit administrative actions (docs/ASSET_MANAGER.md section 19).
# Publishing the imported versions is done in Django Admin (section 19.2).
set -Eeuo pipefail
LAI_SCRIPT=bootstrap
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

TREASURE_RUSH_ASSETS=npc-pip,treasure-chest,ground-tile

task=${1:-}
shift || true
load_conf
[ -e "$LAI_ROOT/current" ] || die "$E_CONFIG" "no current release; deploy one first"
release_dir=$(readlink -f "$LAI_ROOT/current")
acquire_lock
"$LAI_SCRIPTS_DIR/render-env.sh"

manage() { compose_for "$release_dir" run --rm --no-deps -T "$@"; }

case "$task" in
    check)
        manage django python manage.py check --deploy --fail-level ERROR
        manage django python manage.py showmigrations --plan | tail -n 20
        ;;
    migrate)
        manage django python manage.py migrate --noinput
        ;;
    create-admin)
        username=${1:-}
        [[ $username =~ ^[a-z][a-z0-9_.-]{2,29}$ ]] || die "$E_USAGE" "username must be 3 to 30 of a-z 0-9 _ . -"
        param="/lai/$LAI_ENV/bootstrap/DJANGO_ADMIN_PASSWORD"
        password=$(aws ssm get-parameter --name "$param" --with-decryption \
            --query Parameter.Value --output text 2>/dev/null) || die "$E_CONFIG" "parameter $param is missing"
        # Passed by name only (-e NAME), so the value is in neither argv nor the log.
        DJANGO_ADMIN_PASSWORD=$password manage -e DJANGO_ADMIN_PASSWORD django \
            python manage.py create_admin_account "$username" --superuser --no-input
        log "admin account $username created; delete $param now (aws ssm delete-parameter)"
        ;;
    ensure-asset-roles)
        manage django python manage.py ensure_asset_roles
        ;;
    load-content)
        manage django python manage.py load_content
        ;;
    seed-treasure-rush)
        manage django python manage.py seed_treasure_rush
        ;;
    import-assets)
        dry_run=()
        [ "${1:-}" = --dry-run ] && dry_run=(--dry-run)
        manage django python manage.py import_assets --from-bundled --ids "$TREASURE_RUSH_ASSETS" "${dry_run[@]}"
        ;;
    *)
        sed -n '5,11p' "$0" >&2
        exit "$E_USAGE"
        ;;
esac
log "bootstrap task $task finished"
