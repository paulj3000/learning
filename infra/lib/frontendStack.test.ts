// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  FRONTEND_REGION,
  FrontendStack,
  SPA_REWRITE_FUNCTION,
  webBucketName,
} from './frontendStack';

/** The React site stack (LAI-INFRA-003), synthesized in memory. No AWS call is made. */

const env = { account: '123456789012', region: FRONTEND_REGION };

function frontend(hostedZone?: { id: string; name: string }) {
  const stack = new FrontendStack(new App(), 'Test', {
    envName: 'prod',
    env,
    hostedZone,
    githubRepository: 'paulj3000/learning',
  });
  return Template.fromStack(stack);
}

type Resource = { Type: string; Properties: Record<string, unknown> };
type Behavior = Record<string, unknown>;

function distributionConfig(template: Template): Record<string, unknown> {
  const [distribution] = Object.values(
    template.findResources('AWS::CloudFront::Distribution'),
  ) as Resource[];
  return distribution.Properties.DistributionConfig as Record<string, unknown>;
}

function rewrite(uri: string): string {
  const handler = runInNewContext(`${SPA_REWRITE_FUNCTION}; handler`) as (event: {
    request: { uri: string };
  }) => { uri: string };
  return handler({ request: { uri } }).uri;
}

describe('FrontendStack', () => {
  const template = frontend();

  it('keeps the site bucket private, encrypted, versioned and retained', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        BucketName: webBucketName('prod', env.account, FRONTEND_REGION),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    });
    const policy = JSON.stringify(template.findResources('AWS::S3::BucketPolicy'));
    expect(policy).toContain('cloudfront.amazonaws.com'); // Origin Access Control only
    expect(policy).toContain('aws:SecureTransport');
    expect(policy).not.toMatch(/"Principal":"\*","Action":"s3:GetObject"/);
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('serves the site host with a us-east-1 certificate and modern TLS', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: { Ref: 'SiteDomainName' },
      ValidationMethod: 'DNS',
    });
    const config = distributionConfig(template);
    expect(config.Aliases).toEqual([{ Ref: 'SiteDomainName' }]);
    expect(config.ViewerCertificate).toMatchObject({
      MinimumProtocolVersion: 'TLSv1.2_2021',
      SslSupportMethod: 'sni-only',
    });
    expect(config.Logging).toBeUndefined();
  });

  it('sends /api/* to the Django API host, uncached, with every viewer header but Host', () => {
    const config = distributionConfig(template);
    const [api] = config.CacheBehaviors as Behavior[];
    expect(api.PathPattern).toBe('/api/*');
    expect(api.ViewerProtocolPolicy).toBe('https-only');
    expect(api.AllowedMethods).toContain('POST');
    expect(api.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    expect(api.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac'); // AllViewerExceptHostHeader
    const origins = config.Origins as Array<Record<string, unknown>>;
    const apiOrigin = origins.find((origin) => origin.Id === api.TargetOriginId)!;
    expect(apiOrigin.DomainName).toEqual({ Ref: 'ApiDomainName' });
    expect(apiOrigin.CustomOriginConfig).toMatchObject({ OriginProtocolPolicy: 'https-only' });
    expect(config.CacheBehaviors).toHaveLength(1);
  });

  it('serves the build from S3 with the SPA rewrite and no blanket error fallback', () => {
    const config = distributionConfig(template);
    const site = config.DefaultCacheBehavior as Behavior;
    expect(site.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(site.FunctionAssociations).toEqual([
      expect.objectContaining({ EventType: 'viewer-request' }),
    ]);
    // A 403/404 to index.html rule would turn a missing script into HTML.
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.DefaultRootObject).toBe('index.html');
  });

  it('rewrites SPA routes to the app shell and leaves real files alone', () => {
    expect(rewrite('/')).toBe('/index.html');
    expect(rewrite('/children/abc/island')).toBe('/index.html');
    expect(rewrite('/admin')).toBe('/index.html'); // the React admin route
    expect(rewrite('/assets/index-3f2a.js')).toBe('/assets/index-3f2a.js');
    expect(rewrite('/assets/missing.css')).toBe('/assets/missing.css');
    expect(rewrite('/models/ship.gltf')).toBe('/models/ship.gltf');
    expect(rewrite('/game/')).toBe('/game/index.html'); // the Android game runtime's own shell
    expect(rewrite('/game/play')).toBe('/game/index.html');
    expect(rewrite('/game/assets/runtime-1a2b.js')).toBe('/game/assets/runtime-1a2b.js');
    expect(rewrite('/gamesroom')).toBe('/index.html');
  });

  it('sends the same security headers as Amplify Hosting', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
          }),
          FrameOptions: Match.objectLike({ FrameOption: 'DENY' }),
          ReferrerPolicy: Match.objectLike({ ReferrerPolicy: 'strict-origin-when-cross-origin' }),
        }),
      }),
    });
  });

  it('lets only the site-<env> GitHub Environment publish, with no delete right', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'lai-github-site-deploy-prod',
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:paulj3000/learning:environment:site-prod',
              },
            },
          }),
        ],
      }),
    });
    const [policy] = Object.values(template.findResources('AWS::IAM::Policy')) as Resource[];
    const statements = (
      policy.Properties.PolicyDocument as {
        Statement: Array<{ Sid: string; Action: string | string[]; Resource: unknown }>;
      }
    ).Statement;
    const actions = statements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );
    expect(actions).toContain('s3:PutObject');
    expect(actions).toContain('cloudfront:CreateInvalidation');
    expect(actions.filter((action) => /Delete|\*/.test(action))).toEqual([]);
    const amplify = JSON.stringify(statements.filter((s) => s.Sid.startsWith('ReadAmplify')));
    expect(amplify).toContain('AmplifyAppId');
    expect(amplify).toContain('-main-');
    expect(amplify).toContain('us-west-1');
  });

  it('creates no Lambda or file asset', () => {
    template.resourceCountIs('AWS::Lambda::Function', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0); // no zone given
  });

  it('adds IPv4 and IPv6 aliases when a Route 53 zone is given', () => {
    const zoned = frontend({ id: 'Z123', name: 'example.com' });
    const records = Object.values(zoned.findResources('AWS::Route53::RecordSet')) as Resource[];
    expect(records.map((record) => record.Properties.Type).sort()).toEqual(['A', 'AAAA']);
  });
});
