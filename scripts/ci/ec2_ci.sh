#!/usr/bin/env bash
# GitHub-runner side of the LAI EC2 unit tests (docs/infrastructure/aws-ec2-unit-tests.md).
# Called by .github/workflows/aws-integration-tests.yml, one subcommand per step:
#
#   ec2_ci.sh start        start the instance; it must be stopped (sets started_by_job)
#   ec2_ci.sh wait-ssm     wait until the SSM agent is online
#   ec2_ci.sh lock         take the on-instance lock (sets lock_status=acquired|held-by-other)
#   ec2_ci.sh run          fetch the source on the instance and run the suites (sets command_id)
#   ec2_ci.sh collect      copy results back over SSM, checksum-verified, into $OUT_DIR/results
#   ec2_ci.sh unlock       release the lock if this run holds it
#   ec2_ci.sh cancel       cancel this run's SSM command if it is still running
#   ec2_ci.sh stop         stop the instance unless another job owns it
#
# Needs the AWS CLI with the OIDC role's credentials, jq, and these environment variables:
# AWS_REGION, INSTANCE_ID, OUT_DIR, and for run: REPO_URL, COMMIT_SHA, BASE_SHA, HARNESS_SHA,
# TEST_SCOPE, RUN_KEY, LOCK_OWNER, REQUEST_B64. Every value that reaches the instance is checked
# against a fixed pattern first; no free text is sent. Optional: LAI_CI_ROLE_ARN (with the GitHub
# OIDC request variables) lets a long wait re-assume the role before its one-hour session ends.
#
# Exit codes: 0 ok; 2 usage or invalid input; 3 SSM transport failure; 4 instance busy (not
# stopped, or the lock is held by another job); 5 the instance did not stop.
set -Eeuo pipefail

POLL_SECONDS=${LAI_CI_POLL_SECONDS:-15}
SSM_ONLINE_ATTEMPTS=${LAI_CI_SSM_ONLINE_ATTEMPTS:-60}
RUN_MAX_SECONDS=${LAI_CI_RUN_MAX_SECONDS:-9600}
BUDGET_MINUTES=${LAI_CI_BUDGET_MINUTES:-150}
CHUNK=${LAI_CI_CHUNK_BYTES:-20000}
REFRESH_SECONDS=${LAI_CI_CREDENTIAL_REFRESH_SECONDS:-2100}
POLL_ERROR_LIMIT=${LAI_CI_POLL_ERROR_LIMIT:-8}
FULL_MAX_B64=${LAI_CI_FULL_MAX_B64:-4000000}
LOCK_DIR=/run/lai-ci/lock
ROOT=/var/lib/lai-ci

