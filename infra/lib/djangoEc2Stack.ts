import {
  Aws,
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  Tags,
  type StackProps,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { readFileSync } from 'node:fs';
import type { Construct } from 'constructs';
import { DJANGO_REPOSITORY_NAME } from './djangoReleaseStack';
import { githubOidcProviderArn, githubPrincipal, isGithubRepository } from './githubOidc';

/**
 * One Django environment on a single EC2 instance (ADR-037,
 * docs/platform/DJANGO_EC2_DEPLOYMENT.md):
 *
 *   api.<domain> -> ALB (HTTPS, ACM; WAF rate rule on the admin login)
 *               -> EC2 :8080, security group admits the ALB only
 *               -> nginx -> gunicorn (Docker Compose, image pinned by digest)
 *               -> RDS PostgreSQL 16 (private subnets, TLS, encrypted, deletion protection)
 *
 * Releases arrive through SSM Run Command documents defined here, never SSH:
 * the GitHub deploy role (OIDC, this environment only) may send the deploy,
 * rollback and status documents to this instance and nothing else. Logs and
 * metrics go to CloudWatch; alarms go to an SNS topic.
 *
 * No NAT gateway: the instance has a public address in a public subnet so it
 * can reach ECR, SSM, Cognito and S3, while inbound traffic is limited to the
 * ALB. Deploying is an owner-approved step; the repository only synthesizes.
 */

export type DjangoEnvironment = 'dev' | 'prod';
export type DatabaseMode = 'rds' | 'container';

export const PROXY_PORT = 8080;
export const READINESS_PATH = '/api/v1/health/ready/';
export const METRICS_NAMESPACE = 'LearningAdventureIsland/EC2';
export const IMAGE_URI_PATTERN =
  '^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9][a-z0-9/_.-]*@sha256:[a-f0-9]{64}$';
export const GIT_SHA_PATTERN = '^[a-f0-9]{40}$';
export const RUN_URL_PATTERN =
  '^$|^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+(/attempts/[0-9]+)?$';
export const BOOTSTRAP_TASKS = [
  'check',
  'migrate',
  'create-admin',
  'ensure-asset-roles',
  'load-content',
  'seed-treasure-rush',
  'import-assets',
] as const;

export interface DjangoEc2StackProps extends StackProps {
  envName: DjangoEnvironment;
  /** `owner/repo`; only this repository's `django-<env>` GitHub environment may deploy. */
  githubRepository: string;
  /** `rds` (default, required for prod) or `container` (dev only: PostgreSQL in Docker). */
  databaseMode?: DatabaseMode;
  /** RDS Multi-AZ (default false; about doubles the database cost). */
  multiAz?: boolean;
  /** RDS instance class (default t4g.micro). */
  databaseInstanceClass?: string;
  /** Snapshot RDS before a release that has migrations (default: prod only). */
  premigrationSnapshot?: boolean;
  /** Route 53 zone for `api.<domain>`: validates the certificate and adds the alias record. */
  hostedZone?: { id: string; name: string };
  /** The admin path for the WAF login rate rule (default `/admin/`). */
  adminPath?: string;
}

/** Read a script from scripts/aws/ for embedding (user data, SSM documents). */
export function readScript(name: string): string {
  return readFileSync(new URL(`../../scripts/aws/${name}`, import.meta.url), 'utf8');
}

/**
 * Shell lines that run `script` with bash from a temporary file, after the
 * given exports. SSM runs runCommand with /bin/sh and the scripts need bash;
 * stdin is closed so no child can read the script text.
 */
export function bashWrapper(script: string, exports: Record<string, string>): string[] {
  return [
    ...Object.entries(exports).map(([name, value]) => `export ${name}='${value}'`),
    'lai_script=$(mktemp /tmp/lai-run.XXXXXX)',
    'cat >"$lai_script" <<\'LAI_SCRIPT_EOF\'',
    script.trimEnd(),
    'LAI_SCRIPT_EOF',
    'if bash "$lai_script" </dev/null; then lai_code=0; else lai_code=$?; fi',
    'rm -f "$lai_script"',
    'exit $lai_code',
  ];
}

/** `NotReady` -> `not-ready`, for alarm names. */
export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export class DjangoEc2Stack extends Stack {
  readonly instance: ec2.Instance;
  readonly deployRole: iam.Role;
  readonly instanceRole: iam.Role;

  constructor(scope: Construct, id: string, props: DjangoEc2StackProps) {
    const prod = props.envName === 'prod';
    super(scope, id, { terminationProtection: prod, ...props });
    const env = props.envName;
    const databaseMode = props.databaseMode ?? 'rds';
    if (!isGithubRepository(props.githubRepository)) {
      throw new Error(`githubRepository must be owner/repo, got "${props.githubRepository}"`);
    }
    if (prod && databaseMode !== 'rds') {
      throw new Error('prod must use the rds database mode');
    }
    const premigrationSnapshot = props.premigrationSnapshot ?? prod;
    const adminPath = props.adminPath ?? '/admin/';
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'django-ec2');
    Tags.of(this).add('Environment', env);

    // --- Deploy-time parameters ----------------------------------------------------------------
    const apiDomain = new CfnParameter(this, 'ApiDomainName', {
      type: 'String',
      description: 'The API host name, for example api.example.com (DNS need not exist yet)',
      allowedPattern: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$',
    }).valueAsString;
    const amiId = new CfnParameter(this, 'AmiId', {
      type: 'AWS::EC2::Image::Id',
      description:
        'Amazon Linux 2023 x86_64 AMI. Pinned so a stack update never replaces the instance ' +
        'because AWS published a newer image (scripts/aws/provision.sh resolves it).',
    }).valueAsString;
    const instanceType = new CfnParameter(this, 'InstanceType', {
      type: 'String',
      default: 't3.medium',
      description: 'An x86_64 instance type (the AMI is x86_64)',
      allowedPattern: '^[a-z][a-z0-9-]*\\.[a-z0-9]+$',
    }).valueAsString;
    const cognitoPoolId = new CfnParameter(this, 'CognitoUserPoolId', {
      type: 'String',
      description: 'The existing Amplify Cognito user pool (COGNITO_USER_POOL_ID)',
      allowedPattern: '^[a-z]{2}(-[a-z]+)+-[0-9]_[A-Za-z0-9]+$',
    }).valueAsString;
    const cognitoClientIds = new CfnParameter(this, 'CognitoAllowedClientIds', {
      type: 'String',
      description: 'Comma-separated Cognito app client ids (COGNITO_ALLOWED_CLIENT_IDS)',
      allowedPattern: '^[a-z0-9]+(,[a-z0-9]+)*$',
    }).valueAsString;
    const alarmEmailParam = new CfnParameter(this, 'AlarmEmail', {
      type: 'String',
      default: '',
      description: 'Optional address for alarm e-mails (confirm the subscription e-mail)',
      allowedPattern: '^$|^[^@\\s]+@[^@\\s]+$',
    });

    // --- Network -------------------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(prod ? '10.41.0.0/16' : '10.40.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // The default-SG lockdown is a custom-resource Lambda; nothing uses the default SG.
      restrictDefaultSecurityGroup: false,
    });
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Django ALB: HTTPS and the HTTP redirect from anywhere',
      allowAllOutbound: false,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP, redirected to HTTPS');
    const instanceSg = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Django EC2: the proxy port from the ALB only; no SSH',
      allowAllOutbound: false,
    });
    instanceSg.addIngressRule(albSg, ec2.Port.tcp(PROXY_PORT), 'nginx from the ALB');
    albSg.addEgressRule(instanceSg, ec2.Port.tcp(PROXY_PORT), 'to nginx');
    // ECR, SSM, CloudWatch, Secrets Manager, S3, Cognito JWKS, package repositories: all HTTPS.
    instanceSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS to AWS and Cognito');

    // --- Logs ----------------------------------------------------------------------------------
    const logGroup = (name: string, retention: logs.RetentionDays) =>
      new logs.LogGroup(this, `${name[0].toUpperCase()}${name.slice(1)}LogGroup`, {
        logGroupName: `/lai/${env}/${name}`,
        retention,
        removalPolicy: RemovalPolicy.RETAIN,
      });
    const appLogs = logGroup(
      'django',
      prod ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH,
    );
    const proxyLogs = logGroup('proxy', logs.RetentionDays.ONE_MONTH);
    const deployLogs = logGroup('deploy', logs.RetentionDays.ONE_YEAR);
    const ssmLogs = logGroup('ssm', logs.RetentionDays.ONE_YEAR);

    // --- Instance role -------------------------------------------------------------------------
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'DjangoRepository',
      DJANGO_REPOSITORY_NAME,
    );
    this.instanceRole = new iam.Role(this, 'InstanceRole', {
      roleName: `lai-django-ec2-${env}`,
      description: `Django EC2 (${env}): SSM, ECR pull, runtime settings, assets, logs`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        // LaiAssetStorage-<env> (infra/lib/assetStorageStack.ts): the asset bucket's objects only.
        iam.ManagedPolicy.fromManagedPolicyName(
          this,
          'AssetStoragePolicy',
          `lai-django-asset-storage-${env}`,
        ),
      ],
    });
    const parameterArn = (path: string) =>
      `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/lai/${env}/${path}`;
    const policy = (
      sid: string,
      actions: string[],
      resources: string[],
      conditions?: Record<string, unknown>,
    ) =>
      this.instanceRole.addToPolicy(
        new iam.PolicyStatement({ sid, actions, resources, conditions }),
      );
    policy('EcrLogin', ['ecr:GetAuthorizationToken'], ['*']);
    policy(
      'PullDjangoImages',
      ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
      [repository.repositoryArn],
    );
    policy(
      'ReadRuntimeSettings',
      ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
      [
        parameterArn('django'),
        parameterArn('django/*'),
        parameterArn('db/*'),
        parameterArn('bootstrap/*'),
      ],
    );
    policy('RecordReleases', ['ssm:PutParameter', 'ssm:GetParameter'], [parameterArn('deploy/*')]);
    policy('DecryptSecureStrings', ['kms:Decrypt'], ['*'], {
      StringEquals: { 'kms:ViaService': `ssm.${Aws.REGION}.amazonaws.com` },
    });
    policy(
      'WriteLogs',
      ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      [appLogs, proxyLogs, deployLogs, ssmLogs].flatMap((group) => [
        group.logGroupArn,
        `${group.logGroupArn}:*`,
      ]),
    );
    policy('FindLogGroups', ['logs:DescribeLogGroups'], ['*']); // SSM agent checks the output group
    policy('PublishMetrics', ['cloudwatch:PutMetricData'], ['*'], {
      StringEquals: { 'cloudwatch:namespace': METRICS_NAMESPACE },
    });

    // --- Database ------------------------------------------------------------------------------
    let database: rds.DatabaseInstance | undefined;
    let dataVolume: ec2.Volume | undefined;
    const instanceSubnet = vpc.publicSubnets[0];
    if (databaseMode === 'rds') {
      const dbSg = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
        vpc,
        description: 'Django PostgreSQL: the Django instance only',
        allowAllOutbound: false,
      });
      dbSg.addIngressRule(instanceSg, ec2.Port.tcp(5432), 'PostgreSQL from Django');
      instanceSg.addEgressRule(dbSg, ec2.Port.tcp(5432), 'PostgreSQL');
      // Created here with a retention: RDS's own `cloudwatchLogsRetention` needs a Lambda asset.
      const databaseLogs = new logs.LogGroup(this, 'DatabaseLogGroup', {
        logGroupName: `/aws/rds/instance/lai-django-${env}/postgresql`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      });
      database = new rds.DatabaseInstance(this, 'Database', {
        instanceIdentifier: `lai-django-${env}`,
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
        instanceType: new ec2.InstanceType(props.databaseInstanceClass ?? 't4g.micro'),
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [dbSg],
        publiclyAccessible: false,
        credentials: rds.Credentials.fromGeneratedSecret('lai_admin', {
          secretName: `lai/${env}/django/database`,
        }),
        databaseName: 'lai',
        storageEncrypted: true,
        storageType: rds.StorageType.GP3,
        allocatedStorage: 20,
        maxAllocatedStorage: 100,
        multiAz: props.multiAz ?? false,
        backupRetention: Duration.days(prod ? 14 : 7),
        preferredBackupWindow: '10:00-10:30', // UTC: 02:00-02:30 Pacific
        deletionProtection: true,
        removalPolicy: RemovalPolicy.SNAPSHOT,
        copyTagsToSnapshot: true,
        autoMinorVersionUpgrade: true,
        cloudwatchLogsExports: ['postgresql'],
        parameterGroup: new rds.ParameterGroup(this, 'DatabaseParameters', {
          engine: rds.DatabaseInstanceEngine.postgres({
            version: rds.PostgresEngineVersion.VER_16,
          }),
          description: 'Learning Adventure Island Django: TLS only',
          parameters: { 'rds.force_ssl': '1' },
        }),
      });
      database.node.addDependency(databaseLogs);
      database.secret!.grantRead(this.instanceRole);
      if (premigrationSnapshot) {
        policy(
          'PreMigrationSnapshots',
          ['rds:CreateDBSnapshot', 'rds:DescribeDBSnapshots', 'rds:AddTagsToResource'],
          [
            database.instanceArn,
            `arn:${Aws.PARTITION}:rds:${Aws.REGION}:${Aws.ACCOUNT_ID}:snapshot:lai-${env}-pre-*`,
          ],
        );
      }
    } else {
      // Dev only: PostgreSQL in Docker on its own encrypted volume, kept (as a snapshot) if the
      // stack is deleted, never touched by a release.
      dataVolume = new ec2.Volume(this, 'DataVolume', {
        availabilityZone: instanceSubnet.availabilityZone,
        size: Size.gibibytes(20),
        encrypted: true,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
        removalPolicy: RemovalPolicy.SNAPSHOT,
      });
    }

    // --- Runtime settings (plain values; secrets are SecureStrings an operator writes) ----------
    const settings: Record<string, string> = {
      DJANGO_ALLOWED_HOSTS: apiDomain,
      DJANGO_CSRF_TRUSTED_ORIGINS: `https://${apiDomain}`,
      COGNITO_REGION: Fn.select(0, Fn.split('_', cognitoPoolId)),
      COGNITO_USER_POOL_ID: cognitoPoolId,
      COGNITO_ALLOWED_CLIENT_IDS: cognitoClientIds,
      LAI_ASSET_STORAGE: 's3',
      // The deterministic name LaiAssetStorage-<env> gives its bucket.
      LAI_ASSET_BUCKET: `lai-assets-${env}-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      LAI_ASSET_REGION: Aws.REGION,
    };
    for (const [name, value] of Object.entries(settings)) {
      new ssm.StringParameter(this, `Setting${name}`, {
        parameterName: `/lai/${env}/django/${name}`,
        stringValue: value,
        description: 'Managed by LaiDjangoEc2; change through the stack',
      });
    }

    // --- Instance ------------------------------------------------------------------------------
    const setupEnvironment: Record<string, string> = {
      LAI_ENV: env,
      AWS_REGION: Aws.REGION,
      LAI_ECR_REPOSITORY_URI: repository.repositoryUri,
      LAI_API_HOST: apiDomain,
      LAI_DB_MODE: databaseMode,
      LAI_DB_SECRET_ARN: database?.secret?.secretArn ?? '',
      LAI_DB_INSTANCE_ID: database?.instanceIdentifier ?? '',
      LAI_PREMIGRATION_SNAPSHOT: String(premigrationSnapshot && databaseMode === 'rds'),
      LAI_DATA_VOLUME_ID: dataVolume?.volumeId ?? '',
      LAI_APP_LOG_GROUP: appLogs.logGroupName,
      LAI_DEPLOY_LOG_GROUP: deployLogs.logGroupName,
    };
    const setupLines = bashWrapper(readScript('setup-ec2.sh'), setupEnvironment);
    const userData = ec2.UserData.forLinux();
    userData.addCommands(...setupLines);

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { subnets: [instanceSubnet] },
      associatePublicIpAddress: true,
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: {
        getImage: () => ({ imageId: amiId, osType: ec2.OperatingSystemType.LINUX, userData }),
      },
      userData,
      role: this.instanceRole,
      securityGroup: instanceSg,
      // IMDSv2 only. Hop limit 2 so the Django container (boto3, S3 assets) can reach the
      // instance role's credentials from its bridge network; with 1 only host processes can.
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 2,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });
    Tags.of(this.instance).add('Name', `lai-django-${env}`);
    Tags.of(this.instance).add('lai:deploy-target', env);
    if (dataVolume) {
      new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
        instanceId: this.instance.instanceId,
        volumeId: dataVolume.volumeId,
        device: '/dev/sdf',
      });
    }
    if (database) {
      this.instance.node.addDependency(database); // the first boot can reach the database
    }

    // --- Load balancer -------------------------------------------------------------------------
    const zone = props.hostedZone
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
          hostedZoneId: props.hostedZone.id,
          zoneName: props.hostedZone.name,
        })
      : undefined;
    const certificate = new acm.Certificate(this, 'ApiCertificate', {
      domainName: apiDomain,
      // Without a Route 53 zone, ACM shows a CNAME to add at the DNS provider; the stack waits.
      validation: zone
        ? acm.CertificateValidation.fromDns(zone)
        : acm.CertificateValidation.fromDns(),
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
      deletionProtection: prod,
      idleTimeout: Duration.seconds(60),
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'DjangoTargets', {
      vpc,
      port: PROXY_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [new targets.InstanceTarget(this.instance, PROXY_PORT)],
      deregistrationDelay: Duration.seconds(15),
      healthCheck: {
        path: READINESS_PATH,
        healthyHttpCodes: '200',
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });
    alb.addListener('Https', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultTargetGroups: [targetGroup],
      open: false,
    });
    alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
      open: false,
    });
    if (zone) {
      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: apiDomain,
        target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)),
      });
    }

    // Django does not throttle failed admin logins (docs/DJANGO_TARGET_ARCHITECTURE.md 11a).
    const webAcl = new wafv2.CfnWebACL(this, 'AdminLoginRateLimit', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `lai-django-${env}`,
        sampledRequestsEnabled: false,
      },
      rules: [
        {
          name: 'admin-login-rate',
          priority: 0,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `lai-django-${env}-admin-login`,
            sampledRequestsEnabled: false,
          },
          statement: {
            rateBasedStatement: {
              limit: 100,
              evaluationWindowSec: 300,
              aggregateKeyType: 'IP',
              scopeDownStatement: {
                andStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        fieldToMatch: { uriPath: {} },
                        positionalConstraint: 'STARTS_WITH',
                        searchString: `${adminPath}login`,
                        textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                      },
                    },
                    {
                      byteMatchStatement: {
                        fieldToMatch: { method: {} },
                        positionalConstraint: 'EXACTLY',
                        searchString: 'POST',
                        textTransformations: [{ priority: 0, type: 'NONE' }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'AdminLoginRateLimitAssociation', {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // --- SSM documents: the only way a release reaches the instance ----------------------------
    const document = (
      action: string,
      description: string,
      parameters: Record<string, unknown>,
      runCommand: string[],
      timeoutSeconds: number,
    ) =>
      new ssm.CfnDocument(this, `${action[0].toUpperCase()}${action.slice(1)}Document`, {
        name: `lai-django-${action}-${env}`,
        documentType: 'Command',
        updateMethod: 'NewVersion',
        content: {
          schemaVersion: '2.2',
          description,
          parameters,
          mainSteps: [
            {
              action: 'aws:runShellScript',
              name: action,
              inputs: { timeoutSeconds: String(timeoutSeconds), runCommand },
            },
          ],
        },
      });
    const deployDocument = document(
      'deploy',
      'Release one Django image (pinned by digest) on this instance: migrate, start, health check, roll back on failure.',
      {
        Image: {
          type: 'String',
          description: 'ECR image pinned by digest',
          allowedPattern: IMAGE_URI_PATTERN,
        },
        GitSha: { type: 'String', description: 'Full commit SHA', allowedPattern: GIT_SHA_PATTERN },
        CommitEpoch: {
          type: 'String',
          description: 'Commit time, unix seconds',
          allowedPattern: '^[0-9]{9,11}$',
        },
        RunUrl: {
          type: 'String',
          default: '',
          description: 'GitHub Actions run URL',
          allowedPattern: RUN_URL_PATTERN,
        },
        AllowOlder: { type: 'String', default: 'false', allowedValues: ['true', 'false'] },
        AllowDestructiveMigrations: {
          type: 'String',
          default: 'false',
          allowedValues: ['true', 'false'],
        },
      },
      bashWrapper(readScript('ssm-release-entry.sh'), {
        LAI_REQ_IMAGE: '{{ Image }}',
        LAI_REQ_GIT_SHA: '{{ GitSha }}',
        LAI_REQ_COMMIT_EPOCH: '{{ CommitEpoch }}',
        LAI_REQ_RUN_URL: '{{ RunUrl }}',
        LAI_REQ_ALLOW_OLDER: '{{ AllowOlder }}',
        LAI_REQ_ALLOW_DESTRUCTIVE: '{{ AllowDestructiveMigrations }}',
      }),
      1800,
    );
    const onCurrent = (script: string, args: string) => [
      `test -x /opt/lai/current/scripts/aws/${script} || { echo "no release on this instance yet" >&2; exit 63; }`,
      `exec bash /opt/lai/current/scripts/aws/${script} ${args}</dev/null`,
    ];
    const rollbackDocument = document(
      'rollback',
      'Roll back to the last (or a given) healthy Django release on this instance. Never reverses migrations.',
      {
        ToGitSha: { type: 'String', default: '', allowedPattern: `^$|${GIT_SHA_PATTERN}` },
      },
      [
        "lai_to='{{ ToGitSha }}'",
        'test -x /opt/lai/current/scripts/aws/rollback-django.sh || { echo "no release on this instance yet" >&2; exit 63; }',
        'if [ -n "$lai_to" ]; then exec bash /opt/lai/current/scripts/aws/rollback-django.sh --to "$lai_to" </dev/null; fi',
        'exec bash /opt/lai/current/scripts/aws/rollback-django.sh </dev/null',
      ],
      900,
    );
    const statusDocument = document(
      'status',
      'Show the Django release, history, containers, health, disk and memory. Read only.',
      {},
      onCurrent('status.sh', ''),
      120,
    );
    document(
      'bootstrap',
      'One first-time Django task (scripts/aws/bootstrap-django.sh) in the current release image. Operators only.',
      {
        Task: { type: 'String', allowedValues: [...BOOTSTRAP_TASKS] },
        Argument: {
          type: 'String',
          default: '',
          allowedPattern: '^$|^--dry-run$|^[a-z][a-z0-9_.-]{2,29}$',
        },
      },
      [
        "lai_task='{{ Task }}'",
        "lai_arg='{{ Argument }}'",
        ...onCurrent('bootstrap-django.sh', '"$lai_task" $lai_arg '),
      ],
      1800,
    );
    document(
      'setup',
      'Rerun the idempotent instance setup (scripts/aws/setup-ec2.sh). Operators only.',
      {},
      setupLines,
      900,
    );

    // --- GitHub deploy role (OIDC; this environment's GitHub environment only) ------------------
    this.deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: `lai-github-deploy-${env}`,
      description: `GitHub Actions environment django-${env}: run the release documents on lai-django-${env}`,
      assumedBy: githubPrincipal(
        githubOidcProviderArn(),
        `repo:${props.githubRepository}:environment:django-${env}`,
      ),
      maxSessionDuration: Duration.hours(1),
    });
    const documentArn = (doc: ssm.CfnDocument) =>
      `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:document/${doc.ref}`;
    const instanceArn = `arn:${Aws.PARTITION}:ec2:${Aws.REGION}:${Aws.ACCOUNT_ID}:instance/${this.instance.instanceId}`;
    const deployPolicy = (sid: string, actions: string[], resources: string[]) =>
      this.deployRole.addToPolicy(new iam.PolicyStatement({ sid, actions, resources }));
    deployPolicy(
      'RunReleaseDocuments',
      ['ssm:SendCommand'],
      [
        documentArn(deployDocument),
        documentArn(rollbackDocument),
        documentArn(statusDocument),
        instanceArn,
      ],
    );
    // These SSM read actions have no resource-level permissions.
    deployPolicy(
      'FollowCommands',
      ['ssm:GetCommandInvocation', 'ssm:ListCommandInvocations', 'ssm:DescribeInstanceInformation'],
      ['*'],
    );
    deployPolicy('ReadStackOutputs', ['cloudformation:DescribeStacks'], [Aws.STACK_ID]);
    deployPolicy('CheckReleaseImage', ['ecr:DescribeImages'], [repository.repositoryArn]);
    deployPolicy(
      'ReadReleaseLogs',
      ['logs:GetLogEvents', 'logs:FilterLogEvents'],
      [deployLogs, ssmLogs].flatMap((group) => [group.logGroupArn, `${group.logGroupArn}:*`]),
    );

    // --- Alarms --------------------------------------------------------------------------------
    const topic = new sns.Topic(this, 'AlarmTopic', { topicName: `lai-django-alarms-${env}` });
    const hasEmail = new CfnCondition(this, 'HasAlarmEmail', {
      expression: Fn.conditionNot(Fn.conditionEquals(alarmEmailParam.valueAsString, '')),
    });
    const subscription = new sns.CfnSubscription(this, 'AlarmEmailSubscription', {
      topicArn: topic.topicArn,
      protocol: 'email',
      endpoint: alarmEmailParam.valueAsString,
    });
    subscription.cfnOptions.condition = hasEmail;
    const notify = new cwActions.SnsAction(topic);
    const alarm = (
      id: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      comparisonOperator: cloudwatch.ComparisonOperator,
      evaluationPeriods: number,
      treatMissingData = cloudwatch.TreatMissingData.NOT_BREACHING,
    ) => {
      const created = new cloudwatch.Alarm(this, id, {
        alarmName: `lai-django-${env}-${kebab(id)}`,
        alarmDescription: description,
        metric,
        threshold,
        comparisonOperator,
        evaluationPeriods,
        treatMissingData,
      });
      created.addAlarmAction(notify);
      created.addOkAction(notify);
      return created;
    };
    const lt = cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD;
    const gte = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const instanceMetric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: METRICS_NAMESPACE,
        metricName,
        dimensionsMap: { InstanceId: this.instance.instanceId },
        statistic: 'Maximum',
        period: Duration.minutes(5),
      });
    alarm(
      'NotReady',
      `Django ${env} is not ready (${READINESS_PATH} failing at the load balancer: database or pending migrations)`,
      targetGroup.metrics.healthyHostCount({ period: Duration.minutes(1), statistic: 'Minimum' }),
      1,
      lt,
      3,
      cloudwatch.TreatMissingData.BREACHING,
    );
    alarm(
      'Target5xx',
      `Django ${env} answered 10 or more 5xx in 5 minutes`,
      targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      10,
      gte,
      1,
    );
    alarm(
      'MemoryHigh',
      `Django ${env} instance memory above 90%`,
      instanceMetric('mem_used_percent'),
      90,
      gte,
      2,
    );
    alarm(
      'DiskHigh',
      `Django ${env} root disk above 85%`,
      instanceMetric('disk_used_percent'),
      85,
      gte,
      1,
    );
    const statusFailed = alarm(
      'SystemStatusFailed',
      `Django ${env} EC2 system status check failed; the instance is being recovered`,
      new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed_System',
        dimensionsMap: { InstanceId: this.instance.instanceId },
        statistic: 'Maximum',
        period: Duration.minutes(1),
      }),
      1,
      gte,
      2,
    );
    statusFailed.addAlarmAction(new cwActions.Ec2Action(cwActions.Ec2InstanceAction.RECOVER));
    if (database) {
      alarm(
        'DatabaseStorageLow',
        `Django ${env} database has under 2 GB free`,
        database.metricFreeStorageSpace({ period: Duration.minutes(5), statistic: 'Minimum' }),
        2 * 1024 ** 3,
        lt,
        1,
      );
    }

    // --- Outputs -------------------------------------------------------------------------------
    const output = (id: string, value: string, description: string) =>
      new CfnOutput(this, id, { value, description });
    output('InstanceId', this.instance.instanceId, 'The Django instance (SSM target)');
    output(
      'LoadBalancerDnsName',
      alb.loadBalancerDnsName,
      'CNAME api.<domain> to this if Route 53 is not used',
    );
    output('ApiBaseUrl', `https://${apiDomain}`, 'GitHub environment variable LAI_API_BASE_URL');
    output(
      'DeployRoleArn',
      this.deployRole.roleArn,
      'GitHub environment variable LAI_DEPLOY_ROLE_ARN',
    );
    output('DeployDocumentName', deployDocument.ref, 'SSM document GitHub runs for a release');
    output('CertificateArn', certificate.certificateArn, 'ACM certificate for the API host');
    output('AlarmTopicArn', topic.topicArn, 'SNS topic for the alarms');
    output(
      'ParameterPrefix',
      `/lai/${env}/django/`,
      'Runtime settings; add DJANGO_SECRET_KEY (SecureString)',
    );
    output('AppLogGroup', appLogs.logGroupName, 'Django container logs');
    if (database) {
      output('DatabaseEndpoint', database.dbInstanceEndpointAddress, 'RDS endpoint (private)');
      output(
        'DatabaseSecretArn',
        database.secret!.secretArn,
        'RDS master credentials (Secrets Manager)',
      );
    }
  }
}
