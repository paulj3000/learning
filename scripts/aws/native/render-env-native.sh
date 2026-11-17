#!/usr/bin/env bash
# Build /opt/lai/runtime/django.env for the native dev release. Never prints a value.
#
#   render-env-native.sh        (reads /etc/lai/native.conf; called by deploy, rollback, bootstrap)
#
# Sources, read with the instance role:
#   * SSM Parameter Store, every parameter under $LAI_PARAM_PREFIX (/lai/dev/django/): the stack's
#     String settings, the operator's SecureString DJANGO_SECRET_KEY, the Guardrail stack's LAI_AI_*.
#     The parameter's last path segment is the variable name.
#   * the RDS secret (Secrets Manager) becomes DATABASE_URL with sslmode=verify-full.
# Written root:lai 0640 and replaced atomically, so a failed render keeps the previous file.
set -Eeuo pipefail
LAI_SCRIPT=render-env
LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=scripts/aws/native/lib-native.sh
. "$LAI_SCRIPTS_DIR/lib-native.sh"

REQUIRED=(DJANGO_SECRET_KEY DATABASE_URL DJANGO_ALLOWED_HOSTS DJANGO_CSRF_TRUSTED_ORIGINS
    COGNITO_REGION COGNITO_USER_POOL_ID COGNITO_ALLOWED_CLIENT_IDS
    LAI_ASSET_STORAGE LAI_ASSET_BUCKET LAI_ASSET_REGION)
# Never from the parameter store: the settings module and release id are fixed by the unit, DEBUG
# has no production switch, and static AWS keys would bypass the instance role.
FORBIDDEN='^(DJANGO_SETTINGS_MODULE|DEBUG|DJANGO_DEBUG|LOG_RAW_EXCEPTIONS|LAI_RELEASE_SHA|LAI_DEV_BOOTSTRAP_PUBLISH|LAI_ENVIRONMENT|AWS_.*|PYTHON.*|PATH|HOME)$'
ALLOWED='^(DJANGO_[A-Z0-9_]+|COGNITO_[A-Z0-9_]+|LAI_[A-Z0-9_]+|WEB_CONCURRENCY|GUNICORN_TIMEOUT|FORWARDED_ALLOW_IPS)$'

main() {
    load_conf
    ensure_dirs
    local params out tmp_dir count name value key secret
    tmp_dir=$(mktemp -d "$LAI_RUNTIME_DIR/.render.XXXXXX")
    # shellcheck disable=SC2064 # expand now: the directory is local to this call
    trap "rm -rf '$tmp_dir'" EXIT
    umask 077
    out="$tmp_dir/django.env"

    if ! params=$(aws ssm get-parameters-by-path --path "${LAI_PARAM_PREFIX%/}/" --recursive \
        --with-decryption --query 'Parameters[].[Name,Value]' --output json 2>/dev/null); then
        die "$E_CONFIG" "could not read SSM parameters under ${LAI_PARAM_PREFIX%/}/ (instance role or path)"
    fi

    count=$(jq 'length' <<<"$params")
    : >"$out"
    for ((i = 0; i < count; i++)); do
        name=$(jq -r ".[$i][0]" <<<"$params")
        value=$(jq -r ".[$i][1]" <<<"$params")
        key=${name##*/}
        if [[ $key =~ $FORBIDDEN ]]; then
            die "$E_CONFIG" "parameter $name sets $key, which the release never takes from SSM"
        fi
        [ "$key" != DATABASE_URL ] || die "$E_CONFIG" "DATABASE_URL is built by the release; remove parameter $name"
        [[ $key =~ $ALLOWED ]] || die "$E_CONFIG" "parameter $name is not a recognised setting name"
        if [[ $value == *$'\n'* ]] || [ -z "$value" ]; then
            die "$E_CONFIG" "parameter $name is empty or has a line break"
        fi
        # systemd's EnvironmentFile= interprets quotes and backslashes; the scripts read lines
        # literally. Refuse them so both see the same value.
        if [[ $value == *[\"\'\\]* ]]; then
            die "$E_CONFIG" "parameter $name contains a quote or backslash, which the unit file cannot carry"
        fi
        printf '%s=%s\n' "$key" "$value" >>"$out"
    done

    if ! secret=$(aws secretsmanager get-secret-value --secret-id "$LAI_DB_SECRET_ARN" \
        --query SecretString --output text 2>/dev/null); then
        die "$E_CONFIG" "could not read the database secret (instance role or secret ARN)"
    fi
    jq -r --arg ca "$LAI_RDS_CA" '
        "DATABASE_URL=postgresql://\(.username | @uri):\(.password | @uri)@\(.host):\(.port)/\(.dbname // "lai")"
        + "?sslmode=verify-full&sslrootcert=\($ca)"' <<<"$secret" >>"$out" ||
        die "$E_CONFIG" "the database secret is not the expected JSON"
    [ -s "$LAI_RDS_CA" ] || die "$E_CONFIG" "the RDS CA bundle $LAI_RDS_CA is missing (rerun setup-native.sh)"
    printf 'AWS_DEFAULT_REGION=%s\n' "$AWS_REGION" >>"$out"

    local missing=()
    for key in "${REQUIRED[@]}"; do
        grep -q "^$key=" "$out" || missing+=("$key")
    done
    [ "${#missing[@]}" -eq 0 ] || die "$E_CONFIG" "missing runtime settings: ${missing[*]}"
    grep -qx 'LAI_ASSET_STORAGE=s3' "$out" || die "$E_CONFIG" "LAI_ASSET_STORAGE must be s3"
    local duplicates
    duplicates=$(cut -d= -f1 "$out" | sort | uniq -d | paste -sd, -)
    [ -z "$duplicates" ] || die "$E_CONFIG" "settings defined twice: $duplicates"

    chmod 0640 "$out"
    [ -z "$LAI_ENV_GROUP" ] || chgrp "$LAI_ENV_GROUP" "$out"
    mv -f "$out" "$LAI_RUNTIME_DIR/django.env"
    log "runtime configuration written: $(cut -d= -f1 "$LAI_RUNTIME_DIR/django.env" | sort | paste -sd' ' -)"
}

main "$@"
