#!/usr/bin/env bash
# Native DEV backend releases: build, upload and deploy one commit, roll back, update the Lambda
# workers. Used by .github/workflows/deploy-dev-native.yml, deploy-dev-lambda.yml and
# install-debug.sh. DEV ONLY (lib-dev.sh guards).
#
#   dev-release.sh package --git-sha S --commit-epoch E [--run-url U] [--out DIR] [--skip-wheels]
#   dev-release.sh upload --git-sha S [--dir DIR] [--reuse-existing]
#   dev-release.sh deploy --git-sha S [--run-url U] [--allow-older] [--allow-destructive-migrations]
#   dev-release.sh rollback [--to SHA]
#   dev-release.sh status
#   dev-release.sh lambda-deploy [--zip PATH]
#
# package  runs scripts/aws/native/package-release.sh into DIR (default dist/dev-release) and
#          checks the tarball against its manifest (DIR/<sha>.tar.gz, DIR/<sha>.json).
# upload   puts both under releases/django/ in the artifacts bucket with If-None-Match: releases
#          are immutable. The same checksum already there is success; a different one is an error
#          (exit 5), unless --reuse-existing, which keeps the uploaded build (a rerun of the same
#          commit builds a new tarball with a new checksum; the first one stays authoritative).
# deploy   reads the manifest back from S3, then:
#            - the environment is running: sends lai-dev-native-deploy and waits;
#            - it is stopped (or stopping/starting) and LAI_DEV_STOPPED_DEPLOY=defer (default):
#              records the release in /lai/dev/deploy/pending, unless a newer one is pending
#              already, prints "deployment pending" and exits 0; the power state machine applies
#              it on the next start;
#            - LAI_DEV_STOPPED_DEPLOY=start: runs manage-dev.sh start (needs a role allowed to
#              start the state machine; the GitHub backend role is not) and then deploys.
#          A refusal from the instance because the power state is stopping (75) is deferred too.
#          After a successful deploy an older or equal pending record is cleared.
# lambda-deploy uploads lambda/<jobs-worker-hash>.zip (from scripts/aws/package-lambda.sh unless
#          --zip) and points both worker functions at it, waiting for LastUpdateStatus Successful.
#
# Settings: LAI_DEV_ARTIFACT_BUCKET (else the stack output ArtifactBucketName),
# LAI_DEV_STOPPED_DEPLOY (defer | start), AWS_REGION (us-west-1). Under GitHub Actions the step
# outputs result=deployed|pending|failed and git_sha are set and a job summary is written.
#
# Exit codes: 0 deployed, uploaded, or deferred as pending; 1 the release failed on the instance
# (the message maps the native exit code: 10 invalid, 20 artifact, 30 config, 40 preflight,
# 45 destructive migrations refused, 50 migrate failed, 60 unhealthy rolled back, 61 unhealthy no
# previous, 62 rollback failed, 63 nothing to roll back, 70 lock busy); 2 usage; 3 AWS/SSM
# transport failure; 4 refused by the dev guard; 5 artifact checksum conflict; 6 timed out;
# 7 environment not running (rollback, status of the instance); 8 not provisioned or the release
# is not uploaded.
set -Eeuo pipefail
# shellcheck source=scripts/aws/lib-dev.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-dev.sh"

usage() {
    sed -n '6,11p' "$0" >&2
    exit "$EX_USAGE"
}

command=${1:-}
[ -n "$command" ] || usage
shift
git_sha="" commit_epoch="" run_url="" out_dir="" skip_wheels=false reuse=false
allow_older=false allow_destructive=false to_sha="" zip=""
while [ "$#" -gt 0 ]; do
    consumed=0
    dev_common_flag "$@" || consumed=$?
    if [ "$consumed" -gt 0 ]; then shift "$consumed"; continue; fi
    case "$1" in
        --git-sha) git_sha=${2:-}; shift 2 || usage ;;
        --commit-epoch) commit_epoch=${2:-}; shift 2 || usage ;;
        --run-url) run_url=${2:-}; shift 2 || usage ;;
        --out | --dir) out_dir=${2:-}; shift 2 || usage ;;
        --skip-wheels) skip_wheels=true; shift ;;
        --reuse-existing) reuse=true; shift ;;
        --allow-older) allow_older=true; shift ;;
        --allow-destructive-migrations) allow_destructive=true; shift ;;
        --to) to_sha=${2:-}; shift 2 || usage ;;
        --zip) zip=${2:-}; shift 2 || usage ;;
        *) err "unknown argument $1"; usage ;;
    esac
