import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AiGuardrailStack } from '../lib/aiGuardrailStack';
import { AssetStorageStack, type AssetEnvironment } from '../lib/assetStorageStack';
import { ChildPhotoStorageStack } from '../lib/childPhotoStorageStack';
import { DevArtifactsStack } from '../lib/devArtifactsStack';
import { DEV_PLATFORM_STACK, DevPlatformStack } from '../lib/devPlatformStack';
import { DjangoEc2Stack, type DatabaseMode } from '../lib/djangoEc2Stack';
import { DjangoReleaseStack } from '../lib/djangoReleaseStack';
import { FRONTEND_REGION, FrontendStack } from '../lib/frontendStack';
import { ProcessingImagesStack } from '../lib/processingImagesStack';
import {
  ProcessingStack,
  processingStackName,
  type ProcessingAlarmThresholds,
} from '../lib/processingStack';

/**
 * The CDK app (LAI-1001). See infra/README.md for synth and deploy commands
 * and docs/platform/DJANGO_EC2_DEPLOYMENT.md for the release pipeline.
 *
 * | Stack                   | Env   | What                                                         |
 * | ----------------------- | ----- | ------------------------------------------------------------ |
 * | `LaiDevArtifacts-dev`   | dev   | artifacts bucket: releases, Lambda zip, job results          |
 * | `LaiAssetStorage-<env>` | both  | asset library bucket and Django policy (ADR-035)             |
 * | `LaiChildPhotos-<env>`  | both  | private child photo bucket and policy (ADR-042)              |
 * | `LaiDevPlatform-dev`    | dev   | native EC2 (no Docker, no ALB), RDS, SQS + Lambda, power     |
 * |                         |       | schedule (Step Functions, Scheduler), SSM documents, roles   |
 * | `LaiDjangoRelease`      | prod  | ECR repository, GitHub OIDC, image publisher role            |
 * | `LaiDjangoEc2-prod`     | prod  | VPC, ALB, EC2 (Docker), RDS, SSM documents, deploy role      |
 * | `LaiAiGuardrail-<env>`  | both  | child-safety Guardrail, Django AI policy (LAI-0704)          |
 * | `LaiProcessingImages-<env>` | both | ECR `lai/processing-<env>`, image publisher role (OIDC)  |
 * | `LaiProcessing-<env>`   | both  | processing bucket, work/completion SQS + DLQs, Lambda worker |
 * |                         |       | (image by digest, phase 2 only), Django policy, alarms       |
 * | `LaiFrontend-<env>`     | both  | React site: S3, CloudFront, `/api/*` to Django (us-east-1)   |
 *
 * Dev deploy order: LaiDevArtifacts-dev, LaiAssetStorage-dev, LaiChildPhotos-dev,
 * LaiProcessing-dev (its Django policy must exist before the platform attaches it by name),
 * LaiDevPlatform-dev, LaiProcessingImages-dev (trusts the OIDC provider the platform may create),
 * LaiAiGuardrail-dev (attaches its policy to the platform's instance role and filters its logs),
 * LaiFrontend-dev. Prod: storage, LaiDjangoRelease, LaiProcessingImages-prod, LaiProcessing-prod,
 * LaiDjangoEc2-prod. The worker needs a second LaiProcessing deploy with an image digest
 * (docs/infrastructure/processing-infrastructure.md, "Two-phase provisioning").
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
 * | `processingWorkerImageDigest` | `LAI_PROCESSING_WORKER_IMAGE_DIGEST` | `sha256:...` worker image; empty = phase 1 |
 * | `processingReservedConcurrency` | `LAI_PROCESSING_RESERVED_CONCURRENCY` | worker reserved concurrency (dev 2, prod 5) |
 * | `processingAlarms`   | `LAI_PROCESSING_ALARMS`     | JSON overrides of the processing alarm thresholds |
 *
 * Deploy-time values (API and admin host names, AMI, instance type, Cognito ids, alarm
 * e-mail) are CloudFormation parameters of `LaiDjangoEc2-prod` (scripts/aws/provision.sh) and
 * `LaiDevPlatform-dev` (scripts/aws/deploy-debug.sh). `databaseMode`, `multiAz` and
 * `createOidcProvider` apply to prod only; dev takes them as parameters.
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

if (envName === 'dev') {
  // The native dev environment (no Docker, no load balancer): see infra/lib/devPlatformStack.ts.
  new DevArtifactsStack(app, `LaiDevArtifacts-${envName}`, {
    env,
    synthesizer: synthesizer(),
    description:
      'Learning Adventure Island dev artifacts: Django releases, Lambda code, job results',
  });
  new DevPlatformStack(app, DEV_PLATFORM_STACK, {
    githubRepository,
    env,
    synthesizer: synthesizer(),
    description:
      'Learning Adventure Island native dev platform: EC2, RDS, SQS, Lambda, power schedule',
  });
} else {
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
}

// Background processing (LAI-LAMBDA-005): the image repository, then the pipeline. A worker
// exists only when an image digest is given (two-phase provisioning).
new ProcessingImagesStack(app, `LaiProcessingImages-${envName}`, {
  envName: envName as AssetEnvironment,
  githubRepository,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island processing worker images: ECR and publisher role (${envName})`,
});

const reservedConcurrency = setting(
  'processingReservedConcurrency',
  'LAI_PROCESSING_RESERVED_CONCURRENCY',
);
const alarmOverrides = setting('processingAlarms', 'LAI_PROCESSING_ALARMS');
new ProcessingStack(app, processingStackName(envName as AssetEnvironment), {
  envName: envName as AssetEnvironment,
  workerImageDigest:
    setting('processingWorkerImageDigest', 'LAI_PROCESSING_WORKER_IMAGE_DIGEST') || undefined,
  sizing: reservedConcurrency ? { reservedConcurrency: Number(reservedConcurrency) } : undefined,
  alarms: alarmOverrides
    ? (JSON.parse(alarmOverrides) as Partial<ProcessingAlarmThresholds>)
    : undefined,
  env,
  synthesizer: synthesizer(),
  description: `Learning Adventure Island background processing: S3, SQS, Lambda worker (${envName})`,
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
  githubRepository,
  hostedZone: hostedZoneId ? { id: hostedZoneId, name: hostedZoneName } : undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: FRONTEND_REGION },
  synthesizer: synthesizer(),
  description: `Learning Adventure Island React site on S3 and CloudFront (${envName})`,
});

app.synth();