say() { printf '%s\n' "$*" >&2; }
fail() { say "::error::$2"; exit "$1"; }
output() { if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"; fi; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || fail 2 "$v must be set"; done; }
sha_ok() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
note() { mkdir -p "$OUT_DIR"; jq -n --arg k "$1" --arg v "$2" '{($k): $v}' >"$OUT_DIR/.note.json"
    if [ -f "$OUT_DIR/infra.json" ]; then
        jq -s '.[0] * .[1]' "$OUT_DIR/infra.json" "$OUT_DIR/.note.json" >"$OUT_DIR/.infra.tmp"
        mv "$OUT_DIR/.infra.tmp" "$OUT_DIR/infra.json"
    else mv "$OUT_DIR/.note.json" "$OUT_DIR/infra.json"; fi
    rm -f "$OUT_DIR/.note.json"; }

state() {
    aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[0].Instances[0].State.Name' --output text
}

# ssm_send <execution timeout seconds> <comment> <script text> -> prints the command id
ssm_send() {
    local params
    params=$(jq -cn --arg t "$1" --arg s "$3" '{commands: ($s | split("\n")), executionTimeout: [$t]}')
    aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
        --comment "$2" --timeout-seconds 600 --parameters "$params" \
        --query 'Command.CommandId' --output text
}

# The OIDC role session lasts one hour, but a full-unit run can wait longer (run 44877024597:
# every poll after the hour failed with ExpiredTokenException). During a long wait the script
# re-assumes the role from a fresh GitHub OIDC token, as configure-aws-credentials does. It is a
# no-op outside GitHub Actions or without LAI_CI_ROLE_ARN; the credentials are never printed.
CREDENTIALS_AT=$SECONDS

refresh_credentials() {
    [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ] \
        && [ -n "${LAI_CI_ROLE_ARN:-}" ] || return 1
    local token creds
    CREDENTIALS_AT=$SECONDS  # one attempt per interval, success or not
    token=$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
        "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=sts.amazonaws.com" | jq -r '.value // empty') \
        || return 1
    [ -n "$token" ] || return 1
    # AssumeRoleWithWebIdentity is unsigned; drop the expiring keys so nothing signs with them.
    creds=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
        aws sts assume-role-with-web-identity --role-arn "$LAI_CI_ROLE_ARN" \
        --role-session-name "lai-ci-${RUN_KEY:-refresh}" --web-identity-token "$token" \
        --duration-seconds 3600 --query Credentials --output json) || return 1
    AWS_ACCESS_KEY_ID=$(jq -r .AccessKeyId <<<"$creds")
    AWS_SECRET_ACCESS_KEY=$(jq -r .SecretAccessKey <<<"$creds")
    AWS_SESSION_TOKEN=$(jq -r .SessionToken <<<"$creds")
    [ -n "$AWS_SESSION_TOKEN" ] && [ "$AWS_SESSION_TOKEN" != null ] || return 1
    printf '::add-mask::%s\n' "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" >&2
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    say "AWS credentials refreshed from a new OIDC token"
}

maybe_refresh_credentials() {
    if [ $((SECONDS - CREDENTIALS_AT)) -ge "$REFRESH_SECONDS" ]; then
        refresh_credentials || say "::warning::AWS credential refresh unavailable or failed"
    fi
}

# ssm_wait <command id> <max seconds> [poll seconds] -> sets SSM_STATUS to the final status.
# Not run in a subshell, so refreshed credentials stay in effect for the caller. An API error is
# never read as "still running": after POLL_ERROR_LIMIT consecutive errors the wait ends as
# PollFailed (InvocationDoesNotExist, normal just after send-command, does not count).
ssm_wait() {
    local id=$1 max=$2 poll=${3:-$POLL_SECONDS} waited=0 errors=0 out
    SSM_STATUS=""
    while :; do
        maybe_refresh_credentials
        if out=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$INSTANCE_ID" \
            --query Status --output text 2>&1); then
            errors=0
            case "$out" in
                Success | Failed | Cancelled | TimedOut | Undeliverable | Terminated | DeliveryTimedOut)
                    SSM_STATUS=$out; return 0 ;;
            esac
        elif [[ "$out" != *InvocationDoesNotExist* ]]; then
            errors=$((errors + 1))
            say "SSM status poll failed (${errors}/${POLL_ERROR_LIMIT}): $(head -c 300 <<<"$out")"
            if [[ "$out" == *Expired* ]]; then
                refresh_credentials || say "::warning::AWS credentials expired and could not be refreshed"
            fi
            if [ "$errors" -ge "$POLL_ERROR_LIMIT" ]; then SSM_STATUS=PollFailed; return 0; fi
        fi
        if [ "$waited" -ge "$max" ]; then SSM_STATUS=WaitTimedOut; return 0; fi
        sleep "$poll"; waited=$((waited + poll))
    done
}

invocation() {
    aws ssm get-command-invocation --command-id "$1" --instance-id "$INSTANCE_ID" \
        --query "$2" --output text
}

