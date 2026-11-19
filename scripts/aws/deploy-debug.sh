#!/usr/bin/env bash
# Provision or update the native DEV environment's stacks (bootstrapless CloudFormation, no CDK
# deploy). OWNER APPROVAL REQUIRED for --execute: it changes AWS. --plan only creates and
# describes CloudFormation change sets for review; nothing is applied.
#
#   deploy-debug.sh --plan    [--refresh-ami] [--only STACK] [--profile P] [--region R]
#   deploy-debug.sh --execute [--refresh-ami] [--only STACK] [--profile P] [--region R]
#   deploy-debug.sh --status | --outputs
#
# Stacks, in order: LaiDevArtifacts-dev, LaiAssetStorage-dev, LaiChildPhotos-dev,
# LaiDevPlatform-dev (all us-west-1), LaiAiGuardrail-dev (the Bedrock Region, LAI_DEV_BEDROCK_REGION,
# default us-west-1; it attaches its IAM policy to the platform's instance role and, in the dev
# Region, also owns the AI log alarms, which the platform stack owns instead when Bedrock runs in
# another Region), LaiFrontend-dev (us-east-1). --execute refuses to update LaiDevPlatform-dev while the environment is stopped
# (CloudFormation cannot modify a stopped RDS instance): run manage-dev.sh start first.
#
# Steps: 1 credentials; 2 account (LAI_DEV_ACCOUNT_ID; required for --execute); 3 environment
# guard; 4 conflicting stacks (an existing LaiDjangoEc2-dev is never touched: refused unless
# LAI_ALLOW_LEGACY_DEV_STACK=true); 5 Cognito pool and clients (describe when permitted, else a
# format check); 6 Route 53 zone (without one: OpenHttpPort=true and the DNS records to create by
# hand are printed); 7 ARM64 AL2023 AMI (pinned: the deployed AmiId is reused unless
# --refresh-ami, which REPLACES the instance), the CloudFront origin-facing prefix list, and
# whether GitHub's OIDC provider exists; 8 `npm run infra:synth`; 9 package the Lambda workers
# (scripts/aws/package-lambda.sh); 10 validate each template; 11 print all parameters;
# 12 create and describe one change set per stack; 13 --execute only: upload the Lambda package,
# execute the change sets in order and wait; 14-15 frontend ACM validation (automatic with a
# Route 53 zone, otherwise the CNAME is printed while CloudFormation waits); 16 outputs;
# 17 the next command.
#
# First run (two phases): the Lambda package and any template over 51,200 bytes (the platform
# template embeds the instance setup) need the artifacts bucket, which LaiDevArtifacts-dev
# creates. The Lambda key is content addressed (lambda/jobs-worker-<hash16>.zip, computed locally
# at plan time), so the platform parameters are final before the upload. While the bucket does
# not exist yet, --plan creates the change sets it can and reports the others as deferred.
# Recommended first sequence:
#   deploy-debug.sh --plan                              # review phase 1
#   deploy-debug.sh --execute --only LaiDevArtifacts-dev
#   deploy-debug.sh --plan                              # now every change set, review
#   deploy-debug.sh --execute
# Plain --execute on a fresh account also works: it applies the stacks in order, uploading the
# Lambda package as soon as the bucket exists and before LaiDevPlatform-dev's change set is made.
# --execute always makes fresh change sets (the --plan ones are left for the record) and refuses
# one that would replace or remove the RDS instance unless LAI_ALLOW_DB_REPLACEMENT=true.
#
# Settings (environment or .lai-dev.env, see scripts/aws/dev.env.example). An unset setting
# reuses the deployed stack's value, then the default. Set-but-empty means empty.
#   LAI_DEV_ACCOUNT_ID, LAI_SITE_DOMAIN, LAI_API_DOMAIN, LAI_ADMIN_DOMAIN, LAI_HOSTED_ZONE_ID,
#   LAI_HOSTED_ZONE_NAME, LAI_COGNITO_USER_POOL_ID, LAI_COGNITO_CLIENT_IDS, LAI_ADMIN_ALLOWED_CIDR,
#   LAI_CERT_EMAIL, LAI_ALARM_EMAIL, LAI_MONTHLY_BUDGET_USD, LAI_INSTANCE_TYPE, LAI_EC2_VOLUME_SIZE,
#   LAI_DB_INSTANCE_CLASS, LAI_DB_STORAGE, LAI_DB_BACKUP_RETENTION, LAI_DB_DELETION_PROTECTION,
#   LAI_ENABLE_SCHEDULE, LAI_SHUTDOWN_TIME, LAI_AVAILABLE_BY, LAI_STARTUP_WARMUP_MINUTES,
#   LAI_SCHEDULE_TIMEZONE, LAI_ENABLE_LAMBDA, LAI_LAMBDA_MEMORY, LAI_LAMBDA_CONCURRENCY,
#   LAI_GITHUB_REPOSITORY, LAI_RELEASE_RETENTION_DAYS, LAI_CREATE_OIDC_PROVIDER
#
# Exit codes: 0 done (plan made, or stacks applied); 1 a stack operation or synth failed;
# 2 usage or invalid setting; 3 AWS failure; 4 refused by the dev guard (environment, prod name,
# account); 5 conflict (legacy stack, a stack busy or in ROLLBACK_COMPLETE, DB replacement);
# 6 timed out waiting for a stack; 7 --execute while the environment is stopped; 8 a required
# setting or prerequisite is missing.
set -Eeuo pipefail
# shellcheck source=scripts/aws/lib-dev.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-dev.sh"