done
out_dir=${out_dir:-$DEV_REPO_ROOT/dist/dev-release}
[[ -z $git_sha || $git_sha =~ $GIT_SHA_RE ]] || die "$EX_USAGE" "--git-sha must be 40 lowercase hex characters"
[[ -z $commit_epoch || $commit_epoch =~ $EPOCH_RE ]] || die "$EX_USAGE" "--commit-epoch must be unix seconds"
[[ -z $run_url || $run_url =~ $RUN_URL_RE ]] || die "$EX_USAGE" "--run-url must be a GitHub Actions run URL"
[[ -z $to_sha || $to_sha =~ $GIT_SHA_RE ]] || die "$EX_USAGE" "--to must be a full commit SHA"
need_sha() { [ -n "$git_sha" ] || die "$EX_USAGE" "$command needs --git-sha"; }
case "$command" in
    package | upload | deploy) need_sha ;;
    rollback | status | lambda-deploy) ;;
    *) usage ;;
esac

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# --- package (no AWS) ---------------------------------------------------------------------------
if [ "$command" = package ]; then
    need_sha
    [ -n "$commit_epoch" ] || die "$EX_USAGE" "package needs --commit-epoch"
    packager="$DEV_SCRIPTS_DIR/native/package-release.sh"
    [ -f "$packager" ] || die "$EX_MISSING" "missing $packager"
    mkdir -p "$out_dir"
    args=(--git-sha "$git_sha" --commit-epoch "$commit_epoch" --out "$out_dir")
    [ -z "$run_url" ] || args+=(--run-url "$run_url")
    [ "$skip_wheels" != true ] || args+=(--skip-wheels)
    step "packaging $git_sha"
    bash "$packager" "${args[@]}" >&2
    tarball="$out_dir/$git_sha.tar.gz" manifest="$out_dir/$git_sha.json"
    [ -f "$tarball" ] && [ -f "$manifest" ] || die "$EX_FAIL" "package-release.sh did not write $tarball and $manifest"
    [ "$(jq -r .git_sha "$manifest")" = "$git_sha" ] || die "$EX_FAIL" "manifest git_sha does not match"
    [ "$(jq -r .artifact_sha256 "$manifest")" = "$(sha256_of "$tarball")" ] ||
        die "$EX_FAIL" "manifest artifact_sha256 does not match the tarball"
    ok "packaged $tarball ($(jq -r .artifact_sha256 "$manifest"))"
    printf '%s\n' "$manifest"
    exit 0
fi

dev_init
dev_guard_account

bucket() {
    local name=${LAI_DEV_ARTIFACT_BUCKET:-}
    [ -n "$name" ] || name=$(dev_out ArtifactBucketName)
    [ -n "$name" ] || name=$(stack_output "$DEV_ARTIFACTS_STACK" ArtifactBucketName)
    [ -n "$name" ] || die "$EX_MISSING" "no artifacts bucket (set LAI_DEV_ARTIFACT_BUCKET or deploy $DEV_ARTIFACTS_STACK)"
    dev_guard_name "$name"
    [[ $name == lai-dev-artifacts-* ]] || die "$EX_GUARD" "refusing bucket $name (not a lai-dev-artifacts bucket)"
    printf '%s' "$name"
}

# head_meta <bucket> <key>: the object's artifact-sha256 metadata; exit 1 when absent.
head_meta() {
    local out
    out=$(aws s3api head-object --region "$DEV_REGION" --bucket "$1" --key "$2" --output json 2>/dev/null) || return 1
    jq -r '.Metadata["artifact-sha256"] // ""' <<<"$out"
}

