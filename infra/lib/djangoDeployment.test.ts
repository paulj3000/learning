// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_TASKS,
  DjangoEc2Stack,
  IMAGE_URI_PATTERN,
  READINESS_PATH,
  bashWrapper,
  kebab,
  readScript,
  type DjangoEc2StackProps,
} from './djangoEc2Stack';
import { DJANGO_REPOSITORY_NAME, DjangoReleaseStack } from './djangoReleaseStack';

/**
 * The EC2 release pipeline's AWS resources (ADR-037), synthesized in memory
 * and asserted on the CloudFormation they produce. No AWS call is made.
 */

const env = { account: '123456789012', region: 'us-west-1' };
const REPO = 'paulj3000/learning';

function ec2Stack(props: Partial<DjangoEc2StackProps> = {}) {
  const stack = new DjangoEc2Stack(new App(), 'Test', {
    envName: 'prod',
    githubRepository: REPO,
    env,
    ...props,
  });
  return { stack, template: Template.fromStack(stack) };
}

type Statement = {
  Sid?: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: Record<string, Record<string, string>>;
};
type Resource = { Type: string; Properties: Record<string, unknown> };

function resources(template: Template, type: string): Resource[] {
  return Object.values(template.findResources(type)) as Resource[];
}

function statements(template: Template, roleLogicalIdPrefix: string): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .filter((policy) =>
      JSON.stringify((policy as Resource).Properties.Roles).includes(roleLogicalIdPrefix),
    )
    .flatMap(
      (policy) =>
        ((policy as Resource).Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

function actions(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function documentNamed(template: Template, name: string) {
  const doc = resources(template, 'AWS::SSM::Document').find(
    (resource) => resource.Properties.Name === name,
  );
  if (!doc) throw new Error(`no document ${name}`);
  return doc.Properties.Content as {
    parameters: Record<string, { allowedPattern?: string; allowedValues?: string[] }>;
    mainSteps: { inputs: { runCommand: string[]; timeoutSeconds: string } }[];
  };
}

// The first synth loads aws-cdk-lib, which takes several seconds on a cold run.
describe('DjangoReleaseStack', { timeout: 60_000 }, () => {
  const stack = new DjangoReleaseStack(new App(), 'Release', { githubRepository: REPO, env });
  const template = Template.fromStack(stack);

  it('makes one immutable, scanned, encrypted repository with lifecycle rules, retained', () => {
    template.resourceCountIs('AWS::ECR::Repository', 1);
    template.hasResource('AWS::ECR::Repository', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        RepositoryName: DJANGO_REPOSITORY_NAME,
        ImageTagMutability: 'IMMUTABLE',
        ImageScanningConfiguration: { ScanOnPush: true },
        // Absent means ECR's default AES-256 at-rest encryption, which the stack asks for.
        EncryptionConfiguration: Match.absent(),
      }),
    });
    const repo = resources(template, 'AWS::ECR::Repository')[0];
    const policy = JSON.parse(
      (repo.Properties.LifecyclePolicy as { LifecyclePolicyText: string }).LifecyclePolicyText,
    ) as { rules: { selection: { tagStatus: string } }[] };
    expect(policy.rules.map((rule) => rule.selection.tagStatus)).toEqual(['untagged', 'any']);
  });

  it('creates the GitHub OIDC provider natively (no Lambda) and keeps it on delete', () => {
    template.hasResource('AWS::IAM::OIDCProvider', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        Url: 'https://token.actions.githubusercontent.com',
        ClientIdList: ['sts.amazonaws.com'],
      }),
    });
    template.resourceCountIs('AWS::Lambda::Function', 0);
    const without = Template.fromStack(
      new DjangoReleaseStack(new App(), 'R2', {
        githubRepository: REPO,
        createOidcProvider: false,
        env,
      }),
    );
    without.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('lets only main of this repository assume the publisher role', () => {
    const role = resources(template, 'AWS::IAM::Role')[0];
    const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
    expect(trust).toContain('sts:AssumeRoleWithWebIdentity');
    expect(trust).toContain(
      `"token.actions.githubusercontent.com:sub":"repo:${REPO}:ref:refs/heads/main"`,
    );
    expect(trust).toContain('"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"');
    expect(trust).not.toContain('StringLike'); // no wildcard subjects
  });

  it('can push to the Django repository and nothing else', () => {
    const all = statements(template, 'ImagePublisherRole');
    for (const statement of all) {
      for (const action of actions(statement)) {
        expect(action.startsWith('ecr:')).toBe(true);
        expect(action).not.toContain('*');
      }
      if (statement.Resource === '*') {
        expect(actions(statement)).toEqual(['ecr:GetAuthorizationToken']);
      }
    }
    expect(all.flatMap(actions)).toContain('ecr:PutImage');
    expect(all.flatMap(actions)).not.toContain('ecr:DeleteRepository');
  });

  it('refuses a malformed repository name', () => {
    expect(
      () => new DjangoReleaseStack(new App(), 'Bad', { githubRepository: 'not a repo', env }),
    ).toThrow(/owner\/repo/);
  });
});

