#!/usr/bin/env bash
# Read-only acceptance checks for a Django EC2 environment (LAI-1002/1004,
# docs/infrastructure/dev-acceptance.md). Run by the owner after `provision.sh <env> --execute`
# and the first release; paste the output into the acceptance record.
#
#   scripts/aws/verify-dev.sh [dev|prod]
#
# READ-ONLY. It calls only AWS describe/get/list/head operations (tests/deploy/test_verify_dev.py
# enforces this) and HTTPS GETs, never decrypts a SecureString, and prints parameter names, not
# values, except the non-secret ones it needs (host names, pool id, bucket names). The one write
# is opt-in: with LAI_TEST_ACCESS_TOKEN set it calls POST /api/v1/me/, which creates that parent's
# Django account the first time, exactly as the app does after sign-in.
#
# Environment (all optional):
#   AWS_REGION            default us-west-1
#   LAI_TEST_ACCESS_TOKEN     a Cognito access token for a test parent (Django accepts access tokens only): adds the signed-in API checks
#   LAI_TEST_CHILD_ID     a child profile id of that parent: adds a progress read
#   LAI_SITE_DOMAIN       the React site host: adds the CloudFront checks (LaiFrontend, us-east-1)
#
# Output: one line per check, PASS / FAIL / WARN / SKIP, then a summary. Exit 1 if anything failed.
set -Euo pipefail

env_name=${1:-dev}
case "$env_name" in dev | prod) ;; *) echo "usage: $0 [dev|prod]" >&2; exit 2 ;; esac
export AWS_REGION=${AWS_REGION:-us-west-1}
SITE_REGION=us-east-1
COMPLETE='CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE'
passed=0 failed=0 warned=0 skipped=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass() { passed=$((passed + 1)); echo "PASS  $*"; }
fail() { failed=$((failed + 1)); echo "FAIL  $*"; }
warn() { warned=$((warned + 1)); echo "WARN  $*"; }
skip() { skipped=$((skipped + 1)); echo "SKIP  $*"; }

q() { # q <aws args...>: text output, empty on error or "None"
    local out
    out=$(aws "$@" --output text 2>/dev/null) || return 0
    [ "$out" = None ] || printf '%s' "$out"
}

