// @vitest-environment node
import { App, BootstraplessSynthesizer, type Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AssetStorageStack } from './assetStorageStack';
import { DevPlatformStack } from './devPlatformStack';
import { DjangoEc2Stack } from './djangoEc2Stack';
import { FrontendStack } from './frontendStack';
import type { ProductionProcessingOptions } from './productionProcessing';
import {
  VISIBILITY_FACTOR,
  WORKLOADS,
  parseSizing,
  type Workload,
  type WorkloadSizing,
} from './processingWorkers';

/**
 * ADR-071 processing infrastructure (dev native workers, derived-artifact IAM, production
 * processing), synthesized in memory. No AWS call is made. Every IAM statement the workers and
 * Django get on the asset bucket is asserted positively and negatively.
 */

const env = { account: '123456789012', region: 'us-west-1' };
const REPO = 'paulj3000/learning';

type Json = Record<string, unknown>;
type Resource = { Type: string; Properties: Json; Condition?: string; DeletionPolicy?: string };
type Statement = {
  Sid?: string;
  Effect?: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: Json;
};
type Synth = { json: { Resources: Record<string, Resource>; Parameters?: Record<string, Json> } };

function synth(stack: Stack): Synth {
  return { json: Template.fromStack(stack).toJSON() as Synth['json'] };
}

function devStack(props: { optimizeWorker?: boolean; sizing?: WorkloadSizing } = {}) {
  return new DevPlatformStack(new App(), 'LaiDevPlatform-dev', {
    env,
    githubRepository: REPO,
    ...props,
  });
}

function prodStack(processing?: ProductionProcessingOptions) {
  return new DjangoEc2Stack(new App(), 'LaiDjangoEc2-prod', {
    env,
    envName: 'prod',
    githubRepository: REPO,
    synthesizer: new BootstraplessSynthesizer(),
    processing,
  });
}

const dev = synth(devStack());
const devOptimize = synth(devStack({ optimizeWorker: true }));
const prodPlain = synth(prodStack());
const prodStackWith = prodStack({});
const prod = synth(prodStackWith);
const prodAll = synth(prodStack({ optimizeWorker: true, budgetUsd: 25 }));

const resources = (s: Synth, type: string) =>
  Object.entries(s.json.Resources).filter(([, r]) => r.Type === type);
const values = (s: Synth, type: string) => resources(s, type).map(([, r]) => r);
const text = (value: unknown) => JSON.stringify(value);
const actions = (st: Statement) => (Array.isArray(st.Action) ? st.Action : [st.Action]);
const resourcesOf = (st: Statement) => (Array.isArray(st.Resource) ? st.Resource : [st.Resource]);

function roleId(s: Synth, roleName: string): string {
  const found = resources(s, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === roleName);
  if (!found) throw new Error(`no role ${roleName}`);
  return found[0];
}

/** Inline policy statements of a role (its DefaultPolicy and any other AWS::IAM::Policy). */
function statements(s: Synth, roleName: string): Statement[] {
  const id = roleId(s, roleName);
  return values(s, 'AWS::IAM::Policy')
    .filter((p) => text(p.Properties.Roles).includes(`{"Ref":"${id}"}`))
    .flatMap((p) => (p.Properties.PolicyDocument as { Statement: Statement[] }).Statement);
}

function fn(s: Synth, name: string): Resource {
  const found = values(s, 'AWS::Lambda::Function').find((f) => f.Properties.FunctionName === name);
  if (!found) throw new Error(`no function ${name}`);
  return found;
}

function queueByName(s: Synth): Record<string, [string, Resource]> {
  return Object.fromEntries(
    resources(s, 'AWS::SQS::Queue').map(([id, q]) => [q.Properties.QueueName as string, [id, q]]),
  );
}

const ARTIFACT_PREFIX = (e: string) => `/processing/artifacts/${e}/*`;
const CREATE_ONLY = {
  StringEquals: { 's3:if-none-match': '*' },
  Null: { 's3:if-none-match': 'false' },
};

/** The asset bucket statements every worker role may hold, by Sid. */
function assetStatements(st: Statement[]) {
  return st.filter((s) => text(s.Resource).includes('lai-assets-'));
}

