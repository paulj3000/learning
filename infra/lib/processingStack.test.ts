// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  MAX_RECEIVE_COUNT,
  PROCESSING_SETTINGS,
  PROCESSING_WORKER_HANDLER,
  ProcessingStack,
  WORKER_ENVIRONMENT_NAMES,
  defaultWorkerSizing,
  validateWorkerSizing,
  type ProcessingStackProps,
} from './processingStack';

/**
 * LaiProcessing-<env> (LAI-LAMBDA-005; names and defaults frozen in
 * docs/processing/WAVE2_INTERFACES.md sections 3, 4, 5 and 7), synthesized in memory and asserted
 * on the CloudFormation it produces. No AWS call is made.
 */

const ACCOUNT = '123456789012';
const REGION = 'us-west-1';
const env = { account: ACCOUNT, region: REGION };
const DIGEST = `sha256:${'ab'.repeat(32)}`;

type Json = Record<string, unknown>;
type Resource = {
  Type: string;
  Properties: Json;
  DeletionPolicy?: string;
  DependsOn?: string[];
};
type Statement = {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: Json;
};

/** Pseudo-parameters and joins resolved to plain strings, as in crossStackReferences.test.ts. */
function resolve(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    const object = value as Json;
    if ('Ref' in object && Object.keys(object).length === 1) {
      const ref = object.Ref as string;
      if (ref === 'AWS::AccountId') return ACCOUNT;
      if (ref === 'AWS::Region') return REGION;
      if (ref === 'AWS::Partition') return 'aws';
      if (ref === 'AWS::URLSuffix') return 'amazonaws.com';
      return `{${ref}}`;
    }
    if ('Fn::GetAtt' in object) {
      const [id, attribute] = object['Fn::GetAtt'] as [string, string];
      return `{${id}.${attribute}}`;
    }
    if ('Fn::Join' in object) {
      const [separator, parts] = object['Fn::Join'] as [string, unknown[]];
      const resolved = parts.map(resolve);
      return resolved.every((part) => typeof part === 'string')
        ? (resolved as string[]).join(separator)
        : { 'Fn::Join': [separator, resolved] };
    }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, resolve(item)]));
  }
  return value;
}

function synth(props: Partial<ProcessingStackProps> & { envName: 'dev' | 'prod' }) {
  const stack = new ProcessingStack(new App(), `LaiProcessing-${props.envName}`, { env, ...props });
  const template = Template.fromStack(stack);
  const json = resolve(template.toJSON()) as {
    Resources: Record<string, Resource>;
    Outputs: Record<string, { Value: unknown }>;
  };
  const resources = (type: string) =>
    Object.entries(json.Resources)
      .filter(([, resource]) => resource.Type === type)
      .map(([id, resource]) => ({ id, ...resource }));
  return { stack, template, json, resources };
}

const actions = (statement: Statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action];
const resourceList = (statement: Statement) =>
  (Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]) as unknown[];