usage() {
    sed -n '6,8p' "$0" >&2
    exit "$EX_USAGE"
}

mode="" refresh_ami=false only=""
while [ "$#" -gt 0 ]; do
    consumed=0
    dev_common_flag "$@" || consumed=$?
    if [ "$consumed" -gt 0 ]; then shift "$consumed"; continue; fi
    case "$1" in
        --plan | --execute | --status | --outputs) [ -z "$mode" ] || usage; mode=${1#--}; shift ;;
        --refresh-ami) refresh_ami=true; shift ;;
        --only) only=${2:-}; shift 2 || usage ;;
        *) err "unknown argument $1"; usage ;;
    esac
done
[ -n "$mode" ] || usage

STACKS=("$DEV_ARTIFACTS_STACK" LaiAssetStorage-dev LaiChildPhotos-dev "$DEV_PLATFORM_STACK"
    LaiAiGuardrail-dev "$DEV_FRONTEND_STACK")
stack_region() {
    case "$1" in
        "$DEV_FRONTEND_STACK") echo "$DEV_FRONTEND_REGION" ;;
        LaiAiGuardrail-dev) echo "$DEV_BEDROCK_REGION" ;;
        *) echo "$DEV_REGION" ;;
    esac
}
if [ -n "$only" ]; then
    dev_guard_name "$only"
    [[ " ${STACKS[*]} " == *" $only "* ]] || die "$EX_USAGE" "--only must be one of: ${STACKS[*]}"
fi
selected() { [ -z "$only" ] || [ "$only" = "$1" ]; }

# --- steps 1-3: credentials, account, environment ----------------------------------------------
dev_init
step "1-3. credentials, account and environment"
if [ "$mode" = execute ]; then dev_guard_account required; else dev_guard_account; fi
info "account $DEV_ACCOUNT as $DEV_CALLER, region $DEV_REGION (frontend $DEV_FRONTEND_REGION, Bedrock $DEV_BEDROCK_REGION), environment dev, mode $mode"
for stack in "${STACKS[@]}"; do dev_guard_stack "$stack" "$(stack_region "$stack")"; done

if [ "$mode" = status ]; then
    printf '%-24s %-10s %-28s %s\n' STACK REGION STATUS "LAST UPDATED"
    for stack in "${STACKS[@]}" "$DEV_LEGACY_STACK"; do
        region=$(stack_region "$stack")
        json=$(dev_stack_json "$stack" "$region")
        printf '%-24s %-10s %-28s %s\n' "$stack" "$region" \
            "$(jq -r '.StackStatus // "not deployed"' <<<"$json")" \
            "$(jq -r '.LastUpdatedTime // .CreationTime // "-"' <<<"$json")"
    done
    exit 0
fi
if [ "$mode" = outputs ]; then
    for stack in "${STACKS[@]}"; do
        region=$(stack_region "$stack")
        echo "== $stack ($region)"
        dev_stack_json "$stack" "$region" | jq -r '(.Outputs // [])[] | "  \(.OutputKey) = \(.OutputValue)"'
    done
    exit 0
fi

# A stopped environment cannot be updated: CloudFormation fails on a stopped RDS instance.
if [ "$mode" = execute ] && selected "$DEV_PLATFORM_STACK" && dev_stack_exists "$DEV_PLATFORM_STACK"; then
    db=$(dev_out DatabaseIdentifier)
    rds_state=$(dev_rds_state "${db:-lai-dev}")
    ec2_state=$(dev_ec2_state "$(dev_out InstanceId)")
    if [ "$rds_state" != available ] || [ "$ec2_state" != running ]; then
        die "$EX_NOT_RUNNING" "the environment is not running (EC2 $ec2_state, RDS $rds_state); run scripts/aws/manage-dev.sh start before updating $DEV_PLATFORM_STACK"
    fi
fi

# --- step 4: conflicting stacks -----------------------------------------------------------------
step "4. conflicting stacks"
if dev_stack_exists "$DEV_LEGACY_STACK"; then
    if [ "${LAI_ALLOW_LEGACY_DEV_STACK:-}" = true ]; then
        warn "$DEV_LEGACY_STACK ($(dev_stack_status "$DEV_LEGACY_STACK")) exists and is left untouched (LAI_ALLOW_LEGACY_DEV_STACK=true). It keeps costing money and uses the same host names; retire it deliberately, never from this script."
    else
        die "$EX_CONFLICT" "$DEV_LEGACY_STACK ($(dev_stack_status "$DEV_LEGACY_STACK")) is deployed: the native platform replaces it and uses the same API and admin host names. This script never deletes it. Retire it with the owner's approval, or set LAI_ALLOW_LEGACY_DEV_STACK=true to proceed alongside it."
    fi
else
    info "no $DEV_LEGACY_STACK"
fi