/** Negative checks shared by every worker role in both environments. */
function expectWorkerRoleIsNarrow(st: Statement[], envName: 'dev' | 'prod', label: string) {
  for (const s of st) {
    expect(s.Effect ?? 'Allow', label).toBe('Allow');
    for (const action of actions(s)) {
      expect(action, label).not.toMatch(/^s3:\*$|^\*$|^s3:[A-Za-z]*\*/);
      expect(action, label).not.toBe('s3:DeleteObject');
      expect(action, label).not.toMatch(/^s3:DeleteObject|^s3:PutObjectAcl|^s3:PutObjectTagging/);
      expect(action, label).not.toMatch(/^(rds|rds-db|secretsmanager|ec2|iam):/);
      expect(action, label).not.toMatch(/^sqs:StartMessageMoveTask/);
      if (action.startsWith('s3:')) expect(resourcesOf(s), label).not.toContain('*');
    }
  }
  const assets = assetStatements(st);
  for (const s of assets) {
    // Never the whole bucket (`<bucket>/*`), never speech or child prefixes.
    const resourceText = text(s.Resource);
    expect(resourceText, label).not.toMatch(/-\{"Ref":"AWS::Region"\},"\/\*"\]/);
    expect(resourceText, label).not.toMatch(/speech|child/);
    if (actions(s).includes('s3:PutObject')) {
      expect(s.Sid, label).toBe('CreateArtifacts');
      expect(actions(s), label).toEqual(['s3:PutObject']);
      expect(resourceText, label).toContain(ARTIFACT_PREFIX(envName));
      expect(s.Condition, label).toEqual(CREATE_ONLY);
    }
  }
  const other = envName === 'dev' ? 'prod' : 'dev';
  expect(text(st), label).not.toContain(`processing/artifacts/${other}/`);
  expect(text(st), label).not.toMatch(/lai-child-photos|lai-speech-/);
}

