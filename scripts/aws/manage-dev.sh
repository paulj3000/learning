#!/usr/bin/env bash
# Operate the native DEV environment (LaiDevPlatform-dev): power, schedule, logs, sessions.
# Used by operators and by .github/workflows/manage-dev-infrastructure.yml. DEV ONLY: refuses any
# other environment, prod-named resources and (when LAI_DEV_ACCOUNT_ID is set) other accounts.
#
#   manage-dev.sh start | stop | restart                 # run the lai-dev-power state machine
#   manage-dev.sh status                                 # EC2, RDS, power, schedule, readiness, releases
#   manage-dev.sh pause-schedule | resume-schedule       # nightly stop / morning start on or off
#   manage-dev.sh hold (--hours N | --until YYYY-MM-DDTHH:MM:SSZ)   # skip scheduled stops until then
#   manage-dev.sh release-hold
#   manage-dev.sh logs [django|nginx|deploy|jobs|lambda-ai|lambda-media|power] [--since 1h] [--follow]
#   manage-dev.sh connect                                # SSM shell on the instance (no SSH)
#   manage-dev.sh db-tunnel                              # RDS on localhost:15432 through SSM
#   manage-dev.sh urls                                   # the site, game, API and admin URLs
#   manage-dev.sh deploy-pending                         # apply the deferred release now
#   manage-dev.sh start-and-deploy                       # start, then apply any deferred release
#   manage-dev.sh cert-check                             # TLS certificate state from the instance
#
# Flags: --profile P, --region R (default us-west-1), --no-wait (start/stop: return once the
# execution has started; restart still waits for the stop), --json (one JSON object on stdout:
# {operation, result, message, execution_arn, status}), --force (stop or restart although a hold
# is active; the state machine is told force=true).
#
# Power runs: every start/stop is one execution of the `lai-dev-power` Step Functions state
# machine with source `manual`, or `github` under GitHub Actions. A start while everything is
# already running, or a stop while everything is stopped, is a successful no-op. While an
# execution is RUNNING: the same action attaches to it and waits; the other action is refused
# (exit 5). Nothing here terminates EC2 or deletes RDS; the scripts cannot, and the GitHub roles
# have no such permission.
#
# cert-check runs the read-only `lai-dev-native-status` document (status-native.sh on the
# instance) and prints its output, then repeats the lines about certificates: the Let's Encrypt
# certificate `lai-dev` (API and admin hosts), its expiry, the ACME mode (route53 or http) and
# whether the self-signed placeholder is still in place. It never requests or renews a
# certificate; renewal is the instance's lai-certbot-renew.timer.
#
# db-tunnel prints the psql command to run in a second terminal. It reads the password from
# Secrets Manager at the moment you run it, through your own credentials; this script never
# prints or stores the password.
#
# Exit codes: 0 success or nothing to do; 1 the power execution or remote command failed;
# 2 usage; 3 AWS/SSM transport failure; 4 refused by the dev guard (environment, prod name,
# account); 5 conflict (another power execution is running, or a hold is active for stop);
# 6 timed out waiting (the execution continues); 7 the environment is stopped (connect,
# db-tunnel, deploy-pending, cert-check need it running); 8 not provisioned.
set -Eeuo pipefail
# shellcheck source=scripts/aws/lib-dev.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-dev.sh"

usage() {
    sed -n '5,18p' "$0" >&2
    exit "$EX_USAGE"
}

command=${1:-}
[ -n "$command" ] || usage
shift
wait_for=true json=false force=false hours="" until="" since=1h follow=false log_source=django
while [ "$#" -gt 0 ]; do
    consumed=0
    dev_common_flag "$@" || consumed=$?
    if [ "$consumed" -gt 0 ]; then shift "$consumed"; continue; fi
    case "$1" in
        --no-wait) wait_for=false; shift ;;
        --json) json=true; shift ;;
        --force) force=true; shift ;;
        --hours) hours=${2:-}; shift 2 || usage ;;
        --until) until=${2:-}; shift 2 || usage ;;
        --since) since=${2:-}; shift 2 || usage ;;
        --follow) follow=true; shift ;;
        django | nginx | deploy | jobs | lambda-ai | lambda-media | power)
            [ "$command" = logs ] || usage
            log_source=$1
            shift
            ;;
        -h | --help) usage ;;
        *) err "unknown argument $1"; usage ;;
    esac
done

