import {
  Aws,
  CfnCondition,
  CfnOutput,
  CfnParameter,
  CfnRule,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  Tags,
  Token,
  Validations,
  type StackProps,
} from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { devArtifactBucketName } from './devArtifactsStack';
import { POWER_STATE_MACHINE_NAME, PowerStateMachine } from './devPowerStateMachine';
import {
  HOST_NAME_PATTERN,
  RUN_URL_PATTERN,
  bashWrapper,
  kebab,
  readScript,
} from './djangoEc2Stack';
import { GITHUB_OIDC_HOST, githubOidcProviderArn, githubPrincipal } from './githubOidc';
import { djangoProcessingPolicyName } from './processingStack';

/**
 * The native (no Docker) dev environment, `LaiDevPlatform-dev`. It replaces `LaiDjangoEc2-dev`
 * for dev only; production keeps `LaiDjangoEc2-prod` and `LaiDjangoRelease`.
 *
 *   lai.<domain>  -> CloudFront (LaiFrontend-dev) -> /api/* -> api.<domain>:443
 *   api.<domain>, ladm.<domain> -> Elastic IP -> one ARM64 EC2 (nginx, Let's Encrypt, gunicorn
 *                                  under systemd, Python 3.12 venv) -> RDS PostgreSQL 16 (private)
 *   Django -> SQS work queues -> Lambda workers (arm64, outside the VPC) -> SQS results -> Django
 *   EventBridge Scheduler -> Step Functions `lai-dev-power` -> stop at night, start in the morning
 *
 * No load balancer, WAF, NAT gateway, VPC endpoints, ECR, ECS, CodeBuild or CodePipeline. Every
 * deploy-time choice is a CloudFormation parameter (scripts/aws/deploy-debug.sh passes them), so
 * the template is synthesized once and deployed bootstraplessly: no file assets, no custom
 * resources. The Lambda code is read from the artifacts bucket (`WorkerCodeKey`).
 *
 * Deploy after LaiDevArtifacts-dev, LaiAssetStorage-dev, LaiChildPhotos-dev and LaiProcessing-dev
 * (their policies are attached by name) and before LaiAiGuardrail-dev, which attaches
 * `lai-django-ai-dev` to this stack's instance role `lai-django-ec2-dev` and filters this stack's
 * `/lai/dev/django` logs.
 */

export const DEV = 'dev';
export const DEV_PLATFORM_STACK = 'LaiDevPlatform-dev';
export const DEV_METRICS_NAMESPACE = 'LearningAdventureIsland/DevEC2';
export const DEV_DATABASE_ID = 'lai-dev';
export const DEV_INSTANCE_ROLE = 'lai-django-ec2-dev';
/** Graviton (arm64) families only: the AMI is ARM64 (t4g, m7g, c6gn, r8gd, x2gd, ...). */
export const GRAVITON_INSTANCE_PATTERN = '^[a-z]+[0-9]+g[a-z]*\\.[a-z0-9]+$';
/**
 * Schedule hour and minute parameters: plain numbers without a leading zero, so the cron fields
 * are exactly what the EventBridge Scheduler documentation shows (`cron(35 7 * * ? *)`).
 * CloudFormation cannot strip a zero from `07:35` without a transform (Fn::FindInMap accepts only
 * Ref and Fn::FindInMap as keys), so the stack takes the fields separately and
 * scripts/aws/deploy-debug.sh converts the operator's HH:MM.
 */
export const HOUR_PATTERN = '^([0-9]|1[0-9]|2[0-3])$';
export const MINUTE_PATTERN = '^([0-9]|[1-5][0-9])$';
export const DEV_DOCUMENTS = {
  setup: 'lai-dev-native-setup',
  deploy: 'lai-dev-native-deploy',
  rollback: 'lai-dev-native-rollback',
  status: 'lai-dev-native-status',
  bootstrap: 'lai-dev-native-bootstrap',
  power: 'lai-dev-native-power',
} as const;
export const DEV_BOOTSTRAP_TASKS = [
  'check',
  'migrate',
  'create-admin',
  'ensure-roles',
  'load-content',
  'seed-content',
  'publish-seed-content',
  'import-assets',
] as const;
export const DEV_SCHEDULES = { stop: 'lai-dev-nightly-stop', start: 'lai-dev-morning-start' };
export const DEV_QUEUES = {
  ai: 'lai-dev-jobs-ai',
  media: 'lai-dev-jobs-media',
  results: 'lai-dev-job-results',
} as const;
export const DEV_FUNCTIONS = {
  ai: { name: 'lai-dev-jobs-ai', timeoutSeconds: 300 },
  media: { name: 'lai-dev-jobs-media', timeoutSeconds: 120 },
} as const;
export const WORKER_HANDLER = 'jobs_worker.handler.handle';
export const LOG_RETENTION_VALUES = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365];
/** Every output of the stack (scripts/aws/deploy-debug.sh and the workflows read them). */
export const DEV_PLATFORM_OUTPUTS = [
  'Environment',
  'AWSRegion',
  'InstanceId',
  'InstanceType',
  'ElasticIPAddress',
  'DatabaseIdentifier',
  'DatabaseEndpoint',
  'DatabasePort',
  'DatabaseSecretArn',
  'AssetBucketName',
  'SpeechBucketName',
  'ArtifactBucketName',
  'LambdaProcessingQueueUrl',
  'LambdaMediaQueueUrl',
  'LambdaResultsQueueUrl',
  'AiWorkerFunctionName',
  'MediaWorkerFunctionName',
  'ShutdownScheduleName',
  'StartupScheduleName',
  'PowerStateMachineArn',
  'InfrastructureManagementRoleArn',
  'BackendDeploymentRoleArn',
  'SiteUrl',
  'ApiBaseUrl',
  'AdminBaseUrl',
  'DeployDocumentName',
  'ParameterPrefix',
] as const;

/** Namespace of the metrics the processing log filters publish (LAI-LAMBDA-006). */
export const PROCESSING_LOG_METRICS_NAMESPACE = 'LearningAdventureIsland/Processing';

/**
 * One processing log alarm: at least `threshold` matching lines in each of `evaluationPeriods`
 * consecutive periods of `periodMinutes`.
 */
export interface ProcessingLogAlarmThreshold {
  threshold: number;
  periodMinutes: number;
  evaluationPeriods: number;
}

/**
 * The Django processing log lines that page (docs/processing/OPERATIONS.md, section 10). Every
 * pattern is a fixed event name the code logs with ids, codes and exception class names only, so
 * a filter never sees content, names, keys or URLs. All of them are written by the
 * `lai-jobs-completions` and `lai-jobs-reconcile` units to `/lai/dev/jobs`.
 */
export const PROCESSING_LOG_EVENTS = {
  CompletionRejected: 'processing.completion_rejected',
  OutboxStuck: 'processing.outbox_stuck',
  ReconcileFailed: 'processing.reconcile_failed',
  SubjectMismatch: 'processing.subject_mismatch',
  HookError: 'processing.hook_error',
  ConsumerDatabaseError: 'processing.consumer database_error',
} as const;
export type ProcessingLogAlarm = keyof typeof PROCESSING_LOG_EVENTS;
export type ProcessingLogAlarmThresholds = Record<ProcessingLogAlarm, ProcessingLogAlarmThreshold>;

/**
 * Defaults. A rejected completion, a subject mismatch, a hook error and a failed reconciliation
 * are each worth a look on their own. A stuck outbox must persist across two 15-minute periods
 * (the startup reconciliation may count retry rows that came due overnight, which the relay sends
 * a moment later). A short database blip makes the consumer back off and log a few lines, so its
 * alarm needs 5 in 15 minutes (the backoff is at most 60 s, so an outage logs about 15).
 */
export function defaultProcessingLogAlarms(): ProcessingLogAlarmThresholds {
  const each = { threshold: 1, periodMinutes: 15, evaluationPeriods: 1 };
  return {
    CompletionRejected: { ...each },
    OutboxStuck: { threshold: 1, periodMinutes: 15, evaluationPeriods: 2 },
    ReconcileFailed: { ...each },
    SubjectMismatch: { ...each },
    HookError: { ...each },
    ConsumerDatabaseError: { threshold: 5, periodMinutes: 15, evaluationPeriods: 1 },
  };
}

