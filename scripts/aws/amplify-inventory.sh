#!/usr/bin/env bash
# Stage 0 of the Amplify decommission (AMP-08, docs/platform/AMPLIFY_DECOMMISSION.md): a read-only
# inventory of everything the Amplify `main` backend and Hosting app own, with the counts that
# decide what must be copied or kept. Run by the owner; paste the output on the AMP-08 card.
#
#   scripts/aws/amplify-inventory.sh [--app-id <amplify app id>] [--days 7]
#
# READ-ONLY. It calls only AWS describe/get/list operations (tests/deploy/test_amplify_inventory.py
# enforces this). It prints names, ids, statuses and counts, never item contents, user attributes,
# e-mail addresses or object keys: the photo bucket is summarised by prefix only.
#
# Environment: AWS_REGION (default us-west-1), the region of the Amplify app and its backend.
# Output: sections 1 to 9, then a draft of the runbook's section 4 table. Exit 1 when the
# credentials do not work; every other gap is printed as "unknown" rather than stopping.
set -Euo pipefail

export AWS_REGION=${AWS_REGION:-us-west-1}
app_id=""
days=7
while [ $# -gt 0 ]; do
    case "$1" in
        --app-id) app_id=${2:-}; shift 2 ;;
        --days) days=${2:-7}; shift 2 ;;
        *) echo "usage: $0 [--app-id <id>] [--days N]" >&2; exit 2 ;;
    esac
done
case "$days" in '' | *[!0-9]*) echo "--days must be a whole number" >&2; exit 2 ;; esac

