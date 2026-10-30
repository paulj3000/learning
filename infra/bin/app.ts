import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AssetStorageStack, type AssetEnvironment } from '../lib/assetStorageStack';
import { DjangoEc2Stack, type DatabaseMode } from '../lib/djangoEc2Stack';
import { DjangoReleaseStack } from '../lib/djangoReleaseStack';

/**
 * The CDK app (LAI-1001). See infra/README.md for synth and deploy commands
 * and docs/platform/DJANGO_EC2_DEPLOYMENT.md for the release pipeline.
 *
 * | Stack                   | Scope       | What                                              |
 * | ----------------------- | ----------- | ------------------------------------------------- |
 * | `LaiAssetStorage-<env>` | environment | asset manager bucket and Django policy (ADR-035)  |
 * | `LaiDjangoRelease`      | account     | ECR repository, GitHub OIDC, image publisher role |
 * | `LaiDjangoEc2-<env>`    | environment | VPC, ALB, EC2, RDS, SSM documents, deploy role    |
 *
 * Settings come from CDK context (`-c name=value`) or, for a plain
 * `npx tsx infra/bin/app.ts` synth without the CDK CLI, the environment:
 *
 * | Context              | Environment                 | Meaning                                       |
 * | -------------------- | --------------------------- | --------------------------------------------- |
 * | `env`                | `LAI_ENV`                   | `dev` (default) or `prod`                     |
 * | `allowedOrigins`     | `LAI_ASSET_ALLOWED_ORIGINS` | comma-separated app origins (s3 delivery)     |
 * | `djangoRoleArn`      | `LAI_DJANGO_ROLE_ARN`       | another Django role to grant the asset policy |
 * | `githubRepository`   | `LAI_GITHUB_REPOSITORY`     | `owner/repo` (default `paulj3000/learning`)   |
 * | `databaseMode`       | `LAI_DATABASE_MODE`         | `rds` (default) or `container` (dev only)     |
 * | `multiAz`            | `LAI_DB_MULTI_AZ`           | `true` for a Multi-AZ RDS instance            |
 * | `createOidcProvider` | `LAI_CREATE_OIDC_PROVIDER`  | `false` if the account already has GitHub's   |
 * | `hostedZoneId`       | `LAI_HOSTED_ZONE_ID`        | Route 53 zone for the API name (optional)     |
 * | `hostedZoneName`     | `LAI_HOSTED_ZONE_NAME`      | that zone's name, e.g. `example.com`          |
 *
 * Deploy-time values (API host name, AMI, instance type, Cognito ids, alarm
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
  description: `Learning Adventure Island asset manager storage (${envName})`,
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

app.synth();