stack_status() { q cloudformation describe-stacks --region "${2:-$AWS_REGION}" --stack-name "$1" --query 'Stacks[0].StackStatus'; }
stack_output() { q cloudformation describe-stacks --region "${3:-$AWS_REGION}" --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue"; }
stack_param() { q cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue"; }
stack_resources() { q cloudformation list-stack-resources --stack-name "$1" --query "StackResourceSummaries[?ResourceType=='$2'].PhysicalResourceId"; }
param_value() { q ssm get-parameter --name "$1" --query Parameter.Value; } # String parameters only

http() { # http <method> <url> [curl args...]: prints "<status> <redirect>", body in $tmp/body
    local method=$1 url=$2
    shift 2
    curl -s -X "$method" -o "$tmp/body" -w '%{http_code} %{redirect_url}' --max-time 20 "$@" "$url" 2>/dev/null ||
        echo "000 "
}

is_complete() { [ -n "$1" ] && [[ " $COMPLETE " == *" $1 "* ]]; }

echo "== Learning Adventure Island $env_name acceptance, region $AWS_REGION, $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- 1. Identity --------------------------------------------------------------------------------
account=$(q sts get-caller-identity --query Account)
caller=$(q sts get-caller-identity --query Arn)
if [ -z "$account" ]; then
    fail "AWS credentials: sts get-caller-identity failed (sign in first); nothing else can be checked"
    echo "== 0 passed, 1 failed"
    exit 1
fi
pass "identity: account $account as $caller"

# --- 2. Stacks ----------------------------------------------------------------------------------
ec2_stack="LaiDjangoEc2-$env_name"
for stack in "LaiAssetStorage-$env_name" "LaiChildPhotos-$env_name" LaiDjangoRelease "$ec2_stack"; do
    status=$(stack_status "$stack")
    if is_complete "$status"; then pass "stack $stack: $status"; else fail "stack $stack: ${status:-missing}"; fi
done
guardrail=$(stack_status "LaiAiGuardrail-$env_name")
guardrail_only=$(stack_status "LaiAiGuardrailOnly-$env_name")
if is_complete "$guardrail" && [ -z "$guardrail_only" ]; then
    pass "stack LaiAiGuardrail-$env_name: $guardrail"
elif [ -n "$guardrail_only" ]; then
    warn "stack LaiAiGuardrailOnly-$env_name still exists ($guardrail_only): retire it before LaiAiGuardrail-$env_name (reconciliation C2)"
else
    warn "stack LaiAiGuardrail-$env_name: ${guardrail:-not deployed yet} (deployed after the EC2 stack, docs/AI_SERVICE.md)"
fi

# Nothing below works without the EC2 stack.
if ! is_complete "$(stack_status "$ec2_stack")"; then
    echo "== $passed passed, $failed failed, $warned warnings, $skipped skipped (stopped: no $ec2_stack)"
    exit 1
fi
api_host=$(stack_param "$ec2_stack" ApiDomainName)
admin_host=$(stack_param "$ec2_stack" AdminDomainName)

# --- 3. EC2, SSM agent, load balancer -----------------------------------------------------------
instance=$(stack_output "$ec2_stack" InstanceId)
read -r state tokens <<<"$(q ec2 describe-instances --instance-ids "$instance" \
    --query 'Reservations[0].Instances[0].[State.Name,MetadataOptions.HttpTokens]')"
if [ "${state:-}" = running ] && [ "${tokens:-}" = required ]; then
    pass "instance $instance: running, IMDSv2 required"
else
    fail "instance ${instance:-?}: state ${state:-unknown}, IMDS tokens ${tokens:-unknown}"
fi
ping=$(q ssm describe-instance-information --filters "Key=InstanceIds,Values=$instance" \
    --query 'InstanceInformationList[0].PingStatus')
if [ "$ping" = Online ]; then pass "SSM agent on $instance: Online"; else fail "SSM agent on ${instance:-?}: ${ping:-not registered}"; fi

target_group=$(stack_resources "$ec2_stack" AWS::ElasticLoadBalancingV2::TargetGroup)
health=$(q elbv2 describe-target-health --target-group-arn "$target_group" \
    --query 'TargetHealthDescriptions[].TargetHealth.State')
if [ -n "$health" ] && [ -z "$(tr '\t ' '\n\n' <<<"$health" | grep -v '^healthy$' | grep -v '^$')" ]; then
    pass "load balancer targets: $health"
else
    fail "load balancer targets: ${health:-none registered}"
fi
load_balancer=$(stack_resources "$ec2_stack" AWS::ElasticLoadBalancingV2::LoadBalancer)
default_action=$(q elbv2 describe-listeners --load-balancer-arn "$load_balancer" \
    --query "Listeners[?Port==\`443\`].DefaultActions[0].Type")
if [ "$default_action" = fixed-response ]; then
    pass "HTTPS listener: unknown hosts get the ALB's own 404"
else
    fail "HTTPS listener default action: ${default_action:-missing} (expected fixed-response)"
fi

# --- 4. Database --------------------------------------------------------------------------------
endpoint=$(stack_output "$ec2_stack" DatabaseEndpoint)
if [ -z "$endpoint" ]; then
    skip "RDS: no DatabaseEndpoint output (container database mode)"
else
    read -r db_status multi_az public encrypted protected version <<<"$(q rds describe-db-instances \
        --db-instance-identifier "lai-django-$env_name" --query \
        'DBInstances[0].[DBInstanceStatus,MultiAZ,PubliclyAccessible,StorageEncrypted,DeletionProtection,EngineVersion]')"
    want_multi_az=False
    [ "$env_name" = prod ] && want_multi_az=${multi_az:-False}
    if [ "${db_status:-}" = available ] && [ "${public:-}" = False ] && [ "${encrypted:-}" = True ] &&
        [ "${protected:-}" = True ] && [ "${multi_az:-}" = "$want_multi_az" ]; then
        pass "RDS lai-django-$env_name: available, PostgreSQL ${version:-?}, private, encrypted, deletion protected, Multi-AZ $multi_az"
    else
        fail "RDS lai-django-$env_name: status ${db_status:-missing}, public ${public:-?}, encrypted ${encrypted:-?}, deletion protection ${protected:-?}, Multi-AZ ${multi_az:-?}"
    fi
fi

# --- 5. Runtime settings (names only) -----------------------------------------------------------
prefix=/lai/$env_name/django
names=$(q ssm get-parameters-by-path --path "$prefix" --query 'Parameters[].Name')
missing=()
for name in DJANGO_ALLOWED_HOSTS DJANGO_CSRF_TRUSTED_ORIGINS COGNITO_REGION COGNITO_USER_POOL_ID \
    COGNITO_ALLOWED_CLIENT_IDS LAI_ASSET_STORAGE LAI_ASSET_BUCKET LAI_ASSET_REGION \
    LAI_CHILD_PHOTO_STORAGE LAI_CHILD_PHOTOS_BUCKET LAI_CHILD_PHOTOS_REGION DJANGO_SECRET_KEY; do
    [[ $'\t'"$names"$'\t' == *$'\t'"$prefix/$name"$'\t'* ]] || missing+=("$name")
done
if [ "${#missing[@]}" -eq 0 ]; then
    pass "SSM $prefix: all 12 required settings present (DJANGO_SECRET_KEY is operator-written)"
else
    fail "SSM $prefix: missing ${missing[*]}"
fi
release=$(param_value "/lai/$env_name/deploy/last-release")
if [ -n "$release" ]; then pass "last release record: $release"; else warn "no release recorded yet (/lai/$env_name/deploy/last-release)"; fi

# --- 6. Buckets ---------------------------------------------------------------------------------
for setting in LAI_ASSET_BUCKET LAI_CHILD_PHOTOS_BUCKET; do
    bucket=$(param_value "$prefix/$setting")
    if [ -z "$bucket" ] || ! aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
        fail "bucket ${bucket:-($setting unset)}: not reachable"
        continue
    fi
    blocks=$(q s3api get-public-access-block --bucket "$bucket" --query \
        'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]')
    versioning=$(q s3api get-bucket-versioning --bucket "$bucket" --query Status)
    encryption=$(q s3api get-bucket-encryption --bucket "$bucket" \
        --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm')
    if [ "$(tr -s '\t ' ' ' <<<"$blocks")" = "True True True True" ] && [ "$versioning" = Enabled ] && [ -n "$encryption" ]; then
        pass "bucket $bucket: private, versioned, $encryption"
    else
        fail "bucket $bucket: public access block '${blocks:-none}', versioning ${versioning:-off}, encryption ${encryption:-none}"
    fi
done
asset_bucket=$(param_value "$prefix/LAI_ASSET_BUCKET")
photo_bucket=$(param_value "$prefix/LAI_CHILD_PHOTOS_BUCKET")
if [ -n "$asset_bucket" ] && [ "$asset_bucket" = "$photo_bucket" ]; then
    fail "the asset and child photo buckets are the same bucket (ADR-042 requires two)"
fi

# --- 7. Cognito ---------------------------------------------------------------------------------
pool=$(param_value "$prefix/COGNITO_USER_POOL_ID")
pool_region=${pool%%_*}
if [ -n "$pool" ] && [ "$(q cognito-idp describe-user-pool --region "$pool_region" --user-pool-id "$pool" --query UserPool.Id)" = "$pool" ]; then
    pass "Cognito pool $pool exists"
else
    fail "Cognito pool ${pool:-(COGNITO_USER_POOL_ID unset)}: not found"
fi
read -r code _ <<<"$(http GET "https://cognito-idp.$pool_region.amazonaws.com/$pool/.well-known/jwks.json")"
if [ "$code" = 200 ]; then pass "Cognito JWKS reachable"; else fail "Cognito JWKS: HTTP $code"; fi

# --- 8. Hosts and isolation over HTTPS (LAI-INFRA-003) ------------------------------------------
check_http() { # check_http <label> <method> <url> <want status> [want redirect]
    local label=$1 method=$2 url=$3 want=$4 want_location=${5:-} code location
    read -r code location <<<"$(http "$method" "$url")"
    if [ "$code" = "$want" ] && { [ -z "$want_location" ] || [[ $location == *"$want_location" ]]; }; then
        pass "$label: $method $url -> $code${location:+ $location}"
    else
        fail "$label: $method $url -> $code${location:+ $location} (expected $want${want_location:+ to $want_location})"
    fi
}
check_http "API ready" GET "https://$api_host/api/v1/health/ready/" 200
check_http "API host hides the admin" GET "https://$api_host/admin/" 404
check_http "admin host root" GET "https://$admin_host/" 302 /admin/
check_http "admin sign-in page" GET "https://$admin_host/admin/login/" 200
check_http "admin host hides the API" GET "https://$admin_host/api/v1/health/" 404

# --- 9. Signed-in Django, Cognito and progress (optional) ---------------------------------------
if [ -n "${LAI_TEST_ACCESS_TOKEN:-}" ]; then
    auth=(-H "Authorization: Bearer $LAI_TEST_ACCESS_TOKEN")
    read -r code _ <<<"$(http POST "https://$api_host/api/v1/me/" "${auth[@]}")"
    if [ "$code" = 200 ] || [ "$code" = 201 ]; then pass "signed in: POST /api/v1/me/ -> $code"; else fail "signed in: POST /api/v1/me/ -> $code"; fi
    read -r code _ <<<"$(http GET "https://$api_host/api/v1/children/" "${auth[@]}")"
    if [ "$code" = 200 ]; then pass "signed in: GET /api/v1/children/ -> 200"; else fail "signed in: GET /api/v1/children/ -> $code"; fi
    if [ -n "${LAI_TEST_CHILD_ID:-}" ]; then
        read -r code _ <<<"$(http GET "https://$api_host/api/v1/children/$LAI_TEST_CHILD_ID/home/" "${auth[@]}")"
        if [ "$code" = 200 ]; then pass "progress: GET child home -> 200"; else fail "progress: GET child home -> $code"; fi
    else
        skip "progress read (set LAI_TEST_CHILD_ID)"
    fi
else
    skip "signed-in API, Cognito token and progress checks (set LAI_TEST_ACCESS_TOKEN)"
fi

# --- 10. React site on CloudFront (optional, LAI-INFRA-003/004) ---------------------------------
site_stack="LaiFrontend-$env_name"
site_status=$(stack_status "$site_stack" "$SITE_REGION")
if [ -z "${LAI_SITE_DOMAIN:-}" ] && [ -z "$site_status" ]; then
    skip "React site on CloudFront ($site_stack not deployed; Amplify Hosting still serves the app)"
else
    if is_complete "$site_status"; then pass "stack $site_stack ($SITE_REGION): $site_status"; else fail "stack $site_stack ($SITE_REGION): ${site_status:-missing}"; fi
    site=${LAI_SITE_DOMAIN:-$(stack_output "$site_stack" SiteUrl "$SITE_REGION" | sed 's|^https://||')}
    read -r code _ <<<"$(http GET "https://$site/")"
    if [ "$code" = 200 ] && grep -q 'id="root"' "$tmp/body"; then pass "site shell: https://$site/"; else fail "site shell: https://$site/ -> $code"; fi
    check_http "site /api/ through CloudFront" GET "https://$site/api/v1/health/" 200
fi

echo "== $passed passed, $failed failed, $warned warnings, $skipped skipped"
[ "$failed" -eq 0 ]
