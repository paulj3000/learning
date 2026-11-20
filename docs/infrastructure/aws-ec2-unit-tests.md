# EC2 unit tests for integration branches

Status: implemented on `ci/aws-integration-tests` (2026-11-20); live validation pending (see
"Activation"). Owner: the integration agent. Workflow:
[`.github/workflows/aws-integration-tests.yml`](../../.github/workflows/aws-integration-tests.yml).

The integration agent submits one exact commit to the shared CI instance, waits, and gets a
machine-readable verdict it can gate a merge on, without the AWS Console. The instance is a
dedicated Ubuntu 24.04 EC2 instance with PostgreSQL 16 (`lai-ci-ubuntu`, `us-west-1`), reached
only through SSM. The GitHub job authenticates with OIDC, so no AWS key is stored anywhere.

These are **unit tests** (testing-policy.md section 1), not the merge-readiness gates: no
Playwright, browser, end-to-end, acceptance, Ruff, Prettier, oxlint, build or live AWS checks.
Those still run only when the owner authorizes merge readiness.

## How it works

```text
integration agent                     GitHub Actions (ubuntu-24.04)               EC2 lai-ci-ubuntu
scripts/ci/aws_ci.py run              aws-integration-tests.yml                   (SSM only; no SSH)
  commit is clean and pushed
  gh workflow run -f commit_sha ...  -> validate SHA is on the branch
  find run by [request_id]              OIDC -> LAI-GitHub-CI-Runner role
  watch until completed                 start (must be stopped)            -> boot
                                        wait for SSM, take the lock        -> mkdir /run/lai-ci/lock
                                        send-command: fetch + run          -> git fetch <sha> (HTTPS)
                                                                              plan, install, run suites
                                                                              as user lai-ci
                                        copy results (chunks, sha256)      <- results.json, logs, JUnit
                                        cancel, unlock, stop (always)      -> stopped
  gh run download artifact          <-  verify verdict, upload artifact
  gate: MERGE-OK or BLOCKED             fail the job unless pass
```

- **Exact source.** The instance fetches the requested SHA from GitHub over HTTPS into a bare
  cache and extracts that commit's tree; `git` verifies the content against the SHA. The tested
  tree SHA is recorded and compared with the tree GitHub computed for the commit. The working
  tree on a development machine is never sent.
- **Harness.** The test runner (`scripts/ci/*.py`) comes from the dispatched branch's head, the
  same commit the workflow file comes from; the tested source is the requested SHA, which must be
  on that branch.
- **Planning.** `scripts/ci/plan_tests.py` turns `git diff --name-only <merge-base with main>
  <sha>` into suites (below).
- **Isolation.** Tests run as the unprivileged `lai-ci` user with a clean environment, no AWS
  configuration (`AWS_CONFIG_FILE=/dev/null`, `AWS_EC2_METADATA_DISABLED=true`), and an iptables
  rule rejecting the instance metadata service for that user, so no test can use the instance's
  role. PostgreSQL must listen on loopback only (checked every run; never changed by the
  workflow). Each run sets a fresh random password on the `lai_ci` role and clears it afterwards.
- **Fail closed.** `results.json` is written whatever happens. The verdict is recomputed from the
  suites by `scripts/ci/ci_results.py`: `pass` only when every planned suite ran and passed with
  a JUnit report; a missing tool, failed install, crash, timeout, empty run, wrong SHA or missing
  file is `incomplete`, which blocks a merge like a failure does.

## Scopes

