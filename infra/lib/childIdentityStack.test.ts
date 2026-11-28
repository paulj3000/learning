// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  CHILD_PASSWORD_MIN_LENGTH,
  ChildIdentityStack,
  DJANGO_CHILD_POOL_ACTIONS,
  type ChildIdentityStackProps,
} from './childIdentityStack';

/**
 * The child user pool (ADR-075), synthesized in memory and asserted on the
 * CloudFormation it produces. No AWS call is made and nothing is deployed.
 */

const env = { account: '123456789012', region: 'us-west-1' };

function synth(props: Partial<ChildIdentityStackProps> = {}) {
  const app = new App();
  const stack = new ChildIdentityStack(app, 'Test', { envName: 'prod', env, ...props });
  return Template.fromStack(stack);
}

describe('ChildIdentityStack', { timeout: 30_000 }, () => {
  it('makes one username-only pool with no sign-up, no recovery and no contact attributes', () => {
    const template = synth();
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'lai-children-prod',
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      AliasAttributes: ['preferred_username'],
      UsernameConfiguration: { CaseSensitive: false },
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'admin_only', Priority: 1 }] },
      MfaConfiguration: 'OFF',
      DeletionProtection: 'ACTIVE',
      Policies: {
        PasswordPolicy: Match.objectLike({ MinimumLength: CHILD_PASSWORD_MIN_LENGTH }),
      },
    });
    const pool = Object.values(template.findResources('AWS::Cognito::UserPool'))[0] as {
      Properties: Record<string, unknown>;
      DeletionPolicy: string;
    };
    expect(pool.DeletionPolicy).toBe('Retain');
    expect(pool.Properties.UsernameAttributes).toBeUndefined();
    expect(pool.Properties.AutoVerifiedAttributes ?? []).toEqual([]);
    const schema = (pool.Properties.Schema ?? []) as { Name: string; Required?: boolean }[];
    expect(schema.filter((a) => a.Required)).toEqual([]);
    expect(schema.map((a) => a.Name)).not.toContain('email');
    expect(schema.map((a) => a.Name)).not.toContain('phone_number');
  });

  it('has one public SRP-only client with short tokens and no writable attributes', () => {
    const template = synth();
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      AllowedOAuthFlowsUserPoolClient: false,
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      AccessTokenValidity: 5,
      IdTokenValidity: 5,
      RefreshTokenValidity: 60,
    });
    const client = Object.values(template.findResources('AWS::Cognito::UserPoolClient'))[0] as {
      Properties: { WriteAttributes?: string[] };
    };
    expect(client.Properties.WriteAttributes ?? []).toEqual([]);
  });

  it('grants Django exactly the admin calls it makes, on this pool only', () => {
    const template = synth();
    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy')) as {
      Properties: { PolicyDocument: { Statement: { Action: string[]; Resource: unknown }[] } };
    }[];
    expect(policies).toHaveLength(1);
    const statements = policies[0].Properties.PolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    expect([...statements[0].Action].sort()).toEqual([...DJANGO_CHILD_POOL_ACTIONS].sort());
    expect(JSON.stringify(statements[0].Resource)).toContain('ChildUserPool');
    expect(JSON.stringify(statements)).not.toContain('"*"');
  });

  it('keeps dev pools deletable and attaches to a given Django role', () => {
    const template = synth({
      envName: 'dev',
      djangoRoleArn: 'arn:aws:iam::123456789012:role/django',
    });
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'lai-children-dev',
      DeletionProtection: 'INACTIVE',
    });
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      Roles: ['django'],
    });
  });
});