# put_immutable <bucket> <key> <file> <sha256>: 0 uploaded or identical, 5 different object there.
put_immutable() {
    local bucket=$1 key=$2 file=$3 sha=$4 existing
    if existing=$(head_meta "$bucket" "$key"); then
        if [ "$existing" = "$sha" ]; then info "s3://$bucket/$key already uploaded (same checksum)"; return 0; fi
        return "$EX_CONFLICT"
    fi
    if aws s3api put-object --region "$DEV_REGION" --bucket "$bucket" --key "$key" --body "$file" \
        --if-none-match '*' --metadata "artifact-sha256=$sha" --output json >/dev/null 2>"$DEV_TMP/put.err"; then
        info "uploaded s3://$bucket/$key"
        return 0
    fi
    # Lost a race with another upload of the same key: compare again.
    if existing=$(head_meta "$bucket" "$key"); then
        [ "$existing" = "$sha" ] && return 0
        return "$EX_CONFLICT"
    fi
    die "$EX_TRANSPORT" "upload of s3://$bucket/$key failed: $(head -c 300 "$DEV_TMP/put.err")"
}

# read_manifest <bucket> <sha>: the manifest JSON from S3, validated.
read_manifest() {
    local file="$DEV_TMP/manifest.json"
    aws s3api get-object --region "$DEV_REGION" --bucket "$1" --key "releases/django/$2.json" "$file" \
        --output json >/dev/null 2>&1 ||
        die "$EX_MISSING" "release $2 is not uploaded (s3://$1/releases/django/$2.json); run dev-release.sh package and upload"
    jq -e --arg sha "$2" '.schema == 1 and .git_sha == $sha and (.artifact_sha256 | test("^[a-f0-9]{64}$"))
        and ((.commit_epoch | tostring) | test("^[0-9]{9,11}$"))' "$file" >/dev/null ||
        die "$EX_FAIL" "manifest for $2 is invalid"
    cat "$file"
}

