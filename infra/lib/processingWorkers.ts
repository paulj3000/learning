import {
  Aws,
  CfnCondition,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  Token,
} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * Background processing workers shared by `LaiDevPlatform-dev` (native workloads) and the
 * production processing construct in `LaiDjangoEc2-prod` (ADR-064 one queue family per
 * environment, ADR-071 production processing infrastructure, `docs/processing/COMPLETION_INTEGRATION.md`
 * section 3 for the kinds and queues).
 *
 * Every worker is a zip function (arm64, Python 3.12) read from an S3 key, outside any VPC, with
 * no database access, triggered by its own SQS work queue (batch size 1, partial batch
 * responses), and sends its result to the one existing results queue that
 * `manage.py jobs_consume_results` reads. No container image, no ECR, no file asset: the stacks
 * stay bootstrapless.
 *
 * IAM helpers here are the single definition of the derived-artifact statements (ADR-066 Option C,
 * owner approval WRITES 2026-11-18): workers read inputs under `assets/*` only, may create (never
 * overwrite, never delete) objects under `processing/artifacts/<env>/*`, and Django alone deletes
 * there for retention.
 */

export type ProcessingEnv = 'dev' | 'prod';
export type NativeWorkload = 'audio' | 'image' | 'optimize';
export type Workload = 'ai' | 'media' | NativeWorkload;
export const NATIVE_WORKLOADS: readonly NativeWorkload[] = ['audio', 'image', 'optimize'];
export const ALL_WORKLOADS: readonly Workload[] = ['ai', 'media', 'audio', 'image', 'optimize'];

/** The namespace of every CloudWatch metric a processing log filter publishes. */
export const PROCESSING_METRICS_NAMESPACE = 'LearningAdventureIsland/Processing';
/** Cost allocation tag (key and value) of production processing resources; see ADR-071. */
export const COST_SCOPE_TAG = 'CostScope';

export interface WorkloadSpec {
  /** Python handler inside the zip. Native workers follow the jobs worker's convention. */
  handler: string;
  timeoutSeconds: number;
  memoryMb: number;
  ephemeralMb: number;
  /** Reads staff inputs under `assets/*` of the asset bucket. */
  readsAssets: boolean;
  /** Reads derived artifacts under `processing/artifacts/<env>/*` (Workstream B pattern: every
   * asset-touching worker reads both prefixes and lists both, so a missing key is 404). */
  readsArtifacts: boolean;
  /** Creates derived artifacts (create-only) under `processing/artifacts/<env>/*`. */
  writesArtifacts: boolean;
  /** Production default for both the event source MaximumConcurrency and, when reserved, the
   * function's reserved concurrency (they are kept equal; minimum 2, an SQS mapping limit). */
  prodConcurrency: number;
  /** The settings name Django reads for the queue URL. */
  queueUrlSetting: string;
  /** Sizing provenance, printed in the docs; no number here is a Lambda measurement. */
  basis: string;
}

/**
 * Sizing per workload. ai and media are the ADR-064 values in force in dev. audio, image and
 * optimize are the design estimates of their proposals (calculated or x86 workstation figures,
 * never Lambda measurements); the arm64 spikes and dev acceptance replace them.
 */
