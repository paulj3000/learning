#!/usr/bin/env bash
# Install (or reinstall) the application on the native DEV environment after
# `deploy-debug.sh --execute`. Rerunnable: every step checks before it writes, nothing is
# duplicated, and an existing secret is never replaced. Changes AWS and GitHub: owner only.
#
#   install-debug.sh [--dry-run] [--start] [--skip-github] [--allow-unpushed]
#                    [--create-admin USER] [--dev-bootstrap-publish] [--enable-ai] [--enable-speech]
#                    [--skip-release] [--skip-bootstrap] [--skip-lambda] [--skip-frontend]
#                    [--profile P] [--region R]
#
# Steps (each prints what it does; --dry-run prints this plan and touches nothing):
#   1  discover the stack outputs; every stack must be complete
#   2  the environment must be running (--start runs manage-dev.sh start; on a terminal you are asked)
#   3  /lai/dev/django/DJANGO_SECRET_KEY: created as a SecureString only when missing (generated
#      locally, passed through a 0600 file, never printed); WEB_CONCURRENCY=3 only when missing;
#      --enable-ai: the Bedrock settings from LaiAiGuardrail-dev's outputs (provider, region, model,
#      Guardrail id and published version, Studio model) only when missing; --enable-speech:
#      LAI_SPEECH_PROVIDER=polly and LAI_SPEECH_AWS_REGION (LAI_SPEECH_AWS_REGION or the dev
#      region) only when missing. Both are off by default: they start paid Bedrock and Polly use.
#   4  GitHub (gh, skipped with --skip-github): environments dev-backend, dev-infrastructure,
#      site-dev (deployments from main only) and their variables, plus the repository variables
#      LAI_AWS_REGION, LAI_DEV_NATIVE_ENABLED=true, LAI_DEV_STOPPED_DEPLOY (defer, only when unset)
#   5  wait for the SSM agent; before the first release the deploy waits for instance setup
#   6  package, upload and deploy HEAD (must be on origin/main unless --allow-unpushed;
#      --skip-release keeps the installed release, e.g. to rerun only the bootstrap)
#   7  bootstrap through lai-dev-native-bootstrap: check, ensure-roles, load-content, seed-content,
#      import-assets; publish-seed-content only with --dev-bootstrap-publish
#   8  --create-admin USER: asks for the password twice (hidden), stores it in the transient
#      SecureString /lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD, runs create-admin and ALWAYS deletes
#      the parameter afterwards (exit trap), even when something fails
#   9  Lambda workers (dev-release.sh lambda-deploy)
#   10 frontend: npm run build with the Cognito ids, then scripts/aws/publish-site.sh publish
#   11 acceptance checks (below) and show-endpoints.sh
#
# Acceptance checks: CloudFront URL 200; an SPA route returns index.html; /api/v1/health/ready/
# through the site 200; the API host directly (only meaningful from AdminAllowedCidr); the admin
# host /admin/login/ (200 from AdminAllowedCidr, otherwise unreachable or 403); anonymous GET on
# the web, asset and child photo buckets is 403; RDS PubliclyAccessible is false.
#
# Exit codes: 0 installed and every acceptance check passed; 1 a step or acceptance check failed;
# 2 usage; 3 AWS transport; 4 refused by the dev guard; 6 timed out (setup); 7 the environment is
# stopped and --start was not given; 8 a stack or output is missing.
set -Eeuo pipefail
# shellcheck source=scripts/aws/lib-dev.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-dev.sh"

