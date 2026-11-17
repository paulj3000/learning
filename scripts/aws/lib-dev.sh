# shellcheck shell=bash
# shellcheck disable=SC2034 # constants are used by the scripts that source this file
# Shared helpers for the native DEV environment's workstation and GitHub scripts:
# manage-dev.sh, show-endpoints.sh, deploy-debug.sh, install-debug.sh and dev-release.sh.
# Sourced, never executed. Nothing here runs on the instance (that is scripts/aws/native/).
#
# Configuration (all optional): environment variables, or KEY=value lines in $LAI_DEV_ENV_FILE
# (default: <repo>/.lai-dev.env, git-ignored; template scripts/aws/dev.env.example). The file is
# parsed, never sourced: only LAI_*, AWS_PROFILE and AWS_REGION keys are accepted, values are
# taken literally (optionally in single or double quotes), an unquoted empty value (KEY=) leaves
# the setting unset while KEY="" sets it empty, and a variable already set in the environment
# wins over the file.
#
# Guard rails, applied by every script:
#   - environment is dev only: LAI_ENV must be unset or `dev`;
#   - any stack or resource name containing "prod" is refused;
#   - a stack whose Environment tag (or Environment output) is not `dev` is refused;
#   - when LAI_DEV_ACCOUNT_ID is set the caller's account must match it; mutating
#     `deploy-debug.sh --execute` requires it.
#
# Shared exit codes (each script's header lists the ones it uses):
#   0 success (or nothing to do)            5 conflict (another power run, legacy stack,
#   1 the operation failed                      artifact checksum mismatch, hold active)
#   2 usage error                           6 timed out waiting (the operation may continue)
#   3 AWS/SSM transport or API failure      7 the environment is stopped or not ready for this
#   4 refused by an environment guard       8 not provisioned (stack or output missing)

