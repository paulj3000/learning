# Deployed RDS: PostgreSQL 16 to 18 upgrade plan

Date: 2026-11-22. Trello: GE-090 (https://trello.com/c/mEaWzcTo) and GE-090-D4
(https://trello.com/c/veRz2I9a). Status: **Plan only, not approved for execution.** No AWS
resource, CDK definition, workflow or database was changed. This plan is separate from the Game
Engine 1.0 acceptance work, which does not upgrade RDS (owner decision, 2026-11-22).

## 1. Why

The owner set PostgreSQL 18 as the project standard on 2026-11-21. Development, CI and tests now
use 18:

- local `docker-compose.yml` uses `postgres:18-alpine`;
- the GitHub `ci.yml` service uses `postgres:18-alpine`;
- the EC2 CI runner checks for 18 only (`server_version_num 180006`);
- `lai/apps/core/tests/test_settings.py` asserts major version 18.

The deployed databases are still defined as PostgreSQL 16. Until they are upgraded, the code is
tested on a newer major version than the one it runs on. The full Django suite passed on 18.6
(EC2 run 44987002728) with no compatibility change to the code. Nothing in the application
depends on an 18-only feature, so running on 16 is safe for now. The gap is a test-coverage gap,
not a known defect.

## 2. What is still on PostgreSQL 16

| Definition | File | What it is |
|---|---|---|
| Django EC2 platform RDS | `infra/lib/djangoEc2Stack.ts` (`DatabaseInstance` engine and its `ParameterGroup`, both `PostgresEngineVersion.VER_16`) | `lai-django-<env>`, with deletion protection and a snapshot removal policy |
| DEV platform RDS | `infra/lib/devPlatformStack.ts` (`engine` constant, `VER_16`) | `DEV_DATABASE_ID` |
| DEV container mode database | `deploy/ec2/docker-compose.yml` (`postgres:16-alpine`) | on a retained EBS data volume |
| Native host client | `scripts/aws/native/setup-native.sh` (`postgresql16` client package) | `psql` and `pg_dump` on the DEV host; no server |
| Tests pinning the above | `infra/lib/devPlatformStack.test.ts`, `tests/deploy/test_native_static.py` | |

**Deployed versions were not verified live for this plan.** The local credentials have no RDS
read access. Before execution, record the exact engine version of each instance (for example
`aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,EngineVersion]'`
with an authorized role).

## 3. Approach

These are in-place major version upgrades through CloudFormation, one environment at a time,
DEV first. Each step needs its own owner approval.

1. **Pre-checks (read-only):**
   - record the exact engine versions;
   - list installed extensions (`SELECT extname, extversion FROM pg_extension`) and check each
     against the RDS PostgreSQL 18 supported list;
   - confirm the target 18 minor version is offered in the region
     (`aws rds describe-db-engine-versions --engine postgres --engine-version 18`);
   - confirm a valid upgrade target from the current 16 minor version
     (`describe-db-engine-versions --engine-version <16.x> --query '..ValidUpgradeTarget'`);
   - confirm the CDK version in use has a PostgreSQL 18 constant (`aws-cdk-lib` 2.263.0 is
     pinned) and pick the explicit minor version constant. Do not use a floating major.
2. **Rehearsal:**
   - restore the latest DEV snapshot to a temporary instance;
   - upgrade it to 18;
   - run `manage.py migrate --check` and the Django suite (or the release smoke tests) against
     it;
   - measure downtime;
   - delete the temporary instance afterwards.
3. **CDK change** (a branch and PR, reviewed, no deploy):
   - a new `ParameterGroup` for the 18 family (a parameter group cannot change family). It
     keeps `rds.force_ssl=1`;
   - `allowMajorVersionUpgrade: true` on each `DatabaseInstance`;
   - the engine version set to the chosen 18 minor in both stacks;
   - update the stack tests. `cdk diff` must show an in-place modify, not a replacement.
4. **DEV execution** (owner-approved window):
   - take a manual snapshot first (the stacks already use `RemovalPolicy.SNAPSHOT` and deletion
     protection);
   - deploy;
   - after the upgrade, run `ANALYZE` on every database, because RDS does not carry planner
     statistics across a major upgrade;
   - run the DEV acceptance checks (`docs/infrastructure/dev-acceptance.md`).
5. **DEV container mode and host client:**
   - move `deploy/ec2/docker-compose.yml` to a new `postgres:18-alpine` volume. The 18 image
     cannot open 16 data, so this needs a `pg_dump`/`pg_restore` or `pg_upgrade` from the
     retained volume, which is kept and not deleted;
   - change the native client package to the 18 client;
   - update `tests/deploy/test_native_static.py`.
6. **Production** (if and when provisioned): the same steps, after DEV has run on 18 without
   incident for an agreed period.

## 4. Rollback

A major version upgrade cannot be reversed in place. Rollback means restoring the pre-upgrade
manual snapshot to a 16 instance and repointing the stack. That loses any writes made after the
snapshot, so the DEV window must accept that, and production would need a write freeze. Keep the
snapshot until the owner signs off on 18.

## 5. Risks

- **Downtime:** an RDS major upgrade takes the instance offline. The rehearsal measures how
  long.
- **Extensions:** any extension without an 18 build blocks the upgrade, so the pre-check is
  required.
- **Parameter group family change:** if it is done wrongly, CloudFormation replaces the
  instance. The `cdk diff` review must show modify, not replace.
- **Planner statistics:** reset by the upgrade. `ANALYZE` must run immediately afterwards.
- **Client tools:** a `pg_dump` older than the server refuses to run, so the host client
  changes in the same window.

## 6. Owner decisions needed

1. Approve the read-only pre-checks with an authorized role.
2. Approve the snapshot rehearsal (it creates and deletes a temporary RDS instance).
3. Review and approve the CDK PR.
4. Choose the DEV upgrade window and approve the deploy.
5. Decide how long DEV must run on 18 before any production upgrade.