usage() {
    sed -n '6,9p' "$0" >&2
    exit "$EX_USAGE"
}
dry_run=false start=false skip_github=false allow_unpushed=false admin_user="" publish_seed=false
enable_ai=false enable_speech=false
skip_release=false skip_bootstrap=false skip_lambda=false skip_frontend=false
while [ "$#" -gt 0 ]; do
    consumed=0
    dev_common_flag "$@" || consumed=$?
    if [ "$consumed" -gt 0 ]; then shift "$consumed"; continue; fi
    case "$1" in
        --dry-run) dry_run=true; shift ;;
        --start) start=true; shift ;;
        --skip-github) skip_github=true; shift ;;
        --allow-unpushed) allow_unpushed=true; shift ;;
        --create-admin) admin_user=${2:-}; shift 2 || usage ;;
        --dev-bootstrap-publish) publish_seed=true; shift ;;
        --enable-ai) enable_ai=true; shift ;;
        --enable-speech) enable_speech=true; shift ;;
        --skip-release) skip_release=true; shift ;;
        --skip-bootstrap) skip_bootstrap=true; shift ;;
        --skip-lambda) skip_lambda=true; shift ;;
        --skip-frontend) skip_frontend=true; shift ;;
        -h | --help) usage ;;
        *) err "unknown argument $1"; usage ;;
    esac
done
[[ -z $admin_user || $admin_user =~ ^[a-z][a-z0-9_.-]{2,29}$ ]] ||
    die "$EX_USAGE" "--create-admin: the username must be 3 to 30 of a-z 0-9 _ . - starting with a letter"

if [ "$dry_run" = true ]; then
    sed -n '11,33p' "$0" | sed 's/^# \{0,1\}//'
    echo "Options: start=$start skip_github=$skip_github allow_unpushed=$allow_unpushed create_admin=${admin_user:-no}" \
        "publish_seed=$publish_seed skip_release=$skip_release skip_bootstrap=$skip_bootstrap skip_lambda=$skip_lambda skip_frontend=$skip_frontend"
    echo "--dry-run: nothing was changed."
    exit 0
fi

dev_init
dev_guard_account
SECRET_PARAM="$DEV_DJANGO_PREFIX/DJANGO_SECRET_KEY"
ADMIN_PARAM=/lai/dev/bootstrap/DJANGO_ADMIN_PASSWORD
failures=0

# --- 1. outputs ---------------------------------------------------------------------------------
step "1. stacks and outputs"
for stack in "$DEV_ARTIFACTS_STACK" LaiAssetStorage-dev LaiChildPhotos-dev LaiAiGuardrail-dev "$DEV_PLATFORM_STACK" "$DEV_FRONTEND_STACK"; do
    region=$DEV_REGION
    [ "$stack" != "$DEV_FRONTEND_STACK" ] || region=$DEV_FRONTEND_REGION
    [ "$stack" != LaiAiGuardrail-dev ] || region=$DEV_BEDROCK_REGION
    dev_guard_stack "$stack" "$region"
    status=$(dev_stack_status "$stack" "$region")
    case "$status" in
        CREATE_COMPLETE | UPDATE_COMPLETE) ok "$stack $status" ;;
        UPDATE_ROLLBACK_COMPLETE) warn "$stack is UPDATE_ROLLBACK_COMPLETE (its last update failed; the previous version is in place)" ;;
        "") die "$EX_MISSING" "$stack is not deployed (scripts/aws/deploy-debug.sh --execute)" ;;
        *) die "$EX_MISSING" "$stack is $status, not complete" ;;
    esac