# --- settings -----------------------------------------------------------------------------------
# setting <VAR> <stack> <ParameterKey> <default>: env/config value if set (even empty), else the
# deployed value, else the default.
setting() {
    local var=$1 stack=$2 key=$3 default=$4 deployed
    if [[ -v $var ]]; then printf '%s' "${!var}"; return 0; fi
    if deployed=$(stack_param "$stack" "$key" "$(stack_region "$stack")" 2>/dev/null); then
        printf '%s' "$deployed"
        return 0
    fi
    printf '%s' "$default"
}
P=$DEV_PLATFORM_STACK
site_domain=$(setting LAI_SITE_DOMAIN "$P" SiteDomainName lai.pauldimitriu.com)
api_domain=$(setting LAI_API_DOMAIN "$P" ApiDomainName api.pauldimitriu.com)
admin_domain=$(setting LAI_ADMIN_DOMAIN "$P" AdminDomainName ladm.pauldimitriu.com)
zone_id=$(setting LAI_HOSTED_ZONE_ID "$P" HostedZoneId "")
zone_name=$(setting LAI_HOSTED_ZONE_NAME "$P" HostedZoneName "")
pool=$(setting LAI_COGNITO_USER_POOL_ID "$P" CognitoUserPoolId "")
clients=$(setting LAI_COGNITO_CLIENT_IDS "$P" CognitoClientId "")
admin_cidr=$(setting LAI_ADMIN_ALLOWED_CIDR "$P" AdminAllowedCidr "")
cert_email=$(setting LAI_CERT_EMAIL "$P" CertificateEmail "")
alarm_email=$(setting LAI_ALARM_EMAIL "$P" AlarmEmail "")
budget=$(setting LAI_MONTHLY_BUDGET_USD "$P" MonthlyBudgetUsd 40)
instance_type=$(setting LAI_INSTANCE_TYPE "$P" InstanceType t4g.small)
volume=$(setting LAI_EC2_VOLUME_SIZE "$P" EC2VolumeSize 15)
db_class=$(setting LAI_DB_INSTANCE_CLASS "$P" DatabaseInstanceClass db.t4g.micro)
db_storage=$(setting LAI_DB_STORAGE "$P" DatabaseStorageSize 20)
db_backup=$(setting LAI_DB_BACKUP_RETENTION "$P" DatabaseBackupRetention 3)
db_protect=$(setting LAI_DB_DELETION_PROTECTION "$P" DatabaseDeletionProtection true)
schedule=$(setting LAI_ENABLE_SCHEDULE "$P" EnableScheduledShutdown true)
# The stack takes each schedule time as unpadded hour and minute parameters (ShutdownHour, ...;
# cron fields without a leading zero); the settings and this script work in HH:MM.
# deployed_time <HourKey> <MinuteKey>: the deployed value as HH:MM; exit 1 when absent.
deployed_time() {
    local h m
    h=$(stack_param "$P" "$1" "$(stack_region "$P")" 2>/dev/null) || return 1
    m=$(stack_param "$P" "$2" "$(stack_region "$P")" 2>/dev/null) || return 1
    [[ $h =~ ^[0-9]{1,2}$ && $m =~ ^[0-9]{1,2}$ ]] || return 1
    printf '%02d:%02d' "$((10#$h))" "$((10#$m))"
}
if [[ -v LAI_SHUTDOWN_TIME ]]; then
    shutdown_time=$LAI_SHUTDOWN_TIME
else
    shutdown_time=$(deployed_time ShutdownHour ShutdownMinute || echo 00:00)
fi
warmup=$(setting LAI_STARTUP_WARMUP_MINUTES "$P" StartupWarmupMinutes 25)
timezone=$(setting LAI_SCHEDULE_TIMEZONE "$P" ScheduleTimezone America/Los_Angeles)
lambda=$(setting LAI_ENABLE_LAMBDA "$P" EnableLambdaProcessing true)
lambda_memory=$(setting LAI_LAMBDA_MEMORY "$P" LambdaMemorySize 512)
lambda_concurrency=$(setting LAI_LAMBDA_CONCURRENCY "$P" LambdaConcurrencyLimit 2)
repository=$(setting LAI_GITHUB_REPOSITORY "$P" GitHubRepository paulj3000/learning)
retention=$(setting LAI_RELEASE_RETENTION_DAYS "$DEV_ARTIFACTS_STACK" ReleaseRetentionDays 45)
# StartupTime is when startup BEGINS: available-by minus the warm-up.
if [[ -v LAI_AVAILABLE_BY ]] || [[ -v LAI_STARTUP_WARMUP_MINUTES ]] || ! deployed_time StartupHour StartupMinute >/dev/null; then
    available=${LAI_AVAILABLE_BY:-08:00}
    minutes=$(dev_hhmm_to_minutes "$available") || die "$EX_USAGE" "LAI_AVAILABLE_BY must be HH:MM"
    [[ $warmup =~ ^[0-9]{1,3}$ ]] || die "$EX_USAGE" "LAI_STARTUP_WARMUP_MINUTES must be minutes"
    startup_time=$(dev_minutes_to_hhmm $(((minutes - warmup + 1440) % 1440)))
else
    startup_time=$(deployed_time StartupHour StartupMinute)
fi

