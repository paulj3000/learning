// @vitest-environment node
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  AI_INFERENCE_PROFILE_ID,
  AI_METRICS_NAMESPACE,
  turnPattern,
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

describe('AiGuardrailStack', { timeout: 30_000 }, () => {
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

  it('parses the ai.turn v1 line with metric filters on the Django log group', () => {
    const template = synth();
    const filters = Object.values(template.findResources('AWS::Logs::MetricFilter')) as {
      Properties: {
        LogGroupName: string;
        FilterPattern: string;
        MetricTransformations: {
          MetricName: string;
          MetricNamespace: string;
          MetricValue: string;
        }[];
      };
    }[];
    const byName = Object.fromEntries(
      filters.map((f) => [f.Properties.MetricTransformations[0].MetricName, f.Properties]),
    );
    expect(Object.keys(byName).sort()).toEqual(
      [
        'EstimatedCostMicroUsd',
        'Fallbacks',
        'Generations',
        'GuardrailBlocks',
        'InputTokens',
        'LatencyMs',
        'OutputTokens',
        'ProviderErrors',
        'RateLimited',
        'Turns',
      ].sort(),
    );
    for (const filter of Object.values(byName)) {
      expect(filter.LogGroupName).toBe('/lai/dev/django');
      expect(filter.MetricTransformations[0].MetricNamespace).toBe(AI_METRICS_NAMESPACE);
      expect(filter.FilterPattern).toContain('event="ai.turn", version="v1"');
    }
    expect(byName.ProviderErrors.FilterPattern).toContain('status="ERROR"');
    expect(byName.LatencyMs.MetricTransformations[0].MetricValue).toBe('$latency');
  });

  it('matches the field order emitted by Django (lai/apps/ai/services/auditing.py)', () => {
    // date time level logger [req] then the 15 tokens of `ai.turn v1 ...`.
    const fields = turnPattern().slice(1, -1).split(', ');
    expect(fields).toHaveLength(5 + 15);
    expect(fields.slice(5, 9)).toEqual(['event="ai.turn"', 'version="v1"', 'route', 'source']);
    expect(fields.at(-1)).toBe('audit');
  });

  it('alarms on the Django alarm topic without paging on single events', () => {
    const template = synth();
    const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm')) as {
      Properties: {
        AlarmName: string;
        Threshold: number;
        TreatMissingData: string;
        AlarmActions: unknown[];
      };
    }[];
    expect(alarms.map((a) => a.Properties.AlarmName).sort()).toEqual(
      [
        'lai-django-ai-dev-fallback-rate',
        'lai-django-ai-dev-guardrail-blocks',
        'lai-django-ai-dev-latency',
        'lai-django-ai-dev-output-tokens',
        'lai-django-ai-dev-provider-errors',
        'lai-django-ai-dev-rate-limited',
        'lai-django-ai-dev-turn-spike',
      ].sort(),
    );
    for (const alarm of alarms) {
      expect(alarm.Properties.TreatMissingData).toBe('notBreaching');
      expect(alarm.Properties.Threshold).toBeGreaterThan(0);
      expect(JSON.stringify(alarm.Properties.AlarmActions)).toContain('lai-django-alarms-dev');
    }
  });
});