dev_init
# shellcheck disable=SC2119 # the optional "required" mode is not wanted here
dev_guard_account
source_name=manual
[ "${GITHUB_ACTIONS:-}" != true ] || source_name=github
POLL=${LAI_POWER_POLL_SECONDS:-15}
MAX_WAIT=${LAI_POWER_MAX_WAIT_SECONDS:-2700}

# --- result reporting ---------------------------------------------------------------------------
# finish <exit code> <result> <message> [execution arn]
finish() {
    local code=$1 result=$2 message=$3 arn=${4:-}
    if [ "$json" = true ]; then
        local status='null'
        status=$(dev_status_json 2>/dev/null) || status='null'
        jq -n --arg op "$command" --arg result "$result" --arg message "$message" --arg arn "$arn" \
            --argjson status "$status" \
            '{operation: $op, result: $result, message: $message, execution_arn: $arn, status: $status}'
    else
        if [ "$code" -eq 0 ]; then ok "$message"; else err "$message"; fi
    fi
    exit "$code"
}

# --- power --------------------------------------------------------------------------------------
power_snapshot() {
    POWER_STATE=$(dev_param "$DEV_POWER_PREFIX/state")
    EC2_STATE=$(dev_ec2_state "$DEV_INSTANCE_ID")
    RDS_STATE=$(dev_rds_state "$DB_ID")
}

hold_active() { # prints the hold time when a hold is in the future
    local hold
    hold=$(dev_param "$DEV_POWER_PREFIX/hold-until")
    [[ $hold =~ $ISO_UTC_RE ]] || return 1
    [ "$(date -u -d "$hold" +%s 2>/dev/null || echo 0)" -gt "$(date -u +%s)" ] || return 1
    printf '%s' "$hold"
}

# wait_execution <arn> <action>: returns 0 SUCCEEDED, 1 failed, 6 timeout.
wait_execution() {
    local arn=$1 action=$2 deadline status last="" line
    deadline=$((SECONDS + MAX_WAIT))
    while :; do
        status=$(aws stepfunctions describe-execution --region "$DEV_REGION" --execution-arn "$arn" \
            --output json 2>/dev/null | jq -r '.status // "UNKNOWN"') || status=UNKNOWN
        power_snapshot
        line="$action: execution $status, power ${POWER_STATE:-unknown}, EC2 $EC2_STATE, RDS $RDS_STATE"
        [ "$line" = "$last" ] || info "[$(date -u +%H:%M:%S)] $line"
        last=$line
        case "$status" in
            SUCCEEDED) return 0 ;;
            FAILED | TIMED_OUT | ABORTED)
                local last_result
                last_result=$(dev_param "$DEV_POWER_PREFIX/last-result")
                [ -z "$last_result" ] || info "last result: $last_result"
                return 1
                ;;
        esac
        if [ "$SECONDS" -ge "$deadline" ]; then return "$EX_TIMEOUT"; fi
        sleep "$POLL"
    done
}

# power <start|stop> [wait override]: one execution, or a no-op.
power() {
    local action=$1 must_wait=${2:-$wait_for}
    local sm running arn input name hold same_action
    sm=$(dev_out PowerStateMachineArn)
    [[ $sm == arn:*:states:*:stateMachine:* ]] || die "$EX_MISSING" "$DEV_PLATFORM_STACK has no PowerStateMachineArn output"
    dev_guard_name "$sm"
    running=$(aws stepfunctions list-executions --region "$DEV_REGION" --state-machine-arn "$sm" \
        --status-filter RUNNING --max-results 10 --output json) ||
        die "$EX_TRANSPORT" "cannot list executions of $sm"
    arn=$(jq -r '.executions[0].executionArn // empty' <<<"$running")
    if [ -n "$arn" ]; then
        same_action=$(aws stepfunctions describe-execution --region "$DEV_REGION" --execution-arn "$arn" \
            --output json 2>/dev/null | jq -r '.input // "{}" | fromjson | .action // empty' 2>/dev/null || true)
        if [ "$same_action" != "$action" ]; then
            finish "$EX_CONFLICT" conflict "another power execution is running (${same_action:-unknown} $arn); try again when it finishes" "$arn"
        fi
        info "a $action is already in progress ($arn)"
    else
        power_snapshot
        if [ "$action" = start ] && [ "$POWER_STATE" = running ] && [ "$EC2_STATE" = running ] && [ "$RDS_STATE" = available ]; then
            info "already running: nothing to start"
            return 0
        fi
        if [ "$action" = stop ] && [ "$EC2_STATE" = stopped ] && [ "$RDS_STATE" = stopped ] && [ "$POWER_STATE" = stopped ]; then
            info "already stopped: nothing to stop"
            return 0
        fi
        if [ "$action" = stop ] && [ "$force" != true ] && hold=$(hold_active); then
            finish "$EX_CONFLICT" refused "a hold keeps the environment up until $hold; release-hold, or pass --force"
        fi
        input=$(jq -cn --arg action "$action" --arg source "$source_name" --argjson force "$force" \
            '{action: $action, source: $source, force: $force}')
        name="$action-$source_name-$(date -u +%Y%m%dT%H%M%SZ)-$$"
        arn=$(aws stepfunctions start-execution --region "$DEV_REGION" --state-machine-arn "$sm" \
            --name "$name" --input "$input" --output json | jq -r '.executionArn // empty') ||
            die "$EX_TRANSPORT" "start-execution failed"
        [ -n "$arn" ] || die "$EX_TRANSPORT" "start-execution returned no execution ARN"
        info "started $action ($source_name): $arn"
        gh_summary "- power $action started by $source_name: \`$arn\`"
    fi
    POWER_ARN=$arn
    if [ "$must_wait" != true ]; then return 0; fi
    local rc=0
    wait_execution "$arn" "$action" || rc=$?
    case "$rc" in
        0) return 0 ;;
        "$EX_TIMEOUT") finish "$EX_TIMEOUT" timeout "$action still running after ${MAX_WAIT}s; it continues ($arn)" "$arn" ;;
        *) finish "$EX_FAIL" failed "$action failed ($arn); see manage-dev.sh logs power" "$arn" ;;
    esac
}