export const WORKLOADS: Record<Workload, WorkloadSpec> = {
  ai: {
    handler: 'jobs_worker.handler.handle',
    timeoutSeconds: 300,
    memoryMb: 512,
    ephemeralMb: 512,
    readsAssets: false,
    readsArtifacts: false,
    writesArtifacts: false,
    prodConcurrency: 5,
    queueUrlSetting: 'LAI_JOBS_AI_QUEUE_URL',
    basis: 'ADR-064 dev values; ADR-062 production concurrency 5',
  },
  media: {
    handler: 'jobs_worker.handler.handle',
    timeoutSeconds: 120,
    memoryMb: 512,
    ephemeralMb: 512,
    readsAssets: true,
    readsArtifacts: true,
    writesArtifacts: true,
    prodConcurrency: 5,
    queueUrlSetting: 'LAI_JOBS_MEDIA_QUEUE_URL',
    basis: 'ADR-064 dev values; ADR-062 production concurrency 5',
  },
  audio: {
    handler: 'audio_worker.handler.handle',
    timeoutSeconds: 300,
    memoryMb: 1024,
    ephemeralMb: 512,
    readsAssets: true,
    readsArtifacts: true,
    writesArtifacts: true,
    prodConcurrency: 2,
    queueUrlSetting: 'LAI_JOBS_AUDIO_QUEUE_URL',
    basis:
      'Workstream C (open decision): start 1024 MB, 300 s, 512 MB /tmp, configurable; worst case 900 s of voice took 102 s wall, ffmpeg peak RSS 87 MB (x86 workstation)',
  },
  image: {
    handler: 'image_worker.handler.handle',
    timeoutSeconds: 120,
    memoryMb: 1024,
    ephemeralMb: 512,
    readsAssets: true,
    readsArtifacts: true,
    writesArtifacts: true,
    prodConcurrency: 2,
    queueUrlSetting: 'LAI_JOBS_IMAGE_QUEUE_URL',
    basis:
      'Workstream D proposal (open decision): 1024 MB, 120 s, configurable; peak RSS up to 366 MiB at the 16 MP limit (x86 workstation); zip about 12.6 MiB stored, budget 24 MiB (native/pillow/build.py output)',
  },
  optimize: {
    handler: 'optimize_worker.handler.handle',
    timeoutSeconds: 900,
    memoryMb: 3008,
    ephemeralMb: 4096,
    readsAssets: true,
    readsArtifacts: true,
    writesArtifacts: true,
    prodConcurrency: 2,
    queueUrlSetting: 'LAI_JOBS_OPTIMIZE_QUEUE_URL',
    basis:
      'Placeholder only: the runtime is undecided (ADR-070 measurements); defined behind the optimizeWorker flag, default off',
  },
};

/** Memory and timeout overrides per workload (synth context `processingSizing`, JSON), for the
 * open sizing decisions (image: Workstream D proposes 1024 MB and 120 s, the defaults). */
export type WorkloadSizing = Partial<
  Record<Workload, { memoryMb?: number; timeoutSeconds?: number; ephemeralMb?: number }>
>;

/** The spec of a workload with its sizing overrides applied and checked against Lambda limits. */
export function sized(workload: Workload, sizing?: WorkloadSizing): WorkloadSpec {
  const override = sizing?.[workload] ?? {};
  const spec = { ...WORKLOADS[workload], ...override };
  if (!Number.isInteger(spec.memoryMb) || spec.memoryMb < 128 || spec.memoryMb > 10240) {
    throw new Error(`${workload} memoryMb must be an integer from 128 to 10240`);
  }
  if (
    !Number.isInteger(spec.timeoutSeconds) ||
    spec.timeoutSeconds < 1 ||
    spec.timeoutSeconds > 900
  ) {
    throw new Error(`${workload} timeoutSeconds must be an integer from 1 to 900`);
  }
  if (!Number.isInteger(spec.ephemeralMb) || spec.ephemeralMb < 512 || spec.ephemeralMb > 10240) {
    throw new Error(`${workload} ephemeralMb must be an integer from 512 to 10240`);
  }
  return spec;
}

/** Parse the `processingSizing` context value (JSON object keyed by workload). */
export function parseSizing(value: string): WorkloadSizing | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as WorkloadSizing;
  for (const [workload, entry] of Object.entries(parsed)) {
    if (!(workload in WORKLOADS)) throw new Error(`processingSizing: unknown workload ${workload}`);
    sized(workload as Workload, { [workload]: entry });
  }
  return parsed;
}

/** SQS work queues: a message goes to the DLQ after this many receives (ADR-064). */
export const WORK_QUEUE_MAX_RECEIVES = 3;
export const WORK_QUEUE_RETENTION_DAYS = 4;
/** The results queue keeps a message 14 days and allows five application attempts. */
export const RESULTS_QUEUE_MAX_RECEIVES = 5;
export const RESULTS_QUEUE_RETENTION_DAYS = 14;
export const RESULTS_QUEUE_VISIBILITY_SECONDS = 300;
/** SQS guidance for Lambda triggers: visibility at least six times the function timeout. */
export const VISIBILITY_FACTOR = 6;

export const queueName = (env: ProcessingEnv, workload: Workload) => `lai-${env}-jobs-${workload}`;
export const functionName = queueName;
export const workerRoleName = (env: ProcessingEnv, workload: Workload) =>
  `lai-${env}-jobs-${workload}-worker`;
export const resultsQueueName = (env: ProcessingEnv) => `lai-${env}-job-results`;
/** The only prefix derived artifacts may be written to (ADR-066). */
export const artifactPrefix = (env: ProcessingEnv) => `processing/artifacts/${env}/`;
/** The asset library prefix workers may read (AssetStorageStack ASSET_KEY_PREFIXES live below it). */
export const ASSET_INPUT_PREFIX = 'assets/';