// =================================================================================================
describe('dev native workers (LaiDevPlatform-dev)', () => {
  it('defines audio and image zip workers, each behind its own switch, with partial batch responses', () => {
    for (const workload of ['audio', 'image'] as const) {
      const name = `lai-dev-jobs-${workload}`;
      const f = fn(dev, name);
      const spec = WORKLOADS[workload];
      expect(f.Condition).toBe(`${workload === 'audio' ? 'Audio' : 'Image'}WorkerEnabled`);
      expect(f.Properties).toMatchObject({
        Runtime: 'python3.12',
        Architectures: ['arm64'],
        Handler: spec.handler,
        Timeout: spec.timeoutSeconds,
        MemorySize: spec.memoryMb,
        EphemeralStorage: { Size: spec.ephemeralMb },
        ReservedConcurrentExecutions: {
          'Fn::If': [
            'ReserveNativeConcurrency',
            { Ref: 'LambdaConcurrencyLimit' },
            { Ref: 'AWS::NoValue' },
          ],
        },
      });
      expect(f.Properties.VpcConfig).toBeUndefined();
      expect(text(f.Properties.Code)).toContain('lai-dev-artifacts-');
      expect(f.Properties.Code).toMatchObject({
        S3Key: { Ref: `${workload === 'audio' ? 'Audio' : 'Image'}WorkerCodeKey` },
      });
      // Results go to the one existing results queue.
      const queues = queueByName(dev);
      const env = (f.Properties.Environment as { Variables: Json }).Variables;
      expect(env.LAI_RESULTS_QUEUE_URL).toEqual({ Ref: queues['lai-dev-job-results'][0] });
      expect(env.LAI_ARTIFACT_PREFIX).toBe('processing/artifacts/dev/');
      const mapping = values(dev, 'AWS::Lambda::EventSourceMapping').find((m) =>
        text(m.Properties.EventSourceArn).includes(queues[name][0]),
      )!;
      expect(mapping.Condition).toBe(f.Condition);
      expect(mapping.Properties).toMatchObject({
        BatchSize: 1,
        FunctionResponseTypes: ['ReportBatchItemFailures'],
        ScalingConfig: { MaximumConcurrency: { Ref: 'LambdaConcurrencyLimit' } },
      });
    }
    expect(dev.json.Parameters!.EnableAudioWorker.Default).toBe('false');
    expect(dev.json.Parameters!.EnableImageWorker.Default).toBe('false');
    expect(dev.json.Parameters!.ReserveNativeWorkerConcurrency.Default).toBe('false');
  });

  it('adds the LGPL FFmpeg layer from an S3 key (a build output), kept for rollback', () => {
    const [[layerId, layer]] = resources(dev, 'AWS::Lambda::LayerVersion');
    expect(layer.Condition).toBe('AudioWorkerEnabled');
    expect(layer.DeletionPolicy).toBe('Retain');
    expect((layer as unknown as Json).UpdateReplacePolicy).toBe('Retain');
    expect(layer.Properties).toMatchObject({
      LayerName: 'lai-dev-ffmpeg',
      CompatibleArchitectures: ['arm64'],
      LicenseInfo: 'LGPL-2.1-or-later',
      Content: { S3Key: { Ref: 'AudioLayerKey' } },
    });
    expect(fn(dev, 'lai-dev-jobs-audio').Properties.Layers).toEqual([{ Ref: layerId }]);
    expect(fn(dev, 'lai-dev-jobs-image').Properties.Layers).toBeUndefined();
    expect(dev.json.Parameters!.AudioLayerKey.AllowedPattern).toBe(
      '^$|^lambda/layers/[A-Za-z0-9._-]+\\.zip$',
    );
  });

  it('defines the optimize worker only with the optimizeWorker flag, default off', () => {
    expect(() => fn(dev, 'lai-dev-jobs-optimize')).toThrow();
    expect(dev.json.Parameters!.EnableOptimizeWorker).toBeUndefined();
    // The queue exists either way; its URL reaches Django only with the worker.
    expect(queueByName(dev)['lai-dev-jobs-optimize']).toBeDefined();
    const optimize = fn(devOptimize, 'lai-dev-jobs-optimize');
    expect(optimize.Condition).toBe('OptimizeWorkerEnabled');
    expect(devOptimize.json.Parameters!.EnableOptimizeWorker.Default).toBe('false');
  });

  it('writes a native queue URL setting only when its worker exists', () => {
    const settings = values(dev, 'AWS::SSM::Parameter');
    const byName = (name: string) =>
      settings.find((p) => p.Properties.Name === `/lai/dev/django/${name}`);
    expect(byName('LAI_JOBS_AUDIO_QUEUE_URL')!.Condition).toBe('AudioWorkerEnabled');
    expect(byName('LAI_JOBS_IMAGE_QUEUE_URL')!.Condition).toBe('ImageWorkerEnabled');
    expect(byName('LAI_JOBS_OPTIMIZE_QUEUE_URL')).toBeUndefined();
    const optimize = values(devOptimize, 'AWS::SSM::Parameter').find(
      (p) => p.Properties.Name === '/lai/dev/django/LAI_JOBS_OPTIMIZE_QUEUE_URL',
    );
    expect(optimize!.Condition).toBe('OptimizeWorkerEnabled');
    // No feature control is ever written by a stack.
    expect(text(settings)).not.toMatch(/LAI_AUDIO_TRANSCODING|LAI_IMAGE_CONVERSION|LAI_GLB_/);
  });

  it('requires code (and the layer) before a native worker can be enabled', () => {
    const rules = (Template.fromStack(devStack()).toJSON() as { Rules: Json }).Rules;
    expect(Object.keys(rules)).toEqual(
      expect.arrayContaining(['AudioNeedsCode', 'AudioNeedsLayer', 'ImageNeedsCode']),
    );
  });

  it('alarms on every native dead-letter queue', () => {
    const names = values(dev, 'AWS::CloudWatch::Alarm').map((a) => a.Properties.AlarmName);
    for (const w of ['audio', 'image', 'optimize'])
      expect(names).toContain(`lai-dev-${w}-dead-letters`);
  });

  it('gives native workers asset reads under assets/ and create-only artifact writes only', () => {
    for (const workload of ['audio', 'image'] as const) {
      const st = statements(dev, `lai-dev-jobs-${workload}-worker`);
      expectWorkerRoleIsNarrow(st, 'dev', workload);
      const sids = assetStatements(st)
        .map((s) => s.Sid)
        .sort();
      // Workstream B: audio reads both prefixes; Workstream D: image reads assets/* only.
      expect(sids, workload).toEqual(
        workload === 'audio'
          ? ['CreateArtifacts', 'ListAssetBucket', 'ReadArtifacts', 'ReadAssets']
          : ['CreateArtifacts', 'ListAssetBucket', 'ReadAssets'],
      );
      const read = st.find((s) => s.Sid === 'ReadAssets')!;
      expect(actions(read)).toEqual(['s3:GetObject']);
      expect(text(read.Resource)).toContain('"/assets/*"');
      const write = st.find((s) => s.Sid === 'CreateArtifacts')!;
      expect(write.Condition).toEqual(CREATE_ONLY);
      expect(text(write.Resource)).toContain('"/processing/artifacts/dev/*"');
      const list = st.find((s) => s.Sid === 'ListAssetBucket')!;
      expect(list.Condition).toEqual({
        StringLikeIfExists: {
          's3:prefix':
            workload === 'audio' ? ['assets/*', 'processing/artifacts/dev/*'] : ['assets/*'],
        },
      });
    }
  });

  it('narrows the media worker to the two prefixes (Workstream B) and keeps AI off the bucket', () => {
    const media = statements(dev, 'lai-dev-jobs-media-worker');
    expectWorkerRoleIsNarrow(media, 'dev', 'media');
    expect(text(media.find((s) => s.Sid === 'ReadAssets')!.Resource)).toContain('"/assets/*"');
    expect(text(media.find((s) => s.Sid === 'ReadArtifacts')!.Resource)).toContain(
      '"/processing/artifacts/dev/*"',
    );
    expect(media.find((s) => s.Sid === 'CreateArtifacts')!.Condition).toEqual(CREATE_ONLY);
    const ai = statements(dev, 'lai-dev-jobs-ai-worker');
    expectWorkerRoleIsNarrow(ai, 'dev', 'ai');
    expect(assetStatements(ai)).toEqual([]);
  });

  it('applies memory and timeout overrides to the function, queue visibility and checks limits', () => {
    const custom = synth(devStack({ sizing: { image: { memoryMb: 1536, timeoutSeconds: 180 } } }));
    const image = fn(custom, 'lai-dev-jobs-image');
    expect(image.Properties).toMatchObject({ MemorySize: 1536, Timeout: 180 });
    expect(queueByName(custom)['lai-dev-jobs-image'][1].Properties.VisibilityTimeout).toBe(1080);
    expect(fn(dev, 'lai-dev-jobs-image').Properties).toMatchObject({
      MemorySize: 1024,
      Timeout: 120,
    });
    expect(() => devStack({ sizing: { image: { timeoutSeconds: 901 } } })).toThrow(/900/);
  }, 60_000);

  it('lets Django submit to every native queue and attaches the derived-artifact policy', () => {
    const role = values(dev, 'AWS::IAM::Role').find(
      (r) => r.Properties.RoleName === 'lai-django-ec2-dev',
    )!;
    expect(text(role.Properties.ManagedPolicyArns)).toContain(
      ':policy/lai-django-processing-artifacts-dev',
    );
    const submit = statements(dev, 'lai-django-ec2-dev').find((s) => s.Sid === 'SubmitJobs')!;
    const queues = queueByName(dev);
    for (const w of ['ai', 'media', 'audio', 'image', 'optimize']) {
      expect(text(submit.Resource)).toContain(queues[`lai-dev-jobs-${w}`][0]);
    }
    expect(text(submit.Resource)).not.toContain(queues['lai-dev-job-results'][0]);
  });
});

