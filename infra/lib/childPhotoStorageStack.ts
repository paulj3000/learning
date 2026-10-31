import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { isAllowedOrigin, type AssetEnvironment } from './assetStorageStack';

/**
 * Private storage for parent-uploaded child profile photos (LAI-0904, ADR-042;
 * docs/platform/CHILD_PHOTO_STORAGE.md). A different bucket from the asset
 * manager's (`LaiAssetStorage-<env>`): game assets are published content,
 * child photos are a child's personal data, and the two never share a bucket,
 * a policy, a publication workflow or a CDN.
 *
 * - Every S3 Block Public Access setting, no ACLs (bucket owner enforced),
 *   TLS 1.2 or newer only, SSE-S3 encryption, versioning.
 * - No CloudFront and no public URL. Django authorizes every operation and
 *   hands the owning parent a short-lived presigned GET (`apps/photos`).
 * - Uploads go through Django, which validates and strips the image before
 *   it is stored, so the browser never writes to this bucket and no CORS rule
 *   exists unless `allowedOrigins` names an app origin that must `fetch()` a
 *   presigned GET (an `<img>` element does not need CORS).
 * - Object keys are opaque: `children/<child uuid>/<photo uuid>`, made only
 *   by Django. No name, e-mail or Cognito id is ever part of a key.
 *
 * Retention (docs/platform/CHILD_PHOTO_STORAGE.md section 5): a replaced or
 * deleted photo is removed by Django at once, which leaves a noncurrent
 * version; S3 expires noncurrent versions after `NONCURRENT_RETENTION_DAYS`,
 * then removes the leftover delete marker. Abandoned multipart uploads are
 * aborted after one day. Nothing is kept indefinitely by versioning.
 *
 * Deploying this stack is an approval step (docs/DJANGO_MIGRATION_ROADMAP.md
 * Phase 10); the repository only synthesizes it.
 */

export const CHILD_PHOTO_KEY_PREFIX = 'children/';
/** How long a replaced or deleted photo stays recoverable as a noncurrent version. */
export const NONCURRENT_RETENTION_DAYS = 7;

export interface ChildPhotoStorageStackProps extends StackProps {
  envName: AssetEnvironment;
  /**
   * App origins that must read presigned photo URLs with `fetch()`. Empty
   * (the default) means no CORS rule: `<img src>` and native clients need none.
   */
  allowedOrigins: readonly string[];
  /** The Django service's IAM role, when it is not the EC2 instance role (which attaches the policy itself). */
  djangoRoleArn?: string;
}

export function childPhotoBucketName(envName: string, account: string, region: string): string {
  return `lai-child-photos-${envName}-${account}-${region}`;
}

export class ChildPhotoStorageStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly djangoPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: ChildPhotoStorageStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    const bad = props.allowedOrigins.filter((origin) => !isAllowedOrigin(origin));
    if (bad.length > 0) {
      throw new Error(
        `allowedOrigins must be explicit https:// origins (http:// only for localhost): ${bad.join(', ')}`,
      );
    }
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'child-photos');
    Tags.of(this).add('Environment', props.envName);
    Tags.of(this).add('DataClassification', 'child-personal-data');

    this.bucket = new s3.Bucket(this, 'ChildPhotoBucket', {
      // Deterministic per environment, account and region; always under 63 characters.
      bucketName: childPhotoBucketName(props.envName, this.account, this.region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      lifecycleRules: [
        {
          id: 'expire-replaced-and-deleted-photos',
          noncurrentVersionExpiration: Duration.days(NONCURRENT_RETENTION_DAYS),
        },
        // A delete marker with no versions left behind it serves nothing; remove it.
        { id: 'remove-expired-delete-markers', expiredObjectDeleteMarker: true },
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors:
        props.allowedOrigins.length > 0
          ? [
              {
                allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
                allowedOrigins: [...props.allowedOrigins],
                allowedHeaders: [],
                exposedHeaders: ['Content-Length', 'Content-Type', 'ETag'],
                maxAge: 600,
              },
            ]
          : undefined,
      // Never delete children's photos with the stack: retirement is an explicit, approved
      // procedure (docs/platform/CHILD_PHOTO_STORAGE.md section 5).
      removalPolicy: RemovalPolicy.RETAIN,
    });

    /*
      Exactly what apps/photos/storage.py calls, on the `children/` prefix only:
      put_object (PutObject), get_object (GetObject; presigned GETs are signed with it),
      delete_object (DeleteObject, which leaves a noncurrent version for the lifecycle rule),
      list_objects_v2 under `children/` (ListBucket, prefix-conditioned) for the orphan audit.
      Deliberately absent: s3:*, version reads or deletes, ACL and bucket configuration rights.
    */
    this.djangoPolicy = new iam.ManagedPolicy(this, 'DjangoChildPhotoPolicy', {
      managedPolicyName: `lai-django-child-photos-${props.envName}`,
      description: 'Django child profiles: read, write and delete child photo objects.',
      statements: [
        new iam.PolicyStatement({
          sid: 'ChildPhotoObjects',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [this.bucket.arnForObjects(`${CHILD_PHOTO_KEY_PREFIX}*`)],
        }),
        new iam.PolicyStatement({
          sid: 'ListChildPhotoPrefix',
          actions: ['s3:ListBucket'],
          resources: [this.bucket.bucketArn],
          conditions: { StringLike: { 's3:prefix': [`${CHILD_PHOTO_KEY_PREFIX}*`] } },
        }),
      ],
    });
    if (props.djangoRoleArn) {
      this.djangoPolicy.attachToRole(
        iam.Role.fromRoleArn(this, 'DjangoRole', props.djangoRoleArn, { mutable: true }),
      );
    }

    new CfnOutput(this, 'ChildPhotoBucketName', {
      value: this.bucket.bucketName,
      description: 'Django LAI_CHILD_PHOTOS_BUCKET',
    });
    new CfnOutput(this, 'ChildPhotoBucketRegion', {
      value: this.region,
      description: 'Django LAI_CHILD_PHOTOS_REGION',
    });
    new CfnOutput(this, 'DjangoChildPhotoPolicyArn', {
      value: this.djangoPolicy.managedPolicyArn,
      description: 'Attach to the Django workload role if djangoRoleArn was not given',
    });
  }
}