host_re='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
for pair in "LAI_SITE_DOMAIN:$site_domain" "LAI_API_DOMAIN:$api_domain" "LAI_ADMIN_DOMAIN:$admin_domain"; do
    [[ ${pair#*:} =~ $host_re ]] || die "$EX_USAGE" "${pair%%:*} '${pair#*:}' is not a host name"
    dev_guard_name "${pair#*:}"
done
for pair in "LAI_SHUTDOWN_TIME:$shutdown_time" "StartupTime:$startup_time"; do
    dev_hhmm_to_minutes "${pair#*:}" >/dev/null || die "$EX_USAGE" "${pair%%:*} must be HH:MM, got '${pair#*:}'"
done
[[ -z $admin_cidr || $admin_cidr =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]] ||
    die "$EX_USAGE" "LAI_ADMIN_ALLOWED_CIDR must be an IPv4 CIDR such as 203.0.113.7/32"
[[ $instance_type =~ ^(t4g|m6g|m7g|m8g|c6g|c7g|r6g|r7g)\.[a-z0-9]+$ ]] ||
    die "$EX_USAGE" "LAI_INSTANCE_TYPE must be a Graviton (ARM64) type such as t4g.small"
[[ $repository =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "$EX_USAGE" "LAI_GITHUB_REPOSITORY must be owner/repo"
for flag_value in "$db_protect" "$schedule" "$lambda"; do
    [[ $flag_value =~ ^(true|false)$ ]] || die "$EX_USAGE" "boolean settings must be true or false (got '$flag_value')"
done
for number in "$volume" "$db_storage" "$db_backup" "$lambda_memory" "$lambda_concurrency" "$budget" "$retention"; do
    [[ $number =~ ^[0-9]+$ ]] || die "$EX_USAGE" "numeric settings must be whole numbers (got '$number')"
done

# --- step 5: Cognito ----------------------------------------------------------------------------
step "5. Cognito"
pool_re='^([a-z]{2}(-gov)?-[a-z]+-[0-9])_[A-Za-z0-9]+$'
[ -n "$pool" ] || die "$EX_MISSING" "set LAI_COGNITO_USER_POOL_ID (the existing parent user pool)"
[ -n "$clients" ] || die "$EX_MISSING" "set LAI_COGNITO_CLIENT_IDS (the pool's public web client id)"
[[ $pool =~ $pool_re ]] || die "$EX_USAGE" "LAI_COGNITO_USER_POOL_ID '$pool' is not a user pool id"
pool_region=${BASH_REMATCH[1]}
IFS=',' read -r -a client_list <<<"$clients"
for client in "${client_list[@]}"; do
    [[ $client =~ ^[a-z0-9]{1,128}$ ]] || die "$EX_USAGE" "Cognito client id '$client' is not valid"
done
if aws cognito-idp describe-user-pool --region "$pool_region" --user-pool-id "$pool" --output json >/dev/null 2>"$DEV_TMP/cog.err"; then
    ok "user pool $pool exists"
    for client in "${client_list[@]}"; do
        aws cognito-idp describe-user-pool-client --region "$pool_region" --user-pool-id "$pool" \
            --client-id "$client" --output json >/dev/null 2>&1 ||
            die "$EX_MISSING" "client $client is not a client of $pool"
        ok "client $client belongs to $pool"
    done
elif grep -qiE 'AccessDenied|not authorized' "$DEV_TMP/cog.err"; then
    warn "not permitted to describe the user pool; checked the id formats only"
else
    die "$EX_MISSING" "user pool $pool not found: $(head -c 200 "$DEV_TMP/cog.err")"
fi

# --- step 6: Route 53 ---------------------------------------------------------------------------
step "6. Route 53"
open_http=false
if [ -n "$zone_id" ]; then
    [ -n "$zone_name" ] || die "$EX_USAGE" "LAI_HOSTED_ZONE_NAME is required with LAI_HOSTED_ZONE_ID"
    zone_json=$(aws route53 get-hosted-zone --id "$zone_id" --output json 2>/dev/null) ||
        die "$EX_MISSING" "hosted zone $zone_id not found"
    actual=$(jq -r '.HostedZone.Name' <<<"$zone_json")
    [ "${actual%.}" = "${zone_name%.}" ] || die "$EX_USAGE" "hosted zone $zone_id is $actual, not $zone_name"
    for host in "$site_domain" "$api_domain" "$admin_domain"; do
        [[ $host == *."${zone_name%.}" ]] || die "$EX_USAGE" "$host is not in the zone $zone_name"
    done
    ok "zone $zone_id is $actual: DNS records and certificate validation are automatic"
    open_http=false
else
    [ -z "$zone_name" ] || die "$EX_USAGE" "LAI_HOSTED_ZONE_NAME is set without LAI_HOSTED_ZONE_ID"
    open_http=true
    warn "no Route 53 zone: OpenHttpPort=true (Let's Encrypt HTTP-01) and DNS is yours to manage"
fi
manual_dns() {
    local eip cf
    eip=$(dev_out ElasticIPAddress)
    cf=$(stack_output "$DEV_FRONTEND_STACK" DistributionDomainName "$DEV_FRONTEND_REGION")
    info "Create these DNS records with your DNS provider:"
    info "  $api_domain    A      ${eip:-<ElasticIPAddress output of $DEV_PLATFORM_STACK>}"
    info "  $admin_domain  A      ${eip:-<ElasticIPAddress output of $DEV_PLATFORM_STACK>}"
    info "  $site_domain   CNAME  ${cf:-<DistributionDomainName output of $DEV_FRONTEND_STACK>}"
    info "  plus the ACM validation CNAME for $site_domain (printed while $DEV_FRONTEND_STACK is created)"
}
[ -n "$zone_id" ] || manual_dns

# --- step 7: AMI, prefix list, OIDC provider ----------------------------------------------------
step "7. AMI, CloudFront prefix list, GitHub OIDC provider"
ami=$(stack_param "$P" AmiId 2>/dev/null || true)
if [ -z "$ami" ] || [ "$refresh_ami" = true ]; then
    [ -z "$ami" ] || warn "--refresh-ami: a new AMI REPLACES the instance (the release is redeployed by install-debug.sh)"
    ami=$(aws ssm get-parameter --region "$DEV_REGION" \
        --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --output json |
        jq -r '.Parameter.Value // empty') || die "$EX_TRANSPORT" "cannot resolve the AL2023 ARM64 AMI"
fi
[[ $ami =~ ^ami-[0-9a-f]{8,17}$ ]] || die "$EX_TRANSPORT" "bad AMI id '$ami'"
info "AMI $ami (pinned)"
prefix_list=$(aws ec2 describe-managed-prefix-lists --region "$DEV_REGION" \
    --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --output json |
    jq -r '.PrefixLists[0].PrefixListId // empty') || die "$EX_TRANSPORT" "cannot read managed prefix lists"
[[ $prefix_list =~ ^pl-[0-9a-f]+$ ]] || die "$EX_MISSING" "no CloudFront origin-facing prefix list in $DEV_REGION"
info "CloudFront origin-facing prefix list $prefix_list"
if [[ -v LAI_CREATE_OIDC_PROVIDER ]]; then
    create_oidc=$LAI_CREATE_OIDC_PROVIDER
elif create_oidc=$(stack_param "$P" CreateGithubOidcProvider 2>/dev/null); then
    : # keep what the stack was created with (switching it would delete or duplicate the provider)
else
    providers=$(aws iam list-open-id-connect-providers --output json) || die "$EX_TRANSPORT" "cannot list OIDC providers"
    if jq -e '.OpenIDConnectProviderList[] | select(.Arn | endswith("oidc-provider/token.actions.githubusercontent.com"))' \
        <<<"$providers" >/dev/null; then
        create_oidc=false
    else
        create_oidc=true
    fi
fi
[[ $create_oidc =~ ^(true|false)$ ]] || die "$EX_USAGE" "LAI_CREATE_OIDC_PROVIDER must be true or false"
info "CreateGithubOidcProvider=$create_oidc"

# --- step 8: synthesize -------------------------------------------------------------------------
step "8. synthesize (npm run infra:synth)"
out=${LAI_CDK_OUT:-$DEV_REPO_ROOT/infra/cdk.out}
synth_env=(LAI_ENV=dev "CDK_DEFAULT_ACCOUNT=$DEV_ACCOUNT" "CDK_DEFAULT_REGION=$DEV_REGION"
    "CDK_OUTDIR=$out" "LAI_GITHUB_REPOSITORY=$repository" "LAI_BEDROCK_REGION=$DEV_BEDROCK_REGION")
[ -z "$zone_id" ] || synth_env+=("LAI_HOSTED_ZONE_ID=$zone_id" "LAI_HOSTED_ZONE_NAME=${zone_name%.}")
env "${synth_env[@]}" npm --prefix "$DEV_REPO_ROOT" run --silent infra:synth >&2 ||
    die "$EX_FAIL" "infra:synth failed"
for stack in "${STACKS[@]}"; do
    [ -f "$out/$stack.template.json" ] || die "$EX_FAIL" "synth did not produce $out/$stack.template.json"
done

# --- step 9: Lambda package ---------------------------------------------------------------------
step "9. Lambda worker package"
lambda_zip="" worker_key=""
if [ -f "$DEV_SCRIPTS_DIR/package-lambda.sh" ]; then
    mkdir -p "$DEV_REPO_ROOT/dist/dev-release"
    lambda_zip=$(bash "$DEV_SCRIPTS_DIR/package-lambda.sh" --out "$DEV_REPO_ROOT/dist/dev-release" | tail -n 1)
    [ -f "$lambda_zip" ] && [[ $(basename "$lambda_zip") =~ ^jobs-worker-[a-f0-9]{16}\.zip$ ]] ||
        die "$EX_FAIL" "package-lambda.sh did not print a jobs-worker-<hash16>.zip path"
    worker_key="lambda/$(basename "$lambda_zip")"
else
    worker_key=$(stack_param "$P" WorkerCodeKey 2>/dev/null || true)
    [ -n "$worker_key" ] || die "$EX_MISSING" "scripts/aws/package-lambda.sh is missing and no WorkerCodeKey is deployed"
    warn "scripts/aws/package-lambda.sh is missing; keeping the deployed WorkerCodeKey"
fi
info "WorkerCodeKey $worker_key"
artifact_bucket() { stack_output "$DEV_ARTIFACTS_STACK" ArtifactBucketName; }
upload_lambda() {
    local bucket
    bucket=$(artifact_bucket)
    [ -n "$bucket" ] && [ -n "$lambda_zip" ] || return 0
    if aws s3api head-object --region "$DEV_REGION" --bucket "$bucket" --key "$worker_key" --output json >/dev/null 2>&1; then
        info "s3://$bucket/$worker_key already uploaded"
    else
        aws s3api put-object --region "$DEV_REGION" --bucket "$bucket" --key "$worker_key" \
            --body "$lambda_zip" --if-none-match '*' --output json >/dev/null ||
            die "$EX_TRANSPORT" "upload of $worker_key failed"
        ok "uploaded s3://$bucket/$worker_key"
    fi
}

# --- parameters ---------------------------------------------------------------------------------
# All candidate values per stack; only keys the synthesized template declares are passed.
params_for() {
    case "$1" in
        "$DEV_ARTIFACTS_STACK") jq -n --arg r "$retention" '{ReleaseRetentionDays: $r}' ;;
        "$DEV_PLATFORM_STACK")
            jq -n --arg ami "$ami" --arg it "$instance_type" --arg vol "$volume" --arg dbc "$db_class" \
                --arg dbs "$db_storage" --arg dbb "$db_backup" --arg dbp "$db_protect" --arg lam "$lambda" \
                --arg key "$worker_key" --arg mem "$lambda_memory" --arg conc "$lambda_concurrency" \
                --arg sch "$schedule" --arg shut "$shutdown_time" --arg start "$startup_time" \
                --arg warm "$warmup" --arg tz "$timezone" --arg site "$site_domain" --arg api "$api_domain" \
                --arg adm "$admin_domain" --arg pool "$pool" --arg clients "$clients" --arg zid "$zone_id" \
                --arg zname "${zone_name%.}" --arg email "$cert_email" --arg pl "$prefix_list" \
                --arg cidr "$admin_cidr" --arg http "$open_http" --arg oidc "$create_oidc" \
                --arg repo "$repository" --arg alarm "$alarm_email" --arg budget "$budget" \
                '{Environment: "dev", AmiId: $ami, InstanceType: $it, EC2VolumeSize: $vol,
                  DatabaseInstanceClass: $dbc, DatabaseStorageSize: $dbs, DatabaseBackupRetention: $dbb,
                  DatabaseDeletionProtection: $dbp, EnableLambdaProcessing: $lam, WorkerCodeKey: $key,
                  LambdaMemorySize: $mem, LambdaConcurrencyLimit: $conc, EnableScheduledShutdown: $sch,
                  ShutdownHour: ($shut | split(":")[0] | tonumber | tostring),
                  ShutdownMinute: ($shut | split(":")[1] | tonumber | tostring),
                  StartupHour: ($start | split(":")[0] | tonumber | tostring),
                  StartupMinute: ($start | split(":")[1] | tonumber | tostring),
                  StartupWarmupMinutes: $warm,
                  ScheduleTimezone: $tz, SiteDomainName: $site, ApiDomainName: $api,
                  AdminDomainName: $adm, CognitoUserPoolId: $pool, CognitoClientId: $clients,
                  HostedZoneId: $zid, HostedZoneName: $zname, CertificateEmail: $email,
                  CloudFrontOriginPrefixListId: $pl, AdminAllowedCidr: $cidr, OpenHttpPort: $http,
                  CreateGithubOidcProvider: $oidc, GitHubRepository: $repo, AlarmEmail: $alarm,
                  MonthlyBudgetUsd: $budget}'
            ;;
        "$DEV_FRONTEND_STACK") jq -n --arg s "$site_domain" --arg a "$api_domain" '{SiteDomainName: $s, ApiDomainName: $a}' ;;
        *) echo '{}' ;;
    esac
}
# cfn_parameters <stack>: [{ParameterKey, ParameterValue}] for the keys the template declares.
cfn_parameters() {
    local template="$out/$1.template.json"
    jq -c --argjson all "$(params_for "$1")" '
        (.Parameters // {} | keys) as $declared
        | [$all | to_entries[] | select(.key as $k | $declared | index($k)) | {ParameterKey: .key, ParameterValue: .value}]' "$template"
}
missing_parameters() { # template parameters without a default that we do not supply
    local template="$out/$1.template.json"
    jq -r --argjson all "$(params_for "$1")" '
        (.Parameters // {}) | to_entries[]
        | select((.value | has("Default") | not) and (.key | IN($all | keys[]) | not)
                 and (.key | startswith("BootstrapVersion") | not)) | .key' "$template"
}

# --- step 10: validate --------------------------------------------------------------------------
# template_arg <stack>: sets TEMPLATE_ARGS to --template-body or --template-url; returns 1 when
# the template is too large for a body and the artifacts bucket does not exist yet.
TEMPLATE_ARGS=()
template_arg() {
    local stack=$1 template="$out/$1.template.json" size bucket key
    TEMPLATE_ARGS=()
    size=$(wc -c <"$template")
    if [ "$size" -lt 51200 ]; then
        TEMPLATE_ARGS=(--template-body "file://$template")
        return 0
    fi
    bucket=$(artifact_bucket)
    [ -n "$bucket" ] || return 1
    key="tmp/cfn/$stack-$(sha256sum "$template" | cut -c1-16).template.json"
    aws s3api put-object --region "$DEV_REGION" --bucket "$bucket" --key "$key" --body "$template" \
        --output json >/dev/null || die "$EX_TRANSPORT" "cannot upload $stack's template to s3://$bucket/$key"
    TEMPLATE_ARGS=(--template-url "https://$bucket.s3.$DEV_REGION.amazonaws.com/$key")
}

declare -A DEFERRED=()
validate() {
    local stack=$1 region
    region=$(stack_region "$stack")
    if ! template_arg "$stack"; then
        DEFERRED[$stack]="template over 51,200 bytes; validated once $DEV_ARTIFACTS_STACK exists"
        warn "$stack: ${DEFERRED[$stack]}"
        return 0
    fi
    aws cloudformation validate-template --region "$region" "${TEMPLATE_ARGS[@]}" --output json >/dev/null ||
        die "$EX_FAIL" "$stack: template validation failed"
    ok "$stack template valid"
}
step "10. validate templates"
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    validate "$stack"
done
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    missing=$(missing_parameters "$stack")
    [ -z "$missing" ] || die "$EX_MISSING" "$stack needs parameters this script does not supply: $missing"
done

# --- step 11: parameters ------------------------------------------------------------------------
step "11. parameters"
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    info "$stack ($(stack_region "$stack")):"
    params=$(cfn_parameters "$stack")
    if [ "$params" = '[]' ]; then info "  (no parameters)"; continue; fi
    jq -r '.[] | "  \(.ParameterKey) = \(if .ParameterValue == "" then "(empty)" else .ParameterValue end)"' <<<"$params" >&2
done
[ "$open_http" = false ] || info "  OpenHttpPort is true because there is no Route 53 zone"

# --- step 12: change sets -----------------------------------------------------------------------
CHANGE_SET_NAME="lai-dev-$(date -u +%Y%m%d%H%M%S)"
# make_change_set <stack>: sets CS_RESULT to created|nochange|deferred.
make_change_set() {
    local stack=$1 region status type params cs desc state reason deadline
    region=$(stack_region "$stack")
    dev_stack_forget
    status=$(dev_stack_status "$stack" "$region")
    case "$status" in
        "" | DELETE_COMPLETE | REVIEW_IN_PROGRESS) type=CREATE ;;
        ROLLBACK_COMPLETE | ROLLBACK_FAILED | DELETE_FAILED)
            die "$EX_CONFLICT" "$stack is $status: it cannot be updated. Inspect it in the console; this script never deletes stacks." ;;
        *_IN_PROGRESS) die "$EX_CONFLICT" "$stack is busy ($status); try again when it finishes" ;;
        *) type=UPDATE ;;
    esac
    if ! template_arg "$stack"; then
        CS_RESULT=deferred
        DEFERRED[$stack]="needs $DEV_ARTIFACTS_STACK's bucket for its large template (run --execute --only $DEV_ARTIFACTS_STACK, then --plan)"
        warn "$stack: change set deferred: ${DEFERRED[$stack]}"
        return 0
    fi
    params=$(cfn_parameters "$stack")
    cs="$CHANGE_SET_NAME"
    aws cloudformation create-change-set --region "$region" --stack-name "$stack" \
        --change-set-name "$cs" --change-set-type "$type" "${TEMPLATE_ARGS[@]}" \
        --parameters "$params" --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --tags '[{"Key":"Project","Value":"learning-adventure-island"},{"Key":"Environment","Value":"dev"}]' \
        --description "deploy-debug.sh $mode by $DEV_CALLER" --output json >/dev/null ||
        die "$EX_FAIL" "create-change-set for $stack failed"
    deadline=$((SECONDS + 600))
    while :; do
        desc=$(aws cloudformation describe-change-set --region "$region" --stack-name "$stack" \
            --change-set-name "$cs" --output json) || die "$EX_TRANSPORT" "describe-change-set $stack failed"
        state=$(jq -r '.Status' <<<"$desc")
        case "$state" in CREATE_COMPLETE | FAILED) break ;; esac
        [ "$SECONDS" -lt "$deadline" ] || die "$EX_TIMEOUT" "change set for $stack still $state"
        sleep "${LAI_CFN_POLL_SECONDS:-5}"
    done
    if [ "$state" = FAILED ]; then
        reason=$(jq -r '.StatusReason // ""' <<<"$desc")
        if [[ $reason == *"didn't contain changes"* || $reason == *"No updates"* ]]; then
            info "$stack: no changes"
            aws cloudformation delete-change-set --region "$region" --stack-name "$stack" \
                --change-set-name "$cs" --output json >/dev/null 2>&1 || true
            CS_RESULT=nochange
            return 0
        fi
        die "$EX_FAIL" "$stack change set failed: $reason"
    fi
    info "$stack: change set $cs ($type)"
    jq -r '.Changes[]?.ResourceChange | "  \(.Action)\t\(.LogicalResourceId)\t\(.ResourceType)\treplacement=\(.Replacement // "-")"' <<<"$desc" >&2
    if jq -e '.Changes[]?.ResourceChange | select(.ResourceType == "AWS::RDS::DBInstance"
            and (.Action == "Remove" or .Replacement == "True" or .Replacement == "Conditional"))' <<<"$desc" >/dev/null; then
        warn "$stack: this change set would REPLACE or REMOVE the RDS instance"
        if [ "$mode" = execute ] && [ "${LAI_ALLOW_DB_REPLACEMENT:-}" != true ]; then
            die "$EX_CONFLICT" "refusing to execute a change set that replaces the database (LAI_ALLOW_DB_REPLACEMENT=true to override)"
        fi
    fi
    if jq -e '.Changes[]?.ResourceChange | select(.ResourceType == "AWS::EC2::Instance" and .Replacement == "True")' <<<"$desc" >/dev/null; then
        warn "$stack: the EC2 instance will be REPLACED (rerun install-debug.sh afterwards)"
    fi
    CS_RESULT=created
}

