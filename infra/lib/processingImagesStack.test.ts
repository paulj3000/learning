// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  KEPT_PROCESSING_IMAGES,
  ProcessingImagesStack,
  processingRepositoryName,
} from './processingImagesStack';

/**
 * LaiProcessingImages-<env> (LAI-LAMBDA-005): the worker image repository and its GitHub OIDC
 * publisher role, synthesized in memory. No AWS call is made.
 */

const env = { account: '123456789012', region: 'us-west-1' };
const REPO = 'paulj3000/learning';

type Json = Record<string, unknown>;
type Resource = { Type: string; Properties: Json; DeletionPolicy?: string };
type Statement = {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: Json;
};

function synth(envName: 'dev' | 'prod') {
  const stack = new ProcessingImagesStack(new App(), `LaiProcessingImages-${envName}`, {
    envName,
    githubRepository: REPO,
    env,
  });
  const template = Template.fromStack(stack);
  const resources = (type: string) =>
    Object.values(template.findResources(type)) as unknown as Resource[];
  return { stack, template, resources };
}

const actions = (statement: Statement) =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action];

describe.each(['dev', 'prod'] as const)(
  'ProcessingImagesStack (%s)',
  { timeout: 60_000 },
  (envName) => {
    const { stack, template, resources } = synth(envName);

    it('makes one immutable, scanned, AES-256 repository per environment, retained', () => {
      template.resourceCountIs('AWS::ECR::Repository', 1);
      template.hasResource('AWS::ECR::Repository', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
        Properties: Match.objectLike({
          RepositoryName: `lai/processing-${envName}`,
          ImageTagMutability: 'IMMUTABLE',
          ImageScanningConfiguration: { ScanOnPush: true },
        }),
      });
      expect(processingRepositoryName(envName)).toBe(`lai/processing-${envName}`);
      const [repo] = resources('AWS::ECR::Repository');
      // Absent means ECR's default AES-256 at-rest encryption, which the stack asks for (no KMS).
      expect(repo.Properties.EncryptionConfiguration).toBeUndefined();
      const lifecycle = JSON.parse(
        (repo.Properties.LifecyclePolicy as { LifecyclePolicyText: string }).LifecyclePolicyText,
      ) as {
        rules: { selection: { tagStatus: string; countType: string; countNumber: number } }[];
      };
      expect(lifecycle.rules.map((rule) => rule.selection.tagStatus)).toEqual(['untagged', 'any']);
      expect(lifecycle.rules[1].selection).toMatchObject({
        countType: 'imageCountMoreThan',
        countNumber: KEPT_PROCESSING_IMAGES,
      });
    });

    it('lets only Lambda pull, and only for this environment worker', () => {
      const [repo] = resources('AWS::ECR::Repository');
      const policy = repo.Properties.RepositoryPolicyText as { Statement: Statement[] };
      expect(policy.Statement).toHaveLength(1);
      const [statement] = policy.Statement;
      expect(statement.Effect).toBe('Allow');
      expect(statement.Principal).toEqual({ Service: 'lambda.amazonaws.com' });
      expect(actions(statement).sort()).toEqual([
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
      ]);
      expect(JSON.stringify(statement.Condition)).toContain(
        `:function:lai-${envName}-processing-worker`,
      );
    });

    it('trusts exactly the processing-<env> GitHub environment through the existing provider', () => {
      template.resourceCountIs('AWS::IAM::OIDCProvider', 0); // never a second provider
      const [role] = resources('AWS::IAM::Role');
      expect(role.Properties.RoleName).toBe(`lai-github-processing-publisher-${envName}`);
      expect(role.Properties.MaxSessionDuration).toBe(3600);
      const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
      expect(trust).toContain('sts:AssumeRoleWithWebIdentity');
      expect(trust).toContain(
        `"token.actions.githubusercontent.com:sub":"repo:${REPO}:environment:processing-${envName}"`,
      );
      expect(trust).toContain('"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"');
      expect(trust).toContain('oidc-provider/token.actions.githubusercontent.com');
      expect(trust).not.toContain('StringLike');
      expect(trust).not.toContain('refs/heads');
    });

    it('can push to this repository and nothing else', () => {
      const all = (resources('AWS::IAM::Policy') as Resource[]).flatMap(
        (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement,
      );
      for (const statement of all) {
        for (const action of actions(statement)) {
          expect(action.startsWith('ecr:')).toBe(true);
          expect(action).not.toContain('*');
        }
        if (statement.Resource === '*') {
          // GetAuthorizationToken has no resource-level permissions in IAM.
          expect(actions(statement)).toEqual(['ecr:GetAuthorizationToken']);
        } else {
          expect(JSON.stringify(statement.Resource)).toContain('ProcessingRepository');
        }
      }
      const granted = all.flatMap(actions);
      expect(granted).toContain('ecr:PutImage');
      for (const forbidden of [
        'ecr:DeleteRepository',
        'ecr:BatchDeleteImage',
        'ecr:SetRepositoryPolicy',
      ]) {
        expect(granted).not.toContain(forbidden);
      }
    });

    it('has no Lambda, custom resource or asset (bootstrapless) and protects prod', () => {
      template.resourceCountIs('AWS::Lambda::Function', 0);
      const types = Object.values(template.toJSON().Resources as Record<string, Resource>).map(
        (resource) => resource.Type,
      );
      expect(types.filter((type) => type.startsWith('Custom::'))).toEqual([]);
      expect(stack.terminationProtection).toBe(envName === 'prod');
      expect(Object.keys(template.toJSON().Outputs as Json).sort()).toEqual(
        ['ImagePublisherRoleArn', 'RepositoryName', 'RepositoryUri'].sort(),
      );
    });
  },
);

describe('ProcessingImagesStack validation', () => {
  it('refuses a malformed repository and an unreasonable image count', () => {
    expect(
      () =>
        new ProcessingImagesStack(new App(), 'Bad', {
          envName: 'dev',
          githubRepository: 'not a repo',
          env,
        }),
    ).toThrow(/owner\/repo/);
    expect(
      () =>
        new ProcessingImagesStack(new App(), 'Bad2', {
          envName: 'dev',
          githubRepository: REPO,
          keptImages: 1,
          env,
        }),
    ).toThrow(/keptImages/);
  });
});