/**
 * Create-only writes: S3 conditional writes (`If-None-Match: *`) refuse to overwrite an existing
 * key with 412. The `s3:if-none-match` condition key makes IAM refuse a PutObject that does not
 * carry the header at all (`Null: false`) or carries anything but `*`. Support for this key on
 * the asset bucket must be verified live before enablement (LAI-LAMBDA-012 D8, ADR-071 open item);
 * the policy is still correct without it because the workers send the header, but IAM would then
 * not enforce it. Multipart uploads are not covered (UploadPart carries no If-None-Match), so a
 * worker must use a single PutObject; the bucket's abort-incomplete-uploads rule is the safety net.
 */
export const CREATE_ONLY_CONDITION = {
  StringEquals: { 's3:if-none-match': '*' },
  Null: { 's3:if-none-match': 'false' },
};

export const bucketArn = (bucketName: string) => `arn:${Aws.PARTITION}:s3:::${bucketName}`;
export const assetBucketName = (env: ProcessingEnv) =>
  `lai-assets-${env}-${Aws.ACCOUNT_ID}-${Aws.REGION}`;

/** Object reads. The asset bucket is versioned and the workers read by `VersionId`
 * (S3ObjectStore.read, the create-only 412 verification), which needs s3:GetObjectVersion. */
export const READ_ACTIONS = ['s3:GetObject', 's3:GetObjectVersion'];

/** Reads of the asset library inputs only (`assets/*`), never the whole bucket. */
export function assetInputReadStatement(assetBucket: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: 'ReadAssets',
    actions: READ_ACTIONS,
    resources: [`${assetBucket}/${ASSET_INPUT_PREFIX}*`],
  });
}

/**
 * ListBucket on the asset bucket for the given prefixes, `StringLikeIfExists` on `s3:prefix`. The
 * `IfExists` is deliberate (owner decision 2026-11-17, ADR-071 O15): S3 evaluates ListBucket for a
 * HEAD or GET of a missing key, and that request carries no `s3:prefix`, so only `IfExists` lets a
 * missing input answer 404 (`input_missing`) instead of 403. The accepted cost (review F10 /
 * sec-7, 2026-11-18): a listing that sends no prefix is also allowed, so a worker could enumerate
 * key names (never contents) of this one environment's asset bucket. A plain `StringLike` would
 * close that but turn every missing input into `permission_denied`; that reversal is the owner's
 * call, not this code's.
 */
export function assetListStatement(assetBucket: string, prefixes: string[]): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: 'ListAssetBucket',
    actions: ['s3:ListBucket'],
    resources: [assetBucket],
    conditions: { StringLikeIfExists: { 's3:prefix': prefixes.map((p) => `${p}*`) } },
  });
}

/** GetObject on this environment's derived artifacts (a later stage reads an earlier output). */
export function artifactReadStatement(
  assetBucket: string,
  env: ProcessingEnv,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: 'ReadArtifacts',
    actions: READ_ACTIONS,
    resources: [`${assetBucket}/${artifactPrefix(env)}*`],
  });
}

/** The narrow create-only artifact write (owner approval WRITES): PutObject only, only under
 * `processing/artifacts/<env>/`, only with `If-None-Match: *`. No delete, no tagging, no ACL. */
export function artifactCreateOnlyWriteStatement(
  assetBucket: string,
  env: ProcessingEnv,
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: 'CreateArtifacts',
    actions: ['s3:PutObject'],
    resources: [`${assetBucket}/${artifactPrefix(env)}*`],
    conditions: CREATE_ONLY_CONDITION,
  });
}

/**
 * Django's statements on derived artifacts (`lai-django-processing-artifacts-<env>`): read any
 * artifact (verification, promotion, staff preview), create staff browser captures
 * (`capture/`, create-only), and delete artifacts for retention (90 days unreviewed, 30 days
 * superseded; promoted and referenced artifacts are protected by Django). This is the only
 * principal that may delete under the prefix; workers never can.
 */