done
dev_require_platform
site_url=$(dev_out SiteUrl)
api_url=$(dev_out ApiBaseUrl)
admin_url=$(dev_out AdminBaseUrl)
artifact_bucket=$(dev_out ArtifactBucketName)
backend_role=$(dev_out BackendDeploymentRoleArn)
infra_role=$(dev_out InfrastructureManagementRoleArn)
db_id=$(dev_out DatabaseIdentifier)
db_id=${db_id:-lai-dev}
frontend_out() { stack_output "$DEV_FRONTEND_STACK" "$1" "$DEV_FRONTEND_REGION"; }
web_bucket=$(frontend_out WebBucketName)
distribution=$(frontend_out DistributionId)
cloudfront_url=$(frontend_out CloudFrontUrl)
[ -n "$cloudfront_url" ] || cloudfront_url="https://$(frontend_out DistributionDomainName)"
site_role=$(frontend_out FrontendDeploymentRoleArn)
[ -n "$site_role" ] || site_role=$(frontend_out SiteDeployRoleArn)
pool=$(stack_param "$DEV_PLATFORM_STACK" CognitoUserPoolId 2>/dev/null || true)
client=$(stack_param "$DEV_PLATFORM_STACK" CognitoClientId 2>/dev/null || true)
client=${client%%,*}
admin_cidr=$(stack_param "$DEV_PLATFORM_STACK" AdminAllowedCidr 2>/dev/null || true)
for required in site_url api_url admin_url artifact_bucket web_bucket distribution; do
    [ -n "${!required}" ] || die "$EX_MISSING" "missing stack output for $required"
done

# --- 2. power -----------------------------------------------------------------------------------
step "2. environment power"
ec2=$(dev_ec2_state "$DEV_INSTANCE_ID")
power_state=$(dev_param "$DEV_POWER_PREFIX/state")
if [ "$ec2" != running ] || [[ ! ${power_state:-running} =~ ^(running|degraded)$ ]]; then
    if [ "$start" != true ] && [ -t 0 ] && [ -t 2 ]; then
        read -r -p "The environment is ${power_state:-$ec2}. Start it now? [y/N] " answer
        [[ $answer =~ ^[Yy] ]] && start=true
    fi
    [ "$start" = true ] ||
        die "$EX_NOT_RUNNING" "the environment is ${power_state:-$ec2}; run scripts/aws/manage-dev.sh start, or pass --start"
    "$DEV_SCRIPTS_DIR/manage-dev.sh" start --region "$DEV_REGION" || die "$EX_FAIL" "could not start the environment"
fi
ok "environment running"

# --- 3. runtime secrets and defaults ------------------------------------------------------------
step "3. Django secret key and defaults"
put_new_param() { # put_new_param <name> <type> <value-file>: never overwrites
    local input="$DEV_TMP/put-param.json"
    (umask 077 && jq -n --arg n "$1" --arg t "$2" --rawfile v "$3" \
        '{Name: $n, Type: $t, Value: ($v | rtrimstr("\n")), Overwrite: false}' >"$input")
    if aws ssm put-parameter --region "$DEV_REGION" --cli-input-json "file://$input" --output json >/dev/null; then
        rm -f "$input"
        return 0
    fi
    rm -f "$input"
    return 1
}
if dev_param_exists "$SECRET_PARAM"; then
    ok "$SECRET_PARAM exists (left unchanged)"
else
    secret_file="$DEV_TMP/secret"
    (umask 077 && { python3 -c 'import secrets; print(secrets.token_urlsafe(64))' 2>/dev/null ||
        openssl rand -base64 64 | tr -d '\n='; } >"$secret_file")
    [ "$(wc -c <"$secret_file")" -ge 50 ] || die "$EX_FAIL" "could not generate a secret key"
    put_new_param "$SECRET_PARAM" SecureString "$secret_file" || die "$EX_TRANSPORT" "could not create $SECRET_PARAM"
    rm -f "$secret_file"
    ok "created $SECRET_PARAM (SecureString, value not shown)"
fi
if dev_param_exists "$DEV_DJANGO_PREFIX/WEB_CONCURRENCY"; then
    ok "WEB_CONCURRENCY exists (left unchanged)"
else
    printf '3' >"$DEV_TMP/wc"
    put_new_param "$DEV_DJANGO_PREFIX/WEB_CONCURRENCY" String "$DEV_TMP/wc" || die "$EX_TRANSPORT" "could not create WEB_CONCURRENCY"
    ok "created WEB_CONCURRENCY=3"
