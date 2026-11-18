import {
  Annotations,
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
} from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { processingArtifactsPolicyName } from './assetStorageStack';
import { githubOidcProviderArn, githubPrincipal } from './githubOidc';
import {
  COST_SCOPE_TAG,
  LAYER_KEY_PATTERN,
  PROCESSING_METRICS_NAMESPACE,
  ProcessingWorker,
  RESULTS_QUEUE_MAX_RECEIVES,
  RESULTS_QUEUE_RETENTION_DAYS,
  RESULTS_QUEUE_VISIBILITY_SECONDS,
  WORKER_CODE_KEY_PATTERN,
  WORKLOADS,
  bucketArn,
  ffmpegLayer,
  makeQueue,
  makeWorkQueue,
  numberIf,
  pascal,
  pinEnvironments,
  resultsQueueName,
  sized,
  type QueuePair,
  type Workload,
  type WorkloadSizing,
} from './processingWorkers';

/**
 * Production background processing (ADR-071; LAI-LAMBDA-012 P1-a): the `lai-prod-*` queue
 * family, the five workers, their roles, the results consumer's permissions on the instance role,
 * the worker artifacts bucket, the DLQ redrive role, the GitHub worker release role, alarms and
 * an optional budget. It is a construct of `LaiDjangoEc2-prod` (one stack per environment,
 * ADR-064), added only when the synth flag `prodProcessing=true` is set, so the production
 * template is byte-for-byte unchanged until the owner turns it on. Nothing here is deployed by
 * the repository: provisioning is `scripts/aws/provision.sh prod` with change-set review (owner).
 *
 * Production shares the AWS account with dev and other projects. Isolation is by name
 * (`lai-prod-*`), role, prefix (`processing/artifacts/prod/`, `jobs/results/` in the prod bucket),
 * parameter path (`/lai/prod/`) and the cost allocation tag `CostScope=lai-prod-processing`.
 *
 * Every worker starts disabled (`Enable*` parameters default `false`): queues, roles, alarms and
 * log groups exist, functions and triggers do not, and no queue URL reaches Django, so no message
 * can be submitted to a queue nobody consumes (the RELEASE invariant).
 */

export const PROD = 'prod' as const;
export const PROD_ARTIFACT_BUCKET_PREFIX = 'lai-prod-artifacts';
export const prodArtifactBucketName = () =>
  `${PROD_ARTIFACT_BUCKET_PREFIX}-${Aws.ACCOUNT_ID}-${Aws.REGION}`;
export const PROD_COST_SCOPE = 'lai-prod-processing';
export const PROD_REDRIVE_ROLE = 'lai-prod-jobs-dlq-redrive';
export const PROD_WORKER_RELEASE_ROLE = 'lai-github-workers-prod';
/** The existing protected GitHub environment (required reviewers); no new environment. */
export const PROD_GITHUB_ENVIRONMENT = 'django-prod';
/** Lifecycle of the prod artifacts bucket. Worker zips and release manifests are never expired:
 * rollback by manifest needs every earlier artifact (P2 asks for at least 180 days). */
export const PROD_ARTIFACT_EXPIRATIONS: Record<string, number> = {
  'jobs/results/': 30,
  'tmp/': 1,
};

/** The worker set: which share a zip, and which parameter switches them on. */
const GROUPS = {
  jobs: {
    workloads: ['ai', 'media'] as Workload[],
    enable: 'EnableJobsWorkers',
    code: 'WorkerCodeKey',
  },
  audio: {
    workloads: ['audio'] as Workload[],
    enable: 'EnableAudioWorker',
    code: 'AudioWorkerCodeKey',
  },
  image: {
    workloads: ['image'] as Workload[],
    enable: 'EnableImageWorker',
    code: 'ImageWorkerCodeKey',
  },
  optimize: {
    workloads: ['optimize'] as Workload[],
    enable: 'EnableOptimizeWorker',
    code: 'OptimizeWorkerCodeKey',
  },
} as const;
type Group = keyof typeof GROUPS;