# --- step 13: execute ---------------------------------------------------------------------------
print_acm_cname() {
    local arns arn record
    arns=$(aws acm list-certificates --region "$DEV_FRONTEND_REGION" --certificate-statuses PENDING_VALIDATION \
        --output json 2>/dev/null | jq -r --arg d "$site_domain" '.CertificateSummaryList[] | select(.DomainName == $d) | .CertificateArn') || return 1
    for arn in $arns; do
        record=$(aws acm describe-certificate --region "$DEV_FRONTEND_REGION" --certificate-arn "$arn" --output json 2>/dev/null |
            jq -r '.Certificate.DomainValidationOptions[0].ResourceRecord | select(. != null) | "\(.Name)  \(.Type)  \(.Value)"') || continue
        if [ -n "$record" ]; then
            warn "ACM is waiting for DNS validation of $site_domain. Create this record now: $record"
            return 0
        fi
    done
    return 1
}

execute_change_set() {
    local stack=$1 region status deadline acm_printed=false
    region=$(stack_region "$stack")
    aws cloudformation execute-change-set --region "$region" --stack-name "$stack" \
        --change-set-name "$CHANGE_SET_NAME" --output json >/dev/null || die "$EX_FAIL" "execute-change-set $stack failed"
    info "$stack: executing $CHANGE_SET_NAME"
    deadline=$((SECONDS + ${LAI_CFN_MAX_WAIT_SECONDS:-5400}))
    while :; do
        dev_stack_forget
        status=$(dev_stack_status "$stack" "$region")
        case "$status" in
            CREATE_COMPLETE | UPDATE_COMPLETE) ok "$stack $status"; return 0 ;;
            *ROLLBACK_COMPLETE | *FAILED)
                aws cloudformation describe-stack-events --region "$region" --stack-name "$stack" --output json 2>/dev/null |
                    jq -r '[.StackEvents[] | select(.ResourceStatus | endswith("FAILED"))][0:5][] | "  \(.LogicalResourceId): \(.ResourceStatusReason)"' >&2 || true
                die "$EX_FAIL" "$stack ended $status"
                ;;
        esac
        if [ "$stack" = "$DEV_FRONTEND_STACK" ] && [ -z "$zone_id" ] && [ "$acm_printed" = false ]; then
            print_acm_cname && acm_printed=true
        fi
        [ "$SECONDS" -lt "$deadline" ] || die "$EX_TIMEOUT" "$stack still $status after waiting; it continues in CloudFormation"
        sleep "${LAI_CFN_POLL_SECONDS:-20}"
    done
}