# ssm_exec <comment> <script> -> stdout of a short command; exit 3 unless it succeeded
ssm_exec() {
    local id
    id=$(ssm_send 300 "$1" "$2") || fail 3 "SSM send-command failed ($1)"
    ssm_wait "$id" 330 "${LAI_CI_SHORT_POLL_SECONDS:-2}"
    if [ "$SSM_STATUS" != Success ]; then
        say "$(invocation "$id" StandardErrorContent 2>/dev/null || true)"
        fail 3 "SSM command '$1' ended $SSM_STATUS"
    fi
    invocation "$id" StandardOutputContent
}

cmd_start() {
    need INSTANCE_ID AWS_REGION
    output started_by_job false
    local current
    current=$(state)
    say "Initial EC2 state: $current"
    if [ "$current" = stopping ]; then
        say "Waiting for a previous stop to finish"
        aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID" || true
        current=$(state)
    fi
    # Shared instance, no cross-repository lock service yet: any other state means another job
    # (this repository or another) may be using it. Reject; never adopt or stop it.
    if [ "$current" != stopped ]; then
        note instance_initial_state "$current"
        fail 4 "EC2 instance is '$current', not stopped: another job may own it. Not touching it; retry when it is stopped."
    fi
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
    output started_by_job true
    note started_by_job true
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
    say "EC2 is running"
}

cmd_wait_ssm() {
    need INSTANCE_ID
    local attempt status
    for attempt in $(seq 1 "$SSM_ONLINE_ATTEMPTS"); do
        status=$(aws ssm describe-instance-information \
            --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
            --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo None)
        say "Attempt ${attempt}/${SSM_ONLINE_ATTEMPTS}: SSM status = $status"
        if [ "$status" = Online ]; then return 0; fi
        sleep 10
    done
    note ssm online-timeout
    fail 3 "SSM did not come online"
}

lock_owner_ok() { [[ "$LOCK_OWNER" =~ ^[A-Za-z0-9._/-]{1,120}$ ]] || fail 2 "invalid LOCK_OWNER"; }

