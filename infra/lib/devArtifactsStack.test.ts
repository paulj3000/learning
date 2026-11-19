// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { DevArtifactsStack, devArtifactBucketName } from './devArtifactsStack';

/** LaiDevArtifacts-dev, synthesized in memory. No AWS call is made. */

const env = { account: '123456789012', region: 'us-west-1' };

describe('DevArtifactsStack', { timeout: 60_000 }, () => {
  const template = Template.fromStack(new DevArtifactsStack(new App(), 'Artifacts', { env }));

  it('keeps one private, encrypted, unversioned, retained bucket with a deterministic name', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        BucketName: devArtifactBucketName(env.account, env.region),
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
      }),
    });
    const [bucket] = Object.values(template.findResources('AWS::S3::Bucket'));
    expect(bucket.Properties.VersioningConfiguration).toBeUndefined();
  });

  it('denies requests without TLS', () => {
    const policy = JSON.stringify(template.findResources('AWS::S3::BucketPolicy'));
    expect(policy).toContain('"aws:SecureTransport":"false"');
  });

  it('expires each prefix on its own schedule; releases by the ReleaseRetentionDays parameter', () => {
    template.hasParameter('ReleaseRetentionDays', { Type: 'Number', Default: 45 });
    const [bucket] = Object.values(template.findResources('AWS::S3::Bucket'));
    const rules = bucket.Properties.LifecycleConfiguration.Rules as Record<string, unknown>[];
    const byPrefix = Object.fromEntries(
      rules.filter((rule) => rule.Prefix).map((rule) => [rule.Prefix, rule.ExpirationInDays]),
    );
    expect(byPrefix).toEqual({
      'releases/': { Ref: 'ReleaseRetentionDays' },
      'lambda/': 180,
      'jobs/results/': 7,
      'tmp/': 1,
    });
    expect(rules).toContainEqual(
      expect.objectContaining({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
    );
  });

  it('outputs the bucket name and creates nothing else', () => {
    template.hasOutput('ArtifactBucketName', {});
    const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>);
    expect(new Set(types.map((resource) => resource.Type))).toEqual(
      new Set(['AWS::S3::Bucket', 'AWS::S3::BucketPolicy']),
    );
  });
});
