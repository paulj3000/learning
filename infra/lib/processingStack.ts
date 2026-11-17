import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { AssetEnvironment } from './assetStorageStack';
import { processingRepositoryName, processingWorkerName } from './processingImagesStack';

/**
 * `LaiProcessing-<env>` (LAI-LAMBDA-005, ADR-061, ADR-062): the contract-kind processing
 * pipeline's AWS side, for dev and prod alike. Names, settings and defaults are frozen in
 * docs/processing/WAVE2_INTERFACES.md sections 3, 4, 5 and 7; the design is in
 * docs/infrastructure/processing-infrastructure.md.
 *
 *   Django (outbox relay) -> work queue -> Lambda worker (container image by digest, arm64,
 *     outside any VPC) -> completion queue -> Django (completion consumer)
 *   The worker reads `assets/*` of the asset bucket and `processing/quarantine/<env>/*`, and
 *   writes only `processing/artifacts/<env>/*` of this stack's private processing bucket.
 *
 * Two-phase provisioning in the bootstrapless model: without `workerImageDigest` the stack has
 * the bucket, queues, roles, policies, settings (`LAI_PROCESSING_BACKEND=disabled`) and queue
 * alarms but no function, event source mapping or function alarms. Once an image is pushed to
 * `LaiProcessingImages-<env>`'s repository, the stack is deployed again with its digest; that
 * adds the worker and switches the backend to `sqs`. Leaving the digest out of a later deploy
 * removes the worker again (queued work then waits up to the retention period).
 *
 * Nothing here dispatches on S3 events: work comes only from Django's outbox (SECURITY.md,
 * "Output-trigger loops"). The worker role has no database, Secrets Manager, SSM secret,
 * Bedrock or Cognito access. Deploying the stack is an owner-approved step (ADR-019 G7).
 */

export const PROCESSING_STACK_PREFIX = 'LaiProcessing';
/** The Lambda handler (WAVE2_INTERFACES section 7), set on the image configuration. */
export const PROCESSING_WORKER_HANDLER = 'lai_processing_runtime.lambda_handler.handler';
/** The Wave 1 worker ceiling (`PLATFORM_CEILINGS`); Lambda itself allows 900. */
export const MAX_WORKER_TIMEOUT_SECONDS = 840;
/** The AWS guidance for an SQS event source: visibility at least six times the function timeout. */
export const VISIBILITY_FACTOR = 6;
export const MAX_RECEIVE_COUNT = 5;
export const RETENTION_DAYS = 14;
export const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
/** Store prefixes (WAVE2_INTERFACES section 3); the namespace is the environment. */
export const PROCESSING_PREFIXES = {
  quarantine: 'processing/quarantine/',
  artifacts: 'processing/artifacts/',
  tmp: 'processing/tmp/',
} as const;
/** The Django settings this stack writes under `/lai/<env>/django/` (WAVE2_INTERFACES section 4). */
export const PROCESSING_SETTINGS = [
  'LAI_PROCESSING_BACKEND',
  'LAI_PROCESSING_NAMESPACE',
  'LAI_PROCESSING_WORK_QUEUE_URL',
  'LAI_PROCESSING_COMPLETION_QUEUE_URL',
  'LAI_PROCESSING_BUCKET',
] as const;
/** The worker's environment, exactly (WAVE2_INTERFACES section 4, worker table). */
export const WORKER_ENVIRONMENT_NAMES = [
  'LAI_PROCESSING_NAMESPACE',
  'LAI_PROCESSING_BUCKET',
  'LAI_ASSET_BUCKET',
  'LAI_PROCESSING_COMPLETION_QUEUE_URL',
  'LAI_PROCESSING_CLEANUP_MARGIN_SECONDS',
  'LAI_PROCESSING_LOG_LEVEL',
] as const;

/** `WorkOldestMessage` -> `work-oldest-message` (the alarm naming of the other stacks). */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function processingStackName(envName: AssetEnvironment): string {
  return `${PROCESSING_STACK_PREFIX}-${envName}`;
}

export function processingBucketName(envName: AssetEnvironment, account: string, region: string) {
  return `lai-processing-${envName}-${account}-${region}`;
}

export function processingQueueNames(envName: AssetEnvironment) {
  return {
    work: `lai-${envName}-processing-work`,
    workDlq: `lai-${envName}-processing-work-dlq`,
    completions: `lai-${envName}-processing-completions`,
    completionsDlq: `lai-${envName}-processing-completions-dlq`,
  };
}

