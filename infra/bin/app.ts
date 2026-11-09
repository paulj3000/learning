import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AiGuardrailStack } from '../lib/aiGuardrailStack';
import { AssetStorageStack, type AssetEnvironment } from '../lib/assetStorageStack';
import { ChildPhotoStorageStack } from '../lib/childPhotoStorageStack';
import { DjangoEc2Stack, type DatabaseMode } from '../lib/djangoEc2Stack';
import { DjangoReleaseStack } from '../lib/djangoReleaseStack';
import { FRONTEND_REGION, FrontendStack } from '../lib/frontendStack';

/**
 * The CDK app (LAI-1001). See infra/README.md for synth and deploy commands
 * and docs/platform/DJANGO_EC2_DEPLOYMENT.md for the release pipeline.
 *
 * | Stack                   | Scope       | What                                              |
 * | ----------------------- | ----------- | ------------------------------------------------- |
 * | `LaiAssetStorage-<env>` | environment | asset library bucket and Django policy (ADR-035)  |
 * | `LaiChildPhotos-<env>`  | environment | private child photo bucket and policy (ADR-042)   |
 * | `LaiDjangoRelease`      | account     | ECR repository, GitHub OIDC, image publisher role |
 * | `LaiDjangoEc2-<env>`    | environment | VPC, ALB, EC2, RDS, SSM documents, deploy role    |
 * | `LaiAiGuardrail-<env>`  | environment | child-safety Guardrail, Django AI policy (LAI-0704) |
 * | `LaiFrontend-<env>`     | environment | React site: S3, CloudFront, `/api/*` to Django (us-east-1) |
 *
 * Settings come from CDK context (`-c name=value`) or, for a plain
 * `npx tsx infra/bin/app.ts` synth without the CDK CLI, the environment:
 *
 * | Context              | Environment                 | Meaning                                       |
 * | -------------------- | --------------------------- | --------------------------------------------- |
 * | `env`                | `LAI_ENV`                   | `dev` (default) or `prod`                     |
 * | `allowedOrigins`     | `LAI_ASSET_ALLOWED_ORIGINS` | comma-separated app origins (s3 delivery)     |
 * | `photoAllowedOrigins` | `LAI_PHOTO_ALLOWED_ORIGINS` | app origins that fetch() photo URLs (rare)   |
 * | `djangoRoleArn`      | `LAI_DJANGO_ROLE_ARN`       | another Django role to grant both policies    |
 * | `githubRepository`   | `LAI_GITHUB_REPOSITORY`     | `owner/repo` (default `paulj3000/learning`)   |
 * | `databaseMode`       | `LAI_DATABASE_MODE`         | `rds` (default) or `container` (dev only)     |
 * | `multiAz`            | `LAI_DB_MULTI_AZ`           | `true` for a Multi-AZ RDS instance            |
 * | `createOidcProvider` | `LAI_CREATE_OIDC_PROVIDER`  | `false` if the account already has GitHub's   |
 * | `hostedZoneId`       | `LAI_HOSTED_ZONE_ID`        | Route 53 zone for the API, admin and site names |
 * | `hostedZoneName`     | `LAI_HOSTED_ZONE_NAME`      | that zone's name, e.g. `example.com`          |
 *
 * Deploy-time values (API and admin host names, AMI, instance type, Cognito ids, alarm
 * e-mail) are CloudFormation parameters of `LaiDjangoEc2-<env>`, passed by
 * scripts/aws/provision.sh.
 */

const app = new App({
  // The CDK CLI sets CDK_OUTDIR; a plain synth writes infra/cdk.out.
  outdir: process.env.CDK_OUTDIR ?? fileURLToPath(new URL('../cdk.out', import.meta.url)),
});

function setting(context: string, variable: string): string {
  const value: unknown = app.node.tryGetContext(context) ?? process.env[variable] ?? '';
  return String(value).trim();
}

const envName = setting('env', 'LAI_ENV') || 'dev';
if (envName !== 'dev' && envName !== 'prod') {
  throw new Error(`env must be dev or prod, got "${envName}"`);
}
const databaseMode = setting('databaseMode', 'LAI_DATABASE_MODE') || 'rds';
if (databaseMode !== 'rds' && databaseMode !== 'container') {
  throw new Error(`databaseMode must be rds or container, got "${databaseMode}"`);
}
const githubRepository =
  setting('githubRepository', 'LAI_GITHUB_REPOSITORY') || 'paulj3000/learning';
const hostedZoneId = setting('hostedZoneId', 'LAI_HOSTED_ZONE_ID');
const hostedZoneName = setting('hostedZoneName', 'LAI_HOSTED_ZONE_NAME');
if (Boolean(hostedZoneId) !== Boolean(hostedZoneName)) {
  throw new Error('hostedZoneId and hostedZoneName go together');
}

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
// No file assets anywhere, so no `cdk bootstrap` stack (and its IAM roles, LAI-0104) is needed:
// every synthesized template deploys with `aws cloudformation deploy` or `cdk deploy` alike.
const synthesizer = () => new BootstraplessSynthesizer();

new AssetStorageStack(app, `LaiAssetStorage-${envName}`, {
  envName: envName as AssetEnvironment,
  allowedOrigins: setting('allowedOrigins', 'LAI_ASSET_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  djangoRoleArn: setting('djangoRoleArn', 'LAI_DJANGO_ROLE_ARN') || undefined,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island asset library storage (${envName})`,
});

new ChildPhotoStorageStack(app, `LaiChildPhotos-${envName}`, {
  envName: envName as AssetEnvironment,
  allowedOrigins: setting('photoAllowedOrigins', 'LAI_PHOTO_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  djangoRoleArn: setting('djangoRoleArn', 'LAI_DJANGO_ROLE_ARN') || undefined,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island private child photo storage (${envName})`,
});

new DjangoReleaseStack(app, 'LaiDjangoRelease', {
  githubRepository,
  createOidcProvider: setting('createOidcProvider', 'LAI_CREATE_OIDC_PROVIDER') !== 'false',
  env,
  synthesizer: synthesizer(),
  description: 'Learning Adventure Island Django releases: ECR repository and GitHub OIDC',
});

new DjangoEc2Stack(app, `LaiDjangoEc2-${envName}`, {
  envName: envName as AssetEnvironment,
  githubRepository,
  databaseMode: databaseMode as DatabaseMode,
  multiAz: setting('multiAz', 'LAI_DB_MULTI_AZ') === 'true',
  hostedZone: hostedZoneId ? { id: hostedZoneId, name: hostedZoneName } : undefined,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island Django on EC2 (${envName})`,
});

new AiGuardrailStack(app, `LaiAiGuardrail-${envName}`, {
  envName: envName as AssetEnvironment,
  djangoRoleArn: setting('djangoRoleArn', 'LAI_DJANGO_ROLE_ARN') || undefined,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island child-safety Guardrail and Django AI policy (${envName})`,
});

// CloudFront certificates must live in us-east-1, so the whole site stack does (LAI-INFRA-003).
new FrontendStack(app, `LaiFrontend-${envName}`, {
  envName: envName as AssetEnvironment,
  hostedZone: hostedZoneId ? { id: hostedZoneId, name: hostedZoneName } : undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: FRONTEND_REGION },
  synthesizer: synthesizer(),
  description: `Learning Adventure Island React site on S3 and CloudFront (${envName})`,
});

app.synth();
