// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AssetStorageStack } from './assetStorageStack';
import {
  ChildPhotoStorageStack,
  childPhotoBucketName,
  NONCURRENT_RETENTION_DAYS,
  type ChildPhotoStorageStackProps,
} from './childPhotoStorageStack';

/**
 * The private child photo bucket (LAI-0904, ADR-042), synthesized in memory
 * and asserted on the CloudFormation it produces. No AWS call is made.
 */

const env = { account: '123456789012', region: 'us-west-1' };

function synth(props: Partial<ChildPhotoStorageStackProps> = {}) {
  const app = new App();
  const stack = new ChildPhotoStorageStack(app, 'Test', {
    envName: 'prod',
    allowedOrigins: [],
    env,
    ...props,
  });
  return { stack, template: Template.fromStack(stack) };
}

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}

function policyStatements(template: Template): Statement[] {
  const policies = template.findResources('AWS::IAM::ManagedPolicy');
  return Object.values(policies).flatMap(
    (policy) =>
      (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
        .PolicyDocument.Statement,
  );
}

function bucketPolicyStatements(template: Template): Statement[] {
  const policies = template.findResources('AWS::S3::BucketPolicy');
  return Object.values(policies).flatMap(
    (policy) =>
      (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
        .PolicyDocument.Statement,
  );
}

describe('ChildPhotoStorageStack', { timeout: 30_000 }, () => {
  it('makes one private bucket with every public access block, no ACLs, SSE and versioning', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'lai-child-photos-prod-123456789012-us-west-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('denies plain HTTP and TLS older than 1.2, and grants nobody public read', () => {
    const { template } = synth();
    const statements = bucketPolicyStatements(template);
    expect(statements).toContainEqual(
      expect.objectContaining({
        Effect: 'Deny',
        Action: 's3:*',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
    expect(statements).toContainEqual(
      expect.objectContaining({
        Effect: 'Deny',
        Action: 's3:*',
        Condition: { NumericLessThan: { 's3:TlsVersion': 1.2 } },
      }),
    );
    // The bucket policy only denies; it never allows anyone, least of all a wildcard principal.
    expect(statements.every((statement) => statement.Effect === 'Deny')).toBe(true);
  });

  it('expires replaced and deleted photos, their delete markers and abandoned uploads', () => {
    synth().template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            NoncurrentVersionExpiration: { NoncurrentDays: NONCURRENT_RETENTION_DAYS },
          }),
          Match.objectLike({ ExpiredObjectDeleteMarker: true }),
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
        ]),
      },
    });
    expect(NONCURRENT_RETENTION_DAYS).toBeLessThanOrEqual(7);
  });

  it('keeps the bucket when the stack is deleted, and protects the prod stack', () => {
    const { template, stack } = synth();
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(stack.terminationProtection).toBe(true);
    expect(synth({ envName: 'dev' }).stack.terminationProtection).toBe(false);
  });

  it('grants Django exactly the object calls it makes, on the children/ prefix only', () => {
    const statements = policyStatements(synth().template);
    expect(statements).toHaveLength(2);
    const actions = statements.flatMap((statement) => [statement.Action].flat());
    expect(actions.sort()).toEqual([
      's3:DeleteObject',
      's3:GetObject',
      's3:ListBucket',
      's3:PutObject',
    ]);
    expect(actions.some((action) => action.includes('*') || /Version|Acl/.test(action))).toBe(
      false,
    );
    const objects = statements.find((statement) =>
      [statement.Action].flat().includes('s3:GetObject'),
    )!;
    expect(JSON.stringify(objects.Resource)).toContain('/children/*');
    const list = statements.find((statement) => statement.Action === 's3:ListBucket')!;
    expect(list.Condition).toEqual({ StringLike: { 's3:prefix': ['children/*'] } });
  });

  it('names its policy per environment and attaches it to a named Django role', () => {
    synth({
      djangoRoleArn: 'arn:aws:iam::123456789012:role/lai-django-task',
    }).template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'lai-django-child-photos-prod',
      Roles: ['lai-django-task'],
    });
    synth({ envName: 'dev' }).template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'lai-django-child-photos-dev',
    });
    expect(synth().template.findResources('AWS::IAM::ManagedPolicy')).not.toHaveProperty('Roles');
  });

  it('creates no role, IAM user, access key or CDN', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::IAM::Role', 0);
    template.resourceCountIs('AWS::IAM::User', 0);
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
  });

  it('has no CORS rule by default, and only GET/HEAD for named origins otherwise', () => {
    expect(JSON.stringify(synth().template.toJSON())).not.toContain('CorsConfiguration');
    synth({ allowedOrigins: ['https://learning.example.com'] }).template.hasResourceProperties(
      'AWS::S3::Bucket',
      {
        CorsConfiguration: {
          CorsRules: [
            Match.objectLike({
              AllowedMethods: ['GET', 'HEAD'],
              AllowedOrigins: ['https://learning.example.com'],
            }),
          ],
        },
      },
    );
    expect(() => synth({ allowedOrigins: ['*'] })).toThrow(/allowedOrigins/);
    expect(() => synth({ allowedOrigins: ['http://learning.example.com'] })).toThrow();
  });

  it('is a different bucket and policy from the asset manager', () => {
    const app = new App();
    const assetStack = new AssetStorageStack(app, 'Assets', {
      envName: 'prod',
      allowedOrigins: [],
      env,
    });
    const photoStack = new ChildPhotoStorageStack(app, 'Photos', {
      envName: 'prod',
      allowedOrigins: [],
      env,
    });
    const assets = Template.fromStack(assetStack);
    const photos = Template.fromStack(photoStack);
    const name = (template: Template, type: string, property: string) =>
      Object.values(template.findResources(type)).map(
        (resource) => (resource as { Properties: Record<string, unknown> }).Properties[property],
      )[0];
    expect(name(photos, 'AWS::S3::Bucket', 'BucketName')).not.toEqual(
      name(assets, 'AWS::S3::Bucket', 'BucketName'),
    );
    expect(name(photos, 'AWS::IAM::ManagedPolicy', 'ManagedPolicyName')).not.toEqual(
      name(assets, 'AWS::IAM::ManagedPolicy', 'ManagedPolicyName'),
    );
    // The photo policy never reaches the asset prefix, and the asset policy never reaches children.
    expect(JSON.stringify(policyStatements(photos))).not.toContain('assets/');
    expect(JSON.stringify(policyStatements(assets))).not.toContain('children/');
  });

  it('keeps bucket names within the S3 limit and free of personal data', () => {
    const longest = childPhotoBucketName('prod', '123456789012', 'ap-southeast-4');
    expect(longest.length).toBeLessThanOrEqual(63);
    expect(longest).toMatch(/^[a-z0-9-]+$/);
  });

  it('outputs what Django needs: the bucket name, its region and the policy', () => {
    expect(Object.keys(synth().template.findOutputs('*')).sort()).toEqual([
      'ChildPhotoBucketName',
      'ChildPhotoBucketRegion',
      'DjangoChildPhotoPolicyArn',
    ]);
  });
});