/** Merges overrides into the defaults and refuses values CloudWatch would reject. */
export function processingLogAlarms(
  overrides: Partial<Record<ProcessingLogAlarm, Partial<ProcessingLogAlarmThreshold>>> = {},
): ProcessingLogAlarmThresholds {
  const merged = defaultProcessingLogAlarms();
  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in merged)) {
      throw new Error(`unknown processing log alarm ${name}`);
    }
    const alarm = { ...merged[name as ProcessingLogAlarm], ...value };
    if (!Number.isInteger(alarm.threshold) || alarm.threshold < 1) {
      throw new Error(`${name}.threshold must be an integer of at least 1`);
    }
    if (![1, 5, 10, 15, 30, 60].includes(alarm.periodMinutes)) {
      throw new Error(`${name}.periodMinutes must be 1, 5, 10, 15, 30 or 60`);
    }
    if (
      !Number.isInteger(alarm.evaluationPeriods) ||
      alarm.evaluationPeriods < 1 ||
      alarm.evaluationPeriods * alarm.periodMinutes > 24 * 60
    ) {
      throw new Error(`${name}.evaluationPeriods must be 1 or more and span at most a day`);
    }
    merged[name as ProcessingLogAlarm] = alarm;
  }
  return merged;
}

export function speechBucketName(account: string, region: string): string {
  return `lai-speech-${DEV}-${account}-${region}`;
}

export interface DevPlatformStackProps extends StackProps {
  /** Default of the GitHubRepository parameter (`owner/repo`). */
  githubRepository?: string;
  /**
   * Overrides of the processing log alarms (`processingLogAlarms` context, JSON), e.g.
   * `{"ConsumerDatabaseError": {"threshold": 10}}`.
   */
  processingLogAlarms?: Partial<Record<ProcessingLogAlarm, Partial<ProcessingLogAlarmThreshold>>>;
}

export class DevPlatformStack extends Stack {
  readonly instance: ec2.Instance;
  readonly instanceRole: iam.Role;
  readonly database: rds.DatabaseInstance;

  /** Two AZs resolved by CloudFormation (`Fn::GetAZs`), as in DjangoEc2Stack (cfn-lint W3010). */
  override get availabilityZones(): string[] {
    return [Fn.select(0, Fn.getAzs()), Fn.select(1, Fn.getAzs())];
  }

  constructor(scope: Construct, id: string, props: DevPlatformStackProps = {}) {
    super(scope, id, props);
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'dev-platform');
    Tags.of(this).add('Environment', DEV);
    const partition = Aws.PARTITION;
    const region = Aws.REGION;
    const account = Aws.ACCOUNT_ID;

    // =============================================================================================
    // Parameters
    // =============================================================================================
    const param = (name: string, options: ConstructorParameters<typeof CfnParameter>[2]) =>
      new CfnParameter(this, name, options);
    const bool = (name: string, defaultValue: boolean, description: string) =>
      param(name, {
        type: 'String',
        default: String(defaultValue),
        allowedValues: ['true', 'false'],
        description,
      });
    const environment = param('Environment', {
      type: 'String',
      default: DEV,
      allowedValues: [DEV],
      description: 'The environment; this stack is dev only',
    });
    const amiId = param('AmiId', {
      type: 'AWS::EC2::Image::Id',
      description:
        'Amazon Linux 2023 ARM64 AMI, pinned (deploy-debug.sh resolves ' +
        '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64)',
    });
    const instanceType = param('InstanceType', {
      type: 'String',
      default: 't4g.small',
      allowedPattern: GRAVITON_INSTANCE_PATTERN,
      constraintDescription: 'must be a Graviton (arm64) instance type such as t4g.small',
      description: 'EC2 instance type; Graviton only (the AMI is ARM64)',
    });
    const volumeSize = param('EC2VolumeSize', {
      type: 'Number',
      default: 15,
      minValue: 10,
      maxValue: 200,
      description: 'Root gp3 volume size in GiB',
    });
    const swapSize = param('SwapSizeMb', {
      type: 'Number',
      default: 1024,
      minValue: 0,
      maxValue: 8192,
      description: 'Swap file size in MiB (0 = no swap)',
    });
    const dbClass = param('DatabaseInstanceClass', {
      type: 'String',
      default: 'db.t4g.micro',
      allowedPattern: '^db\\.[a-z0-9]+\\.[a-z0-9]+$',
      description: 'RDS instance class',
    });
    const dbStorage = param('DatabaseStorageSize', {
      type: 'Number',
      default: 20,
      minValue: 20,
      maxValue: 1000,
      description: 'RDS allocated gp3 storage in GiB',
    });
    const dbMaxStorage = param('DatabaseMaxStorageSize', {
      type: 'Number',
      default: 50,
      minValue: 21,
      maxValue: 2000,
      description: 'RDS storage autoscaling ceiling in GiB (above DatabaseStorageSize)',
    });
    const dbMultiAz = bool('DatabaseMultiAZ', false, 'RDS Multi-AZ (about doubles the cost)');
    const dbBackupRetention = param('DatabaseBackupRetention', {
      type: 'Number',
      default: 3,
      minValue: 1,
      maxValue: 35,
      description: 'Automated backup retention in days',
    });
    const dbDeletionProtection = bool(
      'DatabaseDeletionProtection',
      true,
      'RDS deletion protection',
    );
    const enableLambda = bool(
      'EnableLambdaProcessing',
      true,
      'Create the Lambda workers and their queue triggers (false: jobs disabled, Studio batches manual)',
    );
    const workerCodeKey = param('WorkerCodeKey', {
      type: 'String',
      default: '',
      allowedPattern: '^$|^lambda/[A-Za-z0-9._-]+\\.zip$',
      description:
        'Key of the jobs worker zip in the artifacts bucket, e.g. lambda/jobs-worker-<hash16>.zip',
    });
    const lambdaMemory = param('LambdaMemorySize', {
      type: 'Number',
      default: 512,
      minValue: 128,
      maxValue: 10240,
      description: 'Lambda worker memory in MB',
    });
    const lambdaConcurrency = param('LambdaConcurrencyLimit', {
      type: 'Number',
      default: 2,
      minValue: 2,
      maxValue: 1000,
      description: 'SQS event source MaximumConcurrency per worker (minimum 2)',
    });
    const enableSchedule = bool(
      'EnableScheduledShutdown',
      true,
      'Stop the environment at ShutdownHour:ShutdownMinute and start it at StartupHour:StartupMinute',
    );
    const timeParam = (name: string, hour: boolean, defaultValue: string, description: string) =>
      param(name, {
        type: 'String',
        default: defaultValue,
        allowedPattern: hour ? HOUR_PATTERN : MINUTE_PATTERN,
        constraintDescription: hour
          ? 'an hour 0 to 23 without a leading zero'
          : 'a minute 0 to 59 without a leading zero',
        description,
      });
    const shutdownTime = {
      hour: timeParam('ShutdownHour', true, '0', 'Nightly stop hour (0-23) in ScheduleTimezone'),
      minute: timeParam('ShutdownMinute', false, '0', 'Nightly stop minute (0-59)'),
    };
    const startupTime = {
      hour: timeParam('StartupHour', true, '7', 'Morning start begins: hour (0-23)'),
      minute: timeParam('StartupMinute', false, '35', 'Morning start begins: minute (0-59)'),
    };
    const warmupMinutes = param('StartupWarmupMinutes', {
      type: 'Number',
      default: 25,
      minValue: 0,
      maxValue: 120,
      description: 'Minutes a start takes until the site is ready (informational)',
    });
    const scheduleTimezone = param('ScheduleTimezone', {
      type: 'String',
      default: 'America/Los_Angeles',
      allowedPattern: '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$',
      description: 'IANA time zone of the schedules',
    });
    const siteDomain = param('SiteDomainName', {
      type: 'String',
      default: 'lai.pauldimitriu.com',
      allowedPattern: HOST_NAME_PATTERN,
      description: 'The React site host (LaiFrontend-dev)',
    }).valueAsString;
    const apiDomain = param('ApiDomainName', {
      type: 'String',
      default: 'api.pauldimitriu.com',
      allowedPattern: HOST_NAME_PATTERN,
      description: 'The Django API host (A record to the Elastic IP)',
    }).valueAsString;
    const adminDomain = param('AdminDomainName', {
      type: 'String',
      default: 'ladm.pauldimitriu.com',
      allowedPattern: HOST_NAME_PATTERN,
      description: 'The Django Admin host (A record to the Elastic IP)',
    }).valueAsString;
    const cognitoPoolId = param('CognitoUserPoolId', {
      type: 'String',
      allowedPattern: '^[a-z]{2}(-[a-z]+)+-[0-9]_[A-Za-z0-9]+$',
      description: 'The existing Cognito user pool (COGNITO_USER_POOL_ID)',
    }).valueAsString;
    const cognitoClientId = param('CognitoClientId', {
      type: 'String',
      allowedPattern: '^[a-z0-9]+(,[a-z0-9]+)*$',
      description: 'Cognito app client id, or a comma-separated list (COGNITO_ALLOWED_CLIENT_IDS)',
    }).valueAsString;
    const hostedZoneId = param('HostedZoneId', {
      type: 'String',
      default: '',
      allowedPattern: '^$|^Z[A-Z0-9]{1,32}$',
      description: "Route 53 zone of the API and admin hosts ('' = DNS managed elsewhere)",
    });
    const hostedZoneName = param('HostedZoneName', {
      type: 'String',
      default: '',
      allowedPattern: `^$|${HOST_NAME_PATTERN}`,
      description: 'That zone name, e.g. pauldimitriu.com (required with HostedZoneId)',
    });
    const certificateEmail = param('CertificateEmail', {
      type: 'String',
      default: '',
      allowedPattern: '^$|^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$',
      description: "Let's Encrypt account e-mail ('' = register without one)",
    });
    const prefixList = param('CloudFrontOriginPrefixListId', {
      type: 'String',
      allowedPattern: '^pl-[a-f0-9]+$',
      description: 'Managed prefix list com.amazonaws.global.cloudfront.origin-facing',
    });
    const adminCidr = param('AdminAllowedCidr', {
      type: 'String',
      default: '',
      allowedPattern: '^$|^([0-9]{1,3}\\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$',
      description: "CIDR allowed to reach 443 directly (admin host) ('' = CloudFront only)",
    });
    const openHttp = bool(
      'OpenHttpPort',
      false,
      "Open port 80 to the internet (HTTP-01 challenges); must be true when HostedZoneId is ''",
    );
    const createOidc = bool(
      'CreateGithubOidcProvider',
      true,
      "Create GitHub's OIDC provider (false when the account already has it)",
    );
    const githubRepository = param('GitHubRepository', {
      type: 'String',
      default: props.githubRepository ?? 'paulj3000/learning',
      allowedPattern: '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$',
      description: 'owner/repo whose dev-backend and dev-infrastructure environments deploy',
    }).valueAsString;
    const alarmEmail = param('AlarmEmail', {
      type: 'String',
      default: '',
      allowedPattern: '^$|^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$',
      description: "Alarm and budget e-mail ('' = none; confirm the subscription e-mail)",
    });
    const monthlyBudget = param('MonthlyBudgetUsd', {
      type: 'Number',
      default: 40,
      minValue: 1,
      maxValue: 10000,
      description: 'Monthly cost budget in USD (created only with AlarmEmail)',
    });
    const logRetention = param('LogRetentionDays', {
      type: 'Number',
      default: 14,
      allowedValues: LOG_RETENTION_VALUES.map(String),
      description: 'CloudWatch log retention in days',
    });

