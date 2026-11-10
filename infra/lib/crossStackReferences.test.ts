// @vitest-environment node
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AiGuardrailStack } from './aiGuardrailStack';
import { AssetStorageStack } from './assetStorageStack';
import { ChildPhotoStorageStack } from './childPhotoStorageStack';
import { DjangoEc2Stack } from './djangoEc2Stack';
import { DjangoReleaseStack } from './djangoReleaseStack';
import { FRONTEND_REGION, FrontendStack } from './frontendStack';

/**
 * The stacks find each other by physical name, not by CloudFormation exports
 * (docs/infrastructure/resource-ownership.md section 4), so CloudFormation never checks that a
 * referenced policy, role, log group, topic, bucket or repository exists. This synthesizes the
 * whole app the way infra/bin/app.ts does and checks every such name against what some stack
 * creates (LAI-INFRA-005). No AWS call is made.
 */

const ACCOUNT = '123456789012';
const REGION = 'us-west-1';
const REPO = 'paulj3000/learning';

type Json = unknown;

/** Turns intrinsic functions into plain strings where they only join pseudo-parameters. */
function resolve(value: Json, region: string): Json {
  if (Array.isArray(value)) return value.map((item) => resolve(item, region));
  if (value && typeof value === 'object') {
    const object = value as Record<string, Json>;
    if ('Ref' in object && Object.keys(object).length === 1) {
      const ref = object.Ref as string;
      if (ref === 'AWS::AccountId') return ACCOUNT;
      if (ref === 'AWS::Region') return region;
      if (ref === 'AWS::Partition') return 'aws';
      if (ref === 'AWS::URLSuffix') return 'amazonaws.com';
      return `{${ref}}`;
    }
    if ('Fn::Join' in object) {
      const [separator, parts] = object['Fn::Join'] as [string, Json[]];
      const resolved = parts.map((part) => resolve(part, region));
      return resolved.every((part) => typeof part === 'string')
        ? (resolved as string[]).join(separator)
        : { 'Fn::Join': [separator, resolved] };
    }
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, resolve(item, region)]),
    );
  }
  return value;
}

function synthesize(envName: 'dev' | 'prod') {
  const app = new App();
  const base = { synthesizer: new BootstraplessSynthesizer() };
  const env = { account: ACCOUNT, region: REGION };
  const stacks: Stack[] = [
    new AssetStorageStack(app, `LaiAssetStorage-${envName}`, {
      ...base,
      env,
      envName,
      allowedOrigins: [],
    }),
    new ChildPhotoStorageStack(app, `LaiChildPhotos-${envName}`, {
      ...base,
      env,
      envName,
      allowedOrigins: [],
    }),
    new DjangoReleaseStack(app, 'LaiDjangoRelease', {
      ...base,
      env,
      githubRepository: REPO,
      createOidcProvider: true,
    }),
    new DjangoEc2Stack(app, `LaiDjangoEc2-${envName}`, {
      ...base,
      env,
      envName,
      githubRepository: REPO,
    }),
    new AiGuardrailStack(app, `LaiAiGuardrail-${envName}`, { ...base, env, envName }),
    new FrontendStack(app, `LaiFrontend-${envName}`, {
      ...base,
      env: { account: ACCOUNT, region: FRONTEND_REGION },
      envName,
      githubRepository: REPO,
    }),
  ];
  return stacks.map((stack) => ({
    name: stack.stackName,
    region: stack.region,
    json: JSON.stringify(resolve(Template.fromStack(stack).toJSON(), stack.region)),
    template: Template.fromStack(stack),
  }));
}

/** Where each kind of physical name is created: the resource type and its name property. */
const NAMED = {
  BucketName: 'AWS::S3::Bucket',
  RoleName: 'AWS::IAM::Role',
  ManagedPolicyName: 'AWS::IAM::ManagedPolicy',
  TopicName: 'AWS::SNS::Topic',
  LogGroupName: 'AWS::Logs::LogGroup',
  AlarmName: 'AWS::CloudWatch::Alarm',
  RepositoryName: 'AWS::ECR::Repository',
} as const;

/** Every name of one kind that a stack creates, duplicates kept. */
function createdList(stacks: ReturnType<typeof synthesize>, property: keyof typeof NAMED) {
  return stacks.flatMap(({ template, region }) =>
    Object.values(template.findResources(NAMED[property]))
      .map((resource) => resolve(resource.Properties?.[property], region))
      .filter((name): name is string => typeof name === 'string'),
  );
}

function created(stacks: ReturnType<typeof synthesize>, property: keyof typeof NAMED) {
  return new Set(createdList(stacks, property));
}