# --- deferred releases --------------------------------------------------------------------------
deploy_pending() {
    local pending sha artifact epoch run_url params document rc=0
    pending=$(dev_param "$DEV_DEPLOY_PREFIX/pending")
    if [ -z "$pending" ] || [ "$pending" = none ]; then
        PENDING_RESULT="nothing pending"
        return 0
    fi
    sha=$(jq -r '.git_sha // empty' <<<"$pending" 2>/dev/null || true)
    artifact=$(jq -r '.artifact_sha256 // empty' <<<"$pending" 2>/dev/null || true)
    epoch=$(jq -r '.commit_epoch // empty | tostring' <<<"$pending" 2>/dev/null || true)
    run_url=$(jq -r '.run_url // ""' <<<"$pending" 2>/dev/null || true)
    if ! [[ $sha =~ $GIT_SHA_RE && $artifact =~ $SHA256_RE && $epoch =~ $EPOCH_RE ]]; then
        die "$EX_FAIL" "$DEV_DEPLOY_PREFIX/pending is not a valid release record"
    fi
    [[ -z $run_url || $run_url =~ $RUN_URL_RE ]] || run_url=""
    power_snapshot
    if [ "$EC2_STATE" != running ] || [[ ! ${POWER_STATE:-} =~ ^(running|degraded)$ ]]; then
        finish "$EX_NOT_RUNNING" stopped "release ${sha:0:12} is pending, but the environment is ${POWER_STATE:-$EC2_STATE}; start it (the pending release is applied on start) or use start-and-deploy"
    fi
    params=$(jq -cn --arg s "$sha" --arg a "$artifact" --arg e "$epoch" --arg r "$run_url" \
        '{GitSha: [$s], ArtifactSha256: [$a], CommitEpoch: [$e], RunUrl: [$r], AllowOlder: ["false"], AllowDestructiveMigrations: ["false"]}')
    document=$(dev_out DeployDocumentName)
    document=${document:-lai-dev-native-deploy}
    dev_ssm_run "$document" "$params" || rc=$?
    case "$rc" in
        0)
            PENDING_RESULT="deployed pending release ${sha:0:12}"
            # The instance clears the record too; this is best effort (the infra role cannot write it).
            local now
            now=$(dev_param "$DEV_DEPLOY_PREFIX/pending")
            if [ "$now" = "$pending" ]; then dev_put_param "$DEV_DEPLOY_PREFIX/pending" none 2>/dev/null || true; fi
            gh_summary "- pending release \`$sha\` deployed"
            ;;
        1) finish "$EX_FAIL" failed "pending release ${sha:0:12} failed on the instance: exit $DEV_SSM_CODE, $(dev_native_code_message "$DEV_SSM_CODE")" ;;
        *) finish "$EX_TRANSPORT" transport "could not run the deploy document" ;;
    esac
}

