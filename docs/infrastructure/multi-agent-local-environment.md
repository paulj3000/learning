# Multi-agent local development environment

- **Status:** Guidance
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-072
- **Related tickets:** LAI-ENG-002
- **Canonical sources:** [multi-agent-workflow](../engineering/multi-agent-workflow.md) (claiming, locking, handoff, recovery), [branch-policy](../engineering/branch-policy.md) (names, worktrees), [integration-policy](../engineering/integration-policy.md#coordination-required) (hotspots), [TESTING_STRATEGY](../TESTING_STRATEGY.md) (check cadence)

This page is the operating detail for running several agents on one machine at once. The
policies linked above decide who may change what. This page covers how each agent's worktree
gets its own ports, databases and dependencies so concurrent sessions do not break each other.

## 1. Worktree isolation

- One agent, one worktree, one branch ([branch-policy](../engineering/branch-policy.md#worktrees)).
  New worktrees are siblings under `/Coding/learning-worktrees/`.
- Worktrees share the `.git` object store, refs, hooks configuration and **the stash stack**.
  Never use bare `git stash` or `git stash pop`: another session can pop your entry. Set work
  aside with a WIP commit on your own branch.
- Read another branch with `git show origin/<branch>:<path>` or `git diff origin/main...origin/<branch>`.
  Never `cd` into another agent's worktree to edit, reset, check out or clean. Never read its
  `.env` (it can hold credentials).
- `git fetch` is safe from any worktree. `git gc`, `git prune`, `git worktree prune` and
  `git worktree remove` affect every session: owner only.

## 2. Development slots

Without a slot, every worktree uses PostgreSQL 5442, Django 8010, Vite 5183 and the database
`lai`. pytest-django drops and recreates `test_lai` at the start of each run, so two agents
running database tests at the same time destroy each other's test database. A slot gives a
worktree its own values. Slot 0 is the owner's main checkout and keeps the defaults.

| Slot | Worktree (2026-11-18) | PostgreSQL | Django | Vite | e2e Django | e2e Vite | Multiplayer | Database / pytest database |
|---|---|---|---|---|---|---|---|---|
| 0 | `/Coding/learning` (owner) | 5442 | 8010 | 5183 | 8765 | 5175 | 2567 | `lai` / `test_lai` |
| 1 | `treasure-rush` | 5451 | 8020 | 5193 | 8775 | 5185 | 2568 | `lai_treasure_rush` |
| 2 | `storybook` | 5452 | 8030 | 5203 | 8785 | 5195 | 2569 | `lai_storybook` |
| 3 | `firepeak` | 5453 | 8040 | 5213 | 8795 | 5205 | 2570 | `lai_firepeak` |
| 4 | `gameengine` | 5454 | 8050 | 5223 | 8805 | 5215 | 2571 | `lai_gameengine` |
| 5 | `scoring` | 5455 | 8060 | 5233 | 8815 | 5225 | 2572 | `lai_scoring` |
| 6 | `integration` | 5456 | 8070 | 5243 | 8825 | 5235 | 2573 | `lai_integration` |
| 7 | `northpole` | 5457 | 8080 | 5253 | 8835 | 5245 | 2574 | `lai_northpole` |
| 8 | `wt-integration-20261119-game-engine-core` (GE-090 integration) | 5458 | 8090 | 5263 | 8845 | 5255 | 2575 | `lai_integration_20261119_game_engine_core` |
| 9 | next worktree to run servers or database tests | 5459 | 8100 | 5273 | 8855 | 5265 | 2576 | `lai_<worktree>` |

The pytest database is always `test_` plus the database name. Slot numbers name worktrees, not
agents: a new agent in an existing worktree keeps that worktree's slot. When a slot is
reassigned, record it on the ticket and in this table.

### 2.1 Setting a slot (each agent, in its own worktree)

```bash
python3 scripts/dev/agent_slot.py show --slot 4    # inspect
python3 scripts/dev/agent_slot.py write --slot 4   # write into ./.env
make agent-check                                   # preflight
```

`write` creates `.env` when it is missing. Otherwise it replaces only the lines it manages, under
a marker comment, and keeps every other line (secrets, Cognito ids) untouched. `.env` is
git-ignored. `make agent-check` fails on `main` and warns about a missing slot, busy ports and
missing `node_modules` or `.venv`. A busy port is a warning: the server may be your own.

### 2.2 How each tool picks the slot up

| Tool | Reads | Notes |
|---|---|---|
| `pytest <path>` (direct, as the testing policy asks) | `POSTGRES_PORT`, `POSTGRES_DB` from a `.env` that has `LAI_AGENT_SLOT` (`lai/config/settings/test.py`) | Loopback only. A value in the shell wins. No other `.env` value reaches tests |
| `make py-test`, `make migrate`, `make runserver`, `make up` | `.env` through the Makefile and compose | `make up` starts this worktree's own container (compose project = directory name) on its port, with its own volume |
| `make web` | `DJANGO_DEV_PORT`, `VITE_DEV_PORT` from `.env` | Plain `npm run dev` still defaults Vite to 5183; use `make web`, or export `VITE_DEV_PORT` |
| Playwright acceptance, multiplayer server | `LAI_E2E_*`, `MP_PORT` from the shell | Run `set -a; . ./.env; set +a` first. Only at authorized merge readiness |

The database named by `POSTGRES_DB` is created when the container first starts with that value.
A worktree that already has a container from before its slot keeps its old data volume. Run
`make down` and `make up` once after setting the slot (your own container only), or create the
database inside your own container. pytest does not need it: Django creates `test_<name>` itself.

## 3. Isolated test databases: rules

- Database tests (`postgres` marker) run against your slot's container only. They skip when it is
  down unless `LAI_REQUIRE_POSTGRES=1` (`make py-test-db`).
- Never pass `--create-db` against another slot's port, never point `POSTGRES_PORT` at another
  worktree's container, and never run `make down` in a worktree you do not own.
- The Playwright acceptance stack always uses `lai_e2e` and fixed preview port 4173 (blocker B9 in
  [engineering-infrastructure](engineering-infrastructure.md#5-known-blockers)). Only one agent runs
  it at a time, and only when the owner authorizes merge readiness.

## 4. Environment configuration

- Local settings come from the untracked root `.env` (template `.env.sample`). Deployed
  environments never read `.env`.
- No secrets in the repository, Trello or handoffs ([security-policy](../engineering/security-policy.md)).
  `agent_slot.py` writes only ports, database names and the slot number.
- Tests never call AWS: `config.settings.test` forces the fake AI and speech providers and memory
  storage, whatever `.env` says.
- `AWS_PROFILE=learning-dev` is the default only for `make runserver`. Live AWS calls need owner
  authorization for that action.

## 5. Dependency installation

| Step | Command | Rule |
|---|---|---|
| Node | `npm ci` in the worktree root | Installs from `package-lock.json` exactly. Never `npm install <pkg>` without an approved dependency change (stop-and-ask hotspot) |
| Python | `make py-install` | Creates `.venv` from pinned `requirements-dev.txt` |
| Playwright browsers | `npx playwright install chromium` | Only for authorized acceptance runs |

Each worktree installs its own `node_modules` and `.venv`; never symlink or reuse another
worktree's. A lockfile change is regenerated with npm on the owning branch and listed under
`shared_components` on the ticket.

## 6. Concurrent testing and resource management

The host has 4 cores and 8 GB. On 2026-11-19 five agents' suites plus a system update drove the
1-minute load to 11 to 13. Under that load jsdom tests passed Vitest's 5 s timeout. A different
test failed each run, and one timeout in `treasureRushAudio.test.tsx` cascaded into about 37
failures ([defect](https://trello.com/c/9OdaKlbs)). The fix is to stop overloading the host, not
to raise timeouts or skip tests. Test-file isolation bugs (leaked timers and async work) are
fixed by the file's owner; this section covers the host side.

| Control | What it does | Where |
|---|---|---|
| Admission gate | At most 2 suites (cores / 2) run at once across all worktrees. `--full` (a whole suite) takes both slots, so full suites never overlap. Slots are `flock`s, released by the kernel when the process exits, even after a crash | `scripts/dev/test_gate.py`, state in `~/.local/state/lai/` |
| Worker limit | The gate passes `--maxWorkers` = cores / slots (2 here; 1 when it had to start under pressure), capped at one worker per 1 GB of available memory (`--mem-per-worker-mb`). Without the gate, `react/vite.config.ts` defaults to 2 instead of one per core (`LAI_TEST_MAX_WORKERS` overrides) | gate; `react/vite.config.ts` |
| Pressure wait | A run waits while load is over 1.5 x cores, CPU pressure (Linux PSI `some avg10`, the share of the last 10 s that tasks waited for a CPU) is over 25% (lowered from 50% after jsdom suites failed at a 40% peak and passed at 9% or less in matched runs), memory pressure (PSI) is over 10%, I/O pressure over 30%, or available memory is under 1 GB. The host pages: on 2026-11-19 about 1 GB of swap was in use, with 1.6 GB swapped in since boot, and a swapped-out jsdom worker stalls tests at low CPU pressure (found by the Treasure Rush lead). The 1-minute load average alone also hides short bursts: on 2026-11-19 a burst stalled parity tests 10 to 30 times on `main` and the engine tree alike while load read about 5. After `--max-wait` (15 min) it starts with one worker and says so | gate |
| Monitoring | Load, CPU, memory and I/O pressure, megabytes swapped in and major page faults during the run (disk reads, including page-cache misses that swap counters miss), available memory, process-tree CPU and peak RSS are sampled (from the first second) every 2 s and logged per run as one JSON line (no output, no environment values, no child data). `make test-gate-status` shows slot holders and recent runs | gate |
| Infrastructure reporting | A run killed by a signal (SIGKILL usually means out of memory) is labelled INFRASTRUCTURE; report it separately and rerun only the affected files | gate |
| Paging notice | A failed run that swapped in 50 MB or more, or stalled on memory, prints a PAGING notice: confirm a timeout with a matched comparison before calling it a test bug or a pass. It is not a waiver and does not label the run INFRASTRUCTURE | gate |
| Timeouts | Unchanged. A test that needs more than 5 s under a gated run has a bug or a real performance problem | policy |

```bash
python3 scripts/dev/test_gate.py -- npx vitest run src/features/region-play/audio   # by path
python3 scripts/dev/test_gate.py -- .venv/bin/python -m pytest -q lai/apps/scoring  # pytest
python3 scripts/dev/test_gate.py --full -- npm test                                # whole suite, alone
make test-gate-status
```

Until this branch is on `main`, a worktree can call the gate by absolute path
(`/Coding/learning-worktrees/integration/scripts/dev/test_gate.py`). The slots are host-wide, so
it works from any worktree.

Shared-cache review (2026-11-19). Nothing found needs a change:

| Cache or shared state | Scope | Safe for concurrent agents? |
|---|---|---|
| Vitest and Vite caches (`node_modules/.vite`), TypeScript build info (`node_modules/.tmp`) | Per worktree | Yes |
| `node_modules`, `.venv` | Per worktree (about 633 MB of `node_modules` each) | Yes, when each worktree has its own. **Borrowed `node_modules` is not safe** (see below) |
| Test temporary files | Tests use `mkdtemp` / `tmp_path`; no fixed `/tmp` paths found in `react/src`, `game/src`, `tests`, `lai`, `server`, `infra` | Yes |
| pytest `tmp_path` base (`/tmp/pytest-of-<user>`) | Per user | Yes: pytest locks numbered directories before cleanup |
| pytest cache | Disabled (`-p no:cacheprovider`) | Yes |
| npm cache (`~/.npm`), pip cache, Playwright browsers (`~/.cache/ms-playwright`) | Per user | Yes (content-addressed or read-only at test time) |
| PostgreSQL | Per worktree container and volume, per-slot port and database | Yes, with a slot |
| Docker | Compose project per worktree directory | Yes; never prune or remove another project's containers or volumes |
| git stash | **Shared by every worktree** | No: never use bare `git stash`; use a WIP commit |

**Disk.** `/Coding` is 30 GB. With about ten full worktrees (633 MB of `node_modules` each, plus
`.venv`, PostgreSQL volumes and build output) it reached 99% on 2026-11-19, and `npm install`
failed with ENOSPC. To keep working, some worktrees symlinked their `node_modules`, or every package
in it, into the Storykeeper install. That has two failure modes, which `make agent-check` now reports:

- an `npm ci` in the source worktree deletes the borrowed dependencies under the other worktree's
  running tests;
- if the lockfiles differ, the borrowing worktree tests against the wrong dependency versions. This
  was the case for `sc-final-d` against `storybook` on 2026-11-19.

Rules: run `npm ci` in your own worktree. If the disk is too full to do so, report it to the owner as
infrastructure instead of borrowing. Only the owner removes the `node_modules` of idle worktrees, or
deletes worktrees. A shared package store (for example pnpm) would remove the duplication, but it is
a new tool and needs an owner decision.

Other resource rules:

- Start PostgreSQL only when needed, and `make down` your own container when you stop.
- At most one `npm run build`, Playwright or acceptance run on the host at a time, only when
  authorized. Run them through `test_gate.py --full`.
- Host processes outside the project also take CPU. On 2026-11-19 `unattended-upgrade` held a
  core for over 100 minutes, and a GitHub Actions runner service is installed on this machine.
  Agents do not stop them; report them to the owner.
- Do not run `docker system prune`, `docker volume rm` or anything that removes another worktree's
  containers or volumes.

## 7. Conflict prevention

1. Before editing a hotspot ([integration-policy](../engineering/integration-policy.md#coordination-required)),
   check the open branches touching it, for example
   `git diff --name-only origin/main...origin/<branch> -- <path>` for each active branch. Record
   the planned change on your card.
2. Migrations: check the app's leaf on `main` **and** on every active branch before creating one.
   The current collisions are listed in the [integration plan](integration-plan-game-engine-core.md#3-django-migration-coordination).
3. ADR numbers: placeholder `ADR-NNN` until the number is reserved on `main`.
4. Status files (`docs/IMPLEMENTATION_STATUS.md`, `tasks/TASK_TRACKER.md`): append your own entry
   only.
5. Generated files (`content/exported/`, golden vectors): regenerate, never hand-merge.

## 8. Shared contract coordination

A contract (types, events, API shape, model and migration, ADR) is provided by one ticket and
consumed by others. The provider pushes it and records `contract frozen at <SHA>` on its card. A
consumer may start once the contract is pushed and frozen. A consumer that needs a change files it
on the provider's card and does not edit the contract itself
([multi-agent-workflow](../engineering/multi-agent-workflow.md#splitting-a-larger-feature-into-work-packages)).
Current contracts: scoring events and ledger (GE-100, `core/ge-scoring`), engine public interface
and `game/` package (GE-100 / LAI-2101, `core/gameengine`), shared movement, jump and collision
(Treasure Rush branch, ADR-063 reserved), puzzle kinds (Firepeak `fp/puzzle-kinds`).

## 9. Integration sequencing

Merge order, the integration branch and the checks are in the
[integration plan](integration-plan-game-engine-core.md). Agents do not merge each other's
branches into their own except as that plan and the integration policy allow (a dependency already
on `main`, or an integration branch named by the coordinator).

## 10. Agent handoff

Use [agent-handoff.md](../engineering/templates/agent-handoff.md) and add these environment facts:

```yaml
environment:
  slot: <n>
  postgres: <running | stopped> on <port>, database <name>
  servers_left_running: [<none | process and port>]
  node_modules: <installed at lockfile SHA | missing>
  venv: <installed | missing>
  uncommitted_work: <none | described; handed off only after it is committed and pushed>
```

Before handing off: stop your servers, `make down` your container unless the next agent continues
in the same worktree, and push everything.
