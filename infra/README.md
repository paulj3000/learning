# infra

The CDK app for the Django platform's AWS resources (`docs/DJANGO_MIGRATION_ROADMAP.md` Phase 10,
LAI-1001 layout). It is separate from `amplify/`, which keeps deploying the Amplify Gen 2 backend
on its own pipeline; nothing here is deployed by a push.

| Stack                   | Scope       | What                                                                                   | Doc                                        |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| `LaiAssetStorage-<env>` | environment | The asset manager's private S3 bucket and the Django role policy                       | `docs/ASSET_MANAGER.md` sections 12 and 19 |
| `LaiDjangoRelease`      | account     | ECR `lai/django`, the GitHub OIDC provider, the image publisher role                   | `docs/platform/DJANGO_EC2_DEPLOYMENT.md`   |
| `LaiDjangoEc2-<env>`    | environment | VPC, ALB (ACM, WAF), EC2, RDS, SSM settings and release documents, deploy role, alarms | `docs/platform/DJANGO_EC2_DEPLOYMENT.md`   |

The EC2 release pipeline (ADR-037) is provisioned with `scripts/aws/provision.sh <env>`, which
creates change sets and applies them only with `--execute`; its settings and parameters are in
the runbook's section 4.

## Synthesize (no AWS access needed)

```bash
npm run infra:synth                       # dev, account and region left as CloudFormation pseudo-parameters
LAI_ENV=prod npm run infra:synth          # prod
```

The templates land in `infra/cdk.out/<stack>.template.json` (gitignored). The stacks use the
bootstrapless synthesizer: they have no file assets, Lambdas or custom resources, so no
`cdk bootstrap` stack (and its IAM roles) is needed. The EC2 stack embeds
`scripts/aws/setup-ec2.sh` and `scripts/aws/ssm-release-entry.sh` at synth time.

| Setting                                | CDK context      | Environment variable                        | Default                                         |
| -------------------------------------- | ---------------- | ------------------------------------------- | ----------------------------------------------- |
| Environment                            | `env`            | `LAI_ENV`                                   | `dev`                                           |
| Another Django role to grant           | `djangoRoleArn`  | `LAI_DJANGO_ROLE_ARN`                       | none (the EC2 instance role attaches it itself) |
| Browser origins for presigned GETs     | `allowedOrigins` | `LAI_ASSET_ALLOWED_ORIGINS`                 | none (right for `django` delivery)              |
| Account and region baked into the name |                  | `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION` | pseudo-parameters                               |

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
retained if the stack is deleted, and `prod` has termination protection.

## Tests

`infra/lib/*.test.ts` run with the React Vitest suite (`npm test`) and assert on the synthesized
template; they make no AWS call. `npm run typecheck` includes `infra/tsconfig.json`.