export interface ProductionProcessingOptions {
  /** Define the optimize worker (runtime undecided until ADR-070). Default false. */
  optimizeWorker?: boolean;
  /**
   * Monthly processing budget in USD (P15, owner decision). No default: without it no
   * `AWS::Budgets::Budget` is created and synthesis warns.
   */
  budgetUsd?: number;
  /** Send alarm notifications to the stack's alarm topic (default true). */
  notify?: boolean;
  /** Memory and timeout overrides per workload (context `processingSizing`). */
  sizing?: WorkloadSizing;
}

export interface ProductionProcessingProps extends ProductionProcessingOptions {
  githubRepository: string;
  instanceRole: iam.Role;
  alarmTopic: sns.ITopic;
  /** `/lai/prod/django`: the consumer, outbox relay and sweep log here. */
  appLogs: logs.ILogGroup;
  /** `/lai/prod/deploy`: release scripts. */
  deployLogs: logs.ILogGroup;
}

export class ProductionProcessing extends Construct {
  readonly queues: Partial<Record<Workload, QueuePair>> = {};
  readonly resultsQueue: QueuePair;
  readonly workers: Partial<Record<Workload, ProcessingWorker>> = {};
  readonly artifactBucket: s3.Bucket;
  readonly redriveRole: iam.Role;
  readonly releaseRole: iam.Role;