record_pending() { # record_pending <manifest json>
    local manifest=$1 existing new_epoch old_epoch old_sha record
    new_epoch=$(jq -r '.commit_epoch' <<<"$manifest")
    existing=$(dev_param "$DEV_DEPLOY_PREFIX/pending")
    if [ -n "$existing" ] && [ "$existing" != none ] && jq -e . >/dev/null 2>&1 <<<"$existing"; then
        old_epoch=$(jq -r '.commit_epoch // 0' <<<"$existing")
        old_sha=$(jq -r '.git_sha // ""' <<<"$existing")
        if [ "$old_sha" = "$git_sha" ]; then
            info "release ${git_sha:0:12} is already pending"
            return 0
        fi
        if [[ $old_epoch =~ ^[0-9]+$ ]] && [ "$old_epoch" -gt "$new_epoch" ]; then
            info "a newer release (${old_sha:0:12}) is already pending; leaving it"
            return 0
        fi
    fi
    record=$(jq -c --arg run "${run_url:-$(jq -r '.run_url // ""' <<<"$manifest")}" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{git_sha, artifact_sha256, commit_epoch: (.commit_epoch | tonumber), run_url: $run, recorded_at: $now}' <<<"$manifest")
    dev_put_param "$DEV_DEPLOY_PREFIX/pending" "$record"
    info "recorded $DEV_DEPLOY_PREFIX/pending = ${git_sha:0:12}"
}

deferred() { # deferred <reason>
    gh_output result pending
    gh_summary "### DEV backend: deployment pending" "" \
        "- commit \`$git_sha\`" "- $1" \
        "- applied automatically on the next start, or with \`manage-dev.sh deploy-pending\`"
    ok "deployment pending: $1"
    exit 0
}

case "$command" in
    upload)
        need_sha
        b=$(bucket)
        tarball="$out_dir/$git_sha.tar.gz" manifest="$out_dir/$git_sha.json"
        [ -f "$tarball" ] && [ -f "$manifest" ] || die "$EX_USAGE" "no package in $out_dir (dev-release.sh package first)"
        sha=$(jq -r .artifact_sha256 "$manifest")
        [ "$sha" = "$(sha256_of "$tarball")" ] || die "$EX_FAIL" "the local manifest does not match its tarball"
        rc=0
        put_immutable "$b" "releases/django/$git_sha.tar.gz" "$tarball" "$sha" || rc=$?
        [ "$rc" -eq 0 ] && { put_immutable "$b" "releases/django/$git_sha.json" "$manifest" "$sha" || rc=$?; }
        if [ "$rc" -eq "$EX_CONFLICT" ]; then
            if [ "$reuse" = true ] && read_manifest "$b" "$git_sha" >/dev/null; then
                warn "release $git_sha was already uploaded from another build; keeping that one"
                gh_output git_sha "$git_sha"
                exit 0
            fi
            die "$EX_CONFLICT" "s3://$b/releases/django/$git_sha.* already exists with a different checksum (releases are immutable)"
        fi
        [ "$rc" -eq 0 ] || exit "$rc"
        gh_output git_sha "$git_sha"
        ok "release $git_sha uploaded to s3://$b/releases/django/"
        ;;

    deploy)
        need_sha
        dev_require_platform
        b=$(bucket)
        manifest=$(read_manifest "$b" "$git_sha")
        artifact=$(jq -r .artifact_sha256 <<<"$manifest")
        epoch=$(jq -r '.commit_epoch | tostring' <<<"$manifest")
        [ -n "$run_url" ] || run_url=$(jq -r '.run_url // ""' <<<"$manifest")
        [[ -z $run_url || $run_url =~ $RUN_URL_RE ]] || run_url=""
        power_state=$(dev_param "$DEV_POWER_PREFIX/state")
        ec2_state=$(dev_ec2_state "$DEV_INSTANCE_ID")
        info "environment: power ${power_state:-unknown}, EC2 $ec2_state"
        if [ "$ec2_state" != running ] || [[ ! ${power_state:-running} =~ ^(running|degraded)$ ]]; then
            policy=${LAI_DEV_STOPPED_DEPLOY:-defer}
            case "$policy" in
                defer)
                    record_pending "$manifest"
                    deferred "the environment is ${power_state:-$ec2_state} (LAI_DEV_STOPPED_DEPLOY=defer)"
                    ;;
                start)
                    step "the environment is ${power_state:-$ec2_state}; starting it (LAI_DEV_STOPPED_DEPLOY=start)"
                    "$DEV_SCRIPTS_DIR/manage-dev.sh" start --region "$DEV_REGION" ||
                        die "$EX_FAIL" "could not start the environment; release $git_sha not deployed"
                    ;;
                *) die "$EX_USAGE" "LAI_DEV_STOPPED_DEPLOY must be defer or start" ;;
            esac
        fi
        params=$(jq -cn --arg s "$git_sha" --arg a "$artifact" --arg e "$epoch" --arg r "$run_url" \
            --arg o "$allow_older" --arg d "$allow_destructive" \
            '{GitSha: [$s], ArtifactSha256: [$a], CommitEpoch: [$e], RunUrl: [$r], AllowOlder: [$o], AllowDestructiveMigrations: [$d]}')
        document=$(dev_out DeployDocumentName)
        document=${document:-lai-dev-native-deploy}
        step "deploying $git_sha"
        rc=0
        dev_ssm_run "$document" "$params" || rc=$?
        if [ "$rc" -eq 0 ]; then
            pending=$(dev_param "$DEV_DEPLOY_PREFIX/pending")
            if [ -n "$pending" ] && [ "$pending" != none ] &&
                [ "$(jq -r '.commit_epoch // 0' <<<"$pending" 2>/dev/null || echo 0)" -le "$epoch" ]; then
                dev_put_param "$DEV_DEPLOY_PREFIX/pending" none || warn "could not clear $DEV_DEPLOY_PREFIX/pending"
            fi
            gh_output result deployed
            gh_summary "### DEV backend deployed" "" "- commit \`$git_sha\`" "- artifact \`$artifact\`"
            ok "release $git_sha deployed"
            exit 0
        fi
        if [ "$rc" -eq 1 ] && [ "$DEV_SSM_CODE" = 75 ]; then
            record_pending "$manifest"
            deferred "the instance refused because the environment is stopping"
        fi
        gh_output result failed
        if [ "$rc" -eq 1 ]; then
            meaning=$(dev_native_code_message "$DEV_SSM_CODE")
            gh_summary "### DEV backend deploy FAILED" "" "- commit \`$git_sha\`" "- exit $DEV_SSM_CODE: $meaning"
            die "$EX_FAIL" "APPLICATION DEPLOYMENT FAILURE: exit $DEV_SSM_CODE, $meaning"
        fi
        gh_summary "### DEV backend deploy: SSM transport failure" "" "- commit \`$git_sha\`"
        die "$EX_TRANSPORT" "SSM transport failure deploying $git_sha"
        ;;

    rollback)
        dev_require_platform
        [ "$(dev_ec2_state "$DEV_INSTANCE_ID")" = running ] ||
            die "$EX_NOT_RUNNING" "the environment is stopped; start it first (manage-dev.sh start)"
        rc=0
        dev_ssm_run lai-dev-native-rollback "$(jq -cn --arg t "$to_sha" '{ToGitSha: [$t]}')" || rc=$?
        if [ "$rc" -eq 0 ]; then
            gh_summary "### DEV backend rolled back${to_sha:+ to \`$to_sha\`}"
            ok "rollback done"
            exit 0
        fi
        [ "$rc" -eq 1 ] || die "$EX_TRANSPORT" "SSM transport failure"
        die "$EX_FAIL" "rollback failed: exit $DEV_SSM_CODE, $(dev_native_code_message "$DEV_SSM_CODE")"
        ;;

    status)
        dev_require_platform
        echo "pending:      $(dev_param "$DEV_DEPLOY_PREFIX/pending")"
        echo "last release: $(dev_param "$DEV_DEPLOY_PREFIX/last-release")"
        echo "power state:  $(dev_param "$DEV_POWER_PREFIX/state")"
        if [ "$(dev_ec2_state "$DEV_INSTANCE_ID")" != running ]; then
            info "the instance is stopped; no live status"
            exit 0
        fi
        rc=0
        dev_ssm_run lai-dev-native-status '{}' || rc=$?
        printf '%s\n' "$DEV_SSM_STDOUT"
        [ "$rc" -eq 0 ] || exit "$([ "$rc" -eq 1 ] && echo "$EX_FAIL" || echo "$EX_TRANSPORT")"
        ;;

    lambda-deploy)
        dev_require_platform
        b=$(bucket)
        ai=$(dev_out AiWorkerFunctionName)
        media=$(dev_out MediaWorkerFunctionName)
        # The outputs are 'none' when EnableLambdaProcessing is false.
        [ "$ai" != none ] || ai=""
        [ "$media" != none ] || media=""
        if [ -z "$ai" ] && [ -z "$media" ]; then
            ok "Lambda processing is not deployed (EnableLambdaProcessing=false); nothing to update"
            exit 0
        fi
        if [ -z "$zip" ]; then
            [ -f "$DEV_SCRIPTS_DIR/package-lambda.sh" ] || die "$EX_MISSING" "missing scripts/aws/package-lambda.sh"
            mkdir -p "$out_dir"
            zip=$(bash "$DEV_SCRIPTS_DIR/package-lambda.sh" --out "$out_dir" | tail -n 1)
        fi
        [ -f "$zip" ] || die "$EX_USAGE" "no Lambda package at '$zip'"
        name=$(basename "$zip")
        [[ $name =~ ^jobs-worker-[a-f0-9]{16}\.zip$ ]] || die "$EX_USAGE" "unexpected Lambda package name $name"
        key="lambda/$name"
        rc=0
        put_immutable "$b" "$key" "$zip" "$(sha256_of "$zip")" || rc=$?
        [ "$rc" -ne "$EX_CONFLICT" ] || die "$EX_CONFLICT" "s3://$b/$key exists with different content"
        for function in $ai $media; do
            dev_guard_name "$function"
            [[ $function == lai-dev-* ]] || die "$EX_GUARD" "refusing function $function"
            step "updating $function to $key"
            aws lambda update-function-code --region "$DEV_REGION" --function-name "$function" \
                --s3-bucket "$b" --s3-key "$key" --output json >/dev/null ||
                die "$EX_TRANSPORT" "update-function-code $function failed"
            deadline=$((SECONDS + ${LAI_LAMBDA_MAX_WAIT_SECONDS:-300}))
            while :; do
                config=$(aws lambda get-function --region "$DEV_REGION" --function-name "$function" --output json |
                    jq -c '.Configuration')
                state=$(jq -r '.LastUpdateStatus // "Successful"' <<<"$config")
                case "$state" in
                    Successful) ok "$function updated"; break ;;
                    Failed) die "$EX_FAIL" "$function update failed: $(jq -r '.LastUpdateStatusReason // ""' <<<"$config")" ;;
                esac
                [ "$SECONDS" -lt "$deadline" ] || die "$EX_TIMEOUT" "$function still $state"
                sleep "${LAI_LAMBDA_POLL_SECONDS:-5}"
            done
        done
        gh_summary "### DEV Lambda workers updated" "" "- package \`$key\`" "- functions: $ai $media"
        ;;

    *) usage ;;
esac