fi
ensure_setting() { # ensure_setting <NAME> <value>: create /lai/dev/django/<NAME> only when missing
    if dev_param_exists "$DEV_DJANGO_PREFIX/$1"; then
        ok "$1 exists (left unchanged)"
        return 0
    fi
    [ -n "$2" ] || die "$EX_MISSING" "no value for $1"
    printf '%s' "$2" >"$DEV_TMP/setting"
    put_new_param "$DEV_DJANGO_PREFIX/$1" String "$DEV_TMP/setting" || die "$EX_TRANSPORT" "could not create $1"
    ok "created $1"
}
if [ "$enable_ai" = true ]; then
    # Bedrock is called in the Guardrail's Region (LAI_DEV_BEDROCK_REGION, default the dev Region),
    # through the US inference profile; EC2, RDS and the jobs stay in the dev Region.
    guardrail_out() { stack_output LaiAiGuardrail-dev "$1" "$DEV_BEDROCK_REGION"; }
    model=$(guardrail_out ModelId) guardrail=$(guardrail_out GuardrailId) version=$(guardrail_out GuardrailVersion)
    [ -n "$model" ] && [ -n "$guardrail" ] && [ -n "$version" ] ||
        die "$EX_MISSING" "LaiAiGuardrail-dev outputs are missing (deploy-debug.sh --execute first)"
    ensure_setting LAI_AI_PROVIDER bedrock
    ensure_setting LAI_AI_BEDROCK_REGION "$DEV_BEDROCK_REGION"
    ensure_setting LAI_AI_MODEL_ID "$model"
    ensure_setting LAI_AI_GUARDRAIL_ID "$guardrail"
    ensure_setting LAI_AI_GUARDRAIL_VERSION "$version"
    ensure_setting LAI_STUDIO_MODEL_ID "$model"
    ensure_setting LAI_STUDIO_APPROVED_MODEL_IDS "$model"
else
    info "AI settings skipped (--enable-ai turns on Bedrock for Chatty and Question Studio)"
fi
if [ "$enable_speech" = true ]; then
    ensure_setting LAI_SPEECH_PROVIDER polly
    ensure_setting LAI_SPEECH_AWS_REGION "${LAI_SPEECH_AWS_REGION:-$DEV_REGION}"
else
    info "speech settings skipped (--enable-speech turns on Amazon Polly)"
fi

# --- 4. GitHub ----------------------------------------------------------------------------------
step "4. GitHub environments and variables"
if [ "$skip_github" = true ]; then
    info "skipped (--skip-github)"