function roleStatements(built: ReturnType<typeof synth>, roleId: string): Statement[] {
  return built
    .resources('AWS::IAM::Policy')
    .filter((policy) => JSON.stringify(policy.Properties.Roles) === JSON.stringify([`{${roleId}}`]))
    .flatMap(
      (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

function queueByName(built: ReturnType<typeof synth>, name: string) {
  const found = built.resources('AWS::SQS::Queue').find((q) => q.Properties.QueueName === name);
  if (!found) throw new Error(`no queue ${name}`);
  return found;
}

function queuePolicyStatements(built: ReturnType<typeof synth>, queueId: string): Statement[] {
  return built
    .resources('AWS::SQS::QueuePolicy')
    .filter(
      (policy) => JSON.stringify(policy.Properties.Queues) === JSON.stringify([`{${queueId}}`]),
    )
    .flatMap(
      (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

describe.each(['dev', 'prod'] as const)('ProcessingStack (%s)', { timeout: 60_000 }, (envName) => {
  const phase1 = synth({ envName });
  const phase2 = synth({ envName, workerImageDigest: DIGEST });
  const prod = envName === 'prod';
  const bucket = `lai-processing-${envName}-${ACCOUNT}-${REGION}`;
  const bucketArn = `arn:aws:s3:::${bucket}`;
  const assetArn = `arn:aws:s3:::lai-assets-${envName}-${ACCOUNT}-${REGION}`;

  it('keeps one private, encrypted, versioned, TLS-only bucket and never deletes it', () => {
    for (const built of [phase1, phase2]) {
      const buckets = built.resources('AWS::S3::Bucket');
      expect(buckets).toHaveLength(1);
      const [b] = buckets;
      expect(b.Properties.BucketName).toBe(bucket);
      expect(b.DeletionPolicy).toBe('Retain');
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(b.Properties.BucketEncryption).toEqual({
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      });
      expect(b.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
      expect(b.Properties.OwnershipControls).toEqual({
        Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
      });
      expect(b.Properties.NotificationConfiguration).toBeUndefined(); // no S3-event dispatch
      const policy = JSON.stringify(built.resources('AWS::S3::BucketPolicy')[0].Properties);
      expect(policy).toContain('"aws:SecureTransport":"false"');
      expect(policy).toContain('"s3:TlsVersion":1.2');
    }
  });

  it('expires quarantine, tmp and old artifact versions by prefix', () => {
    const [b] = phase1.resources('AWS::S3::Bucket');
    const rules = (b.Properties.LifecycleConfiguration as { Rules: Json[] }).Rules;
    const byId = Object.fromEntries(rules.map((rule) => [rule.Id as string, rule]));
    expect(Object.keys(byId).sort()).toEqual(
      ['abort-incomplete-uploads', 'artifact-versions', 'expire-quarantine', 'expire-tmp'].sort(),
    );
    expect(byId['expire-quarantine']).toMatchObject({
      Prefix: 'processing/quarantine/',
      ExpirationInDays: 30,
      NoncurrentVersionExpiration: { NoncurrentDays: 1 },
      Status: 'Enabled',
    });
    expect(byId['expire-tmp']).toMatchObject({ Prefix: 'processing/tmp/', ExpirationInDays: 1 });
    expect(byId['artifact-versions']).toMatchObject({
      Prefix: 'processing/artifacts/',
      NoncurrentVersionExpiration: { NoncurrentDays: 30 },
    });
    // Prod keeps current artifacts; dev expires them after 90 days.
    expect(byId['artifact-versions'].ExpirationInDays).toBe(prod ? undefined : 90);
    expect(byId['abort-incomplete-uploads']).toMatchObject({
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    });
    expect(byId['abort-incomplete-uploads'].Prefix).toBeUndefined();
  });

  it('makes standard, SSE-SQS work and completion queues with five-receive DLQs', () => {
    const work = queueByName(phase2, `lai-${envName}-processing-work`);
    const workDlq = queueByName(phase2, `lai-${envName}-processing-work-dlq`);
    const done = queueByName(phase2, `lai-${envName}-processing-completions`);
    const doneDlq = queueByName(phase2, `lai-${envName}-processing-completions-dlq`);
    expect(phase2.resources('AWS::SQS::Queue')).toHaveLength(4);
    for (const q of [work, workDlq, done, doneDlq]) {
      expect(q.Properties.SqsManagedSseEnabled).toBe(true);
      expect(q.Properties.MessageRetentionPeriod).toBe(14 * 86400);
      expect(q.Properties.FifoQueue).toBeUndefined();
      expect(q.DeletionPolicy).toBe(prod ? 'Retain' : 'Delete');
    }
    expect(work.Properties.VisibilityTimeout).toBe(3600);
    expect(done.Properties.VisibilityTimeout).toBe(300);
    expect(work.Properties.RedrivePolicy).toEqual({
      deadLetterTargetArn: `{${workDlq.id}.Arn}`,
      maxReceiveCount: MAX_RECEIVE_COUNT,
    });
    expect(done.Properties.RedrivePolicy).toEqual({
      deadLetterTargetArn: `{${doneDlq.id}.Arn}`,
      maxReceiveCount: 5,
    });
    // Visibility is at least six times the timeout times the batch size.
    expect(work.Properties.VisibilityTimeout as number).toBeGreaterThanOrEqual(6 * 600 * 1);
  });

  it('lets only Django send work and only the worker send completions, over TLS', () => {
    const work = queueByName(phase1, `lai-${envName}-processing-work`);
    const done = queueByName(phase1, `lai-${envName}-processing-completions`);
    const role = phase1.resources('AWS::IAM::Role').find((r) => r.id.startsWith('WorkerRole'))!;
    const workStatements = queuePolicyStatements(phase1, work.id);
    const doneStatements = queuePolicyStatements(phase1, done.id);
    const deny = (statements: Statement[], sid: string) => {
      const found = statements.find((statement) => statement.Sid === sid)!;
      expect(found.Effect).toBe('Deny');
      expect(found.Principal).toEqual({ AWS: '*' });
      expect(actions(found)).toEqual(['sqs:SendMessage']);
      return (found.Condition as { ArnNotEquals: { 'aws:PrincipalArn': unknown } }).ArnNotEquals[
        'aws:PrincipalArn'
      ];
    };
    expect(deny(workStatements, 'OnlyDjangoSendsWork')).toEqual([
      `arn:aws:iam::${ACCOUNT}:role/lai-django-ec2-${envName}`,
    ]);
    expect(deny(doneStatements, 'OnlyTheWorkerSendsCompletions')).toEqual([`{${role.id}.Arn}`]);
    for (const statements of [workStatements, doneStatements]) {
      expect(JSON.stringify(statements)).toContain('"aws:SecureTransport":"false"');
      expect(statements.every((statement) => statement.Effect === 'Deny')).toBe(true);
    }
    // Every queue, DLQs included, refuses plain HTTP.
    for (const q of phase1.resources('AWS::SQS::Queue')) {
      expect(JSON.stringify(queuePolicyStatements(phase1, q.id))).toContain('aws:SecureTransport');
    }
    // An operator role can be added for DLQ redrives.
    const operator = `arn:aws:iam::${ACCOUNT}:role/lai-operator`;
    const withOperator = synth({ envName, additionalSenderRoleArns: [operator] });
    const workId = queueByName(withOperator, `lai-${envName}-processing-work`).id;
    expect(deny(queuePolicyStatements(withOperator, workId), 'OnlyDjangoSendsWork')).toEqual([
      `arn:aws:iam::${ACCOUNT}:role/lai-django-ec2-${envName}`,
      operator,
    ]);
    expect(() => synth({ envName, additionalSenderRoleArns: ['*'] })).toThrow(/role ARNs/);
  });

  it('gives the worker exactly its queues, prefixes, image and log group', () => {
    const [role] = phase2.resources('AWS::IAM::Role');
    expect(role.Properties.RoleName).toBe(`lai-${envName}-processing-worker`);
    expect(JSON.stringify(role.Properties.AssumeRolePolicyDocument)).toContain(
      '"Service":"lambda.amazonaws.com"',
    );
    expect(role.Properties.ManagedPolicyArns).toBeUndefined(); // not even basic execution
    const statements = roleStatements(phase2, role.id);
    const work = queueByName(phase2, `lai-${envName}-processing-work`);
    const done = queueByName(phase2, `lai-${envName}-processing-completions`);
    const bySid = Object.fromEntries(statements.map((statement) => [statement.Sid, statement]));
    expect(Object.keys(bySid).sort()).toEqual(
      [
        'ConsumeWork',
        'PullWorkerImage',
        'ReadInputs',
        'SendCompletions',
        'VerifyOwnArtifacts',
        'WriteArtifacts',
        'WriteLogs',
      ].sort(),
    );
    expect(actions(bySid.ConsumeWork).sort()).toEqual(
      [
        'sqs:ChangeMessageVisibility',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes',
        'sqs:ReceiveMessage',
      ].sort(),
    );
    expect(bySid.ConsumeWork.Resource).toBe(`{${work.id}.Arn}`);
    expect(actions(bySid.SendCompletions)).toEqual(['sqs:SendMessage']);
    expect(bySid.SendCompletions.Resource).toBe(`{${done.id}.Arn}`);
    expect(actions(bySid.ReadInputs).sort()).toEqual(['s3:GetObject', 's3:GetObjectVersion']);
    expect(resourceList(bySid.ReadInputs)).toEqual([
      `${assetArn}/assets/*`,
      `${bucketArn}/processing/quarantine/${envName}/*`,
    ]);
    expect(actions(bySid.WriteArtifacts)).toEqual(['s3:PutObject']);
    expect(bySid.WriteArtifacts.Resource).toBe(`${bucketArn}/processing/artifacts/${envName}/*`);
    expect(actions(bySid.VerifyOwnArtifacts)).toEqual(['s3:GetObject']);
    expect(bySid.VerifyOwnArtifacts.Resource).toBe(
      `${bucketArn}/processing/artifacts/${envName}/*`,
    );
    expect(actions(bySid.PullWorkerImage).sort()).toEqual([
      'ecr:BatchGetImage',
      'ecr:GetDownloadUrlForLayer',
    ]);
    expect(bySid.PullWorkerImage.Resource).toBe(
      `arn:aws:ecr:${REGION}:${ACCOUNT}:repository/lai/processing-${envName}`,
    );
    expect(actions(bySid.WriteLogs).sort()).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
    const group = `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/lambda/lai-${envName}-processing-worker`;
    expect(resourceList(bySid.WriteLogs)).toEqual([group, `${group}:log-stream:*`]);
    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow');
      for (const resource of resourceList(statement)) expect(resource).not.toBe('*');
      for (const action of actions(statement)) {
        expect(action).not.toContain('*');
        // A compromised worker has no database, secret, parameter, AI or identity access.
        expect(action).not.toMatch(
          /^(rds|rds-db|secretsmanager|ssm|kms|bedrock|cognito-idp|iam|sts):/,
        );
        expect(action).not.toMatch(/^s3:(Delete|List|PutObjectAcl|PutBucket)/);
      }
    }
  });

  it('has no function, mapping or function alarms without a digest (phase 1)', () => {
    phase1.template.resourceCountIs('AWS::Lambda::Function', 0);
    phase1.template.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    const alarms = phase1
      .resources('AWS::CloudWatch::Alarm')
      .map((alarm) => alarm.Properties.AlarmName as string);
    expect(alarms.filter((name) => name.includes('-worker-'))).toEqual([]);
    expect(phase1.json.Outputs.WorkerFunctionName.Value).toBe('none');
    expect(phase1.json.Outputs.WorkerImageDigest.Value).toBe('none');
    expect(phase1.json.Outputs.ProcessingBackend.Value).toBe('disabled');
  });

  it('runs the worker from the ECR image by digest, arm64, sized, outside any VPC (phase 2)', () => {
    const fns = phase2.resources('AWS::Lambda::Function');
    expect(fns).toHaveLength(1);
    const [fn] = fns;
    const p = fn.Properties;
    expect(p.FunctionName).toBe(`lai-${envName}-processing-worker`);
    expect(p.PackageType).toBe('Image');
    expect(p.Code).toEqual({
      ImageUri: `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/lai/processing-${envName}@${DIGEST}`,
    });
    expect((p.Code as { ImageUri: string }).ImageUri).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(p.ImageConfig).toEqual({ Command: [PROCESSING_WORKER_HANDLER] });
    expect(p.Handler).toBeUndefined();
    expect(p.Runtime).toBeUndefined();
    expect(p.Architectures).toEqual(['arm64']);
    expect(p.Timeout).toBe(600);
    expect(p.MemorySize).toBe(2048);
    expect(p.EphemeralStorage).toEqual({ Size: 2048 });
    expect(p.ReservedConcurrentExecutions).toBe(prod ? 5 : 2);
    expect(p.VpcConfig).toBeUndefined();
    expect(p.LoggingConfig).toMatchObject({
      LogGroup: `/aws/lambda/lai-${envName}-processing-worker`,
    });
    const variables = (p.Environment as { Variables: Record<string, string> }).Variables;
    expect(Object.keys(variables).sort()).toEqual([...WORKER_ENVIRONMENT_NAMES].sort());
    expect(variables).toMatchObject({
      LAI_PROCESSING_NAMESPACE: envName,
      LAI_ASSET_BUCKET: `lai-assets-${envName}-${ACCOUNT}-${REGION}`,
      LAI_PROCESSING_CLEANUP_MARGIN_SECONDS: '60',
      LAI_PROCESSING_LOG_LEVEL: 'INFO',
    });
    expect(String(variables.LAI_PROCESSING_BUCKET)).toContain('ProcessingBucket');
    expect(JSON.stringify(variables.LAI_PROCESSING_COMPLETION_QUEUE_URL)).toContain(
      'CompletionQueue',
    );
    expect(JSON.stringify(p)).not.toMatch(/SECRET|PASSWORD|DATABASE/);
    // No CDK asset: the stack stays bootstrapless.
    expect(JSON.stringify(phase2.json)).not.toMatch(/cdk-hnb659fds|AssetParameters|S3Bucket/);
    expect(fn.DependsOn?.some((id) => id.startsWith('WorkerRoleDefaultPolicy'))).toBe(true);
    expect(phase2.json.Outputs.WorkerImageDigest.Value).toBe(DIGEST);
    expect(phase2.json.Outputs.ProcessingBackend.Value).toBe('sqs');
  });

  it('feeds the worker one message at a time with partial batch failures', () => {
    const [mapping] = phase2.resources('AWS::Lambda::EventSourceMapping');
    const work = queueByName(phase2, `lai-${envName}-processing-work`);
    expect(mapping.Properties).toMatchObject({
      EventSourceArn: `{${work.id}.Arn}`,
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: prod ? 5 : 2 },
      Enabled: true,
    });
  });

  it('keeps the worker log group with a retention', () => {
    const [group] = phase1.resources('AWS::Logs::LogGroup');
    expect(group.Properties.LogGroupName).toBe(`/aws/lambda/lai-${envName}-processing-worker`);
    expect(group.Properties.RetentionInDays).toBe(prod ? 90 : 14);
    expect(group.DeletionPolicy).toBe(prod ? 'Retain' : 'Delete');
  });

  it('gives Django one managed policy with exactly the processing rights', () => {
    const policies = phase1.resources('AWS::IAM::ManagedPolicy');
    expect(policies).toHaveLength(1);
    const [policy] = policies;
    expect(policy.Properties.ManagedPolicyName).toBe(`lai-django-processing-${envName}`);
    expect(policy.Properties.Roles).toBeUndefined(); // attached by name by the platform stack
    const statements = (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement;
    const ids = (name: string) => queueByName(phase1, name).id;
    const bySid = Object.fromEntries(statements.map((statement) => [statement.Sid, statement]));
    expect(Object.keys(bySid).sort()).toEqual(
      [
        'ConsumeCompletions',
        'DeadLetterStatus',
        'QuarantineObjects',
        'ReadArtifacts',
        'SendWork',
      ].sort(),
    );
    expect(actions(bySid.SendWork).sort()).toEqual(['sqs:GetQueueAttributes', 'sqs:SendMessage']);
    expect(bySid.SendWork.Resource).toBe(`{${ids(`lai-${envName}-processing-work`)}.Arn}`);
    expect(actions(bySid.ConsumeCompletions).sort()).toEqual(
      [
        'sqs:ChangeMessageVisibility',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes',
        'sqs:ReceiveMessage',
      ].sort(),
    );
    expect(bySid.ConsumeCompletions.Resource).toBe(
      `{${ids(`lai-${envName}-processing-completions`)}.Arn}`,
    );
    expect(actions(bySid.DeadLetterStatus)).toEqual(['sqs:GetQueueAttributes']);
    expect(resourceList(bySid.DeadLetterStatus)).toEqual([
      `{${ids(`lai-${envName}-processing-work-dlq`)}.Arn}`,
      `{${ids(`lai-${envName}-processing-completions-dlq`)}.Arn}`,
    ]);
    expect(actions(bySid.QuarantineObjects).sort()).toEqual(['s3:GetObject', 's3:PutObject']);
    expect(bySid.QuarantineObjects.Resource).toBe(
      `${bucketArn}/processing/quarantine/${envName}/*`,
    );
    expect(actions(bySid.ReadArtifacts).sort()).toEqual(['s3:GetObject', 's3:GetObjectVersion']);
    expect(bySid.ReadArtifacts.Resource).toBe(`${bucketArn}/processing/artifacts/${envName}/*`);
    for (const statement of statements) {
      for (const resource of resourceList(statement)) expect(resource).not.toBe('*');
      for (const action of actions(statement)) expect(action).not.toContain('*');
    }
  });

  it('writes the five Django settings, with the backend sqs only when the worker exists', () => {
    const value = (built: ReturnType<typeof synth>, name: string) =>
      built
        .resources('AWS::SSM::Parameter')
        .find((parameter) => parameter.Properties.Name === `/lai/${envName}/django/${name}`)!
        .Properties.Value;
    for (const built of [phase1, phase2]) {
      const parameters = built.resources('AWS::SSM::Parameter');
      expect(parameters.map((parameter) => parameter.Properties.Name).sort()).toEqual(
        PROCESSING_SETTINGS.map((name) => `/lai/${envName}/django/${name}`).sort(),
      );
      for (const parameter of parameters) expect(parameter.Properties.Type).toBe('String');
      expect(value(built, 'LAI_PROCESSING_NAMESPACE')).toBe(envName);
      expect(JSON.stringify(value(built, 'LAI_PROCESSING_WORK_QUEUE_URL'))).toContain('WorkQueue');
      expect(JSON.stringify(value(built, 'LAI_PROCESSING_COMPLETION_QUEUE_URL'))).toContain(
        'CompletionQueue',
      );
      expect(JSON.stringify(value(built, 'LAI_PROCESSING_BUCKET'))).toContain('ProcessingBucket');
    }
    expect(value(phase1, 'LAI_PROCESSING_BACKEND')).toBe('disabled');
    expect(value(phase2, 'LAI_PROCESSING_BACKEND')).toBe('sqs');
  });

  it('alarms on the queues always and on the worker in phase 2, to the existing topic', () => {
    const topic = `arn:aws:sns:${REGION}:${ACCOUNT}:lai-django-alarms-${envName}`;
    phase1.template.resourceCountIs('AWS::SNS::Topic', 0); // referenced by name, never created
    const names = (built: ReturnType<typeof synth>) =>
      built
        .resources('AWS::CloudWatch::Alarm')
        .map((alarm) => alarm.Properties.AlarmName as string)
        .sort();
    const queueAlarms = [
      'completion-backlog',
      'completion-dead-letters',
      'work-dead-letters',
      'work-oldest-message',
      'work-queue-depth',
    ].map((name) => `lai-${envName}-processing-${name}`);
    const workerAlarms = [
      'worker-concurrency-high',
      'worker-duration-high',
      'worker-errors',
      'worker-throttles',
    ].map((name) => `lai-${envName}-processing-${name}`);
    expect(names(phase1)).toEqual(queueAlarms.sort());
    expect(names(phase2)).toEqual([...queueAlarms, ...workerAlarms].sort());
    const byName = Object.fromEntries(
      phase2
        .resources('AWS::CloudWatch::Alarm')
        .map((alarm) => [
          (alarm.Properties.AlarmName as string).split('-processing-')[1],
          alarm.Properties,
        ]),
    );
    for (const alarm of Object.values(byName)) {
      expect(alarm.AlarmActions).toEqual([topic]);
      expect(alarm.TreatMissingData).toBe('notBreaching');
      expect(alarm.ComparisonOperator).toBe('GreaterThanOrEqualToThreshold');
    }
    expect(byName['work-dead-letters']).toMatchObject({
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 1,
    });
    expect(byName['completion-dead-letters']).toMatchObject({ Threshold: 1 });
    expect(byName['work-oldest-message']).toMatchObject({
      MetricName: 'ApproximateAgeOfOldestMessage',
      Threshold: 3600,
    });
    expect(byName['completion-backlog']).toMatchObject({
      MetricName: 'ApproximateAgeOfOldestMessage',
      Threshold: prod ? 3600 : 43200,
    });
    expect(byName['work-queue-depth']).toMatchObject({ Threshold: prod ? 200 : 50 });
    expect(byName['worker-errors']).toMatchObject({
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Dimensions: [{ Name: 'FunctionName', Value: `lai-${envName}-processing-worker` }],
      Threshold: 1,
    });
    expect(byName['worker-throttles']).toMatchObject({ MetricName: 'Throttles', Threshold: 1 });
    expect(byName['worker-duration-high']).toMatchObject({
      MetricName: 'Duration',
      ExtendedStatistic: 'p95',
      Threshold: 480_000,
    });
    expect(byName['worker-concurrency-high']).toMatchObject({
      MetricName: 'ConcurrentExecutions',
      Threshold: prod ? 5 : 2,
    });
    // Overrides from the processingAlarms context.
    const tuned = synth({
      envName,
      workerImageDigest: DIGEST,
      alarms: { workOldestMessageSeconds: 900, completionOldestMessageSeconds: 7200 },
    });
    const tunedAlarm = (suffix: string) =>
      tuned
        .resources('AWS::CloudWatch::Alarm')
        .find((alarm) => alarm.Properties.AlarmName === `lai-${envName}-processing-${suffix}`)!
        .Properties.Threshold;
    expect(tunedAlarm('work-oldest-message')).toBe(900);
    expect(tunedAlarm('completion-backlog')).toBe(7200);
    expect(() => synth({ envName, alarms: { workerErrors: 0 } })).toThrow(/positive/);
  });

  it('protects prod from deletion and exposes only non-secret outputs', () => {
    expect(phase2.stack.terminationProtection).toBe(prod);
    expect(Object.keys(phase2.json.Outputs).sort()).toEqual(
      [
        'CompletionDeadLetterQueueUrl',
        'CompletionQueueUrl',
        'DjangoProcessingPolicyArn',
        'ProcessingBackend',
        'ProcessingBucketName',
        'WorkDeadLetterQueueUrl',
        'WorkQueueUrl',
        'WorkerFunctionName',
        'WorkerImageDigest',
        'WorkerRoleArn',
      ].sort(),
    );
    expect(phase2.json.Outputs.WorkerFunctionName.Value).toBe(`lai-${envName}-processing-worker`);
  });

  it('has no VPC, NAT, endpoint, custom resource or S3 notification', () => {
    const types = Object.values(phase2.json.Resources).map((resource) => resource.Type);
    for (const type of types) {
      expect(type).not.toMatch(
        /^(AWS::EC2::|AWS::ElasticLoadBalancingV2::|AWS::WAFv2::|Custom::|AWS::CloudFormation::CustomResource|AWS::ECR::|AWS::RDS::|AWS::SecretsManager::)/,
      );
    }
    expect(types.filter((type) => type === 'AWS::Lambda::Function')).toHaveLength(1);
  });
});

describe('ProcessingStack validation', () => {
  it('accepts the frozen defaults', () => {
    expect(() => validateWorkerSizing(defaultWorkerSizing('dev'))).not.toThrow();
    expect(defaultWorkerSizing('dev')).toEqual({
      timeoutSeconds: 600,
      memoryMb: 2048,
      ephemeralStorageMb: 2048,
      reservedConcurrency: 2,
      batchSize: 1,
      workVisibilitySeconds: 3600,
      completionVisibilitySeconds: 300,
    });
  });

  it('refuses a timeout over 840 s and a visibility under six times timeout x batch', () => {
    expect(() => synth({ envName: 'dev', sizing: { timeoutSeconds: 900 } })).toThrow(
      /timeoutSeconds/,
    );
    expect(() =>
      synth({ envName: 'dev', sizing: { timeoutSeconds: 700, workVisibilitySeconds: 3600 } }),
    ).toThrow(/at least 6 x/);
    expect(() =>
      synth({ envName: 'dev', sizing: { batchSize: 2, workVisibilitySeconds: 3600 } }),
    ).toThrow(/= 7200/);
    expect(() => synth({ envName: 'dev', sizing: { reservedConcurrency: 1 } })).toThrow(
      /reservedConcurrency/,
    );
  });

  it('refuses a digest that is not sha256:<64 hex>', () => {
    for (const bad of [
      'latest',
      'sha256:abc',
      `sha512:${'a'.repeat(64)}`,
      `sha256:${'A'.repeat(64)}`,
    ]) {
      expect(() => synth({ envName: 'dev', workerImageDigest: bad })).toThrow(/sha256/);
    }
    expect(() => synth({ envName: 'dev', workerImageDigest: '  ' })).not.toThrow();
  });
});
