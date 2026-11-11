import {
  CfnOutput,
  CfnParameter,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { AssetEnvironment } from './assetStorageStack';
import { HOST_NAME_PATTERN } from './djangoEc2Stack';
import { githubOidcProviderArn, githubPrincipal, isGithubRepository } from './githubOidc';

/**
 * The React site on S3 and CloudFront (LAI-INFRA-003, LAI-1005; docs/infrastructure/domains-and-hosting.md).
 *
 * - A private, versioned S3 bucket reached only through CloudFront Origin Access Control.
 * - `/api/*` goes to the Django load balancer on the API host, so the React app keeps calling
 *   `/api/` on its own origin and Django needs no CORS (TR-D14).
 * - SPA routes (paths whose last segment has no file extension) are rewritten to `/index.html` by
 *   a CloudFront Function. A missing `.js` or `.css` file stays a 403/404 instead of returning
 *   HTML, so a broken release fails loudly.
 * - Deployed in us-east-1: CloudFront only accepts certificates from that region.
 *
 * Creates no Lambda or file asset, so it deploys bootstrapless like the other stacks. Its one IAM
 * role lets the `site-<env>` GitHub Environment publish the build (LAI-INFRA-004,
 * .github/workflows/deploy-site.yml, scripts/aws/publish-site.sh).
 */

export const FRONTEND_REGION = 'us-east-1';

/**
 * Rewrites extensionless paths (SPA routes) to an app shell. Runs on viewer request. `/game/` is
 * the Android WebView's game runtime (docs/android/ANDROID_GAME_LAUNCH.md), a separate entry
 * page, so its routes get its own shell rather than the main app's.
 */
export const SPA_REWRITE_FUNCTION = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    request.uri = uri.indexOf('/game/') === 0 ? '/game/index.html' : '/index.html';
  }
  return request;
}`;

export function webBucketName(envName: string, account: string, region: string): string {
  return `lai-web-${envName}-${account}-${region}`;
}

export interface FrontendStackProps extends StackProps {
  envName: AssetEnvironment;
  /** A Route 53 zone for the site and certificate validation; otherwise DNS is manual. */
  hostedZone?: { id: string; name: string };
  /** `owner/repo` whose `site-<env>` GitHub Environment may publish (LAI-INFRA-004). */
  githubRepository: string;
  /** Where the Amplify Gen 2 backend (and its Cognito pool) lives. Default us-west-1. */
  amplifyRegion?: string;
}

export class FrontendStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    const env = props.envName;
    if (!isGithubRepository(props.githubRepository)) {
      throw new Error(`githubRepository must be owner/repo, got "${props.githubRepository}"`);
    }
    const amplifyRegion = props.amplifyRegion ?? 'us-west-1';
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'frontend');
    Tags.of(this).add('Environment', env);

    const siteDomain = new CfnParameter(this, 'SiteDomainName', {
      type: 'String',
      description: 'The React site host name, for example lai.example.com',
      allowedPattern: HOST_NAME_PATTERN,
    }).valueAsString;
    const apiDomain = new CfnParameter(this, 'ApiDomainName', {
      type: 'String',
      description:
        'The Django API host (LaiDjangoEc2 ApiDomainName); CloudFront sends /api/* there',
      allowedPattern: HOST_NAME_PATTERN,
    }).valueAsString;
    const amplifyAppId = new CfnParameter(this, 'AmplifyAppId', {
      type: 'String',
      description:
        'The Amplify Hosting app whose main-branch backend holds the Cognito pool; the site build ' +
        'reads its amplify_outputs.json (aws amplify list-apps)',
      allowedPattern: '^d[a-z0-9]{5,}$',
    }).valueAsString;

    this.bucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: webBucketName(env, this.account, this.region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Versioned so a bad upload can be rolled back object by object.
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const zone = props.hostedZone
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
          hostedZoneId: props.hostedZone.id,
          zoneName: props.hostedZone.name,
        })
      : undefined;
    const certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: siteDomain,
      // Without a Route 53 zone, ACM shows a CNAME to add at the DNS provider; the stack waits.
      validation: zone
        ? acm.CertificateValidation.fromDns(zone)
        : acm.CertificateValidation.fromDns(),
    });

    // The same headers Amplify Hosting sends today (customHttp.yml).
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: `Learning Adventure Island ${env} security headers`,
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      code: cloudfront.FunctionCode.fromInline(SPA_REWRITE_FUNCTION),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Extensionless paths to /index.html; real files untouched',
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Learning Adventure Island ${env}`,
      domainNames: [siteDomain],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',
      // No access logs: request paths carry child ids (ADR-025, gate G10).
      enableLogging: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        // Honours each object's Cache-Control: hashed assets for a year, index.html no-cache.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
            readTimeout: Duration.seconds(35), // gunicorn times out at 30 s
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          // Every API response is per-family and authenticated: never cached at the edge.
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards Authorization, query strings and cookies; Host becomes the API host, which
          // the load balancer's host rule and Django's ALLOWED_HOSTS both accept.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    if (zone) {
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, 'SiteAlias', { zone, recordName: siteDomain, target });
      new route53.AaaaRecord(this, 'SiteAliasIpv6', { zone, recordName: siteDomain, target });
    }

    // --- Release role (LAI-INFRA-004): GitHub OIDC, the site-<env> GitHub Environment only ----
    // Publishes the build and invalidates the shells. No delete: old hashed files stay for open
    // tabs and rollbacks (scripts/aws/publish-site.sh). Reads the Amplify main backend's outputs
    // so the build signs in against the same Cognito pool.
    const partition = Stack.of(this).partition;
    const account = Stack.of(this).account;
    const deployRole = new iam.Role(this, 'GithubSiteDeployRole', {
      roleName: `lai-github-site-deploy-${env}`,
      description: `GitHub Actions (${props.githubRepository}, environment site-${env}) publishes the React site`,
      assumedBy: githubPrincipal(
        githubOidcProviderArn(),
        `repo:${props.githubRepository}:environment:site-${env}`,
      ),
      maxSessionDuration: Duration.hours(1),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListSiteBucket',
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteSiteObjects',
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [this.bucket.arnForObjects('*')],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvalidateSite',
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: [
          `arn:${partition}:cloudfront::${account}:distribution/${this.distribution.distributionId}`,
        ],
      }),
    );
    // Read-only, the main branch only. The exact set `ampx generate outputs` needs is confirmed on
    // the first gated run (docs/infrastructure/deployment-design.md section 9); add only what an
    // AccessDenied names.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAmplifyMainBackend',
        actions: ['amplify:GetApp', 'amplify:GetBranch'],
        resources: [
          `arn:${partition}:amplify:${amplifyRegion}:${account}:apps/${amplifyAppId}`,
          `arn:${partition}:amplify:${amplifyRegion}:${account}:apps/${amplifyAppId}/branches/main`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAmplifyMainStacks',
        actions: ['cloudformation:DescribeStacks', 'cloudformation:ListStackResources'],
        resources: [
          `arn:${partition}:cloudformation:${amplifyRegion}:${account}:stack/amplify-${amplifyAppId}-main-branch-*/*`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAmplifyMainArtifacts',
        actions: ['s3:GetObject'],
        resources: [`arn:${partition}:s3:::amplify-${amplifyAppId}-main-*/*`],
      }),
    );

    const output = (outputId: string, value: string, description: string) =>
      new CfnOutput(this, outputId, { value, description });
    output('WebBucketName', this.bucket.bucketName, 'Upload the React build here');
    output('DistributionId', this.distribution.distributionId, 'For cache invalidations');
    output(
      'DistributionDomainName',
      this.distribution.distributionDomainName,
      'CNAME (or alias) the site host to this if Route 53 is not used',
    );
    output('SiteCertificateArn', certificate.certificateArn, 'us-east-1 certificate');
    output('SiteUrl', `https://${siteDomain}`, 'The React site');
    output(
      'SiteDeployRoleArn',
      deployRole.roleArn,
      'site-<env> environment: LAI_SITE_DEPLOY_ROLE_ARN',
    );
  }
}