export function djangoProcessingPolicyName(envName: AssetEnvironment): string {
  return `lai-django-processing-${envName}`;
}

/** Alarm thresholds. Every value can be overridden through the `processingAlarms` context. */
export interface ProcessingAlarmThresholds {
  /** Work queue `ApproximateAgeOfOldestMessage`, seconds (default 3600). */
  workOldestMessageSeconds: number;
  /** Work queue visible messages, sustained for 15 minutes (default dev 50, prod 200). */
  workQueueDepth: number;
  /**
   * Completion queue `ApproximateAgeOfOldestMessage`, seconds. Django's consumer is stopped
   * overnight in dev, so dev defaults to 43200 (12 hours, above the 00:00 to 08:00 stop);
   * prod defaults to 3600.
   */
  completionOldestMessageSeconds: number;
  /** Lambda `Errors` in 15 minutes (default 1). */
  workerErrors: number;
  /** Lambda `Throttles` in 15 minutes (default 1). */
  workerThrottles: number;
  /** Lambda `Duration` p95 as a fraction of the timeout (default 0.8). */
  durationFractionOfTimeout: number;
  /** `ConcurrentExecutions` as a fraction of the reserved concurrency, rounded up (default 0.9). */
  concurrencyFractionOfReserved: number;
}

export function defaultAlarmThresholds(envName: AssetEnvironment): ProcessingAlarmThresholds {
  return {
    workOldestMessageSeconds: 3600,
    workQueueDepth: envName === 'prod' ? 200 : 50,
    completionOldestMessageSeconds: envName === 'prod' ? 3600 : 43200,
    workerErrors: 1,
    workerThrottles: 1,
    durationFractionOfTimeout: 0.8,
    concurrencyFractionOfReserved: 0.9,
  };
}

export interface WorkerSizing {
  timeoutSeconds: number;
  memoryMb: number;
  ephemeralStorageMb: number;
  reservedConcurrency: number;
  batchSize: number;
  workVisibilitySeconds: number;
  completionVisibilitySeconds: number;
}

export function defaultWorkerSizing(envName: AssetEnvironment): WorkerSizing {
  return {
    timeoutSeconds: 600,
    memoryMb: 2048,
    ephemeralStorageMb: 2048,
    reservedConcurrency: envName === 'prod' ? 5 : 2,
    batchSize: 1,
    workVisibilitySeconds: 3600,
    completionVisibilitySeconds: 300,
  };
}

