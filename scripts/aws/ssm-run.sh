#!/usr/bin/env bash
# Run one of the environment's SSM documents on its Django instance and wait for the result
# (ADR-037). Used by the GitHub workflow (deploy, rollback) and by operators (all actions).
#
#   ssm-run.sh <dev|prod> deploy --image <uri@sha256:..> --git-sha <sha> --commit-epoch <s> \
#       [--run-url <url>] [--allow-older] [--allow-destructive-migrations]
#   ssm-run.sh <dev|prod> rollback [--to <git sha>]
#   ssm-run.sh <dev|prod> status
#   ssm-run.sh <dev|prod> bootstrap <task> [<argument>]    # see bootstrap-django.sh
#   ssm-run.sh <dev|prod> setup                            # rerun setup-ec2.sh
#
# Needs the AWS CLI with credentials (the GitHub deploy role, or an operator) and jq. The instance
# id comes from the stack output; the document names are fixed per environment. Only document
# parameters are sent, never shell text: each document checks them against fixed patterns.
#
# Exit codes: 0 success; 1 the release on the instance failed (application failure, the output
# says which stage and whether it rolled back); 3 SSM transport failure (instance offline, command
# undeliverable, timed out or cancelled); 2 usage.
set -Eeuo pipefail

REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}
POLL_SECONDS=${LAI_SSM_POLL_SECONDS:-10}
MAX_WAIT_SECONDS=${LAI_SSM_MAX_WAIT_SECONDS:-2400}

say() { printf '%s\n' "$*" >&2; }
usage() { sed -n '5,11p' "$0" >&2; exit 2; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi; }
transport_failure() {
    say "::error::SSM TRANSPORT FAILURE: $*"
    summary "**SSM transport failure:** $*"
    exit 3
}

# Meanings of deploy-django.sh / rollback-django.sh exit codes (scripts/aws/lib.sh).
describe_code() {
    case "$1" in
        2) echo "usage error" ;;
        10) echo "invalid release request" ;;
        11) echo "image is not from this environment's repository" ;;
        12) echo "image labels or deploy bundle rejected (not a pipeline release build)" ;;
        15) echo "out-of-order release refused (older than the running release)" ;;
        20) echo "image pull failed" ;;
        30) echo "runtime configuration or secrets missing" ;;
        40) echo "preflight failed (compose config, manage.py check --deploy, migration plan)" ;;
        45) echo "destructive migrations refused" ;;
        48) echo "pre-migration RDS snapshot failed" ;;
        50) echo "migration failed (previous release still running; MANUAL DATABASE REVIEW)" ;;
        60) echo "new release unhealthy; ROLLED BACK to the previous release" ;;
        61) echo "new release unhealthy and there is no previous release" ;;
        62) echo "new release unhealthy and the ROLLBACK FAILED" ;;
        63) echo "nothing to roll back to" ;;
        70) echo "another release holds the deployment lock" ;;
        *) echo "unexpected failure on the instance" ;;
    esac
}

env_name=${1:-}
action=${2:-}
shift 2 || usage
case "$env_name" in dev | prod) ;; *) usage ;; esac

params='{}'
add() { params=$(jq -c --arg k "$1" --arg v "$2" '.[$k] = [$v]' <<<"$params"); }
case "$action" in
    deploy)
        add AllowOlder false
        add AllowDestructiveMigrations false
        add RunUrl ""
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --image) add Image "$2"; shift 2 ;;
                --git-sha) add GitSha "$2"; shift 2 ;;
                --commit-epoch) add CommitEpoch "$2"; shift 2 ;;
                --run-url) add RunUrl "$2"; shift 2 ;;
                --allow-older) add AllowOlder true; shift ;;
                --allow-destructive-migrations) add AllowDestructiveMigrations true; shift ;;
                *) usage ;;
            esac
        done
        for required in Image GitSha CommitEpoch; do
            jq -e --arg k "$required" 'has($k)' <<<"$params" >/dev/null || usage
        done
        ;;
    rollback)
        add ToGitSha ""
        if [ "${1:-}" = --to ]; then add ToGitSha "${2:-}"; fi
        ;;
    status | setup) ;;
    bootstrap)
        add Task "${1:-}"
        add Argument "${2:-}"
        ;;
    *) usage ;;
esac

stack=${LAI_STACK_NAME:-LaiDjangoEc2-$env_name}
document="lai-django-$action-$env_name"
log_group="/lai/$env_name/ssm"

instance_id=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text 2>/dev/null) ||
    transport_failure "cannot read stack $stack (credentials, region $REGION, or the stack is not deployed)"
[[ $instance_id =~ ^i-[0-9a-f]{8,17}$ ]] || transport_failure "stack $stack has no InstanceId output"

ping=$(aws ssm describe-instance-information --region "$REGION" \
    --filters "Key=InstanceIds,Values=$instance_id" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo unknown)
[ "$ping" = Online ] || transport_failure "instance $instance_id is not online in SSM (PingStatus: $ping)"

say "sending $document to $instance_id"
command_id=$(aws ssm send-command --region "$REGION" --document-name "$document" \
    --instance-ids "$instance_id" --parameters "$params" --timeout-seconds 120 \
    --comment "lai $action $env_name" \
    --cloud-watch-output-config "CloudWatchOutputEnabled=true,CloudWatchLogGroupName=$log_group" \
    --query Command.CommandId --output text) || transport_failure "send-command was rejected"
say "command $command_id; full output in CloudWatch Logs $log_group"

deadline=$((SECONDS + MAX_WAIT_SECONDS))
status=Pending
while :; do
    sleep "$POLL_SECONDS"
    if invocation=$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
        --instance-id "$instance_id" --output json 2>/dev/null); then
        status=$(jq -r .Status <<<"$invocation")
        case "$status" in Pending | InProgress | Delayed | Cancelling) ;; *) break ;; esac
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
        transport_failure "no result after ${MAX_WAIT_SECONDS}s (command $command_id still $status)"
    fi
done

detail=$(jq -r '.StatusDetails // ""' <<<"$invocation")
code=$(jq -r '.ResponseCode // -1' <<<"$invocation")
printf '%s\n' "----- instance output (stdout) -----"
jq -r '.StandardOutputContent // ""' <<<"$invocation"
printf '%s\n' "----- instance output (stderr) -----"
jq -r '.StandardErrorContent // ""' <<<"$invocation"
printf '%s\n' "------------------------------------"

case "$status" in
    Success)
        say "$action succeeded on $instance_id"
        summary "**$action ($env_name) succeeded** on \`$instance_id\` (SSM command \`$command_id\`)."
        exit 0
        ;;
    Failed)
        if [ "$code" = -1 ]; then
            transport_failure "the command did not complete on the instance ($detail)"
        fi
        meaning=$(describe_code "$code")
        say "::error::APPLICATION DEPLOYMENT FAILURE: $action on $env_name exited $code: $meaning"
        summary "**$action ($env_name) failed on the instance:** exit $code, $meaning. SSM command \`$command_id\`."
        exit 1
        ;;
    *)
        transport_failure "command $command_id ended $status ($detail)"
        ;;
esac