function referenced(stacks: ReturnType<typeof synthesize>, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const { json } of stacks) {
    for (const match of json.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

describe.each(['dev', 'prod'] as const)('cross-stack names (%s)', (envName) => {
  const stacks = synthesize(envName);

  it('puts every stack in its intended region', () => {
    const regions = Object.fromEntries(stacks.map((stack) => [stack.name, stack.region]));
    expect(regions).toEqual({
      [`LaiAssetStorage-${envName}`]: 'us-west-1',
      [`LaiChildPhotos-${envName}`]: 'us-west-1',
      LaiDjangoRelease: 'us-west-1',
      [`LaiDjangoEc2-${envName}`]: 'us-west-1',
      [`LaiAiGuardrail-${envName}`]: 'us-west-1',
      [`LaiFrontend-${envName}`]: 'us-east-1',
    });
  });

  it('attaches only customer policies that a stack creates', () => {
    const policies = created(stacks, 'ManagedPolicyName');
    const attached = referenced(stacks, /arn:aws:iam::123456789012:policy\/([a-z0-9-]+)/g);
    expect(attached.size).toBeGreaterThanOrEqual(2);
    for (const name of attached) expect(policies, name).toContain(name);
  });

  it('names only roles that a stack creates', () => {
    const roles = created(stacks, 'RoleName');
    const named = referenced(stacks, /"Roles":\["([a-z0-9-]+)"\]/g);
    expect(named).toContain(`lai-django-ec2-${envName}`); // the Guardrail stack's AI policy
    for (const name of named) expect(roles, name).toContain(name);
  });

  it('points metric filters and alarms at a log group and topic the EC2 stack creates', () => {
    const logGroups = created(stacks, 'LogGroupName');
    const topics = created(stacks, 'TopicName');
    const filtered = referenced(
      stacks,
      /"Type":"AWS::Logs::MetricFilter","Properties":\{[^}]*?"LogGroupName":"([^"]+)"/g,
    );
    expect(filtered).toEqual(new Set([`/lai/${envName}/django`]));
    for (const name of filtered) expect(logGroups, name).toContain(name);
    const alarmed = referenced(stacks, /arn:aws:sns:us-west-1:123456789012:([a-z0-9-]+)/g);
    expect(alarmed).toContain(`lai-django-alarms-${envName}`);
    for (const name of alarmed) expect(topics, name).toContain(name);
  });

  it('gives Django the bucket names the storage stacks create', () => {
    const buckets = created(stacks, 'BucketName');
    const ec2 = stacks.find((stack) => stack.name === `LaiDjangoEc2-${envName}`)!.template;
    const parameters = Object.values(ec2.findResources('AWS::SSM::Parameter')).map(
      (resource) => resolve(resource.Properties, REGION) as { Name: string; Value: string },
    );
    const value = (setting: string) =>
      parameters.find((parameter) => parameter.Name === `/lai/${envName}/django/${setting}`)!.Value;
    expect(buckets).toContain(value('LAI_ASSET_BUCKET'));
    expect(buckets).toContain(value('LAI_CHILD_PHOTOS_BUCKET'));
    expect(value('LAI_ASSET_BUCKET')).not.toBe(value('LAI_CHILD_PHOTOS_BUCKET'));
  });

  it('pulls from and publishes to the one ECR repository the release stack creates', () => {
    const repositories = created(stacks, 'RepositoryName');
    expect(repositories).toEqual(new Set(['lai/django']));
    const used = referenced(
      stacks,
      /arn:aws:ecr:us-west-1:123456789012:repository\/([a-z0-9/_-]+)/g,
    );
    expect(used).toEqual(repositories);
  });

  it('trusts only the GitHub OIDC provider the release stack creates', () => {
    const provider = 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com';
    const all = stacks.map((stack) => stack.json).join('\n');
    expect(all).toContain('"Url":"https://token.actions.githubusercontent.com"');
    const federated = new Set([...all.matchAll(/"Federated":"([^"]+)"/g)].map((match) => match[1]));
    expect(federated).toEqual(new Set([provider]));
  });

  it('keeps every physical name unique across the app', () => {
    for (const property of Object.keys(NAMED) as Array<keyof typeof NAMED>) {
      const all = createdList(stacks, property);
      expect(new Set(all).size, property).toBe(all.length);
    }
  });

  it('tags every stack with the project and prefixes every physical name with lai', () => {
    // Tags.of() applies at synthesis, so the tag shows on the synthesized resources.
    for (const stack of stacks) {
      expect(stack.json, stack.name).toContain(
        '{"Key":"Project","Value":"learning-adventure-island"}',
      );
    }
    for (const property of Object.keys(NAMED) as Array<keyof typeof NAMED>) {
      for (const name of createdList(stacks, property)) {
        expect(name, property).toMatch(/^(lai[-/]|\/lai\/|\/aws\/rds\/instance\/lai-)/);
      }
    }
  });
});
