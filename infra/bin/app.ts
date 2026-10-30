import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { AssetStorageStack, type AssetEnvironment } from '../lib/assetStorageStack';

/**
 * The CDK app (the start of LAI-1001). Today it holds one stack, the asset
 * manager's storage. See infra/README.md for synth and deploy commands.
 *
 * Settings come from CDK context (`-c name=value`) or, for a plain
 * `npx tsx infra/bin/app.ts` synth without the CDK CLI, the environment:
 *
 * | Context          | Environment                 | Meaning                                    |
 * | ---------------- | --------------------------- | ------------------------------------------ |
 * | `env`            | `LAI_ENV`                   | `dev` (default) or `prod`                  |
 * | `allowedOrigins` | `LAI_ASSET_ALLOWED_ORIGINS` | comma-separated app origins (s3 delivery)  |
 * | `djangoRoleArn`  | `LAI_DJANGO_ROLE_ARN`       | the Django workload role to grant, if any  |
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

new AssetStorageStack(app, `LaiAssetStorage-${envName}`, {
  envName: envName as AssetEnvironment,
  allowedOrigins: setting('allowedOrigins', 'LAI_ASSET_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  djangoRoleArn: setting('djangoRoleArn', 'LAI_DJANGO_ROLE_ARN') || undefined,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  // No file assets, so no `cdk bootstrap` stack (and its IAM roles, LAI-0104) is needed: the
  // synthesized template deploys with `aws cloudformation deploy` or `cdk deploy` alike.
  synthesizer: new BootstraplessSynthesizer(),
  description: `Learning Adventure Island asset manager storage (${envName})`,
});

app.synth();
