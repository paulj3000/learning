// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChildPhotoStorageStack } from './childPhotoStorageStack';
import {
  DEV_BOOTSTRAP_TASKS,
  DEV_DOCUMENTS,
  DEV_PLATFORM_OUTPUTS,
  DevPlatformStack,
  GRAVITON_INSTANCE_PATTERN,
  HOUR_PATTERN,
  MINUTE_PATTERN,
  speechBucketName,
} from './devPlatformStack';
import { POWER_LOOPS } from './devPowerStateMachine';

/**
 * LaiDevPlatform-dev (the native dev environment), synthesized in memory and asserted on the
 * CloudFormation it produces. No AWS call is made.
 */

const env = { account: '123456789012', region: 'us-west-1' };
const REPO = 'paulj3000/learning';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Json = Record<string, unknown>;
type Resource = { Type: string; Properties: Json; Condition?: string; DeletionPolicy?: string };
type Statement = { Sid?: string; Action: string | string[]; Resource: unknown; Condition?: Json };

const stack = new DevPlatformStack(new App(), 'LaiDevPlatform-dev', {
  env,
  githubRepository: REPO,
});
const template = Template.fromStack(stack);
const json = template.toJSON() as {
  Parameters: Record<string, Json>;
  Resources: Record<string, Resource>;
  Outputs: Record<string, Json>;
  Rules: Record<string, Json>;
};

function resources(type: string): Resource[] {
  return Object.values(json.Resources).filter((resource) => resource.Type === type);
}

function logicalId(type: string, prefix: string): string {
  const id = Object.keys(json.Resources).find(
    (key) => key.startsWith(prefix) && json.Resources[key].Type === type,
  );
  if (!id) throw new Error(`no ${type} ${prefix}`);
  return id;
}