q() { # q <aws args...>: text output, empty on error or "None"
    local out
    out=$(aws "$@" --output text 2>/dev/null) || return 0
    [ "$out" = None ] || printf '%s' "$out"
}
section() { printf '\n== %s\n' "$*"; }
start=$(date -u -d "-${days} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"${days}"d +%Y-%m-%dT%H:%M:%SZ)
end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
metric_sum() { # metric_sum <namespace> <metric> <dimension name> <dimension value>
    local v
    v=$(q cloudwatch get-metric-statistics --namespace "$1" --metric-name "$2" \
        --dimensions "Name=$3,Value=$4" --start-time "$start" --end-time "$end" \
        --period 86400 --statistics Sum --query 'sum(Datapoints[].Sum)')
    printf '%s' "${v:-0}"
}
request_count() { # request_count <api id>: AppSync requests = samples of its Latency metric
    local v
    v=$(q cloudwatch get-metric-statistics --namespace AWS/AppSync --metric-name Latency \
        --dimensions "Name=GraphQLAPIId,Value=$1" --start-time "$start" --end-time "$end" \
        --period 86400 --statistics SampleCount --query 'sum(Datapoints[].SampleCount)')
    printf '%s' "${v:-0}"
}

echo "== Amplify inventory (AMP-08 stage 0), region $AWS_REGION, $end, traffic window ${days} days"

# --- 1. Identity --------------------------------------------------------------------------------
section "1. Identity"
account=$(q sts get-caller-identity --query Account)
if [ -z "$account" ]; then
    echo "AWS credentials do not work (sts get-caller-identity failed). Sign in, then re-run."
    exit 1
fi
echo "account $account as $(q sts get-caller-identity --query Arn)"

# --- 2. Amplify Hosting app and branches -------------------------------------------------------
section "2. Amplify Hosting"
q amplify list-apps --query 'apps[].[appId,name,defaultDomain]' | sed 's/^/app  /'
if [ -z "$app_id" ]; then
    app_id=$(q amplify list-apps --query 'apps[0].appId')
    [ -n "$app_id" ] && echo "(no --app-id given; using the first app, $app_id)"
fi
if [ -n "$app_id" ]; then
    q amplify list-branches --app-id "$app_id" \
        --query 'branches[].[branchName,stage,enableAutoBuild]' | sed 's/^/branch  /'
    q amplify list-domain-associations --app-id "$app_id" \
        --query 'domainAssociations[].[domainName,domainStatus]' | sed 's/^/domain  /'
    echo "LAI_SKIP_BACKEND_DEPLOY on main: $(q amplify get-branch --app-id "$app_id" --branch-name main \
        --query 'branch.environmentVariables.LAI_SKIP_BACKEND_DEPLOY')"
fi

# --- 3. CloudFormation stacks ------------------------------------------------------------------
section "3. Amplify stacks and resources"
stacks=$(q cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE \
    --query "StackSummaries[?starts_with(StackName,'amplify-')].StackName")
for stack in $stacks; do
    echo "stack $stack"
    q cloudformation list-stack-resources --stack-name "$stack" \
        --query 'StackResourceSummaries[].[ResourceType,LogicalResourceId,PhysicalResourceId]' |
        grep -Ev 'AWS::CloudFormation::Stack|Custom::|AWS::CDK::Metadata' | sed 's/^/  /'
done
[ -n "$stacks" ] || echo "no amplify-* stacks found in $AWS_REGION"

# --- 4. Cognito ----------------------------------------------------------------------------------
section "4. Cognito (keep the user pool)"
for pool in $(q cognito-idp list-user-pools --max-results 60 --query 'UserPools[].Id'); do
    name=$(q cognito-idp describe-user-pool --user-pool-id "$pool" --query 'UserPool.Name')
    users=$(q cognito-idp describe-user-pool --user-pool-id "$pool" --query 'UserPool.EstimatedNumberOfUsers')
    protection=$(q cognito-idp describe-user-pool --user-pool-id "$pool" --query 'UserPool.DeletionProtection')
    groups=$(q cognito-idp list-groups --user-pool-id "$pool" --query 'Groups[].GroupName' | tr '\t' ',')
    clients=$(q cognito-idp list-user-pool-clients --user-pool-id "$pool" --max-results 60 \
        --query 'UserPoolClients[].ClientId' | tr '\t' ',')
    echo "user-pool $pool name=$name estimated-users=${users:-unknown} deletion-protection=${protection:-unknown} groups=$groups clients=$clients"
done
q cognito-identity list-identity-pools --max-results 60 \
    --query 'IdentityPools[].[IdentityPoolId,IdentityPoolName]' | sed 's/^/identity-pool  /'

# --- 5. AppSync and DynamoDB --------------------------------------------------------------------
section "5. AppSync APIs and their DynamoDB tables"
apis=$(q appsync list-graphql-apis --query 'graphqlApis[].[apiId,name]')
printf '%s\n' "$apis" | sed '/^$/d; s/^/api  /'
for api in $(printf '%s\n' "$apis" | cut -f1); do
    echo "api $api requests in the last ${days} days: $(request_count "$api")"
    for table in $(q dynamodb list-tables --query "TableNames[?contains(@, '$api')]"); do
        items=$(q dynamodb describe-table --table-name "$table" --query 'Table.ItemCount')
        protect=$(q dynamodb describe-table --table-name "$table" --query 'Table.DeletionProtectionEnabled')
        pitr=$(q dynamodb describe-continuous-backups --table-name "$table" \
            --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus')
        echo "  table $table items=${items:-unknown} deletion-protection=${protect:-unknown} pitr=${pitr:-unknown}"
    done
done
echo "(ItemCount is refreshed about every 6 hours.)"

# --- 6. Storage buckets ---------------------------------------------------------------------------
section "6. Amplify Storage buckets (summarised by prefix, no keys)"
for bucket in $(q s3api list-buckets --query "Buckets[?starts_with(Name,'amplify-')].Name"); do
    versioning=$(q s3api get-bucket-versioning --bucket "$bucket" --query Status)
    echo "bucket $bucket versioning=${versioning:-off}"
    for prefix in child-photos/ assets/ public/ protected/ private/; do
        count=$(q s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" --query 'length(Contents[])')
        size=$(q s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" --query 'sum(Contents[].Size)')
        [ -n "$count" ] && echo "  $prefix objects=$count bytes=${size:-0}"
    done
done

# --- 7. Functions --------------------------------------------------------------------------------
section "7. Amplify Lambda functions and invocations in the last ${days} days"
for fn in $(q lambda list-functions --query "Functions[?starts_with(FunctionName,'amplify-')].FunctionName"); do
    echo "function $fn invocations=$(metric_sum AWS/Lambda Invocations FunctionName "$fn")"
done

# --- 8. Monitoring -------------------------------------------------------------------------------
section "8. Monitoring Amplify owns"
q sns list-topics --query "Topics[?contains(TopicArn,'amplify')].TopicArn" | tr '\t' '\n' | sed '/^$/d; s/^/topic  /'
q budgets describe-budgets --account-id "$account" --query 'Budgets[].[BudgetName,BudgetLimit.Amount]' |
    sed 's/^/budget  /'
q cloudwatch list-dashboards --query 'DashboardEntries[].DashboardName' | tr '\t' '\n' | sed '/^$/d; s/^/dashboard  /'

# --- 9. Section 4 draft --------------------------------------------------------------------------
section "9. Draft for the runbook's section 4 (decide each row)"
cat <<'EOF'
Cognito user pool + Admins/Superusers + web client  -> Retain (stage 3 DeletionPolicy, then CDK import)
Cognito identity pool                                -> Delete after the photo copy is verified
DynamoDB tables with items > 0                       -> Back up; import or retain with deletion protection
DynamoDB tables with items = 0                       -> Back up; delete with the stack
AppSync API                                          -> Delete after zero requests (stage 5)
Storage bucket                                       -> Delete after copy and reconcile; retain if anything is left
Lambda functions                                     -> Delete after zero invocations (stage 5)
Alert topic, budget, dashboard                       -> Delete once the AMP-05 CDK alarms are live
Amplify Hosting app                                  -> Delete after DNS moves (stage 4)
EOF
echo "== done (read-only; nothing was changed)"