/** Refuses a sizing that breaks the Wave 1 ceilings or the SQS/Lambda visibility rule. */
export function validateWorkerSizing(sizing: WorkerSizing): void {
  const integer = (name: keyof WorkerSizing, min: number, max: number) => {
    const value = sizing[name];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer from ${min} to ${max}, got ${value}`);
    }
  };
  integer('timeoutSeconds', 30, MAX_WORKER_TIMEOUT_SECONDS);
  integer('memoryMb', 128, 10240);
  integer('ephemeralStorageMb', 512, 10240);
  // An SQS event source mapping's maximumConcurrency is at least 2 and is set to this value.
  integer('reservedConcurrency', 2, 1000);
  integer('batchSize', 1, 10);
  integer('workVisibilitySeconds', 0, 43200);
  integer('completionVisibilitySeconds', 30, 43200);
  const needed = VISIBILITY_FACTOR * sizing.timeoutSeconds * sizing.batchSize;
  if (sizing.workVisibilitySeconds < needed) {
    throw new Error(
      `workVisibilitySeconds (${sizing.workVisibilitySeconds}) must be at least ${VISIBILITY_FACTOR} x ` +
        `timeoutSeconds x batchSize = ${needed}`,
    );
  }
}

function validateThresholds(thresholds: ProcessingAlarmThresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`alarm threshold ${name} must be a positive number, got ${String(value)}`);
    }
  }
  for (const name of ['durationFractionOfTimeout', 'concurrencyFractionOfReserved'] as const) {
    if (thresholds[name] > 1) throw new Error(`alarm threshold ${name} must be at most 1`);
  }
}

export interface ProcessingStackProps extends StackProps {
  envName: AssetEnvironment;
  /**
   * `sha256:<64 hex>` of an image in `lai/processing-<env>`. Absent: phase 1 (no function, event
   * source mapping or function alarms; the backend setting is `disabled`).
   */
  workerImageDigest?: string;
  /** Overrides of {@link defaultWorkerSizing}. */
  sizing?: Partial<WorkerSizing>;
  /** Overrides of {@link defaultAlarmThresholds}. */
  alarms?: Partial<ProcessingAlarmThresholds>;
  /**
   * IAM role ARNs, besides the Django instance role `lai-django-ec2-<env>`, that may send to the
   * work queue and, with the worker role, to the completion queue (for example an operator role
   * that redrives a DLQ). Default none.
   */
  additionalSenderRoleArns?: readonly string[];
}

export class ProcessingStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly workQueue: sqs.Queue;
  readonly workDlq: sqs.Queue;
  readonly completionQueue: sqs.Queue;
  readonly completionDlq: sqs.Queue;
  readonly workerRole: iam.Role;
  readonly djangoPolicy: iam.ManagedPolicy;
  readonly worker?: lambda.CfnFunction;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, { terminationProtection: props.envName === 'prod', ...props });
    const env = props.envName;
    const digest = props.workerImageDigest?.trim() || undefined;
    if (digest !== undefined && !DIGEST_PATTERN.test(digest)) {
      throw new Error(`workerImageDigest must be sha256:<64 hex>, got "${digest}"`);
    }
    const sizing: WorkerSizing = { ...defaultWorkerSizing(env), ...props.sizing };
    validateWorkerSizing(sizing);
    const thresholds: ProcessingAlarmThresholds = {
      ...defaultAlarmThresholds(env),
      ...props.alarms,
    };
    validateThresholds(thresholds);
    const senders = props.additionalSenderRoleArns ?? [];
    for (const arn of senders) {
      if (!/^arn:aws[a-z-]*:iam::[0-9]{12}:role\/[\w+=,.@/-]+$/.test(arn)) {
        throw new Error(`additionalSenderRoleArns must be IAM role ARNs, got "${arn}"`);
      }
    }
    const prod = env === 'prod';
    const partition = Aws.PARTITION;
    const account = Aws.ACCOUNT_ID;
    const region = Aws.REGION;
    const names = processingQueueNames(env);
    const functionName = processingWorkerName(env);
    const retained = RemovalPolicy.RETAIN;
    Tags.of(this).add('Project', 'learning-adventure-island');
    Tags.of(this).add('Component', 'processing');
    Tags.of(this).add('Environment', env);

    // ===========================================================================================
    // Private processing bucket (quarantine inputs, artifacts, scratch)
    // ===========================================================================================
    this.bucket = new s3.Bucket(this, 'ProcessingBucket', {
      bucketName: processingBucketName(env, account, region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      lifecycleRules: [
        {
          id: 'expire-quarantine',
          prefix: PROCESSING_PREFIXES.quarantine,
          expiration: Duration.days(30),
          noncurrentVersionExpiration: Duration.days(1),
        },
        {
          id: 'artifact-versions',
          prefix: PROCESSING_PREFIXES.artifacts,
          noncurrentVersionExpiration: Duration.days(30),
          // Prod keeps current artifacts (reviewed results); dev clears them after 90 days.
          expiration: prod ? undefined : Duration.days(90),
        },
        {
          id: 'expire-tmp',
          prefix: PROCESSING_PREFIXES.tmp,
          expiration: Duration.days(1),
          noncurrentVersionExpiration: Duration.days(1),
        },
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      // Never delete processing data with the stack, in either environment.
      removalPolicy: retained,
    });
    const assetBucketArn = `arn:${partition}:s3:::lai-assets-${env}-${account}-${region}`;
    // By name, like the asset bucket, so the IAM documents read the same in review and template.
    const bucketArn = `arn:${partition}:s3:::${processingBucketName(env, account, region)}`;
    const quarantineObjects = `${bucketArn}/${PROCESSING_PREFIXES.quarantine}${env}/*`;
    const artifactObjects = `${bucketArn}/${PROCESSING_PREFIXES.artifacts}${env}/*`;

    // ===========================================================================================
    // Queues: standard, SSE-SQS, TLS only, 14-day retention, five receives to the DLQ
    // ===========================================================================================
    const queue = (constructId: string, name: string, dlqName: string, visibility: number) => {
      const dlq = new sqs.Queue(this, `${constructId}Dlq`, {
        queueName: dlqName,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(RETENTION_DAYS),
        enforceSSL: true,
        removalPolicy: prod ? retained : RemovalPolicy.DESTROY,
      });
      const main = new sqs.Queue(this, `${constructId}Queue`, {
        queueName: name,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        visibilityTimeout: Duration.seconds(visibility),
        retentionPeriod: Duration.days(RETENTION_DAYS),
        deadLetterQueue: { queue: dlq, maxReceiveCount: MAX_RECEIVE_COUNT },
        enforceSSL: true,
        removalPolicy: prod ? retained : RemovalPolicy.DESTROY,
      });
      return { main, dlq };
    };
    const work = queue('Work', names.work, names.workDlq, sizing.workVisibilitySeconds);
    const completions = queue(
      'Completion',
      names.completions,
      names.completionsDlq,
      sizing.completionVisibilitySeconds,
    );
    this.workQueue = work.main;
    this.workDlq = work.dlq;
    this.completionQueue = completions.main;
    this.completionDlq = completions.dlq;

    // ===========================================================================================
    // Worker log group and role (both exist in phase 1, so the queue policy can name the role)
    // ===========================================================================================
    const logGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: prod ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: prod ? retained : RemovalPolicy.DESTROY,
    });
    this.workerRole = new iam.Role(this, 'WorkerRole', {
      roleName: functionName,
      description: `Lambda ${functionName}: work queue, completion queue, processing objects, logs`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const grant = (sid: string, actions: string[], resources: string[]) =>
      this.workerRole.addToPolicy(new iam.PolicyStatement({ sid, actions, resources }));
    // The log group exists before the function, so the role never needs logs:CreateLogGroup.
    const logGroupArn = `arn:${partition}:logs:${region}:${account}:log-group:/aws/lambda/${functionName}`;
    grant(
      'WriteLogs',
      ['logs:CreateLogStream', 'logs:PutLogEvents'],
      [logGroupArn, `${logGroupArn}:log-stream:*`],
    );
    grant(
      'ConsumeWork',
      [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:ChangeMessageVisibility',
        'sqs:GetQueueAttributes',
      ],
      [this.workQueue.queueArn],
    );
    grant('SendCompletions', ['sqs:SendMessage'], [this.completionQueue.queueArn]);
    grant(
      'ReadInputs',
      ['s3:GetObject', 's3:GetObjectVersion'],
      [`${assetBucketArn}/assets/*`, quarantineObjects],
    );
    grant('WriteArtifacts', ['s3:PutObject'], [artifactObjects]);
    // A redelivered attempt rewrites the same immutable keys. The create-only put answers a
    // conflict (412) by reading the existing object's checksum, so an identical rewrite is an
    // idempotent success; without this read it would be a 403 (permission_denied). Own prefix only.
    grant('VerifyOwnArtifacts', ['s3:GetObject'], [artifactObjects]);
    grant(
      'PullWorkerImage',
      ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
      [`arn:${partition}:ecr:${region}:${account}:repository/${processingRepositoryName(env)}`],
    );

    // ===========================================================================================
    // Queue policies: only Django sends work, only the worker sends completions
    // ===========================================================================================
    const djangoRoleArn = `arn:${partition}:iam::${account}:role/lai-django-ec2-${env}`;
    const onlySenders = (target: sqs.Queue, sid: string, allowed: string[]) =>
      target.addToResourcePolicy(
        new iam.PolicyStatement({
          sid,
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ['sqs:SendMessage'],
          resources: [target.queueArn],
          conditions: { ArnNotEquals: { 'aws:PrincipalArn': allowed } },
        }),
      );
    onlySenders(this.workQueue, 'OnlyDjangoSendsWork', [djangoRoleArn, ...senders]);
    onlySenders(this.completionQueue, 'OnlyTheWorkerSendsCompletions', [
      this.workerRole.roleArn,
      ...senders,
    ]);

    // ===========================================================================================
    // Django: managed policy, attached by name to lai-django-ec2-<env> by the platform stack
    // ===========================================================================================
    this.djangoPolicy = new iam.ManagedPolicy(this, 'DjangoProcessingPolicy', {
      managedPolicyName: djangoProcessingPolicyName(env),
      description:
        'Django processing: send work, consume completions, write quarantine inputs, read artifacts.',
      statements: [
        new iam.PolicyStatement({
          sid: 'SendWork',
          actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
          resources: [this.workQueue.queueArn],
        }),
        new iam.PolicyStatement({
          sid: 'ConsumeCompletions',
          actions: [
            'sqs:ReceiveMessage',
            'sqs:DeleteMessage',
            'sqs:ChangeMessageVisibility',
            'sqs:GetQueueAttributes',
          ],
          resources: [this.completionQueue.queueArn],
        }),
        new iam.PolicyStatement({
          sid: 'DeadLetterStatus',
          actions: ['sqs:GetQueueAttributes'],
          resources: [this.workDlq.queueArn, this.completionDlq.queueArn],
        }),
        new iam.PolicyStatement({
          sid: 'QuarantineObjects',
          actions: ['s3:PutObject', 's3:GetObject'],
          resources: [quarantineObjects],
        }),
        new iam.PolicyStatement({
          sid: 'ReadArtifacts',
          actions: ['s3:GetObject', 's3:GetObjectVersion'],
          resources: [artifactObjects],
        }),
      ],
    });

    // ===========================================================================================
    // Worker function (phase 2 only: needs an image digest)
    // ===========================================================================================
    const topic = sns.Topic.fromTopicArn(
      this,
      'AlarmTopic',
      `arn:${partition}:sns:${region}:${account}:lai-django-alarms-${env}`,
    );
    const notify = new cwActions.SnsAction(topic);
    const alarm = (
      alarmId: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      evaluationPeriods: number,
    ) => {
      const created = new cloudwatch.Alarm(this, alarmId, {
        alarmName: `lai-${env}-processing-${kebab(alarmId)}`,
        alarmDescription: description,
        metric,
        threshold,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      created.addAlarmAction(notify);
      return created;
    };

    if (digest) {
      const imageUri = `${account}.dkr.ecr.${region}.${Aws.URL_SUFFIX}/${processingRepositoryName(env)}@${digest}`;
      const variables: Record<(typeof WORKER_ENVIRONMENT_NAMES)[number], string> = {
        LAI_PROCESSING_NAMESPACE: env,
        LAI_PROCESSING_BUCKET: this.bucket.bucketName,
        LAI_ASSET_BUCKET: `lai-assets-${env}-${account}-${region}`,
        LAI_PROCESSING_COMPLETION_QUEUE_URL: this.completionQueue.queueUrl,
        LAI_PROCESSING_CLEANUP_MARGIN_SECONDS: '60',
        LAI_PROCESSING_LOG_LEVEL: 'INFO',
      };
      const fn = new lambda.CfnFunction(this, 'Worker', {
        functionName,
        description: `Learning Adventure Island ${env} processing worker (contract kinds)`,
        packageType: 'Image',
        code: { imageUri },
        imageConfig: { command: [PROCESSING_WORKER_HANDLER] },
        architectures: ['arm64'],
        role: this.workerRole.roleArn,
        timeout: sizing.timeoutSeconds,
        memorySize: sizing.memoryMb,
        ephemeralStorage: { size: sizing.ephemeralStorageMb },
        reservedConcurrentExecutions: sizing.reservedConcurrency,
        loggingConfig: { logGroup: `/aws/lambda/${functionName}`, logFormat: 'Text' },
        environment: { variables },
      });
      const permissions = this.workerRole.node.findChild('DefaultPolicy');
      fn.node.addDependency(permissions);
      fn.node.addDependency(logGroup);
      const mapping = new lambda.CfnEventSourceMapping(this, 'WorkerTrigger', {
        functionName: fn.ref,
        eventSourceArn: this.workQueue.queueArn,
        batchSize: sizing.batchSize,
        functionResponseTypes: ['ReportBatchItemFailures'],
        scalingConfig: { maximumConcurrency: sizing.reservedConcurrency },
        enabled: true,
      });
      mapping.node.addDependency(permissions);
      this.worker = fn;

      const fnMetric = (metricName: string, statistic: string, minutes: number) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName,
          dimensionsMap: { FunctionName: functionName },
          statistic,
          period: Duration.minutes(minutes),
        });
      alarm(
        'WorkerErrors',
        `${functionName}: invocation errors in 15 minutes`,
        fnMetric('Errors', 'Sum', 15),
        thresholds.workerErrors,
        1,
      );
      alarm(
        'WorkerThrottles',
        `${functionName}: throttled invocations in 15 minutes`,
        fnMetric('Throttles', 'Sum', 15),
        thresholds.workerThrottles,
        1,
      );
      alarm(
        'WorkerDurationHigh',
        `${functionName}: p95 duration near the ${sizing.timeoutSeconds} s timeout`,
        fnMetric('Duration', 'p95', 5),
        Math.round(thresholds.durationFractionOfTimeout * sizing.timeoutSeconds * 1000),
        2,
      );
      alarm(
        'WorkerConcurrencyHigh',
        `${functionName}: concurrency near its reserved ${sizing.reservedConcurrency}`,
        fnMetric('ConcurrentExecutions', 'Maximum', 5),
        Math.max(
          1,
          Math.ceil(thresholds.concurrencyFractionOfReserved * sizing.reservedConcurrency),
        ),
        3,
      );
    }

    // ===========================================================================================
    // Queue alarms (both phases)
    // ===========================================================================================
    const fiveMinutes = { period: Duration.minutes(5), statistic: 'Maximum' };
    alarm(
      'WorkOldestMessage',
      `${names.work}: oldest message older than ${thresholds.workOldestMessageSeconds} s`,
      this.workQueue.metricApproximateAgeOfOldestMessage(fiveMinutes),
      thresholds.workOldestMessageSeconds,
      1,
    );
    alarm(
      'WorkQueueDepth',
      `${names.work}: ${thresholds.workQueueDepth} or more messages waiting for 15 minutes`,
      this.workQueue.metricApproximateNumberOfMessagesVisible(fiveMinutes),
      thresholds.workQueueDepth,
      3,
    );
    alarm(
      'CompletionBacklog',
      `${names.completions}: oldest completion older than ${thresholds.completionOldestMessageSeconds} s (Django consumer behind or stopped)`,
      this.completionQueue.metricApproximateAgeOfOldestMessage(fiveMinutes),
      thresholds.completionOldestMessageSeconds,
      1,
    );
    alarm(
      'WorkDeadLetters',
      `${names.workDlq}: a work message failed ${MAX_RECEIVE_COUNT} times`,
      this.workDlq.metricApproximateNumberOfMessagesVisible(fiveMinutes),
      1,
      1,
    );
    alarm(
      'CompletionDeadLetters',
      `${names.completionsDlq}: a completion failed ${MAX_RECEIVE_COUNT} times`,
      this.completionDlq.metricApproximateNumberOfMessagesVisible(fiveMinutes),
      1,
      1,
    );

    // ===========================================================================================
    // Django settings (SSM String parameters the release renders into the runtime environment)
    // ===========================================================================================
    const settings: Record<(typeof PROCESSING_SETTINGS)[number], string> = {
      LAI_PROCESSING_BACKEND: digest ? 'sqs' : 'disabled',
      LAI_PROCESSING_NAMESPACE: env,
      LAI_PROCESSING_WORK_QUEUE_URL: this.workQueue.queueUrl,
      LAI_PROCESSING_COMPLETION_QUEUE_URL: this.completionQueue.queueUrl,
      LAI_PROCESSING_BUCKET: this.bucket.bucketName,
    };
    for (const [name, value] of Object.entries(settings)) {
      new ssm.StringParameter(this, `Setting${name}`, {
        parameterName: `/lai/${env}/django/${name}`,
        stringValue: value,
        description: `Managed by ${processingStackName(env)}; change through the stack`,
      });
    }

    // ===========================================================================================
    // Outputs (no secrets)
    // ===========================================================================================
    const outputs: Record<string, [string, string]> = {
      ProcessingBucketName: [this.bucket.bucketName, 'Django and worker LAI_PROCESSING_BUCKET'],
      WorkQueueUrl: [this.workQueue.queueUrl, 'Django LAI_PROCESSING_WORK_QUEUE_URL'],
      WorkDeadLetterQueueUrl: [this.workDlq.queueUrl, 'Work DLQ (inspect, then redrive)'],
      CompletionQueueUrl: [
        this.completionQueue.queueUrl,
        'Django LAI_PROCESSING_COMPLETION_QUEUE_URL',
      ],
      CompletionDeadLetterQueueUrl: [this.completionDlq.queueUrl, 'Completion DLQ'],
      WorkerRoleArn: [this.workerRole.roleArn, 'Lambda execution role'],
      WorkerFunctionName: [digest ? functionName : 'none', "'none' until an image digest is given"],
      WorkerImageDigest: [digest ?? 'none', 'The deployed worker image digest (rollback target)'],
      ProcessingBackend: [settings.LAI_PROCESSING_BACKEND, 'Django LAI_PROCESSING_BACKEND'],
      DjangoProcessingPolicyArn: [
        this.djangoPolicy.managedPolicyArn,
        `Attached by name to lai-django-ec2-${env}`,
      ],
    };
    for (const [name, [value, description]] of Object.entries(outputs)) {
      new CfnOutput(this, name, { value, description });
    }
  }
}
