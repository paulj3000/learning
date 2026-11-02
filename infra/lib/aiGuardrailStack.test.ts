// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  AI_INFERENCE_PROFILE_ID,
  AiGuardrailStack,
  DENIED_TOPICS,
  US_PROFILE_DESTINATIONS,
} from './aiGuardrailStack';

/** The child-safety Guardrail and Django AI policy (LAI-0704), synthesized in memory. */

const env = { account: '123456789012', region: 'us-west-1' };

function synth(djangoRoleArn?: string) {
  const app = new App();
  const stack = new AiGuardrailStack(app, 'Test', { envName: 'dev', env, djangoRoleArn });
  return Template.fromStack(stack);
}

interface Statement {
  Sid: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}

function statements(template: Template): Statement[] {
  const [policy] = Object.values(template.findResources('AWS::IAM::ManagedPolicy')) as {
    Properties: { PolicyDocument: { Statement: Statement[] } };
  }[];
  return policy.Properties.PolicyDocument.Statement;
}

describe('AiGuardrailStack', () => {
  it('filters harmful content on input and output and prompt attacks on input', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Bedrock::Guardrail', {
      Name: 'lai-child-safety-dev',
      ContentPolicyConfig: {
        FiltersConfig: Match.arrayWith([
          { Type: 'SEXUAL', InputStrength: 'HIGH', OutputStrength: 'HIGH' },
          { Type: 'VIOLENCE', InputStrength: 'HIGH', OutputStrength: 'HIGH' },
          { Type: 'MISCONDUCT', InputStrength: 'HIGH', OutputStrength: 'HIGH' },
          { Type: 'PROMPT_ATTACK', InputStrength: 'HIGH', OutputStrength: 'NONE' },
        ]),
      },
    });
  });

  it('denies private-information, secrecy, self-harm and adult topics', () => {
    const template = synth();
    const [guardrail] = Object.values(template.findResources('AWS::Bedrock::Guardrail')) as {
      Properties: { TopicPolicyConfig: { TopicsConfig: { Name: string; Type: string }[] } };
    }[];
    const topics = guardrail.Properties.TopicPolicyConfig.TopicsConfig;
    expect(topics.map((t) => t.Name)).toEqual(DENIED_TOPICS.map((t) => t.name));
    expect(topics.every((t) => t.Type === 'DENY')).toBe(true);
  });

  it('blocks PII and never anonymizes it', () => {
    const template = synth();
    const [guardrail] = Object.values(template.findResources('AWS::Bedrock::Guardrail')) as {
      Properties: {
        SensitiveInformationPolicyConfig: { PiiEntitiesConfig: { Type: string; Action: string }[] };
      };
    }[];
    const entities = guardrail.Properties.SensitiveInformationPolicyConfig.PiiEntitiesConfig;
    expect(entities.map((e) => e.Type)).toEqual(
      expect.arrayContaining(['EMAIL', 'PHONE', 'ADDRESS', 'PASSWORD', 'CREDIT_DEBIT_CARD_NUMBER']),
    );
    // Character names and ages in authored copy must not be blocked (see BLOCKED_PII).
    expect(entities.map((e) => e.Type)).not.toContain('NAME');
    expect(entities.every((e) => e.Action === 'BLOCK')).toBe(true);
  });

  it('publishes a version of the guardrail', () => {
    synth().resourceCountIs('AWS::Bedrock::GuardrailVersion', 1);
  });

  it('grants only the US profile, its destination models through it, and the guardrail', () => {
    const found = statements(synth());
    expect(found.map((s) => s.Sid)).toEqual([
      'InvokeUsInferenceProfile',
      'InvokeProfileDestinationModels',
      'ApplyChildSafetyGuardrail',
    ]);
    const json = JSON.stringify(found);
    expect(json).toContain(`inference-profile/${AI_INFERENCE_PROFILE_ID}`);
    for (const region of US_PROFILE_DESTINATIONS) expect(json).toContain(`bedrock:${region}::`);
    expect(json).not.toContain('"*"');
    expect(json).not.toContain('global.');
    for (const statement of found) {
      const actions = [statement.Action].flat();
      expect(
        actions.every((a) => a === 'bedrock:InvokeModel' || a === 'bedrock:ApplyGuardrail'),
      ).toBe(true);
    }
  });

  it('attaches to the Django EC2 role by default, or to a given role', () => {
    synth().hasResourceProperties('AWS::IAM::ManagedPolicy', {
      ManagedPolicyName: 'lai-django-ai-dev',
      Roles: ['lai-django-ec2-dev'],
    });
    synth('arn:aws:iam::123456789012:role/other-django').hasResourceProperties(
      'AWS::IAM::ManagedPolicy',
      { Roles: ['other-django'] },
    );
  });
});