export function djangoArtifactStatements(
  assetBucket: string,
  env: ProcessingEnv,
): iam.PolicyStatement[] {
  const prefix = `${assetBucket}/${artifactPrefix(env)}`;
  return [
    new iam.PolicyStatement({
      sid: 'ReadArtifacts',
      actions: READ_ACTIONS,
      resources: [`${prefix}*`],
    }),
    new iam.PolicyStatement({
      sid: 'CreateStaffCaptures',
      actions: ['s3:PutObject'],
      resources: [`${prefix}capture/*`],
      conditions: CREATE_ONLY_CONDITION,
    }),
    new iam.PolicyStatement({
      sid: 'RetentionCleanup',
      actions: ['s3:DeleteObject'],
      resources: [`${prefix}*`],
    }),
  ];
}

/** sec-6: staff browser captures (`capture/`) are Django's alone. An explicit Deny, so no later
 * Allow on the artifact prefix can let a worker read, write or delete them. */
export function captureDenyStatement(assetBucket: string, env: ProcessingEnv): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: 'DenyStaffCaptures',
    effect: iam.Effect.DENY,
    actions: ['s3:*'],
    resources: [`${assetBucket}/${artifactPrefix(env)}capture/*`],
  });
}

/** F6: a workload that creates artifacts must read its write prefix (the 412 verification reads
 * the existing object), and every artifact workload reads assets. Throws when violated. */
export function checkWorkloadRules(specs: Record<Workload, WorkloadSpec> = WORKLOADS): void {
  for (const [workload, spec] of Object.entries(specs)) {
    if (spec.writesArtifacts && !spec.readsArtifacts) {
      throw new Error(`${workload} writes artifacts but cannot read its write prefix`);
    }
  }
}
checkWorkloadRules();

/** Statements of one worker role that depend on what the workload does with the asset bucket. */
export function workloadStorageStatements(
  workload: Workload,
  assetBucket: string,
  env: ProcessingEnv,
): iam.PolicyStatement[] {
  const spec = WORKLOADS[workload];
  const statements: iam.PolicyStatement[] = [];
  if (spec.readsAssets) statements.push(assetInputReadStatement(assetBucket));
  if (spec.readsArtifacts) statements.push(artifactReadStatement(assetBucket, env));
  if (spec.readsAssets || spec.readsArtifacts) {
    const prefixes = [ASSET_INPUT_PREFIX];
    if (spec.readsArtifacts) prefixes.push(artifactPrefix(env));
    statements.push(assetListStatement(assetBucket, prefixes));
  }
  if (spec.writesArtifacts) statements.push(artifactCreateOnlyWriteStatement(assetBucket, env));
  if (spec.readsAssets || spec.readsArtifacts || spec.writesArtifacts) {
    statements.push(captureDenyStatement(assetBucket, env));
  }
  return statements;
}

export interface QueuePair {
  main: sqs.Queue;
  dlq: sqs.Queue;
  maxReceiveCount: number;
}