  constructor(scope: Construct, id: string, props: ProductionProcessingProps) {
    super(scope, id);
    const stack = Stack.of(this);
    Tags.of(this).add('Component', 'processing');
    Tags.of(this).add(COST_SCOPE_TAG, PROD_COST_SCOPE);
    const workloads: Workload[] = ['ai', 'media', 'audio', 'image'];
    if (props.optimizeWorker) workloads.push('optimize');
    const groups: Group[] = ['jobs', 'audio', 'image'];
    if (props.optimizeWorker) groups.push('optimize');

    // --- Parameters (on the stack, so their logical ids are the plain names) --------------------
    const param = (name: string, options: ConstructorParameters<typeof CfnParameter>[2]) =>
      new CfnParameter(stack, name, options);
    const enable: Partial<Record<Group, CfnParameter>> = {};
    const codeKey: Partial<Record<Group, CfnParameter>> = {};
    for (const group of groups) {
      enable[group] = param(GROUPS[group].enable, {
        type: 'String',
        default: 'false',
        allowedValues: ['true', 'false'],
        description: `Create the ${GROUPS[group].workloads.join(' and ')} worker function(s) and trigger(s) (ADR-071; default off)`,
      });
      codeKey[group] = param(GROUPS[group].code, {
        type: 'String',
        default: '',
        allowedPattern: WORKER_CODE_KEY_PATTERN,
        description: `Worker zip in ${PROD_ARTIFACT_BUCKET_PREFIX}-<account>-<region> (lambda/<name>.zip), from the release manifest`,
      });
    }
    const audioLayerKey = param('AudioLayerKey', {
      type: 'String',
      default: '',
      allowedPattern: LAYER_KEY_PATTERN,
      description: 'LGPL FFmpeg layer zip (lambda/layers/<name>.zip), from the release manifest',
    });
    const pins = pinEnvironments(this, Boolean(props.optimizeWorker));
    const concurrency: Partial<Record<Workload, CfnParameter>> = {};
    for (const workload of workloads) {
      concurrency[workload] = param(`${pascal(workload)}WorkerConcurrency`, {
        type: 'Number',
        default: WORKLOADS[workload].prodConcurrency,
        minValue: 2,
        maxValue: 50,
        description: `${workload} worker: SQS event source MaximumConcurrency, and its reserved concurrency when ReserveWorkerConcurrency is true`,
      });
    }
    const reserve = param('ReserveWorkerConcurrency', {
      type: 'String',
      default: 'true',
      allowedValues: ['true', 'false'],
      description:
        'Reserve each worker its concurrency (equal to the mapping maximum, never below it). Check the shared account unreserved pool first (LAI-LAMBDA-012 section 10)',
    });
    const logRetention = param('ProcessingLogRetentionDays', {
      type: 'Number',
      default: 90,
      allowedValues: ['14', '30', '60', '90', '120', '180', '365'],
      description: 'Worker log retention in days (P10; Django logs keep 3 months)',
    });
    const queueAge = param('QueueAgeAlarmSeconds', {
      type: 'Number',
      default: 900,
      minValue: 60,
      description: 'Alarm when the oldest message of a work or results queue is older than this',
    });
    const queueDepth = param('QueueDepthAlarmMessages', {
      type: 'Number',
      default: 100,
      minValue: 1,
      description: 'Alarm when a work or results queue holds more visible messages than this',
    });

    // --- Conditions and rules -------------------------------------------------------------------
    const on: Partial<Record<Group, CfnCondition>> = {};
    for (const group of groups) {
      on[group] = new CfnCondition(stack, `${pascal(group)}WorkersEnabled`, {
        expression: Fn.conditionEquals(enable[group]!.valueAsString, 'true'),
      });
      new CfnRule(stack, `${pascal(group)}WorkersNeedCode`, {
        ruleCondition: Fn.conditionEquals(enable[group]!.valueAsString, 'true'),
        assertions: [
          {
            assert: Fn.conditionNot(Fn.conditionEquals(codeKey[group]!.valueAsString, '')),
            assertDescription: `${GROUPS[group].code} is required when ${GROUPS[group].enable} is true`,
          },
        ],
      });
    }
    new CfnRule(stack, 'AudioWorkerNeedsLayer', {
      ruleCondition: Fn.conditionEquals(enable.audio!.valueAsString, 'true'),
      assertions: [
        {
          assert: Fn.conditionNot(Fn.conditionEquals(audioLayerKey.valueAsString, '')),
          assertDescription: 'AudioLayerKey is required when EnableAudioWorker is true',
        },
      ],
    });
    const reserveOn = new CfnCondition(stack, 'ReserveConcurrency', {
      expression: Fn.conditionEquals(reserve.valueAsString, 'true'),
    });
    const groupOf = (workload: Workload): Group =>
      (Object.keys(GROUPS) as Group[]).find((g) =>
        (GROUPS[g].workloads as Workload[]).includes(workload),
      )!;

    // --- Worker artifacts and large results bucket (P2) -----------------------------------------
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: prodArtifactBucketName(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Keys are content-addressed and written create-only (If-None-Match), so no overwrite.
      versioned: false,
      lifecycleRules: [
        ...Object.entries(PROD_ARTIFACT_EXPIRATIONS).map(([prefix, days]) => ({
          id: `expire-${prefix.replace(/\/$/, '').replace(/\//g, '-')}`,
          prefix,
          expiration: Duration.days(days),
        })),
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const artifactBucketArn = this.artifactBucket.bucketArn;
    const artifactBucketName = this.artifactBucket.bucketName;
    const assetBucket = bucketArn(`lai-assets-${PROD}-${Aws.ACCOUNT_ID}-${Aws.REGION}`);

    // --- Queues ---------------------------------------------------------------------------------
    this.resultsQueue = makeQueue(
      this,
      resultsQueueName(PROD),
      RESULTS_QUEUE_VISIBILITY_SECONDS,
      RESULTS_QUEUE_RETENTION_DAYS,
      RESULTS_QUEUE_MAX_RECEIVES,
    );
    for (const workload of workloads) {
      this.queues[workload] = makeWorkQueue(this, PROD, workload, props.sizing);
    }

    // --- Workers --------------------------------------------------------------------------------
    const layer = ffmpegLayer(
      this,
      'AudioFfmpegLayer',
      PROD,
      artifactBucketName,
      audioLayerKey.valueAsString,
      on.audio,
    );
    const parameterArn = (path: string) =>
      `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/lai/${PROD}/${path}`;
    for (const workload of workloads) {
      const group = groupOf(workload);
      const limit = concurrency[workload]!.valueAsNumber;
      const worker = new ProcessingWorker(this, `${pascal(workload)}Worker`, {
        env: PROD,
        workload,
        queue: this.queues[workload]!.main,
        resultsQueue: this.resultsQueue.main,
        resultsBucketName: artifactBucketName,
        assetBucket,
        codeKey: codeKey[group]!.valueAsString,
        layers: workload === 'audio' ? [layer.ref] : undefined,
        sizing: props.sizing,
        maximumConcurrency: limit,
        reservedConcurrency: numberIf(reserveOn, limit),
        logRetentionDays: logRetention.valueAsNumber,
        condition: on[group],
        environment:
          workload === 'ai'
            ? { LAI_SSM_PREFIX: `/lai/${PROD}/django` }
            : pins[workload as keyof typeof pins],
        description: `Learning Adventure Island prod ${workload} jobs worker`,
      });
      this.workers[workload] = worker;
    }
    // The AI worker: inference profiles and Guardrails of this Region (ADR-064: one Bedrock
    // Region in production). Foundation models are allowed in any Region (`bedrock:*::`) because a
    // cross-Region `us.` inference profile invokes the model in whichever US Region serves it; so
    // this is not a single-Region restriction on model invocation (review F8/F13 wording fix).
    const aiRole = this.workers.ai!.role;
    aiRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeModels',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:${Aws.PARTITION}:bedrock:*::foundation-model/*`,
          `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:inference-profile/*`,
        ],
      }),
    );
    aiRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ApplyGuardrail',
        actions: ['bedrock:ApplyGuardrail'],
        resources: [`arn:${Aws.PARTITION}:bedrock:${Aws.REGION}:${Aws.ACCOUNT_ID}:guardrail/*`],
      }),
    );
    aiRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAiSettings',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [parameterArn('django/LAI_AI_*'), parameterArn('django/LAI_STUDIO_*')],
      }),
    );
    aiRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DecryptSecureStrings',
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${Aws.REGION}.amazonaws.com` } },
      }),
    );

    // --- Django (instance role): dispatch, consumption, results, derived artifacts --------------
    const role = props.instanceRole;
    role.addManagedPolicy(
      iam.ManagedPolicy.fromManagedPolicyName(
        this,
        'ProcessingArtifactsPolicy',
        processingArtifactsPolicyName(PROD),
      ),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SubmitJobs',
        actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
        resources: workloads.map((w) => this.queues[w]!.main.queueArn),
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ConsumeJobResults',
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:ChangeMessageVisibility',
          'sqs:GetQueueAttributes',
        ],
        resources: [this.resultsQueue.main.queueArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadJobResults',
        actions: ['s3:GetObject'],
        resources: [`${artifactBucketArn}/jobs/results/*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListJobResults',
        actions: ['s3:ListBucket'],
        resources: [artifactBucketArn],
        conditions: { StringLike: { 's3:prefix': ['jobs/results/*'] } },
      }),
    );

    // Settings the stack knows. A queue URL is written only when its worker exists. The backend
    // switch (LAI_JOBS_BACKEND), LAI_ENVIRONMENT and every feature control stay operator-set.
    const setting = (name: string, value: string, condition: CfnCondition) => {
      const created = new ssm.StringParameter(this, `Setting${name}`, {
        parameterName: `/lai/${PROD}/django/${name}`,
        stringValue: value,
        description: 'Managed by LaiDjangoEc2-prod (processing); change through the stack',
      });
      (created.node.defaultChild as ssm.CfnParameter).cfnOptions.condition = condition;
    };
    for (const workload of workloads) {
      setting(
        WORKLOADS[workload].queueUrlSetting,
        this.queues[workload]!.main.queueUrl,
        on[groupOf(workload)]!,
      );
    }
    setting('LAI_JOBS_RESULTS_QUEUE_URL', this.resultsQueue.main.queueUrl, on.jobs!);
    setting('LAI_JOBS_RESULTS_BUCKET', artifactBucketName, on.jobs!);

    // --- DLQ redrive (P9) -------------------------------------------------------------------------
    // Trust is the account (root principal) with MFA: ANY principal of this shared account whose
    // own IAM policy allows sts:AssumeRole on this role, and who signed in with MFA, can assume
    // it. It does not by itself name operators; the owner restricts who holds that permission
    // (P9, ADR-071 O8). Narrowing the trust to named role ARNs is the recommended follow-up.
    const allQueues = [this.resultsQueue, ...workloads.map((w) => this.queues[w]!)];
    this.redriveRole = new iam.Role(this, 'DlqRedriveRole', {
      roleName: PROD_REDRIVE_ROLE,
      description:
        'Redrive the lai-prod jobs DLQs. Trusts account principals with MFA that are allowed to assume it (P9).',
      assumedBy: new iam.AccountRootPrincipal().withConditions({
        Bool: { 'aws:MultiFactorAuthPresent': 'true' },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    this.redriveRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RedriveFromDeadLetterQueues',
        actions: [
          'sqs:StartMessageMoveTask',
          'sqs:ListMessageMoveTasks',
          'sqs:CancelMessageMoveTask',
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
        ],
        resources: allQueues.map((q) => q.dlq.queueArn),
      }),
    );
    this.redriveRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReturnToSourceQueues',
        actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
        resources: allQueues.map((q) => q.main.queueArn),
      }),
    );

    // --- GitHub worker release role (OIDC, django-prod environment, required reviewers) ----------
    this.releaseRole = new iam.Role(this, 'WorkerReleaseRole', {
      roleName: PROD_WORKER_RELEASE_ROLE,
      // Also reads release artifacts and the stack's outputs. It trusts the environment subject
      // that lai-github-deploy-prod trusts as well (ADR-071 O16).
      description: `GitHub Actions environment ${PROD_GITHUB_ENVIRONMENT}: create-only uploads and reads of worker artifacts, update and read the lai-prod worker functions' code, read stack outputs`,
      assumedBy: githubPrincipal(
        githubOidcProviderArn(),
        `repo:${props.githubRepository}:environment:${PROD_GITHUB_ENVIRONMENT}`,
      ),
      maxSessionDuration: Duration.hours(1),
    });
    const releasePrefixes = ['lambda/*', 'releases/processing/*'];
    this.releaseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'UploadReleaseArtifacts',
        actions: ['s3:PutObject'],
        resources: releasePrefixes.map((p) => `${artifactBucketArn}/${p}`),
        conditions: {
          StringEquals: { 's3:if-none-match': '*' },
          Null: { 's3:if-none-match': 'false' },
        },
      }),
    );
    this.releaseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadReleaseArtifacts',
        actions: ['s3:GetObject'],
        resources: releasePrefixes.map((p) => `${artifactBucketArn}/${p}`),
      }),
    );
    this.releaseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListReleaseArtifacts',
        actions: ['s3:ListBucket'],
        resources: [artifactBucketArn],
        conditions: { StringLike: { 's3:prefix': releasePrefixes } },
      }),
    );
    const functionArns = workloads.map(
      (w) =>
        `arn:${Aws.PARTITION}:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:${this.workers[w]!.functionName}`,
    );
    this.releaseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'UpdateWorkerCode',
        actions: [
          'lambda:UpdateFunctionCode',
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
        ],
        resources: functionArns,
      }),
    );
    this.releaseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [Aws.STACK_ID],
      }),
    );

    // --- Monitoring -----------------------------------------------------------------------------
    const notify = props.notify === false ? undefined : new cwActions.SnsAction(props.alarmTopic);
    const gte = cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const gt = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
    const alarm = (
      id: string,
      name: string,
      description: string,
      metric: cloudwatch.IMetric,
      threshold: number,
      comparisonOperator: cloudwatch.ComparisonOperator,
      evaluationPeriods: number,
    ) => {
      const created = new cloudwatch.Alarm(this, id, {
        alarmName: `lai-${PROD}-${name}`,
        alarmDescription: description,
        metric,
        threshold,
        comparisonOperator,
        evaluationPeriods,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      if (notify) {
        created.addAlarmAction(notify);
        created.addOkAction(notify);
      }
      return created;
    };
    const fiveMinutes = Duration.minutes(5);
    for (const [label, q] of [
      ['results', this.resultsQueue],
      ...workloads.map((w) => [w, this.queues[w]!] as const),
    ] as const) {
      alarm(
        `${pascal(label)}DeadLetters`,
        `${label}-dead-letters`,
        `A ${label} job message failed ${q.maxReceiveCount} times and is in the DLQ (redrive: ${PROD_REDRIVE_ROLE})`,
        q.dlq.metricApproximateNumberOfMessagesVisible({
          period: fiveMinutes,
          statistic: 'Maximum',
        }),
        1,
        gte,
        1,
      );
      alarm(
        `${pascal(label)}QueueAge`,
        `${label}-queue-age`,
        `The oldest ${label} queue message is older than QueueAgeAlarmSeconds`,
        q.main.metricApproximateAgeOfOldestMessage({ period: fiveMinutes, statistic: 'Maximum' }),
        Token.asNumber(queueAge.valueAsNumber),
        gt,
        3,
      );
      alarm(
        `${pascal(label)}QueueDepth`,
        `${label}-queue-depth`,
        `The ${label} queue holds more than QueueDepthAlarmMessages visible messages`,
        q.main.metricApproximateNumberOfMessagesVisible({
          period: fiveMinutes,
          statistic: 'Maximum',
        }),
        Token.asNumber(queueDepth.valueAsNumber),
        gt,
        3,
      );
    }
    const lambdaMetric = (fn: string, metricName: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName,
        dimensionsMap: { FunctionName: fn },
        statistic,
        period: fiveMinutes,
      });
    for (const workload of workloads) {
      const worker = this.workers[workload]!;
      const spec = sized(workload, props.sizing);
      const name = pascal(workload);
      alarm(
        `${name}WorkerErrors`,
        `${workload}-worker-errors`,
        `${worker.functionName} returned errors (handler failures, not per-message job failures)`,
        lambdaMetric(worker.functionName, 'Errors', 'Sum'),
        1,
        gte,
        2,
      );
      alarm(
        `${name}WorkerThrottles`,
        `${workload}-worker-throttles`,
        `${worker.functionName} was throttled: a throttled SQS delivery spends a receive`,
        lambdaMetric(worker.functionName, 'Throttles', 'Sum'),
        1,
        gte,
        1,
      );
      alarm(
        `${name}WorkerDuration`,
        `${workload}-worker-duration`,
        `${worker.functionName} ran above 80% of its ${spec.timeoutSeconds} s timeout`,
        lambdaMetric(worker.functionName, 'Duration', 'Maximum'),
        spec.timeoutSeconds * 1000 * 0.8,
        gt,
        1,
      );
      // Max memory from the platform REPORT line (no Lambda Insights, which is a paid extension
      // layer needing its own cost approval).
      const memory = new logs.MetricFilter(this, `${name}WorkerMaxMemoryFilter`, {
        logGroup: worker.logGroup,
        filterPattern: logs.FilterPattern.spaceDelimited(
          'type',
          'request_label',
          'request_id',
          'duration_label',
          'duration',
          'duration_unit',
          'billed_label1',
          'billed_label2',
          'billed',
          'billed_unit',
          'memory_label1',
          'memory_label2',
          'memory_size',
          'memory_unit',
          'max_label1',
          'max_label2',
          'max_label3',
          'max_memory',
          'max_unit',
          '...',
        ).whereString('type', '=', 'REPORT'),
        metricNamespace: PROCESSING_METRICS_NAMESPACE,
        metricName: `${name}WorkerMaxMemoryMb`,
        metricValue: '$max_memory',
      });
      alarm(
        `${name}WorkerMemory`,
        `${workload}-worker-memory`,
        `${worker.functionName} used more than 85% of its ${spec.memoryMb} MB`,
        memory.metric({ statistic: 'Maximum', period: fiveMinutes }),
        Math.floor(spec.memoryMb * 0.85),
        gt,
        1,
      );
      if (spec.writesArtifacts) {
        const failures = new logs.MetricFilter(this, `${name}ArtifactFailuresFilter`, {
          logGroup: worker.logGroup,
          filterPattern: logs.FilterPattern.anyTerm(
            'artifact_conflict',
            'storage_failure',
            'permission_denied',
          ),
          metricNamespace: PROCESSING_METRICS_NAMESPACE,
          metricName: `${name}ArtifactFailures`,
          metricValue: '1',
        });
        alarm(
          `${name}ArtifactFailures`,
          `${workload}-artifact-failures`,
          `${worker.functionName} could not write or read a derived artifact (conflict, storage or permission)`,
          failures.metric({ statistic: 'Sum', period: fiveMinutes }),
          1,
          gte,
          1,
        );
      }
    }
    // Django-side processing health from its logs (ids and codes only, ADR-025).
    const djangoSignals: [string, string, logs.IFilterPattern, logs.ILogGroup, number, string][] = [
      [
        'OutboxSendFailures',
        'outbox-stuck',
        logs.FilterPattern.anyTerm('jobs.send failed'),
        props.appLogs,
        3,
        'Django could not send committed jobs to SQS (outbox relay retrying; jobs fail after the dispatch attempts)',
      ],
      [
        'ConsumerBackoff',
        'consumer-backoff',
        logs.FilterPattern.anyTerm('jobs.consumer database_error', 'jobs.consumer receive_error'),
        props.appLogs,
        10,
        'The results consumer is backing off (database or SQS unreachable); results wait in the queue',
      ],
      [
        'ReconciliationFailures',
        'reconciliation-failures',
        logs.FilterPattern.anyTerm('jobs.sweep backlog_unknown', 'jobs-sweep failed'),
        props.appLogs,
        1,
        'jobs_sweep could not run or could not read the results backlog',
      ],
      [
        'DeployRollbacks',
        'deploy-rollbacks',
        logs.FilterPattern.anyTerm('rolling back to'),
        props.deployLogs,
        1,
        'A Django release rolled back (deployment health)',
      ],
    ];
    for (const [metricName, name, pattern, group, threshold, description] of djangoSignals) {
      const filter = new logs.MetricFilter(this, `${metricName}Filter`, {
        logGroup: group,
        filterPattern: pattern,
        metricNamespace: PROCESSING_METRICS_NAMESPACE,
        metricName,
        metricValue: '1',
      });
      alarm(
        metricName,
        name,
        description,
        filter.metric({ statistic: 'Sum', period: Duration.minutes(15) }),
        threshold,
        gte,
        1,
      );
    }

    // --- Budget (P15: owner decision, no default amount) ----------------------------------------
    if (props.budgetUsd !== undefined) {
      if (!(props.budgetUsd > 0)) throw new Error('processingBudgetUsd must be a positive number');
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: `lai-${PROD}-processing-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.budgetUsd, unit: 'USD' },
          // Needs the CostScope cost allocation tag activated in Billing (shared account).
          costFilters: { TagKeyValue: [`user:${COST_SCOPE_TAG}$${PROD_COST_SCOPE}`] },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'SNS', address: props.alarmTopic.topicArn }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'SNS', address: props.alarmTopic.topicArn }],
          },
        ],
      });
    } else {
      Annotations.of(this).addWarningV2(
        'lai:processing-budget',
        'No processingBudgetUsd: no processing budget is created (P15 is an owner decision).',
      );
    }

    // --- Outputs --------------------------------------------------------------------------------
    const output = (id: string, value: string, description: string) =>
      new CfnOutput(stack, id, { value, description });
    output(
      'ProcessingArtifactBucketName',
      artifactBucketName,
      'Worker zips, layers, manifests, job results',
    );
    output('ResultsQueueUrl', this.resultsQueue.main.queueUrl, 'LAI_JOBS_RESULTS_QUEUE_URL');
    output('DlqRedriveRoleArn', this.redriveRole.roleArn, 'Operators (MFA) assume this to redrive');
    output(
      'WorkerReleaseRoleArn',
      this.releaseRole.roleArn,
      'django-prod environment variable LAI_PROD_WORKER_RELEASE_ROLE_ARN',
    );
  }
}
