#!/usr/bin/env bash
# Build /opt/lai/runtime/django.env from AWS at release time (ADR-037). Never prints a value.
#
#   render-env.sh            (reads /etc/lai/deploy.conf; called by deploy, rollback, bootstrap)
#
# Sources, all read with the instance role (no access keys anywhere):
#   * SSM Parameter Store, every parameter under $LAI_PARAM_PREFIX (`/lai/<env>/django/`): the
#     stack writes the plain settings as String parameters; an operator writes DJANGO_SECRET_KEY as
#     a SecureString. The parameter's last path segment is the variable name.
#   * rds mode: the RDS master secret in Secrets Manager becomes DATABASE_URL, with TLS verified
#     against the RDS CA bundle (sslmode=verify-full).
#   * container mode (dev only): /lai/<env>/db/POSTGRES_PASSWORD (SecureString) becomes both the
#     database container's password and DATABASE_URL to it.
# The file is written with mode 0600 and replaced atomically, so a failed render leaves the
# previous configuration in place.
set -Eeuo pipefail
LAI_SCRIPT=render-env
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/aws/lib.sh
. "$LAI_SCRIPTS_DIR/lib.sh"

REQUIRED=(DJANGO_SECRET_KEY DATABASE_URL DJANGO_ALLOWED_HOSTS DJANGO_CSRF_TRUSTED_ORIGINS
    COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_ALLOWED_CLIENT_IDS
    LAI_ASSET_STORAGE LAI_ASSET_BUCKET LAI_ASSET_REGION)
# Never from the parameter store: the settings module and the API authentication provider
# (cognito, ADR-038) are fixed by the compose file, DEBUG and raw tracebacks have no production
# switch, and static AWS keys would bypass the instance role.
FORBIDDEN='^(DJANGO_SETTINGS_MODULE|AUTH_PROVIDER|DEBUG|DJANGO_DEBUG|LOG_RAW_EXCEPTIONS|AWS_.*|PYTHON.*|PATH|HOME)$'
ALLOWED='^(DJANGO_[A-Z0-9_]+|COGNITO_[A-Z0-9_]+|LAI_[A-Z0-9_]+|WEB_CONCURRENCY|GUNICORN_TIMEOUT|FORWARDED_ALLOW_IPS)$'

main() {
    load_conf
    ensure_dirs
    local params out pg_out
    RENDER_TMP=$(mktemp -d "$LAI_RUNTIME_DIR/.render.XXXXXX")
    trap 'rm -rf "$RENDER_TMP"' EXIT
    local tmp_dir=$RENDER_TMP
    umask 077
    out="$tmp_dir/django.env"
    pg_out="$tmp_dir/postgres.env"

    if ! params=$(aws ssm get-parameters-by-path --path "${LAI_PARAM_PREFIX%/}/" --recursive \
        --with-decryption --query 'Parameters[].[Name,Value]' --output json 2>/dev/null); then
        die "$E_CONFIG" "could not read SSM parameters under ${LAI_PARAM_PREFIX%/}/ (instance role or path)"
    fi

    local count name value key
    count=$(jq 'length' <<<"$params")
    : >"$out"
    for ((i = 0; i < count; i++)); do
        name=$(jq -r ".[$i][0]" <<<"$params")
        value=$(jq -r ".[$i][1]" <<<"$params")
        key=${name##*/}
        if [[ $key =~ $FORBIDDEN ]]; then
            die "$E_CONFIG" "parameter $name sets $key, which the release never takes from SSM"
        fi
        if [ "$key" = DATABASE_URL ]; then
            die "$E_CONFIG" "DATABASE_URL is built by the release; remove parameter $name"
        fi
        if ! [[ $key =~ $ALLOWED ]]; then
            die "$E_CONFIG" "parameter $name is not a recognised setting name"
        fi
        if [[ $value == *$'\n'* ]] || [ -z "$value" ]; then
            die "$E_CONFIG" "parameter $name is empty or has a line break"
        fi
        printf '%s=%s\n' "$key" "$value" >>"$out"
    done

    case "$LAI_DB_MODE" in
        rds)
            local secret
            if ! secret=$(aws secretsmanager get-secret-value --secret-id "$LAI_DB_SECRET_ARN" \
                --query SecretString --output text 2>/dev/null); then
                die "$E_CONFIG" "could not read the database secret (instance role or secret ARN)"
            fi
            jq -r --arg ca "/etc/lai/certs/rds-global-bundle.pem" '
                "DATABASE_URL=postgresql://\(.username | @uri):\(.password | @uri)@\(.host):\(.port)/\(.dbname // "lai")"
                + "?sslmode=verify-full&sslrootcert=\($ca)"' <<<"$secret" >>"$out"
            [ -s "$LAI_CERTS_DIR/rds-global-bundle.pem" ] ||
                die "$E_CONFIG" "the RDS CA bundle is missing from $LAI_CERTS_DIR (rerun setup-ec2.sh)"
            ;;
        container)
            local password
            if ! password=$(aws ssm get-parameter --name "/lai/$LAI_ENV/db/POSTGRES_PASSWORD" \
                --with-decryption --query Parameter.Value --output text 2>/dev/null) || [ -z "$password" ]; then
                die "$E_CONFIG" "parameter /lai/$LAI_ENV/db/POSTGRES_PASSWORD is missing"
            fi
            printf 'POSTGRES_USER=lai\nPOSTGRES_DB=lai\nPOSTGRES_PASSWORD=%s\n' "$password" >"$pg_out"
            jq -rn --arg p "$password" '"DATABASE_URL=postgresql://lai:\($p | @uri)@db:5432/lai?sslmode=disable"' >>"$out"
            ;;
    esac
    printf 'AWS_DEFAULT_REGION=%s\n' "$AWS_REGION" >>"$out"

    local missing=()
    for key in "${REQUIRED[@]}"; do
        grep -q "^$key=" "$out" || missing+=("$key")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        die "$E_CONFIG" "missing runtime settings: ${missing[*]} (see docs/platform/DJANGO_EC2_DEPLOYMENT.md)"
    fi
    grep -qx 'LAI_ASSET_STORAGE=s3' "$out" || die "$E_CONFIG" "LAI_ASSET_STORAGE must be s3"
    local duplicates
    duplicates=$(cut -d= -f1 "$out" | sort | uniq -d | paste -sd, -)
    [ -z "$duplicates" ] || die "$E_CONFIG" "settings defined twice: $duplicates"

    mv -f "$out" "$LAI_RUNTIME_DIR/django.env"
    if [ -f "$pg_out" ]; then mv -f "$pg_out" "$LAI_RUNTIME_DIR/postgres.env"; fi
    log "runtime configuration written: $(cut -d= -f1 "$LAI_RUNTIME_DIR/django.env" | sort | paste -sd' ' -)"
}

main "$@"