# --- human status -------------------------------------------------------------------------------
print_status() {
    local s=$1
    jq -r '
      "Learning Adventure Island - DEV status (\(.region))",
      "  EC2           \(.ec2.state) (\(.ec2.instance_id), \(.ec2.instance_type))",
      "  RDS           \(.rds.state) (\(.rds.identifier))",
      "  Power state   \(.power.state)",
      "  Last power    \(if .power.last_result == "" then "none" else .power.last_result end)",
      "  Schedule      \(if .schedule.paused == "true" then "PAUSED" else "active" end), hold until \(.schedule.hold_until)",
      "  Nightly stop  \(.schedule.shutdown.state) at \(.schedule.shutdown.time) \(.schedule.timezone), next \(.schedule.shutdown.next)",
      "  Morning start \(.schedule.startup.state) at \(.schedule.startup.time) \(.schedule.timezone), available by \(.schedule.startup.available_by), next \(.schedule.startup.next)",
      "  Readiness     \(.readiness.status)\(if .readiness.http_code != "" then " (HTTP " + .readiness.http_code + ")" else "" end)",
      "  Pending       \(.deploy.pending)",
      "  Last release  \(if .deploy.last_release == "" then "none" else .deploy.last_release end)"' <<<"$s"
}

print_urls() {
    jq -r '"CloudFront: \(.urls.cloudfront)", "Game:       \(.urls.game)", "API:        \(.urls.api)", "Admin:      \(.urls.admin)"' <<<"$1"
}

# --- commands -----------------------------------------------------------------------------------
dev_require_platform
DB_ID=$(dev_out DatabaseIdentifier)
DB_ID=${DB_ID:-lai-dev}
dev_guard_name "$DB_ID"
POWER_ARN=""

case "$command" in
    start)
        power start
        finish 0 succeeded "start: ${POWER_ARN:+execution $POWER_ARN, }$([ "$wait_for" = true ] && echo "environment running" || echo "started, not waiting")" "$POWER_ARN"
        ;;
    stop)
        power stop
        finish 0 succeeded "stop: ${POWER_ARN:+execution $POWER_ARN, }$([ "$wait_for" = true ] && echo "environment stopped" || echo "started, not waiting")" "$POWER_ARN"
        ;;
    restart)
        power stop true
        power start
        finish 0 succeeded "restart complete" "$POWER_ARN"
        ;;
    status)
        status=$(dev_status_json)
        if [ "$json" = true ]; then finish 0 ok "status"; fi
        print_status "$status"
        ;;
    urls)
        status=$(dev_status_json)
        if [ "$json" = true ]; then finish 0 ok "urls"; fi
        print_urls "$status"
        ;;
    pause-schedule)
        dev_put_param "$DEV_POWER_PREFIX/schedule-paused" true
        gh_summary "- nightly schedule paused"
        finish 0 ok "schedule paused: the nightly stop and morning start are skipped until resume-schedule"
        ;;
    resume-schedule)
        dev_put_param "$DEV_POWER_PREFIX/schedule-paused" false
        gh_summary "- nightly schedule resumed"
        finish 0 ok "schedule resumed"
        ;;
    hold)
        if [ -n "$hours" ]; then
            # shellcheck disable=SC2015 # B is a test: die runs whenever any check fails
            [[ $hours =~ ^[0-9]{1,3}$ ]] && [ "$hours" -ge 1 ] && [ "$hours" -le 168 ] ||
                die "$EX_USAGE" "--hours must be 1 to 168"
            until=$(date -u -d "+$hours hours" +%Y-%m-%dT%H:%M:%SZ)
        fi
        [[ $until =~ $ISO_UTC_RE ]] || die "$EX_USAGE" "hold needs --hours N or --until YYYY-MM-DDTHH:MM:SSZ (UTC)"
        until_s=$(date -u -d "$until" +%s 2>/dev/null) || die "$EX_USAGE" "--until $until is not a valid time"
        [ "$until_s" -gt "$(date -u +%s)" ] || die "$EX_USAGE" "--until must be in the future"
        [ "$until_s" -le $(($(date -u +%s) + 7 * 86400)) ] || die "$EX_USAGE" "a hold is at most 7 days"
        dev_put_param "$DEV_POWER_PREFIX/hold-until" "$until"
        gh_summary "- hold: scheduled stops skipped until $until"
        finish 0 ok "hold until $until: scheduled and RDS-event stops are skipped (a manual stop needs --force)"
        ;;
    release-hold)
        dev_put_param "$DEV_POWER_PREFIX/hold-until" none
        gh_summary "- hold released"
        finish 0 ok "hold released"
        ;;
    logs)
        [[ $since =~ ^[0-9]+[smhdw]$ ]] || die "$EX_USAGE" "--since must look like 30m, 2h or 1d"
        case "$log_source" in
            django | nginx | deploy | jobs) group=/lai/dev/$log_source ;;
            lambda-ai) group=/aws/lambda/$(dev_out AiWorkerFunctionName | sed 's/^none$//') ;;
            lambda-media) group=/aws/lambda/$(dev_out MediaWorkerFunctionName | sed 's/^none$//') ;;
            power)
                sm=$(dev_out PowerStateMachineArn)
                aws stepfunctions list-executions --region "$DEV_REGION" --state-machine-arn "$sm" \
                    --max-results 15 --output json |
                    jq -r '.executions[] | [.startDate, (.stopDate // "-"), .status, .name] | @tsv'
                echo "last result: $(dev_param "$DEV_POWER_PREFIX/last-result")"
                exit 0
                ;;
        esac
        [ "$group" != /aws/lambda/ ] || die "$EX_MISSING" "Lambda processing is not deployed"
        flags=(--since "$since" --format short)
        [ "$follow" != true ] || flags+=(--follow)
        exec aws logs tail "$group" --region "$DEV_REGION" "${flags[@]}"
        ;;
    connect)
        [ "$(dev_ec2_state "$DEV_INSTANCE_ID")" = running ] ||
            die "$EX_NOT_RUNNING" "the instance is not running (manage-dev.sh start)"
        exec aws ssm start-session --region "$DEV_REGION" --target "$DEV_INSTANCE_ID"
        ;;
    db-tunnel)
        [ "$(dev_ec2_state "$DEV_INSTANCE_ID")" = running ] ||
            die "$EX_NOT_RUNNING" "the instance is not running (manage-dev.sh start)"
        [ "$(dev_rds_state "$DB_ID")" = available ] ||
            die "$EX_NOT_RUNNING" "the database $DB_ID is not available"
        endpoint=$(dev_out DatabaseEndpoint)
        secret=$(dev_out DatabaseSecretArn)
        port=$(dev_out DatabasePort)
        local_port=${LAI_DB_TUNNEL_PORT:-15432}
        [ -n "$endpoint" ] || die "$EX_MISSING" "no DatabaseEndpoint output"
        cat >&2 <<EOF