| Scope | Suites |
|---|---|
| `full-unit` | `django-migrations` (`makemigrations --check`), `django` (all of `lai/` on PostgreSQL 16), `python-repo` (`tests/`), `engine` (`game/` Vitest), `react` (all of `react/` Vitest, including `server/` and `infra/` tests) |
| `affected` (default) | Only what the change reaches: changed Django apps plus the apps that import them or depend on their migrations, always with the authorization, authentication and privacy-logging tests; Vitest `related` for changed TypeScript; the engine when `game/` changes; `realm-compat-react` and `realm-compat-django` (Storykeeper, Treasure Rush, Pirate's Leap and content compatibility tests) when shared engine, realm or region code changes; `python-repo` when scripts, CI, deploy or `tests/` change |

`affected` widens to the full suite for an area when it cannot be precise: settings, requirements
or `pyproject.toml` (Django full); the lockfile, `package.json`, Vite or TypeScript configuration
(engine and React full); a deleted TypeScript file (React full); exported content (Django and
React full); and any path it cannot classify (everything full). A documentation-only change runs
`python-repo` so the plan is never empty. The plan, with its reasons and the suites it did not
plan, is in `results.json`. Use `full-unit` for the final check of an integration branch before
asking for a merge.

## Commands for the integration agent

One-time per workstation: install the GitHub CLI and sign in (`gh auth login`, scopes `repo` and
`workflow`).

```bash
# On the integration branch, with everything committed:
python3 scripts/ci/aws_ci.py run --scope affected --push      # submit, watch, fetch, gate
python3 scripts/ci/aws_ci.py run --scope full-unit            # the final check before a merge

# The same in steps:
python3 scripts/ci/aws_ci.py submit --scope affected --push   # prints the request id and run URL
python3 scripts/ci/aws_ci.py watch  [REQUEST_ID]              # until the run completes
python3 scripts/ci/aws_ci.py fetch  [REQUEST_ID]              # downloads the results artifact
python3 scripts/ci/aws_ci.py gate   [REQUEST_ID]              # the merge decision
python3 scripts/ci/aws_ci.py list                             # every recorded request
```

`REQUEST_ID` defaults to the newest request for the current branch. Records, the downloaded
artifact, `decision.json` and `report.txt` are kept in `<git common dir>/lai-ci/<request id>/`,
shared by every worktree and never committed. Every record and report names the tested commit and
tree.

`submit` refuses uncommitted changes (only committed source is tested), a branch that is not
`integration/*`, `ci/*` or `main`, and an unpushed HEAD unless `--push` is given. It finds its
run by the `[request id]` the workflow puts in the run name, so concurrent dispatches never get
each other's results.

### Monitoring and reports without the script

- The run: GitHub, Actions, "AWS Integration Unit Tests"; its name carries the scope, SHA and
  request id. The job summary has the request, the suite table and failure excerpts.
- `gh run list --workflow aws-integration-tests.yml`, `gh run watch <id>`,
  `gh run download <id> --name lai-ci-results-<request id>`.
- The artifact (kept 30 days): `request.json` (what was asked), `infra.json` (instance start,
  lock, SSM status, stop), `verdict.json`, `rejected.txt` when the request was invalid, and
  `results/` with `results.json`, `plan.json`, `changed-files.txt`, every suite's log and JUnit
  report. When the full logs are over 4 MB encoded, the artifact holds the last 300 lines of each
  log instead.

## The merge gate

`aws_ci.py gate` (and `run`) exits with the decision:

| Exit | Decision | Meaning |
|---|---|---|
| 0 | MERGE-OK | The run succeeded, `results.json` verifies for the requested SHA, scope and tree, every planned suite passed, and the branch still points at the tested source |
| 1 | BLOCKED, failed | One or more tests failed |
| 2 | BLOCKED, incomplete | Results missing or invalid, a suite blocked, errored or timed out, the run was cancelled, timed out or failed for infrastructure reasons |
| 3 | BLOCKED, stale | The branch moved after the test to a commit with a different tree; test again |
| 4 | Error | `gh` or `git` missing or failing; no decision |

A passing result belongs to one tree. Any later commit that changes the source invalidates it
(STALE); a commit with an identical tree (for example a merge that changes nothing) keeps it. Only
MERGE-OK satisfies the unit-test part of "Before asking for a merge"
([integration-policy.md](../engineering/integration-policy.md)); the owner's merge-readiness gates
and approvals are still separate.

## When tests fail: assigning and rerunning

1. `report.txt` lists each failing test with its file, the last commit that touched that file on
   the tested commit (`git log -1`), and an excerpt. That commit's branch identifies the owning
   development agent; confirm against the Trello card and the integration plan before routing.
2. Send the owner the failing test ids, the tested SHA, the run URL and the excerpt. Never
   suppress, skip, re-expect or loosen a test, and never raise a timeout to make it pass.
3. The owner fixes the defect on their own branch and records Development Complete with the fix
   SHA. The integration agent merges that SHA into the integration branch, then reruns
   `aws_ci.py run`. A rerun is always a new request for a new SHA; earlier results never carry
   over.
4. A `blocked` or `incomplete` result is an infrastructure problem, not a test result: report it
   separately (AGENTS.md section 6) and fix it before reading anything into the tests.

## Instance ownership and locking

- The job starts the instance only if it is `stopped` (it waits out `stopping`). Any other state
  means another job, from this or another repository, may be using it: the job fails with exit
  code 4 and does not touch the instance.
- Within this repository, the `lai-ci-ec2-instance` concurrency group queues runs. GitHub keeps
  one pending run per group and cancels an older pending one when a newer one queues; `gate`
  reports that as incomplete, and the agent submits again.
- On the instance, `mkdir /run/lai-ci/lock` is the lock (atomic; `/run` is cleared when the
  instance stops). The runner refuses to start unless it holds it. A job that finds it held fails
  and never stops the instance.
- Cleanup steps run on success, failure, timeout and cancellation: cancel the SSM command, copy
  what results exist, release the lock, stop the instance. The job stops the instance only if it
  started it and the lock is not held by another job.
- Cross-repository locking: until a shared lock service exists, other repositories' jobs are
  rejected by the state check and the lock, not queued.
- The instance's independent four-hour shutdown protection is unchanged and remains the backstop.
  The job's own limit is 225 minutes, the test step 170, the remote budget 150.

## Activation and configuration

| Item | Status |
|---|---|
| Workflow on the default branch | **Required.** GitHub only dispatches `workflow_dispatch` workflows that exist on `main`; merge this branch (owner approval) before the first dispatch |
| `gh` on the integration workstation | Install and `gh auth login` |
| Environment `lai-ci` variables | `AWS_REGION`, `LAI_CI_ROLE_ARN`, `LAI_CI_INSTANCE_ID` (already used by the smoke test). Required reviewers on the environment make every run wait for approval; `watch` reports "waiting" |
| Role `LAI-GitHub-CI-Runner` | As for the smoke test: `ec2:DescribeInstances`, `ec2:StartInstances`, `ec2:StopInstances`, `ssm:SendCommand` (the instance and `AWS-RunShellScript`), `ssm:GetCommandInvocation`, `ssm:DescribeInstanceInformation`. **Add `ssm:CancelCommand`** (owner approval); without it a cancelled job still stops the instance, which ends the run. No S3 access is needed |
| OIDC trust | The subject (`repo:<owner>/<repo>:environment:lai-ci`) is the same as the smoke test's. If the trust policy also pins `job_workflow_ref` (the smoke-test file) or `ref` (`main` only), add this workflow and the `integration/*` and `ci/*` branches (owner approval); otherwise credentials fail at the first step |
| Branches | The dispatched branch must be `main`, `integration/*` or `ci/*`; the requested SHA must be on it |
| Repository visibility | The instance fetches the source anonymously over HTTPS, which works while the repository is public. If it becomes private, source transfer needs an approved change (an S3 bucket the role writes and the instance reads, or a read-only deploy key on the instance) |
| Instance egress | HTTPS to `github.com`, `nodejs.org` (Node 22.23.5, checksum-pinned in `remote_runner.py`), `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org` |
| Instance software | Ubuntu 24.04, PostgreSQL 16 on loopback port 5432, the SSM agent, `iptables`. The runner installs `git` and `python3-venv` from Ubuntu if missing, Node under `/opt/lai-ci`, and creates the `lai-ci` user; caches live in `/var/lib/lai-ci` |
| Instance role | Only what SSM needs (`AmazonSSMManagedInstanceCore`); tests cannot reach it anyway |

## Troubleshooting

**The job says the instance is not stopped (exit 4).** Another job may be running: check this
repository's Actions and any other repository using the instance. If none is, the instance was
left running (an interrupted job, or a manual start): wait for the four-hour guard, or stop it
after confirming no job is active (`aws ec2 stop-instances --instance-ids <id>`, owner or
operator), then submit again.

**SSM does not come online (exit 3 at "Wait for SSM").** The instance started but its agent did
not register within ten minutes. The job still stops the instance. Check, as an operator, the
instance's system log (`aws ec2 get-console-output`), that the instance profile still has
`AmazonSSMManagedInstanceCore`, and that the instance can reach the SSM endpoints. Resubmit once
fixed.

**The remote run ended Failed, TimedOut or Undeliverable.** The log tail is in the step output;
`infra.json` has the SSM status and exit code. Exit code 3 from the runner means it could not
write results (disk full, unwritable `/var/lib/lai-ci`). TimedOut means the run exceeded its SSM
limit (160 minutes); the runner's own 150-minute budget normally marks remaining suites
`timed_out` first, so check the instance size or split the work with `affected`.

**Results could not be copied back.** The checksum or size did not match, or `collect.json` is
missing. The verdict is `incomplete`; resubmit. Repeated failures point at the instance's disk or
at SSM throttling.

**A suite is `blocked`.** `results.json` names the preflight check that failed (Node download,
`npm ci`, Python dependencies, PostgreSQL not running or not on loopback, iptables missing, disk
under 5 GB, lock). Fix the instance or the network, then resubmit; nothing about the tests can be
concluded from a blocked run.

**The instance does not stop.** The "Stop EC2" step fails with exit 5 and the job fails even if
the tests passed. Then:
1. `aws ec2 describe-instances --instance-ids <id> --query 'Reservations[0].Instances[0].State'`.
2. If it is `stopping` for more than ten minutes, wait; then, as an operator,
   `aws ec2 stop-instances --force --instance-ids <id>` (a forced stop loses nothing the CI
   needs; caches are rebuilt).
3. If stop calls are denied, the role lost `ec2:StopInstances`; restore it (owner approval).
4. The four-hour guard stops the instance regardless; never disable it.
Record the incident on the integration card.

**The lock is held but no job is running.** The lock lives in `/run`, so stopping the instance
clears it. If the instance is running with a stale lock and you have confirmed no job is active,
stop the instance; do not delete the lock on a running instance another job may own.

## Files

| File | Role |
|---|---|
| `.github/workflows/aws-integration-tests.yml` | The workflow: validation, OIDC, instance lifecycle, verdict, artifact |
| `scripts/ci/ec2_ci.sh` | Runner-side steps: start, SSM wait, lock, run, collect, cancel, unlock, stop |
| `scripts/ci/remote_runner.py` | On the instance: preflight, source, dependencies, database, suites, results |
| `scripts/ci/plan_tests.py` | Which suites a change needs |
| `scripts/ci/ci_results.py` | Results schema, verdict and `verify` |
| `scripts/ci/aws_ci.py` | The integration agent's command |
| `tests/repo/test_ci_*.py`, `tests/repo/ci_fake_aws.py` | Unit tests with fake `aws`, `gh` and `git` |
| `.github/workflows/aws-ec2-smoke-test.yml` | The independent smoke test, unchanged |