    // --- Conditions and rules -------------------------------------------------------------------
    const condition = (name: string, expression: ReturnType<typeof Fn.conditionEquals>) =>
      new CfnCondition(this, name, { expression });
    const isTrue = (p: CfnParameter) => Fn.conditionEquals(p.valueAsString, 'true');
    const notEmpty = (p: CfnParameter) => Fn.conditionNot(Fn.conditionEquals(p.valueAsString, ''));
    const hasZone = condition('HasHostedZone', notEmpty(hostedZoneId));
    const hasAdminCidr = condition('HasAdminCidr', notEmpty(adminCidr));
    const httpOpen = condition('OpenHttp', isTrue(openHttp));
    const oidcCreated = condition('CreateOidcProvider', isTrue(createOidc));
    const lambdaOn = condition('LambdaEnabled', isTrue(enableLambda));
    const scheduleOn = condition('ScheduleEnabled', isTrue(enableSchedule));
    const hasEmail = condition('HasAlarmEmail', notEmpty(alarmEmail));
    const multiAz = condition('MultiAz', isTrue(dbMultiAz));
    const deletionProtected = condition('DeletionProtected', isTrue(dbDeletionProtection));
    new CfnRule(this, 'HttpChallengeNeedsPort80', {
      ruleCondition: Fn.conditionEquals(hostedZoneId.valueAsString, ''),
      assertions: [
        {
          assert: Fn.conditionEquals(openHttp.valueAsString, 'true'),
          assertDescription:
            "OpenHttpPort must be true when HostedZoneId is '' (Let's Encrypt HTTP-01 on port 80)",
        },
      ],
    });
    new CfnRule(this, 'HostedZoneNeedsName', {
      ruleCondition: Fn.conditionNot(Fn.conditionEquals(hostedZoneId.valueAsString, '')),
      assertions: [
        {
          assert: Fn.conditionNot(Fn.conditionEquals(hostedZoneName.valueAsString, '')),
          assertDescription: 'HostedZoneName is required with HostedZoneId',
        },
      ],
    });
    new CfnRule(this, 'LambdaNeedsWorkerCode', {
      ruleCondition: Fn.conditionEquals(enableLambda.valueAsString, 'true'),
      assertions: [
        {
          assert: Fn.conditionNot(Fn.conditionEquals(workerCodeKey.valueAsString, '')),
          assertDescription: 'WorkerCodeKey is required when EnableLambdaProcessing is true',
        },
      ],
    });

    // --- Names ----------------------------------------------------------------------------------
    const artifactBucketName = devArtifactBucketName(account, region);
    const artifactBucketArn = `arn:${partition}:s3:::${artifactBucketName}`;
    const assetBucketName = `lai-assets-${DEV}-${account}-${region}`;
    const assetBucketArn = `arn:${partition}:s3:::${assetBucketName}`;
    const parameterArn = (path: string) =>
      `arn:${partition}:ssm:${region}:${account}:parameter/lai/${DEV}/${path}`;
    const documentArn = (name: string) =>
      `arn:${partition}:ssm:${region}:${account}:document/${name}`;
    const databaseArn = `arn:${partition}:rds:${region}:${account}:db:${DEV_DATABASE_ID}`;
    const functionArn = (name: string) =>
      `arn:${partition}:lambda:${region}:${account}:function:${name}`;
    const stateMachineArn = `arn:${partition}:states:${region}:${account}:stateMachine:${POWER_STATE_MACHINE_NAME}`;
    const acmeMode = Token.asString(Fn.conditionIf(hasZone.logicalId, 'route53', 'http'));

    // =============================================================================================
    // Logs
    // =============================================================================================
    const logGroup = (constructId: string, name: string) => {
      const group = new logs.LogGroup(this, constructId, {
        logGroupName: name,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      (group.node.defaultChild as logs.CfnLogGroup).retentionInDays = logRetention.valueAsNumber;
      return group;
    };
    const instanceLogs = ['django', 'nginx', 'deploy', 'jobs'].map((name) =>
      logGroup(`${name[0].toUpperCase()}${name.slice(1)}LogGroup`, `/lai/${DEV}/${name}`),
    );
    const deployLogs = instanceLogs[2];
    const jobsLogs = instanceLogs[3];
    const databaseLogs = logGroup(
      'DatabaseLogGroup',
      `/aws/rds/instance/${DEV_DATABASE_ID}/postgresql`,
    );
    const powerLogs = logGroup(
      'PowerLogGroup',
      `/aws/vendedlogs/states/${POWER_STATE_MACHINE_NAME}`,
    );

    // =============================================================================================
    // Network
    // =============================================================================================
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.42.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // The default-SG lockdown is a custom-resource Lambda; nothing uses the default SG.
      restrictDefaultSecurityGroup: false,
    });
    // The CloudFront prefix list counts as about 55 rules, so it has a security group of its own.
    const originSg = new ec2.SecurityGroup(this, 'OriginSg', {
      vpc,
      description: 'Django dev origin: HTTPS from CloudFront origin-facing addresses only',
      allowAllOutbound: false,
    });
    originSg.addIngressRule(
      ec2.Peer.prefixList(prefixList.valueAsString),
      ec2.Port.tcp(443),
      'HTTPS from CloudFront',
    );
    const instanceSg = new ec2.SecurityGroup(this, 'InstanceSg', {
      vpc,
      description: 'Django dev instance: no SSH; optional admin CIDR and HTTP-01 port 80',
      allowAllOutbound: false,
    });
    instanceSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS to AWS, Cognito, PyPI');
    instanceSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP to package mirrors');
    new ec2.CfnSecurityGroupIngress(this, 'AdminCidrHttps', {
      groupId: instanceSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      cidrIp: adminCidr.valueAsString,
      description: 'HTTPS from the admin CIDR',
    }).cfnOptions.condition = hasAdminCidr;
    new ec2.CfnSecurityGroupIngress(this, 'PublicHttp', {
      groupId: instanceSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      cidrIp: '0.0.0.0/0',
      description: "HTTP: Let's Encrypt HTTP-01 and the redirect to HTTPS",
    }).cfnOptions.condition = httpOpen;
    const dbSg = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc,
      description: 'Django dev PostgreSQL: the Django instance only',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(instanceSg, ec2.Port.tcp(5432), 'PostgreSQL from Django');
    instanceSg.addEgressRule(dbSg, ec2.Port.tcp(5432), 'PostgreSQL');