export function pascal(name: string): string {
  return name
    .split(/[-/]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/** An SSE, TLS-only queue with its DLQ (14 days), as the dev stack makes them. */
export function makeQueue(
  scope: Construct,
  name: string,
  visibilitySeconds: number,
  retentionDays: number,
  maxReceiveCount: number,
): QueuePair {
  const dlq = new sqs.Queue(scope, `${pascal(name)}Dlq`, {
    queueName: `${name}-dlq`,
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    retentionPeriod: Duration.days(14),
    enforceSSL: true,
  });
  const main = new sqs.Queue(scope, `${pascal(name)}Queue`, {
    queueName: name,
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    visibilityTimeout: Duration.seconds(visibilitySeconds),
    retentionPeriod: Duration.days(retentionDays),
    deadLetterQueue: { queue: dlq, maxReceiveCount },
    enforceSSL: true,
  });
  return { main, dlq, maxReceiveCount };
}

/** The work queue of one workload: visibility six times its function timeout. */
export function makeWorkQueue(
  scope: Construct,
  env: ProcessingEnv,
  workload: Workload,
  sizing?: WorkloadSizing,
): QueuePair {
  return makeQueue(
    scope,
    queueName(env, workload),
    VISIBILITY_FACTOR * sized(workload, sizing).timeoutSeconds,
    WORK_QUEUE_RETENTION_DAYS,
    WORK_QUEUE_MAX_RECEIVES,
  );
}

export interface ProcessingWorkerProps {
  env: ProcessingEnv;
  workload: Workload;
  queue: sqs.IQueue;
  resultsQueue: sqs.IQueue;
  /** Bucket holding `jobs/results/` (large results) and `lambda/` (the code). */
  resultsBucketName: string;
  /** The asset bucket name (inputs and derived artifacts). */
  assetBucket: string;
  codeKey: string;
  /** Layer version ARNs (the FFmpeg layer for audio). */
  layers?: string[];
  /** Memory and timeout overrides (the queue must be made with the same sizing). */
  sizing?: WorkloadSizing;
  /** SQS event source MaximumConcurrency (minimum 2). */
  maximumConcurrency: number;
  /** Reserved concurrency, or `Fn::If [cond, n, AWS::NoValue]`; unset: none. */
  reservedConcurrency?: number;
  logRetentionDays: number;
  /** Create the function and its trigger only when this holds. */
  condition?: CfnCondition;
  /** Extra environment variables. */
  environment?: Record<string, string>;
  description: string;
}

/**
 * One worker: its log group, role (logs, its queue, the results queue and prefix, plus the
 * workload's storage statements), the zip function and the SQS trigger with partial batch
 * responses. Roles and log groups are unconditional (as in dev), the function and mapping follow
 * `condition`.
 */
export class ProcessingWorker extends Construct {
  readonly role: iam.Role;
  readonly function: lambda.CfnFunction;
  readonly mapping: lambda.CfnEventSourceMapping;
  readonly logGroup: logs.LogGroup;
  readonly functionName: string;

  constructor(scope: Construct, id: string, props: ProcessingWorkerProps) {
    super(scope, id);
    const { env, workload } = props;
    const spec = sized(workload, props.sizing);
    this.functionName = functionName(env, workload);
    const resultsBucket = bucketArn(props.resultsBucketName);

    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${this.functionName}`,
      removalPolicy: env === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    (this.logGroup.node.defaultChild as logs.CfnLogGroup).retentionInDays = props.logRetentionDays;

    this.role = new iam.Role(this, 'Role', {
      roleName: workerRoleName(env, workload),
      description: `Lambda ${this.functionName}: its queue, results, and its ${workload} inputs and outputs`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const allow = (
      sid: string,
      actions: string[],
      resources: string[],
      conditions?: Record<string, unknown>,
    ) => this.role.addToPolicy(new iam.PolicyStatement({ sid, actions, resources, conditions }));
    allow(
      'WriteLogs',
      ['logs:CreateLogStream', 'logs:PutLogEvents'],
      [this.logGroup.logGroupArn, `${this.logGroup.logGroupArn}:*`],
    );
    allow(
      'ConsumeWork',
      [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:ChangeMessageVisibility',
        'sqs:GetQueueAttributes',
      ],
      [props.queue.queueArn],
    );
    allow('SendResults', ['sqs:SendMessage'], [props.resultsQueue.queueArn]);
    // Large results: read any, create only (jobs_worker store_result sends If-None-Match: *).
    allow('ReadResults', ['s3:GetObject'], [`${resultsBucket}/jobs/results/*`]);
    allow(
      'CreateResults',
      ['s3:PutObject'],
      [`${resultsBucket}/jobs/results/*`],
      CREATE_ONLY_CONDITION,
    );
    allow('ListResults', ['s3:ListBucket'], [resultsBucket], {
      StringLike: { 's3:prefix': ['jobs/results/*'] },
    });
    for (const statement of workloadStorageStatements(workload, props.assetBucket, env)) {
      this.role.addToPolicy(statement);
    }

    this.function = new lambda.CfnFunction(this, 'Function', {
      functionName: this.functionName,
      description: props.description,
      runtime: 'python3.12',
      architectures: ['arm64'],
      handler: spec.handler,
      code: { s3Bucket: props.resultsBucketName, s3Key: props.codeKey },
      role: this.role.roleArn,
      timeout: spec.timeoutSeconds,
      memorySize: spec.memoryMb,
      ephemeralStorage: { size: spec.ephemeralMb },
      layers: props.layers,
      reservedConcurrentExecutions: props.reservedConcurrency,
      loggingConfig: { logGroup: this.logGroup.logGroupName, logFormat: 'Text' },
      environment: {
        variables: {
          LAI_ENV: env,
          LAI_WORKER_QUEUE: workload,
          LAI_RESULTS_QUEUE_URL: props.resultsQueue.queueUrl,
          LAI_RESULTS_BUCKET: props.resultsBucketName,
          ...(spec.readsAssets || spec.writesArtifacts
            ? { LAI_ASSET_BUCKET: assetBucketName(env) }
            : {}),
          ...(spec.writesArtifacts || spec.readsArtifacts
            ? { LAI_ARTIFACT_PREFIX: artifactPrefix(env) }
            : {}),
          // The LGPL FFmpeg layer extracts to /opt (native/ffmpeg/README.md, Workstream C).
          ...(workload === 'audio' ? { LAI_FFMPEG_PATH: '/opt/bin/ffmpeg' } : {}),
          ...props.environment,
        },
      },
    });
    const permissions = this.role.node.findChild('DefaultPolicy');
    this.function.node.addDependency(permissions);
    this.mapping = new lambda.CfnEventSourceMapping(this, 'Trigger', {
      functionName: this.function.ref,
      eventSourceArn: props.queue.queueArn,
      batchSize: 1,
      functionResponseTypes: ['ReportBatchItemFailures'],
      scalingConfig: { maximumConcurrency: props.maximumConcurrency },
      enabled: true,
    });
    this.mapping.node.addDependency(permissions);
    if (props.condition) {
      this.function.cfnOptions.condition = props.condition;
      this.mapping.cfnOptions.condition = props.condition;
    }
  }
}

/** `Fn::If [condition, value, AWS::NoValue]` as a number-typed token. */
export function numberIf(condition: CfnCondition, value: number): number {
  return Token.asNumber(Fn.conditionIf(condition.logicalId, value, Aws.NO_VALUE));
}

/**
 * The FFmpeg layer (LGPL build, owner approval AUDIO) read from an S3 key: the zip is a build
 * output (`/build/`, never committed) that packaging uploads create-only. Kept on replacement and
 * on stack deletion, so a rollback to an earlier layer version always finds it.
 */
export function ffmpegLayer(
  scope: Construct,
  id: string,
  env: ProcessingEnv,
  bucketName: string,
  key: string,
  condition?: CfnCondition,
): lambda.CfnLayerVersion {
  const layer = new lambda.CfnLayerVersion(scope, id, {
    layerName: `lai-${env}-ffmpeg`,
    description: 'LGPL FFmpeg build for the audio worker (ADR-067); built, never committed',
    content: { s3Bucket: bucketName, s3Key: key },
    compatibleArchitectures: ['arm64'],
    compatibleRuntimes: ['python3.12'],
    licenseInfo: 'LGPL-2.1-or-later',
  });
  layer.applyRemovalPolicy(RemovalPolicy.RETAIN);
  if (condition) layer.cfnOptions.condition = condition;
  return layer;
}

/** Worker zips and layer zips: keys the stacks and the release tooling accept. */
export const WORKER_CODE_KEY_PATTERN = '^$|^lambda/[A-Za-z0-9._-]+\\.zip$';
export const LAYER_KEY_PATTERN = '^$|^lambda/layers/[A-Za-z0-9._-]+\\.zip$';

/**
 * Executable SHA-256 pins (review F12): the worker refuses a tool whose hash differs. Each is a
 * stack parameter (default empty: no pin), filled from the release manifest
 * (`processing_release.py stack-parameters`, from the layer's build-record.json). Shared libraries
 * under /opt/lib are covered by the layer zip's SHA-256 in the manifest, not by these pins.
 */
export const PIN_PARAMETERS = {
  LAI_FFMPEG_SHA256: { parameter: 'AudioFfmpegSha256', workload: 'audio' },
  LAI_GLTFPACK_SHA256: { parameter: 'OptimizeGltfpackSha256', workload: 'optimize' },
  LAI_TOKTX_SHA256: { parameter: 'OptimizeToktxSha256', workload: 'optimize' },
} as const;
export const SHA256_PATTERN = '^$|^[a-f0-9]{64}$';

/** Create the pin parameters on the stack and return the environment of each native workload. */
export function pinEnvironments(
  scope: Construct,
  optimize: boolean,
): Partial<Record<NativeWorkload, Record<string, string>>> {
  const stack = Stack.of(scope);
  const environments: Partial<Record<NativeWorkload, Record<string, string>>> = {};
  for (const [variable, { parameter, workload }] of Object.entries(PIN_PARAMETERS)) {
    if (workload === 'optimize' && !optimize) continue;
    const value = new CfnParameter(stack, parameter, {
      type: 'String',
      default: '',
      allowedPattern: SHA256_PATTERN,
      description: `${variable} for the ${workload} worker ('' = no pin); from the release manifest`,
    }).valueAsString;
    environments[workload] = { ...environments[workload], [variable]: value };
  }
  return environments;
}
