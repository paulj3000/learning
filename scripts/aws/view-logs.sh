#!/usr/bin/env bash
# Recent Django, proxy and deployment logs (ADR-037). Two modes:
#
#   view-logs.sh <dev|prod> [app|proxy|deploy|ssm] [--since 30m]   # from a workstation, CloudWatch
#   view-logs.sh --local [deploy|django|proxy] [--lines 200]       # on the instance
#
# CloudWatch groups: /lai/<env>/django (Django), /lai/<env>/proxy (nginx errors),
# /lai/<env>/deploy (deploy.log from the instance), /lai/<env>/ssm (SSM command output).
# The application logs are privacy filtered at the source (ADR-025); nothing here adds to them.
set -Eeuo pipefail

if [ "${1:-}" = --local ]; then
    LAI_SCRIPT="view-logs"
    LAI_SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
    # shellcheck source=scripts/aws/lib.sh
    . "$LAI_SCRIPTS_DIR/lib.sh"
    source=${2:-deploy}
    lines=200
    [ "${3:-}" = --lines ] && lines=${4:-200}
    [[ $lines =~ ^[0-9]{1,5}$ ]] || { echo "bad --lines" >&2; exit 2; }
    load_conf
    case "$source" in
        deploy) tail -n "$lines" "$LAI_LOG_DIR/deploy.log" ;;
        django | proxy)
            # The containers log to CloudWatch (awslogs driver); compose can still read them back.
            compose_for "$LAI_ROOT/current" logs --no-color --tail "$lines" "$source" ;;
        *) echo "unknown source $source" >&2; exit 2 ;;
    esac
    exit 0
fi

env_name=${1:-}
source=${2:-app}
since=30m
[ "${3:-}" = --since ] && since=${4:-30m}
case "$env_name" in dev | prod) ;; *) echo "usage: $0 <dev|prod> [app|proxy|deploy|ssm] [--since 30m]" >&2; exit 2 ;; esac
case "$source" in
    app) group=/lai/$env_name/django ;;
    proxy) group=/lai/$env_name/proxy ;;
    deploy) group=/lai/$env_name/deploy ;;
    ssm) group=/lai/$env_name/ssm ;;
    *) echo "unknown source $source" >&2; exit 2 ;;
esac
[[ $since =~ ^[0-9]+[smhdw]$ ]] || { echo "--since must look like 30m, 2h or 1d" >&2; exit 2; }
exec aws logs tail "$group" --since "$since" --format short --region "${AWS_REGION:-us-west-1}"