Tunnel: localhost:$local_port -> $endpoint:${port:-5432} through $DEV_INSTANCE_ID (Ctrl-C to close).
In a second terminal (the password is read from Secrets Manager when you run it, never shown):

  PGPASSWORD="\$(aws secretsmanager get-secret-value --region $DEV_REGION --secret-id '$secret' --query SecretString --output text | jq -r .password)" \\
    psql "host=127.0.0.1 port=$local_port dbname=lai user=lai_admin sslmode=require"

(sslmode=require, not verify-full: the certificate names the RDS host, not 127.0.0.1.)
EOF
        exec aws ssm start-session --region "$DEV_REGION" --target "$DEV_INSTANCE_ID" \
            --document-name AWS-StartPortForwardingSessionToRemoteHost \
            --parameters "$(jq -cn --arg h "$endpoint" --arg p "${port:-5432}" --arg l "$local_port" \
                '{host: [$h], portNumber: [$p], localPortNumber: [$l]}')"
        ;;
    deploy-pending)
        PENDING_RESULT=""
        deploy_pending
        finish 0 ok "$PENDING_RESULT"
        ;;
    start-and-deploy)
        power start true
        PENDING_RESULT=""
        deploy_pending
        finish 0 ok "environment running; $PENDING_RESULT" "$POWER_ARN"
        ;;
    cert-check)
        [ "$(dev_ec2_state "$DEV_INSTANCE_ID")" = running ] ||
            die "$EX_NOT_RUNNING" "the instance is not running (manage-dev.sh start)"
        rc=0
        dev_ssm_run lai-dev-native-status '{}' || rc=$?
        [ "$rc" -ne "$EX_TRANSPORT" ] || finish "$EX_TRANSPORT" transport "could not run lai-dev-native-status"
        certs=$(grep -iE 'cert|expir|acme|letsencrypt|self-signed' <<<"$DEV_SSM_STDOUT" || true)
        info "certificate lines:"
        info "${certs:-  (none reported)}"
        [ "$rc" -eq 0 ] || finish "$EX_FAIL" failed "the status document failed: exit $DEV_SSM_CODE"
        finish 0 ok "certificate status shown above"
        ;;
    *) usage ;;
esac