    // =============================================================================================
    // Storage and queues
    // =============================================================================================
    const speechBucket = new s3.Bucket(this, 'SpeechBucket', {
      bucketName: speechBucketName(account, region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      lifecycleRules: [
        { id: 'expire-child-speech', prefix: 'speech/child/', expiration: Duration.days(7) },
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const queue = (name: string, visibilitySeconds: number, retentionDays: number) => {
      const dlq = new sqs.Queue(this, `${kebabToPascal(name)}Dlq`, {
        queueName: `${name}-dlq`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(14),
        enforceSSL: true,
      });
      const main = new sqs.Queue(this, `${kebabToPascal(name)}Queue`, {
        queueName: name,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        visibilityTimeout: Duration.seconds(visibilitySeconds),
        retentionPeriod: Duration.days(retentionDays),
        deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
        enforceSSL: true,
      });
      return { main, dlq };
    };
    const aiQueue = queue(DEV_QUEUES.ai, 6 * DEV_FUNCTIONS.ai.timeoutSeconds, 4);
    const mediaQueue = queue(DEV_QUEUES.media, 6 * DEV_FUNCTIONS.media.timeoutSeconds, 4);
    // Django's consumer (lai-jobs-consumer) long-polls this; 5 minutes covers a slow write.
    const resultsQueue = queue(DEV_QUEUES.results, 300, 14);

    // =============================================================================================
    // Database
    // =============================================================================================
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16,
    });
    this.database = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: DEV_DATABASE_ID,
      engine,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      publiclyAccessible: false,
      credentials: rds.Credentials.fromGeneratedSecret('lai_admin', {
        secretName: `lai/${DEV}/django/database`,
      }),
      databaseName: 'lai',
      storageEncrypted: true,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      multiAz: false,
      backupRetention: Duration.days(3),
      // UTC, inside the daytime (Pacific) window when the database is running: a stopped
      // instance takes no automated backup and gets no maintenance.
      preferredBackupWindow: '20:00-20:30',
      preferredMaintenanceWindow: 'wed:21:00-wed:21:30',
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      cloudwatchLogsExports: ['postgresql'],
      parameterGroup: new rds.ParameterGroup(this, 'DatabaseParameters', {
        engine,
        description: 'Learning Adventure Island dev: TLS only',
        parameters: { 'rds.force_ssl': '1' },
      }),
    });
    // L2 properties that cannot take parameter tokens: set them on the L1 resource.
    const cfnDatabase = this.database.node.defaultChild as rds.CfnDBInstance;
    cfnDatabase.dbInstanceClass = dbClass.valueAsString;
    cfnDatabase.allocatedStorage = dbStorage.valueAsString;
    cfnDatabase.maxAllocatedStorage = dbMaxStorage.valueAsNumber;
    cfnDatabase.multiAz = Fn.conditionIf(multiAz.logicalId, true, false);
    cfnDatabase.deletionProtection = Fn.conditionIf(deletionProtected.logicalId, true, false);
    cfnDatabase.backupRetentionPeriod = dbBackupRetention.valueAsNumber;
    this.database.node.addDependency(databaseLogs);
    const databaseSecret = this.database.secret!;