cmd_lock() {
    need INSTANCE_ID LOCK_OWNER OUT_DIR
    lock_owner_ok
    output lock_status unknown
    local out
    out=$(ssm_exec "LAI CI lock" "set -eu
mkdir -p /run/lai-ci
if mkdir $LOCK_DIR 2>/dev/null; then printf '%s\n' '$LOCK_OWNER' >$LOCK_DIR/owner; echo ACQUIRED
else echo HELD; cat $LOCK_DIR/owner 2>/dev/null || true; fi")
    if [ "$(head -n1 <<<"$out")" = ACQUIRED ]; then
        output lock_status acquired; note lock acquired; say "Instance lock acquired"
        return 0
    fi
    output lock_status held-by-other
    note lock "held-by-other: $(sed -n 2p <<<"$out")"
    fail 4 "the instance lock is held by $(sed -n 2p <<<"$out"); not running and not stopping it"
}

cmd_unlock() {
    need INSTANCE_ID LOCK_OWNER
    lock_owner_ok
    ssm_exec "LAI CI unlock" "set -eu
if [ \"\$(cat $LOCK_DIR/owner 2>/dev/null)\" = '$LOCK_OWNER' ]; then rm -rf $LOCK_DIR; echo RELEASED
else echo NOT-OURS; fi"
}

cmd_run() {
    need INSTANCE_ID REPO_URL COMMIT_SHA BASE_SHA HARNESS_SHA TEST_SCOPE RUN_KEY LOCK_OWNER \
        REQUEST_B64 OUT_DIR
    lock_owner_ok
    for v in COMMIT_SHA BASE_SHA HARNESS_SHA; do sha_ok "${!v}" || fail 2 "$v is not a full SHA"; done
    [[ "$TEST_SCOPE" =~ ^(affected|full-unit)$ ]] || fail 2 "invalid TEST_SCOPE"
    [[ "$RUN_KEY" =~ ^[0-9]+-[0-9]+$ ]] || fail 2 "invalid RUN_KEY"
    [[ "$REPO_URL" =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.git$ ]] || fail 2 "invalid REPO_URL"
    [[ "$REQUEST_B64" =~ ^[A-Za-z0-9+/=]{1,8000}$ ]] || fail 2 "invalid REQUEST_B64"
    local script id status code
    script="set -eu
export HOME=/root
R=$ROOT
mkdir -p \$R/harness \$R/runs
command -v git >/dev/null || { apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -yq git; }
G=\$R/repo.git
test -d \$G || git init -q --bare \$G
git --git-dir=\$G fetch -q --no-tags $REPO_URL +$COMMIT_SHA:refs/lai-ci/commit/$COMMIT_SHA +$BASE_SHA:refs/lai-ci/base/$BASE_SHA +$HARNESS_SHA:refs/lai-ci/harness/$HARNESS_SHA
H=\$R/harness/$HARNESS_SHA
if [ ! -f \$H/.complete ]; then rm -rf \$H; mkdir -p \$H; git --git-dir=\$G archive $HARNESS_SHA scripts/ci | tar -x -C \$H; touch \$H/.complete; fi
exec python3 \$H/scripts/ci/remote_runner.py --repo-git \$G --commit $COMMIT_SHA --run-key $RUN_KEY --lock-owner '$LOCK_OWNER' --budget-minutes $BUDGET_MINUTES --request-b64 $REQUEST_B64"
    id=$(ssm_send "$RUN_MAX_SECONDS" "LAI CI unit tests $RUN_KEY" "$script") || fail 3 "SSM send-command failed"
    output command_id "$id"
    note command_id "$id"
    printf '%s\n' "$id" >"$OUT_DIR/command_id"
    say "SSM command $id; polling every ${POLL_SECONDS}s for up to ${RUN_MAX_SECONDS}s"
    ssm_wait "$id" "$RUN_MAX_SECONDS"
    status=$SSM_STATUS
    code=$(invocation "$id" ResponseCode 2>/dev/null || echo -1)
    note remote_status "$status"
    note remote_exit_code "$code"
    say "--- remote output (first 24,000 characters; full harness log is in the artifact) ---"
    invocation "$id" StandardOutputContent 2>/dev/null | tail -n 40 >&2 || true
    invocation "$id" StandardErrorContent 2>/dev/null | tail -n 40 >&2 || true
    say "SSM command status: $status, exit code $code"
    # A test failure is not a transport failure: the runner exits 0 once results.json exists.
    if [ "$status" != Success ]; then fail 3 "the remote run ended $status (exit $code)"; fi
}

fetch_archive() {  # fetch_archive <name> <b64 path> <bytes> <sha256> <dest dir>
    local name=$1 path=$2 bytes=$3 sum=$4 dest=$5 offset=0 part b64file
    [[ "$path" =~ ^$ROOT/runs/[0-9]+-[0-9]+/(lite|full)\.b64$ ]] || fail 2 "unexpected archive path"
    [[ "$bytes" =~ ^[0-9]+$ && "$sum" =~ ^[0-9a-f]{64}$ ]] || fail 2 "unexpected archive metadata"
    b64file="$OUT_DIR/$name.b64"
    : >"$b64file"
    while [ "$offset" -lt "$bytes" ]; do
        part=$(ssm_exec "LAI CI collect $name $offset" "tail -c +$((offset + 1)) $path | head -c $CHUNK") ||
            return 1
        printf '%s' "$part" | tr -d '\r\n ' >>"$b64file"
        offset=$((offset + CHUNK))
    done
    [ "$(wc -c <"$b64file")" -eq "$bytes" ] || { say "$name: size mismatch"; return 1; }
    base64 -d "$b64file" >"$OUT_DIR/$name.tar.gz" || return 1
    [ "$(sha256sum "$OUT_DIR/$name.tar.gz" | cut -d' ' -f1)" = "$sum" ] || { say "$name: checksum mismatch"; return 1; }
    mkdir -p "$dest"
    tar -xzf "$OUT_DIR/$name.tar.gz" -C "$dest" --no-same-owner
    rm -f "$b64file"
}

cmd_collect() {
    need INSTANCE_ID RUN_KEY OUT_DIR
    [[ "$RUN_KEY" =~ ^[0-9]+-[0-9]+$ ]] || fail 2 "invalid RUN_KEY"
    local meta dest="$OUT_DIR/results"
    meta=$(ssm_exec "LAI CI collect index" "cat $ROOT/runs/$RUN_KEY/collect.json")
    jq -e '.lite.sha256' >/dev/null <<<"$meta" || fail 3 "no results index on the instance"
    if ! fetch_archive lite "$(jq -r .lite.b64_path <<<"$meta")" "$(jq -r .lite.b64_bytes <<<"$meta")" \
        "$(jq -r .lite.sha256 <<<"$meta")" "$dest"; then
        note collect lite-failed
        fail 3 "could not copy the results back intact"
    fi
    note collect lite
    local full_bytes
    full_bytes=$(jq -r .full.b64_bytes <<<"$meta")
    if [ "$full_bytes" -le "$FULL_MAX_B64" ]; then
        if fetch_archive full "$(jq -r .full.b64_path <<<"$meta")" "$full_bytes" \
            "$(jq -r .full.sha256 <<<"$meta")" "$dest"; then note collect full
        else say "::warning::full logs could not be copied; the log tails are in the artifact"; fi
    else
        say "::warning::full logs are ${full_bytes} bytes (limit $FULL_MAX_B64); the artifact has log tails"
    fi
    [ -s "$dest/results.json" ] || fail 3 "results.json missing after collection"
}

cmd_cancel() {
    need INSTANCE_ID OUT_DIR
    local id
    id=$(cat "$OUT_DIR/command_id" 2>/dev/null || true)
    [ -n "$id" ] || return 0
    case "$(invocation "$id" Status 2>/dev/null || echo Unknown)" in
        Pending | InProgress | Delayed)
            say "Cancelling SSM command $id"
            aws ssm cancel-command --command-id "$id" --instance-ids "$INSTANCE_ID" ||
                say "::warning::cancel-command failed; stopping the instance ends the run anyway"
            note remote_cancelled true ;;
    esac
}

cmd_stop() {
    need INSTANCE_ID
    # STARTED_BY_JOB and LOCK_STATUS come from this job's own steps.
    if [ "${STARTED_BY_JOB:-false}" != true ]; then
        say "This job did not start the instance; leaving it as it is."; return 0
    fi
    if [ "${LOCK_STATUS:-unknown}" = held-by-other ]; then
        say "::warning::Another job holds the instance lock; leaving the instance running for it."
        note stop skipped-other-owner; return 0
    fi
    say "Stopping $INSTANCE_ID"
    aws ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null ||
        { note stop failed; fail 5 "stop-instances failed: the four-hour shutdown guard is the backstop"; }
    if ! aws ec2 wait instance-stopped --instance-ids "$INSTANCE_ID"; then
        note stop wait-failed
        fail 5 "the instance did not reach stopped; see the runbook (instance does not stop)"
    fi
    note stop stopped
    say "EC2 stopped"
}

[ "$#" -eq 1 ] || { sed -n '4,12p' "$0" >&2; exit 2; }
need OUT_DIR
mkdir -p "$OUT_DIR"
case "$1" in
    start) cmd_start ;;
    wait-ssm) cmd_wait_ssm ;;
    lock) cmd_lock ;;
    unlock) cmd_unlock ;;
    run) cmd_run ;;
    collect) cmd_collect ;;
    cancel) cmd_cancel ;;
    stop) cmd_stop ;;
    *) sed -n '4,12p' "$0" >&2; exit 2 ;;
esac