/** Every statement of the inline policies attached to one role. */
function roleStatements(rolePrefix: string): Statement[] {
  const role = logicalId('AWS::IAM::Role', rolePrefix);
  return resources('AWS::IAM::Policy')
    .filter((policy) => JSON.stringify(policy.Properties.Roles) === JSON.stringify([{ Ref: role }]))
    .flatMap(
      (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

function actions(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function resourcesOf(statement: Statement): unknown[] {
  return Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
}

function trust(rolePrefix: string): Json {
  return json.Resources[logicalId('AWS::IAM::Role', rolePrefix)].Properties
    .AssumeRolePolicyDocument as Json;
}

/** The user data with each CloudFormation token replaced by `tokenBytes` characters. */
function renderedUserData(tokenBytes: number): string {
  const [instance] = resources('AWS::EC2::Instance');
  const userData = instance.Properties.UserData as {
    'Fn::Base64': { 'Fn::Join': [string, unknown[]] };
  };
  return userData['Fn::Base64']['Fn::Join'][1]
    .map((part) => (typeof part === 'string' ? part : 'x'.repeat(tokenBytes)))
    .join('');
}

describe('DevPlatformStack', { timeout: 120_000 }, () => {
  it('has no load balancer, WAF, NAT, endpoints, containers, build pipeline or custom resource', () => {
    const types = Object.values(json.Resources).map((resource) => resource.Type);
    const forbidden = [
      /^AWS::ElasticLoadBalancingV2::/,
      /^AWS::WAFv2::/,
      /^AWS::EC2::NatGateway$/,
      /^AWS::EC2::VPCEndpoint$/,
      /^AWS::ECR::Repository$/,
      /^AWS::ECS::/,
      /^AWS::CodeBuild::/,
      /^AWS::CodePipeline::/,
      /^AWS::RDS::DBProxy/,
      /^Custom::/,
      /^AWS::CloudFormation::CustomResource$/,
    ];
    for (const type of types) {
      for (const pattern of forbidden) expect(type).not.toMatch(pattern);
    }
    // The jobs workers and the native workers (ADR-071) are the only functions: no
    // CDK-generated helper Lambda. The optimize worker needs the optimizeWorker flag.
    expect(resources('AWS::Lambda::Function').map((fn) => fn.Properties.FunctionName)).toEqual([
      'lai-dev-jobs-ai',
      'lai-dev-jobs-media',
      'lai-dev-jobs-audio',
      'lai-dev-jobs-image',
    ]);
  });

  it('declares every contract parameter with its default', () => {
    const defaults: Record<string, unknown> = {
      Environment: 'dev',
      InstanceType: 't4g.small',
      EC2VolumeSize: 15,
      SwapSizeMb: 1024,
      DatabaseInstanceClass: 'db.t4g.micro',
      DatabaseStorageSize: 20,
      DatabaseMaxStorageSize: 50,
      DatabaseMultiAZ: 'false',
      DatabaseBackupRetention: 3,
      DatabaseDeletionProtection: 'true',
      EnableLambdaProcessing: 'true',
      WorkerCodeKey: '',
      LambdaMemorySize: 512,
      LambdaConcurrencyLimit: 2,
      EnableScheduledShutdown: 'true',
      ShutdownHour: '0',
      ShutdownMinute: '0',
      StartupHour: '7',
      StartupMinute: '35',
      StartupWarmupMinutes: 25,
      ScheduleTimezone: 'America/Los_Angeles',
      SiteDomainName: 'lai.pauldimitriu.com',
      ApiDomainName: 'api.pauldimitriu.com',
      AdminDomainName: 'ladm.pauldimitriu.com',
      HostedZoneId: '',
      HostedZoneName: '',
      CertificateEmail: '',
      AdminAllowedCidr: '',
      OpenHttpPort: 'false',
      CreateGithubOidcProvider: 'true',
      GitHubRepository: REPO,
      AlarmEmail: '',
      MonthlyBudgetUsd: 40,
      LogRetentionDays: 14,
    };
    for (const [name, value] of Object.entries(defaults)) {
      expect(json.Parameters[name]?.Default, name).toEqual(value);
    }
    for (const name of [
      'AmiId',
      'CognitoUserPoolId',
      'CognitoClientId',
      'CloudFrontOriginPrefixListId',
    ]) {
      expect(json.Parameters[name], name).toBeDefined();
      expect(json.Parameters[name].Default, name).toBeUndefined();
    }
    expect(json.Parameters.AmiId.Type).toBe('AWS::EC2::Image::Id');
    expect(json.Parameters.LambdaConcurrencyLimit.MinValue).toBe(2);
    expect(json.Parameters.EC2VolumeSize.MinValue).toBe(10);
    expect(json.Parameters.Environment.AllowedValues).toEqual(['dev']);
  });

  it('refuses the HTTP-01 setup without port 80 and Lambda without code', () => {
    expect(JSON.stringify(json.Rules.HttpChallengeNeedsPort80)).toContain('OpenHttpPort');
    expect(JSON.stringify(json.Rules.LambdaNeedsWorkerCode)).toContain('WorkerCodeKey');
  });

  it('accepts only Graviton instance types', () => {
    const pattern = new RegExp(json.Parameters.InstanceType.AllowedPattern as string);
    expect(json.Parameters.InstanceType.AllowedPattern).toBe(GRAVITON_INSTANCE_PATTERN);
    for (const ok of ['t4g.small', 't4g.medium', 'm7g.large', 'c6gn.xlarge', 'r8gd.2xlarge']) {
      expect(pattern.test(ok), ok).toBe(true);
    }
    for (const bad of [
      't3.small',
      't3a.medium',
      'm5.large',
      'c7i.large',
      'm7a.large',
      'g5.xlarge',
    ]) {
      expect(pattern.test(bad), bad).toBe(false);
    }
    // Schedule fields: unpadded numbers only, so the cron expression never carries '07' or '00'.
    const hour = new RegExp(HOUR_PATTERN);
    const minute = new RegExp(MINUTE_PATTERN);
    expect(['0', '7', '10', '23'].every((value) => hour.test(value))).toBe(true);
    expect(['00', '07', '24', '', '7:35'].some((value) => hour.test(value))).toBe(false);
    expect(['0', '5', '35', '59'].every((value) => minute.test(value))).toBe(true);
    expect(['00', '05', '60', ''].some((value) => minute.test(value))).toBe(false);
    for (const name of ['ShutdownHour', 'StartupHour']) {
      expect(json.Parameters[name].AllowedPattern, name).toBe(HOUR_PATTERN);
    }
    for (const name of ['ShutdownMinute', 'StartupMinute']) {
      expect(json.Parameters[name].AllowedPattern, name).toBe(MINUTE_PATTERN);
    }
    expect(json.Parameters.ShutdownTime).toBeUndefined();
    expect(json.Parameters.StartupTime).toBeUndefined();
  });

  it('runs one IMDSv2-only instance with an encrypted gp3 root and an Elastic IP, no key pair', () => {
    const [instance] = resources('AWS::EC2::Instance');
    expect(resources('AWS::EC2::Instance')).toHaveLength(1);
    expect(instance.Properties.InstanceType).toEqual({ Ref: 'InstanceType' });
    expect(instance.Properties.ImageId).toEqual({ Ref: 'AmiId' });
    expect(instance.Properties.KeyName).toBeUndefined();
    expect(instance.Properties.MetadataOptions).toEqual({
      HttpTokens: 'required',
      HttpPutResponseHopLimit: 1,
    });
    expect(instance.Properties.BlockDeviceMappings).toEqual([
      {
        DeviceName: '/dev/xvda',
        Ebs: {
          DeleteOnTermination: true,
          Encrypted: true,
          VolumeSize: { Ref: 'EC2VolumeSize' },
          VolumeType: 'gp3',
        },
      },
    ]);
    template.resourceCountIs('AWS::EC2::EIP', 1);
    template.hasResourceProperties('AWS::EC2::EIPAssociation', {
      InstanceId: { Ref: logicalId('AWS::EC2::Instance', 'Instance') },
    });
  });

  it('allows HTTPS from CloudFront, the admin CIDR only when set, port 80 only when opened', () => {
    const origin = logicalId('AWS::EC2::SecurityGroup', 'OriginSg');
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: { 'Fn::GetAtt': [origin, 'GroupId'] },
      FromPort: 443,
      ToPort: 443,
      SourcePrefixListId: { Ref: 'CloudFrontOriginPrefixListId' },
    });
    const ingress = resources('AWS::EC2::SecurityGroupIngress');
    const admin = ingress.find((rule) => JSON.stringify(rule).includes('AdminAllowedCidr'))!;
    expect(admin.Condition).toBe('HasAdminCidr');
    expect(admin.Properties.FromPort).toBe(443);
    const http = ingress.find((rule) => rule.Properties.CidrIp === '0.0.0.0/0')!;
    expect(http.Condition).toBe('OpenHttp');
    expect(http.Properties.FromPort).toBe(80);
    // Nothing else is open to the internet, and there is no SSH anywhere.
    const all = JSON.stringify(json.Resources);
    expect(all).not.toMatch(/"FromPort":22\b/);
    const open = ingress.filter((rule) => rule.Properties.CidrIp === '0.0.0.0/0');
    expect(open).toHaveLength(1);
  });

  it('uses a single-AZ, private, encrypted PostgreSQL 16 db.t4g.micro by default', () => {
    const [database] = resources('AWS::RDS::DBInstance');
    expect(resources('AWS::RDS::DBInstance')).toHaveLength(1);
    const p = database.Properties;
    expect(p.DBInstanceIdentifier).toBe('lai-dev');
    expect(p.Engine).toBe('postgres');
    expect(String(p.EngineVersion)).toMatch(/^16/);
    expect(p.DBInstanceClass).toEqual({ Ref: 'DatabaseInstanceClass' });
    expect(json.Parameters.DatabaseInstanceClass.Default).toBe('db.t4g.micro');
    expect(p.MultiAZ).toEqual({ 'Fn::If': ['MultiAz', true, false] });
    expect(json.Parameters.DatabaseMultiAZ.Default).toBe('false');
    expect(p.PubliclyAccessible).toBe(false);
    expect(p.StorageEncrypted).toBe(true);
    expect(p.StorageType).toBe('gp3');
    expect(p.AllocatedStorage).toEqual({ Ref: 'DatabaseStorageSize' });
    expect(p.MaxAllocatedStorage).toEqual({ Ref: 'DatabaseMaxStorageSize' });
    expect(p.BackupRetentionPeriod).toEqual({ Ref: 'DatabaseBackupRetention' });
    expect(p.DeletionProtection).toEqual({ 'Fn::If': ['DeletionProtected', true, false] });
    expect(database.DeletionPolicy).toBe('Snapshot');
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: { 'rds.force_ssl': '1' },
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'lai/dev/django/database',
    });
  });

  it('embeds the native setup in user data: no Docker, well under the 16 KB limit', () => {
    const generous = renderedUserData(128); // every token as 128 bytes, longer than any real value
    expect(Buffer.byteLength(generous)).toBeLessThan(14_000);
    expect(Buffer.byteLength(generous)).toBeLessThan(16 * 1024);
    expect(generous).not.toMatch(/docker/i);
    expect(generous).not.toMatch(/postgresql16-server|postgresql-server/);
    const setup = readFileSync(resolve(repoRoot, 'scripts/aws/native/setup-native.sh'), 'utf8');
    expect(generous).toContain(setup.trimEnd());
    for (const name of [
      'LAI_ENV',
      'AWS_REGION',
      'LAI_API_HOST',
      'LAI_ADMIN_HOST',
      'LAI_SITE_HOST',
      'LAI_DB_SECRET_ARN',
      'LAI_DB_INSTANCE_ID',
      'LAI_ARTIFACT_BUCKET',
      'LAI_LOG_GROUP_PREFIX',
      'LAI_ACME_MODE',
      'LAI_HOSTED_ZONE_ID',
      'LAI_CERT_EMAIL',
      'LAI_SWAP_MB',
    ]) {
      expect(generous).toContain(`export ${name}='`);
    }
  });

  it('creates the six SSM documents with their exact names and parameters', () => {
    const documents = Object.fromEntries(
      resources('AWS::SSM::Document').map((doc) => [doc.Properties.Name, doc.Properties.Content]),
    ) as Record<
      string,
      {
        parameters: Record<string, { allowedPattern?: string; allowedValues?: string[] }>;
        mainSteps: { inputs: { runCommand: unknown[]; timeoutSeconds: string } }[];
      }
    >;
    expect(Object.keys(documents).sort()).toEqual(Object.values(DEV_DOCUMENTS).sort());
    const deploy = documents['lai-dev-native-deploy'];
    expect(Object.keys(deploy.parameters).sort()).toEqual(
      [
        'AllowDestructiveMigrations',
        'AllowOlder',
        'ArtifactSha256',
        'CommitEpoch',
        'GitSha',
        'RunUrl',
      ].sort(),
    );
    expect(deploy.parameters.GitSha.allowedPattern).toBe('^[a-f0-9]{40}$');
    expect(deploy.parameters.ArtifactSha256.allowedPattern).toBe('^[a-f0-9]{64}$');
    expect(deploy.mainSteps[0].inputs.timeoutSeconds).toBe('1800');
    const deployText = JSON.stringify(deploy.mainSteps[0].inputs.runCommand);
    for (const name of [
      'LAI_REQ_GIT_SHA',
      'LAI_REQ_ARTIFACT_SHA256',
      'LAI_REQ_COMMIT_EPOCH',
      'LAI_REQ_RUN_URL',
      'LAI_REQ_ALLOW_OLDER',
      'LAI_REQ_ALLOW_DESTRUCTIVE',
    ]) {
      expect(deployText).toContain(`export ${name}=`);
    }
    expect(documents['lai-dev-native-power'].parameters.Action.allowedValues).toEqual([
      'quiesce',
      'verify',
    ]);
    expect(JSON.stringify(documents['lai-dev-native-power'])).toContain('LAI_REQ_ACTION');
    expect(documents['lai-dev-native-bootstrap'].parameters.Task.allowedValues).toEqual([
      ...DEV_BOOTSTRAP_TASKS,
    ]);
    expect(JSON.stringify(documents['lai-dev-native-rollback'])).toContain(
      '/opt/lai/current/scripts/aws/native/rollback-native.sh',
    );
    expect(JSON.stringify(documents['lai-dev-native-status'])).toContain('status-native.sh');
    expect(JSON.stringify(documents)).not.toMatch(/docker/i);
  });

  it('writes the runtime settings and the power and deploy state parameters', () => {
    const names = resources('AWS::SSM::Parameter').map((parameter) => parameter.Properties.Name);
    for (const setting of [
      'DJANGO_ALLOWED_HOSTS',
      'DJANGO_CSRF_TRUSTED_ORIGINS',
      'COGNITO_REGION',
      'COGNITO_USER_POOL_ID',
      'COGNITO_ALLOWED_CLIENT_IDS',
      'LAI_ASSET_STORAGE',
      'LAI_ASSET_BUCKET',
      'LAI_ASSET_REGION',
      'LAI_CHILD_PHOTO_STORAGE',
      'LAI_CHILD_PHOTOS_BUCKET',
      'LAI_CHILD_PHOTOS_REGION',
      'LAI_SPEECH_STORAGE',
      'LAI_SPEECH_BUCKET',
      'LAI_JOBS_BACKEND',
      'LAI_JOBS_AI_QUEUE_URL',
      'LAI_JOBS_MEDIA_QUEUE_URL',
      'LAI_JOBS_RESULTS_QUEUE_URL',
      'LAI_JOBS_RESULTS_BUCKET',
      'LAI_STUDIO_RUN_MODE',
    ]) {
      expect(names).toContain(`/lai/dev/django/${setting}`);
    }
    const value = (name: string) =>
      resources('AWS::SSM::Parameter').find((parameter) => parameter.Properties.Name === name)!
        .Properties.Value;
    expect(value('/lai/dev/power/schedule-paused')).toBe('false');
    expect(value('/lai/dev/power/hold-until')).toBe('none');
    expect(value('/lai/dev/power/state')).toBe('running');
    expect(value('/lai/dev/deploy/pending')).toBe('none');
    expect(value('/lai/dev/deploy/apply-pending-on-start')).toBe('true');
    expect(value('/lai/dev/django/LAI_JOBS_BACKEND')).toEqual({
      'Fn::If': ['LambdaEnabled', 'sqs', 'disabled'],
    });
    // Production settings refuse `thread`: without Lambda, Studio batches are run by hand.
    expect(value('/lai/dev/django/LAI_STUDIO_RUN_MODE')).toEqual({
      'Fn::If': ['LambdaEnabled', 'jobs', 'manual'],
    });
    // No secret is ever a plain template value.
    expect(names.some((name) => /SECRET_KEY|PASSWORD/.test(String(name)))).toBe(false);
  });

  it('runs arm64 Python 3.12 workers outside the VPC, from the artifacts bucket, when enabled', () => {
    const jobsWorkers = resources('AWS::Lambda::Function').filter((fn) =>
      ['lai-dev-jobs-ai', 'lai-dev-jobs-media'].includes(fn.Properties.FunctionName as string),
    );
    expect(jobsWorkers).toHaveLength(2);
    for (const fn of jobsWorkers) {
      expect(fn.Condition).toBe('LambdaEnabled');
      expect(fn.Properties.Runtime).toBe('python3.12');
      expect(fn.Properties.Architectures).toEqual(['arm64']);
      expect(fn.Properties.Handler).toBe('jobs_worker.handler.handle');
      expect(fn.Properties.VpcConfig).toBeUndefined();
      expect(JSON.stringify(fn.Properties.Code)).toContain('lai-dev-artifacts-');
      expect(fn.Properties.Code).toMatchObject({ S3Key: { Ref: 'WorkerCodeKey' } });
      expect(fn.Properties.MemorySize).toEqual({ Ref: 'LambdaMemorySize' });
    }
    const timeouts = Object.fromEntries(
      jobsWorkers.map((fn) => [fn.Properties.FunctionName, fn.Properties.Timeout]),
    );
    expect(timeouts).toEqual({ 'lai-dev-jobs-ai': 300, 'lai-dev-jobs-media': 120 });
    const mappings = resources('AWS::Lambda::EventSourceMapping').filter(
      (mapping) => mapping.Condition === 'LambdaEnabled',
    );
    expect(mappings).toHaveLength(2);
    for (const mapping of mappings) {
      expect(mapping.Properties.BatchSize).toBe(1);
      expect(mapping.Properties.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
      expect(mapping.Properties.ScalingConfig).toEqual({
        MaximumConcurrency: { Ref: 'LambdaConcurrencyLimit' },
      });
    }
  });

  it('makes encrypted queues with dead-letter queues and six times the worker timeout', () => {
    const queues: Record<string, Json> = Object.fromEntries(
      resources('AWS::SQS::Queue').map((queue) => [queue.Properties.QueueName, queue.Properties]),
    );
    expect(Object.keys(queues).sort()).toEqual(
      [
        'lai-dev-job-results',
        'lai-dev-job-results-dlq',
        'lai-dev-jobs-ai',
        'lai-dev-jobs-ai-dlq',
        'lai-dev-jobs-media',
        'lai-dev-jobs-media-dlq',
        'lai-dev-jobs-audio',
        'lai-dev-jobs-audio-dlq',
        'lai-dev-jobs-image',
        'lai-dev-jobs-image-dlq',
        'lai-dev-jobs-optimize',
        'lai-dev-jobs-optimize-dlq',
      ].sort(),
    );
    for (const queue of Object.values(queues)) expect(queue.SqsManagedSseEnabled).toBe(true);
    expect(queues['lai-dev-jobs-ai'].VisibilityTimeout).toBe(1800);
    expect(queues['lai-dev-jobs-media'].VisibilityTimeout).toBe(720);
    expect(queues['lai-dev-jobs-audio'].VisibilityTimeout).toBe(1800);
    expect(queues['lai-dev-jobs-image'].VisibilityTimeout).toBe(720);
    expect(queues['lai-dev-jobs-optimize'].VisibilityTimeout).toBe(5400);
    expect(queues['lai-dev-job-results'].MessageRetentionPeriod).toBe(14 * 24 * 3600);
    for (const name of [
      'lai-dev-jobs-ai',
      'lai-dev-jobs-media',
      'lai-dev-jobs-audio',
      'lai-dev-jobs-image',
      'lai-dev-jobs-optimize',
    ]) {
      expect(queues[name].RedrivePolicy).toMatchObject({ maxReceiveCount: 3 });
    }
    // The consumer never receives while PostgreSQL is down (ADR-064), so five receives are
    // five real application attempts, not outage minutes.
    expect(queues['lai-dev-job-results'].RedrivePolicy).toMatchObject({ maxReceiveCount: 5 });
  });

  it('keeps the speech bucket private and expires child speech after 7 days', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        BucketName: Match.anyValue(),
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
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({ Prefix: 'speech/child/', ExpirationInDays: 7, Status: 'Enabled' }),
          ]),
        },
      }),
    });
  });

  it('names the speech bucket deterministically for the account and region', () => {
    const [bucket] = resources('AWS::S3::Bucket');
    expect(bucket.Properties.BucketName).toEqual({
      'Fn::Join': [
        '',
        [
          speechBucketName('', '').replace(/-+$/, '-'),
          { Ref: 'AWS::AccountId' },
          '-',
          { Ref: 'AWS::Region' },
        ],
      ],
    });
  });

  it('keeps the child photo bucket private as well (LaiChildPhotos-dev)', () => {
    const photos = Template.fromStack(
      new ChildPhotoStorageStack(new App(), 'Photos', { envName: 'dev', allowedOrigins: [], env }),
    );
    photos.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('schedules the nightly stop and morning start in America/Los_Angeles by default', () => {
    const schedules: Record<string, Json> = Object.fromEntries(
      resources('AWS::Scheduler::Schedule').map((schedule) => [
        schedule.Properties.Name,
        schedule.Properties,
      ]),
    );
    expect(Object.keys(schedules).sort()).toEqual([
      'lai-dev-morning-start',
      'lai-dev-nightly-stop',
    ]);
    expect(json.Parameters.ScheduleTimezone.Default).toBe('America/Los_Angeles');
    for (const [name, schedule] of Object.entries(schedules)) {
      expect(schedule.ScheduleExpressionTimezone).toEqual({ Ref: 'ScheduleTimezone' });
      expect(schedule.State).toEqual({ 'Fn::If': ['ScheduleEnabled', 'ENABLED', 'DISABLED'] });
      expect(schedule.GroupName).toBe('default');
      const target = schedule.Target as { Arn: unknown; Input: string };
      expect(JSON.stringify(target.Arn)).toContain(
        logicalId('AWS::StepFunctions::StateMachine', 'Power'),
      );
      expect(JSON.parse(target.Input)).toEqual({
        action: name === 'lai-dev-nightly-stop' ? 'stop' : 'start',
        source: 'schedule',
        force: false,
      });
      // cron(<minute> <hour> * * ? *) from the unpadded parameters, nothing else.
      const prefix = name === 'lai-dev-nightly-stop' ? 'Shutdown' : 'Startup';
      expect(schedule.ScheduleExpression).toEqual({
        'Fn::Join': [
          '',
          ['cron(', { Ref: `${prefix}Minute` }, ' ', { Ref: `${prefix}Hour` }, ' * * ? *)'],
        ],
      });
    }
  });

  it('stops the database again when RDS restarts it after seven days', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.rds'],
        detail: { EventID: ['RDS-EVENT-0154'], SourceIdentifier: ['lai-dev'] },
      },
      Targets: [
        Match.objectLike({
          Input: JSON.stringify({ action: 'stop', source: 'rds-event', force: false }),
        }),
      ],
    });
  });

  it('builds lai-dev-power from SDK integrations only, with bounded loops and a hold-until check', () => {
    const [machine] = resources('AWS::StepFunctions::StateMachine');
    expect(machine.Properties.StateMachineName).toBe('lai-dev-power');
    expect(machine.Properties.StateMachineType).toBe('STANDARD');
    const parts = (machine.Properties.DefinitionString as { 'Fn::Join': [string, unknown[]] })[
      'Fn::Join'
    ][1];
    // Tokens sit inside JSON strings (ARNs, the instance id): any placeholder keeps it valid.
    const text = parts.map((part) => (typeof part === 'string' ? part : 'TOKEN')).join('');
    const definition = JSON.parse(text) as { States: Record<string, Json> };
    const states = Object.values(definition.States);
    const tasks = states.filter((state) => state.Type === 'Task');
    expect(tasks.length).toBeGreaterThan(10);
    for (const task of tasks) {
      expect(task.Resource as string).toMatch(
        /^arn:TOKEN:states:::aws-sdk:(ec2|rds|ssm):[a-zA-Z]+$/,
      );
    }
    const resourcesUsed = new Set(
      tasks.map((task) => String(task.Resource).split(':').slice(-2).join(':')),
    );
    for (const call of [
      'ec2:stopInstances',
      'ec2:startInstances',
      'rds:stopDBInstance',
      'rds:startDBInstance',
      'ssm:sendCommand',
      'ssm:getCommandInvocation',
    ]) {
      expect(resourcesUsed).toContain(call);
    }
    // Paths are rendered once: a key never ends in a doubled `.$`.
    expect(text).not.toContain('.$.$');
    expect((definition.States.Normalize.Parameters as Json)['now.$']).toBe('$$.State.EnteredTime');
    expect(text).toContain('"TimestampGreaterThanPath":"$.now"');
    expect(text).toContain('"IsTimestamp":true');
    // Every loop has a ceiling.
    for (const { max } of Object.values(POWER_LOOPS)) {
      expect(text).toMatch(new RegExp(`"(NumericGreaterThanEquals|NumericLessThan)":${max}[,}]`));
    }
    const waits = states.filter((state) => state.Type === 'Wait');
    expect(waits.length).toBeGreaterThanOrEqual(7);

    // AWS SDK integrations use the SDK's PascalCase shapes, where RDS acronyms are `Db...`
    // (aws-samples/step-functions-workflows-collection uses DbInstanceIdentifier and
    // $.DbInstances[0].DbInstanceStatus). `DBInstanceIdentifier` would fail validation at run time.
    const byResource = (call: string) =>
      tasks.filter((task) => String(task.Resource).endsWith(`aws-sdk:${call}`));
    for (const call of ['rds:describeDBInstances', 'rds:stopDBInstance', 'rds:startDBInstance']) {
      expect(byResource(call).length, call).toBeGreaterThan(0);
      for (const task of byResource(call)) {
        expect(Object.keys(task.Parameters as Json), call).toEqual(['DbInstanceIdentifier']);
      }
    }
    for (const task of byResource('rds:describeDBInstances')) {
      expect(task.ResultSelector).toEqual({ 'status.$': '$.DbInstances[0].DbInstanceStatus' });
    }
    for (const task of byResource('ec2:describeInstances')) {
      expect(task.ResultSelector).toEqual({
        'state.$': '$.Reservations[0].Instances[0].State.Name',
      });
    }
    for (const task of byResource('ssm:sendCommand')) {
      expect(task.ResultSelector).toEqual({ 'commandId.$': '$.Command.CommandId' });
      expect(Object.keys(task.Parameters as Json).sort()).toEqual(
        ['Comment', 'DocumentName', 'InstanceIds', 'Parameters', 'TimeoutSeconds'].sort(),
      );
    }
    for (const task of byResource('ssm:getCommandInvocation')) {
      expect(task.ResultSelector).toEqual({ 'status.$': '$.Status' });
      expect(Object.keys(task.Parameters as Json).sort()).toEqual(['CommandId.$', 'InstanceId']);
    }
    for (const task of byResource('ssm:describeInstanceInformation')) {
      expect(task.ResultSelector).toEqual({ 'list.$': '$.InstanceInformationList' });
    }
    expect(text).toContain('"Variable":"$.ssm.list[0].PingStatus"');
    for (const task of byResource('ssm:getParameter')) {
      expect(task.ResultSelector).toEqual({ 'value.$': '$.Parameter.Value' });
    }
  });

  it('lets the power state machine start and stop only the dev instance and database', () => {
    const statements = roleStatements('PowerStateMachineRole');
    const instance = logicalId('AWS::EC2::Instance', 'Instance');
    const powerActions = [
      'ec2:StopInstances',
      'ec2:StartInstances',
      'rds:StopDBInstance',
      'rds:StartDBInstance',
      'ssm:SendCommand',
      'ssm:PutParameter',
      'ssm:GetParameter',
    ];
    for (const action of powerActions) {
      const granting = statements.filter((statement) => actions(statement).includes(action));
      expect(granting.length, action).toBeGreaterThan(0);
      for (const statement of granting) {
        expect(resourcesOf(statement), action).not.toContain('*');
        const text = JSON.stringify(statement.Resource);
        if (action.startsWith('ec2:')) {
          expect(text).toContain(`{"Ref":"${instance}"}`);
          expect(resourcesOf(statement)).toHaveLength(1);
        }
        if (action.startsWith('rds:')) expect(text).toContain(':db:lai-dev');
        if (action === 'ssm:SendCommand') {
          expect(text).toContain('document/lai-dev-native-power');
          expect(text).not.toMatch(/native-(deploy|rollback|setup|bootstrap)/);
        }
        if (action.endsWith('Parameter')) expect(text).toContain('parameter/lai/dev/power/*');
      }
    }
    const wildcard = statements.filter((statement) => resourcesOf(statement).includes('*'));
    for (const statement of wildcard) {
      for (const action of actions(statement)) {
        expect(action).toMatch(/^(ec2|rds|ssm):(Describe|Get)|^logs:/);
      }
    }
  });

  it('gives the GitHub roles no direct start or stop, and trusts only their environment', () => {
    const forbidden = /^(ec2:(Start|Stop)Instances|rds:(Start|Stop)DBInstance|ec2:\*|rds:\*|\*)$/;
    for (const [prefix, environment] of [
      ['BackendDeploymentRole', 'dev-backend'],
      ['InfrastructureManagementRole', 'dev-infrastructure'],
    ] as const) {
      const statements = roleStatements(prefix);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        for (const action of actions(statement)) expect(action, prefix).not.toMatch(forbidden);
      }
      const policy = JSON.stringify(trust(prefix));
      expect(policy).toContain('"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"');
      expect(policy).toContain(
        `"token.actions.githubusercontent.com:sub":{"Fn::Join":["",["repo:",{"Ref":"GitHubRepository"},":environment:${environment}"]]}`,
      );
      expect(policy).not.toContain('StringLike');
      expect(JSON.stringify(statements)).not.toMatch(/prod/);
    }
    const backend = JSON.stringify(roleStatements('BackendDeploymentRole'));
    expect(backend).not.toContain('states:StartExecution');
    expect(backend).toContain('lambda:UpdateFunctionCode');
    expect(backend).toMatch(/document\/lai-dev-native-deploy/);
    const infra = roleStatements('InfrastructureManagementRole');
    const start = infra.find((statement) => actions(statement).includes('states:StartExecution'))!;
    expect(JSON.stringify(start.Resource)).toContain('stateMachine:lai-dev-power');
    expect(JSON.stringify(infra)).not.toContain('lambda:');
  });

  it('creates the GitHub OIDC provider only when asked', () => {
    const [provider] = resources('AWS::IAM::OIDCProvider');
    expect(provider.Condition).toBe('CreateOidcProvider');
    expect(provider.Properties.Url).toBe('https://token.actions.githubusercontent.com');
  });

  it('attaches the storage policies by name and keeps the instance role least-privilege', () => {
    const role = json.Resources[logicalId('AWS::IAM::Role', 'InstanceRole')];
    expect(role.Properties.RoleName).toBe('lai-django-ec2-dev');
    const managed = JSON.stringify(role.Properties.ManagedPolicyArns);
    expect(managed).toContain('AmazonSSMManagedInstanceCore');
    expect(managed).toContain(':policy/lai-django-asset-storage-dev');
    expect(managed).toContain(':policy/lai-django-child-photos-dev');
    const statements = roleStatements('InstanceRole');
    const text = JSON.stringify(statements);
    expect(text).toContain('LearningAdventureIsland/DevEC2');
    expect(text).toContain('releases/*');
    for (const statement of statements) {
      for (const action of actions(statement)) {
        expect(action).not.toMatch(/^(s3|ec2|rds|sqs|ssm|iam):\*$|^\*$/);
        expect(action).not.toMatch(/^(ec2|rds):(Start|Stop)/);
      }
    }
    // certbot DNS-01 only with a hosted zone, and only _acme-challenge TXT records.
    const [certbot] = resources('AWS::IAM::Policy').filter(
      (policy) => policy.Properties.PolicyName === 'certbot-dns-01',
    ) as Resource[];
    expect(certbot.Condition).toBe('HasHostedZone');
    expect(JSON.stringify(certbot)).toContain(
      '"route53:ChangeResourceRecordSetsNormalizedRecordNames":["_acme-challenge.*"]',
    );
  });

  it('lets only the media worker list the asset bucket, so a missing asset reads as 404', () => {
    // The bucket ARN itself (no `/key` part), as CloudFormation renders it.
    const assetBucket = {
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          ':s3:::lai-assets-dev-',
          { Ref: 'AWS::AccountId' },
          '-',
          { Ref: 'AWS::Region' },
        ],
      ],
    };
    const media = roleStatements('MediaWorkerRole');
    const listing = media.filter((statement) => actions(statement).includes('s3:ListBucket'));
    const [list] = listing.filter((statement) => statement.Sid === 'ListAssetBucket');
    expect(list).toBeDefined();
    expect(actions(list)).toEqual(['s3:ListBucket']);
    expect(resourcesOf(list)).toEqual([assetBucket]);
    expect(list.Condition).toEqual({
      StringLikeIfExists: { 's3:prefix': ['assets/*', 'processing/artifacts/dev/*'] },
    });
    // The other ListBucket statements are unchanged and none of them names the asset bucket.
    expect(listing.map((statement) => statement.Sid).sort()).toEqual([
      'ListAssetBucket',
      'ListResults',
      'ListSpeech',
    ]);
    for (const statement of listing.filter((s) => s.Sid !== 'ListAssetBucket')) {
      expect(JSON.stringify(statement.Resource)).not.toContain('lai-assets-');
    }
    // Object reads stay GetObject only, on the asset library inputs (assets/*, narrowed from
    // the whole bucket by ADR-066); the only write is the create-only artifact statement.
    const [read] = media.filter((statement) => statement.Sid === 'ReadAssets');
    expect(actions(read)).toEqual(['s3:GetObject']);
    const join = assetBucket['Fn::Join'];
    expect(resourcesOf(read)).toEqual([{ 'Fn::Join': [join[0], [...join[1], '/assets/*']] }]);
    const assetText = (s: Statement) => JSON.stringify(s.Resource).includes('lai-assets-');
    expect(
      media
        .filter(assetText)
        .map((s) => s.Sid)
        .sort(),
    ).toEqual(['CreateArtifacts', 'ListAssetBucket', 'ReadArtifacts', 'ReadAssets']);
    // No wildcard S3 action, and no S3 action on every resource, for either worker.
    for (const prefix of ['MediaWorkerRole', 'AiWorkerRole']) {
      for (const statement of roleStatements(prefix)) {
        for (const action of actions(statement)) {
          expect(action, prefix).not.toMatch(/^s3:[^:]*\*|^\*$/);
          if (action.startsWith('s3:')) expect(resourcesOf(statement), prefix).not.toContain('*');
        }
      }
    }
    // The AI worker gains nothing on the asset bucket.
    const ai = JSON.stringify(roleStatements('AiWorkerRole'));
    expect(ai).not.toContain('lai-assets-');
    expect(ai).not.toContain('ListAssetBucket');
  });

  it('alarms on memory, disk, dead letters and database storage; budget only with an e-mail', () => {
    const alarms = Object.fromEntries(
      resources('AWS::CloudWatch::Alarm').map((alarm) => [
        alarm.Properties.AlarmName,
        alarm.Properties,
      ]),
    );
    expect(alarms['lai-dev-memory-high']).toMatchObject({
      MetricName: 'mem_used_percent',
      Threshold: 90,
      ComparisonOperator: 'GreaterThanThreshold',
    });
    expect(alarms['lai-dev-disk-high']).toMatchObject({
      MetricName: 'disk_used_percent',
      Threshold: 85,
    });
    for (const name of ['ai', 'media', 'results']) {
      expect(alarms[`lai-dev-${name}-dead-letters`]).toMatchObject({
        MetricName: 'ApproximateNumberOfMessagesVisible',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    }
    expect(alarms['lai-dev-database-storage-low']).toMatchObject({
      MetricName: 'FreeStorageSpace',
      Threshold: 2 * 1024 ** 3,
    });
    const [budget] = resources('AWS::Budgets::Budget');
    expect(budget.Condition).toBe('HasAlarmEmail');
    expect(budget.Properties.Budget).toMatchObject({
      BudgetLimit: { Amount: { Ref: 'MonthlyBudgetUsd' } },
    });
    template.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'lai-django-alarms-dev' });
  });

  it('applies the log retention parameter to every log group', () => {
    const groups = resources('AWS::Logs::LogGroup');
    expect(groups.map((group) => group.Properties.LogGroupName).sort()).toEqual(
      [
        '/aws/lambda/lai-dev-jobs-ai',
        '/aws/lambda/lai-dev-jobs-media',
        '/aws/lambda/lai-dev-jobs-audio',
        '/aws/lambda/lai-dev-jobs-image',
        '/aws/rds/instance/lai-dev/postgresql',
        '/aws/vendedlogs/states/lai-dev-power',
        '/lai/dev/deploy',
        '/lai/dev/django',
        '/lai/dev/jobs',
        '/lai/dev/nginx',
      ].sort(),
    );
    for (const group of groups) {
      expect(group.Properties.RetentionInDays).toEqual({ Ref: 'LogRetentionDays' });
    }
  });

  it('outputs every name the scripts and workflows read, and no secret value', () => {
    const expected = [
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
    ];
    expect(Object.keys(json.Outputs).sort()).toEqual([...expected].sort());
    expect([...DEV_PLATFORM_OUTPUTS].sort()).toEqual([...expected].sort());
    expect(json.Outputs.ParameterPrefix.Value).toBe('/lai/dev/');
    expect(JSON.stringify(json.Outputs)).not.toMatch(/SecretString|GetSecretValue|secretsmanager:/);
  });
});

