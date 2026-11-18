# IAM Role Audit

Status: **Repository and synthesized-template evidence. No deployed IAM data was queried.**
The AWS CLI was not available to the session that wrote this, so no account-wide role count
is claimed. See `docs/CURRENT_AWS_RESOURCE_INVENTORY.md` and `docs/DJANGO_MIGRATION_ASSESSMENT.md`.

## 1. Framing

The IAM Roles quota (default 1,000 per account) is shared by every project in the account. The
quota can be raised, so this audit treats role count as **one input**, not a reason on its own.

Evidence classes:

- **repository evidence**: what `infra/**` declares.
- **synthesized evidence**: `npm run infra:synth` output, counted from `AWS::IAM::Role` resources.
- **deployed evidence**: none collected.

## 2. Roles defined in the repository (`infra/`)

Measured in `infra/` (synthesized, not deployed): `LaiAssetStorage-<env>` creates **0 roles**
and 1 customer-managed policy, attached to the Django instance role; it is bootstrapless, so no
`cdk bootstrap` roles either (`docs/ASSET_LIBRARY.md` section 12). The EC2 release pipeline
(ADR-037) adds **3 roles**: `lai-github-image-publisher` (account-wide, in `LaiDjangoRelease`),
and per environment `lai-django-ec2-<env>` (instance role) and `lai-github-deploy-<env>` (GitHub
OIDC), in `LaiDjangoEc2-<env>`. So 5 for dev and prod together, with no custom-resource roles.

Added 2026-10-31 (ADR-042, synthesized, not deployed): `LaiChildPhotos-<env>` creates **0 roles**
and 1 customer-managed policy, `lai-django-child-photos-<env>`. It allows `s3:GetObject`,
`s3:PutObject` and `s3:DeleteObject` on `children/*`, and `s3:ListBucket` only with the
`children/` prefix condition. It has no version, ACL or bucket-configuration rights, and the
instance role `lai-django-ec2-<env>` attaches it. The two Django storage policies are disjoint: the
asset policy reaches only `assets/models/*` in the asset bucket, the photo policy only
`children/*` in the photo bucket. The role total is unchanged at 5 for dev and prod together.

`LaiFrontend-<env>` adds the site deploy role `lai-github-site-deploy-<env>`
(`docs/infrastructure/resource-ownership.md` section 3.5). Later stacks (the dev platform of
ADR-055, background Lambda workers) add their own roles; count them from a fresh synth.

## 3. Retained roles

The retained stacks from the retired backend (the Cognito pool's stack, and the stacks holding the
retained legacy DynamoDB tables and S3 buckets) still hold the roles they generated. They are not
counted here and are not changed or deleted without separate owner approval.

## 4. How the role count grows

1. **Per data model: none.** A relational database behind Django has zero per-entity roles; a new
   model or content row adds no role.
2. **Per environment.** Each CDK stage (`dev`, `prod`) has its own instance and deploy roles.
3. **Per background worker.** Each Lambda worker adds an execution role.
4. **Not counted here:** CDK bootstrap roles and roles from other projects in the account.

## 5. Read-only queries to obtain deployed evidence

Run with an authenticated, read-only profile. None of these modify anything.

```text
aws iam get-account-summary --query 'SummaryMap.{Roles:Roles,RolesQuota:RolesQuota}'
aws iam list-roles --query 'Roles[?contains(RoleName, `learningadventureisland`)].RoleName' --output text | wc -w
aws iam list-roles --query 'Roles[?starts_with(RoleName, `lai-`)].RoleName' --output text | wc -w
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[].StackName'
```

Record the results in this file under a new section "Deployed evidence" with the date, account
alias (not account id), and region.

## 6. Recommendation

- Request the quota increase if the account is near the limit. It is cheap and independent of
  any other work.
- Keep this audit's counts as a baseline to compare after each new stack.
