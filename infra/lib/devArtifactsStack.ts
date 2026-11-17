import { CfnOutput, CfnParameter, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

/**
 * The native dev environment's artifacts bucket (`LaiDevArtifacts-dev`). Deployed first: the
 * Django release tarballs (`releases/django/<sha>.tar.gz` and `.json`), the jobs worker Lambda
 * zip (`lambda/jobs-worker-<hash>.zip`, which `LaiDevPlatform-dev` reads through its
 * `WorkerCodeKey` parameter), large job results (`jobs/results/<job_id>.json`) and scratch files
 * (`tmp/`) all live here. Releases are uploaded with `--if-none-match '*'`, so a key never
 * changes content and the bucket needs no versioning.
 *
 * Bootstrapless, like every stack in this app: no file assets, Lambdas or custom resources.
 */

export function devArtifactBucketName(account: string, region: string): string {
  return `lai-dev-artifacts-${account}-${region}`;
}

/** Fixed lifecycle expirations in days, by key prefix (`releases/` is a parameter). */
export const ARTIFACT_EXPIRATIONS: Record<string, number> = {
  'lambda/': 180,
  'jobs/results/': 7,
  'tmp/': 1,
};

export class DevArtifactsStack extends Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'dev-artifacts');
    Tags.of(this).add('Environment', 'dev');

    const releaseRetention = new CfnParameter(this, 'ReleaseRetentionDays', {
      type: 'Number',
      default: 45,
      minValue: 7,
      maxValue: 3650,
      description: 'Days a Django release tarball and manifest are kept (releases/)',
    });

    this.bucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: devArtifactBucketName(this.account, this.region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      // Release artifacts of a running dev instance must outlive an accidental stack delete.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // The L2 lifecycle rule takes a Duration, which cannot carry a parameter: set it on the L1.
    const cfnBucket = this.bucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.lifecycleConfiguration = {
      rules: [
        {
          id: 'expire-releases',
          status: 'Enabled',
          prefix: 'releases/',
          expirationInDays: releaseRetention.valueAsNumber,
        },
        ...Object.entries(ARTIFACT_EXPIRATIONS).map(([prefix, days]) => ({
          id: `expire-${prefix.replace(/\/$/, '').replace(/\//g, '-')}`,
          status: 'Enabled',
          prefix,
          expirationInDays: days,
        })),
        {
          id: 'abort-incomplete-uploads',
          status: 'Enabled',
          abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        },
      ],
    };

    new CfnOutput(this, 'ArtifactBucketName', {
      value: this.bucket.bucketName,
      description: 'Django releases (releases/django/), the jobs worker zip (lambda/), job results',
    });
  }
}
