#!/usr/bin/env bash
# Body of the SSM document `lai-dev-native-deploy` (native dev environment). The stack embeds this
# file at synth time, so the instance runs only this fixed code with the document's pattern-checked
# parameters; nothing from the caller is executed as a command. Self-contained (no lib).
#
# Expects, from the document: LAI_REQ_GIT_SHA, LAI_REQ_ARTIFACT_SHA256, LAI_REQ_COMMIT_EPOCH,
# LAI_REQ_RUN_URL, LAI_REQ_ALLOW_OLDER (true|false), LAI_REQ_ALLOW_DESTRUCTIVE (true|false).
#
# Refuses (75) while /lai/dev/power/state is stopping or stopped. Downloads
# s3://<artifact bucket>/releases/django/<sha>.tar.gz with the instance role, verifies its SHA-256,
# extracts it into a staging directory and moves it atomically to /opt/lai/releases/<sha>/, then
# runs that release's own deploy-native.sh, so the release logic always matches the code it deploys.
set -Eeuo pipefail
LAI_ROOT=${LAI_ROOT:-/opt/lai}
LAI_CONF=${LAI_CONF:-/etc/lai/native.conf}

say() { printf '%s [ssm-entry] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
fail() { say "ERROR: $2"; exit "$1"; }

[ -r "$LAI_CONF" ] || fail 30 "missing $LAI_CONF; the instance was not set up (setup-native.sh)"
# shellcheck source=/dev/null
. "$LAI_CONF"
if [ -z "${LAI_ARTIFACT_BUCKET:-}" ] || [ -z "${AWS_REGION:-}" ] || [ -z "${LAI_ENV:-}" ]; then
    fail 30 "$LAI_CONF is incomplete"
fi
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
# User data runs setup-native.sh on the first boot; a release that arrives before it finished would
# fail later in a less obvious place. The installer retries while this answers 30.
[ -e "$LAI_ROOT/state/setup-complete" ] || fail 30 "instance setup has not finished ($LAI_ROOT/state/setup-complete is missing)"

git_sha=${LAI_REQ_GIT_SHA:-}
artifact_sha=${LAI_REQ_ARTIFACT_SHA256:-}
epoch=${LAI_REQ_COMMIT_EPOCH:-}
run_url=${LAI_REQ_RUN_URL:-}
[[ $git_sha =~ ^[a-f0-9]{40}$ ]] || fail 10 "GitSha must be a full 40-character commit"
[[ $artifact_sha =~ ^[a-f0-9]{64}$ ]] || fail 10 "ArtifactSha256 must be 64 hex characters"
[[ $epoch =~ ^[0-9]{9,11}$ ]] || fail 10 "CommitEpoch must be unix seconds"
if [ -n "$run_url" ] && ! [[ $run_url =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$ ]]; then
    fail 10 "RunUrl is not a GitHub Actions run URL"
fi
for flag in "${LAI_REQ_ALLOW_OLDER:-false}" "${LAI_REQ_ALLOW_DESTRUCTIVE:-false}"; do
    case "$flag" in true | false) ;; *) fail 10 "AllowOlder and AllowDestructiveMigrations must be true or false" ;; esac
done

power_param="${LAI_POWER_PREFIX:-/lai/$LAI_ENV/power}/state"
if power=$(aws ssm get-parameter --name "$power_param" --query Parameter.Value --output text 2>/dev/null); then
    case "$power" in
        stopping | stopped) fail 75 "the environment is $power ($power_param); start it, or record the release as pending" ;;
    esac
else
    say "WARNING: could not read $power_param; continuing"
fi

releases="$LAI_ROOT/releases"
release_dir="$releases/$git_sha"
mkdir -p "$releases"
if [ -f "$release_dir/scripts/aws/native/deploy-native.sh" ] &&
    [ "$(cat "$release_dir/ARTIFACT_SHA256" 2>/dev/null)" = "$artifact_sha" ]; then
    say "release $git_sha is already on this instance"
else
    [ ! -e "$release_dir" ] || [ "$(readlink -f "$LAI_ROOT/current" 2>/dev/null)" != "$release_dir" ] ||
        fail 20 "the running release $git_sha was built from a different artifact"
    staging=$(mktemp -d "$releases/.staging.XXXXXX")
    trap 'rm -rf "$staging"' EXIT
    key="releases/django/$git_sha.tar.gz"
    say "downloading s3://$LAI_ARTIFACT_BUCKET/$key"
    aws s3 cp --only-show-errors "s3://$LAI_ARTIFACT_BUCKET/$key" "$staging/artifact.tar.gz" ||
        fail 20 "could not download s3://$LAI_ARTIFACT_BUCKET/$key (instance role or key)"
    actual=$(sha256sum "$staging/artifact.tar.gz" | cut -d' ' -f1)
    [ "$actual" = "$artifact_sha" ] || fail 20 "artifact checksum mismatch (expected $artifact_sha, got $actual)"
    mkdir "$staging/tree"
    tar --no-same-owner --no-same-permissions -xzf "$staging/artifact.tar.gz" -C "$staging/tree" ||
        fail 20 "the artifact could not be extracted"
    [ -f "$staging/tree/scripts/aws/native/deploy-native.sh" ] || fail 20 "the artifact has no deploy-native.sh"
    [ "$(jq -r '.git_sha // empty' "$staging/tree/RELEASE.json" 2>/dev/null)" = "$git_sha" ] ||
        fail 20 "the artifact's RELEASE.json is not for $git_sha"
    printf '%s\n' "$artifact_sha" >"$staging/tree/ARTIFACT_SHA256"
    chmod -R go-w "$staging/tree"
    chmod 0755 "$staging/tree"
    if [ -e "$release_dir" ]; then
        # A failed earlier attempt (never current, checked above): replace it.
        mv -T "$release_dir" "$staging/old"
    fi
    mv -T "$staging/tree" "$release_dir"
    rm -rf "$staging"
    trap - EXIT
fi

args=(--git-sha "$git_sha" --artifact-sha256 "$artifact_sha" --commit-epoch "$epoch")
[ -z "$run_url" ] || args+=(--run-url "$run_url")
[ "${LAI_REQ_ALLOW_OLDER:-false}" != true ] || args+=(--allow-older)
[ "${LAI_REQ_ALLOW_DESTRUCTIVE:-false}" != true ] || args+=(--allow-destructive-migrations)
exec bash "$release_dir/scripts/aws/native/deploy-native.sh" "${args[@]}"