if [ "$mode" = execute ]; then step "12-15. change sets ($CHANGE_SET_NAME), executed in order"; else step "12. change sets ($CHANGE_SET_NAME)"; fi
declare -A RESULT=()
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    if [ "$mode" = execute ] && [ "$stack" = "$DEV_PLATFORM_STACK" ]; then upload_lambda; fi
    CS_RESULT=""
    make_change_set "$stack"
    RESULT[$stack]=$CS_RESULT
    if [ "$mode" = execute ] && [ "$CS_RESULT" = created ]; then
        execute_change_set "$stack"
        RESULT[$stack]=applied
    fi
done
if [ "$mode" = execute ]; then upload_lambda; fi

# --- steps 16-17: outputs and next command ------------------------------------------------------
step "16. summary"
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    info "  $stack: ${RESULT[$stack]:-skipped}${DEFERRED[$stack]:+ (${DEFERRED[$stack]})}"
done
gh_summary "### deploy-debug.sh --$mode" ""
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    gh_summary "- $stack: ${RESULT[$stack]:-skipped}"
done
if [ "$mode" = plan ]; then
    info ""
    info "Nothing was applied. Review the change sets ($CHANGE_SET_NAME) in the CloudFormation console,"
    info "then run: scripts/aws/deploy-debug.sh --execute"
    exit 0
fi
dev_stack_forget
for stack in "${STACKS[@]}"; do
    selected "$stack" || continue
    echo "== $stack"
    dev_stack_json "$stack" "$(stack_region "$stack")" | jq -r '(.Outputs // [])[] | "  \(.OutputKey) = \(.OutputValue)"'
done
[ -n "$zone_id" ] || manual_dns
info ""
info "17. next: ./scripts/aws/install-debug.sh"
