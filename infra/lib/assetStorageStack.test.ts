// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  AssetStorageStack,
  isAllowedOrigin,
  type AssetStorageStackProps,
} from './assetStorageStack';

/**
 * The asset manager's AWS storage, synthesized in memory and asserted on the
 * CloudFormation it produces. No AWS call is made.
 */

function synth(props: Partial<AssetStorageStackProps> = {}) {
  const app = new App();
  const stack = new AssetStorageStack(app, 'Test', {
    envName: 'prod',
    allowedOrigins: [],
    env: { account: '123456789012', region: 'us-west-1' },
    ...props,
  });
  return { stack, template: Template.fromStack(stack) };
}

function policyStatements(template: Template): { Action: string | string[]; Resource: unknown }[] {
  const policies = template.findResources('AWS::IAM::ManagedPolicy');
  return Object.values(policies).flatMap(
    (policy) =>
      (policy as { Properties: { PolicyDocument: { Statement: never[] } } }).Properties
        .PolicyDocument.Statement,
  );
}

// The first synth loads aws-cdk-lib, which takes several seconds on a cold run.
describe('AssetStorageStack', { timeout: 30_000 }, () => {
  it('makes one private, encrypted, TLS-only bucket with a deterministic name', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'lai-assets-prod-123456789012-us-west-1',
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
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('keeps the bucket, and its objects, when the stack is deleted', () => {
    const { template, stack } = synth();
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(stack.terminationProtection).toBe(true);
    expect(synth({ envName: 'dev' }).stack.terminationProtection).toBe(false);
  });

  it('expires only deleted object versions and abandoned uploads', () => {
    synth().template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 30 } }),
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
        ]),
      },
    });
  });

  it('grants Django exactly the object calls it makes, on the asset prefix only', () => {
    const { template } = synth();
    const statements = policyStatements(template);
    expect(statements).toHaveLength(2);
    const actions = statements.flatMap((statement) => [statement.Action].flat());
    expect(actions.sort()).toEqual([
      's3:DeleteObject',
      's3:GetObject',
      's3:ListBucket',
      's3:PutObject',
    ]);
    expect(actions.some((action) => action.includes('*'))).toBe(false);
    const objectStatement = statements.find((statement) =>
      [statement.Action].flat().includes('s3:GetObject'),
    );
    expect(JSON.stringify(objectStatement?.Resource)).toContain('/assets/models/*');
  });

  it('attaches the policy to the Django workload role when one is named', () => {
    const { template } = synth({
      djangoRoleArn: 'arn:aws:iam::123456789012:role/lai-django-task',
    });
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'lai-django-asset-storage-prod',
      Roles: ['lai-django-task'],
    });
    expect(synth().template.findResources('AWS::IAM::ManagedPolicy')).not.toHaveProperty('Roles');
  });

  it('creates no IAM user or access key: credentials come from the workload role', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::IAM::User', 0);
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
  });

  it('has no CORS rule for django delivery, and a GET/HEAD rule for the app origins otherwise', () => {
    const none = synth().template.findResources('AWS::S3::Bucket');
    expect(JSON.stringify(none)).not.toContain('CorsConfiguration');
    synth({
      allowedOrigins: ['https://main.example.amplifyapp.com', 'https://learning.example.com'],
    }).template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          {
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: ['https://main.example.amplifyapp.com', 'https://learning.example.com'],
            AllowedHeaders: ['Range'],
            ExposedHeaders: ['Content-Length', 'Content-Type', 'ETag'],
            MaxAge: 3600,
          },
        ],
      },
    });
  });

  it('refuses wildcard, non-https and malformed origins', () => {
    expect(() => synth({ allowedOrigins: ['*'] })).toThrow(/allowedOrigins/);
    expect(() => synth({ allowedOrigins: ['http://learning.example.com'] })).toThrow();
    expect(isAllowedOrigin('https://*.example.com')).toBe(false);
    expect(isAllowedOrigin('https://learning.example.com/path')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('https://learning.example.com')).toBe(true);
  });

  it('outputs what Django needs: the bucket name, its region and the policy', () => {
    const outputs = synth().template.findOutputs('*');
    expect(Object.keys(outputs).sort()).toEqual([
      'AssetBucketName',
      'AssetBucketRegion',
      'DjangoAssetStoragePolicyArn',
    ]);
  });
});