    // =============================================================================================
    // Instance role
    // =============================================================================================
    this.instanceRole = new iam.Role(this, 'InstanceRole', {
      // The name LaiAiGuardrail-dev attaches `lai-django-ai-dev` to.
      roleName: DEV_INSTANCE_ROLE,
      description:
        'Django dev EC2 (native): SSM, settings, database secret, releases, jobs, speech, logs',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        // LaiAssetStorage-dev: the asset bucket's objects only.
        iam.ManagedPolicy.fromManagedPolicyName(
          this,
          'AssetStoragePolicy',
          `lai-django-asset-storage-${DEV}`,
        ),
        // LaiChildPhotos-dev: child photo objects only.
        iam.ManagedPolicy.fromManagedPolicyName(
          this,
          'ChildPhotoStoragePolicy',
          `lai-django-child-photos-${DEV}`,
        ),
        // LaiProcessing-dev: processing queues and objects only. Deploy LaiProcessing-dev
        // first: attaching a policy that does not exist yet fails this stack's update.
        iam.ManagedPolicy.fromManagedPolicyName(
          this,
          'ProcessingPolicy',
          djangoProcessingPolicyName(DEV),
        ),
        // `lai-django-ai-dev` is attached by LaiAiGuardrail-dev, deployed after this stack.
      ],
    });
    const allow = (
      role: iam.Role,
      sid: string,
      actions: string[],
      resources: string[],
      conditions?: Record<string, unknown>,
    ) => role.addToPolicy(new iam.PolicyStatement({ sid, actions, resources, conditions }));
    const ssmRead = ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'];
    const role = this.instanceRole;
    allow(role, 'ReadRuntimeSettings', ssmRead, [
      parameterArn('django'),
      parameterArn('django/*'),
      parameterArn('deploy'),
      parameterArn('deploy/*'),
      parameterArn('power'),
      parameterArn('power/*'),
      parameterArn('bootstrap/*'),
    ]);
    allow(role, 'RecordReleases', ['ssm:PutParameter'], [parameterArn('deploy/*')]);
    allow(role, 'DecryptSecureStrings', ['kms:Decrypt'], ['*'], {
      StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` },
    });
    allow(
      role,
      'ReadDatabaseSecret',
      ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      [databaseSecret.secretArn],
    );
    allow(role, 'DescribeDatabase', ['rds:DescribeDBInstances'], [databaseArn]);
    allow(role, 'ReadReleases', ['s3:GetObject'], [`${artifactBucketArn}/releases/*`]);
    allow(role, 'ReadJobResults', ['s3:GetObject'], [`${artifactBucketArn}/jobs/results/*`]);
    allow(role, 'ListArtifacts', ['s3:ListBucket'], [artifactBucketArn], {
      StringLike: { 's3:prefix': ['releases/*', 'jobs/results/*'] },
    });
    allow(
      role,
      'SpeechObjects',
      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      [speechBucket.arnForObjects('speech/*')],
    );
    allow(role, 'ListSpeech', ['s3:ListBucket'], [speechBucket.bucketArn], {
      StringLike: { 's3:prefix': ['speech/*'] },
    });
    // Django synthesizes speech itself when the jobs backend is off (lai/apps/speech/polly.py).
    allow(role, 'Speech', ['polly:SynthesizeSpeech', 'polly:DescribeVoices'], ['*']);
    allow(
      role,
      'SubmitJobs',
      ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
      [aiQueue.main.queueArn, mediaQueue.main.queueArn],
    );
    allow(
      role,
      'ConsumeJobResults',
      [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:ChangeMessageVisibility',
        'sqs:GetQueueAttributes',
      ],
      [resultsQueue.main.queueArn],
    );
    allow(
      role,
      'WriteLogs',
      ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
      instanceLogs.flatMap((group) => [group.logGroupArn, `${group.logGroupArn}:*`]),
    );
    allow(role, 'FindLogGroups', ['logs:DescribeLogGroups'], ['*']);
    allow(role, 'PublishMetrics', ['cloudwatch:PutMetricData'], ['*'], {
      StringEquals: { 'cloudwatch:namespace': DEV_METRICS_NAMESPACE },
    });
    // certbot-dns-route53 (DNS-01) only when the zone is in this account's Route 53.
    new iam.CfnPolicy(this, 'CertbotDnsPolicy', {
      policyName: 'certbot-dns-01',
      roles: [role.roleName],
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AcmeChallengeRecords',
            Effect: 'Allow',
            Action: 'route53:ChangeResourceRecordSets',
            Resource: `arn:${partition}:route53:::hostedzone/${hostedZoneId.valueAsString}`,
            Condition: {
              'ForAllValues:StringLike': {
                'route53:ChangeResourceRecordSetsNormalizedRecordNames': ['_acme-challenge.*'],
              },
              'ForAllValues:StringEquals': {
                'route53:ChangeResourceRecordSetsRecordTypes': ['TXT'],
              },
            },
          },
          {
            Sid: 'FindZoneAndChanges',
            Effect: 'Allow',
            Action: ['route53:ListHostedZones', 'route53:GetChange'],
            Resource: '*',
          },
        ],
      },
    }).cfnOptions.condition = hasZone;

    // =============================================================================================
    // Runtime settings (plain values; DJANGO_SECRET_KEY is a SecureString the installer writes)
    // =============================================================================================
    const jobsBackend = Token.asString(Fn.conditionIf(lambdaOn.logicalId, 'sqs', 'disabled'));
    const settings: Record<string, string> = {
      DJANGO_ALLOWED_HOSTS: `${apiDomain},${adminDomain}`,
      DJANGO_CSRF_TRUSTED_ORIGINS: `https://${adminDomain}`,
      COGNITO_REGION: Fn.select(0, Fn.split('_', cognitoPoolId)),
      COGNITO_USER_POOL_ID: cognitoPoolId,
      COGNITO_ALLOWED_CLIENT_IDS: cognitoClientId,
      LAI_ASSET_STORAGE: 's3',
      LAI_ASSET_BUCKET: assetBucketName,
      LAI_ASSET_REGION: region,
      LAI_CHILD_PHOTO_STORAGE: 's3',
      LAI_CHILD_PHOTOS_BUCKET: `lai-child-photos-${DEV}-${account}-${region}`,
      LAI_CHILD_PHOTOS_REGION: region,
      LAI_SPEECH_STORAGE: 's3',
      LAI_SPEECH_BUCKET: speechBucketName(account, region),
      LAI_JOBS_BACKEND: jobsBackend,
      LAI_JOBS_AI_QUEUE_URL: aiQueue.main.queueUrl,
      LAI_JOBS_MEDIA_QUEUE_URL: mediaQueue.main.queueUrl,
      LAI_JOBS_RESULTS_QUEUE_URL: resultsQueue.main.queueUrl,
      LAI_JOBS_RESULTS_BUCKET: artifactBucketName,
      LAI_STUDIO_RUN_MODE: Token.asString(Fn.conditionIf(lambdaOn.logicalId, 'jobs', 'manual')),
    };
    for (const [name, value] of Object.entries(settings)) {
      new ssm.StringParameter(this, `Setting${name}`, {
        parameterName: `/lai/${DEV}/django/${name}`,
        stringValue: value,
        description: `Managed by ${DEV_PLATFORM_STACK}; change through the stack`,
      });
    }
    // Initial values only: the instance, the power state machine and the operator change them.
    const runtimeParameters: Record<string, string> = {
      'power/schedule-paused': 'false',
      'power/hold-until': 'none',
      'power/state': 'running',
      'power/last-result': '{}',
      'deploy/pending': 'none',
      'deploy/apply-pending-on-start': 'true',
    };
    for (const [name, value] of Object.entries(runtimeParameters)) {
      new ssm.StringParameter(this, `Runtime${kebabToPascal(name.replace('/', '-'))}`, {
        parameterName: `/lai/${DEV}/${name}`,
        stringValue: value,
        description: `Initial value from ${DEV_PLATFORM_STACK}; changed at run time`,
      });
    }

    // =============================================================================================
    // Instance
    // =============================================================================================
    const setupEnvironment: Record<string, string> = {
      LAI_ENV: DEV,
      AWS_REGION: region,
      LAI_API_HOST: apiDomain,
      LAI_ADMIN_HOST: adminDomain,
      LAI_SITE_HOST: siteDomain,
      LAI_DB_SECRET_ARN: databaseSecret.secretArn,
      LAI_DB_INSTANCE_ID: DEV_DATABASE_ID,
      LAI_ARTIFACT_BUCKET: artifactBucketName,
      LAI_LOG_GROUP_PREFIX: `/lai/${DEV}`,
      LAI_ACME_MODE: acmeMode,
      LAI_HOSTED_ZONE_ID: hostedZoneId.valueAsString,
      LAI_CERT_EMAIL: certificateEmail.valueAsString,
      LAI_SWAP_MB: swapSize.valueAsString,
    };
    const setupLines = bashWrapper(readScript('native/setup-native.sh'), setupEnvironment);
    const userData = ec2.UserData.forLinux();
    userData.addCommands(...setupLines);
    const instanceSubnet = vpc.publicSubnets[0];
    this.instance = new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { subnets: [instanceSubnet] },
      associatePublicIpAddress: true,
      instanceType: new ec2.InstanceType(instanceType.valueAsString),
      machineImage: {
        getImage: () => ({
          imageId: amiId.valueAsString,
          osType: ec2.OperatingSystemType.LINUX,
          userData,
        }),
      },
      userData,
      role,
      securityGroup: instanceSg,
      // IMDSv2 only, hop limit 1: only host processes (gunicorn, agents) reach the credentials.
      httpTokens: ec2.HttpTokens.REQUIRED,
      httpPutResponseHopLimit: 1,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(15, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });
    this.instance.addSecurityGroup(originSg);
    const cfnInstance = this.instance.node.defaultChild as ec2.CfnInstance;
    cfnInstance.addPropertyOverride(
      'BlockDeviceMappings.0.Ebs.VolumeSize',
      volumeSize.valueAsNumber,
    );
    Tags.of(this.instance).add('Name', `lai-${DEV}`);
    Tags.of(this.instance).add('lai:deploy-target', DEV);
    this.instance.node.addDependency(this.database); // the first boot can reach the database
    for (const group of instanceLogs) this.instance.node.addDependency(group);
    const instanceId = this.instance.instanceId;
    const instanceArn = `arn:${partition}:ec2:${region}:${account}:instance/${instanceId}`;

    const eip = new ec2.CfnEIP(this, 'ElasticIp', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: `lai-${DEV}` }],
    });
    new ec2.CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: eip.attrAllocationId,
      instanceId,
    });
    for (const [recordId, host] of [
      ['ApiRecord', apiDomain],
      ['AdminRecord', adminDomain],
    ] as const) {
      const record = new route53.CfnRecordSet(this, recordId, {
        hostedZoneId: hostedZoneId.valueAsString,
        name: host,
        type: 'A',
        ttl: '300',
        resourceRecords: [eip.attrPublicIp],
      });
      record.cfnOptions.condition = hasZone;
      // The synth-time check cannot see that Fn::GetAtt PublicIp is an IPv4 address.
      Validations.of(record).acknowledge({
        id: 'CloudFormation-Validate::E3023',
        reason: 'The Elastic IP PublicIp attribute is an IPv4 address',
      });
    }

    // =============================================================================================
    // SSM documents: the only way a release or a command reaches the instance
    // =============================================================================================
    const document = (
      constructId: string,
      name: string,
      description: string,
      parameters: Record<string, unknown>,
      runCommand: string[],
      timeoutSeconds: number,
    ) =>
      new ssm.CfnDocument(this, constructId, {
        name,
        documentType: 'Command',
        updateMethod: 'NewVersion',
        content: {
          schemaVersion: '2.2',
          description,
          parameters,
          mainSteps: [
            {
              action: 'aws:runShellScript',
              name: constructId.replace(/Document$/, '').toLowerCase(),
              inputs: { timeoutSeconds: String(timeoutSeconds), runCommand },
            },
          ],
        },
      });
    const trueFalse = { type: 'String', default: 'false', allowedValues: ['true', 'false'] };
    const onCurrent = (script: string) =>
      `test -x /opt/lai/current/scripts/aws/native/${script} || ` +
      '{ echo "no release on this instance yet" >&2; exit 63; }';
    document(
      'SetupDocument',
      DEV_DOCUMENTS.setup,
      'Rerun the idempotent native instance setup (scripts/aws/native/setup-native.sh). Operators only.',
      {},
      setupLines,
      1800,
    );
    const deployDocument = document(
      'DeployDocument',
      DEV_DOCUMENTS.deploy,
      'Release one Django artifact (by git SHA and checksum): migrate, switch, health check, roll back on failure.',
      {
        GitSha: {
          type: 'String',
          description: 'Full commit SHA',
          allowedPattern: '^[a-f0-9]{40}$',
        },
        ArtifactSha256: {
          type: 'String',
          description: 'SHA-256 of releases/django/<sha>.tar.gz',
          allowedPattern: '^[a-f0-9]{64}$',
        },
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
        AllowOlder: trueFalse,
        AllowDestructiveMigrations: trueFalse,
      },
      bashWrapper(readScript('native/ssm-native-entry.sh'), {
        LAI_REQ_GIT_SHA: '{{ GitSha }}',
        LAI_REQ_ARTIFACT_SHA256: '{{ ArtifactSha256 }}',
        LAI_REQ_COMMIT_EPOCH: '{{ CommitEpoch }}',
        LAI_REQ_RUN_URL: '{{ RunUrl }}',
        LAI_REQ_ALLOW_OLDER: '{{ AllowOlder }}',
        LAI_REQ_ALLOW_DESTRUCTIVE: '{{ AllowDestructiveMigrations }}',
      }),
      1800,
    );
    document(
      'RollbackDocument',
      DEV_DOCUMENTS.rollback,
      'Roll back to the previous (or a given) healthy release on this instance. Never reverses migrations.',
      { ToGitSha: { type: 'String', default: '', allowedPattern: '^$|^[a-f0-9]{40}$' } },
      [
        "lai_to='{{ ToGitSha }}'",
        onCurrent('rollback-native.sh'),
        'if [ -n "$lai_to" ]; then exec bash /opt/lai/current/scripts/aws/native/rollback-native.sh --to "$lai_to" </dev/null; fi',
        'exec bash /opt/lai/current/scripts/aws/native/rollback-native.sh </dev/null',
      ],
      900,
    );
    document(
      'StatusDocument',
      DEV_DOCUMENTS.status,
      'Show the release, history, services, health, disk and memory. Read only.',
      {},
      [
        onCurrent('status-native.sh'),
        'exec bash /opt/lai/current/scripts/aws/native/status-native.sh </dev/null',
      ],
      120,
    );
    document(
      'BootstrapDocument',
      DEV_DOCUMENTS.bootstrap,
      'One first-time Django task in the current release (bootstrap-native.sh). Operators only.',
      {
        Task: { type: 'String', allowedValues: [...DEV_BOOTSTRAP_TASKS] },
        Argument: {
          type: 'String',
          default: '',
          allowedPattern: '^$|^--dry-run$|^[a-z][a-z0-9_.-]{2,29}$',
        },
      },
      [
        "lai_task='{{ Task }}'",
        "lai_arg='{{ Argument }}'",
        onCurrent('bootstrap-native.sh'),
        'exec bash /opt/lai/current/scripts/aws/native/bootstrap-native.sh "$lai_task" $lai_arg </dev/null',
      ],
      1800,
    );
    document(
      'PowerDocument',
      DEV_DOCUMENTS.power,
      'Power hooks for lai-dev-power: quiesce before a stop, verify (and apply a pending release) after a start.',
      { Action: { type: 'String', allowedValues: ['quiesce', 'verify'] } },
      bashWrapper(readScript('native/power-native.sh'), { LAI_REQ_ACTION: '{{ Action }}' }),
      1800,
    );

    // =============================================================================================
    // Jobs: Lambda workers outside the VPC
    // =============================================================================================
    const workerLogs = {
      ai: logGroup('AiWorkerLogGroup', `/aws/lambda/${DEV_FUNCTIONS.ai.name}`),
      media: logGroup('MediaWorkerLogGroup', `/aws/lambda/${DEV_FUNCTIONS.media.name}`),
    };
    const workerRole = (kind: 'ai' | 'media', work: sqs.Queue) => {
      const workerRoleResource = new iam.Role(this, `${kind === 'ai' ? 'Ai' : 'Media'}WorkerRole`, {
        roleName: `${DEV_FUNCTIONS[kind].name}-worker`,
        description: `Lambda ${DEV_FUNCTIONS[kind].name}: its queue, results, and the ${kind} services`,
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });
      const group = workerLogs[kind];
      allow(
        workerRoleResource,
        'WriteLogs',
        ['logs:CreateLogStream', 'logs:PutLogEvents'],
        [group.logGroupArn, `${group.logGroupArn}:*`],
      );
      allow(
        workerRoleResource,
        'ConsumeWork',
        [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:ChangeMessageVisibility',
          'sqs:GetQueueAttributes',
        ],
        [work.queueArn],
      );
      allow(workerRoleResource, 'SendResults', ['sqs:SendMessage'], [resultsQueue.main.queueArn]);
      allow(
        workerRoleResource,
        'ResultObjects',
        ['s3:GetObject', 's3:PutObject'],
        [`${artifactBucketArn}/jobs/results/*`],
      );
      allow(workerRoleResource, 'ListResults', ['s3:ListBucket'], [artifactBucketArn], {
        StringLike: { 's3:prefix': ['jobs/results/*'] },
      });
      return workerRoleResource;
    };
    const aiRole = workerRole('ai', aiQueue.main);
    allow(
      aiRole,
      'InvokeModels',
      ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      [
        `arn:${partition}:bedrock:*::foundation-model/*`,
        `arn:${partition}:bedrock:*:${account}:inference-profile/*`,
      ],
    );
    allow(
      aiRole,
      'ApplyGuardrail',
      ['bedrock:ApplyGuardrail'],
      [`arn:${partition}:bedrock:${region}:${account}:guardrail/*`],
    );
    allow(
      aiRole,
      'ReadAiSettings',
      ['ssm:GetParameter', 'ssm:GetParameters'],
      [parameterArn('django/LAI_AI_*'), parameterArn('django/LAI_STUDIO_*')],
    );
    allow(aiRole, 'DecryptSecureStrings', ['kms:Decrypt'], ['*'], {
      StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` },
    });
    const mediaRole = workerRole('media', mediaQueue.main);
    allow(mediaRole, 'Speech', ['polly:SynthesizeSpeech'], ['*']);
    allow(
      mediaRole,
      'SpeechObjects',
      ['s3:GetObject', 's3:PutObject'],
      [speechBucket.arnForObjects('speech/*')],
    );
    allow(mediaRole, 'ListSpeech', ['s3:ListBucket'], [speechBucket.bucketArn], {
      StringLike: { 's3:prefix': ['speech/*'] },
    });
    allow(mediaRole, 'ReadAssets', ['s3:GetObject'], [`${assetBucketArn}/*`]);

    const worker = (kind: 'ai' | 'media', workerRoleResource: iam.Role, work: sqs.Queue) => {
      const spec = DEV_FUNCTIONS[kind];
      const prefix = kind === 'ai' ? 'Ai' : 'Media';
      const fn = new lambda.CfnFunction(this, `${prefix}Worker`, {
        functionName: spec.name,
        description: `Learning Adventure Island dev ${kind} jobs worker`,
        runtime: 'python3.12',
        architectures: ['arm64'],
        handler: WORKER_HANDLER,
        code: { s3Bucket: artifactBucketName, s3Key: workerCodeKey.valueAsString },
        role: workerRoleResource.roleArn,
        timeout: spec.timeoutSeconds,
        memorySize: lambdaMemory.valueAsNumber,
        loggingConfig: { logGroup: workerLogs[kind].logGroupName, logFormat: 'Text' },
        environment: {
          variables: {
            LAI_ENV: DEV,
            LAI_WORKER_QUEUE: kind,
            LAI_RESULTS_QUEUE_URL: resultsQueue.main.queueUrl,
            LAI_RESULTS_BUCKET: artifactBucketName,
            LAI_SPEECH_BUCKET: speechBucketName(account, region),
            LAI_ASSET_BUCKET: assetBucketName,
            LAI_SSM_PREFIX: `/lai/${DEV}/django`,
          },
        },
      });
      fn.cfnOptions.condition = lambdaOn;
      // Permissions first (the role itself is already referenced).
      const permissions = workerRoleResource.node.findChild('DefaultPolicy');
      fn.node.addDependency(permissions);
      const mapping = new lambda.CfnEventSourceMapping(this, `${prefix}WorkerTrigger`, {
        functionName: fn.ref,
        eventSourceArn: work.queueArn,
        batchSize: 1,
        functionResponseTypes: ['ReportBatchItemFailures'],
        scalingConfig: { maximumConcurrency: lambdaConcurrency.valueAsNumber },
        enabled: true,
      });
      mapping.cfnOptions.condition = lambdaOn;
      mapping.node.addDependency(permissions);
      return fn;
    };
    worker('ai', aiRole, aiQueue.main);
    worker('media', mediaRole, mediaQueue.main);

    // =============================================================================================
    // Power: Step Functions, Scheduler, the RDS seven-day restart
    // =============================================================================================
    const power = new PowerStateMachine(this, 'Power', {
      instanceId,
      instanceArn,
      databaseIdentifier: DEV_DATABASE_ID,
      databaseArn,
      powerDocumentName: DEV_DOCUMENTS.power,
      powerDocumentArn: documentArn(DEV_DOCUMENTS.power),
      powerParameterArn: (name) => parameterArn(`power/${name}`),
      logGroup: powerLogs,
    });
    const stateMachine = power.stateMachine;

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: 'lai-dev-power-scheduler',
      description: 'EventBridge Scheduler: start lai-dev-power executions',
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': account } },
      }),
    });
    allow(schedulerRole, 'StartPower', ['states:StartExecution'], [stateMachine.stateMachineArn]);
    // cron(Minutes Hours Day-of-month Month Day-of-week Year), unpadded numbers (HOUR_PATTERN).
    type ScheduleTime = { hour: CfnParameter; minute: CfnParameter };
    const cron = (time: ScheduleTime) =>
      `cron(${time.minute.valueAsString} ${time.hour.valueAsString} * * ? *)`;
    const schedule = (
      constructId: string,
      name: string,
      time: ScheduleTime,
      action: 'start' | 'stop',
      description: string,
    ) =>
      new scheduler.CfnSchedule(this, constructId, {
        name,
        groupName: 'default',
        description,
        scheduleExpression: cron(time),
        scheduleExpressionTimezone: scheduleTimezone.valueAsString,
        flexibleTimeWindow: { mode: 'OFF' },
        state: Token.asString(Fn.conditionIf(scheduleOn.logicalId, 'ENABLED', 'DISABLED')),
        target: {
          arn: stateMachine.stateMachineArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ action, source: 'schedule', force: false }),
          retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
        },
      });
    const stopSchedule = schedule(
      'NightlyStop',
      DEV_SCHEDULES.stop,
      shutdownTime,
      'stop',
      'Stop the dev EC2 instance and database (skipped while paused or held)',
    );
    const startSchedule = schedule(
      'MorningStart',
      DEV_SCHEDULES.start,
      startupTime,
      'start',
      `Start the dev database and EC2 instance; ready about ${warmupMinutes.valueAsString} minutes later`,
    );
    const schedulerPermissions = schedulerRole.node.findChild('DefaultPolicy');
    stopSchedule.node.addDependency(schedulerPermissions);
    startSchedule.node.addDependency(schedulerPermissions);

    new events.Rule(this, 'DatabaseAutoStartRule', {
      ruleName: 'lai-dev-rds-auto-start',
      description: 'RDS restarted lai-dev after seven days stopped: stop it again (RDS-EVENT-0154)',
      eventPattern: {
        source: ['aws.rds'],
        detailType: ['RDS DB Instance Event'],
        detail: { EventID: ['RDS-EVENT-0154'], SourceIdentifier: [DEV_DATABASE_ID] },
      },
      targets: [
        new eventTargets.SfnStateMachine(stateMachine, {
          input: events.RuleTargetInput.fromObject({
            action: 'stop',
            source: 'rds-event',
            force: false,
          }),
          retryAttempts: 2,
        }),
      ],
    });

    // =============================================================================================
    // GitHub OIDC roles (deploy and operate; neither can start or stop anything directly)
    // =============================================================================================
    const provider = new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIdList: ['sts.amazonaws.com'],
    });
    provider.cfnOptions.condition = oidcCreated;
    provider.applyRemovalPolicy(RemovalPolicy.RETAIN);
    // A reference only when this stack creates the provider, so the role waits for it.
    const providerArn = Token.asString(
      Fn.conditionIf(oidcCreated.logicalId, provider.attrArn, githubOidcProviderArn()),
    );
    const githubRole = (constructId: string, roleName: string, githubEnvironment: string) =>
      new iam.Role(this, constructId, {
        roleName,
        description: `GitHub Actions environment ${githubEnvironment} (native dev)`,
        assumedBy: githubPrincipal(
          providerArn,
          `repo:${githubRepository}:environment:${githubEnvironment}`,
        ),
        maxSessionDuration: Duration.hours(1),
      });
    const sendCommandAnywhere = [
      'ssm:GetCommandInvocation',
      'ssm:ListCommandInvocations',
      'ssm:ListCommands',
      'ssm:DescribeInstanceInformation',
    ];
    const devStacks = [
      `arn:${partition}:cloudformation:${region}:${account}:stack/${DEV_PLATFORM_STACK}/*`,
      `arn:${partition}:cloudformation:${region}:${account}:stack/LaiDevArtifacts-${DEV}/*`,
      `arn:${partition}:cloudformation:*:${account}:stack/LaiFrontend-${DEV}/*`,
    ];

    const backendRole = githubRole(
      'BackendDeploymentRole',
      'lai-dev-backend-deploy',
      'dev-backend',
    );
    allow(
      backendRole,
      'UploadArtifacts',
      ['s3:PutObject', 's3:GetObject'],
      [`${artifactBucketArn}/releases/django/*`, `${artifactBucketArn}/lambda/*`],
    );
    allow(backendRole, 'ListArtifacts', ['s3:ListBucket'], [artifactBucketArn], {
      StringLike: { 's3:prefix': ['releases/django/*', 'lambda/*'] },
    });
    allow(
      backendRole,
      'RunReleaseDocuments',
      ['ssm:SendCommand'],
      [
        documentArn(DEV_DOCUMENTS.deploy),
        documentArn(DEV_DOCUMENTS.rollback),
        documentArn(DEV_DOCUMENTS.status),
        instanceArn,
      ],
    );
    allow(backendRole, 'FollowCommands', sendCommandAnywhere, ['*']);
    allow(
      backendRole,
      'DeployState',
      ['ssm:GetParameter', 'ssm:PutParameter'],
      [parameterArn('deploy/*')],
    );
    allow(backendRole, 'PowerState', ['ssm:GetParameter'], [parameterArn('power/*')]);
    allow(backendRole, 'FindInstance', ['ec2:DescribeInstances'], ['*']);
    allow(
      backendRole,
      'UpdateWorkers',
      ['lambda:UpdateFunctionCode', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration'],
      [functionArn(DEV_FUNCTIONS.ai.name), functionArn(DEV_FUNCTIONS.media.name)],
    );
    allow(backendRole, 'ReadStackOutputs', ['cloudformation:DescribeStacks'], devStacks);
    allow(
      backendRole,
      'ReadDeployLogs',
      ['logs:GetLogEvents', 'logs:FilterLogEvents'],
      [deployLogs.logGroupArn, `${deployLogs.logGroupArn}:*`],
    );

    const infraRole = githubRole(
      'InfrastructureManagementRole',
      'lai-dev-infra-manage',
      'dev-infrastructure',
    );
    allow(
      infraRole,
      'StartPower',
      ['states:StartExecution', 'states:ListExecutions'],
      [stateMachineArn],
    );
    allow(
      infraRole,
      'FollowPower',
      ['states:DescribeExecution', 'states:GetExecutionHistory'],
      [`arn:${partition}:states:${region}:${account}:execution:${POWER_STATE_MACHINE_NAME}:*`],
    );
    allow(
      infraRole,
      'PowerSettings',
      ['ssm:GetParameter', 'ssm:PutParameter'],
      [parameterArn('power/*')],
    );
    allow(infraRole, 'DeployState', ['ssm:GetParameter'], [parameterArn('deploy/*')]);
    allow(
      infraRole,
      'RunStatusAndPendingDeploy',
      ['ssm:SendCommand'],
      [documentArn(DEV_DOCUMENTS.status), documentArn(DEV_DOCUMENTS.deploy), instanceArn],
    );
    allow(infraRole, 'FollowCommands', sendCommandAnywhere, ['*']);
    allow(
      infraRole,
      'ReadSchedules',
      ['scheduler:GetSchedule'],
      Object.values(DEV_SCHEDULES).map(
        (name) => `arn:${partition}:scheduler:${region}:${account}:schedule/default/${name}`,
      ),
    );
    allow(infraRole, 'DescribeInstances', ['ec2:DescribeInstances'], ['*']);
    allow(infraRole, 'DescribeDatabase', ['rds:DescribeDBInstances'], [databaseArn]);
    allow(infraRole, 'ReadStackOutputs', ['cloudformation:DescribeStacks'], devStacks);
    allow(
      infraRole,
      'ReadLogs',
      ['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'],
      [
        `arn:${partition}:logs:${region}:${account}:log-group:/lai/${DEV}/*`,
        `arn:${partition}:logs:${region}:${account}:log-group:/lai/${DEV}/*:*`,
      ],
    );

    // =============================================================================================
    // Alarms and budget
    // =============================================================================================
    const topic = new sns.Topic(this, 'AlarmTopic', {
      // The name LaiAiGuardrail-dev sends its alarms and Bedrock budget to.
      topicName: `lai-django-alarms-${DEV}`,
      enforceSSL: true,
    });
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowBudgetsPublish',
        actions: ['sns:Publish'],
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        resources: [topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': account } },
      }),
    );
    new sns.CfnSubscription(this, 'AlarmEmailSubscription', {
      topicArn: topic.topicArn,
      protocol: 'email',
      endpoint: alarmEmail.valueAsString,
    }).cfnOptions.condition = hasEmail;
    const notify = new cwActions.SnsAction(topic);
    const gte = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const gt = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
    const alarm = (
      alarmId: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      comparisonOperator: cloudwatch.ComparisonOperator,
      evaluationPeriods: number,
    ) => {
      const created = new cloudwatch.Alarm(this, alarmId, {
        alarmName: `lai-${DEV}-${kebab(alarmId)}`,
        alarmDescription: description,
        metric,
        threshold,
        comparisonOperator,
        evaluationPeriods,
        // The environment is stopped every night: no data is normal.
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      created.addAlarmAction(notify);
      return created;
    };
    const instanceMetric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: DEV_METRICS_NAMESPACE,
        metricName,
        dimensionsMap: { InstanceId: instanceId },
        statistic: 'Maximum',
        period: Duration.minutes(5),
      });
    alarm(
      'MemoryHigh',
      'Dev instance memory above 90%',
      instanceMetric('mem_used_percent'),
      90,
      gt,
      2,
    );
    alarm('DiskHigh', 'Dev root disk above 85%', instanceMetric('disk_used_percent'), 85, gt, 1);
    for (const [name, q] of [
      ['Ai', aiQueue],
      ['Media', mediaQueue],
      ['Results', resultsQueue],
    ] as const) {
      alarm(
        `${name}DeadLetters`,
        `${q.dlq.node.id}: a ${name.toLowerCase()} job message failed three times`,
        q.dlq.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
          statistic: 'Maximum',
        }),
        1,
        gte,
        1,
      );
    }
    // Processing (LAI-LAMBDA-006): metric filters on /lai/dev/jobs, the group this stack owns and
    // the CloudWatch agent ships jobs-completions.log and jobs-reconcile.log to (setup-native.sh).
    // No default value: a quiet night publishes nothing, and missing data is not breaching.
    const logAlarms = processingLogAlarms(props.processingLogAlarms);
    for (const [name, event] of Object.entries(PROCESSING_LOG_EVENTS)) {
      const settings = logAlarms[name as ProcessingLogAlarm];
      new logs.MetricFilter(this, `Processing${name}Filter`, {
        logGroup: jobsLogs,
        // A quoted term: the fixed event name, matched as written (it contains '.' and ' ').
        filterPattern: logs.FilterPattern.literal(`"${event}"`),
        metricNamespace: PROCESSING_LOG_METRICS_NAMESPACE,
        metricName: name,
        metricValue: '1',
      });
      alarm(
        `Processing${name}`,
        `${event} logged ${settings.threshold} or more times in ${settings.periodMinutes} min` +
          ` (${settings.evaluationPeriods} period(s)); runbook: docs/processing/OPERATIONS.md`,
        new cloudwatch.Metric({
          namespace: PROCESSING_LOG_METRICS_NAMESPACE,
          metricName: name,
          statistic: 'Sum',
          period: Duration.minutes(settings.periodMinutes),
        }),
        settings.threshold,
        gte,
        settings.evaluationPeriods,
      );
    }
    alarm(
      'DatabaseStorageLow',
      'Dev database has under 2 GB free',
      this.database.metricFreeStorageSpace({ period: Duration.minutes(5), statistic: 'Minimum' }),
      2 * 1024 ** 3,
      cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      1,
    );
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `lai-${DEV}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyBudget.valueAsNumber, unit: 'USD' },
        // Needs the `Environment` cost allocation tag activated in Billing; without it the
        // budget sees no cost (the account is shared with other projects, so no account budget).
        costFilters: { TagKeyValue: [`user:Environment$${DEV}`] },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alarmEmail.valueAsString }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alarmEmail.valueAsString }],
        },
      ],
    }).cfnOptions.condition = hasEmail;

    // =============================================================================================
    // Outputs (no secrets)
    // =============================================================================================
    const outputs: Record<(typeof DEV_PLATFORM_OUTPUTS)[number], [string, string]> = {
      Environment: [environment.valueAsString, 'The environment'],
      AWSRegion: [region, 'Region of the platform'],
      InstanceId: [instanceId, 'The Django instance (SSM target)'],
      InstanceType: [instanceType.valueAsString, 'EC2 instance type'],
      ElasticIPAddress: [
        eip.attrPublicIp,
        'Point the API and admin A records here without Route 53',
      ],
      DatabaseIdentifier: [this.database.instanceIdentifier, 'RDS instance identifier'],
      DatabaseEndpoint: [this.database.dbInstanceEndpointAddress, 'RDS endpoint (private)'],
      DatabasePort: [this.database.dbInstanceEndpointPort, 'RDS port'],
      DatabaseSecretArn: [databaseSecret.secretArn, 'RDS master credentials (Secrets Manager ARN)'],
      AssetBucketName: [assetBucketName, 'LaiAssetStorage-dev bucket'],
      SpeechBucketName: [speechBucket.bucketName, 'Speech audio bucket'],
      ArtifactBucketName: [artifactBucketName, 'LaiDevArtifacts-dev bucket'],
      LambdaProcessingQueueUrl: [aiQueue.main.queueUrl, 'AI work queue'],
      LambdaMediaQueueUrl: [mediaQueue.main.queueUrl, 'Media work queue'],
      LambdaResultsQueueUrl: [resultsQueue.main.queueUrl, 'Job results queue'],
      AiWorkerFunctionName: [
        Token.asString(Fn.conditionIf(lambdaOn.logicalId, DEV_FUNCTIONS.ai.name, 'none')),
        "AI worker function ('none' when EnableLambdaProcessing is false)",
      ],
      MediaWorkerFunctionName: [
        Token.asString(Fn.conditionIf(lambdaOn.logicalId, DEV_FUNCTIONS.media.name, 'none')),
        "Media worker function ('none' when EnableLambdaProcessing is false)",
      ],
      ShutdownScheduleName: [stopSchedule.ref, 'EventBridge Scheduler nightly stop'],
      StartupScheduleName: [startSchedule.ref, 'EventBridge Scheduler morning start'],
      PowerStateMachineArn: [stateMachine.stateMachineArn, 'Step Functions lai-dev-power'],
      InfrastructureManagementRoleArn: [
        infraRole.roleArn,
        'dev-infrastructure environment: LAI_DEV_INFRA_ROLE_ARN',
      ],
      BackendDeploymentRoleArn: [
        backendRole.roleArn,
        'dev-backend environment: LAI_DEV_BACKEND_ROLE_ARN',
      ],
      SiteUrl: [`https://${siteDomain}`, 'The React site (LaiFrontend-dev)'],
      ApiBaseUrl: [`https://${apiDomain}`, 'dev-backend environment: LAI_API_BASE_URL'],
      AdminBaseUrl: [`https://${adminDomain}/admin/`, 'The Django Admin sign-in page'],
      DeployDocumentName: [deployDocument.ref, 'SSM document for a release'],
      ParameterPrefix: [`/lai/${DEV}/`, 'SSM parameters: django/, deploy/, power/'],
    };
    for (const [name, [value, description]] of Object.entries(outputs)) {
      // Construct ids differ from the parameters of the same name (Environment, InstanceType);
      // CloudFormation keeps outputs in their own section.
      new CfnOutput(this, `Output${name}`, { value, description }).overrideLogicalId(name);
    }
  }
}

function kebabToPascal(name: string): string {
  return name
    .split(/[-/]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}
