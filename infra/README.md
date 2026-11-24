# infra

The CDK app for the Django platform's AWS resources (`docs/DJANGO_MIGRATION_ROADMAP.md` Phase 10,
LAI-1001 layout). This is the only infrastructure code in the repository. Nothing here is deployed by a push.

| Stack                    | Scope                       | What                                                                                                                    | Doc                                             |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `LaiDevArtifacts-dev`    | dev                         | Release tarballs, Lambda zips, job results, template uploads (ADR-055)                                                  | `docs/infrastructure/dev-native-environment.md` |
| `LaiDevPlatform-dev`     | dev                         | Native EC2 (ARM64), Elastic IP, private RDS, SQS, Lambda, power state machine, schedules                                | `docs/infrastructure/dev-native-environment.md` |
| `LaiAssetStorage-<env>`  | environment                 | The asset library's private S3 bucket and the Django role policy                                                        | `docs/ASSET_LIBRARY.md` sections 12 and 19      |
| `LaiChildPhotos-<env>`   | environment                 | The private child photo bucket (separate from assets, ADR-042) and its Django policy                                    | `docs/platform/CHILD_PHOTO_STORAGE.md`          |
| `LaiAiGuardrail-<env>`   | environment                 | Child-safety Guardrail and the Django AI policy                                                                         | `docs/AI_SERVICE.md`                            |
| `LaiFrontend-<env>`      | environment                 | React site in us-east-1: private S3, CloudFront (OAC), `/api/*` to the API host                                         | `docs/infrastructure/domains-and-hosting.md`    |
| `LaiDjangoRelease`       | account, prod only          | ECR `lai/django`, the GitHub OIDC provider, the image publisher role                                                    | `docs/platform/DJANGO_EC2_DEPLOYMENT.md`        |
| `LaiDjangoEc2-prod`      | prod only                   | VPC, ALB (ACM, WAF), EC2, RDS, SSM settings and release documents, deploy role, alarms                                  | `docs/platform/DJANGO_EC2_DEPLOYMENT.md`        |
| (in `LaiDjangoEc2-prod`) | prod, flag `prodProcessing` | Processing queues, DLQs, workers, artifacts bucket, redrive and worker release roles, alarms, optional budget (ADR-071) | `docs/processing/PRODUCTION_PROCESSING.md`      |

`LAI_ENV=dev` (the default) synthesizes the native dev stacks and no longer synthesizes
`LaiDjangoEc2-dev` or `LaiDjangoRelease` (ADR-055). The dev environment is provisioned with
`scripts/aws/deploy-debug.sh --plan|--execute` (root `README.md`, "AWS Development
Infrastructure"). Dev deploy order: `LaiDevArtifacts-dev`, `LaiAssetStorage-dev`,
`LaiChildPhotos-dev`, `LaiDevPlatform-dev`, `LaiAiGuardrail-dev`, `LaiFrontend-dev` (us-east-1).

The production EC2 release pipeline (ADR-037) is provisioned with `scripts/aws/provision.sh <env>`, which
creates change sets and applies them only with `--execute`; its settings and parameters are in
the runbook's section 4.

## Synthesize (no AWS access needed)

```bash
npm run infra:synth                       # dev (all six dev templates), account and region as pseudo-parameters
npm run infra:synth:dev                   # the same, explicitly
npm run infra:synth:prod                  # prod, into infra/cdk.out/prod
```

The templates land in `infra/cdk.out/<stack>.template.json` (gitignored). The stacks use the
bootstrapless synthesizer: they have no file assets or custom resources, so no `cdk bootstrap` stack
(and its IAM roles) is needed. The dev Lambda workers take their code from the artifacts bucket
(`WorkerCodeKey`, built by `scripts/aws/package-lambda.sh`). The prod EC2 stack embeds
`scripts/aws/setup-ec2.sh` and `scripts/aws/ssm-release-entry.sh`, and the dev platform embeds
`scripts/aws/native/{setup-native,ssm-native-entry,power-native}.sh`, at synth time.

| Setting                                | CDK context           | Environment variable                        | Default                                         |
| -------------------------------------- | --------------------- | ------------------------------------------- | ----------------------------------------------- |
| Environment                            | `env`                 | `LAI_ENV`                                   | `dev`                                           |
| Another Django role to grant           | `djangoRoleArn`       | `LAI_DJANGO_ROLE_ARN`                       | none (the EC2 instance role attaches it itself) |
| Browser origins for presigned GETs     | `allowedOrigins`      | `LAI_ASSET_ALLOWED_ORIGINS`                 | none (right for `django` delivery)              |
| Origins that `fetch()` photo URLs      | `photoAllowedOrigins` | `LAI_PHOTO_ALLOWED_ORIGINS`                 | none (`<img>` and native clients need no CORS)  |
| Account and region baked into the name |                       | `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION` | pseudo-parameters                               |
| Production processing (ADR-071)        | `prodProcessing`      | `LAI_PROD_PROCESSING`                       | off (prod templates unchanged)                  |
| GLB optimize worker (dev and prod)     | `optimizeWorker`      | `LAI_OPTIMIZE_WORKER`                       | off (runtime undecided, ADR-070)                |
| Processing budget, USD per month       | `processingBudgetUsd` | `LAI_PROCESSING_BUDGET_USD`                 | **none**: no budget (owner decision P15)        |
| Worker memory/timeout overrides (JSON) | `processingSizing`    | `LAI_PROCESSING_SIZING`                     | the `WORKLOADS` table in `processingWorkers.ts` |

Production reads `prodProcessing`, `optimizeWorker`, `processingBudgetUsd` and `processingSizing`
from the committed `infra/config/prod-processing.json` only (review F3); a context value or
environment variable that disagrees with the file stops the synth. Dev takes them from context or
the environment.

## Deploy (approval required)

Every deployment is an owner-approved step (Phase 10). Review the synthesized template first.

```bash
LAI_ENV=prod LAI_DJANGO_ROLE_ARN=arn:aws:iam::<account>:role/<django-role> \
  CDK_DEFAULT_ACCOUNT=<account> CDK_DEFAULT_REGION=<region> npm run infra:synth
aws cloudformation deploy --stack-name LaiAssetStorage-prod \
  --template-file infra/cdk.out/LaiAssetStorage-prod.template.json \
  --capabilities CAPABILITY_NAMED_IAM --region <region>
aws cloudformation describe-stacks --stack-name LaiAssetStorage-prod --region <region> \
  --query 'Stacks[0].Outputs'
```

`cdk deploy` from `infra/` (with `cdk.json`) works as well if you use the CDK CLI. The bucket is
retained if the stack is deleted, and `prod` has termination protection. The child
photo stack (`LaiChildPhotos-<env>`) deploys the same way, after `LaiAssetStorage-<env>` and
before `LaiDjangoEc2-<env>`; `scripts/aws/provision.sh` creates them in that order.

## Tests

`infra/lib/*.test.ts` run with the React Vitest suite (`npm test`) and assert on the synthesized
template; they make no AWS call. `npm run typecheck` includes `infra/tsconfig.json`.