else
    command -v gh >/dev/null || die "$EX_MISSING" "the GitHub CLI (gh) is required, or pass --skip-github"
    repo=${LAI_GITHUB_REPOSITORY:-$(stack_param "$DEV_PLATFORM_STACK" GitHubRepository 2>/dev/null || true)}
    repo=${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
    [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "$EX_USAGE" "cannot tell the GitHub repository"
    ensure_environment() {
        gh api -X PUT "repos/$repo/environments/$1" --input - >/dev/null <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
        if ! gh api "repos/$repo/environments/$1/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null | grep -qx main; then
            gh api -X POST "repos/$repo/environments/$1/deployment-branch-policies" -f name=main -f type=branch >/dev/null
        fi
        ok "environment $1 (deployments from main)"
    }
    set_var() { # set_var <name> <value> [environment]
        local flags=(-R "$repo" --body "$2")
        [ -z "${3:-}" ] || flags+=(--env "$3")
        [ -n "$2" ] || { warn "no value for ${3:+$3 }$1; not set"; return 0; }
        gh variable set "$1" "${flags[@]}" >/dev/null
        info "  ${3:-repository} $1 = $2"
    }
    for environment in dev-backend dev-infrastructure site-dev; do ensure_environment "$environment"; done
    set_var LAI_AWS_REGION "$DEV_REGION"
    set_var LAI_DEV_NATIVE_ENABLED true
    if ! gh variable list -R "$repo" --json name --jq '.[].name' | grep -qx LAI_DEV_STOPPED_DEPLOY; then
        set_var LAI_DEV_STOPPED_DEPLOY defer
    fi
    set_var LAI_DEV_BACKEND_ROLE_ARN "$backend_role" dev-backend
    set_var LAI_DEV_ARTIFACT_BUCKET "$artifact_bucket" dev-backend
    set_var LAI_API_BASE_URL "$api_url" dev-backend
    set_var LAI_DEV_INFRA_ROLE_ARN "$infra_role" dev-infrastructure
    set_var LAI_SITE_DEPLOY_ROLE_ARN "$site_role" site-dev
    set_var LAI_COGNITO_USER_POOL_ID "$pool" site-dev
    set_var LAI_COGNITO_CLIENT_ID "$client" site-dev
    set_var LAI_SITE_BUCKET "$web_bucket" site-dev
    set_var LAI_SITE_DISTRIBUTION_ID "$distribution" site-dev
    set_var LAI_SITE_URL "$site_url" site-dev
    info "LAI_SITE_DEPLOY_ENABLED (site publishing from GitHub) is the owner's switch; not changed"
fi

# --- 5. instance setup --------------------------------------------------------------------------
# The SSM agent must be online. setup-native.sh writes /opt/lai/state/setup-complete last; the
# status document (status-native.sh) exists only once a release is installed, so before the first
# release the deploy itself is the check: it refuses with exit 30 (configuration missing) until
# setup has finished, and step 6 retries it until LAI_SETUP_MAX_WAIT_SECONDS.
step "5. instance setup"
deadline=$((SECONDS + ${LAI_SETUP_MAX_WAIT_SECONDS:-1800}))
until [ "$(dev_ssm_ping "$DEV_INSTANCE_ID")" = Online ]; do
    [ "$SECONDS" -lt "$deadline" ] || die "$EX_TIMEOUT" "the instance never came online in SSM (manage-dev.sh status)"
    info "waiting for the SSM agent..."
    sleep "${LAI_SETUP_POLL_SECONDS:-30}"
done
rc=0
dev_ssm_run lai-dev-native-status '{}' 2>/dev/null || rc=$?
if [ "$rc" -eq 0 ]; then
    ok "instance set up, a release is installed"
else
    info "no status yet (no release installed); the first deploy waits for setup-complete"
fi

# --- 6. release ---------------------------------------------------------------------------------
step "6. backend release of HEAD"
cd "$DEV_REPO_ROOT"
git_sha=$(git rev-parse HEAD 2>/dev/null || true)
if [ "$skip_release" = true ]; then
    info "skipped (--skip-release)"
else
    [[ $git_sha =~ $GIT_SHA_RE ]] || die "$EX_USAGE" "not a git checkout"
    commit_epoch=$(git log -1 --format=%ct HEAD)
    if [ "$allow_unpushed" != true ]; then
        git fetch --quiet origin main || die "$EX_FAIL" "cannot fetch origin/main"
        git merge-base --is-ancestor "$git_sha" origin/main ||
            die "$EX_USAGE" "HEAD $git_sha is not on origin/main; push it, or pass --allow-unpushed"
    fi
    [ -z "$(git status --porcelain --untracked-files=no)" ] || warn "the working tree has uncommitted changes; the package is built from the files on disk"
    release=(env "LAI_DEV_ARTIFACT_BUCKET=$artifact_bucket" LAI_DEV_STOPPED_DEPLOY=defer "$DEV_SCRIPTS_DIR/dev-release.sh")
    "${release[@]}" package --git-sha "$git_sha" --commit-epoch "$commit_epoch" >/dev/null
    "${release[@]}" upload --git-sha "$git_sha" --reuse-existing
    attempt=0
    while :; do
        attempt=$((attempt + 1))
        rc=0
        "${release[@]}" deploy --git-sha "$git_sha" 2>"$DEV_TMP/deploy.err" || rc=$?
        cat "$DEV_TMP/deploy.err" >&2
        [ "$rc" -ne 0 ] || break
        if grep -q 'exit 30,' "$DEV_TMP/deploy.err" && [ "$SECONDS" -lt "$deadline" ]; then
            info "the instance is still being set up (exit 30); retrying in 60 s (attempt $attempt)"
            sleep "${LAI_SETUP_POLL_SECONDS:-60}"
            continue
        fi
        die "$rc" "the release of $git_sha failed"
    done
    ok "release $git_sha deployed"
fi

# --- 7-8. bootstrap and admin -------------------------------------------------------------------
bootstrap() { # bootstrap <task> [argument]
    local params rc=0
    params=$(jq -cn --arg t "$1" --arg a "${2:-}" '{Task: [$t], Argument: [$a]}')
    info "bootstrap $1"
    dev_ssm_run lai-dev-native-bootstrap "$params" || rc=$?
    [ "$rc" -eq 0 ] || die "$EX_FAIL" "bootstrap task $1 failed (exit $DEV_SSM_CODE)"
}
step "7. bootstrap"
if [ "$skip_bootstrap" = true ]; then
    info "skipped (--skip-bootstrap)"
else
    for task in check ensure-roles load-content seed-content import-assets; do bootstrap "$task"; done
    if [ "$publish_seed" = true ]; then bootstrap publish-seed-content; else info "publish-seed-content skipped (--dev-bootstrap-publish)"; fi
fi

delete_admin_param() {
    aws ssm delete-parameter --region "$DEV_REGION" --name "$ADMIN_PARAM" --output json >/dev/null 2>&1 || true
    info "deleted $ADMIN_PARAM (if it existed)"
}
step "8. admin account"
if [ -z "$admin_user" ]; then
    info "skipped (--create-admin USER to create one)"
else
    dev_add_exit_hook delete_admin_param
    read -r -s -p "Password for $admin_user: " password1 </dev/stdin
    echo >&2
    read -r -s -p "Repeat it: " password2 </dev/stdin
    echo >&2
    [ "$password1" = "$password2" ] || die "$EX_USAGE" "the passwords do not match"
    [ "${#password1}" -ge 12 ] || die "$EX_USAGE" "use at least 12 characters"
    (umask 077 && printf '%s' "$password1" >"$DEV_TMP/admin-password")
    unset password1 password2
    # Overwrite allowed here: the parameter is transient and only this run's value is wanted.
    (umask 077 && jq -n --arg n "$ADMIN_PARAM" --rawfile v "$DEV_TMP/admin-password" \
        '{Name: $n, Type: "SecureString", Value: $v, Overwrite: true}' >"$DEV_TMP/admin-param.json")
    rm -f "$DEV_TMP/admin-password"
    aws ssm put-parameter --region "$DEV_REGION" --cli-input-json "file://$DEV_TMP/admin-param.json" \
        --output json >/dev/null || die "$EX_TRANSPORT" "could not store the transient password"
    rm -f "$DEV_TMP/admin-param.json"
    bootstrap create-admin "$admin_user"
    delete_admin_param
    ok "admin account $admin_user created"
fi

# --- 9. Lambda ----------------------------------------------------------------------------------
step "9. Lambda workers"
if [ "$skip_lambda" = true ]; then
    info "skipped (--skip-lambda)"
else
    env "LAI_DEV_ARTIFACT_BUCKET=$artifact_bucket" "$DEV_SCRIPTS_DIR/dev-release.sh" lambda-deploy
fi

# --- 10. frontend -------------------------------------------------------------------------------
step "10. frontend"
if [ "$skip_frontend" = true ]; then
    info "skipped (--skip-frontend)"
else
    [[ $pool =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]_[A-Za-z0-9]+$ ]] || die "$EX_MISSING" "no Cognito user pool id"
    [[ $client =~ ^[a-z0-9]{1,128}$ ]] || die "$EX_MISSING" "no Cognito client id"
    [ -d "$DEV_REPO_ROOT/node_modules" ] || npm --prefix "$DEV_REPO_ROOT" ci --no-audit --no-fund
    # The same build as .github/actions/site-release: same-origin /api/, public Cognito ids.
    VITE_DJANGO_API_BASE='' VITE_COGNITO_USER_POOL_ID=$pool VITE_COGNITO_CLIENT_ID=$client \
        npm --prefix "$DEV_REPO_ROOT" run build
    AWS_REGION=$DEV_FRONTEND_REGION "$DEV_SCRIPTS_DIR/publish-site.sh" publish \
        "$DEV_REPO_ROOT/react/dist" "$web_bucket" "$distribution" "$git_sha"
fi

# --- 11. acceptance -----------------------------------------------------------------------------
step "11. acceptance checks"
check() { # check <label> <ok?> <detail>
    if [ "$2" = true ]; then ok "$1: $3"; else err "$1: $3"; failures=$((failures + 1)); fi
}
body_code() { # body_code <url>: "<code>" with the body in $DEV_TMP/body
    curl -s -o "$DEV_TMP/body" -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || true
}
code=$(body_code "$cloudfront_url/")
check "CloudFront" "$([ "$code" = 200 ] && echo true || echo false)" "GET $cloudfront_url/ -> $code"
code=$(body_code "$site_url/home")
spa=$([ "$code" = 200 ] && grep -q 'id="root"' "$DEV_TMP/body" && echo true || echo false)
check "SPA route" "$spa" "GET $site_url/home -> $code"
code=$(dev_http_code "$site_url/api/v1/health/ready/" 20)
check "API through the site" "$([ "$code" = 200 ] && echo true || echo false)" "GET $site_url/api/v1/health/ready/ -> $code"
code=$(dev_http_code "$api_url/api/v1/health/ready/" 8)
if [ -n "$admin_cidr" ]; then
    check "API host direct" "$([ "$code" = 200 ] && echo true || echo false)" "GET $api_url/api/v1/health/ready/ -> $code (from $admin_cidr)"
else
    info "API host direct: $code (no AdminAllowedCidr: only CloudFront reaches it; 000 is expected)"
fi
code=$(dev_http_code "${admin_url%/}/login/" 8)
if [ -n "$admin_cidr" ]; then
    check "admin sign-in" "$([[ $code =~ ^(200|403)$ ]] && echo true || echo false)" "GET ${admin_url%/}/login/ -> $code (200 from $admin_cidr, 403 elsewhere)"
else
    check "admin closed" "$([[ $code =~ ^(000|403)$ ]] && echo true || echo false)" "GET ${admin_url%/}/login/ -> $code (no AdminAllowedCidr)"
fi
for bucket in "$web_bucket" "$(stack_output LaiAssetStorage-dev AssetBucketName)" "$(stack_output LaiChildPhotos-dev ChildPhotoBucketName)"; do
    [ -n "$bucket" ] || continue
    region=$DEV_REGION
    [ "$bucket" != "$web_bucket" ] || region=$DEV_FRONTEND_REGION
    code=$(dev_http_code "https://$bucket.s3.$region.amazonaws.com/index.html" 10)
    check "bucket $bucket" "$([ "$code" = 403 ] && echo true || echo false)" "anonymous GET -> $code (403 expected)"
done
public=$(aws rds describe-db-instances --region "$DEV_REGION" --db-instance-identifier "$db_id" --output json 2>/dev/null |
    jq -r '.DBInstances[0].PubliclyAccessible' || echo unknown)
check "RDS $db_id" "$([ "$public" = false ] && echo true || echo false)" "PubliclyAccessible=$public"

"$DEV_SCRIPTS_DIR/show-endpoints.sh" --region "$DEV_REGION" || true
if [ "$failures" -gt 0 ]; then die "$EX_FAIL" "$failures acceptance check(s) failed"; fi
ok "installation complete"