describe('DjangoEc2Stack', { timeout: 60_000 }, () => {
  const { template } = ec2Stack();

  it('synthesizes without assets, Lambdas or custom resources (bootstrapless)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 0);
    const types = Object.values(template.toJSON().Resources as Record<string, Resource>).map(
      (resource) => resource.Type,
    );
    expect(types.filter((type) => type.startsWith('Custom::'))).toEqual([]);
  });

  it('runs one encrypted, IMDSv2-only instance with no SSH and the proxy port open to the ALB only', () => {
    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: { Ref: 'InstanceType' },
      ImageId: { Ref: 'AmiId' },
      BlockDeviceMappings: [
        Match.objectLike({ Ebs: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }) }),
      ],
    });
    // IMDSv2 only, and hop limit 2 so the Django container can get the role's credentials.
    const metadata = JSON.stringify(template.toJSON());
    expect(metadata).toContain('"HttpTokens":"required"');
    expect(metadata).toContain('"HttpPutResponseHopLimit":2');
    expect(template.toJSON().Parameters.InstanceType.Default).toBe('t3.medium');
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toMatch(/"FromPort":22\b/);
    const ingress = resources(template, 'AWS::EC2::SecurityGroupIngress');
    expect(ingress).toHaveLength(2);
    for (const rule of ingress) {
      expect(rule.Properties.CidrIp).toBeUndefined(); // security-group sources only
    }
    expect(ingress.map((rule) => rule.Properties.FromPort).sort()).toEqual([5432, 8080]);
  });

  it('puts an HTTPS listener with ACM in front and redirects HTTP', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
      SslPolicy: Match.stringLikeRegexp('TLS'),
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: { Ref: 'ApiDomainName' },
      ValidationMethod: 'DNS',
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 8080,
      HealthCheckPath: READINESS_PATH,
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
      ]),
    });
  });

  it('rate-limits POSTs to the admin login with WAF', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      Rules: [
        Match.objectLike({
          Action: { Block: {} },
          Statement: { RateBasedStatement: Match.objectLike({ AggregateKeyType: 'IP' }) },
        }),
      ],
    });
    expect(JSON.stringify(template.toJSON())).toContain('/admin/login');
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  it('keeps a private, encrypted, TLS-only RDS with deletion protection and backups', () => {
    template.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Snapshot',
      Properties: Match.objectLike({
        Engine: 'postgres',
        StorageEncrypted: true,
        PubliclyAccessible: false,
        DeletionProtection: true,
        BackupRetentionPeriod: 14,
      }),
    });
    template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: { 'rds.force_ssl': '1' },
    });
    // The password lives only in Secrets Manager.
    expect(JSON.stringify(template.toJSON())).not.toMatch(/MasterUserPassword":"[^{]/);
  });

  it('defines the release documents with strict parameter patterns', () => {
    const deploy = documentNamed(template, 'lai-django-deploy-prod');
    expect(deploy.parameters.Image.allowedPattern).toBe(IMAGE_URI_PATTERN);
    expect(deploy.parameters.GitSha.allowedPattern).toBe('^[a-f0-9]{40}$');
    expect(deploy.parameters.AllowOlder.allowedValues).toEqual(['true', 'false']);
    expect(deploy.mainSteps[0].inputs.timeoutSeconds).toBe('1800');
    const script = deploy.mainSteps[0].inputs.runCommand.join('\n');
    expect(script).toContain("export LAI_REQ_IMAGE='{{ Image }}'");
    expect(script).toContain('deploy-django.sh');
    const bootstrap = documentNamed(template, 'lai-django-bootstrap-prod');
    expect(bootstrap.parameters.Task.allowedValues).toEqual([...BOOTSTRAP_TASKS]);
    for (const name of ['rollback', 'status', 'setup']) {
      expect(() => documentNamed(template, `lai-django-${name}-prod`)).not.toThrow();
    }
  });

  it('accepts only digest-pinned ECR images in the deploy document', () => {
    const pattern = new RegExp(IMAGE_URI_PATTERN);
    const digest = 'a'.repeat(64);
    expect(
      pattern.test(`123456789012.dkr.ecr.us-west-1.amazonaws.com/lai/django@sha256:${digest}`),
    ).toBe(true);
    for (const bad of [
      '123456789012.dkr.ecr.us-west-1.amazonaws.com/lai/django:latest',
      `docker.io/library/python@sha256:${digest}`,
      `123456789012.dkr.ecr.us-west-1.amazonaws.com/lai/django@sha256:${digest}'; rm -rf /`,
    ]) {
      expect(pattern.test(bad)).toBe(false);
    }
  });

  it('lets only the django-<env> GitHub environment of this repository deploy', () => {
    const role = resources(template, 'AWS::IAM::Role').find(
      (resource) => resource.Properties.RoleName === 'lai-github-deploy-prod',
    )!;
    const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
    expect(trust).toContain(`"repo:${REPO}:environment:django-prod"`);
    expect(trust).not.toContain('StringLike');
    expect(JSON.stringify(role.Properties.ManagedPolicyArns ?? [])).not.toContain('Administrator');
  });

  it('limits the deploy role to the release documents on this instance', () => {
    const all = statements(template, 'GithubDeployRole');
    const send = all.find((statement) => actions(statement).includes('ssm:SendCommand'))!;
    const targets = JSON.stringify(send.Resource);
    for (const name of ['Deploy', 'Rollback', 'Status']) {
      expect(targets).toContain(`:document/",{"Ref":"${name}Document"}`);
    }
    expect(targets).not.toContain('BootstrapDocument');
    expect(targets).not.toContain('SetupDocument');
    expect(targets).not.toContain('AWS-RunShellScript');
    expect(targets).toContain(':instance/');
    for (const statement of all) {
      for (const action of actions(statement)) {
        expect(action).not.toMatch(/\*$/);
        expect(action).not.toMatch(/^(iam|secretsmanager|s3|ecr:Put|ssm:PutParameter)/);
      }
    }
  });

  it('gives the instance only what a release needs, without access keys', () => {
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
    const role = resources(template, 'AWS::IAM::Role').find(
      (resource) => resource.Properties.RoleName === 'lai-django-ec2-prod',
    )!;
    const managed = JSON.stringify(role.Properties.ManagedPolicyArns);
    expect(managed).toContain('AmazonSSMManagedInstanceCore');
    expect(managed).toContain('lai-django-asset-storage-prod');
    const all = statements(template, 'InstanceRole');
    const wildcard = all.filter((statement) => statement.Resource === '*');
    expect(wildcard.flatMap(actions).sort()).toEqual(
      [
        'cloudwatch:PutMetricData',
        'ecr:GetAuthorizationToken',
        'kms:Decrypt',
        'logs:DescribeLogGroups',
      ].sort(),
    );
    const metrics = wildcard.find((statement) =>
      actions(statement).includes('cloudwatch:PutMetricData'),
    )!;
    expect(metrics.Condition).toEqual({
      StringEquals: { 'cloudwatch:namespace': 'LearningAdventureIsland/EC2' },
    });
    const kms = wildcard.find((statement) => actions(statement).includes('kms:Decrypt'))!;
    expect(JSON.stringify(kms.Condition)).toContain('kms:ViaService');
    for (const statement of all) {
      for (const action of actions(statement)) {
        expect(action).not.toMatch(/(^\*$|:\*$|^iam:|^s3:)/);
      }
    }
    const params = JSON.stringify(
      all.find((statement) => actions(statement).includes('ssm:GetParametersByPath'))!.Resource,
    );
    expect(params).toContain('parameter/lai/prod/django');
    expect(params).not.toContain('parameter/lai/dev');
  });

  it('writes the plain runtime settings to SSM and never a secret', () => {
    const names = resources(template, 'AWS::SSM::Parameter').map(
      (resource) => resource.Properties.Name as string,
    );
    expect(names).toContain('/lai/prod/django/LAI_ASSET_STORAGE');
    expect(names).toContain('/lai/prod/django/DJANGO_ALLOWED_HOSTS');
    expect(names.some((name) => /SECRET|PASSWORD|DATABASE_URL/.test(name))).toBe(false);
    for (const parameter of resources(template, 'AWS::SSM::Parameter')) {
      expect(parameter.Properties.Type).toBe('String');
    }
  });

  it('alarms on readiness, 5xx, memory, disk, status checks and database storage', () => {
    const names = resources(template, 'AWS::CloudWatch::Alarm').map(
      (resource) => resource.Properties.AlarmName,
    );
    expect(names.sort()).toEqual(
      [
        'lai-django-prod-not-ready',
        'lai-django-prod-target5xx',
        'lai-django-prod-memory-high',
        'lai-django-prod-disk-high',
        'lai-django-prod-system-status-failed',
        'lai-django-prod-database-storage-low',
      ].sort(),
    );
    expect(JSON.stringify(template.toJSON())).toContain(':ec2:recover');
    template.hasResource('AWS::SNS::Subscription', { Condition: 'HasAlarmEmail' });
  });

  it('retains its log groups with a retention', () => {
    for (const group of resources(template, 'AWS::Logs::LogGroup')) {
      expect(group.Properties.RetentionInDays).toBeGreaterThan(0);
    }
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: { LogGroupName: '/lai/prod/deploy', RetentionInDays: 365 },
    });
  });

  it('refuses the container database for prod and adds a retained data volume for dev', () => {
    expect(() => ec2Stack({ databaseMode: 'container' })).toThrow(/prod must use the rds/);
    const dev = ec2Stack({ envName: 'dev', databaseMode: 'container' }).template;
    dev.resourceCountIs('AWS::RDS::DBInstance', 0);
    dev.hasResource('AWS::EC2::Volume', {
      DeletionPolicy: 'Snapshot',
      Properties: Match.objectLike({ Encrypted: true, VolumeType: 'gp3' }),
    });
    dev.resourceCountIs('AWS::EC2::VolumeAttachment', 1);
  });

  it('uses a Route 53 zone for validation and the alias when one is given', () => {
    const zoned = ec2Stack({ hostedZone: { id: 'Z123', name: 'example.com' } }).template;
    zoned.resourceCountIs('AWS::Route53::RecordSet', 1);
  });
});

describe('release scripts embedded in the stack', () => {
  it('contain no SSM placeholder syntax of their own', () => {
    for (const name of ['setup-ec2.sh', 'ssm-release-entry.sh']) {
      expect(readScript(name)).not.toContain('{{');
    }
  });

  it('run the script with bash from a file, with stdin closed', () => {
    const lines = bashWrapper('echo hi', { A: 'b' });
    expect(lines[0]).toBe("export A='b'");
    expect(lines).toContain('echo hi');
    expect(lines.join('\n')).toContain('bash "$lai_script" </dev/null');
  });

  it('names alarms in kebab case', () => {
    expect(kebab('NotReady')).toBe('not-ready');
    expect(kebab('Target5xx')).toBe('target5xx');
  });
});
