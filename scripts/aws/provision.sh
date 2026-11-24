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
#   LAI_ADMIN_DOMAIN           required: the Django Admin host, e.g. ladm.example.com
#   LAI_SITE_DOMAIN            optional: the React site host, e.g. lai.example.com; deploys
#                              LaiFrontend-<env> in us-east-1 (CloudFront) when set or already deployed
#   LAI_COGNITO_USER_POOL_ID   required: the existing parent user pool (created by the retired Amplify backend; kept)
#   LAI_COGNITO_CLIENT_IDS     required: comma-separated app client ids
#   LAI_INSTANCE_TYPE          default t3.medium
#   LAI_ALARM_EMAIL            optional
#   LAI_GITHUB_REPOSITORY, LAI_DATABASE_MODE, LAI_CREATE_OIDC_PROVIDER, LAI_HOSTED_ZONE_ID,
#   LAI_HOSTED_ZONE_NAME, LAI_DB_MULTI_AZ   passed to the CDK app (infra/bin/app.ts)
#   LAI_CFN_TEMPLATE_BUCKET    bucket for templates over 51,200 bytes (CloudFormation's limit for
#                              an inline body); default lai-<env>-artifacts-<account>-<region>,
#                              which must exist (the first prod run names an existing private bucket)
#   LAI_PROVISION_TEMPLATES    use templates already synthesized in this directory (no synth)
#
# Production processing (ADR-071) is not an option here: infra/bin/app.ts reads it from the
# committed infra/config/prod-processing.json, so a run without any flag keeps the deployed
# processing resources (review F3).
#
# Order: LaiAssetStorage-<env> (the asset policy the instance role attaches), LaiChildPhotos-<env>
# (the private child photo bucket and the photo policy the instance role attaches, ADR-042),
# LaiDjangoRelease (account-wide, ECR and GitHub OIDC), LaiDjangoEc2-<env>, then LaiFrontend-<env>
# (us-east-1; its /api/* origin is the EC2 stack's API host, LAI-INFRA-003). Both storage stacks
# must exist before the EC2 stack, which attaches their policies by name. Without a Route 53 zone the EC2 stack
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
out=${LAI_PROVISION_TEMPLATES:-"$repo_root/infra/cdk.out"}
echo "account $account, region $AWS_REGION, environment $env_name, execute=$execute"

if [ -z "${LAI_PROVISION_TEMPLATES:-}" ]; then
    LAI_ENV=$env_name CDK_DEFAULT_ACCOUNT=$account CDK_DEFAULT_REGION=$AWS_REGION \
        npm --prefix "$repo_root" run --silent infra:synth
fi

# template_flags <stack> <region>: --template-file, plus --s3-bucket for a template over 51,200
# bytes (as deploy-debug.sh's --template-url: the CLI uploads the template to the bucket and
# CloudFormation reads it from there). Sets TEMPLATE_FLAGS.
TEMPLATE_FLAGS=()
template_flags() {
    local stack=$1 region=$2 template="$out/$1.template.json" bucket
    TEMPLATE_FLAGS=(--template-file "$template")
    if [ "$(wc -c <"$template")" -lt 51200 ]; then
        return 0
    fi
    bucket=${LAI_CFN_TEMPLATE_BUCKET:-lai-$env_name-artifacts-$account-$AWS_REGION}
    if ! aws s3api head-bucket --region "$region" --bucket "$bucket" >/dev/null 2>&1; then
        echo "$stack: template over 51,200 bytes and bucket $bucket is not reachable;" \
            "set LAI_CFN_TEMPLATE_BUCKET to an existing private bucket in $region" >&2
        exit 3
    fi
    TEMPLATE_FLAGS+=(--s3-bucket "$bucket" --s3-prefix tmp/cfn)
}

existing() { # existing() <stack> <parameter> [region]: the deployed value, or nothing
    aws cloudformation describe-stacks --region "${3:-$AWS_REGION}" --stack-name "$1" \
        --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue" --output text 2>/dev/null |
        grep -v '^None$' || true
}

deploy_stack() { # deploy_stack <stack> [Key=Value ...]; STACK_REGION overrides the region
    local stack=$1
    shift
    [ -z "$only" ] || [ "$only" = "$stack" ] || return 0
    template_flags "$stack" "${STACK_REGION:-$AWS_REGION}"
    local flags=(--region "${STACK_REGION:-$AWS_REGION}" --stack-name "$stack"
        "${TEMPLATE_FLAGS[@]}"
        --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset
        --tags Project=learning-adventure-island)
    [ "$#" -eq 0 ] || flags+=(--parameter-overrides "$@")
    [ "$execute" = true ] || flags+=(--no-execute-changeset)
    echo "== $stack"
    aws cloudformation deploy "${flags[@]}"
}

deploy_stack "LaiAssetStorage-$env_name"
deploy_stack "LaiChildPhotos-$env_name"
deploy_stack LaiDjangoRelease

ec2_stack="LaiDjangoEc2-$env_name"
api_domain=${LAI_API_DOMAIN:-$(existing "$ec2_stack" ApiDomainName)}
admin_domain=${LAI_ADMIN_DOMAIN:-$(existing "$ec2_stack" AdminDomainName)}
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
for required in api_domain admin_domain pool clients ami; do
    [ -n "${!required}" ] || { echo "missing $required (see the header of $0)" >&2; exit 2; }
done
deploy_stack "$ec2_stack" \
    "ApiDomainName=$api_domain" "AdminDomainName=$admin_domain" "AmiId=$ami" \
    "InstanceType=$instance_type" \
    "CognitoUserPoolId=$pool" "CognitoAllowedClientIds=$clients" \
    "AlarmEmail=$alarm_email"

# The React site. Optional until the owner deploys the S3/CloudFront site (INFRA-002 D2; Amplify
# Hosting is retired, AMP-06).
site_stack="LaiFrontend-$env_name"
site_domain=${LAI_SITE_DOMAIN:-$(existing "$site_stack" SiteDomainName us-east-1)}
if [ -n "$site_domain" ]; then
    STACK_REGION=us-east-1 deploy_stack "$site_stack" \
        "SiteDomainName=$site_domain" "ApiDomainName=$api_domain"
elif [ -z "$only" ] || [ "$only" = "$site_stack" ]; then
    echo "== $site_stack skipped (set LAI_SITE_DOMAIN to create it)"
fi

if [ "$execute" != true ]; then
    echo "Change sets created, nothing applied. Review them in the CloudFormation console, then rerun with --execute."
fi
