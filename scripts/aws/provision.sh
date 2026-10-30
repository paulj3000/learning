#!/usr/bin/env bash
# Provision or update the Django EC2 environment's AWS stacks (ADR-037). OWNER APPROVAL REQUIRED:
# this changes AWS. By default it only creates CloudFormation change sets to review; pass
# --execute to apply them. See docs/platform/DJANGO_EC2_DEPLOYMENT.md, "Provisioning".
#
#   scripts/aws/provision.sh <dev|prod> [--execute] [--refresh-ami] [--only <stack>]
#
# Environment (the first run needs all of the required ones; later runs reuse the stack's values
# for anything unset):
#   AWS_REGION                 default us-west-1
#   LAI_API_DOMAIN             required: the API host, e.g. api.example.com
#   LAI_COGNITO_USER_POOL_ID   required: the existing Amplify user pool
#   LAI_COGNITO_CLIENT_IDS     required: comma-separated app client ids
#   LAI_INSTANCE_TYPE          default t3.medium
#   LAI_ALARM_EMAIL            optional
#   LAI_GITHUB_REPOSITORY, LAI_DATABASE_MODE, LAI_CREATE_OIDC_PROVIDER, LAI_HOSTED_ZONE_ID,
#   LAI_HOSTED_ZONE_NAME, LAI_DB_MULTI_AZ   passed to the CDK app (infra/bin/app.ts)
#
# Order: LaiAssetStorage-<env> (the asset policy the instance role attaches), LaiDjangoRelease
# (account-wide, ECR and GitHub OIDC), LaiDjangoEc2-<env>. Without a Route 53 zone the EC2 stack
# waits while ACM validates the certificate: add the CNAME ACM shows (console, Certificate Manager).
set -Eeuo pipefail

env_name=${1:-}
shift || true
case "$env_name" in dev | prod) ;; *) sed -n '6p' "$0" >&2; exit 2 ;; esac
execute=false refresh_ami=false only=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --execute) execute=true; shift ;;
        --refresh-ami) refresh_ami=true; shift ;;
        --only) only=${2:-}; shift 2 ;;
        *) sed -n '6p' "$0" >&2; exit 2 ;;
    esac
done

export AWS_REGION=${AWS_REGION:-us-west-1}
account=$(aws sts get-caller-identity --query Account --output text)
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
out="$repo_root/infra/cdk.out"
echo "account $account, region $AWS_REGION, environment $env_name, execute=$execute"

LAI_ENV=$env_name CDK_DEFAULT_ACCOUNT=$account CDK_DEFAULT_REGION=$AWS_REGION \
    npm --prefix "$repo_root" run --silent infra:synth

existing() { # existing() <stack> <parameter>: the deployed value, or nothing
    aws cloudformation describe-stacks --stack-name "$1" \
        --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue" --output text 2>/dev/null |
        grep -v '^None$' || true
}

deploy_stack() { # deploy_stack <stack> [Key=Value ...]
    local stack=$1
    shift
    [ -z "$only" ] || [ "$only" = "$stack" ] || return 0
    local flags=(--stack-name "$stack" --template-file "$out/$stack.template.json"
        --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
        --tags Project=learning-adventure-island)
    [ "$#" -eq 0 ] || flags+=(--parameter-overrides "$@")
    [ "$execute" = true ] || flags+=(--no-execute-changeset)
    echo "== $stack"
    aws cloudformation deploy "${flags[@]}"
}

deploy_stack "LaiAssetStorage-$env_name"
deploy_stack LaiDjangoRelease

ec2_stack="LaiDjangoEc2-$env_name"
api_domain=${LAI_API_DOMAIN:-$(existing "$ec2_stack" ApiDomainName)}
pool=${LAI_COGNITO_USER_POOL_ID:-$(existing "$ec2_stack" CognitoUserPoolId)}
clients=${LAI_COGNITO_CLIENT_IDS:-$(existing "$ec2_stack" CognitoAllowedClientIds)}
ami=$(existing "$ec2_stack" AmiId)
if [ -z "$ami" ] || [ "$refresh_ami" = true ]; then
    # Replaces the instance when it changes: only with --refresh-ami on an existing stack.
    ami=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
        --query Parameter.Value --output text)
fi
instance_type=${LAI_INSTANCE_TYPE:-$(existing "$ec2_stack" InstanceType)}
instance_type=${instance_type:-t3.medium}
alarm_email=${LAI_ALARM_EMAIL:-$(existing "$ec2_stack" AlarmEmail)}
for required in api_domain pool clients ami; do
    [ -n "${!required}" ] || { echo "missing $required (see the header of $0)" >&2; exit 2; }
done
deploy_stack "$ec2_stack" \
    "ApiDomainName=$api_domain" "AmiId=$ami" \
    "InstanceType=$instance_type" \
    "CognitoUserPoolId=$pool" "CognitoAllowedClientIds=$clients" \
    "AlarmEmail=$alarm_email"

if [ "$execute" != true ]; then
    echo "Change sets created, nothing applied. Review them in the CloudFormation console, then rerun with --execute."
fi