// =================================================================================================
describe('derived-artifact storage (LaiAssetStorage-<env>)', () => {
  const assetStack = (envName: 'dev' | 'prod', processingArtifacts?: boolean) =>
    Template.fromStack(
      new AssetStorageStack(new App(), `LaiAssetStorage-${envName}`, {
        env,
        envName,
        allowedOrigins: [],
        processingArtifacts,
      }),
    );

  it('gives Django read, create-only captures and retention deletes on its prefix only', () => {
    for (const envName of ['dev', 'prod'] as const) {
      const template = assetStack(envName, true);
      const policies = Object.values(
        template.findResources('AWS::IAM::ManagedPolicy', {
          Properties: { ManagedPolicyName: `lai-django-processing-artifacts-${envName}` },
        }),
      ) as Resource[];
      expect(policies).toHaveLength(1);
      const st = (policies[0].Properties.PolicyDocument as { Statement: Statement[] }).Statement;
      expect(st.map((s) => s.Sid)).toEqual([
        'ReadArtifacts',
        'CreateStaffCaptures',
        'RetentionCleanup',
      ]);
      const bySid = Object.fromEntries(st.map((s) => [s.Sid, s]));
      expect(actions(bySid.ReadArtifacts)).toEqual(['s3:GetObject']);
      expect(actions(bySid.CreateStaffCaptures)).toEqual(['s3:PutObject']);
      expect(bySid.CreateStaffCaptures.Condition).toEqual(CREATE_ONLY);
      expect(text(bySid.CreateStaffCaptures.Resource)).toContain(
        `/processing/artifacts/${envName}/capture/*`,
      );
      expect(actions(bySid.RetentionCleanup)).toEqual(['s3:DeleteObject']);
      for (const s of st) {
        expect(resourcesOf(s)).toHaveLength(1);
        expect(text(s.Resource)).toContain(`/processing/artifacts/${envName}/`);
        expect(actions(s).join()).not.toMatch(/\*/);
      }
    }
    expect(Object.keys(assetStack('prod').findResources('AWS::IAM::ManagedPolicy'))).toHaveLength(
      1,
    );
  });

  it('never expires current objects; abort-incomplete-uploads covers processing/artifacts/', () => {
    const [bucket] = Object.values(
      assetStack('prod', true).findResources('AWS::S3::Bucket'),
    ) as Resource[];
    const rules = (bucket.Properties.LifecycleConfiguration as { Rules: Json[] }).Rules;
    for (const rule of rules) {
      expect(rule.ExpirationInDays).toBeUndefined();
      expect(rule.ExpirationDate).toBeUndefined();
    }
    const abort = rules.find((r) => r.AbortIncompleteMultipartUpload)!;
    expect(abort.Prefix).toBeUndefined(); // bucket-wide, so it includes the artifacts prefix
    expect(bucket.Properties.PublicAccessBlockConfiguration).toMatchObject({
      BlockPublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  it('serves nothing from the asset bucket through CloudFront (no public processing/ path)', () => {
    for (const envName of ['dev', 'prod'] as const) {
      const site = Template.fromStack(
        new FrontendStack(new App(), `LaiFrontend-${envName}`, {
          env: { account: env.account, region: 'us-east-1' },
          envName,
          githubRepository: REPO,
        }),
      ).toJSON();
      const distributions = Object.values(site.Resources as Record<string, Resource>).filter(
        (r) => r.Type === 'AWS::CloudFront::Distribution',
      );
      expect(distributions.length).toBeGreaterThan(0);
      const config = text(distributions);
      expect(config).not.toContain('lai-assets-');
      expect(config).not.toMatch(/processing/);
      expect(config).not.toMatch(/"PathPattern":"\/?assets/);
    }
  });
});

// =================================================================================================
describe('production processing (LaiDjangoEc2-prod)', () => {
  it('leaves the production template without any processing resource unless enabled', () => {
    for (const type of [
      'AWS::SQS::Queue',
      'AWS::Lambda::Function',
      'AWS::Lambda::LayerVersion',
      'AWS::Lambda::EventSourceMapping',
      'AWS::Budgets::Budget',
      'AWS::Logs::MetricFilter',
      'AWS::S3::Bucket',
    ]) {
      expect(values(prodPlain, type), type).toHaveLength(0);
    }
    expect(text(prodPlain.json)).not.toMatch(/processing|jobs-|LAI_JOBS/);
  });

  it('creates the lai-prod queue family with DLQs, SSE and six times the worker timeout', () => {
    const queues = queueByName(prod);
    const workloads: Workload[] = ['ai', 'media', 'audio', 'image'];
    expect(Object.keys(queues).sort()).toEqual(
      ['lai-prod-job-results', ...workloads.map((w) => `lai-prod-jobs-${w}`)]
        .flatMap((n) => [n, `${n}-dlq`])
        .sort(),
    );
    for (const [, q] of Object.values(queues)) expect(q.Properties.SqsManagedSseEnabled).toBe(true);
    for (const w of workloads) {
      const q = queues[`lai-prod-jobs-${w}`][1].Properties;
      expect(q.VisibilityTimeout).toBeGreaterThanOrEqual(
        VISIBILITY_FACTOR * WORKLOADS[w].timeoutSeconds,
      );
      expect(q.RedrivePolicy).toMatchObject({ maxReceiveCount: 3 });
      expect(q.MessageRetentionPeriod).toBe(4 * 86400);
    }
    const results = queues['lai-prod-job-results'][1].Properties;
    expect(results).toMatchObject({ VisibilityTimeout: 300, MessageRetentionPeriod: 14 * 86400 });
    expect(results.RedrivePolicy).toMatchObject({ maxReceiveCount: 5 });
    // TLS-only queue policies.
    expect(text(values(prod, 'AWS::SQS::QueuePolicy'))).toContain('"aws:SecureTransport":"false"');
    expect(queueByName(prodAll)['lai-prod-jobs-optimize']).toBeDefined();
  });

  it('runs every worker as an arm64 zip outside the VPC, switched off by default', () => {
    const conditions: Record<string, string> = {
      ai: 'JobsWorkersEnabled',
      media: 'JobsWorkersEnabled',
      audio: 'AudioWorkersEnabled',
      image: 'ImageWorkersEnabled',
      optimize: 'OptimizeWorkersEnabled',
    };
    const names = values(prodAll, 'AWS::Lambda::Function').map((f) => f.Properties.FunctionName);
    expect(names).toEqual([
      'lai-prod-jobs-ai',
      'lai-prod-jobs-media',
      'lai-prod-jobs-audio',
      'lai-prod-jobs-image',
      'lai-prod-jobs-optimize',
    ]);
    for (const w of Object.keys(conditions) as Workload[]) {
      const f = fn(prodAll, `lai-prod-jobs-${w}`);
      const spec = WORKLOADS[w];
      const param = `${w[0].toUpperCase()}${w.slice(1)}WorkerConcurrency`;
      expect(f.Condition).toBe(conditions[w]);
      expect(f.Properties.VpcConfig).toBeUndefined();
      expect(f.Properties).toMatchObject({
        Architectures: ['arm64'],
        Runtime: 'python3.12',
        Handler: spec.handler,
        Timeout: spec.timeoutSeconds,
        MemorySize: spec.memoryMb,
        EphemeralStorage: { Size: spec.ephemeralMb },
        ReservedConcurrentExecutions: {
          'Fn::If': ['ReserveConcurrency', { Ref: param }, { Ref: 'AWS::NoValue' }],
        },
      });
      expect(text(f.Properties.Code)).toMatch(/"S3Bucket":\{"Ref":"ProcessingArtifactBucket/);
      expect((f.Properties.Environment as { Variables: Json }).Variables.LAI_ENV).toBe('prod');
      expect(prodAll.json.Parameters![param]).toMatchObject({
        Default: spec.prodConcurrency,
        MinValue: 2,
      });
    }
    for (const enable of [
      'EnableJobsWorkers',
      'EnableAudioWorker',
      'EnableImageWorker',
      'EnableOptimizeWorker',
    ]) {
      expect(prodAll.json.Parameters![enable].Default, enable).toBe('false');
    }
    expect(prodAll.json.Parameters!.ReserveWorkerConcurrency.Default).toBe('true');
    expect(prodAll.json.Parameters!.AiWorkerConcurrency.Default).toBe(5);
    // The reserved concurrency equals the mapping maximum (never below it).
    for (const m of values(prodAll, 'AWS::Lambda::EventSourceMapping')) {
      expect(m.Properties.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
      expect(m.Properties.BatchSize).toBe(1);
      expect(text(m.Properties.ScalingConfig)).toMatch(/WorkerConcurrency/);
    }
    expect(values(prodAll, 'AWS::Lambda::EventSourceMapping')).toHaveLength(5);
    // Log retention is configurable (P10) and every worker has its own group.
    for (const g of values(prodAll, 'AWS::Logs::LogGroup').filter((g) =>
      String(g.Properties.LogGroupName).startsWith('/aws/lambda/lai-prod-'),
    )) {
      expect(g.Properties.RetentionInDays).toEqual({ Ref: 'ProcessingLogRetentionDays' });
      expect(g.DeletionPolicy).toBe('Retain');
    }
    expect(prod.json.Parameters!.EnableOptimizeWorker).toBeUndefined();
  });

  it('scopes every prod worker role to its queue, results, inputs and create-only artifacts', () => {
    for (const w of ['ai', 'media', 'audio', 'image', 'optimize'] as Workload[]) {
      const st = statements(prodAll, `lai-prod-jobs-${w}-worker`);
      expectWorkerRoleIsNarrow(st, 'prod', w);
      const assets = assetStatements(st);
      const sids = assets.map((s) => s.Sid).sort();
      const spec = WORKLOADS[w];
      const expected = [
        ...(spec.readsAssets ? ['ReadAssets', 'ListAssetBucket'] : []),
        ...(spec.readsArtifacts ? ['ReadArtifacts'] : []),
        ...(spec.writesArtifacts ? ['CreateArtifacts'] : []),
      ].sort();
      expect(sids, w).toEqual(expected);
      expect(text(st), w).not.toMatch(/polly:|lai-dev-/);
    }
    const ai = text(statements(prodAll, 'lai-prod-jobs-ai-worker'));
    expect(ai).toContain('bedrock:InvokeModel');
    expect(ai).toContain('parameter/lai/prod/django/LAI_AI_*');
  });

  it('lets Django dispatch, consume and read results, and never send results or redrive', () => {
    const st = statements(prod, 'lai-django-ec2-prod');
    const bySid = Object.fromEntries(st.map((s) => [s.Sid, s]));
    const queues = queueByName(prod);
    expect(actions(bySid.SubmitJobs)).toEqual(['sqs:SendMessage', 'sqs:GetQueueAttributes']);
    expect(text(bySid.SubmitJobs.Resource)).not.toContain(queues['lai-prod-job-results'][0]);
    expect(text(bySid.ConsumeJobResults.Resource)).toContain(queues['lai-prod-job-results'][0]);
    expect(actions(bySid.ConsumeJobResults)).not.toContain('sqs:SendMessage');
    expect(bySid.ListJobResults.Condition).toEqual({
      StringLike: { 's3:prefix': ['jobs/results/*'] },
    });
    for (const s of st) {
      expect(actions(s)).not.toContain('sqs:StartMessageMoveTask');
      for (const [, dlq] of Object.entries(queues).filter(([n]) => n.endsWith('-dlq'))) {
        expect(text(s.Resource)).not.toContain(`"${dlq[0]}"`);
      }
    }
    const role = values(prod, 'AWS::IAM::Role').find(
      (r) => r.Properties.RoleName === 'lai-django-ec2-prod',
    )!;
    expect(text(role.Properties.ManagedPolicyArns)).toContain(
      ':policy/lai-django-processing-artifacts-prod',
    );
  });

  it('restricts DLQ redrive to an MFA operator role and nothing else', () => {
    const id = roleId(prod, 'lai-prod-jobs-dlq-redrive');
    const trust = text(prod.json.Resources[id].Properties.AssumeRolePolicyDocument);
    expect(trust).toContain('"aws:MultiFactorAuthPresent":"true"');
    expect(trust).toContain(':root');
    const st = statements(prod, 'lai-prod-jobs-dlq-redrive');
    const queues = queueByName(prod);
    const redrive = st.find((s) => s.Sid === 'RedriveFromDeadLetterQueues')!;
    for (const r of resourcesOf(redrive)) expect(text(r)).toMatch(/Dlq/);
    for (const name of Object.keys(queues).filter((n) => n.endsWith('-dlq'))) {
      expect(text(redrive.Resource)).toContain(queues[name][0]);
    }
    // No other role in the template can start a message move.
    const others = values(prod, 'AWS::IAM::Policy').filter(
      (p) => !text(p.Properties.Roles).includes(id),
    );
    expect(text(others)).not.toContain('StartMessageMoveTask');
  });

  it('gives the GitHub worker release role create-only uploads and code updates only', () => {
    const id = roleId(prodAll, 'lai-github-workers-prod');
    const trust = text(prodAll.json.Resources[id].Properties.AssumeRolePolicyDocument);
    expect(trust).toContain(`repo:${REPO}:environment:django-prod`);
    expect(trust).not.toContain('StringLike');
    const st = statements(prodAll, 'lai-github-workers-prod');
    const upload = st.find((s) => s.Sid === 'UploadReleaseArtifacts')!;
    expect(actions(upload)).toEqual(['s3:PutObject']);
    expect(upload.Condition).toEqual(CREATE_ONLY);
    expect(text(upload.Resource)).toMatch(/\/lambda\/\*.*\/releases\/processing\/\*/);
    const lambdaActions = st.flatMap(actions).filter((a) => a.startsWith('lambda:'));
    expect(new Set(lambdaActions)).toEqual(
      new Set([
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:GetFunctionConfiguration',
      ]),
    );
    for (const s of st) {
      for (const a of actions(s)) {
        expect(a).not.toMatch(
          /^(iam|sqs|ssm|ec2|rds):|^s3:Delete|PublishLayerVersion|UpdateFunctionConfiguration|^\*$/,
        );
      }
    }
    const update = st.find((s) => s.Sid === 'UpdateWorkerCode')!;
    for (const r of resourcesOf(update)) expect(text(r)).toMatch(/function:lai-prod-jobs-/);
  });

  it('writes queue URL settings only with their workers and never the backend switch', () => {
    const settings = values(prodAll, 'AWS::SSM::Parameter');
    const byName = (n: string) =>
      settings.find((p) => p.Properties.Name === `/lai/prod/django/${n}`);
    expect(byName('LAI_JOBS_AI_QUEUE_URL')!.Condition).toBe('JobsWorkersEnabled');
    expect(byName('LAI_JOBS_RESULTS_QUEUE_URL')!.Condition).toBe('JobsWorkersEnabled');
    expect(byName('LAI_JOBS_AUDIO_QUEUE_URL')!.Condition).toBe('AudioWorkersEnabled');
    expect(byName('LAI_JOBS_IMAGE_QUEUE_URL')!.Condition).toBe('ImageWorkersEnabled');
    expect(byName('LAI_JOBS_OPTIMIZE_QUEUE_URL')!.Condition).toBe('OptimizeWorkersEnabled');
    for (const operatorSet of [
      'LAI_JOBS_BACKEND',
      'LAI_ENVIRONMENT',
      'LAI_ASSET_ASYNC_VALIDATION',
      'LAI_AUDIO_TRANSCODING',
      'LAI_IMAGE_CONVERSION',
      'LAI_GLB_MESHOPT',
      'LAI_GLB_KTX2',
      'LAI_THUMBNAIL_CAPTURE',
    ]) {
      expect(byName(operatorSet), operatorSet).toBeUndefined();
    }
  });

  it('keeps worker artifacts in a private bucket; results expire, release artifacts never do', () => {
    const bucket = values(prod, 'AWS::S3::Bucket')[0];
    expect(bucket.DeletionPolicy).toBe('Retain');
    expect(text(bucket.Properties.BucketName)).toContain('lai-prod-artifacts-');
    const rules = (bucket.Properties.LifecycleConfiguration as { Rules: Json[] }).Rules;
    const byPrefix = Object.fromEntries(rules.map((r) => [r.Prefix ?? '*', r]));
    expect(byPrefix['jobs/results/'].ExpirationInDays).toBeGreaterThanOrEqual(14);
    expect(byPrefix['lambda/']).toBeUndefined();
    expect(byPrefix['releases/']).toBeUndefined();
    expect(byPrefix['*'].AbortIncompleteMultipartUpload).toEqual({ DaysAfterInitiation: 1 });
    expect(text(values(prod, 'AWS::S3::BucketPolicy'))).toContain('"aws:SecureTransport":"false"');
    const [[, layer]] = resources(prod, 'AWS::Lambda::LayerVersion');
    expect(layer.DeletionPolicy).toBe('Retain');
  });

  it('alarms on queues, DLQs, worker health, artifacts, outbox, consumer, sweep and deploys', () => {
    const alarms = Object.fromEntries(
      values(prodAll, 'AWS::CloudWatch::Alarm').map((a) => [a.Properties.AlarmName, a.Properties]),
    );
    const expected = [
      'lai-prod-results-dead-letters',
      'lai-prod-results-queue-age',
      'lai-prod-results-queue-depth',
      'lai-prod-outbox-stuck',
      'lai-prod-consumer-backoff',
      'lai-prod-reconciliation-failures',
      'lai-prod-deploy-rollbacks',
    ];
    for (const w of ['ai', 'media', 'audio', 'image', 'optimize']) {
      expected.push(
        `lai-prod-${w}-dead-letters`,
        `lai-prod-${w}-queue-age`,
        `lai-prod-${w}-queue-depth`,
        `lai-prod-${w}-worker-errors`,
        `lai-prod-${w}-worker-throttles`,
        `lai-prod-${w}-worker-duration`,
        `lai-prod-${w}-worker-memory`,
      );
    }
    for (const w of ['media', 'audio', 'image', 'optimize'])
      expected.push(`lai-prod-${w}-artifact-failures`);
    expect(
      Object.keys(alarms)
        .filter((n) => !n.startsWith('lai-django-'))
        .sort(),
    ).toEqual(expected.sort());
    expect(alarms['lai-prod-ai-queue-age'].Threshold).toEqual({ Ref: 'QueueAgeAlarmSeconds' });
    expect(alarms['lai-prod-ai-queue-depth'].Threshold).toEqual({ Ref: 'QueueDepthAlarmMessages' });
    expect(alarms['lai-prod-audio-worker-memory'].Threshold).toBe(Math.floor(2048 * 0.85));
    expect(text(alarms['lai-prod-ai-worker-errors'].AlarmActions)).toContain('AlarmTopic');
    // Without notifications the alarms still exist, with no action.
    const quiet = synth(prodStack({ notify: false }));
    for (const a of values(quiet, 'AWS::CloudWatch::Alarm').filter((a) =>
      String(a.Properties.AlarmName).startsWith('lai-prod-'),
    )) {
      expect(a.Properties.AlarmActions).toBeUndefined();
    }
    // Max memory comes from the REPORT line, not from Lambda Insights (no paid layer).
    expect(text(prodAll.json)).not.toMatch(
      /LambdaInsightsExtension|CloudWatchLambdaInsightsExecutionRolePolicy/,
    );
  });

  it('creates a budget only with an owner-set amount, filtered by the cost scope tag', () => {
    expect(values(prod, 'AWS::Budgets::Budget')).toHaveLength(0);
    Annotations.fromStack(prodStackWith).hasWarning(
      '*',
      Match.stringLikeRegexp('No processingBudgetUsd'),
    );
    const [budget] = values(prodAll, 'AWS::Budgets::Budget');
    expect(budget.Properties.Budget).toMatchObject({
      BudgetLimit: { Amount: 25, Unit: 'USD' },
      CostFilters: { TagKeyValue: ['user:CostScope$lai-prod-processing'] },
    });
    expect(text(budget.Properties.NotificationsWithSubscribers)).toContain(
      '"SubscriptionType":"SNS"',
    );
    expect(() => prodStack({ budgetUsd: 0 })).toThrow(/positive/);
  });

  it('tags processing resources for cost allocation and nothing else', () => {
    const tagged = (r: Resource) => text(r.Properties.Tags).includes('"Key":"CostScope"');
    const queues = values(prod, 'AWS::SQS::Queue');
    expect(queues.every(tagged)).toBe(true);
    for (const q of queues) {
      expect(text(q.Properties.Tags)).toContain('{"Key":"Component","Value":"processing"}');
      expect(text(q.Properties.Tags)).toContain('{"Key":"Environment","Value":"prod"}');
    }
    expect(values(prod, 'AWS::EC2::Instance').some(tagged)).toBe(false);
    expect(values(prod, 'AWS::RDS::DBInstance').some(tagged)).toBe(false);
  });

  it('parses the processingSizing context and rejects unknown workloads', () => {
    expect(parseSizing('')).toBeUndefined();
    expect(parseSizing('{"image":{"memoryMb":1024,"timeoutSeconds":120}}')).toEqual({
      image: { memoryMb: 1024, timeoutSeconds: 120 },
    });
    expect(() => parseSizing('{"video":{}}')).toThrow(/unknown/);
    expect(() => parseSizing('{"audio":{"memoryMb":64}}')).toThrow(/128/);
  });

  it('refuses processing on a non-production Django stack', () => {
    expect(
      () =>
        new DjangoEc2Stack(new App(), 'LaiDjangoEc2-dev', {
          env,
          envName: 'dev',
          githubRepository: REPO,
          databaseMode: 'container',
          processing: {},
        }),
    ).toThrow(/prod only/);
  });
});