describe('infra/bin/app.ts', { timeout: 180_000 }, () => {
  const tsx = resolve(repoRoot, 'node_modules/.bin/tsx');
  const synth = (envName: 'dev' | 'prod') => {
    const out = mkdtempSync(join(tmpdir(), `lai-synth-${envName}-`));
    try {
      execFileSync(tsx, [resolve(repoRoot, 'infra/bin/app.ts')], {
        cwd: repoRoot,
        env: {
          ...process.env,
          LAI_ENV: envName,
          CDK_OUTDIR: out,
          LAI_HOSTED_ZONE_ID: '',
          LAI_HOSTED_ZONE_NAME: '',
          LAI_DATABASE_MODE: '',
        },
        stdio: 'pipe',
      });
      return Object.fromEntries(
        readdirSync(out)
          .filter((file) => file.endsWith('.template.json'))
          .map((file) => [
            file.replace('.template.json', ''),
            JSON.parse(readFileSync(join(out, file), 'utf8')) as {
              Resources: Record<string, Resource>;
            },
          ]),
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  };

  it('synthesizes the native dev stacks and no Docker or ECR stack for dev', () => {
    const templates = synth('dev');
    expect(Object.keys(templates).sort()).toEqual(
      [
        'LaiAiGuardrail-dev',
        'LaiAssetStorage-dev',
        'LaiChildPhotos-dev',
        'LaiDevArtifacts-dev',
        'LaiDevPlatform-dev',
        'LaiFrontend-dev',
      ].sort(),
    );
  });

  it('still synthesizes LaiDjangoEc2-prod with its load balancer and LaiDjangoRelease for prod', () => {
    const templates = synth('prod');
    expect(Object.keys(templates).sort()).toEqual(
      [
        'LaiAiGuardrail-prod',
        'LaiAssetStorage-prod',
        'LaiChildPhotos-prod',
        'LaiDjangoEc2-prod',
        'LaiDjangoRelease',
        'LaiFrontend-prod',
      ].sort(),
    );
    const types = (name: string) =>
      Object.values(templates[name].Resources).map((resource) => resource.Type);
    expect(types('LaiDjangoEc2-prod')).toContain('AWS::ElasticLoadBalancingV2::LoadBalancer');
    expect(types('LaiDjangoEc2-prod')).toContain('AWS::WAFv2::WebACL');
    expect(types('LaiDjangoRelease')).toContain('AWS::ECR::Repository');
  });
});

describe('LaiDevPlatform-dev with Bedrock in another Region (ADR-064)', { timeout: 60_000 }, () => {
  const oregon = Template.fromStack(
    new DevPlatformStack(new App(), 'LaiDevPlatform-dev', {
      env,
      githubRepository: REPO,
      bedrockRegion: 'us-west-2',
    }),
  );

  it('creates the AI log alarms here, beside the Django log group', () => {
    expect(Object.keys(oregon.findResources('AWS::Logs::MetricFilter')).length).toBeGreaterThan(5);
    oregon.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'lai-django-ai-dev-high-severity-safety-event',
    });
    // Same Region as before: nothing about EC2, RDS or the queues moves.
    template.resourceCountIs('AWS::Logs::MetricFilter', 0);
  });

  it('lets the AI worker apply Guardrails only in the Bedrock Region', () => {
    const text = JSON.stringify(oregon.findResources('AWS::IAM::Policy'));
    expect(text).toContain(':bedrock:us-west-2:');
    expect(text).not.toMatch(/bedrock:us-west-1:[^"]*guardrail/);
  });
});
