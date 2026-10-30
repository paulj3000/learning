import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

/**
 * Production storage for the Django asset manager (LAI-2200, ADR-035;
 * docs/ASSET_MANAGER.md section 12). One private bucket per environment for
 * immutable model versions, and one least-privilege managed policy for the
 * Django workload role. Nothing else: no CloudFront (decision in the doc),
 * no public access, no long-lived keys.
 *
 * Object keys are made only by Django (`apps/assets/storage.py`):
 * `assets/models/<asset id>/<version uuid>/model.<glb|gltf>`, written once
 * with `IfNoneMatch: *`, so a published object is never overwritten.
 *
 * Deploying this stack is an approval step (docs/DJANGO_MIGRATION_ROADMAP.md
 * Phase 10); the repository only synthesizes it.
 */

export const ASSET_KEY_PREFIX = 'assets/models/';
export type AssetEnvironment = 'dev' | 'prod';

export interface AssetStorageStackProps extends StackProps {
  envName: AssetEnvironment;
  /**
   * Browser origins that may GET presigned model URLs straight from S3
   * (`LAI_ASSET_DELIVERY=s3` only). Empty means no CORS rule, which is right
   * for the default `django` delivery: the browser then never talks to S3.
   */
  allowedOrigins: readonly string[];
  /** The Django service's IAM role (ECS task role, EC2 instance role), when it exists. */
  djangoRoleArn?: string;
}

/** An explicit https origin, or a loopback http origin for local development. */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (origin.includes('*') || url.origin !== origin) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
}

export class AssetStorageStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly djangoPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: AssetStorageStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    const bad = props.allowedOrigins.filter((origin) => !isAllowedOrigin(origin));
    if (bad.length > 0) {
      throw new Error(
        `allowedOrigins must be explicit https:// origins (http:// only for localhost): ${bad.join(', ')}`,
      );
    }
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'asset-manager');
    Tags.of(this).add('Environment', props.envName);

    this.bucket = new s3.Bucket(this, 'AssetBucket', {
      // Deterministic per environment, account and region; always under 63 characters.
      bucketName: `lai-assets-${props.envName}-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Keys are immutable, so versioning never keeps two copies of a live object. It only
      // keeps a deleted object (a never-published version, or an audit cleanup) recoverable
      // for 30 days.
      versioned: true,
      lifecycleRules: [
        { id: 'expire-deleted-objects', noncurrentVersionExpiration: Duration.days(30) },
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors:
        props.allowedOrigins.length > 0
          ? [
              {
                allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
                allowedOrigins: [...props.allowedOrigins],
                allowedHeaders: ['Range'],
                exposedHeaders: ['Content-Length', 'Content-Type', 'ETag'],
                maxAge: 3600,
              },
            ]
          : undefined,
      // Never delete published child-facing content with the stack.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    /*
      Exactly what apps/assets/storage.py calls, on the asset prefix only:
      put_object (PutObject), get_object and head_object (GetObject), delete_object
      (DeleteObject: a never-published version, cleanup after a failed database write,
      `asset_storage_audit --delete`), and presigned GETs (signed with GetObject).
      ListBucket is on this dedicated bucket without a prefix condition: `list_objects_v2`
      sends a prefix, but a HEAD of a missing key does not, and S3 answers it with 403
      instead of 404 unless ListBucket applies. No s3:*, no version deletes, no bucket
      configuration rights.
    */
    this.djangoPolicy = new iam.ManagedPolicy(this, 'DjangoAssetStoragePolicy', {
      managedPolicyName: `lai-django-asset-storage-${props.envName}`,
      description: 'Django asset manager: read, write and delete model objects in its bucket.',
      statements: [
        new iam.PolicyStatement({
          sid: 'AssetObjects',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [this.bucket.arnForObjects(`${ASSET_KEY_PREFIX}*`)],
        }),
        new iam.PolicyStatement({
          sid: 'ListAssetBucket',
          actions: ['s3:ListBucket'],
          resources: [this.bucket.bucketArn],
        }),
      ],
    });
    if (props.djangoRoleArn) {
      this.djangoPolicy.attachToRole(
        iam.Role.fromRoleArn(this, 'DjangoRole', props.djangoRoleArn, { mutable: true }),
      );
    }

    new CfnOutput(this, 'AssetBucketName', {
      value: this.bucket.bucketName,
      description: 'Django LAI_ASSET_BUCKET',
    });
    new CfnOutput(this, 'AssetBucketRegion', {
      value: this.region,
      description: 'Django LAI_ASSET_REGION',
    });
    new CfnOutput(this, 'DjangoAssetStoragePolicyArn', {
      value: this.djangoPolicy.managedPolicyArn,
      description: 'Attach to the Django workload role if djangoRoleArn was not given',
    });
  }
}