DEV_REPO_ROOT=${DEV_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
DEV_SCRIPTS_DIR="$DEV_REPO_ROOT/scripts/aws"

readonly EX_OK=0 EX_FAIL=1 EX_USAGE=2 EX_TRANSPORT=3 EX_GUARD=4 EX_CONFLICT=5 EX_TIMEOUT=6
readonly EX_NOT_RUNNING=7 EX_MISSING=8

readonly DEV_ENV=dev
readonly DEV_FRONTEND_REGION=us-east-1
readonly DEV_PLATFORM_STACK=LaiDevPlatform-dev
readonly DEV_ARTIFACTS_STACK=LaiDevArtifacts-dev
readonly DEV_FRONTEND_STACK=LaiFrontend-dev
readonly DEV_LEGACY_STACK=LaiDjangoEc2-dev
readonly DEV_POWER_PREFIX=/lai/dev/power
readonly DEV_DEPLOY_PREFIX=/lai/dev/deploy
readonly DEV_DJANGO_PREFIX=/lai/dev/django
readonly GIT_SHA_RE='^[a-f0-9]{40}$'
readonly SHA256_RE='^[a-f0-9]{64}$'
readonly EPOCH_RE='^[0-9]{9,11}$'
readonly RUN_URL_RE='^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$'
readonly ISO_UTC_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

# The AWS CLI prints JSON (parsed with jq) and never pages.
export AWS_PAGER="" AWS_DEFAULT_OUTPUT=json

# --- output -------------------------------------------------------------------------------------
# Log lines go to stderr so a script's stdout can carry JSON (--json). Colour only on a terminal.
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
    C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BOLD=$'\033[1m' C_OFF=$'\033[0m'
else
    C_RED='' C_GREEN='' C_YELLOW='' C_BOLD='' C_OFF=''
fi
info() { printf '%s\n' "$*" >&2; }
step() { printf '%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF" >&2; }
ok() { printf '%sOK%s  %s\n' "$C_GREEN" "$C_OFF" "$*" >&2; }
warn() {
    printf '%sWARNING:%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2
    [ "${GITHUB_ACTIONS:-}" != true ] || printf '::warning::%s\n' "$*" >&2
}
err() {
    printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2
    [ "${GITHUB_ACTIONS:-}" != true ] || printf '::error::%s\n' "$*" >&2
}
die() {
    local code=$1
    shift
    err "$*"
    exit "$code"
}

# Append Markdown to the GitHub job summary (no-op outside Actions).
gh_summary() {
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"; fi
}
# Set a step output (no-op outside Actions).
gh_output() {
    if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"; fi
}

# --- exit hooks and scratch space ---------------------------------------------------------------
DEV_EXIT_HOOKS=()
dev_add_exit_hook() { DEV_EXIT_HOOKS+=("$1"); }
_dev_run_exit_hooks() {
    local status=$? hook
    for hook in "${DEV_EXIT_HOOKS[@]}"; do "$hook" || true; done
    return "$status"
}
trap _dev_run_exit_hooks EXIT
DEV_TMP=$(mktemp -d "${TMPDIR:-/tmp}/lai-dev.XXXXXX")
_dev_cleanup_tmp() { rm -rf "$DEV_TMP"; }
dev_add_exit_hook _dev_cleanup_tmp

# --- configuration ------------------------------------------------------------------------------
dev_load_config() {
    local file=${LAI_DEV_ENV_FILE:-$DEV_REPO_ROOT/.lai-dev.env}
    if [ ! -f "$file" ]; then
        [ -z "${LAI_DEV_ENV_FILE:-}" ] || die "$EX_USAGE" "LAI_DEV_ENV_FILE=$file does not exist"
        return 0
    fi
    local line key value n=0
    while IFS= read -r line || [ -n "$line" ]; do
        n=$((n + 1))
        line=${line%$'\r'}
        [[ $line =~ ^[[:space:]]*(#.*)?$ ]] && continue
        if [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            key=${BASH_REMATCH[2]}
            value=${BASH_REMATCH[3]}
        else
            die "$EX_USAGE" "$file line $n: expected KEY=value"
        fi
        case "$key" in
            LAI_* | AWS_PROFILE | AWS_REGION) ;;
            *) die "$EX_USAGE" "$file line $n: $key is not a supported setting (LAI_*, AWS_PROFILE, AWS_REGION)" ;;
        esac
        if [[ $value =~ ^\"([^\"]*)\"[[:space:]]*(#.*)?$ ]] || [[ $value =~ ^\'([^\']*)\'[[:space:]]*(#.*)?$ ]]; then
            value=${BASH_REMATCH[1]}
        else
            value=${value%%[[:space:]]#*}
            value=${value%"${value##*[![:space:]]}"}
            # An unquoted empty value is a placeholder: the setting stays unset. KEY="" sets it empty.
            [ -n "$value" ] || continue
        fi
        [[ -v $key ]] && continue # the environment wins
        printf -v "$key" '%s' "$value"
        export "${key?}"
    done <"$file"
}

# Common flags. Each script calls dev_common_flag "$@" in its argument loop; it returns the number
# of arguments consumed (0 when the flag is not a common one).
dev_common_flag() {
    case "$1" in
        --profile) [ -n "${2:-}" ] || die "$EX_USAGE" "--profile needs a value"; export AWS_PROFILE=$2; return 2 ;;
        --region) [ -n "${2:-}" ] || die "$EX_USAGE" "--region needs a value"; export AWS_REGION=$2; return 2 ;;
    esac
    return 0
}

dev_init() {
    dev_load_config
    export AWS_REGION=${AWS_REGION:-us-west-1}
    DEV_REGION=$AWS_REGION
    [[ $DEV_REGION =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]$ ]] || die "$EX_USAGE" "bad region '$DEV_REGION'"
    dev_guard_env
}

# --- guards -------------------------------------------------------------------------------------
dev_guard_env() {
    local env_name=${LAI_ENV:-dev}
    [ "$env_name" = "$DEV_ENV" ] ||
        die "$EX_GUARD" "these scripts manage the dev environment only (LAI_ENV=$env_name refused)"
    if [ -n "${LAI_DEV_ACCOUNT_ID:-}" ] && ! [[ $LAI_DEV_ACCOUNT_ID =~ ^[0-9]{12}$ ]]; then
        die "$EX_USAGE" "LAI_DEV_ACCOUNT_ID must be 12 digits"
    fi
}

dev_guard_name() {
    local name=${1,,}
    [[ $name != *prod* ]] || die "$EX_GUARD" "refusing '$1': names containing 'prod' are never touched by the dev scripts"
}

# dev_guard_account [required]: checks the caller's account. Sets DEV_ACCOUNT and DEV_CALLER.
dev_guard_account() {
    local required=${1:-}
    local identity
    identity=$(aws sts get-caller-identity --output json 2>"$DEV_TMP/sts.err") ||
        die "$EX_TRANSPORT" "AWS credentials are not usable ($(head -c 300 "$DEV_TMP/sts.err")); sign in, or pass --profile"
    DEV_ACCOUNT=$(jq -r '.Account // empty' <<<"$identity")
    DEV_CALLER=$(jq -r '.Arn // empty' <<<"$identity")
    [[ $DEV_ACCOUNT =~ ^[0-9]{12}$ ]] || die "$EX_TRANSPORT" "sts get-caller-identity returned no account"
    if [ -n "${LAI_DEV_ACCOUNT_ID:-}" ]; then
        [ "$DEV_ACCOUNT" = "$LAI_DEV_ACCOUNT_ID" ] ||
            die "$EX_GUARD" "credentials are for account $DEV_ACCOUNT, not the dev account LAI_DEV_ACCOUNT_ID=$LAI_DEV_ACCOUNT_ID"
    elif [ "$required" = required ]; then
        die "$EX_GUARD" "set LAI_DEV_ACCOUNT_ID (the 12-digit dev account) before changing AWS"
    fi
}

# --- CloudFormation -----------------------------------------------------------------------------
# dev_stack_json <stack> [region]: the Stacks[0] object (cached), or `null` when it does not exist.
dev_stack_json() {
    local stack=$1 region=${2:-$DEV_REGION}
    local cache="$DEV_TMP/stack-$region-$stack.json" out
    if [ ! -f "$cache" ]; then
        if out=$(aws cloudformation describe-stacks --region "$region" --stack-name "$stack" --output json 2>"$DEV_TMP/cfn.err"); then
            jq -c '.Stacks[0] // null' <<<"$out" >"$cache"
        elif grep -q 'does not exist' "$DEV_TMP/cfn.err"; then
            printf 'null' >"$cache"
        else
            err "cannot describe stack $stack in $region: $(head -c 300 "$DEV_TMP/cfn.err")"
            return "$EX_TRANSPORT"
        fi
    fi
    cat "$cache"
}
dev_stack_forget() { rm -f "$DEV_TMP"/stack-*.json; }

dev_stack_status() { dev_stack_json "$@" | jq -r '.StackStatus // empty'; }
dev_stack_exists() {
    local status
    status=$(dev_stack_status "$@") || return 1
    [ -n "$status" ] && [ "$status" != DELETE_COMPLETE ]
}
# stack_output <stack> <key> [region]: the output's value, empty when missing.
stack_output() {
    local json
    json=$(dev_stack_json "$1" "${3:-$DEV_REGION}") || return "$EX_TRANSPORT"
    jq -r --arg k "$2" '(.Outputs // [])[] | select(.OutputKey == $k) | .OutputValue' <<<"$json"
}
# stack_param <stack> <key> [region]: the deployed parameter value; exit 1 when the stack or
# parameter does not exist (so an empty value and a missing one can be told apart).
stack_param() {
    local json
    json=$(dev_stack_json "$1" "${3:-$DEV_REGION}") || return "$EX_TRANSPORT"
    jq -er --arg k "$2" '(.Parameters // [])[] | select(.ParameterKey == $k) | .ParameterValue' <<<"$json"
}
stack_tag() {
    local json
    json=$(dev_stack_json "$1" "${3:-$DEV_REGION}") || return "$EX_TRANSPORT"
    jq -r --arg k "$2" '(.Tags // [])[] | select(.Key == $k) | .Value' <<<"$json"
}

# dev_guard_stack <stack> [region]: refuse a prod name, or a deployed stack tagged for another
# environment (Environment tag or Environment output).
dev_guard_stack() {
    local stack=$1 region=${2:-$DEV_REGION} tag output
    dev_guard_name "$stack"
    [[ $stack == *-dev ]] || die "$EX_GUARD" "refusing stack $stack: dev stacks end in -dev"
    dev_stack_exists "$stack" "$region" || return 0
    tag=$(stack_tag "$stack" Environment "$region")
    output=$(stack_output "$stack" Environment "$region")
    if [ -n "$tag" ] && [ "$tag" != dev ]; then
        die "$EX_GUARD" "stack $stack is tagged Environment=$tag, not dev"
    fi
    if [ -n "$output" ] && [ "$output" != dev ]; then
        die "$EX_GUARD" "stack $stack reports Environment=$output, not dev"
    fi
}

# dev_out <key>: an output of LaiDevPlatform-dev.
dev_out() { stack_output "$DEV_PLATFORM_STACK" "$1"; }

# dev_require_platform: the platform stack must exist (exit 8 otherwise) and be dev.
dev_require_platform() {
    dev_guard_stack "$DEV_PLATFORM_STACK"
    dev_stack_exists "$DEV_PLATFORM_STACK" ||
        die "$EX_MISSING" "$DEV_PLATFORM_STACK is not deployed in $DEV_REGION (run scripts/aws/deploy-debug.sh --plan)"
    local instance
    instance=$(dev_out InstanceId)
    [[ $instance =~ ^i-[0-9a-f]{8,17}$ ]] || die "$EX_MISSING" "$DEV_PLATFORM_STACK has no InstanceId output"
    DEV_INSTANCE_ID=$instance
}

# --- SSM parameters -----------------------------------------------------------------------------
# dev_param <name>: a String parameter's value, empty when missing or unreadable. Never decrypts.
dev_param() {
    aws ssm get-parameter --region "$DEV_REGION" --name "$1" --output json 2>/dev/null |
        jq -r '.Parameter.Value // empty' 2>/dev/null || true
}
dev_param_exists() {
    local out
    out=$(aws ssm describe-parameters --region "$DEV_REGION" \
        --parameter-filters "Key=Name,Option=Equals,Values=$1" --output json) ||
        die "$EX_TRANSPORT" "cannot look up parameter $1"
    [ "$(jq '.Parameters | length' <<<"$out")" -gt 0 ]
}
dev_put_param() { # dev_put_param <name> <value>: String, overwrite
    dev_guard_name "$1"
    [[ $1 == /lai/dev/* ]] || die "$EX_GUARD" "refusing to write $1 (outside /lai/dev/)"
    aws ssm put-parameter --region "$DEV_REGION" --name "$1" --type String --overwrite \
        --value "$2" --output json >/dev/null
}

# --- live state ---------------------------------------------------------------------------------
dev_ec2_state() {
    aws ec2 describe-instances --region "$DEV_REGION" --instance-ids "$1" --output json 2>/dev/null |
        jq -r '.Reservations[0].Instances[0].State.Name // "unknown"' 2>/dev/null || echo unknown
}
dev_rds_state() {
    aws rds describe-db-instances --region "$DEV_REGION" --db-instance-identifier "$1" --output json 2>/dev/null |
        jq -r '.DBInstances[0].DBInstanceStatus // "unknown"' 2>/dev/null || echo unknown
}
dev_ssm_ping() {
    aws ssm describe-instance-information --region "$DEV_REGION" \
        --filters "Key=InstanceIds,Values=$1" --output json 2>/dev/null |
        jq -r '.InstanceInformationList[0].PingStatus // "unknown"' 2>/dev/null || echo unknown
}

# dev_http_code <url> [max-time]: the HTTP status, 000 when unreachable.
dev_http_code() {
    curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null || true
}

# HH:MM helpers. dev_next_local <HH:MM> <timezone>: the next occurrence, "YYYY-MM-DD HH:MM TZ"
# (GNU date; empty elsewhere).
dev_next_local() {
    local hhmm=$1 tz=$2 today now
    [[ $hhmm =~ ^[0-2][0-9]:[0-5][0-9]$ ]] || return 0
    now=$(date +%s)
    today=$(TZ=$tz date -d "today $hhmm" +%s 2>/dev/null) || return 0
    if [ "$today" -le "$now" ]; then today=$(TZ=$tz date -d "tomorrow $hhmm" +%s 2>/dev/null) || return 0; fi
    TZ=$tz date -d "@$today" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || true
}
# cron(MM HH * * ? *) -> HH:MM
dev_cron_hhmm() {
    if [[ $1 =~ ^cron\(([0-9]{1,2})\ ([0-9]{1,2})\  ]]; then
        printf '%02d:%02d' "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[1]}))"
    fi
}
dev_minutes_to_hhmm() { printf '%02d:%02d' "$(($1 / 60))" "$(($1 % 60))"; }
dev_hhmm_to_minutes() {
    [[ $1 =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || return 1
    echo $((10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]}))
}

# dev_status_json: everything manage-dev.sh status and show-endpoints.sh print, as one JSON
# object. Every read is best effort, so it works with the environment stopped and with the
# narrower GitHub infrastructure role.
dev_status_json() {
    local instance db type ec2 rds power last_result paused hold pending last_release
    local site cloudfront api admin tz shut_name start_name shut_json start_json readiness code
    local warmup shut_time start_time shut_state start_state available_by schedule_enabled minutes
    instance=$(dev_out InstanceId)
    db=$(dev_out DatabaseIdentifier)
    db=${db:-lai-dev}
    type=$(dev_out InstanceType)
    ec2=$(dev_ec2_state "$instance")
    rds=$(dev_rds_state "$db")
    power=$(dev_param "$DEV_POWER_PREFIX/state")
    last_result=$(dev_param "$DEV_POWER_PREFIX/last-result")
    paused=$(dev_param "$DEV_POWER_PREFIX/schedule-paused")
    hold=$(dev_param "$DEV_POWER_PREFIX/hold-until")
    pending=$(dev_param "$DEV_DEPLOY_PREFIX/pending")
    last_release=$(dev_param "$DEV_DEPLOY_PREFIX/last-release")
    site=$(dev_out SiteUrl)
    api=$(dev_out ApiBaseUrl)
    admin=$(dev_out AdminBaseUrl)
    cloudfront=$(stack_output "$DEV_FRONTEND_STACK" CloudFrontUrl "$DEV_FRONTEND_REGION" 2>/dev/null || true)
    if [ -z "$cloudfront" ]; then
        local domain
        domain=$(stack_output "$DEV_FRONTEND_STACK" DistributionDomainName "$DEV_FRONTEND_REGION" 2>/dev/null || true)
        [ -z "$domain" ] || cloudfront="https://$domain"
    fi
    tz=$(stack_param "$DEV_PLATFORM_STACK" ScheduleTimezone 2>/dev/null || echo America/Los_Angeles)
    warmup=$(stack_param "$DEV_PLATFORM_STACK" StartupWarmupMinutes 2>/dev/null || echo 25)
    schedule_enabled=$(stack_param "$DEV_PLATFORM_STACK" EnableScheduledShutdown 2>/dev/null || echo true)
    shut_time=$(stack_param "$DEV_PLATFORM_STACK" ShutdownTime 2>/dev/null || echo 00:00)
    start_time=$(stack_param "$DEV_PLATFORM_STACK" StartupTime 2>/dev/null || echo 07:35)
    shut_state=$([ "$schedule_enabled" = true ] && echo ENABLED || echo DISABLED)
    start_state=$shut_state
    shut_name=$(dev_out ShutdownScheduleName)
    start_name=$(dev_out StartupScheduleName)
    if [ -n "$shut_name" ] && shut_json=$(aws scheduler get-schedule --region "$DEV_REGION" --name "$shut_name" --output json 2>/dev/null); then
        shut_state=$(jq -r '.State // "unknown"' <<<"$shut_json")
        shut_time=$(dev_cron_hhmm "$(jq -r '.ScheduleExpression // ""' <<<"$shut_json")")
        tz=$(jq -r --arg tz "$tz" '.ScheduleExpressionTimezone // $tz' <<<"$shut_json")
    fi
    if [ -n "$start_name" ] && start_json=$(aws scheduler get-schedule --region "$DEV_REGION" --name "$start_name" --output json 2>/dev/null); then
        start_state=$(jq -r '.State // "unknown"' <<<"$start_json")
        start_time=$(dev_cron_hhmm "$(jq -r '.ScheduleExpression // ""' <<<"$start_json")")
    fi
    available_by=""
    if [[ $warmup =~ ^[0-9]+$ ]] && minutes=$(dev_hhmm_to_minutes "$start_time"); then
        available_by=$(dev_minutes_to_hhmm $(((minutes + warmup) % 1440)))
    fi
    readiness=skipped
    code=""
    if [ "$ec2" = running ] && [ -n "$site" ]; then
        code=$(dev_http_code "$site/api/v1/health/ready/")
        if [ "$code" = 200 ]; then readiness=ready; else readiness=not-ready; fi
    fi
    jq -n \
        --arg region "$DEV_REGION" --arg instance "$instance" --arg type "$type" --arg ec2 "$ec2" \
        --arg db "$db" --arg rds "$rds" --arg power "${power:-unknown}" --arg last_result "$last_result" \
        --arg paused "${paused:-unknown}" --arg hold "${hold:-none}" --arg pending "${pending:-none}" \
        --arg last_release "$last_release" --arg site "$site" --arg cloudfront "$cloudfront" \
        --arg api "$api" --arg admin "$admin" --arg tz "$tz" \
        --arg shut_name "$shut_name" --arg shut_state "$shut_state" --arg shut_time "$shut_time" \
        --arg shut_next "$(dev_next_local "$shut_time" "$tz")" \
        --arg start_name "$start_name" --arg start_state "$start_state" --arg start_time "$start_time" \
        --arg start_next "$(dev_next_local "$start_time" "$tz")" --arg available_by "$available_by" \
        --arg readiness "$readiness" --arg code "$code" \
        '{environment: "dev", region: $region,
          ec2: {instance_id: $instance, instance_type: $type, state: $ec2},
          rds: {identifier: $db, state: $rds},
          power: {state: $power, last_result: $last_result},
          schedule: {paused: $paused, hold_until: $hold, timezone: $tz,
                     shutdown: {name: $shut_name, state: $shut_state, time: $shut_time, next: $shut_next},
                     startup: {name: $start_name, state: $start_state, time: $start_time, next: $start_next,
                               available_by: $available_by}},
          readiness: {status: $readiness, http_code: $code},
          deploy: {pending: $pending, last_release: $last_release},
          urls: {cloudfront: $cloudfront, site: $site, game: (if $site == "" then "" else $site + "/" end),
                 api: $api, admin: $admin}}'
}

# --- SSM documents ------------------------------------------------------------------------------
# Meanings of the native release scripts' exit codes (scripts/aws/native/, the contract).
dev_native_code_message() {
    case "$1" in
        0) echo "success" ;;
        2) echo "usage error on the instance" ;;
        10) echo "invalid release request" ;;
        20) echo "artifact download or checksum verification failed" ;;
        30) echo "runtime configuration or secrets missing (or instance setup not complete)" ;;
        40) echo "preflight failed (check --deploy, database connectivity, migration plan)" ;;
        45) echo "destructive migrations refused (rerun with --allow-destructive-migrations after reading the runbook)" ;;
        50) echo "migration failed (the previous release is still running; MANUAL DATABASE REVIEW)" ;;
        60) echo "new release unhealthy; ROLLED BACK to the previous release" ;;
        61) echo "new release unhealthy and there is no previous release" ;;
        62) echo "new release unhealthy and the ROLLBACK FAILED" ;;
        63) echo "nothing to roll back to" ;;
        70) echo "another release holds the deployment lock" ;;
        75) echo "refused: the environment is stopping or stopped" ;;
        *) echo "unexpected failure on the instance" ;;
    esac
}

# dev_ssm_run <document> <parameters-json>: send one allowlisted document to the dev instance and
# wait. The instance output goes to stderr; DEV_SSM_STDOUT holds its stdout, DEV_SSM_CODE the exit
# code. Returns 0 on success, 1 when the command failed on the instance, 3 on transport failure.
dev_ssm_run() {
    local document=$1 params=$2
    local poll=${LAI_SSM_POLL_SECONDS:-10} max_wait=${LAI_SSM_MAX_WAIT_SECONDS:-2400}
    local ping command_id invocation status detail deadline
    DEV_SSM_STDOUT="" DEV_SSM_CODE=-1
    dev_guard_name "$document"
    [[ $document == lai-dev-native-* ]] || die "$EX_GUARD" "refusing document $document (not a lai-dev-native document)"
    [ -n "${DEV_INSTANCE_ID:-}" ] || dev_require_platform
    ping=$(dev_ssm_ping "$DEV_INSTANCE_ID")
    if [ "$ping" != Online ]; then
        err "instance $DEV_INSTANCE_ID is not online in SSM (PingStatus: $ping)"
        return "$EX_TRANSPORT"
    fi
    info "sending $document to $DEV_INSTANCE_ID"
    if ! command_id=$(aws ssm send-command --region "$DEV_REGION" --document-name "$document" \
        --instance-ids "$DEV_INSTANCE_ID" --parameters "$params" --timeout-seconds 120 \
        --comment "lai dev $document" --output json 2>"$DEV_TMP/ssm.err" | jq -r '.Command.CommandId // empty') ||
        [ -z "$command_id" ]; then
        err "send-command was rejected: $(head -c 300 "$DEV_TMP/ssm.err")"
        return "$EX_TRANSPORT"
    fi
    info "SSM command $command_id"
    deadline=$((SECONDS + max_wait))
    status=Pending
    while :; do
        sleep "$poll"
        if invocation=$(aws ssm get-command-invocation --region "$DEV_REGION" --command-id "$command_id" \
            --instance-id "$DEV_INSTANCE_ID" --output json 2>/dev/null); then
            status=$(jq -r '.Status' <<<"$invocation")
            case "$status" in Pending | InProgress | Delayed | Cancelling) ;; *) break ;; esac
        fi
        if [ "$SECONDS" -ge "$deadline" ]; then
            err "no result after ${max_wait}s (command $command_id still $status)"
            return "$EX_TRANSPORT"
        fi
    done
    detail=$(jq -r '.StatusDetails // ""' <<<"$invocation")
    DEV_SSM_CODE=$(jq -r '.ResponseCode // -1' <<<"$invocation")
    DEV_SSM_STDOUT=$(jq -r '.StandardOutputContent // ""' <<<"$invocation")
    {
        printf '%s\n' "----- instance output -----"
        printf '%s\n' "$DEV_SSM_STDOUT"
        jq -r '.StandardErrorContent // ""' <<<"$invocation"
        printf '%s\n' "---------------------------"
    } >&2
    case "$status" in
        Success) return 0 ;;
        Failed)
            if [ "$DEV_SSM_CODE" = -1 ]; then
                err "the command did not complete on the instance ($detail)"
                return "$EX_TRANSPORT"
            fi
            return 1
            ;;
        *)
            err "command $command_id ended $status ($detail)"
            return "$EX_TRANSPORT"
            ;;
    esac
}
